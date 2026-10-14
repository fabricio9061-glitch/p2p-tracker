

/* ═══════════════════════════════════════
   §6 — BANCOS
   ═══════════════════════════════════════ */
function inicializarBancos(){
    CONFIG.BANCOS.forEach(b=>{
        if(!AppState.datos.bancos[b.nombre])
            AppState.datos.bancos[b.nombre]={activo:false,saldo:0,limiteDiarioUSD:0,limiteUsadoUSD:0,ultimoResetLimite:null};
        else{
            const bk=AppState.datos.bancos[b.nombre];
            if(bk.limiteDiarioUSD===undefined)bk.limiteDiarioUSD=bk.limiteDiario||0;
            if(bk.limiteUsadoUSD===undefined)bk.limiteUsadoUSD=bk.limiteUsado||0;
            if(bk.ultimoResetLimite===undefined)bk.ultimoResetLimite=null;
            /* NEVER override activo here — user's choice is the source of truth */
        }
    });
}

const DIAS_RESET_TODOS=[0,1,2,3,4,5,6];

function getDiasReset(nombreBanco){
    const bk=AppState.datos.bancos[nombreBanco];
    if(bk&&Array.isArray(bk.diasReset)&&bk.diasReset.length)return bk.diasReset;
    /* Sin configurar: se hereda la regla que tenía el banco marcado como especial
       para no cambiarle el comportamiento a quien ya la usaba. */
    const info=getBancoInfo(nombreBanco);
    if(info&&info.especial==='itau')return[2,3,4,5];
    return DIAS_RESET_TODOS;
}


/* Devuelve true si alguna cuenta renovó su cupo: quien llama tiene que
   recalcular el consumo y guardar, porque la fecha de renovación cambió. */
/* Anota la última renovación del cupo de cada cuenta. Devuelve true si alguna
   renovó desde la última vez, para recalcular y guardar. La fecha sale de
   _cupoDesde (días marcados + las 0:30); acá solo se deja registrada. */
function verificarResetLimites(){
    let renovo=false;
    CONFIG.BANCOS.forEach(b=>{
        const bk=AppState.datos.bancos[b.nombre];if(!bk)return;
        const desde=_cupoDesde(b.nombre);
        if(bk.ultimoResetLimite===desde)return;
        bk.ultimoResetLimite=desde;
        renovo=true;
    });
    return renovo;
}

/* ═══ v4.9.5 — Orden por saldo: más plata primero, cuentas vacías al final ═══
   Se agrupa por moneda antes de comparar (UYU y luego USD, según el orden de
   CONFIG): mezclar $24.000 con US$500 en un mismo ranking no tiene sentido.
   Empates (típico: varias cuentas en 0) → se conserva el orden de CONFIG para
   que no bailen entre renders. Como TODOS los selectores salen de esta función,
   ordenar acá alcanza para tarjetas, "Sale de", "Entra a", ajustes y split. */
function _saldoDeBanco(nombre){
    if(!AppState.datos||!AppState.datos.bancos)return 0;
    const bk=AppState.datos.bancos[nombre];
    return bk?(bk.saldo||0):0;
}
function ordenarBancosPorSaldo(lista){
    const idx=new Map(),ordenMoneda={};let m=0;
    CONFIG.BANCOS.forEach((b,i)=>{
        idx.set(b.nombre,i);
        const mo=b.moneda||'UYU';
        if(ordenMoneda[mo]===undefined)ordenMoneda[mo]=m++;
    });
    return lista.slice().sort((a,b)=>{
        const ma=ordenMoneda[a.moneda||'UYU'],mb=ordenMoneda[b.moneda||'UYU'];
        if(ma!==mb)return ma-mb;
        const sa=_saldoDeBanco(a.nombre),sb=_saldoDeBanco(b.nombre);
        if(Math.abs(sa-sb)>0.005)return sb-sa;
        return (idx.get(a.nombre)||0)-(idx.get(b.nombre)||0);
    });
}
function getBancosActivos(){return ordenarBancosPorSaldo(CONFIG.BANCOS.filter(b=>AppState.datos.bancos[b.nombre]?.activo))}


/* ═══════════════════════════════════════
   §7 — INVENTARIO FIFO
   ═══════════════════════════════════════ */
function agregarLote(id,fecha,hora,precio,cant,moneda,tasa){
    moneda=moneda||'UYU';cant=truncUsdt(cant);
    /* Mergear con lotes automáticos del mismo precio y moneda, y también con los
       de ARRASTRE: son sintéticos, reemplazan al lote automático que existía al
       corte, y si no se fusionaran, la compra nueva quedaría en un lote con fecha
       posterior → cambiaría el orden FIFO y con él la ganancia atribuida.
       v5.0.1: esto es seguro AHORA porque la DECLARACIÓN de los lotes de arrastre
       vive aparte, en datos._archivoCarryover, y es inmutable: lo que el replay
       muta acá no se persiste nunca como declaración. Entre 4.9.0 y 5.0.0 sí se
       persistía, y el saldo USDT se inflaba de forma acumulativa en cada ciclo. */
    const ex=AppState.datos.lotes.find(l=>(!l.manual||l.carryover)&&l.precioCompra===precio&&l.disponible>0&&(l.moneda||'UYU')===moneda);
    /* v7.3.0 — Sumas y restas entre cantidades que ya están en centésimos se
       redondean, no se truncan: en coma flotante 800 − 501,92 da 298,0799999…
       y truncar eso perdía un centavo en cada paso del inventario. */
    if(ex){ex.cantidad=roundMoney(ex.cantidad+cant);ex.disponible=roundMoney(ex.disponible+cant)}
    else AppState.datos.lotes.push({id,fecha,hora,precioCompra:precio,cantidad:cant,disponible:cant,moneda,...(tasa>0?{tasa}:{})});
}

function consumirFIFO(cant,precioVenta,monedaVenta){
    const pedido=truncUsdt(cant);
    let rest=pedido,gan=0,costo=0;
    /* CRITICAL: FIFO must consume only lots of the matching currency.
       Mixing UYU and USD lots breaks cost basis and profit calculations. */
    const monedaTarget=monedaVenta||'UYU';
    const lotes=getLotesActivosFIFO().filter(l=>(l.moneda||'UYU')===monedaTarget);
    const consumed=[];
    for(const l of lotes){if(rest<=0)break;const c=roundMoney(Math.min(l.disponible,rest));
        costo=roundMoney(costo+roundMoney(c*l.precioCompra));
        if(precioVenta!==undefined)gan=roundMoney(gan+roundMoney(c*(precioVenta-l.precioCompra)));
        consumed.push({lotId:l.id,amount:c,precio:l.precioCompra});
        l.disponible=roundMoney(l.disponible-c);if(l.disponible<0.005)l.disponible=0;rest=roundMoney(rest-c);if(rest<0.005)rest=0}
    return{ganancia:gan,costo,consumed,consumido:roundMoney(pedido-rest)};
}
function previewFIFO(cant,moneda){
    let rest=truncUsdt(cant);
    const monedaTarget=moneda||'UYU';
    const lotes=getLotesActivosFIFO().filter(l=>(l.moneda||'UYU')===monedaTarget);
    const res=[];
    for(const l of lotes){if(rest<=0)break;const c=roundMoney(Math.min(l.disponible,rest));
        res.push({precio:l.precioCompra,cantidad:c,subtotal:roundMoney(c*l.precioCompra)});rest=roundMoney(rest-c);if(rest<0.005)rest=0}
    return res;
}

function recalcularLotesYGanancias(){
    /* ═══ Semillas del replay: DECLARACIONES, no estado calculado (v5.0.1) ═══
       Los lotes de arrastre se leen de datos._archivoCarryover, que escriben una
       sola vez el archivado o la reparación, y que nadie vuelve a derivar del
       array de lotes. Los manuales del usuario sí salen del array: su `cantidad`
       no se muta nunca. Compatibilidad: si un documento viejo todavía trae los de
       arrastre dentro de los manuales, se adoptan al campo nuevo la primera vez. */
    /* ═══ v5.7.2 — La adopción salió de acá ═══
       Antes, si el campo venía sin definir, se reconstruía leyendo los lotes de
       arrastre del array calculado. Pero ese array ya pasó por el motor: las
       compras a la misma tasa se fusionan dentro de esos lotes, así que su
       cantidad no es la declarada sino la declarada MÁS las compras absorbidas.
       Cuando una foto del servidor traía el campo sin definir, la reconstrucción
       tomaba esa cantidad inflada como nueva declaración y la compra pasaba a
       contarse dos veces: dentro del lote de arrastre y como operación propia.
       Eso duplicaba el USDT. Ahora la adopción se hace una sola vez, al cargar,
       leyendo la declaración guardada y no el resultado del cálculo. */
    const lotesCarry=(AppState.datos._archivoCarryover||[]).map(l=>({...l,manual:true,carryover:true}));
    const lotesManual=[...lotesCarry,...AppState.datos.lotes.filter(l=>l&&l.manual&&!l.carryover).map(l=>({...l}))];
    AppState.datos.lotes=[];const ev=[];
    AppState.datos.operaciones.forEach(op=>{ev.push({tipo:'op',fecha:op.fecha,hora:op.hora||'00:00',data:op})});
    AppState.datos.movimientos.filter(m=>m.tipoCuenta==='usdt').forEach(m=>{
        ev.push({tipo:m.tipoMovimiento==='ingreso'?'mi':'me',fecha:m.fecha,hora:m.hora||'00:00',data:m})});
    /* Insertar lotes manuales como eventos para que participen en FIFO cronológicamente */
    lotesManual.forEach(l=>{ev.push({tipo:'lm',fecha:l.fecha||'2000-01-01',hora:l.hora||'00:00',data:l})});
    /* ═══ v7.3.0 — Orden cronológico real, también dentro del mismo minuto ═══
       Se ordenaba solo por fecha y hora, que tienen resolución de un minuto.
       Cuando dos registros caían en el mismo minuto quedaban en el orden de la
       lista, que es de la más nueva a la más vieja: una compra y la venta que
       le siguió se procesaban al revés. La venta no encontraba el lote, el USDT
       quedaba sin descontar y el inventario aparecía inflado. Ahora el empate se
       resuelve por el id, que crece con el tiempo en el que se creó el registro. */
    ev.forEach(e=>{e.k=(e.fecha||'')+(e.hora||'00:00');e.n=Number(e.data&&e.data.id)||0});
    ev.sort((a,b)=>a.k<b.k?-1:a.k>b.k?1:a.n-b.n);
    /* v4.9.0 — Si hay historial archivado, los trackers arrancan desde los
       seeds capturados al corte (datos._archivoSeeds). Sin archivo: desde 0,
       idéntico a siempre. Sin esto, archivar rompería la ganancia de compras
       USD recientes (dependen de la última venta USD, que puede estar en el
       archivo) y el fallback de tasaRef en ingresos USDT. */
    const _seeds=AppState.datos._archivoSeeds||{};
    let utcL=_seeds.utcL||0,utcUL=_seeds.utcUL||0,utvL=_seeds.utvL||0,utvU=_seeds.utvU||0;
    ev.forEach(e=>{
        if(e.tipo==='op'){
            const op=e.data;if(!op.tasa||op.tasa<=0){op.ganancia=0;op.usdt=0;op.comisionPlataforma=0;return}
            /* Defensive: normalize comisionBanco to number, preserve through replay */
            if(typeof op.comisionBanco!=='number'||!isFinite(op.comisionBanco))op.comisionBanco=0;
            /* ═══ v6.9.0 — Este era el peor de los tres ═══
               Está en el motor de recálculo, que reproduce TODAS las operaciones
               cada vez. Una operación guardada con comisión 0% entraba acá, el
               operador la tomaba como vacía y la reemplazaba por 0,14%: la
               ganancia histórica de esa operación quedaba mal calculada, y se
               volvía a calcular mal en cada actualización. Cero es un valor
               guardado a propósito y hay que respetarlo. */
            const cpct=((op.comisionPct===undefined||op.comisionPct===null||!isFinite(op.comisionPct))
                        ?comisionConfigurada(op.moneda):Number(op.comisionPct))/100;
            const uBase=usdtBase(op.monto/op.tasa,op.tipo),cp=truncar(uBase*cpct,2),isU=op.moneda==='USD';
            /* ═══ v8.0.0 — La comisión de Binance es un costo ═══
               Al comprar, el lote se anotaba a la tasa pactada aunque llegaran
               menos USDT (la base menos la comisión); al vender, se contaba como
               cobrada también la comisión que se lleva Binance. Las dos cosas
               inflaban la ganancia: unos $45 por cada compra y venta de $16.000.
               Ahora el lote vale lo que se pagó dividido lo que llegó, y la
               ganancia de una venta es lo que entró al banco menos lo que costaron
               los USDT que salieron, comisión incluida. */
            if(op.tipo==='compra'){
                const un=usdtNeto(uBase,cp,op.tipo);
                if(isU){
                    op.ganancia=roundMoney((utvU>0?roundMoney(un*(utvU-op.tasa)):0)-(op.comisionBanco||0));
                    utcUL=op.tasa;
                }else{utcL=op.tasa;op.ganancia=roundMoney(-(op.comisionBanco||0))}
                agregarLote(op.id,op.fecha,op.hora||'00:00',un>0?op.monto/un:op.tasa,un,op.moneda||'UYU',op.tasa);
            }else{
                const av=usdtNeto(uBase,cp,op.tipo);
                const fifo=consumirFIFO(av,undefined,op.moneda||'UYU');
                op.consumedLots=fifo.consumed;
                op.costoUsdt=fifo.costo;
                /* Si faltó inventario, solo cuenta la parte que salió de un lote */
                const cobrado=(av>0&&fifo.consumido<av-0.005)?roundMoney(op.monto*fifo.consumido/av):op.monto;
                op.ganancia=roundMoney(cobrado-fifo.costo);
                if(isU)utvU=op.tasa;else utvL=op.tasa;
            }
            op.usdt=uBase;op.comisionPlataforma=cp;
        }else if(e.tipo==='mi'){
            const m=e.data,pr=m.tasaRef||utcL||1;
            agregarLote(m.id,m.fecha,m.hora||'00:00',pr,roundMoney(m.monto),'UYU');
            /* Persistir valorUYU también en ingresos USDT para que el helper unificado
               no tenga que recalcular. tasaRef es la tasa de referencia del lote creado. */
            m.valorUYU=roundMoney(m.monto*pr);
        }
        else if(e.tipo==='me'){const r=consumirFIFO(roundMoney(e.data.monto));e.data.valorUYU=r.costo;e.data.consumedLots=r.consumed}
        else if(e.tipo==='lm'){
            const l=e.data;
            /* CRÍTICO: disponible se resetea a cantidad original — el replay FIFO 
               consumirá lo que corresponda según las operaciones activas */
            AppState.datos.lotes.push({id:l.id,fecha:l.fecha,hora:l.hora,precioCompra:l.precioCompra,cantidad:l.cantidad,disponible:l.cantidad,moneda:l.moneda||'UYU',manual:true,...(l.carryover?{carryover:true}:{})});
        }
    });
    AppState.datos.ultimaTasaCompra=utcL;AppState.datos.ultimaTasaCompraUSD=utcUL;
    AppState.datos.ultimaTasaVenta=utvL;AppState.datos.ultimaTasaVentaUSD=utvU;
    sincronizarSaldoUsdt();
    /* v6.0.0 — Los saldos de las cuentas se reconstruyen acá mismo, en el mismo
       recorrido que los lotes y el USDT. A partir de ahora los tres derivan de
       los eventos y ninguno puede quedar desincronizado de los otros. */
    if(typeof recalcularSaldosBancos==='function')recalcularSaldosBancos();
    /* v7.0.0 — El cupo diario también: los tres —lotes, saldos y cupo— salen del
       mismo recorrido y no pueden quedar desincronizados entre sí. */
    if(typeof recalcularCuposDiarios==='function')recalcularCuposDiarios();
    invalidarGananciaCache();
}
