function normalizarChangelog(){
    /* Advertencia de mantenimiento — no rompe nada, solo avisa al dev */
    if(CHANGELOG.length>CHANGELOG_MAX_ENTRIES&&!normalizarChangelog._warned){
        normalizarChangelog._warned=true;
        console.warn(`[P2P] CHANGELOG tiene ${CHANGELOG.length} entradas — retirar las más viejas para mantener solo las últimas ${CHANGELOG_MAX_ENTRIES}.`);
    }
    /* CAP defensivo: aunque el array crezca, solo se expone ventana N */
    const capped=CHANGELOG.slice(0,CHANGELOG_MAX_ENTRIES);
    /* Convierte entradas legacy con changes:[string] al formato {type,title,desc}.
       Detecta type por keywords; default 'improve'. */
    return capped.map(entry=>{
        if(!entry.changes)return entry;
        const norm=entry.changes.map(ch=>{
            if(typeof ch==='object'&&ch.title)return ch;
            const s=String(ch);
            const lower=s.toLowerCase();
            let type='improve';
            if(/^(fix|bug|auditor[ií]a)\b/i.test(s)||lower.includes(' fix ')||lower.startsWith('fix:'))type='fix';
            else if(/^(perf|cache|optim)/i.test(s)||lower.includes('perf:'))type='perf';
            else if(/^(nuev[oa]|agreg|implement|edici[oó]n)/i.test(s)||lower.includes('feature'))type='feature';
            return{type,title:s,desc:''};
        });
        return{...entry,changes:norm};
    });
}

/* ═══════════════════════════════════════
   §2 — ESTADO CENTRALIZADO
   ═══════════════════════════════════════ */
const AppState = {
    db: null, auth: null, currentUser: null, unsubscribe: null,
    datos: null,
    _localVersion: 0,
    _datosStale: false,
    _postRestoreLockTs: 0,
    ui: { bancoEditando:null, tipoMovimiento:'ingreso', calendarDate:new Date(),
          loteEditandoId:null, paginaOp:1, paginaMov:1, paginaTrans:1, paginaConv:1,
          guardandoMovimiento:false, guardandoLote:false, guardandoOperacion:false, guardandoTransferencia:false,
          enCooldown:false, comisionDebounce:null, tasaManual:false, ultimoMonedaBanco:null, syncState:'offline', opEditandoId:null, tagPeriodo:'total' }
};

function crearDatosVacios() {
    /* v6.8.2 — ajustesSaldo faltaba acá: tras un reseteo o una restauración
       quedaba sin definir y la app tenía que crearlo sobre la marcha. */
    return {operaciones:[],movimientos:[],transferencias:[],conversiones:[],ajustesSaldo:[],bancos:{},lotes:[],tags:[],tasasRecientes:[],
            saldoUsdt:0,ultimaTasaCompra:0,ultimaTasaVenta:0,comisionPlataforma:0.14,
            ultimaTasaCompraUSD:0,ultimaTasaVentaUSD:0,comisionUSD:0.14,ultimoMesProcesado:'',_version:0,
            lastSeenVersion:'',dismissedVersions:[],
            /* v5.2.2 — Explícitos en null: si no figuran, el reseteo no puede
               limpiarlos y los lotes de arrastre reaparecen con su saldo USDT. */
            _archivoCarryover:null,_archivoSeeds:null,_archivoIndex:null};
}
AppState.datos = crearDatosVacios();

/* ═══════════════════════════════════════
   §3 — HELPERS DOM
   ═══════════════════════════════════════ */
const $ = id => document.getElementById(id);
const setText = (id, t) => { const e=$(id); if(e) e.textContent=t; };
const setHtml = (id, h) => { const e=$(id); if(e) e.innerHTML=h; };

function abrirModal(id) { $(id)?.classList.add('active'); document.body.style.overflow='hidden'; }
function cerrarModal(id) { $(id)?.classList.remove('active'); if(!document.querySelector('.modal.active'))document.body.style.overflow=''; }

/* ═══ Success confirmation overlay ═══ */
let _successTimer=null;
function showSuccess(opts){
    const{amount,message,sub}=opts;
    clearTimeout(_successTimer);
    const ov=$('successOverlay');if(!ov)return;
    $('successAmount').textContent=amount||'';
    $('successMsg').textContent=message||'Operación exitosa';
    $('successSub').textContent=sub||'';
    ov.classList.add('show');document.body.style.overflow='hidden';
    _successTimer=setTimeout(()=>{ov.classList.remove('show');if(!document.querySelector('.modal.active'))document.body.style.overflow=''},1500);
}
function setSyncStatus(s,t) {
    const el=$('syncStatus');if(!el)return;
    const labels={online:'En línea',offline:'Desconectado',syncing:'Sincronizando...',reconnecting:'Reconectando...'};
    el.className='sync-status '+s;
    /* Trazabilidad: si hubo restauración reciente, reflejarla al estar online */
    let lbl=t||labels[s]||s;
    if(s==='online'&&AppState._restoredFrom&&!t){
        const map={'backup-empty-remote':'Restaurado (auto)','backup-no-remote':'Restaurado (auto)','manual-backup':'Restaurado (manual)','manual-import':'Importado (manual)'};
        lbl=map[AppState._restoredFrom]||'En línea';
    }
    setText('syncText',lbl);
    AppState.ui.syncState=s;
}

/* ═══ Reconnect Firebase sin recargar ═══ */
async function reconnectFirebase(){
    if(AppState.ui.syncState==='reconnecting')return;
    setSyncStatus('reconnecting');
    /* Marcar datos como stale ANTES de reconectar — bloquea escrituras hasta recibir datos frescos */
    AppState._datosStale=true;
    const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),12000));
    try{
        await Promise.race([timeout,(async()=>{
            if(AppState.unsubscribe){AppState.unsubscribe();AppState.unsubscribe=null}
            if(AppState.db){try{await AppState.db.enableNetwork()}catch(e){}}
            const user=AppState.auth?.currentUser;
            if(user){
                try{await user.getIdToken(true)}catch(e){}
                showApp(user);
            }else{
                await new Promise((res,rej)=>{const unsub=AppState.auth.onAuthStateChanged(u=>{unsub();u?res(showApp(u)):rej(new Error('no-auth'))},rej)});
            }
            /* Esperar a que el snapshot entregue datos frescos del server (no cache) */
            await new Promise((res,rej)=>{
                const t=setTimeout(()=>{rej(new Error('sync-timeout'))},8000);
                const check=setInterval(()=>{
                    if(!AppState._datosStale){clearInterval(check);clearTimeout(t);res()}
                },200);
            });
        })()]);
    }catch(e){
        const msg=e.message==='timeout'||e.message==='sync-timeout'?'Tiempo agotado':'Error al reconectar';
        if(e.message==='sync-timeout'){
            /* Si el timeout es de sync pero la conexión se restableció, desbloquear de todas formas */
            AppState._datosStale=false;
            console.warn('[P2P] Sync timeout, desbloqueando escrituras con datos disponibles');
        }
        setSyncStatus(navigator.onLine?'online':'offline',msg);
    }
}

/* ═══ Detectar conectividad ═══ */
function inicializarConectividad(){
    window.addEventListener('online',()=>{
        if(!AppState.currentUser)return;
        /* Al volver online, intentar reconectar Firebase y vaciar cualquier cambio pendiente
           que quedó diferido por estar offline. El snapshot re-sincronizará el servidor. */
        if(AppState.ui.syncState==='offline')reconnectFirebase();
        /* Si quedó pending local por offline, re-disparar guardado con debounce */
        if(_syncQueue.length>0||_localDirty>0)guardaOptimista('resync','pending','online');
        /* Reevaluar el estado del badge: si la red ya está OK, no debe quedar 
           "Error al reconectar" pegado de un evento viejo. */
        if(typeof _syncLog==='function')_syncLog('connectivity:online',{queue:_syncQueue.length,dirty:_localDirty});
        setTimeout(()=>{
            if(typeof repairOrphanPendingStates==='function')repairOrphanPendingStates();
            if(typeof reevaluarEstadoSync==='function')reevaluarEstadoSync();
        },500);
    });
    window.addEventListener('offline',()=>{
        if(typeof _syncLog==='function')_syncLog('connectivity:offline',{});
        setSyncStatus('offline');
    });
    /* ═══ Safety net periódico ═══
       Cada 30s, si la app está en foreground, re-evaluamos el estado real de sync.
       Esto cubre el caso donde una transición de estado se perdió por algún motivo
       (background tabs en mobile, browser throttling, etc). Costo: <1ms cada 30s.
       Solo limpia errores residuales si el sistema YA está en estado sano. */
    setInterval(()=>{
        if(!AppState.currentUser)return;
        if(document.visibilityState!=='visible')return;
        if(typeof reevaluarEstadoSync==='function')reevaluarEstadoSync();
    },30000);
    /* Flush del debounce al perder foco — evita que cambios queden en buffer al cerrar pestaña/app */
    document.addEventListener('visibilitychange',()=>{
        if(document.visibilityState==='hidden'&&AppState.currentUser)flushGuardaDebounce();
        else if(document.visibilityState==='visible'&&AppState.currentUser){
            /* Al volver a foreground, reevaluar — el estado pudo cambiar mientras estuvimos hidden */
            if(typeof reevaluarEstadoSync==='function')reevaluarEstadoSync();
        }
    });
    window.addEventListener('beforeunload',()=>{
        if(AppState.currentUser)flushGuardaDebounce();
    });
    window.addEventListener('pagehide',()=>{
        if(AppState.currentUser)flushGuardaDebounce();
    });
}

/* ═══ Monthly Summary — Snapshot automático al cambio de mes ═══ */
async function verificarCambioMes(){
    if(!AppState.currentUser||!AppState.datos)return;
    const hoy=getUDate(),mesActual=`${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
    const ultimoMes=AppState.datos.ultimoMesProcesado||'';
    if(!ultimoMes){
        AppState.datos.ultimoMesProcesado=mesActual;
        await guardarDatos();return;
    }
    if(ultimoMes>=mesActual)return;
    try{
        const ops=AppState.datos.operaciones.filter(op=>op.fecha?.startsWith(ultimoMes));
        let compras=0,ventas=0,montoCompras=0,montoVentas=0,gananciaTotal=0,comisionesTotal=0,comisionBancariaTotal=0;
        let sumTasaC=0,sumTasaV=0;
        const opsPorBanco={};
        const gananciaDiaria={};
        ops.forEach(op=>{
            if(op.tipo==='compra'){compras++;montoCompras=roundMoney(montoCompras+op.monto);sumTasaC+=op.tasa;comisionBancariaTotal=roundMoney(comisionBancariaTotal+(op.comisionBanco||0))}
            else{ventas++;montoVentas=roundMoney(montoVentas+op.monto);sumTasaV+=op.tasa}
            gananciaTotal=roundMoney(gananciaTotal+(op.ganancia||0));
            comisionesTotal=roundMoney(comisionesTotal+(op.comisionPlataforma||0));
            if(op.banco)opsPorBanco[op.banco]=(opsPorBanco[op.banco]||0)+1;
            if(op.fecha)gananciaDiaria[op.fecha]=roundMoney((gananciaDiaria[op.fecha]||0)+(op.ganancia||0));
        });
        const tasaPromCompra=compras?roundMoney(sumTasaC/compras):0;
        const tasaPromVenta=ventas?roundMoney(sumTasaV/ventas):0;
        const spreadPromedio=(compras&&ventas)?roundMoney(tasaPromVenta-tasaPromCompra):0;
        let mejorDia=null,peorDia=null,maxG=-Infinity,minG=Infinity;
        Object.entries(gananciaDiaria).forEach(([dia,g])=>{
            if(g>maxG){maxG=g;mejorDia={dia,ganancia:g}}
            if(g<minG){minG=g;peorDia={dia,ganancia:g}}
        });
        let bancoMasUsado=null,maxOps=0;
        Object.entries(opsPorBanco).forEach(([b,n])=>{if(n>maxOps){maxOps=n;bancoMasUsado={banco:b,ops:n}}});
        const lotesAlCierre=(AppState.datos.lotes||[]).filter(l=>l.disponible>0).length;
        const capitalOperado=roundMoney(montoCompras+montoVentas);
        const movs=AppState.datos.movimientos.filter(m=>m.fecha?.startsWith(ultimoMes));
        const transf=AppState.datos.transferencias.filter(t=>t.fecha?.startsWith(ultimoMes));
        const snapshot={
            mes:ultimoMes,
            creadoEn:firebase.firestore.FieldValue.serverTimestamp(),
            operaciones:{total:ops.length,compras,ventas,montoCompras,montoVentas},
            gananciaTotal,comisionesTotal,comisionBancariaTotal,
            movimientos:movs.length,transferencias:transf.length,
            saldoUsdt:AppState.datos.saldoUsdt,
            bancosSnapshot:{},
            gastosTag:{},
            tasaPromCompra,tasaPromVenta,spreadPromedio,
            mejorDia,peorDia,bancoMasUsado,
            lotesAlCierre,capitalOperado
        };
        CONFIG.BANCOS.forEach(b=>{
            if(AppState.datos.bancos[b.nombre]?.activo)
                snapshot.bancosSnapshot[b.nombre]={saldo:AppState.datos.bancos[b.nombre].saldo,moneda:b.moneda}
        });
        /* Análisis de gastos por tag para el mes que cierra */
        const tasaFb=AppState.datos.ultimaTasaCompra||1;
        const egresosMes=movs.filter(m=>m.tipoMovimiento==='egreso');
        let totalEgresoUYU=0;
        const tags=AppState.datos.tags||[];
        tags.forEach(tag=>{
            const tagMovs=egresosMes.filter(m=>m.descripcion&&tagKey(m.descripcion)===tagKey(tag));
            if(!tagMovs.length)return;
            let uyu=0;tagMovs.forEach(m=>{uyu=roundMoney(uyu+movimientoValorUYU(m,tasaFb))});
            totalEgresoUYU=roundMoney(totalEgresoUYU+uyu);
            snapshot.gastosTag[tag]={ops:tagMovs.length,totalUYU:uyu};
        });
        snapshot.totalEgresoUYU=totalEgresoUYU;
        /* Ingresos externos del mes — separados de la ganancia P2P */
        let ingresosExternosTotal=0;
        movs.filter(m=>m.tipoMovimiento==='ingreso').forEach(m=>{
            ingresosExternosTotal=roundMoney(ingresosExternosTotal+movimientoValorUYU(m,tasaFb));
        });
        snapshot.ingresosExternosTotal=ingresosExternosTotal;
        /* Batch write atómico: snapshot + actualizar mes procesado */
        const batch=AppState.db.batch();
        const userRef=AppState.db.collection('users').doc(AppState.currentUser.uid);
        batch.set(userRef.collection('monthly_summaries').doc(ultimoMes),snapshot);
        batch.update(userRef,{ultimoMesProcesado:mesActual});
        await batch.commit();
        CONFIG.BANCOS.forEach(b=>{if(AppState.datos.bancos[b.nombre])AppState.datos.bancos[b.nombre].limiteUsadoUSD=0});
        AppState.datos.ultimoMesProcesado=mesActual;
        console.log('[P2P] Resumen mensual guardado:',ultimoMes);
    }catch(e){console.error('[P2P] Error guardando resumen mensual:',e)}
}

/* ═══ Resumen Mensual — Cargar y renderizar ═══ */
/* SVG chart helpers for Resumen Mensual */
function _chartBar(items,maxH){
    /* items: [{label,value,color}] — value can be negative */
    const maxAbs=Math.max(...items.map(i=>Math.abs(i.value||0)),1);
    const H=maxH||90,W=320,pad=4,barW=(W-pad*2)/items.length-6;
    let bars='';
    items.forEach((it,i)=>{
        const h=Math.abs(it.value)/maxAbs*H*0.85;
        const x=pad+i*((W-pad*2)/items.length)+3;
        const y=H-h;
        bars+=`<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${it.color||'#2563eb'}"/>`;
        bars+=`<text x="${x+barW/2}" y="${H+12}" text-anchor="middle" fill="#94a3b8" font-size="9">${escHtml(it.label)}</text>`;
        if(it.value)bars+=`<text x="${x+barW/2}" y="${y-3}" text-anchor="middle" fill="#475569" font-size="9" font-weight="600">${it.valueText||fmtNum(it.value,0)}</text>`;
    });
    return `<svg class="resumen-chart-svg" viewBox="0 0 ${W} ${H+18}" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
}
function _chartDona(items,total){
    /* items: [{label,value,color}] */
    if(!total||total<=0||!items.length)return '<div style="text-align:center;color:#94a3b8;font-size:0.78em;padding:16px">Sin datos</div>';
    const r=42,cx=60,cy=60,stroke=16,circ=2*Math.PI*r;
    let cum=0,svg='';
    items.forEach(it=>{
        const pct=it.value/total;if(pct<=0)return;
        const dash=pct*circ,gap=circ-dash,offset=-cum*circ+circ*0.25;
        svg+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${stroke}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${offset}"/>`;
        cum+=pct;
    });
    svg=`<svg viewBox="0 0 120 120" style="width:110px;height:110px;flex-shrink:0"><text x="${cx}" y="${cy-2}" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">$${fmtNum(total,0)}</text><text x="${cx}" y="${cy+10}" text-anchor="middle" fill="#94a3b8" font-size="7">total</text>${svg}</svg>`;
    const leg=items.filter(i=>i.value>0).map(i=>`<div class="resumen-chart-legend-item"><span class="resumen-chart-legend-dot" style="background:${i.color}"></span>${escHtml(i.label)} · $${fmtNum(i.value,0)}</div>`).join('');
    return `<div style="display:flex;gap:12px;align-items:center">${svg}<div style="flex:1"><div class="resumen-chart-legend" style="flex-direction:column;gap:4px">${leg}</div></div></div>`;
}
function _chartLinea(points,opts){
    /* points: [{label,value}] */
    opts=opts||{};
    if(!points.length)return '<div style="text-align:center;color:#94a3b8;font-size:0.78em;padding:16px">Sin datos</div>';
    const W=320,H=100,pad=20;
    const vals=points.map(p=>p.value||0);
    const min=Math.min(0,...vals),max=Math.max(0,...vals);
    const range=max-min||1;
    const xStep=(W-pad*2)/Math.max(1,points.length-1);
    const yFor=v=>H-pad-((v-min)/range)*(H-pad*2);
    let path='',area='',dots='';
    points.forEach((p,i)=>{
        const x=pad+i*xStep,y=yFor(p.value||0);
        path+=(i===0?'M':'L')+x.toFixed(1)+' '+y.toFixed(1)+' ';
        dots+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${(p.value||0)>=0?'#16a34a':'#dc2626'}"/>`;
        if(i===points.length-1)area=path+`L${x.toFixed(1)} ${(H-pad).toFixed(1)} L${pad} ${(H-pad).toFixed(1)} Z`;
    });
    const zeroY=yFor(0);
    return `<svg class="resumen-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <path d="${area}" fill="${opts.areaFill||'rgba(37,99,235,0.1)'}"/>
        <line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${W-pad}" y2="${zeroY.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="2 2"/>
        <path d="${path}" fill="none" stroke="${opts.lineColor||'#2563eb'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
        ${points.map((p,i)=>`<text x="${(pad+i*xStep).toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#94a3b8" font-size="9">${escHtml(p.label)}</text>`).join('')}
    </svg>`;
}
function _resumenChartHtml(d,mesesCortos,chartType){
    const op=d.operaciones||{};
    if(chartType==='barras'){
        const items=[
            {label:'Compras',value:op.compras||0,color:'#16a34a'},
            {label:'Ventas',value:op.ventas||0,color:'#2563eb'},
            {label:'Ajustes',value:d.movimientos||0,color:'#f59e0b'},
            {label:'Transf',value:d.transferencias||0,color:'#8b5cf6'}
        ];
        return _chartBar(items);
    }else if(chartType==='dona'){
        const gt=d.gastosTag||{};
        const keys=Object.keys(gt).sort((a,b)=>(gt[b].totalUYU||0)-(gt[a].totalUYU||0)).slice(0,6);
        const COLORS=['#3b82f6','#16a34a','#f59e0b','#dc2626','#8b5cf6','#ec4899'];
        const items=keys.map((k,i)=>({label:k,value:gt[k].totalUYU||0,color:COLORS[i%COLORS.length]}));
        const total=items.reduce((s,i)=>s+i.value,0);
        return _chartDona(items,total);
    }
    return '';
}
/* Monthly progression line — receives docs array (reversed: oldest first) */
function _chartMensual(docs,mesesCortos){
    const pts=[...docs].reverse().map(d=>{
        const mn=parseInt(d.mes.split('-')[1])-1;
        const neta=roundMoney((d.gananciaTotal||0)-(d.totalEgresoUYU||0)-(d.comisionBancariaTotal||0));
        return{label:mesesCortos[mn],value:neta};
    });
    return _chartLinea(pts,{lineColor:'#2563eb',areaFill:'rgba(37,99,235,0.08)'});
}

/* Compare panel state + rendering */