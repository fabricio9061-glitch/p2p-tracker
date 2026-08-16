function sincronizarSaldoUsdt(){AppState.datos.saldoUsdt=roundMoney(AppState.datos.lotes.reduce((s,l)=>roundMoney(s+l.disponible),0))}

/* ═══════════════════════════════════════════════════════════════════════
   §IG — INTEGRIDAD FINANCIERA (capa central de validación)
   Reglas duras: ningún saldo bancario o lote puede quedar negativo.
   Toda mutación de saldo debe pasar por aplicarDeltaBanco() para garantía.
   ═══════════════════════════════════════════════════════════════════════ */
const INTEG_EPSILON=0.005; /* tolerancia uniforme para comparaciones de saldo */

/* Verifica si una operación puede aplicarse SIN ejecutarla.
   Devuelve {ok, reason?}. Acepta un objeto con deltas planificados:
     { bancos: {Itau: -80000, BBVA: +5000}, usdt: -100 }
   Aplica todos los deltas en una "vista simulada" y verifica que ninguno
   quede negativo (más allá del epsilon). */
function validarDeltas(deltas){
    deltas=deltas||{};
    const errs=[];
    /* Bancos */
    if(deltas.bancos){
        for(const [nombre,delta] of Object.entries(deltas.bancos)){
            if(typeof delta!=='number'||!isFinite(delta))continue;
            const bk=AppState.datos.bancos[nombre];
            if(!bk){errs.push(`Banco ${nombre} no existe`);continue}
            const nuevoSaldo=roundMoney(bk.saldo+delta);
            if(nuevoSaldo<-INTEG_EPSILON){
                errs.push(`${nombre} quedaría con saldo negativo: ${getSym(getBancoInfo(nombre)?.moneda)}${fmtNum(nuevoSaldo,2)} (saldo actual ${getSym(getBancoInfo(nombre)?.moneda)}${fmtNum(bk.saldo,2)}, requeridos ${getSym(getBancoInfo(nombre)?.moneda)}${fmtNum(Math.abs(delta),2)})`);
            }
        }
    }
    /* USDT total disponible */
    if(deltas.usdt&&typeof deltas.usdt==='number'&&isFinite(deltas.usdt)){
        const nuevo=roundMoney(AppState.datos.saldoUsdt+deltas.usdt);
        if(nuevo<-INTEG_EPSILON){
            errs.push(`Inventario USDT quedaría negativo: ${fmtTrunc(nuevo,2)} USDT (disponible ${fmtTrunc(AppState.datos.saldoUsdt,2)}, requeridos ${fmtTrunc(Math.abs(deltas.usdt),2)})`);
        }
        /* Validación FIFO por moneda — solo si es egreso de USDT que va contra inventario */
        if(deltas.usdt<0&&deltas.usdtMoneda){
            const requerido=Math.abs(deltas.usdt);
            const disponibleEnMoneda=AppState.datos.lotes
                .filter(l=>(l.moneda||'UYU')===deltas.usdtMoneda&&l.disponible>0)
                .reduce((s,l)=>roundMoney(s+l.disponible),0);
            if(requerido>disponibleEnMoneda+INTEG_EPSILON){
                errs.push(`Inventario USDT en ${deltas.usdtMoneda} insuficiente: ${fmtTrunc(disponibleEnMoneda,2)} disponible, ${fmtTrunc(requerido,2)} requerido`);
            }
        }
    }
    /* Aportes (split pago): cada banco debe poder cubrir su parte */
    if(Array.isArray(deltas.aportes)){
        for(const a of deltas.aportes){
            const bk=AppState.datos.bancos[a.banco];
            if(!bk){errs.push(`Banco ${a.banco} no existe`);continue}
            if(bk.saldo<a.monto-INTEG_EPSILON){
                errs.push(`${a.banco} no tiene saldo suficiente: ${getSym(getBancoInfo(a.banco)?.moneda)}${fmtNum(bk.saldo,2)} disponible, ${getSym(getBancoInfo(a.banco)?.moneda)}${fmtNum(a.monto,2)} requerido`);
            }
        }
    }
    return errs.length?{ok:false,reason:errs[0],all:errs}:{ok:true};
}

/* Verifica integridad post-mutación: ningún banco/lote quedó negativo.
   Llamado al final de operaciones críticas como red de seguridad. */
function verificarIntegridadGlobal(){
    const errs=[];
    Object.entries(AppState.datos.bancos||{}).forEach(([n,bk])=>{
        if(bk&&bk.saldo<-INTEG_EPSILON)errs.push(`${n}: ${fmtNum(bk.saldo,2)}`);
    });
    (AppState.datos.lotes||[]).forEach(l=>{
        if(l.disponible<-INTEG_EPSILON)errs.push(`Lote ${l.id}: ${fmtTrunc(l.disponible,2)} USDT`);
    });
    if(errs.length)console.error('[INTEGRIDAD] Saldos negativos detectados tras mutación:',errs);
    return errs;
}

/* Aplica los deltas a los saldos. Asume que ya pasaron validarDeltas().
   Tras aplicar, fixNeg() es safety net contra -0 epsilon.
   deltas.bancos: {nombre: deltaSaldo}
   deltas.limitesUSD: {nombre: deltaLimiteUsado}  (opcional, + aumenta uso, - lo reduce)
*/
/* ═══════════════════════════════════════════════════════════════════════════
   AUDITORÍA AUTOMÁTICA DE SALDOS (v5.7.2)
   ═══════════════════════════════════════════════════════════════════════════
   Por qué hace falta, y por qué solo para los saldos.

   El saldo USDT es DERIVADO: se recalcula desde cero reproduciendo todas las
   operaciones. Si un cálculo sale mal, el siguiente lo corrige solo. En cambio
   el saldo de cada cuenta es MUTADO: se le suma y se le resta, y el resultado
   es el único registro que existe. Si una resta se pierde —o se aplica dos
   veces— nadie lo nota y el error queda ahí para siempre, arrastrándose sobre
   todos los cálculos posteriores.

   Esa asimetría es la que produjo las dos fallas de esta versión. Mientras los
   saldos sigan siendo mutados, la única defensa es vigilarlos.

   Cómo funciona: cada vez que la app cambia un saldo a propósito, anota cuál
   debería ser el resultado. En el siguiente dibujado compara lo anotado con lo
   real. Si no coinciden, algo lo cambió por fuera de una acción del usuario, y
   eso siempre es un error. Lo registra con el detalle y avisa.

   No corrige sola: un ajuste automático sobre dinero, hecho a partir de un
   diagnóstico que puede estar equivocado, es peor que el problema. Avisa, deja
   la evidencia y ofrece revisarlo.                                            */
const _AUDITORIA_TOLERANCIA=0.005;
let _saldosEsperados=null;
let _auditoriaAvisada=false;
const _auditoriaHallazgos=[];

/* Registra cuál debería ser el saldo tras un cambio deliberado */
function _auditoriaAnotar(){
    if(!AppState.datos||!AppState.datos.bancos)return;
    _saldosEsperados={};
    Object.keys(AppState.datos.bancos).forEach(n=>{
        _saldosEsperados[n]=roundMoney(AppState.datos.bancos[n].saldo||0);
    });
}

/* Compara lo anotado con lo real. Devuelve las cuentas que no coinciden. */
function auditarSaldos(opts){
    opts=opts||{};
    if(!_saldosEsperados||!AppState.datos||!AppState.datos.bancos)return[];
    const desvios=[];
    Object.keys(_saldosEsperados).forEach(n=>{
        const bk=AppState.datos.bancos[n];
        if(!bk)return;
        const real=roundMoney(bk.saldo||0),esp=_saldosEsperados[n];
        if(Math.abs(real-esp)>_AUDITORIA_TOLERANCIA){
            desvios.push({banco:n,esperado:esp,real,diferencia:roundMoney(real-esp)});
        }
    });
    if(desvios.length){
        const reg={cuando:new Date().toISOString(),desvios};
        _auditoriaHallazgos.push(reg);
        if(_auditoriaHallazgos.length>50)_auditoriaHallazgos.shift();
        console.error('%c[P2P][auditoría] Saldos alterados sin una acción que lo explique',
            'color:#b91c1c;font-weight:bold',desvios);
        if(!_auditoriaAvisada&&!opts.silencioso){
            _auditoriaAvisada=true;
            const lista=desvios.map(d=>`${d.banco}: esperado ${fmtNum(d.esperado,2)} · quedó ${fmtNum(d.real,2)}`).join('\n• ');
            setTimeout(()=>{
                alert('Se detectó un saldo alterado\n\n• '+lista+
                      '\n\nAlgo cambió estos saldos por fuera de una operación tuya. '+
                      'No se modificó nada de forma automática.\n\n'+
                      'Revisá el detalle con auditoriaSaldos() en la consola, '+
                      'y verificá el estado general con verificarIntegridad().');
            },400);
        }
    }
    /* La foto pasa a ser la nueva referencia */
    _auditoriaAnotar();
    return desvios;
}

/* Informe para la consola */
function auditoriaSaldos(){
    const inf={
        vigilando:_saldosEsperados?Object.keys(_saldosEsperados).length:0,
        hallazgos:_auditoriaHallazgos.length,
        detalle:_auditoriaHallazgos
    };
    console.log('%c[Auditoría de saldos]',
        _auditoriaHallazgos.length?'color:#b91c1c;font-weight:bold':'color:#15803d;font-weight:bold',inf);
    if(!_auditoriaHallazgos.length)console.log('  Sin desvíos desde que abriste la app.');
    else console.table(_auditoriaHallazgos.flatMap(h=>h.desvios));
    return inf;
}
window.auditoriaSaldos=auditoriaSaldos;

function aplicarDeltas(deltas){
    deltas=deltas||{};
    if(deltas.bancos){
        for(const [nombre,delta] of Object.entries(deltas.bancos)){
            const bk=AppState.datos.bancos[nombre];
            if(!bk)continue;
            bk.saldo=fixNeg(roundMoney(bk.saldo+delta));
            /* ═══ v5.7.2 — Sin esto el descuento se perdía ═══
               El saldo de cada cuenta no se recalcula nunca: se le suma y se le
               resta. Al cargar una operación se anotaba como pendiente la
               operación, pero NO el cambio de saldo, así que el guardián que
               protege lo local no lo veía. Si en esa ventana llegaba una foto del
               servidor —el eco de un guardado anterior, u otro dispositivo— el
               saldo remoto pisaba al recién descontado y la resta desaparecía
               para siempre, porque nadie la vuelve a calcular. */
            if(typeof enqueueSync==='function')enqueueSync('update','bancos',nombre);
        }
    }
    /* Cambio deliberado: se anota el resultado esperado para poder vigilarlo */
    _auditoriaAnotar();
    if(deltas.limitesUSD){
        for(const [nombre,delta] of Object.entries(deltas.limitesUSD)){
            const bk=AppState.datos.bancos[nombre];
            if(!bk||!(bk.limiteDiarioUSD>0))continue;
            const nuevo=roundMoney((bk.limiteUsadoUSD||0)+delta);
            bk.limiteUsadoUSD=Math.max(0,Math.min(bk.limiteDiarioUSD,nuevo));
        }
    }
}

/* Helper: convierte monto en UYU (o USD) a su equivalente en USD para tracking de límite diario.
   Si el banco es USD, el monto ya está en USD. Si es UYU, divide por ultimaTasaCompra. 
   Si no hay tasa válida, devuelve 0 (no se trackea). */
function _montoEnUSDLimite(bancoNombre,monto){
    if(!monto||monto<=0)return 0;
    const bi=getBancoInfo(bancoNombre);
    if(bi?.moneda==='USD')return roundMoney(monto);
    const tasa=AppState.datos.ultimaTasaCompra;
    if(!tasa||tasa<=0)return 0;
    return roundMoney(monto/tasa);
}

/* ═══ Conversión unificada de movimientos a UYU ═══
   Fuente única de verdad para convertir cualquier movimiento a UYU.
   Prioridad:
     1. m.valorUYU persistido (calculado en replay FIFO)
     2. m.monto * m.tasaRef (tasa manual del registro)
     3. m.monto * tasaFallback (última tasa de compra)
   Para movs en banco: si banco USD → multiplica por tasaFallback; si banco UYU → retorna monto directo.
   Garantiza consistencia entre dashboard, análisis, resumen mensual y listados. */
function movimientoValorUYU(m,tasaFallback){
    if(!m)return 0;
    const tasaFb=tasaFallback||AppState.datos.ultimaTasaCompra||1;
    if(m.tipoCuenta==='usdt'){
        if(typeof m.valorUYU==='number'&&m.valorUYU>0)return m.valorUYU;
        return roundMoney(m.monto*(m.tasaRef||tasaFb));
    }
    /* Banco: respetar moneda */
    const bi=m.banco?getBancoInfo(m.banco):null;
    if(bi&&bi.moneda==='USD')return roundMoney(m.monto*tasaFb);
    return m.monto; /* UYU directo */
}

/* ═══ Tags ═══ */
const TAG_MAX_LEN=24; /* Cap length to avoid overflow into banco column */
function normalizarTag(t){return(t||'').trim().replace(/\s+/g,' ').slice(0,TAG_MAX_LEN)}
function stripAccents(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
function tagKey(t){return stripAccents(t).toLowerCase()}

/* Keyword → category aliases for smart suggestions */
const TAG_ALIASES={
    'uber':'transporte','cabify':'transporte','taxi':'transporte','bus':'transporte','omnibus':'transporte','nafta':'transporte','combustible':'transporte','estacionamiento':'transporte','peaje':'transporte',
    'netflix':'suscripciones','spotify':'suscripciones','youtube':'suscripciones','hbo':'suscripciones','disney':'suscripciones','amazon':'suscripciones','prime':'suscripciones',
    'antel':'servicios','ute':'servicios','ose':'servicios','luz':'servicios','agua':'servicios','internet':'servicios','celular':'servicios','telefono':'servicios',
    'alquiler':'vivienda','renta':'vivienda','expensas':'vivienda','gastos comunes':'vivienda',
    'super':'alimentacion','supermercado':'alimentacion','comida':'alimentacion','restaurante':'alimentacion','delivery':'alimentacion','rappi':'alimentacion','pedidosya':'alimentacion',
    'farmacia':'salud','medico':'salud','mutualista':'salud','emergencia':'salud','dentista':'salud',
    'gimnasio':'deporte','gym':'deporte','futbol':'deporte','cancha':'deporte'
};

function getAliasSuggestion(text){
    if(!text||text.length<2)return null;
    const k=tagKey(text);
    const kNoSpace=k.replace(/\s+/g,'');
    /* Direct match (with and without spaces) */
    if(TAG_ALIASES[k])return TAG_ALIASES[k];
    if(TAG_ALIASES[kNoSpace])return TAG_ALIASES[kNoSpace];
    /* Partial match */
    for(const[alias,cat] of Object.entries(TAG_ALIASES)){
        const aliasNS=alias.replace(/\s+/g,'');
        if(alias.startsWith(k)||k.startsWith(alias))return cat;
        if(aliasNS.startsWith(kNoSpace)||kNoSpace.startsWith(aliasNS))return cat;
    }
    return null;
}

function agregarTag(texto){
    const raw=normalizarTag(texto);if(!raw||raw.length<2)return;
    /* Always store lowercase, accent-stripped */
    const t=stripAccents(raw).toLowerCase();
    const key=tagKey(t);
    const existe=AppState.datos.tags.find(x=>tagKey(x)===key);
    if(!existe){AppState.datos.tags.push(t);AppState.datos.tags.sort((a,b)=>a.localeCompare(b,'es'))}
}
function eliminarTag(texto){AppState.datos.tags=AppState.datos.tags.filter(t=>tagKey(t)!==tagKey(texto))}
function editarTag(viejo,nuevo){
    const nv=normalizarTag(nuevo);if(!nv||nv.length<2)return false;
    const nvKey=tagKey(nv),vjKey=tagKey(viejo);
    const dup=AppState.datos.tags.find(t=>tagKey(t)===nvKey&&tagKey(t)!==vjKey);
    if(dup)return false;
    const idx=AppState.datos.tags.findIndex(t=>tagKey(t)===vjKey);
    if(idx>=0){
        AppState.datos.tags[idx]=nv;AppState.datos.tags.sort((a,b)=>a.localeCompare(b,'es'));
        AppState.datos.movimientos.forEach(m=>{
            if(m.descripcion&&tagKey(m.descripcion)===vjKey)m.descripcion=nv;
        });
    }
    return true;
}
function mergeTag(origen,destino){
    /* Fusionar: todas las refs de origen → destino, luego eliminar origen */
    const orKey=tagKey(origen),dsKey=tagKey(destino);
    if(orKey===dsKey)return false;
    if(!AppState.datos.tags.some(t=>tagKey(t)===dsKey))return false;
    AppState.datos.movimientos.forEach(m=>{
        if(m.descripcion&&tagKey(m.descripcion)===orKey){
            m.descripcion=AppState.datos.tags.find(t=>tagKey(t)===dsKey)||destino;
        }
    });
    AppState.datos.tags=AppState.datos.tags.filter(t=>tagKey(t)!==orKey);
    return true;
}

/* ─── Tag merge: similarity + smart suggestions ─── */
function tagSimilarityScore(a,b){
    const na=stripAccents((a||'').toLowerCase()).trim();
    const nb=stripAccents((b||'').toLowerCase()).trim();
    if(!na||!nb)return 0;
    if(na===nb)return 100;
    if(na.startsWith(nb)||nb.startsWith(na))return 80;
    if(na.includes(nb)||nb.includes(na))return 60;
    if(na.substring(0,3)===nb.substring(0,3))return 40;
    /* Bigram overlap */
    const bigrams=s=>{const r=new Set();for(let i=0;i<s.length-1;i++)r.add(s.substring(i,i+2));return r};
    const ba=bigrams(na),bb=bigrams(nb);
    if(!ba.size||!bb.size)return 0;
    let inter=0;ba.forEach(g=>{if(bb.has(g))inter++});
    const jaccard=inter/(ba.size+bb.size-inter);
    return Math.round(jaccard*40);
}
function abrirModalMergeTag(srcTag){
    if(!srcTag)return;
    const tags=AppState.datos.tags||[];
    const otros=tags.filter(t=>tagKey(t)!==tagKey(srcTag));
    if(!otros.length){alert('No hay otras categorías para fusionar. Creá una nueva primero.');return}
    /* Compute source stats */
    const movs=AppState.datos.movimientos.filter(m=>m.descripcion&&tagKey(m.descripcion)===tagKey(srcTag));
    const tasaFb=AppState.datos.ultimaTasaCompra||1;
    let totalUYU=0;
    movs.forEach(m=>{totalUYU=roundMoney(totalUYU+movimientoValorUYU(m,tasaFb))});
    AppState.ui.mergeSrcTag=srcTag;
    AppState.ui.mergeSrcStats={count:movs.length,totalUYU};
    AppState.ui.mergeSelectedDest=null;
    AppState.ui.mergeMode='existing';
    /* Render source card */
    const card=$('mergeSourceCard');
    card.innerHTML=`<div class="merge-source-label">Categoría a fusionar</div>
        <div class="merge-source-name">${escHtml(srcTag)}</div>
        <div class="merge-source-stats">
            <span class="merge-source-stat"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h11M8 12h11M8 18h11M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg> ${movs.length} movimiento${movs.length!==1?'s':''}</span>
            ${totalUYU>0?`<span class="merge-source-stat"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h20v10H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 10h.01M18 14h.01"/></svg> $${fmtNum(totalUYU,0)}</span>`:''}
        </div>`;
    /* Reset UI state */
    $('mergeSearch').value='';
    $('mergeNewName').value='';
    setMergeTab('existing');
    renderMergeDestinations('');
    updateMergeConfirmBox();
    abrirModal('modalMergeTag');
}
function setMergeTab(tab){
    AppState.ui.mergeMode=tab;
    AppState.ui.mergeSelectedDest=null;
    $('mergeTabExisting').className='merge-tab'+(tab==='existing'?' active':'');
    $('mergeTabNew').className='merge-tab'+(tab==='new'?' active':'');
    $('mergePanelExisting').style.display=tab==='existing'?'block':'none';
    $('mergePanelNew').style.display=tab==='new'?'block':'none';
    if(tab==='new')setTimeout(()=>$('mergeNewName').focus(),100);
    updateMergeConfirmBox();
}
function renderMergeDestinations(searchQuery){
    const cont=$('mergeDestList');if(!cont)return;
    const srcTag=AppState.ui.mergeSrcTag;if(!srcTag)return;
    const tags=AppState.datos.tags||[];
    const otros=tags.filter(t=>tagKey(t)!==tagKey(srcTag));
    const stats=getTagStats();
    /* Score each destination */
    const scored=otros.map(t=>{
        const sim=tagSimilarityScore(srcTag,t);
        const usos=stats[tagKey(t)]?.usos||0;
        /* Boost for high-usage destinations (more "main" categories) */
        const usageBoost=Math.log(usos+1)*8;
        return{tag:t,score:sim+usageBoost,sim,usos,suggested:sim>=40};
    }).sort((a,b)=>b.score-a.score);
    /* Filter by search */
    const q=stripAccents((searchQuery||'').toLowerCase()).trim();
    const filtered=q?scored.filter(s=>stripAccents(s.tag.toLowerCase()).includes(q)):scored;
    if(!filtered.length){
        cont.innerHTML='<div class="merge-dest-empty">Sin resultados</div>';
        return;
    }
    const selectedKey=AppState.ui.mergeSelectedDest?tagKey(AppState.ui.mergeSelectedDest):null;
    cont.innerHTML=filtered.map(s=>{
        const isSel=selectedKey===tagKey(s.tag);
        const cls='merge-dest-item'+(s.suggested?' suggested':'')+(isSel?' selected':'');
        const meta=s.usos>0?`${s.usos} movimiento${s.usos!==1?'s':''}`:'Sin usos';
        return `<div class="${cls}" data-action="merge-select-dest" data-tag="${escHtml(s.tag)}">
            <div class="merge-dest-radio"></div>
            <div class="merge-dest-info">
                <div class="merge-dest-name">${escHtml(s.tag)}</div>
                <div class="merge-dest-meta">${meta}</div>
            </div>
            ${s.suggested?'<span class="merge-dest-badge">Sugerida</span>':''}
        </div>`;
    }).join('');
}
function updateMergeConfirmBox(){
    const box=$('mergeConfirmBox'),btn=$('btnConfirmMerge');
    const src=AppState.ui.mergeSrcTag,stats=AppState.ui.mergeSrcStats||{count:0,totalUYU:0};
    let dest=null;
    if(AppState.ui.mergeMode==='existing')dest=AppState.ui.mergeSelectedDest;
    else dest=normalizarTag($('mergeNewName').value||'');
    if(!dest||(src&&tagKey(dest)===tagKey(src))){
        box.style.display='none';btn.disabled=true;return;
    }
    const tags=AppState.datos.tags||[];
    const isNew=AppState.ui.mergeMode==='new'&&!tags.some(t=>tagKey(t)===tagKey(dest));
    box.style.display='block';
    box.innerHTML=`<div>Se moverán <b>${stats.count} movimiento${stats.count!==1?'s':''}</b>${stats.totalUYU>0?` (<b>$${fmtNum(stats.totalUYU,0)}</b>)`:''} de <b>${escHtml(src)}</b> hacia <b>${escHtml(dest)}</b>${isNew?' <span style="font-size:0.7em;background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:6px;font-weight:700">NUEVA</span>':''}.</div>
        <div class="merge-confirm-warning"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z"/></svg> <span><b>${escHtml(src)}</b> se eliminará y el historial quedará unificado bajo <b>${escHtml(dest)}</b>.</span></div>`;
    btn.disabled=false;
}
function confirmarFusion(){
    const src=AppState.ui.mergeSrcTag;if(!src)return;
    let dest=null;
    if(AppState.ui.mergeMode==='existing')dest=AppState.ui.mergeSelectedDest;
    else dest=normalizarTag($('mergeNewName').value||'');
    if(!dest)return;
    if(tagKey(dest)===tagKey(src))return;
    const tags=AppState.datos.tags||[];
    /* Create new tag if needed */
    if(!tags.some(t=>tagKey(t)===tagKey(dest)))AppState.datos.tags.push(dest);
    if(mergeTag(src,dest)){
        AppState.ui.mergeSrcTag=null;AppState.ui.mergeSelectedDest=null;
        cerrarModal('modalMergeTag');
        renderizarGestionTags();
        guardaOptimista('update','tags',dest);
    }
}
/* Conteo de usos y tipo dominante por tag */
function getTagStats(){
    const stats={};
    (AppState.datos.tags||[]).forEach(t=>{stats[tagKey(t)]={nombre:t,usos:0,ingresos:0,egresos:0}});
    AppState.datos.movimientos.forEach(m=>{
        if(!m.descripcion)return;
        const k=tagKey(m.descripcion),s=stats[k];
        if(!s)return;
        s.usos++;
        if(m.tipoMovimiento==='ingreso')s.ingresos++;else s.egresos++;
    });
    return stats;
}
function renderizarTagsSugerencias(inputId,containerId){
    const input=$(inputId),cont=$(containerId);if(!cont||!input)return;
    const val=normalizarTag(input.value),valKey=stripAccents(val).toLowerCase();
    const tags=AppState.datos.tags||[];
    if(!valKey&&!tags.length){cont.innerHTML='';return}

    const stats=getTagStats();
    const tipoMov=AppState.ui.tipoMovimiento||'egreso';

    /* Check keyword alias */
    const aliasCat=getAliasSuggestion(valKey);
    const aliasKey=aliasCat?tagKey(aliasCat):null;

    let scored=tags.map(t=>{
        const k=tagKey(t),s=stats[k]||{usos:0,ingresos:0,egresos:0};
        let score=s.usos;
        if(tipoMov==='ingreso'&&s.ingresos>0)score+=10;
        if(tipoMov==='egreso'&&s.egresos>0)score+=10;
        if(tipoMov==='ingreso'&&s.egresos>0&&s.ingresos===0&&s.usos>2)score=-1;
        if(tipoMov==='egreso'&&s.ingresos>0&&s.egresos===0&&s.usos>2)score=-1;
        let match=0;
        if(valKey){
            const tk=stripAccents(t).toLowerCase();
            if(tk===valKey)match=100;
            else if(tk.startsWith(valKey))match=50;
            else if(tk.includes(valKey))match=20;
            /* Alias boost: if tag matches the alias category */
            else if(aliasKey&&tk===aliasKey)match=80;
            else if(aliasKey&&tk.includes(aliasKey))match=30;
            else match=-999;
        }
        return{tag:t,score:score+match,match,usos:s.usos};
    }).filter(t=>t.score>=0&&t.match>=-1);

    scored.sort((a,b)=>b.score-a.score);

    const MAX_VISIBLE=AppState.ui._tagShowAll?50:5;
    const visible=scored.slice(0,MAX_VISIBLE);
    const hasMore=scored.length>MAX_VISIBLE;
    const exactMatch=valKey&&tags.some(t=>tagKey(t)===valKey);
    const showCreate=valKey&&val.length>=2&&!exactMatch;

    if(!visible.length&&!showCreate&&!aliasCat){cont.innerHTML='';return}

    let h='<div class="tag-sugerencias"><div class="tags-container">';
    const selected=input.value.trim();
    visible.forEach(t=>{
        const isActive=tagKey(selected)===tagKey(t.tag);
        /* v5.6.2 — El número de usos era texto gris pegado al nombre y podía
           leerse como parte de la categoría ("Transporte 77"). Ahora es una
           insignia separada, con su propio fondo, que se lee como lo que es. */
        h+=`<span class="tag-pill${isActive?' tag-active':''}" data-action="usar-tag" data-tag="${escHtml(t.tag)}" data-target="${inputId}" title="${escHtml(t.tag)}: ${t.usos} ${t.usos===1?'uso':'usos'}">${escHtml(t.tag)}${t.usos>0?`<b class="tag-usos">${t.usos}</b>`:''}</span>`;
    });
    if(hasMore)h+=`<span class="tag-pill tag-pill-mas" data-action="tag-ver-mas" data-target="${inputId}">+${scored.length-MAX_VISIBLE} más</span>`;
    /* Alias suggestion: suggest creating the category name */
    if(showCreate&&aliasCat&&!tags.some(t=>tagKey(t)===aliasKey)){
        h+=`<span class="tag-pill tag-pill-idea" data-action="tag-crear" data-tag="${escHtml(aliasCat)}" data-target="${inputId}" title="Sugerencia según lo que escribiste"><svg class="ico ico-tag-idea" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg> ${escHtml(aliasCat)}</span>`;
    }
    if(showCreate)h+=`<span class="tag-pill tag-pill-nueva" data-action="tag-crear" data-tag="${escHtml(val)}" data-target="${inputId}" title="Crear esta categoría">+ ${escHtml(val)}</span>`;
    h+='</div></div>';
    cont.innerHTML=h;
}
function renderizarGestionTags(){
    const periodo=AppState.ui.tagPeriodo||'total';
    const view=AppState.ui.tagView||'dona';
    const pf=$('tagPeriodFilter');
    if(pf){const periodos=[['hoy','Hoy'],['semana','Semana'],['mes','Mes'],['total','Total']];
        pf.innerHTML=periodos.map(([k,l])=>`<button style="padding:4px 10px;font-size:0.7em;border-radius:12px;border:1px solid ${periodo===k?'#2563eb':'#e2e8f0'};background:${periodo===k?'#2563eb':'white'};color:${periodo===k?'white':'#64748b'};cursor:pointer;font-weight:500" data-action="tag-periodo" data-periodo="${k}">${l}</button>`).join('');
    }
    const vt=$('tagViewToggle');
    if(vt){const views=[['dona','<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15.5A9 9 0 118.5 3v9h9a9 9 0 013.5 3.5z"/><path d="M20.9 9.5A9 9 0 0014.5 3.1V9.5h6.4z"/></svg> Dona'],['barras','<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V10M10 19V5M16 19v-6M22 19H2"/></svg> Barras']];
        vt.innerHTML=views.map(([k,l])=>`<button class="gastos-view-btn ${view===k?'active':''}" data-action="tag-view" data-view="${k}">${l}</button>`).join('');
    }

    /* Build period filters: current + previous (for variation) */
    const hoy=getUDateStr(),hoyD=getUDate();
    function periodFilter(p,offset){
        if(p==='hoy'){const d=new Date(hoyD);d.setDate(d.getDate()+offset);const s=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return m=>m.fecha===s}
        if(p==='semana'){const start=new Date(hoyD);start.setDate(start.getDate()-hoyD.getDay()+7*offset);const end=new Date(start);end.setDate(end.getDate()+6);const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const s=fmt(start),e=fmt(end);return m=>m.fecha>=s&&m.fecha<=e}
        if(p==='mes'){const d=new Date(hoyD.getFullYear(),hoyD.getMonth()+offset,1);const s=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;return m=>m.fecha?.startsWith(s)}
        return ()=>true;
    }
    const currFilter=periodFilter(periodo,0);
    const prevFilter=periodo==='total'?null:periodFilter(periodo,-1);

    const movsFiltrados=AppState.datos.movimientos.filter(currFilter);
    const movsPrev=prevFilter?AppState.datos.movimientos.filter(prevFilter):[];

    /* Solo egresos */
    const egresos=movsFiltrados.filter(m=>m.tipoMovimiento==='egreso');
    const egresosPrev=movsPrev.filter(m=>m.tipoMovimiento==='egreso');
    const tasaFallback=AppState.datos.ultimaTasaCompra||1;
    const egresoUYU=m=>movimientoValorUYU(m,tasaFallback);

    const tags=AppState.datos.tags||[],search=($('tagSearch')?.value||'').toLowerCase();
    function buildStats(egresoList){
        return tags.map(t=>{
            const movs=egresoList.filter(m=>m.descripcion&&tagKey(m.descripcion)===tagKey(t));
            const ops=movs.length;
            const egresoTotal=movs.reduce((s,m)=>roundMoney(s+egresoUYU(m)),0);
            const tieneConversion=movs.some(m=>m.tipoCuenta==='usdt'||(m.banco&&getBancoInfo(m.banco)?.moneda==='USD'));
            return{tag:t,ops,egresoTotal,tieneConversion};
        });
    }
    const tagStats=buildStats(egresos).sort((a,b)=>b.egresoTotal-a.egresoTotal);
    const prevStats=prevFilter?buildStats(egresosPrev):[];
    const prevByTag={};prevStats.forEach(t=>{prevByTag[tagKey(t.tag)]=t});

    const totalEgreso=tagStats.reduce((s,t)=>s+t.egresoTotal,0);
    const sinTagMovs=egresos.filter(m=>!m.descripcion||!tags.some(t=>tagKey(t)===tagKey(m.descripcion)));
    const sinTagUYU=sinTagMovs.reduce((s,m)=>roundMoney(s+egresoUYU(m)),0);
    const grandTotal=roundMoney(totalEgreso+sinTagUYU);
    const prevGrandTotal=prevStats.reduce((s,t)=>s+t.egresoTotal,0);

    /* Ganancia del período (UYU) for impact metric */
    const opsPeriodo=AppState.datos.operaciones.filter(op=>op.fecha&&currFilter({fecha:op.fecha})&&op.moneda!=='USD');
    const gananciaPeriodo=opsPeriodo.reduce((s,op)=>roundMoney(s+(op.ganancia||0)),0);
    const impactoPct=gananciaPeriodo>0?Math.round(grandTotal/gananciaPeriodo*100):0;
    const sinTagPct=grandTotal>0?Math.round(sinTagUYU/grandTotal*100):0;

    const ac=$('tagAnalytics');
    if(ac){
        const COLORS=['#3b82f6','#16a34a','#f59e0b','#dc2626','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
        const top=tagStats.filter(t=>t.egresoTotal>0).slice(0,8);
        if(grandTotal>0&&top.length>0){
            let chartHtml='';
            if(view==='dona'){
                let svg='',cum=0;const r=50,cx=60,cy=60,stroke=18,circ=2*Math.PI*r;
                top.forEach((t,i)=>{
                    const pct=t.egresoTotal/grandTotal;const dash=pct*circ;const gap=circ-dash;const offset=-cum*circ+circ*0.25;
                    svg+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLORS[i%COLORS.length]}" stroke-width="${stroke}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${offset}" />`;
                    cum+=pct;
                });
                if(sinTagUYU>0){const pct=sinTagUYU/grandTotal;const dash=pct*circ;const gap=circ-dash;const offset=-cum*circ+circ*0.25;
                    svg+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="${stroke}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${offset}" />`;}
                svg=`<svg viewBox="0 0 120 120" style="width:110px;height:110px"><text x="${cx}" y="${cy-4}" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">$${fmtNum(grandTotal,0)}</text><text x="${cx}" y="${cy+10}" text-anchor="middle" fill="#94a3b8" font-size="7">egresos UYU</text>${svg}</svg>`;
                let legend=top.map((t,i)=>{
                    const pct=grandTotal?Math.round(t.egresoTotal/grandTotal*100):0;
                    return`<div style="display:flex;align-items:center;gap:5px;font-size:0.7em"><span style="width:8px;height:8px;border-radius:50%;background:${COLORS[i%COLORS.length]};flex-shrink:0"></span><span style="color:#1e293b;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.tag)}</span><span style="color:#64748b;white-space:nowrap">$${fmtNum(t.egresoTotal,0)} · ${pct}%</span></div>`;
                }).join('');
                if(sinTagUYU>0)legend+=`<div style="display:flex;align-items:center;gap:5px;font-size:0.7em"><span style="width:8px;height:8px;border-radius:50%;background:#e2e8f0;flex-shrink:0"></span><span style="color:#94a3b8;flex:1">Sin tag</span><span style="color:#64748b">$${fmtNum(sinTagUYU,0)} · ${sinTagPct}%</span></div>`;
                chartHtml=`<div style="display:flex;gap:14px;align-items:center;padding:10px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0"><div style="flex-shrink:0">${svg}</div><div style="flex:1;display:flex;flex-direction:column;gap:3px">${legend}</div></div>`;
            }else{
                /* Bars view: ranking horizontal */
                const maxV=top[0].egresoTotal;
                let bars=top.map((t,i)=>{
                    const pct=maxV?Math.round(t.egresoTotal/maxV*100):0;
                    return`<div class="gastos-bar-row"><span class="label">${escHtml(t.tag)}</span><div class="track"><div class="fill" style="width:${pct}%;background:${COLORS[i%COLORS.length]}"></div></div><span class="amount">$${fmtNum(t.egresoTotal,0)}</span></div>`;
                }).join('');
                if(sinTagUYU>0){const pct=maxV?Math.round(sinTagUYU/maxV*100):0;bars+=`<div class="gastos-bar-row"><span class="label" style="color:#94a3b8">Sin tag</span><div class="track"><div class="fill" style="width:${pct}%;background:#cbd5e1"></div></div><span class="amount" style="color:#94a3b8">$${fmtNum(sinTagUYU,0)}</span></div>`}
                chartHtml=`<div class="gastos-bars-container"><div style="font-size:0.8em;font-weight:700;color:#1e293b;margin-bottom:4px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Total: $${fmtNum(grandTotal,0)}</div>${bars}</div>`;
            }

            /* Meta chips: impact + sin tag warning + period variation */
            let metaChips='';
            if(impactoPct>0)metaChips+=`<span class="gastos-meta-chip impact"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l6 6 4-4 7 7M14 16h7v-7"/></svg> ${impactoPct}% de la ganancia</span>`;
            if(sinTagUYU>0&&sinTagPct>=10)metaChips+=`<span class="gastos-meta-chip warning"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z"/></svg> ${sinTagPct}% sin clasificar</span>`;
            if(prevFilter&&prevGrandTotal>0){
                const diff=roundMoney(grandTotal-prevGrandTotal);
                const pct=Math.abs(Math.round(diff/prevGrandTotal*100));
                const cls=diff>0?'warning':(diff<0?'gastos-meta-chip" style="background:#dcfce7;color:#15803d':'');
                const arrow=diff>0?'↑':(diff<0?'↓':'→');
                const sign=diff>=0?'+':'-';
                metaChips+=`<span class="gastos-meta-chip ${diff>0?'warning':''}" ${diff<0?'style="background:#dcfce7;color:#15803d"':''}>${arrow} ${sign}$${fmtNum(Math.abs(diff),0)} (${pct}%) vs período anterior</span>`;
            }

            /* Insights */
            const topEg=top[0];
            const topOps=tagStats.filter(t=>t.ops>0).sort((a,b)=>b.ops-a.ops)[0];
            let topGrowth=null,maxGrowthPct=0;
            if(prevFilter){
                top.forEach(t=>{
                    const prev=prevByTag[tagKey(t.tag)];
                    if(prev&&prev.egresoTotal>0){
                        const pct=Math.round((t.egresoTotal-prev.egresoTotal)/prev.egresoTotal*100);
                        if(pct>maxGrowthPct){maxGrowthPct=pct;topGrowth={tag:t.tag,pct,diff:roundMoney(t.egresoTotal-prev.egresoTotal)}}
                    }
                });
            }
            let insights=`<span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h20v10H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 10h.01M18 14h.01"/></svg> Mayor: <b>${escHtml(topEg.tag)}</b> ($${fmtNum(topEg.egresoTotal,0)})</span>`;
            if(topOps&&topOps.tag!==topEg.tag)insights+=`<span style="margin-left:10px"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5"/></svg> Más frec: <b>${escHtml(topOps.tag)}</b> (${topOps.ops})</span>`;
            if(topGrowth&&topGrowth.pct>=20)insights+=`<span style="margin-left:10px"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 7-7M14 8h7v7"/></svg> Mayor crecimiento: <b>${escHtml(topGrowth.tag)}</b> (+${topGrowth.pct}%)</span>`;
            const hayConv=top.some(t=>t.tieneConversion);

            ac.innerHTML=chartHtml
                +(metaChips?`<div class="gastos-header-meta">${metaChips}</div>`:'')
                +`<div style="margin-top:8px;font-size:0.68em;color:#64748b;display:flex;flex-wrap:wrap;gap:4px">${insights}</div>`
                +(hayConv?'<div style="margin-top:4px;font-size:0.6em;color:#94a3b8;font-style:italic">* Valores USDT/USD convertidos a UYU con precio FIFO</div>':'');
        }else{
            ac.innerHTML='<div style="text-align:center;padding:12px;color:#94a3b8;font-size:0.8em">Sin egresos en este período</div>';
        }
    }

    const cont=$('tagsList');if(!cont)return;
    const searchKey=stripAccents(search);
    const filtrados=searchKey?tagStats.filter(t=>stripAccents(t.tag.toLowerCase()).includes(searchKey)):tagStats;
    if(!filtrados.length){cont.innerHTML=`<div style="text-align:center;padding:20px;color:#94a3b8"><div style="font-size:1.8em;margin-bottom:6px"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4L12 22l-9-9V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01"/></svg></div><div>${search?'Sin resultados':'Sin categorías aún'}</div></div>`;return}
    let h='';
    filtrados.forEach(t=>{
        const pct=grandTotal?Math.round(t.egresoTotal/grandTotal*100):0;
        const ticketTxt=t.ops>0?`Ticket: $${fmtNum(roundMoney(t.egresoTotal/t.ops),0)}`:'';
        const convMark=t.tieneConversion?' *':'';
        const metaParts=[t.ops+' egreso'+(t.ops!==1?'s':'')];
        if(t.egresoTotal>0)metaParts.push('$'+fmtNum(t.egresoTotal,0)+' UYU'+convMark);
        if(ticketTxt)metaParts.push(ticketTxt);

        /* Variation chip vs previous period */
        let varChip='';
        if(prevFilter&&t.egresoTotal>0){
            const prev=prevByTag[tagKey(t.tag)];
            if(prev&&prev.egresoTotal>0){
                const diff=roundMoney(t.egresoTotal-prev.egresoTotal);
                const vpct=Math.abs(Math.round(diff/prev.egresoTotal*100));
                if(diff>0)varChip=`<span class="var-chip up">↑ ${vpct}%</span>`;
                else if(diff<0)varChip=`<span class="var-chip down">↓ ${vpct}%</span>`;
                else varChip=`<span class="var-chip flat">→</span>`;
            }else if(!prev||prev.egresoTotal===0){
                varChip=`<span class="var-chip new">nuevo</span>`;
            }
        }

        h+=`<div class="tag-manage-item">
            <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="tag-name">${escHtml(t.tag)}</span>${pct>0?`<span style="font-size:0.6em;background:#fef2f2;color:#dc2626;padding:1px 5px;border-radius:8px">${pct}%</span>`:''}${varChip}</div>
                <div style="font-size:0.65em;color:#94a3b8;margin-top:2px">${metaParts.join(' · ')}</div>
            </div>
            <div class="tag-actions"><button class="tag-edit-btn" data-action="merge-tag" data-tag="${escHtml(t.tag)}" title="Fusionar categoría" aria-label="Fusionar"><svg class="ico ico-accion" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/></svg></button><button class="tag-edit-btn" data-action="editar-tag" data-tag="${escHtml(t.tag)}" title="Editar nombre" aria-label="Editar"><svg class="ico ico-accion" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button><button class="tag-delete-btn" data-action="eliminar-tag" data-tag="${escHtml(t.tag)}" title="Eliminar categoría" aria-label="Eliminar"><svg class="ico ico-accion" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/></svg></button></div>
        </div>`;
    });
    cont.innerHTML=h;
}
function agregarTasaReciente(valor,tipo,moneda){
    const arr=AppState.datos.tasasRecientes;
    /* Eliminar duplicado exacto (mismo valor+tipo+moneda) */
    const idx=arr.findIndex(t=>t.valor===valor&&t.tipo===tipo&&t.moneda===moneda);
    if(idx!==-1)arr.splice(idx,1);
    arr.unshift({valor,tipo,moneda});
    /* Mantener máx 5 por combo tipo+moneda, máx 30 total */
    const count={};AppState.datos.tasasRecientes=arr.filter(t=>{const k=t.tipo+'_'+t.moneda;count[k]=(count[k]||0)+1;return count[k]<=5}).slice(0,30);
}
function renderizarTasasRecientes(){
    const cont=$('tasaTagsContainer');if(!cont)return;
    const tipo=$('tipo').value,mon=getMonedaBanco();
    const recientes=(AppState.datos.tasasRecientes||[]).filter(t=>t.tipo===tipo&&t.moneda===mon).slice(0,5);
    if(!recientes.length){cont.innerHTML='';return}
    /* v4.7.62 — marcar como "activa" la pill cuyo valor coincide con el input
       actual de tasa, NO la primera por posición. Antes el CSS usaba :first-child
       y esa pill siempre se veía azul aunque el usuario tocara otra. Ahora la
       pill activa es la que refleja el valor real del input. */
    const tasaActualNum=parsearTasa($('tasa').value);
    const epsilon=mon==='USD'?0.0005:0.005;
    /* v5.6.0 — Son las cinco tasas más recientes, pero no había forma de saber
       cuál usaste último: se marca la primera, que es la más nueva. */
    cont.innerHTML=recientes.map((t,idx)=>{
        /* v4.8.2: parsearTasa devuelve null para input vacío/inválido, e isFinite(null)
           es true (coerciona a 0) — comparaba contra 0 en vez de "sin tasa". */
        const isActive=tasaActualNum!==null&&Math.abs(t.valor-tasaActualNum)<epsilon;
        const cls='tag-pill'+(isActive?' tag-pill-active':'')+(idx===0?' tag-pill-ultima':'');
        const tit=idx===0?' title="La última tasa que usaste"':'';
        return `<span class="${cls}"${tit} data-action="usar-tasa" data-valor="${t.valor}" style="font-size:0.72em;padding:3px 9px;flex-shrink:0">${fmtTasa(t.valor,mon)}</span>`;
    }).join('');
}

function getLotesActivosFIFO(){return AppState.datos.lotes.filter(l=>l.disponible>0).sort((a,b)=>(a.fecha+(a.hora||'00:00')).localeCompare(b.fecha+(b.hora||'00:00')))}

/* ═══ Swipe gestures for cards (mobile) ═══ */