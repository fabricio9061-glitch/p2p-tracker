/* ═══════════════════════════════════════
   §10 — GANANCIAS Y ESTADÍSTICAS DEL DÍA
   ═══════════════════════════════════════
   Los ingresos, egresos y transferencias se guardan con 17-registros.js; sus
   formularios están en 21-ui-cargar.js. Acá quedan las cuentas que usan el
   inicio, el resumen del mes y el calendario. */
function hayBancosUSD(){return todasLasCuentas().some(b=>AppState.datos.bancos[b.nombre]?.activo&&b.moneda==='USD')}


/* ═══════════════════════════════════════
   §12 — CALENDARIO
   ═══════════════════════════════════════ */
/* Cache for ganancia calculations — invalidated by data version changes.
   Per-moneda slots (Map) para que distintos filtros no se pisen mutuamente. */
const _gananciaCache={diaria:new Map(),total:new Map(),key:null};
function _gananciaCacheKey(monedaFiltro){
    const v=AppState.datos._version||0;
    const opsLen=AppState.datos.operaciones.length,movsLen=AppState.datos.movimientos.length;
    /* v8.3.0 — Las transferencias (comisiones) y las correcciones también cuentan */
    const otros=(AppState.datos.transferencias||[]).length+'.'+(AppState.datos.ajustesSaldo||[]).length;
    const bump=AppState.ui._cacheBump||0;
    return (monedaFiltro||'_all')+'|'+v+'|'+opsLen+'|'+movsLen+'|'+otros+'|'+bump;
}
function invalidarGananciaCache(){
    _gananciaCache.diaria.clear();
    _gananciaCache.total.clear();
    _gananciaCache.key=null;
    AppState.ui._cacheBump=(AppState.ui._cacheBump||0)+1;
}

function calcularGananciaDiaria(monedaFiltro){
    const key=_gananciaCacheKey(monedaFiltro);
    const cached=_gananciaCache.diaria.get(key);
    if(cached)return cached;
    /* v8.3.0 — Con la misma regla que todas las pantallas (aporteAGanancia):
       ventas, comisiones del banco, egresos y correcciones; en dólares, aparte */
    const g={},usd=monedaFiltro==='USD';
    registrosParaGanancia().forEach(x=>{
        const a=aporteAGanancia(x.ent,x.rec);if(!a||(a.parte==='dolares')!==usd)return;
        const f=x.rec.fecha;if(!f)return;
        g[f]=roundMoney((g[f]||0)+a.v);
    });
    _gananciaCache.diaria.set(key,g);
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
    /* v8.3.0 — Las partes de la ganancia del día, con la regla de todas las pantallas */
    const partes=sumarGanancia(registrosParaGanancia().filter(x=>x.rec.fecha===fecha));
    const tasaPromC=compras?roundMoney(sumTasaC/compras):0;
    const tasaPromV=ventas?roundMoney(sumTasaV/ventas):0;
    const spread=(compras&&ventas)?roundMoney(tasaPromV-tasaPromC):0;
    const gastos=roundMoney(-partes.egresos);
    const gananciaNeta=partes.neta;
    const result={fecha,ops:ops.length,compras,ventas,montoCompras,montoVentas,ajustes:movs.length,transferencias:trans.length,spread,gananciaOps,gastos,gananciaNeta,tasaPromC,tasaPromV,partes};
    _dayStatsCache.data.set(fecha,result);
    return result;
}
