/* ═══════════════════════════════════════════════════════════════════════════
   §19 — INICIO (v8.0.2)
   ═══════════════════════════════════════════════════════════════════════════
   Lo primero que se ve, compacto y práctico: la ganancia de hoy con la
   semana al lado, el spread, las comisiones y los otros ingresos de hoy, ayer,
   el mes y el promedio; después la actividad del período (compras y ventas),
   los dos botones de uso diario, cuánto hay en USDT y en cada cuenta (USDT
   primero, después los bancos de más plata a menos) y lo que se cargó hoy. */
PANTALLAS.inicio={pintar:pintarInicio};

function claseSigno(n){return n>=0.005?'sube':n<=-0.005?'baja':''}

/* ─── Actividad de un período ──────────────────────────────────────────── */
/* Compras y ventas en pesos entre dos fechas (incluidas): cuántas, cuánto se
   pagó y cobró, la tasa promedio de cada lado (ponderada por USDT), el spread
   y la comisión de Binance. Las operaciones en dólares se cuentan aparte. */
function actividadEntre(desde,hasta){
    const r={compras:{n:0,monto:0,pagado:0,usdt:0},ventas:{n:0,cobrado:0,usdt:0},
             comUsdt:0,comPesos:0,ingresos:0,opsUSD:0};
    (AppState.datos.operaciones||[]).forEach(o=>{
        if(!o||o.fecha<desde||o.fecha>hasta)return;
        if((o.moneda||'UYU')==='USD'){r.opsUSD++;return}
        const base=Number(o.usdt)||0,monto=Number(o.monto)||0;
        if(o.tipo==='compra'){
            const k=r.compras;k.n++;
            k.monto=roundMoney(k.monto+monto);
            k.pagado=roundMoney(k.pagado+monto+(Number(o.comisionBanco)||0));
            k.usdt=roundMoney(k.usdt+base);
        }else{
            const k=r.ventas;k.n++;
            k.cobrado=roundMoney(k.cobrado+monto);
            k.usdt=roundMoney(k.usdt+base);
        }
        const cp=Number(o.comisionPlataforma)||0;
        r.comUsdt=roundMoney(r.comUsdt+cp);
        r.comPesos=roundMoney(r.comPesos+cp*(Number(o.tasa)||0));
    });
    (AppState.datos.movimientos||[]).forEach(m=>{
        if(!m||m.tipoMovimiento!=='ingreso'||m.fecha<desde||m.fecha>hasta)return;
        r.ingresos=roundMoney(r.ingresos+movimientoValorUYU(m));
    });
    r.promCompra=r.compras.usdt>0?r.compras.monto/r.compras.usdt:0;
    r.promVenta=r.ventas.usdt>0?r.ventas.cobrado/r.ventas.usdt:0;
    r.spread=(r.promCompra>0&&r.promVenta>0)?roundMoney(r.promVenta-r.promCompra):null;
    r.total=r.compras.n+r.ventas.n;
    return r;
}
const PERIODOS_ACT=[['hoy','Hoy'],['semana','7 días'],['mes','Mes']];
function periodoActividad(){
    if(!AppState.ui.actividad){
        let v='mes';
        try{v=localStorage.getItem('p2p_actividad')||'mes'}catch(_){}
        AppState.ui.actividad=PERIODOS_ACT.some(p=>p[0]===v)?v:'mes';
    }
    return AppState.ui.actividad;
}
ACC['act-periodo']=t=>{
    AppState.ui.actividad=t.dataset.p;
    try{localStorage.setItem('p2p_actividad',t.dataset.p)}catch(_){}
    pintarInicio();
};
function htmlActividad(hoy){
    const p=periodoActividad();
    const desde=p==='hoy'?hoy:p==='semana'?sumarDias(hoy,-6):hoy.slice(0,7)+'-01';
    const a=actividadEntre(desde,hoy);
    const lado=(clase,icono,titulo,monto,n,prom,singular,plural)=>
        '<div class="act '+clase+'"><span class="act-t">'+ico(icono)+titulo+'</span>'+
        '<span class="act-v cifra">'+dinero(monto,'UYU')+'</span>'+
        '<span class="act-s">'+(n?n+' '+(n===1?singular:plural)+(prom>0?' a '+dinero(prom,'UYU')+' prom.':''):'Ninguna')+'</span></div>';
    let html='<section class="seccion"><div class="seccion-cab con-periodos"><h2>Actividad</h2>'+
        '<div class="periodos" role="group" aria-label="Período">'+PERIODOS_ACT.map(([k,t])=>
            '<button type="button" class="periodo" data-a="act-periodo" data-p="'+k+'" aria-pressed="'+(p===k)+'">'+t+'</button>').join('')+'</div></div>'+
        '<div class="actividad">'+
            lado('act-compra','compra','Compras',a.compras.pagado,a.compras.n,a.promCompra,'compra','compras')+
            lado('act-venta','venta','Ventas',a.ventas.cobrado,a.ventas.n,a.promVenta,'venta','ventas')+
        '</div>';
    return html+'</section>';
}
/* Un dato chico: rótulo, valor y, si hace falta, una aclaración */
function ficha(rot,valor,clase,nota){
    return'<div><span>'+escHtml(rot)+'</span><b class="cifra '+(clase||'')+'">'+escHtml(valor)+'</b>'+(nota?'<small>'+escHtml(nota)+'</small>':'')+'</div>';
}

function pintarInicio(){
    const c=$('inicioCuerpo');if(!c||!AppState.datos)return;
    const d=AppState.datos;
    const hoy=getUDateStr(),ayer=sumarDias(hoy,-1),mes=hoy.slice(0,7);
    const g=calcularGananciaDiaria();
    const st=getDayStats(hoy)||{gananciaOps:0,gastos:0};
    const gHoy=roundMoney(g[hoy]||0);
    const gUSD=roundMoney((d.operaciones||[]).filter(o=>o&&o.fecha===hoy&&o.moneda==='USD')
        .reduce((s,o)=>s+(Number(o.ganancia)||0),0));
    let html='';

    html+=htmlAvisosDatos();

    if(AppState.ui.hayNovedad){
        html+='<button type="button" class="novedad" data-a="novedades">'+
            '<span><b>Hay cosas nuevas en la versión '+escHtml(CONFIG.APP_VERSION.split('.').slice(0,2).join('.'))+'.</b> Mirá qué cambió.</span>'+ico('sig')+'</button>';
    }

    /* ── Ganancia de hoy ── */
    const tHoy=dinero(gHoy,'UYU',{signo:true});
    const deHoy=actividadEntre(hoy,hoy);
    const operado=roundMoney(deHoy.compras.pagado+deHoy.ventas.cobrado);
    const lineaHoy=deHoy.total
        ?deHoy.total+(deHoy.total===1?' operación':' operaciones')+': '+
            [deHoy.compras.n?deHoy.compras.n+(deHoy.compras.n===1?' compra':' compras'):'',
             deHoy.ventas.n?deHoy.ventas.n+(deHoy.ventas.n===1?' venta':' ventas'):''].filter(Boolean).join(' y ')+
            '. <span class="nw">Operado '+dinero(operado,'UYU')+'.</span>'
        :'Sin operaciones hoy.';
    /* v8.0.2 — Más compacto y práctico: la cifra a la izquierda y la semana a
       su lado; el desglose y las operaciones en una línea cada uno. */
    const dias=[];
    for(let i=6;i>=0;i--){const f=sumarDias(hoy,-i);dias.push({f,v:roundMoney(g[f]||0),hoy:i===0})}
    const max=Math.max(1,...dias.map(x=>Math.abs(x.v)));
    const semana='<div class="semana" role="group" aria-label="Ganancia de los últimos 7 días">'+dias.map(x=>{
        const h=Math.abs(x.v)>=0.005?Math.max(2,Math.round(Math.abs(x.v)/max*18)):0;
        const dd=fechaObj(x.f);
        const et=(x.hoy?'Hoy':mayus(DIAS_LARGO[dd.getDay()])+' '+dd.getDate())+': '+(h?dinero(x.v,'UYU',{signo:true}):'sin movimientos');
        return'<button type="button" class="semana-col'+(x.hoy?' hoy':'')+'" data-a="ir-dia" data-fecha="'+x.f+'" aria-label="'+escHtml(et)+'">'+
            '<span class="arr">'+(x.v>0&&h?'<span class="b" style="height:'+h+'px"></span>':'')+'</span>'+
            '<span class="eje"></span>'+
            '<span class="aba">'+(x.v<0&&h?'<span class="bn" style="height:'+h+'px"></span>':'')+'</span>'+
            '<span>'+DIAS_LETRA[dd.getDay()]+'</span></button>';
    }).join('')+'</div>';
    html+='<section class="heroe" aria-label="Ganancia de hoy">'+
        '<div class="heroe-fila"><div class="heroe-izq"><div class="heroe-rot">Ganancia de hoy</div>'+
            '<div class="heroe-cifra cifra '+claseSigno(gHoy)+'">'+tHoy+'</div></div>'+semana+'</div>'+
        '<div class="heroe-desglose">'+
            '<span>Operaciones <b class="'+claseSigno(st.gananciaOps)+'">'+dinero(st.gananciaOps,'UYU',{signo:true})+'</b></span>'+
            '<span>Egresos <b>'+dinero(-(st.gastos||0),'UYU')+'</b></span>'+
            (Math.abs(gUSD)>=0.005?'<span>En dólares <b class="'+claseSigno(gUSD)+'">'+dinero(gUSD,'USD',{signo:true})+'</b></span>':'')+
        '</div>'+
        '<div class="heroe-ops">'+lineaHoy+'</div>';
    let gMes=0;
    Object.entries(g).forEach(([f,v])=>{if(f.startsWith(mes))gMes=roundMoney(gMes+v)});
    const gAyer=roundMoney(g[ayer]||0);
    /* Promedio de los 7 días anteriores a hoy (hoy no cuenta: todavía no terminó) */
    let suma7=0;for(let i=1;i<=7;i++)suma7+=g[sumarDias(hoy,-i)]||0;
    const prom7=roundMoney(suma7/7);
    /* v8.0.2 — Dentro de la misma tarjeta: el spread, las comisiones y los
       otros ingresos de hoy (siempre los tres, aunque estén en cero), y abajo
       ayer, el mes y el promedio. Una grilla en vez de muchas cajitas. */
    html+='<div class="hoy-grilla"><div class="mini-datos hoy-datos">'+
        ficha('Spread',deHoy.spread!==null?dinero(deHoy.spread,'UYU'):MENOS,deHoy.spread!==null?claseSigno(deHoy.spread):'','por USDT')+
        ficha('Comisiones',usdtTxt(deHoy.comUsdt),'',dinero(deHoy.comPesos,'UYU')+' en pesos')+
        ficha('Otros ingresos',dinero(deHoy.ingresos,'UYU',{signo:true}),deHoy.ingresos>=0.005?'sube':'','no es ganancia')+'</div>';
    html+='<div class="mini-datos semana-pie">'+
        ficha('Ayer',dinero(gAyer,'UYU',{signo:true}),claseSigno(gAyer))+
        ficha('Este mes',dinero(gMes,'UYU',{signo:true}),claseSigno(gMes))+
        ficha('Prom. 7 días',dinero(prom7,'UYU',{signo:true}),claseSigno(prom7))+'</div></div>';
    html+='</section>';

    /* ── Actividad del período ── */
    html+=htmlActividad(hoy);

    /* ── Uso diario: debajo de la actividad ── */
    html+='<section class="botones-op">'+
        '<button type="button" class="boton-op compra" data-a="op-nueva" data-tipo="compra">'+ico('compra')+'Comprar USDT</button>'+
        '<button type="button" class="boton-op venta" data-a="op-nueva" data-tipo="venta">'+ico('venta')+'Vender USDT</button></section>';

    /* ── Cuentas ── */
    const vis=cuentasVisibles();
    const uyu=vis.filter(b=>(b.moneda||'UYU')==='UYU'),usd=vis.filter(b=>b.moneda==='USD');
    html+='<section class="seccion"><div class="seccion-cab"><h2>Cuentas</h2><button type="button" class="ir" data-a="tab" data-tab="cuentas">Ver todas</button></div>';
    if(vis.length){
        /* El total solo cuando hay más de una cuenta: con una sola repetiría su tarjeta */
        const totales=[];
        if(uyu.length>1)totales.push(['En bancos',dinero(uyu.reduce((s,b)=>s+saldoDe(b.nombre),0),'UYU')]);
        if(usd.length>1)totales.push(['En dólares',dinero(usd.reduce((s,b)=>s+saldoDe(b.nombre),0),'USD')]);
        if(totales.length)html+='<div class="totales">'+totales.map(([r,v])=>'<span>'+r+' <b class="cifra">'+v+'</b></span>').join('')+'</div>';
        /* USDT siempre primero; después los bancos, de más plata a menos */
        html+='<div class="tiles">'+tileUsdt()+vis.slice(0,5).map(tileCuenta).join('')+'</div>';
    }else{
        html+='<div class="tiles">'+tileUsdt()+'<button type="button" class="tile activar" data-a="activar-cuentas">Elegí las cuentas que usás para empezar</button></div>';
    }
    html+='</section>';

    /* ── Hoy ── */
    const movsHoy=itemsDelRegistro().filter(it=>it.fecha===hoy);
    html+='<section class="seccion"><div class="seccion-cab"><h2>Hoy</h2><button type="button" class="ir" data-a="tab" data-tab="registro">Ver registro</button></div>';
    if(!movsHoy.length){
        html+='<div class="bloque vacio"><b>Todavía no cargaste nada hoy</b><p>Con el botón + cargás una compra, una venta, un ingreso o un egreso.</p></div>';
    }else{
        html+='<div class="bloque lista">'+movsHoy.slice(0,4).map(it=>filaRegistroHtml(it)).join('')+'</div>';
        if(movsHoy.length>4)html+='<button type="button" class="ver-mas" data-a="ir-dia" data-fecha="'+hoy+'">Ver los '+movsHoy.length+' movimientos de hoy</button>';
    }
    html+='</section>';
    c.innerHTML=html;
}

function tileCuenta(b){
    const n=b.nombre,cu=infoCupo(n),bk=AppState.datos.bancos[n]||{};
    const pie=cu
        ?'<span class="barra'+(cu.disp<0.005?' lleno':'')+'"><i style="width:'+cu.pct+'%"></i></span><span class="t-x">'+(cu.disp>=0.005?'Quedan US$'+fmtExacto(cu.disp):'Sin cupo hoy')+'</span>'
        :'<span class="t-x solo">'+(bk.activo?'Sin límite':'Desactivada')+'</span>';
    return'<button type="button" class="tile" data-a="libro" data-cuenta="'+escHtml(n)+'">'+
        '<span class="t-n">'+mono(n)+'<b>'+escHtml(nombreCuenta(n))+'</b></span>'+
        '<span class="t-s">'+dinero(saldoDe(n),b.moneda||'UYU')+'</span>'+pie+'</button>';
}
/* Tarjeta de USDT: cuántos hay y a cuánto salieron, en promedio, los que quedan */
function tileUsdt(){
    const s=roundMoney(AppState.datos.saldoUsdt||0);
    let cant=0,costo=0;
    (AppState.datos.lotes||[]).forEach(l=>{
        if(!l||!(l.disponible>0.0049)||(l.moneda||'UYU')!=='UYU')return;
        cant+=l.disponible;costo+=l.disponible*l.precioCompra;
    });
    const prom=cant>0?costo/cant:0;
    return'<button type="button" class="tile" data-a="libro" data-cuenta="USDT">'+
        '<span class="t-n">'+mono('USDT')+'<b>USDT</b></span>'+
        '<span class="t-s">'+usdtTxt(s,{unidad:false})+'</span>'+
        '<span class="t-x solo">'+(prom>0?'Prom. '+dinero(prom,'UYU'):'Sin USDT')+'</span></button>';
}

/* ─── Avisos sobre tus datos (v8.0.1) ──────────────────────────────────── */
/* Si los cambios no se están subiendo, o si falta algo que estaba en la
   última copia automática, se avisa arriba de todo y en grande. */
function htmlAvisosDatos(){
    let h='';
    const pg=AppState.ui.problemaGuardado;
    if(pg){
        h+='<div class="alerta-datos" role="alert">'+ico('alerta')+'<div><b>Tus últimos cambios no se subieron a internet</b>'+
            '<p>Están guardados en este teléfono y se suben solos apenas se pueda. Mientras tanto no cierres sesión ni borres los datos de la app.</p>'+
            '<button type="button" class="btn-texto" data-a="sync-reintentar">Reintentar ahora</button></div></div>';
    }
    const fc=AppState.ui.faltanCopia;
    if(fc&&fc.n>0){
        const x=isoAUY(new Date(fc.ts).toISOString());
        h+='<div class="alerta-datos" role="alert">'+ico('alerta')+'<div><b>'+(fc.n===1?'Falta 1 movimiento':'Faltan '+fc.n+' movimientos')+' que tenías '+escHtml(x?cuandoTexto(x.fecha,x.hora):'hace un rato')+'</b>'+
            '<p>Están en una copia automática de este teléfono. Los podés recuperar sin borrar nada.</p>'+
            '<button type="button" class="btn-texto" data-a="copias">Ver y recuperar</button></div></div>';
    }
    return h;
}
function pintarAvisoGuardado(){if(AppState.ui.tab==='inicio')pintarTab()}
ACC['sync-reintentar']=()=>{
    _syncErrors=0;_retryDelay=2000;clearTimeout(_retryTimer);
    avisar('Reintentando…');
    guardarDatos(true);
};

/* Ir al registro de un día puntual (desde el gráfico o "Ver los movimientos de hoy") */
ACC['ir-dia']=t=>{
    const r=AppState.ui.registro;
    r.dia=t.dataset.fecha||'';r.tipo='todo';r.cuenta='';r.buscar='';r.limite=60;
    const inp=$('regBuscar');if(inp)inp.value='';
    cerrarTodasLasCapas();
    irATab('registro');
};
