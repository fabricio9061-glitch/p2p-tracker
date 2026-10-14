/* ═══════════════════════════════════════
   §10 — GANANCIAS Y ESTADÍSTICAS DEL DÍA
   ═══════════════════════════════════════
   Los ingresos, egresos y transferencias se guardan con 17-registros.js; sus
   formularios están en 21-ui-cargar.js. Acá quedan las cuentas que usan el
   inicio, el resumen del mes y el calendario. */
function hayBancosUSD(){return CONFIG.BANCOS.some(b=>AppState.datos.bancos[b.nombre]?.activo&&b.moneda==='USD')}


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
