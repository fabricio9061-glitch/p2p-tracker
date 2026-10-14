/* ═══════════════════════════════════════════════════════════════════════════
   §19 — INICIO (v8.0.0)
   ═══════════════════════════════════════════════════════════════════════════
   Lo primero que se ve: cuánto se ganó hoy, la semana, los dos botones de uso
   diario, cuánto hay en cada cuenta y lo que se cargó hoy. */
PANTALLAS.inicio={pintar:pintarInicio};

function claseSigno(n){return n>=0.005?'sube':n<=-0.005?'baja':''}

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

    if(AppState.ui.hayNovedad){
        html+='<button type="button" class="novedad" data-a="novedades">'+
            '<span><b>Hay cosas nuevas en la versión '+escHtml(CONFIG.APP_VERSION.split('.').slice(0,2).join('.'))+'.</b> Mirá qué cambió.</span>'+ico('sig')+'</button>';
    }

    /* ── Ganancia de hoy ── */
    const tHoy=dinero(gHoy,'UYU',{signo:true});
    html+='<section class="heroe" aria-label="Ganancia de hoy">'+
        '<div class="heroe-rot">Ganancia de hoy</div>'+
        '<div class="heroe-cifra cifra '+claseSigno(gHoy)+' '+tamCifra(tHoy,10,13)+'">'+tHoy+'</div>'+
        '<div class="heroe-desglose">'+
            '<span>Operaciones</span><span class="'+claseSigno(st.gananciaOps)+'">'+dinero(st.gananciaOps,'UYU',{signo:true})+'</span>'+
            '<span>Egresos</span><span>'+dinero(-(st.gastos||0),'UYU')+'</span>'+
            (Math.abs(gUSD)>=0.005?'<span>En dólares</span><span class="'+claseSigno(gUSD)+'">'+dinero(gUSD,'USD',{signo:true})+'</span>':'')+
        '</div>';

    /* ── Últimos 7 días ── */
    const dias=[];
    for(let i=6;i>=0;i--){const f=sumarDias(hoy,-i);dias.push({f,v:roundMoney(g[f]||0),hoy:i===0})}
    const max=Math.max(1,...dias.map(x=>Math.abs(x.v)));
    html+='<div class="semana" role="group" aria-label="Ganancia de los últimos 7 días">'+dias.map(x=>{
        const h=Math.abs(x.v)>=0.005?Math.max(3,Math.round(Math.abs(x.v)/max*34)):0;
        const dd=fechaObj(x.f);
        const et=(x.hoy?'Hoy':mayus(DIAS_LARGO[dd.getDay()])+' '+dd.getDate())+': '+(h?dinero(x.v,'UYU',{signo:true}):'sin movimientos');
        return'<button type="button" class="semana-col'+(x.hoy?' hoy':'')+'" data-a="ir-dia" data-fecha="'+x.f+'" aria-label="'+escHtml(et)+'">'+
            '<span class="arr">'+(x.v>0&&h?'<span class="b" style="height:'+h+'px"></span>':'')+'</span>'+
            '<span class="eje"></span>'+
            '<span class="aba">'+(x.v<0&&h?'<span class="bn" style="height:'+h+'px"></span>':'')+'</span>'+
            '<span>'+(x.hoy?'Hoy':DIAS_LETRA[dd.getDay()])+'</span></button>';
    }).join('')+'</div>';
    let gMes=0;
    Object.entries(g).forEach(([f,v])=>{if(f.startsWith(mes))gMes=roundMoney(gMes+v)});
    const gAyer=roundMoney(g[ayer]||0);
    html+='<div class="semana-pie"><div><span class="tenue">Ayer </span><b class="'+claseSigno(gAyer)+'">'+dinero(gAyer,'UYU',{signo:true})+'</b></div>'+
          '<div><span class="tenue">Este mes </span><b class="'+claseSigno(gMes)+'">'+dinero(gMes,'UYU',{signo:true})+'</b></div></div>';
    html+='</section>';

    /* ── Uso diario ── */
    html+='<section class="botones-op">'+
        '<button type="button" class="boton-op compra" data-a="op-nueva" data-tipo="compra">'+ico('compra')+'Comprar USDT</button>'+
        '<button type="button" class="boton-op venta" data-a="op-nueva" data-tipo="venta">'+ico('venta')+'Vender USDT</button></section>';

    /* ── Cuentas ── */
    const vis=cuentasVisibles();
    const uyu=vis.filter(b=>(b.moneda||'UYU')==='UYU'),usd=vis.filter(b=>b.moneda==='USD');
    const totUYU=roundMoney(uyu.reduce((s,b)=>s+saldoDe(b.nombre),0));
    const totUSD=roundMoney(usd.reduce((s,b)=>s+saldoDe(b.nombre),0));
    html+='<section class="seccion"><div class="seccion-cab"><h2>Cuentas</h2><button type="button" class="ir" data-a="tab" data-tab="cuentas">Ver todas</button></div>';
    if(vis.length){
        html+='<div class="totales">'+
            '<div><div class="rot">En bancos</div><div class="cifra">'+dinero(totUYU,'UYU',{dec:0})+'</div></div>'+
            (usd.length?'<div><div class="rot">En dólares</div><div class="cifra">'+dinero(totUSD,'USD',{dec:0})+'</div></div>':'')+
            '<div><div class="rot">USDT</div><div class="cifra">'+usdtTxt(d.saldoUsdt,{unidad:false})+'</div></div></div>';
        html+='<div class="tiles">'+vis.slice(0,6).map(tileCuenta).join('')+'</div>';
    }else{
        html+='<div class="tiles"><button type="button" class="tile activar" data-a="activar-cuentas">Elegí las cuentas que usás para empezar</button></div>';
    }
    html+='</section>';

    /* ── Hoy ── */
    const deHoy=itemsDelRegistro().filter(it=>it.fecha===hoy);
    html+='<section class="seccion"><div class="seccion-cab"><h2>Hoy</h2><button type="button" class="ir" data-a="tab" data-tab="registro">Ver registro</button></div>';
    if(!deHoy.length){
        html+='<div class="bloque vacio"><b>Todavía no cargaste nada hoy</b><p>Con el botón + cargás una compra, una venta, un ingreso o un egreso.</p></div>';
    }else{
        html+='<div class="bloque">'+deHoy.slice(0,4).map(it=>filaRegistroHtml(it)).join('')+'</div>';
        if(deHoy.length>4)html+='<button type="button" class="ver-mas" data-a="ir-dia" data-fecha="'+hoy+'">Ver los '+deHoy.length+' movimientos de hoy</button>';
    }
    html+='</section>';
    c.innerHTML=html;
}

function tileCuenta(b){
    const n=b.nombre,cu=infoCupo(n),bk=AppState.datos.bancos[n]||{};
    const pie=cu
        ?'<span class="barra'+(cu.disp<=0.5?' lleno':'')+'"><i style="width:'+cu.pct+'%"></i></span><span class="t-x">'+(cu.disp>0.5?'Quedan US$'+fmtNum(cu.disp,0)+' hoy':'Sin cupo por hoy')+'</span>'
        :'<span class="t-x solo">'+(bk.activo?'Sin límite diario':'Desactivada')+'</span>';
    return'<button type="button" class="tile" data-a="libro" data-cuenta="'+escHtml(n)+'">'+
        '<span class="t-n">'+mono(n)+'<b>'+escHtml(nombreCuenta(n))+'</b></span>'+
        '<span class="t-s">'+dinero(saldoDe(n),b.moneda||'UYU',{dec:0})+'</span>'+pie+'</button>';
}

/* Ir al registro de un día puntual (desde el gráfico o "Ver los movimientos de hoy") */
ACC['ir-dia']=t=>{
    const r=AppState.ui.registro;
    r.dia=t.dataset.fecha||'';r.tipo='todo';r.cuenta='';r.buscar='';r.limite=60;
    const inp=$('regBuscar');if(inp)inp.value='';
    cerrarTodasLasCapas();
    irATab('registro');
};
