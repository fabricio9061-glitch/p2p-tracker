function inicializarSwipe(){
    if(window.innerWidth>=768)return;
    const THRESHOLD=60,MAX=90;
    document.querySelectorAll('.op-swipe-content:not([data-swipe-init])').forEach(el=>{
        el.setAttribute('data-swipe-init','1');
        let startX=0,startY=0,dx=0,dragging=false,locked=false;
        const wrap=el.closest('.op-swipe-wrap');
        const opId=el.dataset.opId?parseInt(el.dataset.opId):null;
        const movId=el.dataset.movId?parseInt(el.dataset.movId):null;
        const transId=el.dataset.transId?parseInt(el.dataset.transId):null;
        const convId=el.dataset.convId?parseInt(el.dataset.convId):null;
        const hasEdit=!!(opId||movId||transId||convId); /* Edit via swipe-right available for all record types */

        el.addEventListener('touchstart',e=>{
            const t=e.touches[0];startX=t.clientX;startY=t.clientY;dx=0;dragging=true;locked=false;
            el.classList.remove('animate');
        },{passive:true});
        el.addEventListener('touchmove',e=>{
            if(!dragging)return;
            const t=e.touches[0],mx=t.clientX-startX,my=t.clientY-startY;
            if(!locked&&(Math.abs(mx)>8||Math.abs(my)>8)){
                locked=true;
                if(Math.abs(my)>Math.abs(mx)){dragging=false;return}
            }
            if(!locked)return;
            /* Operations: both directions. Others: left only (delete) */
            if(hasEdit)dx=Math.max(-MAX,Math.min(MAX,mx));
            else dx=Math.max(-MAX,Math.min(0,mx));
            el.style.transform=`translateX(${dx}px)`;
            wrap.classList.toggle('swiping',Math.abs(dx)>10);
        },{passive:true});
        el.addEventListener('touchend',()=>{
            if(!dragging&&!locked)return;
            dragging=false;el.classList.add('animate');
            if(dx>THRESHOLD&&hasEdit){
                el.style.transform='translateX(0)';wrap.classList.remove('swiping');
                setTimeout(()=>{
                    if(opId)abrirEditarOperacion(opId);
                    else if(movId)abrirModalMovimiento(movId);
                    else if(transId)abrirModalTransferencia(transId);
                    else if(convId)abrirModalTransferencia(convId);
                },150);
            }else if(dx<-THRESHOLD){
                el.style.transform=`translateX(-${MAX}px)`;
                setTimeout(()=>{
                    el.style.transform='translateX(0)';wrap.classList.remove('swiping');
                    if(opId)eliminarOperacion(opId);
                    else if(movId)eliminarMovimiento(movId);
                    else if(transId)eliminarTransferencia(transId);
                    else if(convId)eliminarConversion(convId);
                },200);
            }else{
                el.style.transform='translateX(0)';wrap.classList.remove('swiping');
            }
            dx=0;
        },{passive:true});
    });
}

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
        /* v5.4.6 — Antes decía "1 / 29", que informa en qué página estás pero no
           cuáles estás viendo ni cuántas hay en total. Ahora dice "1–25 de 286". */
        const desde=ini+1, hasta=Math.min(fin,total);
        setText(ids.info,`${desde}–${hasta} de ${total}`);
        $(ids.prev).disabled=pag===1;
        $(ids.next).disabled=pag===tp;
    }
    function cambiar(dir){
        let total;
        if(typeof getData==='function')total=getData().length;
        else total=getTotal();
        const tp=Math.max(1,Math.ceil(total/porPag));
        let pag=getPag()+dir;
        if(pag<1)pag=1;if(pag>tp)pag=tp;setPag(pag);
        /* ═══ v5.4.6 — La pantalla se corría al pasar de página ═══
           Cambiar de página reemplaza todas las filas de la lista. Como las filas
           no miden exactamente lo mismo (un nombre de banco más largo, un importe
           que ocupa otra línea), el alto total cambia unos píxeles y el navegador
           reacomoda el scroll. Tocando varias veces seguidas ese corrimiento se
           acumula y la pantalla termina bajando sola. Se guarda la posición antes
           de redibujar y se restaura después, así el usuario queda donde estaba. */
        const y=window.scrollY;
        render();
        if(Math.abs(window.scrollY-y)>1)window.scrollTo(0,y);
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

function actualizarSelectBancos(){
    const s=$('banco'),v=s.value;
    s.innerHTML='<option value="">-- Seleccionar --</option>';
    /* v5.6.0 — El saldo va dentro de cada opción. Antes había que elegir la
       cuenta para recién entonces ver si alcanzaba; ahora se compara de un
       vistazo antes de decidir. Se omite en las cuentas vacías, donde el saldo
       no aporta y solo hace más largo el texto. */
    getBancosActivos().forEach(b=>{
        const saldo=(AppState.datos.bancos[b.nombre]||{}).saldo||0;
        const etiq=saldo>0.005
            ? `${b.nombre} — ${getSym(b.moneda)}${fmtNum(saldo,0)}`
            : `${b.nombre} — sin saldo`;
        s.innerHTML+=`<option value="${escHtml(b.nombre)}" style="color:${b.color||'#1e293b'};font-weight:600">${escHtml(etiq)}</option>`;
    });
    s.value=v;actualizarColorBancoSelect();
}

function mostrarSaldoBanco(){
    const b=$('banco').value,i=$('saldoBancoInfo'),h=$('bancoHelp');
    if(h){h.textContent='';h.className=''}
    /* v5.6.2 — El saldo salió de acá: ahora está en el propio desplegable de
       cuentas y en el resumen del pie, con el efecto de la operación incluido.
       Repetirlo una tercera vez solo agregaba ruido. */
    i.textContent='';
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
    let heroH=`<span class="saldos-hero-label"><svg class=\"ico\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 10h18M4 10V9l8-5 8 5v1M6 10v7M10 10v7M14 10v7M18 10v7M3 20h18\"/></svg> Total Bancos (UYU)</span><span class="saldos-hero-value" style="color:${totalUYU>=0?'#16a34a':'#dc2626'}">$${fmtNum(totalUYU,2)}</span>`;
    if(totalUSD!==0||hayBancosUSD())heroH+=`<span class="saldos-hero-label" style="margin-left:auto"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h20v10H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 10h.01M18 14h.01"/></svg> USD</span><span class="saldos-hero-value" style="color:#3b82f6">US$${fmtNum(totalUSD,2)}</span>`;
    setHtml('saldosTotales',heroH);

    /* ═══ Grid de desglose: cada cuenta individual ═══ */
    let h=`<div class="banco-mini-card usdt-card" data-action="inventario"><div class="banco-nombre" style="display:flex;align-items:center;gap:6px"><img src="${LOGO_USDT}" alt="" class="banco-logo-img" style="width:20px;height:20px;object-fit:contain;border-radius:50%;flex:0 0 auto" loading="lazy" onerror="this.style.display='none'"><b style="color:#1e293b">USDT</b></div><div class="banco-saldo">${fmtTrunc(saldoUsdt,2)}</div><div class="banco-moneda">${la} lotes</div></div>`;
    /* v4.9.5 — mismo embudo ordenado que los selectores (saldo desc, vacías al
       final). Antes recorría CONFIG.BANCOS con filtro propio: orden fijo de
       declaración, con las cuentas en $0 quedando en el medio de la grilla. */
    getBancosActivos().forEach(b=>{
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
        h+=`<div class="banco-mini-card${hasGauge?' has-gauge':''}"${cardStyle} data-action="editar-saldo" data-banco="${b.nombre}"><div class="banco-nombre" style="color:${b.color||'#1e293b'};display:flex;align-items:center;gap:4px">${_bancoLogoImg(b.nombre,17)}<span class="banco-nombre-txt">${b.nombre}</span></div><div class="banco-saldo" style="color:${s>=0?'#16a34a':'#dc2626'}">${getSym(b.moneda)}${fmtNum(s,2)}</div><div class="banco-moneda">${b.moneda}</div>${limTxt}${tipHtml}</div>`;
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
    /* Mergear con lotes automáticos del mismo precio y moneda, y también con los
       de ARRASTRE: son sintéticos, reemplazan al lote automático que existía al
       corte, y si no se fusionaran, la compra nueva quedaría en un lote con fecha
       posterior → cambiaría el orden FIFO y con él la ganancia atribuida.
       v5.0.1: esto es seguro AHORA porque la DECLARACIÓN de los lotes de arrastre
       vive aparte, en datos._archivoCarryover, y es inmutable: lo que el replay
       muta acá no se persiste nunca como declaración. Entre 4.9.0 y 5.0.0 sí se
       persistía, y el saldo USDT se inflaba de forma acumulativa en cada ciclo. */
    const ex=AppState.datos.lotes.find(l=>(!l.manual||l.carryover)&&l.precioCompra===precio&&l.disponible>0&&(l.moneda||'UYU')===moneda);
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
    /* ═══ Semillas del replay: DECLARACIONES, no estado calculado (v5.0.1) ═══
       Los lotes de arrastre se leen de datos._archivoCarryover, que escriben una
       sola vez el archivado o la reparación, y que nadie vuelve a derivar del
       array de lotes. Los manuales del usuario sí salen del array: su `cantidad`
       no se muta nunca. Compatibilidad: si un documento viejo todavía trae los de
       arrastre dentro de los manuales, se adoptan al campo nuevo la primera vez. */
    if(!Array.isArray(AppState.datos._archivoCarryover)){
        const heredados=AppState.datos.lotes.filter(l=>l&&l.manual&&l.carryover);
        if(heredados.length)AppState.datos._archivoCarryover=heredados.map(l=>({...l}));
    }
    const lotesCarry=(AppState.datos._archivoCarryover||[]).map(l=>({...l,manual:true,carryover:true}));
    const lotesManual=[...lotesCarry,...AppState.datos.lotes.filter(l=>l&&l.manual&&!l.carryover).map(l=>({...l}))];
    AppState.datos.lotes=[];const ev=[];
    AppState.datos.operaciones.forEach(op=>{ev.push({tipo:'op',fecha:op.fecha,hora:op.hora||'00:00',data:op})});
    AppState.datos.movimientos.filter(m=>m.tipoCuenta==='usdt').forEach(m=>{
        ev.push({tipo:m.tipoMovimiento==='ingreso'?'mi':'me',fecha:m.fecha,hora:m.hora||'00:00',data:m})});
    /* Insertar lotes manuales como eventos para que participen en FIFO cronológicamente */
    lotesManual.forEach(l=>{ev.push({tipo:'lm',fecha:l.fecha||'2000-01-01',hora:l.hora||'00:00',data:l})});
    ev.sort((a,b)=>(a.fecha+(a.hora||'00:00')).localeCompare(b.fecha+(b.hora||'00:00')));
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
            AppState.datos.lotes.push({id:l.id,fecha:l.fecha,hora:l.hora,precioCompra:l.precioCompra,cantidad:l.cantidad,disponible:l.cantidad,moneda:l.moneda||'UYU',manual:true,...(l.carryover?{carryover:true}:{})});
        }
    });
    AppState.datos.ultimaTasaCompra=utcL;AppState.datos.ultimaTasaCompraUSD=utcUL;
    AppState.datos.ultimaTasaVenta=utvL;AppState.datos.ultimaTasaVentaUSD=utvU;
    sincronizarSaldoUsdt();
    invalidarGananciaCache();
    /* Listas dependen de ganancia/ops recalculadas → invalidar fingerprints también */
    if(typeof _invalidateListCache==='function')_invalidateListCache();
}
