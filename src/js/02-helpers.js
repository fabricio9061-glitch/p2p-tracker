/* ═══════════════════════════════════════════════════════════════════
   02-helpers.js
   Generated piece — concatenated into dist/index.html by build/build.js
   Source of truth: src/js/02-helpers.js
   Do NOT edit dist/index.html directly. Edit the source and re-run build.
   ═══════════════════════════════════════════════════════════════════ */
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
    });
    window.addEventListener('offline',()=>setSyncStatus('offline'));
    /* Flush del debounce al perder foco — evita que cambios queden en buffer al cerrar pestaña/app */
    document.addEventListener('visibilitychange',()=>{
        if(document.visibilityState==='hidden'&&AppState.currentUser)flushGuardaDebounce();
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
function _renderCompareDiff(aDoc,bDoc,mesesCortos){
    if(!aDoc||!bDoc||aDoc.mes===bDoc.mes)return '<div class="compare-hint">Seleccioná dos meses distintos para ver la comparación.</div>';
    const parseName=d=>{const p=d.mes.split('-');return mesesCortos[parseInt(p[1])-1]+' '+p[0]};
    const nameA=parseName(aDoc),nameB=parseName(bDoc);
    const metric=(label,a,b,opts)=>{
        opts=opts||{};
        const diff=roundMoney(b-a);
        const pct=a!==0?Math.round(Math.abs(diff/a*100)):(b!==0?100:0);
        const arrow=diff>0?'↑':(diff<0?'↓':'→');
        const sign=diff>=0?'+':'-';
        const fmt=opts.fmt||(v=>'$'+fmtNum(v,0));
        /* higherIsBetter: true → up=green,down=red. false → inverted (e.g. gastos: menos es mejor) */
        let cls='flat';
        if(diff>0)cls=opts.higherIsBetter===false?'up-bad':'up';
        else if(diff<0)cls=opts.higherIsBetter===false?'down-good':'down';
        return `<div class="compare-diff-row">
            <div>
                <div class="compare-diff-label">${label}</div>
                <div class="compare-diff-values">${fmt(a)} → ${fmt(b)}</div>
            </div>
            <div></div>
            <span class="compare-diff-change ${cls}">${arrow} ${sign}${fmt(Math.abs(diff)).replace('$','$')}${a!==0?' · '+pct+'%':''}</span>
        </div>`;
    };
    const gnA=roundMoney((aDoc.gananciaTotal||0)-(aDoc.totalEgresoUYU||0)-(aDoc.comisionBancariaTotal||0));
    const gnB=roundMoney((bDoc.gananciaTotal||0)-(bDoc.totalEgresoUYU||0)-(bDoc.comisionBancariaTotal||0));
    const volA=aDoc.capitalOperado||roundMoney((aDoc.operaciones?.montoCompras||0)+(aDoc.operaciones?.montoVentas||0));
    const volB=bDoc.capitalOperado||roundMoney((bDoc.operaciones?.montoCompras||0)+(bDoc.operaciones?.montoVentas||0));
    const opsA=aDoc.operaciones?.total||0,opsB=bDoc.operaciones?.total||0;
    return `<div style="font-size:0.68em;color:#94a3b8;text-align:center;margin-bottom:10px"><b style="color:#64748b">${nameA}</b> vs <b style="color:#64748b">${nameB}</b></div>
        <div class="compare-diff-grid">
            ${metric('Ganancia neta',gnA,gnB)}
            ${metric('Volumen operado',volA,volB)}
            ${metric('Ganancia bruta',aDoc.gananciaTotal||0,bDoc.gananciaTotal||0)}
            ${metric('Gastos',aDoc.totalEgresoUYU||0,bDoc.totalEgresoUYU||0,{higherIsBetter:false})}
            ${metric('Comisiones banc.',aDoc.comisionBancariaTotal||0,bDoc.comisionBancariaTotal||0,{higherIsBetter:false})}
            ${metric('Comisión Binance',aDoc.comisionesTotal||0,bDoc.comisionesTotal||0,{higherIsBetter:false,fmt:v=>fmtNum(v,2)+' USDT'})}
            ${metric('Operaciones',opsA,opsB,{fmt:v=>v+''})}
            ${metric('Balance USDT',aDoc.saldoUsdt||0,bDoc.saldoUsdt||0,{fmt:v=>fmtTrunc(v,2)+' USDT'})}
        </div>`;
}

/* ═══════════════════════════════════════
   §X — CENTRO DE NOVEDADES (changelog visual)
   ═══════════════════════════════════════ */
const TYPE_LABELS={feature:'Nueva función',improve:'Mejora',fix:'Fix',perf:'Rendimiento'};

/* Comparar versiones semver: devuelve >0 si a>b, <0 si a<b, 0 si iguales */
function cmpVersion(a,b){
    if(!a)return -1;if(!b)return 1;
    const pa=a.split('.').map(n=>parseInt(n)||0),pb=b.split('.').map(n=>parseInt(n)||0);
    for(let i=0;i<Math.max(pa.length,pb.length);i++){
        const da=pa[i]||0,db=pb[i]||0;
        if(da!==db)return da-db;
    }
    return 0;
}
/* Cantidad de versiones nuevas vs lo último visto por el usuario */
function getNoticiasNoVistas(){
    const last=AppState.datos?.lastSeenVersion||'';
    const dismissed=new Set(AppState.datos?.dismissedVersions||[]);
    const log=normalizarChangelog();
    /* Badge cuenta SOLO entradas:
         1. Más nuevas que lastSeenVersion
         2. No descartadas individualmente
         3. De los últimos 30 días (relevancia temporal)
       Esto asegura que el badge nunca se quede "pegado" en un número alto. */
    const now=Date.now();
    return log.filter(e=>{
        if(cmpVersion(e.version,last)<=0)return false;
        if(dismissed.has(e.version))return false;
        if(!e.date)return true;
        const d=new Date(e.date+'T00:00:00');
        if(isNaN(d.getTime()))return true;
        return(now-d.getTime())/86400000<=30;
    });
}
function actualizarBadgeNoticias(){
    const badge=$('newsBellBadge');if(!badge)return;
    const n=getNoticiasNoVistas().length;
    if(n>0){badge.textContent=n>9?'9+':String(n);badge.classList.remove('hidden')}
    else badge.classList.add('hidden');
}
function abrirCentroNoticias(){
    /* Reset de "ver anteriores" cada vez que abre — defaulteamos a mostrar solo las recientes */
    AppState.ui._noticiasShowAll=false;
    renderizarCentroNoticias();
    abrirModal('modalNoticias');
    /* Marcar la versión más reciente como vista (el usuario abrió el centro) */
    marcarVersionVista();
}
function renderizarCentroNoticias(){
    const log=normalizarChangelog();
    const last=AppState.datos?.lastSeenVersion||'';
    const dismissed=new Set(AppState.datos?.dismissedVersions||[]);
    /* ═══ Ventana deslizante ═══
       Base: 5 entradas máximo (cap en normalizarChangelog).
       Filtros aplicados en este orden:
         1. Descartadas individualmente (botón × por entrada)
         2. Por edad (>30 días colapsadas tras "ver anteriores")
       Cada capa se puede desactivar via AppState.ui flags. */
    const AGE_CUTOFF_DAYS=30;
    const now=Date.now();
    const esRecienteEnEdad=fechaStr=>{
        if(!fechaStr)return true;
        const d=new Date(fechaStr+'T00:00:00');
        if(isNaN(d.getTime()))return true;
        return(now-d.getTime())/86400000<=AGE_CUTOFF_DAYS;
    };
    const showAll=AppState.ui._noticiasShowAll||false;
    /* Filtro 1: descarte individual */
    const logVisible=showAll?log:log.filter(e=>!dismissed.has(e.version));
    /* Filtro 2: edad (solo si no está en modo "ver todas") */
    const entriesRecientes=showAll?logVisible:logVisible.filter(e=>esRecienteEnEdad(e.date));
    const entriesOcultas=log.length-entriesRecientes.length;

    const renderEntry=entry=>{
        const isNew=cmpVersion(entry.version,last)>0;
        const badge=isNew?'<span class="news-version-badge">Nuevo</span>':'';
        return`<div class="news-version" data-version="${escHtml(entry.version)}">
            <div class="news-version-header">
                <span class="news-version-num">Versión ${escHtml(entry.version)}</span>
                <span class="news-version-date">${escHtml(entry.date||'')}</span>
                ${badge}
                <button class="news-dismiss" data-action="dismiss-news" data-version="${escHtml(entry.version)}" title="Descartar esta novedad" aria-label="Descartar">×</button>
            </div>
            ${entry.headline?`<div class="news-version-headline">${escHtml(entry.headline)}</div>`:''}
            ${entry.changes.map(ch=>{
                const t=ch.type||'improve';
                const lbl=TYPE_LABELS[t]||'Mejora';
                return `<div class="news-card">
                    <span class="news-card-tag ${t}">${lbl}</span>
                    <div class="news-card-body">
                        <div class="news-card-title">${escHtml(ch.title||'')}</div>
                        ${ch.desc?`<div class="news-card-desc">${escHtml(ch.desc)}</div>`:''}
                    </div>
                </div>`;
            }).join('')}
            <div class="news-version-divider"></div>
        </div>`;
    };
    let h=entriesRecientes.map(renderEntry).join('');
    if(entriesOcultas>0&&!showAll){
        h+=`<div style="text-align:center;padding:12px 0 20px"><button class="btn btn-cancel" id="btnNewsShowAll" style="font-size:0.85em;padding:8px 16px">Ver ${entriesOcultas} ${entriesOcultas>1?'ocultas':'oculta'}</button></div>`;
    }
    if(!h)h='<div style="text-align:center;padding:30px;color:#94a3b8">Sin novedades pendientes</div>';
    setHtml('noticiasContent',h);
    if(entriesOcultas>0&&!showAll){
        $('btnNewsShowAll').onclick=()=>{AppState.ui._noticiasShowAll=true;renderizarCentroNoticias()};
    }
}

/* Descartar una versión individualmente — se agrega al set persistente.
   En el siguiente snapshot, dismissedVersions se filtra contra el CHANGELOG actual,
   así que las descartadas de versiones que ya no están en el bundle se auto-limpian. */
function descartarNovedad(version){
    if(!version||!AppState.datos)return;
    if(!Array.isArray(AppState.datos.dismissedVersions))AppState.datos.dismissedVersions=[];
    if(!AppState.datos.dismissedVersions.includes(version)){
        AppState.datos.dismissedVersions.push(version);
        guardaOptimista('update','config','dismissedVersions');
    }
    renderizarCentroNoticias();
    actualizarBadgeNoticias();
}
function marcarVersionVista(){
    const log=normalizarChangelog();
    if(!log.length)return;
    const latest=log[0].version; /* primer entry = más reciente */
    const cur=AppState.datos?.lastSeenVersion||'';
    if(cmpVersion(latest,cur)>0){
        AppState.datos.lastSeenVersion=latest;
        actualizarBadgeNoticias();
        guardaOptimista('update','config','lastSeenVersion');
    }
}
function abrirWhatsNew(entry){
    if(!entry)return;
    const cont=$('whatsNewContent');
    if(!cont)return;
    const changesHtml=entry.changes.slice(0,5).map(ch=>{
        const t=ch.type||'improve';
        return `<div class="whatsnew-change ${t}">
            <span class="whatsnew-change-dot"></span>
            <span><b>${escHtml(ch.title||'')}</b>${ch.desc?' — '+escHtml(ch.desc):''}</span>
        </div>`;
    }).join('');
    cont.innerHTML=`<div class="whatsnew-icon">🎉</div>
        <div class="whatsnew-version">Versión ${escHtml(entry.version)}</div>
        <div class="whatsnew-title">¡Nueva actualización!</div>
        ${entry.headline?`<div class="whatsnew-headline">${escHtml(entry.headline)}</div>`:''}
        <div class="whatsnew-changes">${changesHtml}</div>
        <div class="whatsnew-buttons">
            <button class="btn" style="background:#f1f5f9;color:#475569" id="btnWhatsNewLater">Después</button>
            <button class="btn" id="btnWhatsNewDetails">Ver detalles</button>
        </div>`;
    abrirModal('modalWhatsNew');
    /* Wire buttons (re-bind cada apertura porque innerHTML los recrea) */
    $('btnWhatsNewLater').onclick=()=>{cerrarModal('modalWhatsNew');marcarVersionVista()};
    $('btnWhatsNewDetails').onclick=()=>{cerrarModal('modalWhatsNew');abrirCentroNoticias()};
}
function chequearWhatsNewAlInicio(){
    /* Mostrar UNA sola vez tras detectar versión nueva */
    const log=normalizarChangelog();
    if(!log.length)return;
    const latest=log[0];
    const cur=AppState.datos?.lastSeenVersion||'';
    /* Solo mostrar modal si ya había datos previos (no es primera vez) y hay versión nueva */
    if(cur&&cmpVersion(latest.version,cur)>0){
        setTimeout(()=>abrirWhatsNew(latest),800);
    }else if(!cur){
        /* Primera vez en la app — silenciosamente marcar como visto sin modal intrusivo */
        AppState.datos.lastSeenVersion=latest.version;
        actualizarBadgeNoticias();
    }
}

async function cargarHistorialMensual(){
    const cont=$('historialContent');
    cont.innerHTML='<div style="text-align:center;padding:30px;color:#94a3b8">Cargando...</div>';
    abrirModal('modalHistorial');
    try{
        const snap=await AppState.db.collection('users').doc(AppState.currentUser.uid)
            .collection('monthly_summaries').orderBy('mes','desc').limit(12).get();
        if(snap.empty){
            cont.innerHTML='<div style="text-align:center;padding:30px;color:#94a3b8"><div style="font-size:2em;margin-bottom:8px">📭</div><div>Sin datos históricos</div><div style="font-size:0.8em;margin-top:4px">El primer cierre se genera al cambiar de mes</div></div>';
            return;
        }
        const meses=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const mesesCortos=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        const docs=[];snap.forEach(doc=>docs.push(doc.data()));
        AppState.ui._historialDocs=docs;AppState.ui._historialMesesCortos=mesesCortos;
        /* Init compare default: two most recent months */
        if(!AppState.ui._compareA)AppState.ui._compareA=docs[0]?.mes||'';
        if(!AppState.ui._compareB)AppState.ui._compareB=docs[1]?.mes||docs[0]?.mes||'';
        const view=AppState.ui._resumenView||'months';
        /* Toolbar */
        let h=`<div class="resumen-toolbar">
            <button class="resumen-toolbar-btn ${view==='months'?'active':''}" data-action="resumen-view" data-view="months">📋 Meses</button>
            <button class="resumen-toolbar-btn ${view==='compare'?'active':''}" data-action="resumen-view" data-view="compare">⚖️ Comparar</button>
        </div>`;
        if(view==='compare'){
            /* Compare view */
            const optsA=docs.map(d=>{const p=d.mes.split('-');return `<option value="${d.mes}"${AppState.ui._compareA===d.mes?' selected':''}>${mesesCortos[parseInt(p[1])-1]} ${p[0]}</option>`}).join('');
            const optsB=docs.map(d=>{const p=d.mes.split('-');return `<option value="${d.mes}"${AppState.ui._compareB===d.mes?' selected':''}>${mesesCortos[parseInt(p[1])-1]} ${p[0]}</option>`}).join('');
            const aDoc=docs.find(d=>d.mes===AppState.ui._compareA);
            const bDoc=docs.find(d=>d.mes===AppState.ui._compareB);
            h+=`<div class="compare-panel">
                <div class="compare-selectors">
                    <select id="compareSelA">${optsA}</select>
                    <span class="compare-vs">VS</span>
                    <select id="compareSelB">${optsB}</select>
                </div>
                ${_renderCompareDiff(aDoc,bDoc,mesesCortos)}
            </div>`;
            /* Monthly progression chart */
            if(docs.length>=2){
                h+=`<div class="resumen-chart-card">
                    <div class="resumen-chart-title">Evolución mensual · Ganancia neta</div>
                    ${_chartMensual(docs,mesesCortos)}
                </div>`;
            }
        }else{
            /* Months list (collapsible) */
            const collapsed=AppState.ui._collapsedMonths||{};
            docs.forEach((d,i)=>{
                const next=docs[i+1];
                const p=d.mes.split('-'),yr=p[0],mn=parseInt(p[1])-1;
                const op=d.operaciones||{};
                const total=op.total||0;
                const gananciaOperativa=d.gananciaTotal||0;
                const gastos=d.totalEgresoUYU||0;
                const comBanc=d.comisionBancariaTotal||0;
                const ingresosExternos=d.ingresosExternosTotal||0;
                const gananciaNeta=roundMoney(gananciaOperativa-gastos-comBanc);
                /* Resultado total = ganancia P2P neta + ingresos externos.
                   Útil para ver la posición económica real del mes. */
                const resultadoTotal=roundMoney(gananciaNeta+ingresosExternos);
                const gc=gananciaNeta>=0?'positive':'negative',gs=gananciaNeta>=0?'+':'-';

                /* Variation vs previous month */
                let varHtml='';
                if(next){
                    const prevOp=next.gananciaTotal||0,prevG=next.totalEgresoUYU||0,prevB=next.comisionBancariaTotal||0;
                    const prevNeta=roundMoney(prevOp-prevG-prevB);
                    const diff=roundMoney(gananciaNeta-prevNeta);
                    let pct='—';
                    if(prevNeta!==0)pct=Math.abs(Math.round(diff/Math.abs(prevNeta)*100))+'%';
                    const cls=diff>0?'up':(diff<0?'down':'flat');
                    const arrow=diff>0?'↑':(diff<0?'↓':'→');
                    const sign=diff>=0?'+':'-';
                    const prevName=mesesCortos[parseInt(next.mes.split('-')[1])-1];
                    varHtml=`<div class="resumen-variation ${cls}">${arrow} ${sign}$${fmtNum(Math.abs(diff),0)} (${pct}) vs ${prevName}</div>`;
                }

                /* Rentability metrics */
                const spread=d.spreadPromedio;
                const gPorOp=total?roundMoney(gananciaNeta/total):0;
                const diasMes=new Date(parseInt(yr),parseInt(p[1]),0).getDate();
                const gPorDia=diasMes?roundMoney(gananciaNeta/diasMes):0;
                const comPlat=d.comisionesTotal||0;

                /* Position */
                const balUsdt=d.saldoUsdt||0;
                const lotes=d.lotesAlCierre;
                const capitalOp=d.capitalOperado||roundMoney((op.montoCompras||0)+(op.montoVentas||0));
                const banSnap=d.bancosSnapshot||{};
                let saldoUYU=0,saldoUSD=0;
                Object.values(banSnap).forEach(b=>{if(b.moneda==='UYU')saldoUYU+=b.saldo||0;else saldoUSD+=b.saldo||0});

                /* Gastos */
                const gt=d.gastosTag||{};
                const gtKeys=Object.keys(gt).sort((a,b)=>(gt[b].totalUYU||0)-(gt[a].totalUYU||0));
                const totalGastos=d.totalEgresoUYU||0;
                const gastosPctVolumen=capitalOp>0?(Math.round(totalGastos/capitalOp*1000)/10):0;

                /* Insights */
                const mejorDia=d.mejorDia,peorDia=d.peorDia,bancoMasUsado=d.bancoMasUsado;
                const insightsHtml=(mejorDia||peorDia||bancoMasUsado)?`<div class="resumen-insights">
                    ${mejorDia?`<div class="resumen-insight">📈 Mejor día: <b style="color:#16a34a;margin-left:auto">${fmtFechaCorta(mejorDia.dia)} · ${mejorDia.ganancia>=0?'+':'-'}$${fmtNum(Math.abs(mejorDia.ganancia),0)}</b></div>`:''}
                    ${peorDia&&peorDia.dia!==mejorDia?.dia?`<div class="resumen-insight">📉 Peor día: <b style="color:#dc2626;margin-left:auto">${fmtFechaCorta(peorDia.dia)} · ${peorDia.ganancia>=0?'+':'-'}$${fmtNum(Math.abs(peorDia.ganancia),0)}</b></div>`:''}
                    ${bancoMasUsado?`<div class="resumen-insight">🏦 Banco más usado: <b style="color:#475569;margin-left:auto">${escHtml(bancoMasUsado.banco)} (${bancoMasUsado.ops} ops)</b></div>`:''}
                </div>`:'';

                /* Determine initial collapse state: first month open, rest collapsed by default */
                const isCollapsed=collapsed[d.mes]!==undefined?collapsed[d.mes]:i>0;
                const chartType=(AppState.ui._chartTypes&&AppState.ui._chartTypes[d.mes])||'barras';

                h+=`<div class="resumen-mes${isCollapsed?' collapsed':''}" data-mes="${d.mes}">
                  <div class="resumen-header" data-action="resumen-toggle" data-mes="${d.mes}">
                    <div class="resumen-header-top">
                      <span class="resumen-mes-name">${meses[mn]} ${yr}</span>
                      ${varHtml}
                      <span class="resumen-header-chevron">▼</span>
                    </div>
                    <div class="resumen-ganancia-label">Ganancia neta del mes</div>
                    <div class="resumen-ganancia-value ${gc}">${gs}$${fmtNum(Math.abs(gananciaNeta),0)}</div>
                  </div>

                  <div class="resumen-body">
                  <div class="resumen-section">
                    <div class="resumen-section-title">Actividad</div>
                    <div class="resumen-grid">
                      <div><div class="resumen-cell-label">Compras</div><div class="resumen-cell-value">${op.compras||0}</div><div class="resumen-cell-sub">$${fmtNum(op.montoCompras||0,0)}</div></div>
                      <div><div class="resumen-cell-label">Ventas</div><div class="resumen-cell-value">${op.ventas||0}</div><div class="resumen-cell-sub">$${fmtNum(op.montoVentas||0,0)}</div></div>
                      <div><div class="resumen-cell-label">Ajustes</div><div class="resumen-cell-value">${d.movimientos||0}</div></div>
                      <div><div class="resumen-cell-label">Transferencias</div><div class="resumen-cell-value">${d.transferencias||0}</div></div>
                    </div>
                    <div class="resumen-chart-card">
                      <div class="resumen-chart-title">
                        <span>Visualización</span>
                        <span class="resumen-chart-tabs">
                          <button class="resumen-chart-tab ${chartType==='barras'?'active':''}" data-action="resumen-chart" data-mes="${d.mes}" data-chart="barras">📊 Barras</button>
                          <button class="resumen-chart-tab ${chartType==='dona'?'active':''}" data-action="resumen-chart" data-mes="${d.mes}" data-chart="dona">🍩 Gastos</button>
                        </span>
                      </div>
                      ${_resumenChartHtml(d,mesesCortos,chartType)}
                    </div>
                  </div>

                  <div class="resumen-section">
                    <div class="resumen-section-title">Rentabilidad</div>
                    <div class="resumen-grid">
                      <div><div class="resumen-cell-label">Spread promedio</div><div class="resumen-cell-value">${spread!==undefined?'$'+fmtNum(spread,2):'—'}</div></div>
                      <div><div class="resumen-cell-label">Comisión Binance</div><div class="resumen-cell-value">${fmtNum(comPlat,2)} <span style="font-size:0.7em;color:#94a3b8;font-weight:500">USDT</span></div></div>
                      <div><div class="resumen-cell-label">Ganancia / op</div><div class="resumen-cell-value ${gPorOp>=0?'positive':'negative'}">${gPorOp>=0?'+':'-'}$${fmtNum(Math.abs(gPorOp),0)}</div></div>
                      <div><div class="resumen-cell-label">Ganancia / día</div><div class="resumen-cell-value ${gPorDia>=0?'positive':'negative'}">${gPorDia>=0?'+':'-'}$${fmtNum(Math.abs(gPorDia),0)}</div></div>
                    </div>
                    <div class="resumen-breakdown">
                      <div class="resumen-breakdown-row"><span>Ganancia operativa P2P</span><b class="${gananciaOperativa>=0?'positive':'negative'}">${gananciaOperativa>=0?'+':'-'}$${fmtNum(Math.abs(gananciaOperativa),0)}</b></div>
                      ${comBanc>0?`<div class="resumen-breakdown-row"><span>− Comisiones bancarias</span><b class="negative">-$${fmtNum(comBanc,0)}</b></div>`:''}
                      <div class="resumen-breakdown-row"><span>− Gastos del mes</span><b class="negative">-$${fmtNum(gastos,0)}</b></div>
                      <div class="resumen-breakdown-row total"><span>Ganancia neta P2P</span><b class="${gc}">${gs}$${fmtNum(Math.abs(gananciaNeta),0)}</b></div>
                      ${ingresosExternos>0.005?`<div class="resumen-breakdown-row" style="margin-top:8px;padding-top:8px;border-top:1px dashed #cbd5e1"><span>+ Ingresos externos</span><b class="positive">+$${fmtNum(ingresosExternos,0)}</b></div>
                      <div class="resumen-breakdown-row total"><span>Resultado total del mes</span><b class="${resultadoTotal>=0?'positive':'negative'}">${resultadoTotal>=0?'+':'-'}$${fmtNum(Math.abs(resultadoTotal),0)}</b></div>`:''}
                    </div>
                  </div>

                  <div class="resumen-section">
                    <div class="resumen-section-title">Posición al cierre</div>
                    <div class="resumen-grid">
                      <div><div class="resumen-cell-label">Balance USDT</div><div class="resumen-cell-value balance">${fmtTrunc(balUsdt,2)}</div></div>
                      <div><div class="resumen-cell-label">Lotes activos</div><div class="resumen-cell-value">${lotes!==undefined?lotes:'—'}</div></div>
                      <div><div class="resumen-cell-label">Saldo UYU</div><div class="resumen-cell-value balance">$${fmtNum(saldoUYU,0)}</div></div>
                      <div><div class="resumen-cell-label">Capital operado</div><div class="resumen-cell-value">$${fmtNum(capitalOp,0)}</div></div>
                      ${saldoUSD>0?`<div><div class="resumen-cell-label">Saldo USD</div><div class="resumen-cell-value balance">US$${fmtNum(saldoUSD,0)}</div></div>`:''}
                    </div>
                  </div>

                  ${gtKeys.length?`
                  <div class="resumen-section">
                    <div class="resumen-section-title">Gastos · $${fmtNum(totalGastos,0)} <span style="color:#cbd5e1;font-weight:500">·</span> <span style="color:#94a3b8;font-weight:600;text-transform:none;letter-spacing:0">${gastosPctVolumen}% del volumen</span></div>
                    ${gtKeys.slice(0,5).map(k=>{
                        const v=gt[k].totalUYU||0;
                        const pct=totalGastos?Math.round(v/totalGastos*100):0;
                        return `<div class="resumen-gastos-bar">
                          <span class="resumen-gastos-name">${escHtml(k)}</span>
                          <div class="resumen-gastos-bar-track"><div class="resumen-gastos-bar-fill" style="width:${pct}%"></div></div>
                          <span class="resumen-gastos-amount">$${fmtNum(v,0)} · ${pct}%</span>
                        </div>`;
                    }).join('')}
                  </div>
                  `:''}
                  ${insightsHtml}
                  </div>
                </div>`;
            });
        }
        cont.innerHTML=h;
        /* Wire compare selectors */
        if(view==='compare'){
            const selA=$('compareSelA'),selB=$('compareSelB');
            if(selA)selA.addEventListener('change',e=>{AppState.ui._compareA=e.target.value;cargarHistorialMensual()});
            if(selB)selB.addEventListener('change',e=>{AppState.ui._compareB=e.target.value;cargarHistorialMensual()});
        }
    }catch(e){
        console.error('[P2P] Error cargando historial:',e);
        cont.innerHTML='<div style="text-align:center;padding:30px;color:#dc2626"><div style="font-size:2em;margin-bottom:8px">⚠️</div><div>Error al cargar historial</div></div>';
    }
}
function ocultarLoading() { $('loadingOverlay')?.classList.add('hidden'); }
function activarCooldown() {
    AppState.ui.enCooldown=true;
    setTimeout(()=>{ AppState.ui.enCooldown=false; },CONFIG.COOLDOWN_MS);
}

/* ═══ Performance instrumentation ═══ */
const _perf={enabled:false,log(name,ms){if(this.enabled||ms>100)console.log(`[PERF] ${name}: ${ms.toFixed(1)}ms`)}};
function perfWrap(name,fn){return function(){const t0=performance.now();const r=fn.apply(this,arguments);_perf.log(name,performance.now()-t0);return r}}

/* ═══ Debounced actualizarVista ═══
   actualizarVistaDebounced agrupa múltiples llamadas en un solo frame.
   Las rutas críticas que disparan mutación + render se benefician automáticamente
   si llaman actualizarVistaDebounced en lugar de actualizarVista directo. */
let _vistaRAF=0;
function actualizarVistaDebounced(){if(_vistaRAF)return;_vistaRAF=requestAnimationFrame(()=>{_vistaRAF=0;actualizarVista()})}

