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
    cont.innerHTML=`<div class="whatsnew-icon"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg></div>
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
            cont.innerHTML='<div style="text-align:center;padding:30px;color:#94a3b8"><div style="font-size:2em;margin-bottom:8px"><svg class="empty-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h11M8 12h11M8 18h11M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg></div><div>Sin datos históricos</div><div style="font-size:0.8em;margin-top:4px">El primer cierre se genera al cambiar de mes</div></div>';
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
                    ${mejorDia?`<div class="resumen-insight"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 7-7M14 8h7v7"/></svg> Mejor día: <b style="color:#16a34a;margin-left:auto">${fmtFechaCorta(mejorDia.dia)} · ${mejorDia.ganancia>=0?'+':'-'}$${fmtNum(Math.abs(mejorDia.ganancia),0)}</b></div>`:''}
                    ${peorDia&&peorDia.dia!==mejorDia?.dia?`<div class="resumen-insight"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l6 6 4-4 7 7M14 16h7v-7"/></svg> Peor día: <b style="color:#dc2626;margin-left:auto">${fmtFechaCorta(peorDia.dia)} · ${peorDia.ganancia>=0?'+':'-'}$${fmtNum(Math.abs(peorDia.ganancia),0)}</b></div>`:''}
                    ${bancoMasUsado?`<div class="resumen-insight"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10h18M4 10V9l8-5 8 5v1M6 10v7M10 10v7M14 10v7M18 10v7M3 20h18"/></svg> Banco más usado: <b style="color:#475569;margin-left:auto">${escHtml(bancoMasUsado.banco)} (${bancoMasUsado.ops} ops)</b></div>`:''}
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
                          <button class="resumen-chart-tab ${chartType==='barras'?'active':''}" data-action="resumen-chart" data-mes="${d.mes}" data-chart="barras"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V10M10 19V5M16 19v-6M22 19H2"/></svg> Barras</button>
                          <button class="resumen-chart-tab ${chartType==='dona'?'active':''}" data-action="resumen-chart" data-mes="${d.mes}" data-chart="dona"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15.5A9 9 0 118.5 3v9h9a9 9 0 013.5 3.5z"/><path d="M20.9 9.5A9 9 0 0014.5 3.1V9.5h6.4z"/></svg> Gastos</button>
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
        cont.innerHTML='<div style="text-align:center;padding:30px;color:#dc2626"><div style="margin-bottom:8px"><svg class="ico ico-alerta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z"/></svg></div><div>Error al cargar historial</div></div>';
    }
}
function ocultarLoading() { $('loadingOverlay')?.classList.add('hidden'); }

/* ═══════════════════════════════════════════════════════════════════
   §CLIENT-TERMINATED BANNER v4.7.42
   ═══════════════════════════════════════════════════════════════════
   Banner persistente cuando Firebase SDK queda en estado 'terminated'.
   La app sigue 100% usable en modo local. El banner sirve para:
     - informar al usuario que sus datos están guardados localmente
     - ofrecer recarga inmediata (reinicializa el SDK desde cero)
     - ofrecer seguir trabajando en modo local hasta que el usuario decida
   
   Idempotente: si ya está visible, no se duplica.
   Cierre por usuario: oculta el banner PERO mantiene AppState._clientTerminated=true
   para que ningún save remoto se ejecute hasta el reload. */
function mostrarBannerClienteTerminado(){
    if(document.getElementById('clientTerminatedBanner'))return;
    const banner=document.createElement('div');
    banner.id='clientTerminatedBanner';
    banner.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#7c2d12;color:#fff;padding:14px 16px;box-shadow:0 -4px 12px rgba(0,0,0,0.3);font-size:0.92em;line-height:1.4;border-top:3px solid #f59e0b';
    banner.innerHTML=
        '<div style="max-width:600px;margin:0 auto">'+
            '<div style="font-weight:600;margin-bottom:6px"><svg class="ico ico-alerta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z"/></svg> Sincronización detenida</div>'+
            '<div style="margin-bottom:10px;color:#fed7aa">Firebase quedó en estado interno inválido. Tus datos están guardados localmente. Recargá la app para reactivar la sincronización.</div>'+
            '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
                '<button id="btnClientTermReload" style="flex:1;min-width:140px;background:#16a34a;color:#fff;border:none;padding:10px 14px;border-radius:6px;font-weight:600;cursor:pointer;font-size:0.95em">🔄 Recargar ahora</button>'+
                '<button id="btnClientTermDismiss" style="flex:1;min-width:140px;background:transparent;color:#fed7aa;border:1px solid #fed7aa;padding:10px 14px;border-radius:6px;font-weight:500;cursor:pointer;font-size:0.95em">Seguir en modo local</button>'+
            '</div>'+
        '</div>';
    document.body.appendChild(banner);
    const btnReload=document.getElementById('btnClientTermReload');
    if(btnReload)btnReload.addEventListener('click',()=>{
        try{if(typeof flushGuardaDebounce==='function')flushGuardaDebounce()}catch(_){}
        try{if(typeof backupToLocal==='function')backupToLocal()}catch(_){}
        setTimeout(()=>location.reload(),100);
    });
    const btnDismiss=document.getElementById('btnClientTermDismiss');
    if(btnDismiss)btnDismiss.addEventListener('click',()=>{
        banner.style.display='none';
        /* IMPORTANTE: solo ocultamos visualmente. AppState._clientTerminated sigue true
           para bloquear nuevos saves. Eso lo gestiona guardarDatos directamente. */
    });
}
function activarCooldown() {
    AppState.ui.enCooldown=true;
    setTimeout(()=>{ AppState.ui.enCooldown=false; },CONFIG.COOLDOWN_MS);
}

/* ═══ Performance instrumentation ═══ */
const _perf={enabled:false,log(name,ms){if(this.enabled||ms>100)console.log(`[PERF] ${name}: ${ms.toFixed(1)}ms`)}};

/* ═══ Debounced actualizarVista ═══
   actualizarVistaDebounced agrupa múltiples llamadas en un solo frame.
   Las rutas críticas que disparan mutación + render se benefician automáticamente
   si llaman actualizarVistaDebounced en lugar de actualizarVista directo. */
let _vistaRAF=0;