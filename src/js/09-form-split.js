function inicializarFirebase(){
    if(typeof firebase==='undefined'){ocultarLoading();return}
    try{
        firebase.initializeApp(CONFIG.firebase);AppState.auth=firebase.auth();AppState.db=firebase.firestore();
        /* v4.9.3 — Redes/proxies que rompen el WebChannel de Firestore dejan al
           SDK colgado (writes que nunca resuelven, snapshot que nunca llega,
           "Modo local activo" eterno). Con auto-detección, el SDK degrada solo
           a long-polling. Debe llamarse ANTES de cualquier otra operación. */
        try{AppState.db.settings({experimentalAutoDetectLongPolling:true,merge:true})}
        catch(e){console.warn('[P2P] settings long-polling:',e&&e.message||e)}
        /* ═══ Persistence init serializado ═══
           Bug conocido del SDK Firestore (issue #6256, "INTERNAL ASSERTION FAILED: Unexpected
           state"): si onSnapshot se dispara antes que enablePersistence resuelva, Firestore 
           queda en estado inconsistente. Especialmente común en Samsung Browser/Android.
           
           Antes: enablePersistence().catch(...) sin await → race condition con cargarDatosUsuario.
           Ahora: gateamos toda la inicialización de auth detrás de enablePersistence. 
           Si falla unimplemented (browsers viejos), seguimos igual sin persistence. */
        const initAuth=()=>{
            inicializarConectividad();
            AppState.auth.onAuthStateChanged(u=>u?showApp(u):showAuth());
        };
        AppState.db.enablePersistence({synchronizeTabs:true}).then(()=>{
            AppState._persistenceReady=true;
            initAuth();
        }).catch(e=>{
            /* unimplemented = browser viejo (sin IndexedDB). Seguimos sin persistence. */
            if(e.code==='unimplemented')console.warn('[P2P] Persistence no soportada en este navegador');
            /* failed-precondition = ya hay otra tab con persistence. Sigue funcionando, solo single-tab. */
            else if(e.code==='failed-precondition')console.warn('[P2P] Persistence single-tab (otra pestaña abierta)');
            else console.warn('[P2P] enablePersistence error:',e.code||e.message);
            AppState._persistenceReady=true;
            initAuth();
        });
    }catch(e){console.error('[P2P] Firebase init error:',e);setSyncStatus('offline','Error init');ocultarLoading()}
}

/* ═══════════════════════════════════════
   §9 — FORMULARIO OPERACIÓN
   ═══════════════════════════════════════ */
function actualizarColorSelect(){
    const v=$('tipo').value,isC=v==='compra';
    $('opToggleCompra').className='op-toggle-btn'+(isC?' active-compra':'');
    $('opToggleVenta').className='op-toggle-btn'+(isC?'':' active-venta');
    const btn=$('btnAgregarOp');
    btn.innerHTML=_btnOpHtml(isC,isC?'Comprar USDT':'Vender USDT');
    btn.className='btn '+(isC?'op-btn-compra':'op-btn-venta');
}
function actualizarColorBancoSelect(){const s=$('banco'),v=s.value;s.style.color=v?getBancoColor(v):'#1e293b';s.style.fontWeight=v?'600':'400'}

function actualizarFormulario(){
    const t=$('tipo').value,mon=getMonedaBanco(),isU=mon==='USD';
    const prevMon=AppState.ui.ultimoMonedaBanco;
    const monedaCambiada=prevMon!==null&&prevMon!==mon;
    AppState.ui.ultimoMonedaBanco=mon;
    const sy=isU?'USD':'UYU';
    setText('montoLabel',t==='compra'?`Comprás por (${sy})`:`Vendés por (${sy})`);
    /* v5.4.3 — La cuenta es obligatoria pero se veía igual que un campo opcional,
       y recién al tocar el botón aparecía el aviso. Ahora el rótulo lo marca y el
       campo queda en estado "pendiente" mientras esté sin elegir. */
    const _lbl=$('bancoLabel');
    if(_lbl)_lbl.innerHTML=(t==='compra'?'Sale de':'Entra a')+' <span class="oblig" title="Campo obligatorio">*</span>';
    _marcarBancoPendiente();
    $('comisionBancoGroup').style.display=t==='compra'?'block':'none';
    $('comisionBancoGroup').parentElement.style.gridTemplateColumns=t==='compra'?'1fr 1fr':'1fr';
    if(t==='venta')$('comisionBanco').value='0';
    const ti=$('tasa');
    if(document.activeElement!==ti&&(!AppState.ui.tasaManual||monedaCambiada)){
        const ta=t==='compra'?(isU?AppState.datos.ultimaTasaCompraUSD:AppState.datos.ultimaTasaCompra):(isU?AppState.datos.ultimaTasaVentaUSD:AppState.datos.ultimaTasaVenta);
        ti.value=ta>0?fmtTasa(ta,mon):'';
        if(monedaCambiada)AppState.ui.tasaManual=false;
    }
    setText('tasaHelp','');$('tasaHelp').style.display='none';
    const ci=$('comisionPlataforma');if(document.activeElement!==ci){const cv=isU?AppState.datos.comisionUSD:AppState.datos.comisionPlataforma;ci.value=fmtNum(cv);setText('comisionPctLabel',fmtNum(cv))}
    calcularPreview();renderizarTasasRecientes();
}

function calcularPreview(){
    const t=$('tipo').value,m=pv('monto'),ta=parsearTasa($('tasa').value),cp=getComisionDec(),mon=getMonedaBanco(),isU=mon==='USD';
    $('tasa').classList.remove('error');const th=$('tasaHelp');th.className='';th.textContent='';th.style.display='none';
    const sum=$('opSummary'),btn=$('btnAgregarOp');
    const isC=t==='compra',sy=isU?'US$':'$';

    if(m>0&&ta){
        /* UYU-centric: monto is fiat, compute USDT */
        const u=usdtBase(m/ta,t),c=truncar(u*cp,2);
        const neto=usdtNeto(u,c,t);
        /* v5.6.2 — El monto de comisión y el saldo del banco salieron de esta
           barra: el primero está en el resultado en vivo y el segundo en el
           resumen de abajo. Acá queda solo el control para editar el porcentaje. */

        sum.style.display='block';
        sum.className='op-summary '+(isC?'modo-compra':'modo-venta');

        if(isC){
            /* COMPRA: total=base, liberada=neto (lo que recibís) */
            /* v5.6.2 — Las filas de cantidad y comisión se retiraron del resumen:
               ya están en el resultado en vivo, arriba del formulario. */
        }

        /* Bank saldo impact */
        const b=$('banco').value,cb=roundMoney(pv('comisionBanco'));
        if(b&&AppState.datos.bancos[b]){
            const sActual=AppState.datos.bancos[b].saldo,bsy=getSym(getBancoInfo(b)?.moneda);
            const sDesp=isC?fixNeg(sActual-(m+cb)):fixNeg(sActual+m);
            setText('opSumBancoLabel',b);
            $('opSumBancoValue').innerHTML=`${bsy}${fmtNum(sActual)} → <b style="color:${sDesp>=sActual?'#16a34a':'#dc2626'}">${bsy}${fmtNum(sDesp)}</b>`;
        }else{setText('opSumBancoLabel','Saldo');setText('opSumBancoValue','--')}

        /* v5.6.0 — Eco del resultado, debajo del monto */
        _pintarEco(isC,neto,c);

        /* Dynamic button */
        btn.innerHTML=_btnOpHtml(isC,(isC?'Comprar ':'Vender ')+fmtTrunc(neto,2)+' USDT');

        $('previewBox').style.display='none';
    }else{
        sum.style.display='none';$('previewBox').style.display='none';
        btn.innerHTML=_btnOpHtml(isC,isC?'Comprar USDT':'Vender USDT');
        _pintarEco(isC,0,0);
    }
}

/* ═══ v5.6.0 — Resultado en vivo bajo el monto ═══
   En una compra lo que importa es cuántos USDT entran; en una venta, cuántos
   salen. Antes ese dato estaba al final del formulario, después de la tasa, la
   cuenta y las comisiones, así que había que terminar de cargar todo para
   verlo. Acá se actualiza con cada tecla. */
function _pintarEco(esCompra,neto,comision){
    const caja=$('ecoResultado');if(!caja)return;
    if(!(neto>0)){caja.classList.add('oculto');return}
    caja.classList.remove('oculto');
    caja.classList.toggle('venta',!esCompra);
    const lbl=$('ecoLabel');
    if(lbl)lbl.firstChild.nodeValue=esCompra?'Recibís':'Entregás';
    setText('ecoSub',comision>0?('comisión '+fmtTrunc(comision,2)+' USDT incluida'):'sin comisión');
    setText('ecoValor',fmtTrunc(neto,2)+' USDT');
}

function guardarComisionYCalcular(){
    const inp=$('comisionPlataforma'),raw=inp.value.replace(',','.').trim();
    /* Si el valor es vacío o transitorio ("0." mientras el usuario escribe) no persistir 
       pero tampoco marcar como error — dejar al usuario terminar de tipear */
    if(raw===''||raw==='.'||raw.endsWith('.')){
        inp.classList.remove('error');
        calcularPreview();
        return;
    }
    const v=parsearComisionPct(raw);
    if(v===null){
        /* Valor inválido (negativo, >10%, formato roto) → marcar visualmente pero no bloquear tipeo */
        inp.classList.add('error');
        return;
    }
    inp.classList.remove('error');
    if(getMonedaBanco()==='USD')AppState.datos.comisionUSD=v;else AppState.datos.comisionPlataforma=v;
    setText('comisionPctLabel',fmtNum(v));
    clearTimeout(AppState.ui.comisionDebounce);
    AppState.ui.comisionDebounce=setTimeout(()=>guardaOptimista('update','settings','comision'),1200);
    calcularPreview();
}

/* ═══════════════════════════════════════
   §X — SPLIT PAGO (compra con múltiples cuentas)
   ═══════════════════════════════════════ */
/* AppState.ui.splitExtras: [{banco, monto}] — cuentas adicionales más allá del banco principal */
/* Tolerancia única para comparaciones de faltante: medio centésimo.
   Por debajo de esto se considera "completo" (ruido de redondeo). */
const SPLIT_EPSILON=0.005;
function _initSplitState(){
    if(!AppState.ui.splitExtras)AppState.ui.splitExtras=[];
}
function _splitDisponible(bancoNombre,excluirBanco){
    const bk=AppState.datos.bancos[bancoNombre];
    if(!bk)return 0;
    return Math.max(0,bk.saldo);
}
/* ═══ Fuente única de verdad para el estado del split ═══
   Devuelve null si el contexto no aplica (no compra, sin banco, etc.).
   Todos los renders + validación usan este mismo objeto. Garantiza que
   el botón, el resumen, el monto y la persistencia coincidan al centésimo. */
function _computeSplitState(){
    if($('tipo').value!=='compra')return null;
    const bancoPrinc=$('banco').value;if(!bancoPrinc)return null;
    const bk=AppState.datos.bancos[bancoPrinc];if(!bk)return null;
    const monto=pv('monto'),comisionBanco=roundMoney(pv('comisionBanco'));
    if(!monto||monto<=0)return null;
    const totalNecesario=roundMoney(monto+comisionBanco);
    const saldoPrinc=roundMoney(bk.saldo);
    /* Si el principal cubre todo, no hay split */
    if(saldoPrinc>=totalNecesario-SPLIT_EPSILON){
        return{aplicaSplit:false,totalNecesario,saldoPrinc,bancoPrinc,bk};
    }
    /* v4.8.3 FIX — El banco principal ahora aporta el REMANENTE (total − extras),
       capado a su saldo. Antes: aporte1 = min(saldoPrinc, total), es decir el
       principal quedaba SIEMPRE fijo en su saldo completo y los extras se sumaban
       ENCIMA → cargar un monto redondo en una cuenta extra (ej. Itaú 8.000 cuando
       el faltante real era 2.574,98) daba "Exceso" y era imposible balancear.
       Ahora, al tipear en las cuentas extra, el principal se reduce solo y el total
       cuadra exacto. Orden importa: primero sumo extras, luego calculo el principal. */
    _initSplitState();
    let aportadoExtra=0;
    AppState.ui.splitExtras.forEach(e=>{
        const m=roundMoney(e.monto||0);
        if(m>0)aportadoExtra=roundMoney(aportadoExtra+m);
    });
    const remanentePrinc=roundMoney(totalNecesario-aportadoExtra);
    const aporte1=roundMoney(Math.max(0,Math.min(saldoPrinc,remanentePrinc)));
    /* Déficit estructural del principal (cuánto NO puede cubrir por sí solo).
       Constante respecto de los extras — se usa para el título del panel. */
    const deficitPrincipal=roundMoney(Math.max(0,totalNecesario-saldoPrinc));
    const totalAportado=roundMoney(aporte1+aportadoExtra);
    const faltante=roundMoney(totalNecesario-totalAportado);
    /* Estado normalizado */
    const cubierto=Math.abs(faltante)<SPLIT_EPSILON;
    const exceso=faltante<-SPLIT_EPSILON;
    return{
        aplicaSplit:true,
        bancoPrinc,bk,
        monto,comisionBanco,totalNecesario,
        saldoPrinc,aporte1,aportadoExtra,totalAportado,
        deficitPrincipal,
        faltante,
        cubierto,
        exceso,
        falta:!cubierto&&!exceso
    };
}
/* Formato monetario inteligente: si el monto tiene centésimos significativos,
   muestra 2 decimales; si es entero, muestra 0 decimales. Evita "Faltan $0"
   cuando en realidad faltan $0,47. */
/* v5.3.1 — Antes se llamaba fmtMonto, el mismo nombre que la función central de
   §04. Como todos los archivos comparten el ámbito global y éste carga después,
   la de acá tapaba a la otra: cualquier importe formateado con la central habría
   perdido su símbolo de moneda. Renombrada porque es exclusiva de este panel:
   redondea a entero cuando no hay centésimos significativos, para que el usuario
   vea "$8.000" en vez de "$8.000,00" mientras reparte el pago. */
function _splitMonto(n){
    const abs=Math.abs(n);
    if(abs<SPLIT_EPSILON)return fmtNum(0,0);
    /* Si el redondeo a entero coincide exactamente con el valor → mostrar entero */
    const entero=Math.round(n);
    if(Math.abs(n-entero)<SPLIT_EPSILON)return fmtNum(entero,0);
    /* Hay centésimos significativos → 2 decimales */
    return fmtNum(n,2);
}
function renderSplitPanel(){
    _initSplitState();
    const panel=$('splitPanel');if(!panel)return;
    const state=_computeSplitState();
    /* No aplica split (otro tipo, sin banco, monto inválido, o saldo cubre todo) */
    if(!state||!state.aplicaSplit){
        panel.style.display='none';
        if($('tipo').value!=='compra'||(state&&state.aplicaSplit===false))AppState.ui.splitExtras=[];
        /* v4.7.59 — CRÍTICO: si el split ya no aplica, hay que re-evaluar el
           estado del botón. Si quedó bloqueado por una fila inválida anterior
           (y ahora el saldo cubre el total o cambió el tipo), debe desbloquearse. */
        if(typeof _updateBtnGuardarState==='function')_updateBtnGuardarState();
        return;
    }
    const{bancoPrinc,totalNecesario,aporte1,totalAportado,faltante,cubierto,exceso,deficitPrincipal}=state;
    /* Opciones para banco adicional: activos, distintos del principal y de otros ya elegidos */
    const usados=new Set([bancoPrinc]);AppState.ui.splitExtras.forEach(e=>{if(e.banco)usados.add(e.banco)});
    const disponibles=getBancosActivos().filter(b=>!usados.has(b.nombre));
    const sy=getSym(getBancoInfo(bancoPrinc)?.moneda||'UYU');
    /* v4.8.3: el título muestra el déficit del principal (cuánto le falta al banco
       elegido para cubrir solo), constante. Antes usaba total−aporte1, que con el
       fix del remanente se vuelve dinámico y mostraba "faltan $X" = lo ya aportado
       por extras — confuso. */
    const faltanteInicial=deficitPrincipal;
    let h=`<div class="split-panel-title">⚠️ Saldo insuficiente · faltan ${sy}${_splitMonto(faltanteInicial)}</div>
        <div style="font-size:0.7em;color:#78350f;margin-bottom:10px;line-height:1.4">Completá el pago con una o más cuentas adicionales hasta cubrir el total.</div>
        <div class="split-row aporte">
            <div class="split-row-label"><span style="color:${getBancoColor(bancoPrinc)}">●</span> <b>${escHtml(bancoPrinc)}</b> aporta</div>
            <div class="split-row-monto">${sy}${_splitMonto(aporte1)}</div>
        </div>`;
    /* Render cuentas adicionales */
    AppState.ui.splitExtras.forEach((ex,idx)=>{
        const selOpts='<option value="">Seleccionar…</option>'+disponibles.concat(ex.banco&&AppState.datos.bancos[ex.banco]?[{nombre:ex.banco,color:getBancoColor(ex.banco)}]:[]).map(b=>`<option value="${b.nombre}" style="color:${b.color||'#1e293b'};font-weight:600"${ex.banco===b.nombre?' selected':''}>${b.nombre}</option>`).join('');
        const disp=ex.banco?_splitDisponible(ex.banco):0;
        /* v4.7.59 — feedback visual claro cuando la fila está sin banco.
           Sin esto el usuario veía "botón gris" pero no sabía dónde estaba
           el problema. Crítico para alguien que opera rápido (40 ops/día). */
        const filaInvalida=!ex.banco;
        const rowCls=filaInvalida?'split-extra-row split-extra-row-invalid':'split-extra-row';
        h+=`<div class="${rowCls}">
            <select data-action="split-set-banco" data-idx="${idx}" aria-invalid="${filaInvalida?'true':'false'}">${selOpts}</select>
            <input type="text" inputmode="decimal" data-action="split-set-monto" data-idx="${idx}" value="${ex.monto?_splitMonto(ex.monto):''}" placeholder="${sy}0" />
            <button type="button" class="split-remove" data-action="split-remove" data-idx="${idx}" aria-label="Quitar">✕</button>
        </div>`;
        if(filaInvalida){
            h+=`<div class="split-row-hint-err">⚠ Falta seleccionar un banco para esta fila</div>`;
        }else if(ex.banco&&disp<(ex.monto||0)-SPLIT_EPSILON){
            h+=`<div style="font-size:0.68em;color:#b91c1c;margin:-2px 4px 6px">⚠ ${escHtml(ex.banco)} solo tiene ${sy}${_splitMonto(disp)}</div>`;
        }
    });
    /* Botón agregar cuenta — solo si hay faltante real (>= EPSILON) */
    if(faltante>=SPLIT_EPSILON&&disponibles.length>0){
        h+=`<button type="button" class="split-add-btn" data-action="split-add">＋ Agregar cuenta para cubrir ${sy}${_splitMonto(faltante)}</button>`;
    }
    /* v4.7.59 — antes de pintar status verde, verificar que no haya filas con
       banco vacío. Si las hay, el split NO está realmente cubierto aunque la
       suma matemática dé el total — falta info crítica para guardar. */
    const hayBancoVacio=AppState.ui.splitExtras.some(ex=>!ex.banco);
    /* Status — usa estado normalizado, sin re-comparar con 0 */
    if(cubierto&&!hayBancoVacio){
        h+=`<div class="split-status ok">✓ Total cubierto · ${sy}${_splitMonto(totalAportado)}</div>`;
    }else if(exceso){
        h+=`<div class="split-status error">Exceso de ${sy}${_splitMonto(Math.abs(faltante))} · ajustá los aportes</div>`;
    }else if(hayBancoVacio){
        h+=`<div class="split-status error">Seleccioná un banco en cada fila de pago</div>`;
    }else{
        h+=`<div class="split-status error">Falta ${sy}${_splitMonto(faltante)} · aportado ${sy}${_splitMonto(totalAportado)} de ${sy}${_splitMonto(totalNecesario)}</div>`;
    }
    panel.innerHTML=h;panel.style.display='block';
    /* v4.7.59 — refrescar estado del botón principal en cada render */
    if(typeof _updateBtnGuardarState==='function')_updateBtnGuardarState();
}
/* ════════════════════════════════════════════════════════════════
   §SPLIT-BTN-STATE v4.7.59 — Doble red contra el bug de banco vacío
   ════════════════════════════════════════════════════════════════
   Mantiene el botón "Comprar/Vender USDT" deshabilitado visualmente
   cuando hay una fila de split sin banco seleccionado. La validación
   defensiva en agregarOperacion() es la SEGUNDA red — esta es la
   primera (UI). Se llama desde renderSplitPanel + cambios de inputs.

   Idempotente: si no aplica split o todo está OK, restaura el estado
   normal del botón. No interfiere con otros estados (cooldown, etc).
   ════════════════════════════════════════════════════════════════ */
/* v5.4.3 — El texto del botón principal se escribía con textContent, así que
   pisaba el ícono puesto en el HTML y el emoji volvía a aparecer. Ahora el ícono
   viaja acá. El contenido es fijo salvo una cifra ya formateada, así que armarlo
   como HTML es seguro. */
const _ICO_COMPRA='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M12 16V3M7 11l5 5 5-5"/></svg>';
const _ICO_VENTA ='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M12 3v13M7 8l5-5 5 5"/></svg>';
function _btnOpHtml(isC,texto){return (isC?_ICO_COMPRA:_ICO_VENTA)+' '+texto}

/* Estado visual del campo de cuenta: pendiente mientras no se eligió */
function _marcarBancoPendiente(){
    const sel=$('banco');if(!sel)return;
    sel.classList.toggle('pendiente',!sel.value);
}

function _updateBtnGuardarState(){
    const btn=$('btnAgregarOp');if(!btn)return;
    /* Marker propio para no pisar otros disabled (cooldown, guardando) */
    const wasOurs=btn.dataset.splitInvalid==='1';
    let blockNow=false,reason='';
    try{
        if($('tipo').value==='compra' && splitActivo()){
            const hayVacio=(AppState.ui.splitExtras||[]).some(ex=>!ex.banco);
            if(hayVacio){blockNow=true;reason='Seleccioná un banco en cada fila'}
        }
        /* v5.5.0 — La cuenta es obligatoria pero el botón se veía listo igual, y
           el aviso llegaba recién al tocarlo. Ahora el botón dice qué falta antes
           de que lo intentes. Se usa el mismo marcador que el pago dividido, así
           que no pisa los bloqueos por guardado en curso ni por espera. */
        if(!blockNow && !$('banco').value){
            blockNow=true;
            reason=$('tipo').value==='compra'?'Elegí de qué cuenta sale':'Elegí a qué cuenta entra';
        }
    }catch(e){/* defensivo */}
    if(blockNow){
        btn.disabled=true;
        btn.dataset.splitInvalid='1';
        btn.classList.add('btn-split-invalid');
        btn.setAttribute('title',reason);
        /* El motivo va en el propio botón: es donde está mirando el usuario */
        btn.textContent=reason;
    }else if(wasOurs){
        /* Solo restauro si el disabled fue puesto por NOSOTROS — no toco si
           es por cooldown/guardando que tienen su propio ciclo de vida */
        btn.disabled=false;
        delete btn.dataset.splitInvalid;
        btn.classList.remove('btn-split-invalid');
        btn.removeAttribute('title');
        /* Devolver la etiqueta real (con el ícono y la cantidad calculada) */
        if(typeof calcularPreview==='function')calcularPreview();
    }
}

/* Determinar si hay split activo y válido */
function splitActivo(){
    /* GUARD: split pago solo aplica a COMPRAS — en ventas el usuario recibe UYU,
       no paga, por lo que no hay validación de saldo que justifique split. */
    if($('tipo').value!=='compra')return false;
    if(!AppState.ui.splitExtras||AppState.ui.splitExtras.length===0)return false;
    const state=_computeSplitState();
    return!!(state&&state.aplicaSplit);
}
/* Devuelve array de aportes [{banco,monto}] si split activo, null si no */
function getAportes(){
    if(!splitActivo())return null;
    const state=_computeSplitState();
    if(!state||!state.aplicaSplit)return null;
    /* v4.8.3: con el aporte del principal ahora dinámico (remanente), puede quedar
       en 0 si las cuentas extra cubren el total exacto. En ese caso NO lo agregamos:
       evita persistir un aporte de $0 y un débito nulo al banco principal. */
    const aportes=state.aporte1>SPLIT_EPSILON?[{banco:state.bancoPrinc,monto:state.aporte1}]:[];
    /* v4.7.59 — flags de invalidez. Antes este loop ignoraba silenciosamente
       las filas con banco vacío, devolviendo "aportes parciales" que parecían
       válidos. Ahora reportamos cada anomalía para que validarAportes y la
       UI puedan reaccionar (botón deshabilitado, status no verde, etc). */
    let hasEmptyBank=false;
    AppState.ui.splitExtras.forEach(ex=>{
        const m=roundMoney(ex.monto||0);
        if(!ex.banco){
            /* Banco no seleccionado. Si además tiene monto, es bug crítico:
               la fila aporta a "ningún banco". Si NO tiene monto, sigue siendo
               una fila incompleta que el usuario debe completar o quitar. */
            if(m>0||AppState.ui.splitExtras.length>0)hasEmptyBank=true;
            return;
        }
        if(m>0)aportes.push({banco:ex.banco,monto:m});
    });
    /* Devuelvo array con flag adjunto para no romper consumidores existentes */
    aportes._hasEmptyBank=hasEmptyBank;
    return aportes;
}
function _updateSplitStatus(){
    /* Re-render parcial del status sin tocar inputs (preserva foco) */
    const panel=$('splitPanel');if(!panel||panel.style.display==='none')return;
    const statusEl=panel.querySelector('.split-status');if(!statusEl)return;
    const state=_computeSplitState();if(!state||!state.aplicaSplit)return;
    const{bancoPrinc,totalNecesario,totalAportado,faltante,cubierto,exceso}=state;
    const sy=getSym(getBancoInfo(bancoPrinc)?.moneda||'UYU');
    /* v4.7.59 — mismo chequeo que renderSplitPanel: no marcar verde si hay
       filas con banco vacío. Sin esto, el usuario tipea un monto y se ve
       "cubierto" antes de elegir el banco — falsa sensación de operación válida. */
    const hayBancoVacio=(AppState.ui.splitExtras||[]).some(ex=>!ex.banco);
    if(cubierto&&!hayBancoVacio){
        statusEl.className='split-status ok';
        statusEl.textContent=`✓ Total cubierto · ${sy}${_splitMonto(totalAportado)}`;
    }else if(exceso){
        statusEl.className='split-status error';
        statusEl.textContent=`Exceso de ${sy}${_splitMonto(Math.abs(faltante))} · ajustá los aportes`;
    }else if(hayBancoVacio){
        statusEl.className='split-status error';
        statusEl.textContent='Seleccioná un banco en cada fila de pago';
    }else{
        statusEl.className='split-status error';
        statusEl.textContent=`Falta ${sy}${_splitMonto(faltante)} · aportado ${sy}${_splitMonto(totalAportado)} de ${sy}${_splitMonto(totalNecesario)}`;
    }
    /* v4.7.59 — refrescar estado del botón principal en cada cambio del split */
    if(typeof _updateBtnGuardarState==='function')_updateBtnGuardarState();
    /* Actualizar también el botón "Agregar cuenta para cubrir $X" si está presente */
    const addBtn=panel.querySelector('[data-action="split-add"]');
    if(addBtn){
        if(faltante>=SPLIT_EPSILON){
            addBtn.textContent=`＋ Agregar cuenta para cubrir ${sy}${_splitMonto(faltante)}`;
            addBtn.style.display='';
        }else{
            addBtn.style.display='none';
        }
    }
}
/* Validar que aportes cubran totalNecesario exactamente y cada banco tenga saldo */
function validarAportes(){
    const aportes=getAportes();
    if(!aportes)return{ok:true};
    /* v4.7.59 — defensa dura contra el bug: si alguna fila de split tiene
       banco vacío, NO se puede crear la operación. Esta es la segunda red de
       seguridad (la primera es el botón deshabilitado en UI). */
    if(aportes._hasEmptyBank){
        return{ok:false,msg:'Hay una fila de pago sin banco seleccionado. Seleccioná un banco en cada fila o eliminala con la ✕ para continuar.'};
    }
    const state=_computeSplitState();
    if(!state||!state.aplicaSplit)return{ok:true};
    const sy=getSym(getBancoInfo(state.bancoPrinc)?.moneda||'UYU');
    /* Usar el faltante normalizado del estado — misma fuente de verdad que la UI */
    if(!state.cubierto){
        if(state.exceso){
            return{ok:false,msg:`Los aportes exceden el total por ${sy}${_splitMonto(Math.abs(state.faltante))}. Ajustá los montos.`};
        }
        return{ok:false,msg:`Faltan ${sy}${_splitMonto(state.faltante)} para cubrir el total. Agregá una cuenta o ajustá los montos.`};
    }
    /* Validar saldos individuales con tolerancia consistente */
    for(const a of aportes){
        const bk=AppState.datos.bancos[a.banco];
        if(!bk)return{ok:false,msg:`El banco ${a.banco} no existe`};
        if(bk.saldo<a.monto-SPLIT_EPSILON)return{ok:false,msg:`${a.banco} solo tiene ${sy}${_splitMonto(bk.saldo)}`};
    }
    return{ok:true,aportes};
}

async function agregarOperacion(){
    if(AppState.ui.enCooldown||AppState.ui.guardandoOperacion)return;const btn=$('btnAgregarOp');if(btn.disabled)return;
    const t=$('tipo').value,m=pv('monto'),ti=$('tasa'),ta=parsearTasa(ti.value),b=$('banco').value,cb=roundMoney(pv('comisionBanco')),f=getUDateStr(),h=getUTimeStr(),mon=getMonedaBanco(),isU=mon==='USD',cpv=getComisionActual(),cp=cpv/100;
    if(!m){alert('Ingresá el monto');return}
    if(!ta){ti.classList.add('error');$('tasaHelp').textContent='Formato inválido';$('tasaHelp').className='error-text';$('tasaHelp').style.display='block';alert('Tasa inválida (ej: '+(isU?'1,025':'39,50')+')');return}
    if(!b){$('bancoHelp').textContent='Seleccioná un banco';$('bancoHelp').className='error-text';$('banco').classList.add('error');alert('Seleccioná un banco');return}
    $('banco').classList.remove('error');
    /* Split pago: si activo, validar aportes antes de continuar */
    const isSplit=t==='compra'&&splitActivo();
    let aportes=null;
    if(isSplit){
        const val=validarAportes();
        if(!val.ok){alert(val.msg);return}
        aportes=val.aportes;
    }
    /* monto = UYU directamente */
    const u=usdtBase(m/ta,t),cpl=truncar(u*cp,2);
    if(t==='compra'){
        const bk=AppState.datos.bancos[b];
        if(bk.limiteDiarioUSD>0){const mU=isU?m:truncar(m/ta),dU=roundMoney(bk.limiteDiarioUSD-(bk.limiteUsadoUSD||0));if(mU>dU){alert(`Excede el límite diario. Disponible: US$${fmtNum(dU,0)} (${fmtNum(mU,2)} USD requeridos)`);return}}
        /* INTEGRIDAD: validación dura — no se permite saldo negativo bajo ninguna circunstancia */
        if(isSplit){
            const valI=validarDeltas({aportes});
            if(!valI.ok){alert('🚫 No se puede guardar:\n\n'+valI.reason);return}
        }else{
            const valI=validarDeltas({bancos:{[b]:-(m+cb)}});
            if(!valI.ok){alert('🚫 No se puede comprar:\n\n'+valI.reason);return}
        }
    }else{
        /* INTEGRIDAD: no se puede vender más USDT del disponible en lotes activos de la moneda */
        const un=usdtNeto(u,cpl,t);
        const valI=validarDeltas({usdt:-un,usdtMoneda:mon||'UYU'});
        if(!valI.ok){alert('🚫 No se puede vender:\n\n'+valI.reason);return}
    }
    AppState.ui.guardandoOperacion=true;btn.disabled=true;btn.textContent='Guardando...';
    try{
        const opId=uid();
        if(t==='compra'){
            /* Construir deltas: saldos + límite USD (solo al banco principal) */
            const deltas={bancos:{},limitesUSD:{}};
            if(isSplit){
                aportes.forEach(a=>{deltas.bancos[a.banco]=(deltas.bancos[a.banco]||0)-a.monto});
            }else{
                deltas.bancos[b]=-(m+cb);
            }
            const mU=_montoEnUSDLimite(b,isSplit?m:m);
            if(mU>0)deltas.limitesUSD[b]=mU;
            aplicarDeltas(deltas);
        }else{
            aplicarDeltas({bancos:{[b]:m}});
        }
        const opRecord={id:opId,tipo:t,monto:m,tasa:ta,usdt:u,banco:b,moneda:mon,comisionBanco:t==='compra'?cb:0,comisionPlataforma:cpl,comisionPct:cpv,fecha:f,hora:h,ganancia:0,timestamp:new Date().toISOString()};
        /* Persistir aportes para trazabilidad y reverso correcto en delete/edit */
        if(isSplit)opRecord.aportes=aportes;
        AppState.datos.operaciones.unshift(opRecord);
        recalcularLotesYGanancias();
        agregarTasaReciente(ta,t,mon);
        $('monto').value='';$('comisionBanco').value='0';$('previewBox').style.display='none';$('opSummary').style.display='none';AppState.ui.paginaOp=1;AppState.ui.tasaManual=false;
        /* Reset banco selection — prevents accidental reuse of prior bank on next op */
        $('banco').value='';
        $('bancoHelp').textContent='';
        $('saldoBancoInfo').textContent='';
        AppState.ui.splitExtras=[];
        renderSplitPanel();
        actualizarColorBancoSelect();
        actualizarVista();actualizarColorSelect();activarCooldown();
        guardaOptimista('create','operaciones',opId);
        const sy2=getSym(mon);
        const subMsg=isSplit?`Pago dividido entre ${aportes.length} cuentas`:'Tasa: '+fmtTasaMon(ta,mon)+' · '+b;
        showSuccess({amount:sy2+fmtNum(m),message:(t==='compra'?'Comprados ':'Vendidos ')+fmtTrunc(u,2)+' USDT con éxito',sub:subMsg});
    }catch(e){console.error('[P2P] Error guardando operación:',e)}finally{AppState.ui.guardandoOperacion=false;btn.disabled=false;actualizarColorSelect();/* v4.7.59: re-evaluar split por si el usuario agregó fila inválida durante el guardado */ if(typeof _updateBtnGuardarState==='function')_updateBtnGuardarState();}
}

async function eliminarOperacion(id){
    const op=AppState.datos.operaciones.find(o=>o.id===id);if(!op)return;
    /* INTEGRIDAD: pre-validar que el rollback no deje saldos negativos */
    const deltas={bancos:{}};
    if(op.tipo==='compra'){
        if(Array.isArray(op.aportes)&&op.aportes.length){
            op.aportes.forEach(a=>{deltas.bancos[a.banco]=(deltas.bancos[a.banco]||0)+a.monto});
        }else if(op.banco){
            deltas.bancos[op.banco]=roundMoney(op.monto+(op.comisionBanco||0));
        }
    }else{
        /* Venta: revertir suma positiva al banco → restar. Si banco ya gastó esos UYU, queda negativo. */
        if(op.banco)deltas.bancos[op.banco]=-op.monto;
    }
    const valI=validarDeltas(deltas);
    if(!valI.ok){
        alert('🚫 No se puede eliminar esta operación:\n\n'+valI.reason+'\n\nProbablemente ya gastaste los fondos generados. Eliminá primero las operaciones posteriores que los consumen.');
        return;
    }
    if(!confirm('¿Eliminar operación? Se recalcularán los lotes y ganancias.'))return;
    try{
        if(op.tipo==='compra'){
            if(Array.isArray(op.aportes)&&op.aportes.length){
                op.aportes.forEach(a=>{
                    if(AppState.datos.bancos[a.banco])AppState.datos.bancos[a.banco].saldo=fixNeg(AppState.datos.bancos[a.banco].saldo+a.monto);
                });
                if(op.banco&&AppState.datos.bancos[op.banco]&&AppState.datos.bancos[op.banco].limiteDiarioUSD>0&&op.tasa>0){
                    const mU=roundMoney(op.monto/op.tasa);
                    AppState.datos.bancos[op.banco].limiteUsadoUSD=Math.max(0,roundMoney((AppState.datos.bancos[op.banco].limiteUsadoUSD||0)-mU));
                }
            }else if(op.banco&&AppState.datos.bancos[op.banco]){
                AppState.datos.bancos[op.banco].saldo=fixNeg(AppState.datos.bancos[op.banco].saldo+roundMoney(op.monto+(op.comisionBanco||0)));
                if(AppState.datos.bancos[op.banco].limiteDiarioUSD>0&&op.tasa>0){const mU=roundMoney(op.monto/op.tasa);AppState.datos.bancos[op.banco].limiteUsadoUSD=Math.max(0,roundMoney((AppState.datos.bancos[op.banco].limiteUsadoUSD||0)-mU))}
            }
        }else{
            if(op.banco&&AppState.datos.bancos[op.banco])AppState.datos.bancos[op.banco].saldo=fixNeg(AppState.datos.bancos[op.banco].saldo-op.monto);
        }
        AppState.datos.operaciones=AppState.datos.operaciones.filter(o=>o.id!==id);
        recalcularLotesYGanancias();actualizarVista();
        verificarIntegridadGlobal();
        guardaOptimista('delete','operaciones',id);
    }catch(e){console.error('[P2P] Error eliminando operación:',e)}
}

function abrirEditarOperacion(id){
    const op=AppState.datos.operaciones.find(o=>o.id===id);if(!op)return;
    /* Cualquier operación con aportes (split pago) no puede editarse directamente — 
       hay que eliminar y recrear para mantener la coherencia de los saldos por banco */
    if(Array.isArray(op.aportes)&&op.aportes.length>0){
        alert('Esta operación se pagó con múltiples cuentas. Por ahora no se puede editar directamente — eliminala y recreala si necesitás cambiarla.');
        return;
    }
    AppState.ui.opEditandoId=id;
    const sy=getSym(op.moneda),td=op.moneda==='USD'?3:2;
    const badge=op.tipo==='compra'?'📥 Compra':'📤 Venta';
    setText('editarOpHeader','✏️ Editar '+badge);
    setText('editOpMontoLabel',op.tipo==='compra'?`Monto pagado (${op.moneda||'UYU'})`:`Monto recibido (${op.moneda||'UYU'})`);
    $('editOpMonto').value=fmtNum(op.monto);
    $('editOpTasa').value=fmtTasa(op.tasa,op.moneda||'UYU');
    /* Comisión Binance: poblar con el valor persistido en la operación.
       Fallback al global de la moneda si la op no tiene (datos legacy). */
    const cpOp=op.comisionPct!==undefined?op.comisionPct:(op.moneda==='USD'?(AppState.datos.comisionUSD||0.14):(AppState.datos.comisionPlataforma||0.14));
    $('editOpComisionPct').value=fmtNum(cpOp);
    $('editOpComisionPct').classList.remove('error');
    /* Poblar select de bancos */
    const sel=$('editOpBanco');sel.innerHTML='';
    getBancosActivos().forEach(b=>{sel.innerHTML+=`<option value="${b.nombre}" style="color:${b.color||'#1e293b'};font-weight:600"${b.nombre===op.banco?' selected':''}>${b.nombre}</option>`});
    sel.style.color=getBancoColor(op.banco);sel.style.fontWeight='600';
    /* Info y preview */
    $('editarOpInfo').innerHTML=`${fmtFechaCorta(op.fecha)} ${op.hora||''} · ${sy}${fmtNum(op.tasa,td)} · ${fmtTrunc(op.usdt,2)} USDT`;
    calcularEditOpPreview();
    abrirModal('modalEditarOp');
}

/* Lee el % de comisión del input del modal. Si está inválido, retorna fallback de la op.
   Separado para poder reutilizarse en preview y en guardar. */
function _editOpComisionPctLeida(op){
    const raw=$('editOpComisionPct').value.replace(',','.').trim();
    const v=parsearComisionPct(raw);
    if(v!==null)return v;
    /* Fallback — mismo que en abrir */
    return op.comisionPct!==undefined?op.comisionPct:(op.moneda==='USD'?(AppState.datos.comisionUSD||0.14):(AppState.datos.comisionPlataforma||0.14));
}

function calcularEditOpPreview(){
    const op=AppState.datos.operaciones.find(o=>o.id===AppState.ui.opEditandoId);if(!op)return;
    const m=pv('editOpMonto'),ta=parsearTasa($('editOpTasa').value),pbox=$('editOpPreview');
    if(m>0&&ta){
        /* Usar el % del input editable (no el persistido) para preview en vivo */
        const cpct=_editOpComisionPctLeida(op)/100;
        const u=usdtBase(m/ta,op.tipo),c=truncar(u*cpct,2),neto=usdtNeto(u,c,op.tipo);
        setText('editOpComisionInfo',fmtTrunc(c,2)+' USDT');
        pbox.innerHTML=op.tipo==='compra'
            ?`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M12 16V3M7 11l5 5 5-5"/></svg> Recibís <b>${fmtNum(neto,2)} USDT</b> <span style="color:#64748b;font-size:0.85em">(base: ${fmtNum(u,2)})</span>`
            :`📤 Entregás <b>${fmtNum(neto,2)} USDT</b>`;
        pbox.style.display='block';
    }else{
        setText('editOpComisionInfo','0 USDT');
        pbox.style.display='none';
    }
}
