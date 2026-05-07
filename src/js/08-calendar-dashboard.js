/* ═══════════════════════════════════════════════════════════════════
   08-calendar-dashboard.js
   Generated piece — concatenated into dist/index.html by build/build.js
   Source of truth: src/js/08-calendar-dashboard.js
   Do NOT edit dist/index.html directly. Edit the source and re-run build.
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════
   §12 — CALENDARIO
   ═══════════════════════════════════════ */
/* Cache for ganancia calculations — invalidated by data version changes.
   Per-moneda slots (Map) para que distintos filtros no se pisen mutuamente. */
const _gananciaCache={diaria:new Map(),total:new Map(),key:null};
function _gananciaCacheKey(monedaFiltro){
    const v=AppState.datos._version||0;
    const opsLen=AppState.datos.operaciones.length,movsLen=AppState.datos.movimientos.length;
    const bump=AppState.ui._cacheBump||0;
    return (monedaFiltro||'_all')+'|'+v+'|'+opsLen+'|'+movsLen+'|'+bump;
}
function invalidarGananciaCache(){
    _gananciaCache.diaria.clear();
    _gananciaCache.total.clear();
    _gananciaCache.key=null;
    AppState.ui._cacheBump=(AppState.ui._cacheBump||0)+1;
}
/* ═══ Ingresos externos (separados de ganancia P2P) ═══
   Suma monto en UYU de TODOS los ingresos registrados desde Ajustes
   (banco UYU, banco USD convertido, USDT con tasaRef).
   No participan en cálculo de ganancia P2P — son una métrica paralela. */
function calcularIngresosExternosDia(fecha){
    if(!fecha)return 0;
    const tasaFb=AppState.datos.ultimaTasaCompra||1;
    let total=0;
    AppState.datos.movimientos.forEach(m=>{
        if(m.tipoMovimiento!=='ingreso'||m.fecha!==fecha)return;
        total=roundMoney(total+movimientoValorUYU(m,tasaFb));
    });
    return total;
}
function calcularIngresosExternosMes(yyyy_mm){
    if(!yyyy_mm)return 0;
    const tasaFb=AppState.datos.ultimaTasaCompra||1;
    let total=0;
    AppState.datos.movimientos.forEach(m=>{
        if(m.tipoMovimiento!=='ingreso'||!m.fecha?.startsWith(yyyy_mm))return;
        total=roundMoney(total+movimientoValorUYU(m,tasaFb));
    });
    return total;
}

function calcularGananciaDiaria(monedaFiltro){
    const key=_gananciaCacheKey(monedaFiltro);
    const cached=_gananciaCache.diaria.get(key);
    if(cached)return cached;
    const g={};AppState.datos.operaciones.forEach(op=>{
        if(monedaFiltro&&op.moneda!==monedaFiltro)return;
        if(!monedaFiltro&&op.moneda==='USD')return;
        if(!g[op.fecha])g[op.fecha]=0;if(op.ganancia!==undefined)g[op.fecha]=roundMoney(g[op.fecha]+op.ganancia)});
    if(!monedaFiltro||monedaFiltro==='UYU'){
        const tasaFb=AppState.datos.ultimaTasaCompra||1;
        AppState.datos.movimientos.forEach(mv=>{if(mv.tipoMovimiento==='egreso'){if(!g[mv.fecha])g[mv.fecha]=0;g[mv.fecha]=roundMoney(g[mv.fecha]-movimientoValorUYU(mv,tasaFb))}});
    }
    _gananciaCache.diaria.set(key,g);
    return g;
}
function calcularGananciaTotal(monedaFiltro){
    const key=_gananciaCacheKey(monedaFiltro);
    const cached=_gananciaCache.total.get(key);
    if(cached!==undefined)return cached;
    let g=0;AppState.datos.operaciones.forEach(op=>{
        if(monedaFiltro&&op.moneda!==monedaFiltro)return;
        if(!monedaFiltro&&op.moneda==='USD')return;
        if(op.ganancia!==undefined)g=roundMoney(g+op.ganancia)});
    if(!monedaFiltro||monedaFiltro==='UYU'){
        const tasaFb=AppState.datos.ultimaTasaCompra||1;
        AppState.datos.movimientos.forEach(mv=>{if(mv.tipoMovimiento==='egreso')g=roundMoney(g-movimientoValorUYU(mv,tasaFb))});
    }
    _gananciaCache.total.set(key,g);
    return g;
}

const _dayStatsCache={data:new Map(),key:null};
function getDayStats(fecha){
    if(!fecha)return null;
    const cacheKey=_gananciaCacheKey('_ds');
    if(_dayStatsCache.key!==cacheKey){_dayStatsCache.data.clear();_dayStatsCache.key=cacheKey}
    if(_dayStatsCache.data.has(fecha))return _dayStatsCache.data.get(fecha);
    const ops=AppState.datos.operaciones.filter(o=>o.fecha===fecha&&o.moneda!=='USD');
    const movs=AppState.datos.movimientos.filter(m=>m.fecha===fecha);
    const trans=AppState.datos.transferencias.filter(t=>t.fecha===fecha);
    let compras=0,ventas=0,montoCompras=0,montoVentas=0,gananciaOps=0,sumTasaC=0,sumTasaV=0;
    ops.forEach(op=>{
        if(op.tipo==='compra'){compras++;montoCompras=roundMoney(montoCompras+op.monto);sumTasaC+=op.tasa}
        else{ventas++;montoVentas=roundMoney(montoVentas+op.monto);sumTasaV+=op.tasa}
        gananciaOps=roundMoney(gananciaOps+(op.ganancia||0));
    });
    const tasaPromC=compras?roundMoney(sumTasaC/compras):0;
    const tasaPromV=ventas?roundMoney(sumTasaV/ventas):0;
    const spread=(compras&&ventas)?roundMoney(tasaPromV-tasaPromC):0;
    const tasaFb=AppState.datos.ultimaTasaCompra||1;
    let gastos=0;
    movs.forEach(m=>{if(m.tipoMovimiento==='egreso')gastos=roundMoney(gastos+movimientoValorUYU(m,tasaFb))});
    const gananciaNeta=roundMoney(gananciaOps-gastos);
    const result={fecha,ops:ops.length,compras,ventas,montoCompras,montoVentas,ajustes:movs.length,transferencias:trans.length,spread,gananciaOps,gastos,gananciaNeta,tasaPromC,tasaPromV};
    _dayStatsCache.data.set(fecha,result);
    return result;
}
function mostrarDetalleDia(fecha){
    AppState.ui.calSelectedDay=fecha;
    renderizarCalendario();
}
function cerrarDetalleDia(){
    AppState.ui.calSelectedDay=null;
    renderizarCalendario();
}
function renderizarCalendario(){
    const y=AppState.ui.calendarDate.getFullYear(),mo=AppState.ui.calendarDate.getMonth();
    setText('calendarMonth',`${y}-${String(mo+1).padStart(2,'0')}`);
    const fd=new Date(y,mo,1).getDay(),dm=new Date(y,mo+1,0).getDate(),hoy=getUDate(),g=calcularGananciaDiaria();
    /* Compute max abs value for intensity buckets */
    let maxAbs=0;
    for(let d=1;d<=dm;d++){const ds=`${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const v=Math.abs(g[ds]||0);if(v>maxAbs)maxAbs=v}
    const sel=AppState.ui.calSelectedDay;
    /* ═══ Métricas mensuales ═══
       Tenemos DOS conjuntos de métricas con propósitos distintos:

       1) NETO DIARIO (Mes + / Mes −) — lectura agregada por días:
          tg = Σ val donde val>0  (días que cerraron en positivo)
          tp = Σ |val| donde val<0  (días que cerraron en negativo)
          Útil porque dentro de un día, ganancias y egresos se compensan naturalmente:
          si hiciste +$5.000 y gastaste $1.000, terminás +$4.000. Eso refleja el "día"
          como unidad económica. Suma todos los días positivos y negativos por separado.

       2) BRUTAS (Ganancia bruta / Pérdidas + Egresos) — lectura por concepto:
          gananciasMes = Σ op.ganancia donde >0 (lo que entró por trading exitoso)
          perdidasOps  = Σ op.ganancia donde <0 (operaciones que dieron pérdida)
          egresosMes   = Σ egresos del mes (gastos reales)
          Útil para ver el flujo crudo sin compensaciones diarias.

       Mejor/Peor día siguen siendo neto diario (lo más útil para análisis).
       Promedio = (Mes+ − Mes−) / días activos = neto del mes / días activos. */
    let h='',tg=0,tp=0,gananciasMes=0,perdidasOps=0,egresosMes=0,diasActivos=0,mejor=null,peor=null;
    /* Sumas brutas: pre-calculadas desde primitivos (ops del mes + egresos del mes) */
    const yyyy_mm=`${y}-${String(mo+1).padStart(2,'0')}`;
    AppState.datos.operaciones.forEach(op=>{
        if(op.moneda==='USD'||!op.fecha?.startsWith(yyyy_mm))return;
        const gn=op.ganancia||0;
        if(gn>0)gananciasMes=roundMoney(gananciasMes+gn);
        else if(gn<0)perdidasOps=roundMoney(perdidasOps+gn); /* mantiene el signo negativo */
    });
    const _tasaFbCal=AppState.datos.ultimaTasaCompra||1;
    AppState.datos.movimientos.forEach(mv=>{
        if(mv.tipoMovimiento!=='egreso'||!mv.fecha?.startsWith(yyyy_mm))return;
        egresosMes=roundMoney(egresosMes+movimientoValorUYU(mv,_tasaFbCal));
    });
    for(let i=0;i<fd;i++)h+='<div class="calendar-day empty"></div>';
    for(let d=1;d<=dm;d++){
        const ds=`${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const val=g[ds]||0,isH=hoy.getFullYear()===y&&hoy.getMonth()===mo&&hoy.getDate()===d;
        const isSel=sel===ds;
        let cls='calendar-day';
        if(val===0)cls+=' neutral';
        else{
            diasActivos++;
            const ratio=maxAbs>0?Math.abs(val)/maxAbs:0;
            const lvl=ratio>0.66?3:(ratio>0.33?2:1);
            cls+=val>0?' positive-'+lvl:' negative-'+lvl;
            /* Acumular tg/tp por día (compensación natural de ganancias y egresos del mismo día) */
            if(val>0){tg=roundMoney(tg+val);if(!mejor||val>mejor.val)mejor={dia:d,val,ds}}
            else{tp=roundMoney(tp+Math.abs(val));if(!peor||val<peor.val)peor={dia:d,val,ds}}
        }
        if(isH)cls+=' today';
        if(isSel)cls+=' selected';
        const vs=val!==0?(val>0?'+':'')+fmtNum(val,0):'';
        const vc=val>0?'pos':val<0?'neg':'';
        h+=`<div class="${cls}" data-action="cal-day" data-date="${ds}"><div class="calendar-day-number">${d}</div><div class="calendar-day-value ${vc}">${vs}</div></div>`;
    }
    setHtml('calendarDays',h);

    /* Day detail panel */
    const det=$('calendarDayDetail');
    if(det){
        if(sel){
            const stats=getDayStats(sel);
            const p=sel.split('-'),fechaTxt=`${p[2]}/${p[1]}/${p[0]}`;
            const gn=stats.gananciaNeta,gnCls=gn>=0?'positive':'negative',gnSign=gn>=0?'+':'-';
            const totalActividad=stats.ops+stats.ajustes+stats.transferencias;
            if(totalActividad===0){
                det.innerHTML=`<div class="calendar-day-detail"><div class="calendar-day-detail-header"><div><div class="calendar-day-detail-date">${fechaTxt}</div></div><button class="calendar-day-detail-close" data-action="cal-day-close" aria-label="Cerrar">×</button></div><div class="calendar-day-detail-empty">Sin actividad este día</div></div>`;
            }else{
                det.innerHTML=`<div class="calendar-day-detail">
                    <div class="calendar-day-detail-header">
                        <div>
                            <div class="calendar-day-detail-date">${fechaTxt}</div>
                            <div class="calendar-day-detail-ganancia ${gnCls}">${gnSign}$${fmtNum(Math.abs(gn),0)}</div>
                            <div style="font-size:0.62em;color:#94a3b8;margin-top:1px">Ganancia neta del día</div>
                        </div>
                        <button class="calendar-day-detail-close" data-action="cal-day-close" aria-label="Cerrar">×</button>
                    </div>
                    <div class="calendar-day-detail-grid">
                        <div class="calendar-day-detail-cell"><div class="calendar-day-detail-cell-label">Operaciones</div><div class="calendar-day-detail-cell-value">${stats.ops}</div>${stats.ops>0?`<div class="calendar-day-detail-cell-sub">${stats.compras}C · ${stats.ventas}V</div>`:''}</div>
                        <div class="calendar-day-detail-cell"><div class="calendar-day-detail-cell-label">Spread promedio</div><div class="calendar-day-detail-cell-value">${stats.spread?'$'+fmtNum(stats.spread,2):'—'}</div></div>
                        ${stats.compras>0?`<div class="calendar-day-detail-cell"><div class="calendar-day-detail-cell-label">Compras</div><div class="calendar-day-detail-cell-value">${stats.compras}</div><div class="calendar-day-detail-cell-sub">$${fmtNum(stats.montoCompras,0)}</div></div>`:''}
                        ${stats.ventas>0?`<div class="calendar-day-detail-cell"><div class="calendar-day-detail-cell-label">Ventas</div><div class="calendar-day-detail-cell-value">${stats.ventas}</div><div class="calendar-day-detail-cell-sub">$${fmtNum(stats.montoVentas,0)}</div></div>`:''}
                        ${stats.ajustes>0?`<div class="calendar-day-detail-cell"><div class="calendar-day-detail-cell-label">Ajustes</div><div class="calendar-day-detail-cell-value">${stats.ajustes}</div></div>`:''}
                        ${stats.transferencias>0?`<div class="calendar-day-detail-cell"><div class="calendar-day-detail-cell-label">Transferencias</div><div class="calendar-day-detail-cell-value">${stats.transferencias}</div></div>`:''}
                        ${stats.gastos>0?`<div class="calendar-day-detail-cell"><div class="calendar-day-detail-cell-label">Gastos</div><div class="calendar-day-detail-cell-value" style="color:#dc2626">-$${fmtNum(stats.gastos,0)}</div></div>`:''}
                        ${stats.gananciaOps!==0?`<div class="calendar-day-detail-cell"><div class="calendar-day-detail-cell-label">Ganancia ops</div><div class="calendar-day-detail-cell-value" style="color:${stats.gananciaOps>=0?'#16a34a':'#dc2626'}">${stats.gananciaOps>=0?'+':'-'}$${fmtNum(Math.abs(stats.gananciaOps),0)}</div></div>`:''}
                    </div>
                </div>`;
            }
        }else det.innerHTML='';
    }

    const gt=calcularGananciaTotal(),ge=$('calGananciaTotal');ge.textContent=(gt>=0?'+':'-')+'$'+fmtNum(Math.abs(gt),0);ge.className='calendar-stat-value '+(gt>=0?'positive':'negative');
    /* Mes + / Mes − : neto diario (días positivos vs días negativos).
       Dentro de un día, ganancias y egresos se compensan: si entraste +$5.000 y gastaste $1.000,
       contás como +$4.000 en Mes+. Refleja el "día" como unidad económica. */
    setText('calGanancias','+$'+fmtNum(tg,0));setText('calPerdidas','-$'+fmtNum(tp,0));
    // USD total
    const calUSDBox=$('calGananciaUSDBox'),calUSD=$('calGananciaUSD');
    if(calUSD&&calUSDBox){if(hayBancosUSD()){const gtU=calcularGananciaTotal('USD');calUSDBox.style.display='';calUSD.textContent=(gtU>=0?'+':'-')+'US$'+fmtNum(Math.abs(gtU),0);calUSD.className='calendar-stat-value '+(gtU>=0?'positive':'negative')}else calUSDBox.style.display='none'}

    /* Month metrics — 6 tarjetas en grid 3×2:
         Fila 1 (mensuales brutos): Ganancia bruta · Pérdidas+Egresos · Neto del mes
         Fila 2 (por día):          Mejor día · Peor día · Prom/día
       
       Brutas: muestran el flujo crudo del mes sin compensaciones diarias.
         Ganancia bruta   = Σ ops con ganancia >0 (toda la ganancia operativa real)
         Pérdidas+Egresos = |ops con ganancia <0| + Σ egresos del mes
         Neto del mes     = Mes+ − Mes− (suma de netos diarios)
       
       Promedio = Neto / días activos. */
    const metr=$('calMetrics');
    if(metr){
        const netoMes=roundMoney(tg-tp);
        const netoCls=netoMes>=0?'positive':'negative',netoSign=netoMes>=0?'+':'-';
        const promedio=diasActivos>0?roundMoney(netoMes/diasActivos):0;
        const promCls=promedio>=0?'positive':'negative',promSign=promedio>=0?'+':'-';
        const perdidasYEgresos=roundMoney(Math.abs(perdidasOps)+egresosMes);
        if(diasActivos===0){metr.innerHTML='<div style="grid-column:span 3;text-align:center;padding:8px;color:#94a3b8;font-size:0.7em">Sin actividad este mes</div>'}
        else{metr.innerHTML=`
            <div class="calendar-metric"><div class="calendar-metric-label">Ganancia bruta</div><div class="calendar-metric-value positive">${gananciasMes>0?'+$'+fmtNum(gananciasMes,0):'—'}</div><div class="calendar-metric-sub">ops del mes</div></div>
            <div class="calendar-metric"><div class="calendar-metric-label">Pérdidas + Egresos</div><div class="calendar-metric-value negative">${perdidasYEgresos>0?'-$'+fmtNum(perdidasYEgresos,0):'—'}</div><div class="calendar-metric-sub">ops + gastos</div></div>
            <div class="calendar-metric"><div class="calendar-metric-label">Neto mes</div><div class="calendar-metric-value ${netoCls}">${netoSign}$${fmtNum(Math.abs(netoMes),0)}</div><div class="calendar-metric-sub">Mes+ − Mes−</div></div>
            <div class="calendar-metric"><div class="calendar-metric-label">Mejor día</div><div class="calendar-metric-value positive">${mejor?'+$'+fmtNum(mejor.val,0):'—'}</div><div class="calendar-metric-sub">${mejor?'día '+mejor.dia:''}</div></div>
            <div class="calendar-metric"><div class="calendar-metric-label">Peor día</div><div class="calendar-metric-value negative">${peor?'-$'+fmtNum(Math.abs(peor.val),0):'—'}</div><div class="calendar-metric-sub">${peor?'día '+peor.dia:''}</div></div>
            <div class="calendar-metric"><div class="calendar-metric-label">Prom/día</div><div class="calendar-metric-value ${promCls}">${promSign}$${fmtNum(Math.abs(promedio),0)}</div><div class="calendar-metric-sub">${diasActivos} día${diasActivos!==1?'s':''} ${diasActivos!==1?'activos':'activo'}</div></div>`}
    }
}

/* ═══════════════════════════════════════
   §13 — PAGINACIONES (instancias)
   ═══════════════════════════════════════ */
const pagOp=crearPaginacion({
    getData:()=>aplicarOpsFilters(opsMes()),
    getPag:()=>AppState.ui.paginaOp,setPag:p=>{AppState.ui.paginaOp=p},porPag:CONFIG.POR_PAGINA,
    ids:{pagination:'paginationOp',info:'paginaInfoOp',prev:'btnPrevOp',next:'btnNextOp'},
    renderFn:(ini,fin,total,allOps)=>{
        setText('totalOperaciones',total||0);const c=$('tablaContent');
        /* allOps viene del getData — no volvemos a filtrar */
        if(!allOps)allOps=aplicarOpsFilters(opsMes()); /* fallback defensivo */
        let sc=0,sv=0,sg=0;allOps.forEach(op=>{if(op.tipo==='compra')sc++;else sv++;sg=roundMoney(sg+(op.ganancia||0))});
        setText('opsSumCompras',sc);setText('opsSumVentas',sv);setText('opsSumTotal',allOps.length);
        const sgE=$('opsSumGanancia');sgE.textContent=(sg>=0?'+':'-')+'$'+fmtNum(Math.abs(sg),0);sgE.style.color=sg>=0?'#16a34a':'#dc2626';
        $('opsSummary').style.display=total?'grid':'none';

        if(!total){
            const emptyMsg=_opsFiltersActive()?'Sin operaciones que coincidan con los filtros':'Sin operaciones';
            c.innerHTML=`<div class="empty-state"><div class="empty-state-icon">📝</div><div>${emptyMsg}</div></div>`;return
        }
        const ops=allOps.slice(ini,fin);
        let h='<div class="op-cards">';
        ops.forEach(op=>{
            const isC=op.tipo==='compra',un=usdtNeto(op.usdt,op.comisionPlataforma,op.tipo);
            const sy=op.moneda==='USD'?'US$':'$',td=op.moneda==='USD'?3:2;
            const gn=op.ganancia||0,gc=gn>=0?'#16a34a':'#dc2626';
            const gt=gn>=0?'+$'+fmtNum(gn):'-$'+fmtNum(Math.abs(gn));
            const cl=op.consumedLots?.length?op.consumedLots.map(x=>fmtTrunc(x.amount,2)+'@$'+fmtNum(x.precio)).join(', '):'';
            const fifoTip=cl?` title="FIFO: ${cl}"`:'';
            /* Comisión Binance: mostrar el % persistido (o fallback 0.14 para datos legacy) */
            const cPct=op.comisionPct!==undefined?op.comisionPct:0.14;
            const cPctTxt=fmtNum(cPct,2)+'%';

            h+=`<div class="op-swipe-wrap">
                <div class="op-swipe-bg edit">✏️</div>
                <div class="op-swipe-bg delete">🗑️</div>
                <div class="op-swipe-content" data-op-id="${op.id}">
                    <div class="op-card ${op.tipo}">
                        <div class="op-card-body">
                            <div class="r1"><span class="r1-monto">${op._syncState==='pending'?'<span class="sync-dot" title="Pendiente de sincronizar"></span>':''}${sy}${fmtNum(op.monto)}</span><span class="r1-gp" style="color:${gc}">${gt}</span></div>
                            <div class="r2"><span class="r2-c1">${sy}${fmtNum(op.tasa,td)}</span><span class="r2-sep">·</span><span class="r2-c2"${fifoTip}>${fmtTrunc(un,2)} USDT</span><span class="r2-sep">·</span><span class="r2-com" title="Comisión Binance aplicada">${cPctTxt}</span><span class="r2-sep">·</span><span class="r2-c3"><span class="r2-banco" style="color:${getBancoColor(op.banco)}" title="${Array.isArray(op.aportes)&&op.aportes.length>1?'Pago dividido: '+op.aportes.map(a=>a.banco+' $'+fmtNum(a.monto,0)).join(' · '):''}">${op.banco||'-'}${Array.isArray(op.aportes)&&op.aportes.length>1?' <span style="font-size:0.85em;color:#f59e0b;font-weight:700">+'+(op.aportes.length-1)+'</span>':''}</span><span class="r2-fecha">${fmtFechaHora(op.fecha,op.hora,op.timestamp)}</span></span></div>
                            <span class="dk-actions"><button class="btn-edit-small" data-action="editar-op" data-id="${op.id}">✏️</button><button class="btn-delete" data-action="eliminar-op" data-id="${op.id}">🗑️</button></span>
                        </div>
                    </div>
                </div>
            </div>`;
        });
        c.innerHTML=h+'</div>';
        inicializarSwipe();
    }
});

const pagMov=crearPaginacion({
    getData:()=>aplicarMovsFilters(movsMes()),
    getPag:()=>AppState.ui.paginaMov,setPag:p=>{AppState.ui.paginaMov=p},porPag:CONFIG.POR_PAGINA,
    ids:{pagination:'paginationMov',info:'paginaInfoMov',prev:'btnPrevMov',next:'btnNextMov'},
    renderFn:(ini,fin,total,allMov)=>{
        setText('totalMovimientos',total||0);const sec=$('seccionMovimientos');
        const hasAny=AppState.datos.movimientos.length>0;
        const filtersOn=_movsFiltersActive();
        /* Mantener sección visible si hay datos crudos o filtros activos — para no perder la UI de filtros */
        if(!total){
            if(!hasAny&&!filtersOn){sec.style.display='none';return}
            sec.style.display='block';
            $('movSummary').style.display='none';
            $('movimientosContent').innerHTML=`<div class="empty-state"><div class="empty-state-icon">📭</div><div>${filtersOn?'Sin movimientos que coincidan con los filtros':'Sin movimientos'}</div></div>`;
            return;
        }
        sec.style.display='block';
        if(!allMov)allMov=aplicarMovsFilters(movsMes());
        let si=0,se=0;allMov.forEach(m=>{if(m.tipoMovimiento==='ingreso')si=roundMoney(si+m.monto);else se=roundMoney(se+m.monto)});
        const bal=roundMoney(si-se);
        setText('movSumIngresos','+$'+fmtNum(si,0));setText('movSumEgresos','-$'+fmtNum(se,0));
        const be=$('movSumBalance');be.textContent=(bal>=0?'+':'-')+'$'+fmtNum(Math.abs(bal),0);be.style.color=bal>=0?'#16a34a':'#dc2626';
        $('movSummary').style.display=total?'grid':'none';

        const mvs=allMov.slice(ini,fin);
        let h='<div class="op-cards">';
        mvs.forEach(m=>{
            const isI=m.tipoMovimiento==='ingreso';
            const isUsdt=m.tipoCuenta==='usdt';
            const sy=isUsdt?'':'$',suf=isUsdt?' USDT':'';
            const descTxt=m.descripcion?escHtml(m.descripcion):'';
            /* UYU equivalent for USDT adjustments — shows conversion using persisted valorUYU
               (computed in FIFO replay for both ingreso/egreso) with fallback to live calc */
            const uyuEq=isUsdt?movimientoValorUYU(m):0;
            const c1Txt=isUsdt?(uyuEq>0?'≈ $'+fmtNum(uyuEq,0):'🪙 USDT'):'';

            h+=`<div class="op-swipe-wrap">
                <div class="op-swipe-bg edit">✏️</div>
                <div class="op-swipe-bg delete">🗑️</div>
                <div class="op-swipe-content" data-mov-id="${m.id}">
                    <div class="op-card ${isI?'compra':'venta'}">
                        <div class="op-card-body">
                            <div class="r1"><span class="r1-monto">${m._syncState==='pending'?'<span class="sync-dot" title="Pendiente de sincronizar"></span>':''}${sy}${fmtNum(m.monto)}${suf}</span><span class="r1-gp" style="color:${isI?'#16a34a':'#dc2626'}">${isI?'Ingreso':'Egreso'}</span></div>
                            <div class="r2"><span class="r2-c1">${c1Txt}</span><span class="r2-c2">${descTxt?'🏷️ '+descTxt:''}</span><span class="r2-c3"><span class="r2-banco" style="color:${isUsdt?'#64748b':getBancoColor(m.banco)}">${isUsdt?'':m.banco||''}</span><span class="r2-fecha">${fmtFechaHora(m.fecha,m.hora,m.timestamp)}</span></span></div>
                            <span class="dk-actions"><button class="btn-edit-small" data-action="editar-mov" data-id="${m.id}">✏️</button><button class="btn-delete" data-action="eliminar-mov" data-id="${m.id}">🗑️</button></span>
                        </div>
                    </div>
                </div>
            </div>`;
        });
        $('movimientosContent').innerHTML=h+'</div>';
        inicializarSwipe();
    }
});

const pagTrans=crearPaginacion({
    getData:()=>aplicarTransFilters(transMes()),
    getPag:()=>AppState.ui.paginaTrans,setPag:p=>{AppState.ui.paginaTrans=p},porPag:CONFIG.POR_PAGINA,
    ids:{pagination:'paginationTrans',info:'paginaInfoTrans',prev:'btnPrevTrans',next:'btnNextTrans'},
    renderFn:(ini,fin,total,allTr)=>{
        setText('totalTransferencias',total||0);const sec=$('seccionTransferencias');
        const hasAny=AppState.datos.transferencias.length>0;
        const filtersOn=_transFiltersActive();
        if(!total){
            if(!hasAny&&!filtersOn){sec.style.display='none';return}
            sec.style.display='block';
            $('transSummary').style.display='none';
            $('transferenciasContent').innerHTML=`<div class="empty-state"><div class="empty-state-icon">📭</div><div>${filtersOn?'Sin transferencias que coincidan con los filtros':'Sin transferencias'}</div></div>`;
            return;
        }
        sec.style.display='block';
        if(!allTr)allTr=aplicarTransFilters(transMes());
        let sm=0,sc=0;allTr.forEach(t=>{sm=roundMoney(sm+t.monto);sc=roundMoney(sc+(t.comision||0))});
        setText('transSumMonto','$'+fmtNum(sm,0));setText('transSumCom','$'+fmtNum(sc,0));setText('transSumTotal',allTr.length);
        $('transSummary').style.display=total?'grid':'none';

        const trs=allTr.slice(ini,fin);
        let h='<div class="op-cards">';
        trs.forEach(tr=>{
            const oi=getBancoInfo(tr.origen),sy=getSym(oi?.moneda);

            h+=`<div class="op-swipe-wrap">
                <div class="op-swipe-bg edit">✏️</div>
                <div class="op-swipe-bg delete">🗑️</div>
                <div class="op-swipe-content" data-trans-id="${tr.id}">
                    <div class="op-card transfer">
                        <div class="op-card-body">
                            <div class="r1"><span class="r1-monto">${tr._syncState==='pending'?'<span class="sync-dot" title="Pendiente de sincronizar"></span>':''}${sy}${fmtNum(tr.monto)}</span><span class="r1-gp" style="color:#475569;font-weight:600;font-size:0.78em">${tr.comision>0?'Com: '+sy+fmtNum(tr.comision):''}</span></div>
                            <div class="r2"><span class="r2-c1" style="color:${getBancoColor(tr.origen)}">${tr.origen}</span><span class="r2-c2">→</span><span class="r2-c3"><span class="r2-banco" style="color:${getBancoColor(tr.destino)}">${tr.destino}</span><span class="r2-fecha">${fmtFechaHora(tr.fecha,tr.hora,tr.timestamp)}</span></span></div>
                            <span class="dk-actions"><button class="btn-edit-small" data-action="editar-trans" data-id="${tr.id}">✏️</button><button class="btn-delete" data-action="eliminar-trans" data-id="${tr.id}">🗑️</button></span>
                        </div>
                    </div>
                </div>
            </div>`;
        });
        $('transferenciasContent').innerHTML=h+'</div>';
        inicializarSwipe();
    }
});

const pagConv=crearPaginacion({
    getData:()=>convMes(),
    getPag:()=>AppState.ui.paginaConv||1,setPag:p=>{AppState.ui.paginaConv=p},porPag:CONFIG.POR_PAGINA,
    ids:{pagination:'paginationConv',info:'paginaInfoConv',prev:'btnPrevConv',next:'btnNextConv'},
    renderFn:(ini,fin,total,allCv)=>{
        setText('totalConversiones',total||0);const sec=$('seccionConversiones');if(!total){sec.style.display='none';return}sec.style.display='block';
        if(!allCv)allCv=convMes();
        const cvs=allCv.slice(ini,fin);
        let h='<div class="op-cards">';
        cvs.forEach(c=>{
            const syO=c.monedaOrigen==='USD'?'US$':'$',syD=c.monedaDestino==='USD'?'US$':'$';
            h+=`<div class="op-swipe-wrap">
                <div class="op-swipe-bg edit">✏️</div>
                <div class="op-swipe-bg delete">🗑️</div>
                <div class="op-swipe-content" data-conv-id="${c.id}">
                    <div class="op-card conversion">
                        <div class="op-card-body">
                            <div class="r1"><span class="r1-monto">${c._syncState==='pending'?'<span class="sync-dot" title="Pendiente de sincronizar"></span>':''}${syO}${fmtNum(c.montoOrigen)} → ${syD}${fmtNum(c.montoDestino)}</span><span class="r1-gp" style="color:#64748b;font-weight:600;font-size:0.72em">T: ${fmtNum(c.tasa)}</span></div>
                            <div class="r2"><span class="r2-c1" style="color:${getBancoColor(c.origen)}">${c.origen}</span><span class="r2-c2">→</span><span class="r2-c3"><span class="r2-banco" style="color:${getBancoColor(c.destino)}">${c.destino}</span><span class="r2-fecha">${fmtFechaHora(c.fecha,c.hora,c.timestamp)}</span></span></div>
                            <span class="dk-actions"><button class="btn-edit-small" data-action="editar-conv" data-id="${c.id}">✏️</button><button class="btn-delete" data-action="eliminar-conv" data-id="${c.id}">🗑️</button></span>
                        </div>
                    </div>
                </div>
            </div>`;
        });
        $('conversionesContent').innerHTML=h+'</div>';
        inicializarSwipe();
    }
});

/* ═══════════════════════════════════════
   §14 — DASHBOARD
   ═══════════════════════════════════════ */

/* ═══ Spread trend helpers ═══
   Calcula el spread promedio de un día dado (ops UYU con al menos 1 compra y 1 venta).
   Retorna null si el día no tiene ambos lados — no hay spread calculable. */
function _calcularSpreadDia(fecha){
    if(!fecha)return null;
    let sc=0,sv=0,cc=0,cv=0;
    for(const op of AppState.datos.operaciones){
        if(op.fecha!==fecha||op.moneda==='USD'||!op.tasa||op.tasa<=0)continue;
        if(op.tipo==='compra'){sc+=op.tasa;cc++}
        else{sv+=op.tasa;cv++}
    }
    if(!cc||!cv)return null;
    return roundMoney((sv/cv)-(sc/cc));
}
/* Busca hacia atrás la referencia más cercana — máximo 7 días — que tenga spread calculable.
   Eso cubre fines de semana / días inactivos sin retornar un dato demasiado viejo.
   Retorna {fecha, spread} o null si no hay ref en esa ventana. */
function _spreadReferenciaReciente(hoyStr){
    if(!hoyStr)return null;
    const hoyDate=new Date(hoyStr+'T00:00:00');
    for(let i=1;i<=7;i++){
        const d=new Date(hoyDate.getTime()-i*86400000);
        const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const sp=_calcularSpreadDia(ds);
        if(sp!==null)return{fecha:ds,spread:sp};
    }
    return null;
}
/* Renderiza el spread principal + el indicador de tendencia.
   Prefiere el spread de HOY si existe; si no, cae al spread mensual (fallback).
   El indicador solo se muestra si hoy tiene spread Y existe una referencia histórica. */
function _renderSpreadConTendencia(spreadHoy,ref,spreadFallback){
    const spEl=$('spreadPromedio');
    const trEl=$('spreadTrend');
    if(!spEl||!trEl)return;
    /* Valor del spread mostrado */
    const valor=spreadHoy!==null?spreadHoy:spreadFallback;
    spEl.textContent='$'+fmtNum(valor,2);
    /* Trend solo si tenemos hoy + referencia */
    if(spreadHoy===null||!ref||ref.spread===null){
        trEl.style.display='none';
        trEl.className='spread-trend';
        return;
    }
    const diff=roundMoney(spreadHoy-ref.spread);
    /* Umbral de "estable": 0.5% del spread de referencia, mínimo 2 centavos.
       Evita que micro-variaciones se muestren como movimiento significativo. */
    const umbral=Math.max(0.02,Math.abs(ref.spread)*0.005);
    let cls='flat',arr='→',txt='';
    if(Math.abs(diff)<=umbral){
        cls='flat';arr='→';txt='0%';
    }else{
        const pct=ref.spread!==0?Math.abs(diff/ref.spread*100):0;
        const pctTxt=pct>=10?fmtNum(pct,0)+'%':fmtNum(pct,1)+'%';
        if(diff>0){cls='up';arr='↑';txt=pctTxt}
        else{cls='down';arr='↓';txt=pctTxt}
    }
    trEl.className='spread-trend '+cls;
    trEl.innerHTML=`<span class="arr">${arr}</span>${txt}`;
    trEl.title=`Spread hoy: $${fmtNum(spreadHoy,2)} · Ref ${ref.fecha}: $${fmtNum(ref.spread,2)}`;
    trEl.style.display='inline-flex';
}

function actualizarVista(){
    const hoy=getUDate(),mesA=getMesActivo(),ops=opsMes();
    let tp=0,tr=0,stc=0,stv=0,cc=0,cv=0;
    ops.forEach(op=>{if(op.tipo==='compra'){tp=roundMoney(tp+op.monto+(op.comisionBanco||0));stc=roundMoney(stc+op.tasa);cc++}else{tr=roundMoney(tr+op.monto);stv=roundMoney(stv+op.tasa);cv++}});
    const tpc=cc?roundMoney(stc/cc):0,tpv=cv?roundMoney(stv/cv):0,sp=(cc&&cv)?roundMoney(tpv-tpc):0;
    const hoyStr=getUDateStr(),opsH=ops.filter(o=>o.fecha===hoyStr).length;
    const gH=calcularGananciaDiaria()[hoyStr]||0,ghE=$('gananciaHoy'),cH=$('cardGananciaHoy');
    if(gH>=0){ghE.textContent='+$'+fmtNum(gH);ghE.className='card-value positive';cH.className='card main-card'}
    else{ghE.textContent='-$'+fmtNum(Math.abs(gH));ghE.className='card-value negative';cH.className='card main-card negative'}
    const ds=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    setText('fechaHoy',ds[hoy.getDay()]+' '+hoy.getDate()+'/'+(hoy.getMonth()+1));setText('opsHoy',opsH+' ops hoy');

    /* ═══ Spread del día + tendencia vs referencia reciente ═══
       Referencia: spread promedio del último día anterior que tenga tanto compras como ventas.
       Si no hay suficiente data histórica, se muestra estado neutro (sin indicador). */
    const spreadHoy=_calcularSpreadDia(hoyStr);
    const trendRef=_spreadReferenciaReciente(hoyStr);
    _renderSpreadConTendencia(spreadHoy,trendRef,sp);

    /* Ingresos externos del día — métrica paralela, NO suma a ganancia P2P */
    const ingExt=calcularIngresosExternosDia(hoyStr);
    const cardIE=$('cardIngresosExt'),ieEl=$('ingresosExtHoy');
    if(cardIE){
        if(ingExt>0.005){
            cardIE.style.display='flex';
            if(ieEl)ieEl.textContent='+$'+fmtNum(ingExt,2);
        }else{
            cardIE.style.display='none';
        }
    }
    // — Ganancia Hoy USD —
    const tieneUSD=hayBancosUSD(),cardUSD=$('cardGananciaUSD');
    if(tieneUSD){
        cardUSD.style.display='block';
        const opsUSDHoy=ops.filter(o=>o.fecha===hoyStr&&o.moneda==='USD');
        let gUSD=0;opsUSDHoy.forEach(o=>{if(o.ganancia!==undefined)gUSD=roundMoney(gUSD+o.ganancia)});
        const nUSD=opsUSDHoy.length,geU=$('gananciaHoyUSD');
        if(gUSD>=0){geU.textContent='+US$'+fmtNum(gUSD);geU.className='card-value positive'}
        else{geU.textContent='-US$'+fmtNum(Math.abs(gUSD));geU.className='card-value negative'}
        setText('opsHoyUSD',nUSD+' ops USD hoy');
    }else cardUSD.style.display='none';
    /* Precision: usar 2 decimales para montos UYU en dashboard */
    setText('totalPagado','$'+fmtNum(tp,2));
    setText('totalRecibido','$'+fmtNum(tr,2));
    const meses=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],mn=parseInt(mesA.split('-')[1])-1;
    setText('mesCompras','('+meses[mn]+')');setText('mesVentas','('+meses[mn]+')');
    const la=AppState.datos.lotes.filter(l=>l.disponible>0);
    const minTxt=la.length>0?'Min $'+fmtNum(la.reduce((m,l)=>l.precioCompra<m.precioCompra?l:m,la[0]).precioCompra):'Sin stock';
    setText('statsCompra',cc?'Prom $'+fmtNum(tpc)+' · '+minTxt:'--');
    setText('statsVenta',cv?la.length+' lotes · Spread $'+fmtNum(sp):'--');
    /* spreadPromedio ya lo seteó _renderSpreadConTendencia arriba con el valor del día (o fallback mensual) */
    actualizarBancosGrid();actualizarSelectBancos();renderOpsFilters();renderMovsFilters();renderTransFilters();
    /* Render diffing: cada lista paginada se re-renderiza solo si su fingerprint
       (data version + pagina + filtros relevantes) cambió respecto al último render.
       Reduce innerHTML writes innecesarios — clave para perf en Android de gama baja. */
    _renderListIfChanged('pagOp',pagOp,()=>{
        const f=AppState.ui.opsFilters||{};
        return `${AppState.datos._version||0}|${AppState.ui.paginaOp}|${f.tipo}|${f.banco}|${f.resultado}|${f.fecha}|${AppState.datos.operaciones.length}`;
    });
    _renderListIfChanged('pagMov',pagMov,()=>{
        const f=AppState.ui.movsFilters||{};
        return `${AppState.datos._version||0}|${AppState.ui.paginaMov}|${f.tipo}|${f.cuenta}|${f.tag}|${f.fecha}|${AppState.datos.movimientos.length}`;
    });
    _renderListIfChanged('pagTrans',pagTrans,()=>{
        const f=AppState.ui.transFilters||{};
        return `${AppState.datos._version||0}|${AppState.ui.paginaTrans}|${f.origen}|${f.destino}|${f.fecha}|${AppState.datos.transferencias.length}`;
    });
    _renderListIfChanged('pagConv',pagConv,()=>`${AppState.datos._version||0}|${AppState.ui.paginaConv||1}|${(AppState.datos.conversiones||[]).length}`);
}

/* Registro de fingerprints para evitar re-render de listas cuyo contenido no cambió */
const _renderFingerprints={};
function _renderListIfChanged(key,pag,getFingerprint){
    const fp=getFingerprint();
    if(_renderFingerprints[key]===fp)return;  /* sin cambios, skip */
    _renderFingerprints[key]=fp;
    pag.render();
}
/* Forzar re-render de una lista (e.g. tras mutación que no cambia length pero sí contenido) */
function _invalidateListCache(key){
    if(key)delete _renderFingerprints[key];
    else Object.keys(_renderFingerprints).forEach(k=>delete _renderFingerprints[k]);
}

