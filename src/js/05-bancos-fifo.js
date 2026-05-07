/* ═══════════════════════════════════════════════════════════════════
   05-bancos-fifo.js
   Generated piece — concatenated into dist/index.html by build/build.js
   Source of truth: src/js/05-bancos-fifo.js
   Do NOT edit dist/index.html directly. Edit the source and re-run build.
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════
   §5 — PAGINACIÓN GENÉRICA
   ═══════════════════════════════════════ */
/* Acepta getData() (preferido) o getTotal() legacy.
   getData() devuelve la lista completa filtrada — total y slice se derivan de ahí
   en una sola pasada, evitando filtrar/contar dos veces por render. */
function crearPaginacion(cfg) {
    const {getData,getTotal,getPag,setPag,porPag,ids,renderFn} = cfg;
    function render(){
        let data=null,total;
        if(typeof getData==='function'){
            data=getData();
            total=data.length;
        }else{
            total=getTotal();
        }
        if(!total){$(ids.pagination).style.display='none';renderFn([],0,0,data||[]);return}
        const tp=Math.max(1,Math.ceil(total/porPag));
        let pag=getPag();
        if(pag>tp){pag=tp;setPag(pag)}
        if(pag<1){pag=1;setPag(pag)}
        const ini=(pag-1)*porPag,fin=ini+porPag;
        /* Pasamos data (si la tenemos) como 4to arg — renderFn puede hacer slice sin re-filtrar */
        renderFn(ini,fin,total,data);
        $(ids.pagination).style.display=tp>1?'flex':'none';
        setText(ids.info,`${pag} / ${tp}`);
        $(ids.prev).disabled=pag===1;
        $(ids.next).disabled=pag===tp;
    }
    function cambiar(dir){
        let total;
        if(typeof getData==='function')total=getData().length;
        else total=getTotal();
        const tp=Math.max(1,Math.ceil(total/porPag));
        let pag=getPag()+dir;
        if(pag<1)pag=1;if(pag>tp)pag=tp;setPag(pag);render();
    }
    return{render,cambiar};
}

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

function verificarResetLimites(){
    const ah=getUDate(),hr=0.5,ha=ah.getHours()+ah.getMinutes()/60,hoy=getUDateStr();
    CONFIG.BANCOS.forEach(b=>{
        const bk=AppState.datos.bancos[b.nombre];if(!bk)return;
        const ur=bk.ultimoResetLimite||null;
        if(b.especial==='itau'){
            const ds=ah.getDay();
            if(ds===2&&ha>=hr){if(ur!==hoy){bk.limiteUsadoUSD=0;bk.ultimoResetLimite=hoy}}
            else if(ds>2&&ds<6&&ha>=hr){if(ur!==hoy){bk.limiteUsadoUSD=0;bk.ultimoResetLimite=hoy}}
        }else{if(ha>=hr&&ur!==hoy){bk.limiteUsadoUSD=0;bk.ultimoResetLimite=hoy}}
    });
}

function getMonedaBanco(){const b=$('banco')?.value;if(!b)return'UYU';return getBancoInfo(b)?.moneda||'UYU'}
function getComisionActual(){return getMonedaBanco()==='USD'?AppState.datos.comisionUSD:AppState.datos.comisionPlataforma}
function getComisionDec(){return(getComisionActual()||0.14)/100}
function getBancosActivos(){return CONFIG.BANCOS.filter(b=>AppState.datos.bancos[b.nombre]?.activo)}

function actualizarSelectBancos(){
    const s=$('banco'),v=s.value;
    s.innerHTML='<option value="">-- Seleccionar --</option>';
    getBancosActivos().forEach(b=>{s.innerHTML+=`<option value="${b.nombre}" style="color:${b.color||'#1e293b'};font-weight:600">${b.nombre}</option>`});
    s.value=v;actualizarColorBancoSelect();
}

function mostrarSaldoBanco(){
    const b=$('banco').value,i=$('saldoBancoInfo'),h=$('bancoHelp');
    if(h){h.textContent='';h.className=''}
    if(b&&AppState.datos.bancos[b]){const bi=getBancoInfo(b);i.innerHTML=' | <span style="color:'+getBancoColor(b)+';font-weight:600">'+b+'</span>: '+getSym(bi?.moneda)+fmtNum(AppState.datos.bancos[b].saldo)}
    else i.textContent='';
}

function actualizarBancosGrid(){
    const la=AppState.datos.lotes.filter(l=>l.disponible>0).length;
    const saldoUsdt=Math.max(0,AppState.datos.saldoUsdt);
    /* Computar totales por moneda — solo cuentas bancarias reales */
    let totalUYU=0,totalUSD=0;
    CONFIG.BANCOS.forEach(b=>{
        if(!AppState.datos.bancos[b.nombre]?.activo)return;
        const s=AppState.datos.bancos[b.nombre].saldo;
        if(b.moneda==='USD')totalUSD=roundMoney(totalUSD+s);else totalUYU=roundMoney(totalUYU+s);
    });

    /* ═══ Barra compacta: Total Bancos — una línea, sin ruido ═══ */
    let heroH=`<span class="saldos-hero-label">🏦 Total Bancos (UYU)</span><span class="saldos-hero-value" style="color:${totalUYU>=0?'#16a34a':'#dc2626'}">$${fmtNum(totalUYU,2)}</span>`;
    if(totalUSD!==0||hayBancosUSD())heroH+=`<span class="saldos-hero-label" style="margin-left:auto">💵 USD</span><span class="saldos-hero-value" style="color:#3b82f6">US$${fmtNum(totalUSD,2)}</span>`;
    setHtml('saldosTotales',heroH);

    /* ═══ Grid de desglose: cada cuenta individual ═══ */
    let h=`<div class="banco-mini-card usdt-card" data-action="inventario"><div class="banco-nombre">🪙 <b style="color:#1e293b">USDT</b></div><div class="banco-saldo">${fmtTrunc(saldoUsdt,2)}</div><div class="banco-moneda">${la} lotes</div></div>`;
    CONFIG.BANCOS.forEach(b=>{
        if(!AppState.datos.bancos[b.nombre]?.activo)return;
        const s=AppState.datos.bancos[b.nombre].saldo,lim=AppState.datos.bancos[b.nombre].limiteDiarioUSD||0,us=AppState.datos.bancos[b.nombre].limiteUsadoUSD||0;
        let tipHtml='',limTxt='',hasGauge=false,cardStyle='';
        if(lim>0){
            hasGauge=true;
            const pct=Math.min(100,Math.max(0,(us/lim)*100));
            const fillColor=_gaugeColor(pct);
            const disp=Math.max(0,lim-us);
            const visualH=pct<=0.5?0:Math.max(4,pct);
            /* Custom properties → pseudo ::after las lee. Track y fill comparten 
               exactamente el mismo rectángulo, el fill solo varía su altura. */
            cardStyle=` style="--gauge-h:${visualH}%;--gauge-color:${fillColor}"`;
            tipHtml=`<div class="banco-gauge-tip">${fmtNum(pct,0)}% · US$${fmtNum(disp,0)}</div>`;
            limTxt=`<div class="banco-limite-txt">US$${fmtNum(disp,0)}/${fmtNum(lim,0)}</div>`;
        }
        h+=`<div class="banco-mini-card${hasGauge?' has-gauge':''}"${cardStyle} data-action="editar-saldo" data-banco="${b.nombre}"><div class="banco-nombre" style="color:${b.color||'#1e293b'}">${b.nombre}</div><div class="banco-saldo" style="color:${s>=0?'#16a34a':'#dc2626'}">${getSym(b.moneda)}${fmtNum(s,2)}</div><div class="banco-moneda">${b.moneda}</div>${limTxt}${tipHtml}</div>`;
    });
    setHtml('bancosGrid',h);
}

/* Interpolación progresiva de color por porcentaje de uso del límite.
   Escala 5-stops: azul (bajo) → verde → amarillo → naranja → rojo (crítico).
   La transición entre colores es suave (mix lineal RGB entre stops consecutivos). */
function _gaugeColor(pct){
    /* Clamp */
    const p=Math.max(0,Math.min(100,pct));
    /* Stops: [pct, r, g, b] */
    const stops=[
        [0,   59, 130, 246],  /* #3b82f6 — azul, uso bajo */
        [30,  34, 197,  94],  /* #22c55e — verde, normal */
        [60, 250, 204,  21],  /* #facc15 — amarillo, alerta */
        [80, 249, 115,  22],  /* #f97316 — naranja, alto */
        [95, 220,  38,  38]   /* #dc2626 — rojo, crítico */
    ];
    /* Encontrar segmento */
    let i=0;while(i<stops.length-1&&p>stops[i+1][0])i++;
    const a=stops[i],b=stops[Math.min(i+1,stops.length-1)];
    const range=b[0]-a[0];
    const t=range>0?(p-a[0])/range:0;
    const r=Math.round(a[1]+(b[1]-a[1])*t);
    const g=Math.round(a[2]+(b[2]-a[2])*t);
    const bl=Math.round(a[3]+(b[3]-a[3])*t);
    return `rgb(${r},${g},${bl})`;
}

function renderizarListaBancos(){
    let h='';
    CONFIG.BANCOS.forEach(b=>{
        const a=AppState.datos.bancos[b.nombre]?.activo||false,s=AppState.datos.bancos[b.nombre]?.saldo||0,lim=AppState.datos.bancos[b.nombre]?.limiteDiarioUSD||0;
        let li=lim>0?` | Límite: US$${fmtNum(lim,0)}/día`:'';if(b.especial==='itau')li+=' (sáb-lun=1día)';
        h+=`<div class="banco-list-item"><div><div style="font-weight:600;font-size:0.9em"><span style="color:${b.color||'#1e293b'}">${b.nombre}</span> <span style="color:#94a3b8">(${b.moneda})</span></div><div style="color:#64748b;font-size:0.8em">${getSym(b.moneda)}${fmtNum(s)}${li}</div></div><div class="banco-list-actions"><button class="btn-edit-small" data-action="editar-saldo" data-banco="${b.nombre}">Editar</button><label class="toggle-switch"><input type="checkbox" ${a?'checked':''} data-action="toggle-banco" data-banco="${b.nombre}"><span class="toggle-slider"></span></label></div></div>`;
    });
    setHtml('listaBancos',h);
}

function mostrarSaldoOrigen(){
    const b=$('bancoOrigen')?.value;
    if(b&&AppState.datos.bancos[b]){
        const bi=getBancoInfo(b),sym=getSym(bi?.moneda);let info=colorBanco(b)+': '+sym+fmtNum(AppState.datos.bancos[b].saldo);
        if(AppState.datos.bancos[b].limiteDiarioUSD>0){const u=AppState.datos.bancos[b].limiteUsadoUSD||0,d=Math.max(0,AppState.datos.bancos[b].limiteDiarioUSD-u);info+=` | Límite: US$${fmtNum(d,0)}/${fmtNum(AppState.datos.bancos[b].limiteDiarioUSD,0)}`}
        $('saldoOrigenInfo').innerHTML=info;
    }else $('saldoOrigenInfo').textContent='';
}

/* ═══════════════════════════════════════
   §7 — INVENTARIO FIFO
   ═══════════════════════════════════════ */
function agregarLote(id,fecha,hora,precio,cant,moneda){
    moneda=moneda||'UYU';cant=truncUsdt(cant);
    /* Solo mergear con lotes automáticos (no manuales) del mismo precio y moneda */
    const ex=AppState.datos.lotes.find(l=>!l.manual&&l.precioCompra===precio&&l.disponible>0&&(l.moneda||'UYU')===moneda);
    if(ex){ex.cantidad=truncUsdt(ex.cantidad+cant);ex.disponible=truncUsdt(ex.disponible+cant)}
    else AppState.datos.lotes.push({id,fecha,hora,precioCompra:precio,cantidad:cant,disponible:cant,moneda});
}

function consumirFIFO(cant,precioVenta,monedaVenta){
    let rest=truncUsdt(cant),gan=0,costo=0;
    /* CRITICAL: FIFO must consume only lots of the matching currency.
       Mixing UYU and USD lots breaks cost basis and profit calculations. */
    const monedaTarget=monedaVenta||'UYU';
    const lotes=getLotesActivosFIFO().filter(l=>(l.moneda||'UYU')===monedaTarget);
    const consumed=[];
    for(const l of lotes){if(rest<=0)break;const c=truncUsdt(Math.min(l.disponible,rest));
        costo=roundMoney(costo+roundMoney(c*l.precioCompra));
        if(precioVenta!==undefined)gan=roundMoney(gan+roundMoney(c*(precioVenta-l.precioCompra)));
        consumed.push({lotId:l.id,amount:c,precio:l.precioCompra});
        l.disponible=truncUsdt(l.disponible-c);if(l.disponible<0.005)l.disponible=0;rest=truncUsdt(rest-c);if(rest<0.005)rest=0}
    return{ganancia:gan,costo,consumed};
}
function previewFIFO(cant,moneda){
    let rest=truncUsdt(cant);
    const monedaTarget=moneda||'UYU';
    const lotes=getLotesActivosFIFO().filter(l=>(l.moneda||'UYU')===monedaTarget);
    const res=[];
    for(const l of lotes){if(rest<=0)break;const c=truncUsdt(Math.min(l.disponible,rest));
        res.push({precio:l.precioCompra,cantidad:c,subtotal:roundMoney(c*l.precioCompra)});rest=truncUsdt(rest-c);if(rest<0.005)rest=0}
    return res;
}

function recalcularLotesYGanancias(){
    /* Preservar lotes manuales — nunca se eliminan por recálculo */
    const lotesManual=AppState.datos.lotes.filter(l=>l.manual).map(l=>({...l}));
    AppState.datos.lotes=[];const ev=[];
    AppState.datos.operaciones.forEach(op=>{ev.push({tipo:'op',fecha:op.fecha,hora:op.hora||'00:00',data:op})});
    AppState.datos.movimientos.filter(m=>m.tipoCuenta==='usdt').forEach(m=>{
        ev.push({tipo:m.tipoMovimiento==='ingreso'?'mi':'me',fecha:m.fecha,hora:m.hora||'00:00',data:m})});
    /* Insertar lotes manuales como eventos para que participen en FIFO cronológicamente */
    lotesManual.forEach(l=>{ev.push({tipo:'lm',fecha:l.fecha||'2000-01-01',hora:l.hora||'00:00',data:l})});
    ev.sort((a,b)=>(a.fecha+(a.hora||'00:00')).localeCompare(b.fecha+(b.hora||'00:00')));
    /* Iniciar TODOS los trackers desde 0 — reconstrucción pura desde historial */
    let utcL=0,utcUL=0,utvL=0,utvU=0;
    ev.forEach(e=>{
        if(e.tipo==='op'){
            const op=e.data;if(!op.tasa||op.tasa<=0){op.ganancia=0;op.usdt=0;op.comisionPlataforma=0;return}
            /* Defensive: normalize comisionBanco to number, preserve through replay */
            if(typeof op.comisionBanco!=='number'||!isFinite(op.comisionBanco))op.comisionBanco=0;
            const cpct=(op.comisionPct||0.14)/100;
            const uBase=usdtBase(op.monto/op.tasa,op.tipo),cp=truncar(uBase*cpct,2),isU=op.moneda==='USD';
            if(op.tipo==='compra'){
                const un=usdtNeto(uBase,cp,op.tipo);
                if(isU){
                    op.ganancia=roundMoney((utvU>0?roundMoney(un*(utvU-op.tasa)):0)-(op.comisionBanco||0));
                    utcUL=op.tasa;
                }else{utcL=op.tasa;op.ganancia=roundMoney(-(op.comisionBanco||0))}
                agregarLote(op.id,op.fecha,op.hora||'00:00',op.tasa,un,op.moneda||'UYU');
            }else{
                const av=usdtNeto(uBase,cp,op.tipo);
                const fifo=consumirFIFO(av,op.tasa,op.moneda||'UYU');
                op.consumedLots=fifo.consumed;
                if(isU){utvU=op.tasa;op.ganancia=roundMoney(fifo.ganancia)}
                else{utvL=op.tasa;op.ganancia=roundMoney(fifo.ganancia)}
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
            AppState.datos.lotes.push({id:l.id,fecha:l.fecha,hora:l.hora,precioCompra:l.precioCompra,cantidad:l.cantidad,disponible:l.cantidad,moneda:l.moneda||'UYU',manual:true});
        }
    });
    AppState.datos.ultimaTasaCompra=utcL;AppState.datos.ultimaTasaCompraUSD=utcUL;
    AppState.datos.ultimaTasaVenta=utvL;AppState.datos.ultimaTasaVentaUSD=utvU;
    sincronizarSaldoUsdt();
    invalidarGananciaCache();
    /* Listas dependen de ganancia/ops recalculadas → invalidar fingerprints también */
    if(typeof _invalidateListCache==='function')_invalidateListCache();
}

function renderizarInventario(){
    const la=getLotesActivosFIFO();
    if(!la.length){setHtml('inventarioContent','<div style="text-align:center;padding:30px;color:#94a3b8"><div style="font-size:2em;margin-bottom:8px">📭</div><div>Sin USDT en inventario</div></div>');return}
    let tot=0,h='';
    la.forEach((l,i)=>{tot=truncar(tot+l.disponible,2);const mon=l.moneda||'UYU',sy=mon==='USD'?'US$':'$',v=roundMoney(l.disponible*l.precioCompra,2);
        const tag=l.manual?'<span style="display:inline-block;font-size:0.6em;background:#e0e7ff;color:#4338ca;padding:1px 5px;border-radius:4px;font-weight:600;vertical-align:middle;margin-left:4px;letter-spacing:0.3px">manual</span>':'';
        h+=`<div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;padding:13px 0;${i>0?'border-top:1px solid #f1f5f9':''}">
            <div style="min-width:0">
                <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
                    <span style="font-size:0.88em;font-weight:700;color:#2563eb">${fmtTrunc(l.disponible,2)} USDT</span>
                    <span style="font-size:0.7em;color:#94a3b8;font-weight:500">#${i+1}${tag}</span>
                </div>
                <div style="display:flex;gap:10px;margin-top:3px;font-size:0.72em;color:#64748b">
                    <span>Precio: <b style="color:#475569">${sy}${fmtNum(l.precioCompra,mon==='USD'?3:2)}</b></span>
                    <span>Valor: <b style="color:#475569">${sy}${fmtNum(v,2)}</b></span>
                </div>
            </div>
            ${l.manual?`<button class="btn-edit-small" style="padding:6px 10px;min-height:30px;flex-shrink:0" data-action="editar-lote" data-lote-id="${l.id}">✏️</button>`:''}
        </div>`});
    h+=`<div style="margin-top:14px;padding:13px 16px;background:#f0f9ff;border:1px solid #e0f2fe;border-radius:10px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:0.78em;color:#64748b">Total inventario</span><span style="font-size:1.05em;font-weight:700;color:#2563eb">${fmtTrunc(tot,2)} USDT</span></div>`;
    setHtml('inventarioContent',h);
}

