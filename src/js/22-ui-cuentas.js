/* ═══════════════════════════════════════════════════════════════════════════
   §22 — CUENTAS Y LIBRO DE CADA CUENTA (v8.0.0)
   ═══════════════════════════════════════════════════════════════════════════
   El capital total, los USDT con sus lotes (siempre primero), cada cuenta con
   su cupo del día y el libro de una cuenta: cada movimiento con el saldo que
   dejó, hasta llegar al saldo de la tarjeta. */
PANTALLAS.cuentas={pintar:pintarCuentas};

const LOTES_VISIBLES=4;   /* los USDT van arriba: con pocos lotes a la vista, los bancos quedan cerca */
function capitalTotal(){
    const d=AppState.datos;
    let pesos=0,dolares=0,costoUYU=0,costoUSD=0;
    Object.keys(d.bancos||{}).forEach(n=>{
        const s=saldoDe(n);
        if(monedaDeCuenta(n)==='USD')dolares=roundMoney(dolares+s);else pesos=roundMoney(pesos+s);
    });
    (d.lotes||[]).forEach(l=>{
        if(!l||!(l.disponible>0.0049))return;
        const c=roundMoney(l.disponible*l.precioCompra);
        if((l.moneda||'UYU')==='USD')costoUSD=roundMoney(costoUSD+c);else costoUYU=roundMoney(costoUYU+c);
    });
    return{pesos,dolares,costoUYU,costoUSD,capital:roundMoney(pesos+costoUYU),capitalUSD:roundMoney(dolares+costoUSD)};
}
function lotesActivos(){return getLotesActivosFIFO()}
function textoLote(l){
    if(l.carryover)return'de meses archivados';
    const cuando=cuandoCorto(l.fecha||'',l.hora||'');
    if(l.manual)return'cargado a mano, '+(l.fecha?fmtFechaCorta(l.fecha):'');
    return(cuando.charAt(0).toLowerCase()+cuando.slice(1))+(l.tasa>0?', tasa '+fmtTasa(l.tasa,l.moneda||'UYU')+' + comisión':'');
}

function pintarCuentas(){
    const c=$('cuentasCuerpo');if(!c||!AppState.datos)return;
    const d=AppState.datos,cap=capitalTotal();
    const vis=cuentasVisibles();
    let html='';
    const tCap=dinero(cap.capital,'UYU');
    html+='<section class="capital"><div class="rot">Capital total</div>'+
        '<div class="cifra '+tamCifra(tCap,12,15)+'">'+tCap+'</div>'+
        (Math.abs(cap.capitalUSD)>=0.005?'<div class="cifra" style="font-size:26px;font-weight:720;margin-top:6px">y '+dinero(cap.capitalUSD,'USD')+'</div>':'')+
        '<div class="expl">Lo que hay en los bancos más tus USDT a lo que te costaron</div></section>';

    /* USDT, siempre primero */
    const lotes=lotesActivos();
    const costoTot=roundMoney(cap.costoUYU);
    const mostrar=AppState.ui.todosLosLotes?lotes:lotes.slice(0,LOTES_VISIBLES);
    html+='<section style="margin-top:20px"><div class="bloque" style="padding:14px 16px">'+
        '<button type="button" class="usdt-cab" data-a="libro" data-cuenta="USDT">'+mono('USDT',true)+'<span class="cta-n">USDT</span>'+
        '<span class="cta-v">'+usdtTxt(d.saldoUsdt,{unidad:false})+'</span></button>'+
        '<div class="usdt-sub">'+(lotes.length?(lotes.length===1?'1 lote':lotes.length+' lotes')+', te costaron '+dinero(costoTot,'UYU')+
            (cap.costoUSD?' y '+dinero(cap.costoUSD,'USD'):''):'No tenés USDT')+'</div>';
    if(lotes.length){
        html+='<div class="lotes">'+mostrar.map(l=>'<button type="button" class="lote" data-a="lote" data-id="'+escHtml(l.id)+'">'+
            '<span><b>'+usdtTxt(l.disponible)+'</b><br><small>'+escHtml(textoLote(l))+'</small></span>'+
            '<span>'+dinero(l.precioCompra,l.moneda||'UYU')+'<br><small>cada uno</small></span></button>').join('')+'</div>';
        if(lotes.length>mostrar.length)html+='<button type="button" class="btn-texto" style="margin-left:36px" data-a="lotes-todos">Ver los '+lotes.length+' lotes</button>';
        html+='<div class="lotes-nota">Al vender se usa primero el lote más viejo.</div>';
    }
    html+='<button type="button" class="btn-texto" style="margin-left:36px" data-a="lote-nuevo">Agregar USDT que ya tenías</button></div></section>';

    /* Bancos, de más plata a menos (en pesos y después en dólares) */
    if(vis.length){
        html+='<section style="margin-top:24px"><div class="bloque">'+vis.map(b=>{
            const n=b.nombre,bk=d.bancos[n]||{},cu=infoCupo(n);
            return'<button type="button" class="cta" data-a="libro" data-cuenta="'+escHtml(n)+'">'+mono(n,true)+
                '<span class="cta-n">'+escHtml(nombreCuenta(n))+'</span><span class="cta-v">'+dinero(saldoDe(n),b.moneda||'UYU')+'</span>'+
                (cu?'<span class="barra'+(cu.disp<0.005?' lleno':'')+'"><i style="width:'+cu.pct+'%"></i></span><span class="cta-s">'+
                    (cu.disp>=0.005?'Quedan US$'+fmtExacto(cu.disp)+' de '+fmtExacto(cu.lim)+' hoy':'Sin cupo por hoy: usaste los US$'+fmtExacto(cu.lim))+'</span>'
                   :'<span class="cta-s">'+(bk.activo?'Sin límite diario':'Desactivada, con saldo')+'</span>')+'</button>';
        }).join('')+'</div>'+
        /* El total solo suma algo cuando hay más de una cuenta en esa moneda;
           con una sola repetiría el saldo que ya se ve arriba. */
        (vis.filter(b=>b.moneda!=='USD').length>1?'<div class="total-linea"><span>En bancos</span><b>'+dinero(cap.pesos,'UYU')+'</b></div>':'')+
        (vis.filter(b=>b.moneda==='USD').length>1?'<div class="total-linea"><span>En dólares</span><b>'+dinero(cap.dolares,'USD')+'</b></div>':'')+'</section>';
    }

    html+='<section style="margin-top:16px"><button type="button" class="boton-punteado" data-a="activar-cuentas">Agregar o quitar cuentas</button></section>';
    c.innerHTML=html;
}
ACC['lotes-todos']=()=>{AppState.ui.todosLosLotes=true;pintarCuentas()};
ACC['lote']=t=>{
    const l=(AppState.datos.lotes||[]).find(x=>x&&String(x.id)===String(t.dataset.id));
    if(!l)return;
    if(l.carryover){avisar('Estos USDT vienen de meses archivados. Se corrigen desde Verificar que todo cuadre.');return}
    if(l.manual){abrirLote({id:l.id});return}
    if(buscarRegistro('operaciones',l.id))abrirDetalle('operaciones',l.id);
};
function abrirLoteDesdeDetalle(id){abrirLote({id})}

/* ─── Libro de una cuenta ──────────────────────────────────────────────── */
ACC['libro']=t=>abrirLibro(t.dataset.cuenta);
function abrirLibro(cuenta){
    if(!cuenta)return;
    abrirCapa({tipo:'vista',etiqueta:'Libro de '+nombreCuenta(cuenta),clave:'libro:'+cuenta,
        montar(cont,capa){capa.cuenta=cuenta;capa.limite=80;pintarLibro(cont,capa)},
        actualizar(cont,capa){pintarLibro(cont,capa)}});
}
function pintarLibro(cont,capa){
    const cuenta=capa.cuenta,esUsdt=cuenta==='USDT';
    const bk=esUsdt?null:AppState.datos.bancos[cuenta];
    if(!esUsdt&&!bk){cont.innerHTML=cabVista(nombreCuenta(cuenta))+'<div class="vista-cuerpo"><div class="vacio"><b>Esta cuenta no existe</b></div></div>';return}
    const saldo=saldoDe(cuenta);
    const tS=montoEnCuenta(saldo,cuenta,{unidad:false});
    let html=cabVista(nombreCuenta(cuenta),{mono:mono(cuenta,true)})+'<div class="vista-cuerpo">'+
        '<section class="libro-saldo"><div class="rot">Saldo</div><div class="cifra '+tamCifra(tS,12,15)+'">'+escHtml(tS)+(esUsdt?' <span style="font-size:.4em;font-weight:650">USDT</span>':'')+'</div>';
    if(!esUsdt){
        const cu=infoCupo(cuenta);
        if(cu)html+='<div class="barra'+(cu.disp<0.005?' lleno':'')+'"><i style="width:'+cu.pct+'%"></i></div>'+
            '<div class="libro-cupo">Cupo de hoy: quedan US$'+fmtExacto(cu.disp)+' de '+fmtExacto(cu.lim)+'. '+escHtml(textoRenovacion(cuenta))+'</div>';
        html+='<div class="libro-botones"><button type="button" class="btn" data-a="corregir" data-cuenta="'+escHtml(cuenta)+'">'+ico('corregir')+'Corregir saldo</button>'+
            '<button type="button" class="btn" data-a="limite" data-cuenta="'+escHtml(cuenta)+'">'+ico('reloj')+'Límite diario</button></div>';
    }else{
        html+='<div class="libro-botones"><button type="button" class="btn" data-a="tab-cuentas-lotes">'+ico('caja')+'Ver los lotes</button>'+
            '<button type="button" class="btn" data-a="lote-nuevo">'+ico('sumar')+'Agregar USDT</button></div>';
    }
    html+='</section>';

    const lineas=historialCuenta(cuenta);
    const vista=lineas.slice(0,capa.limite);
    let dia=null,filas='';
    const cerrar=()=>{if(dia!==null)html+='<div class="bloque lista">'+filas+'</div>';filas=''};
    vista.forEach(l=>{
        const f=l.tipo==='inicial'?'inicial':(l.ev&&l.ev.fecha)||'';
        if(f!==dia){cerrar();dia=f;html+='<div class="dia"><b>'+escHtml(f==='inicial'?'Al empezar':tituloDia(f))+'</b></div>'}
        filas+=filaLibro(l,cuenta);
    });
    cerrar();
    if(lineas.length>vista.length)html+='<button type="button" class="ver-mas" data-a="libro-mas">Ver más ('+(lineas.length-vista.length)+')</button>';
    html+='</div>';
    const v=cont;const top=v.scrollTop;
    cont.innerHTML=html;
    v.scrollTop=top;
}
function filaLibro(l,cuenta){
    if(l.tipo==='inicial'){
        return'<div class="fila"><span class="fila-t">Saldo inicial</span><span class="fila-m">'+escHtml(montoEnCuenta(l.resultante,cuenta,{unidad:false}))+'</span>'+
            '<span class="fila-s"><span>'+(cuenta==='USDT'?'lotes cargados a mano y de meses archivados':'con el que empezaste')+'</span></span></div>';
    }
    const it=itemRegistro(l.tipo,l.ev);
    let titulo=it.titulo,sub='';
    const r=l.ev;
    if(l.tipo==='transferencias'||l.tipo==='conversiones'){
        const otra=l.variacion>0?r.origen:r.destino;
        titulo=(l.tipo==='conversiones'?'Conversión ':'Transferencia ')+(l.variacion>0?'de ':'a ')+nombreCuenta(otra);
        sub=mono(otra)+'<span>'+(l.tipo==='conversiones'?'a '+escHtml(fmtNum(r.tasa,r.tasa<10?3:2))+' por dólar':((Number(r.comision)||0)>0&&l.variacion<0?'con comisión de '+escHtml(dinero(r.comision,monedaDeCuenta(cuenta))):'entre tus cuentas'))+'</span>';
    }else if(l.tipo==='operaciones'){
        sub='<span>a '+escHtml(fmtTasaMon(r.tasa,r.moneda||'UYU'))+'</span>'+(isFinite(r.comisionPct)?'<span class="marca">'+escHtml(pctTxt(r.comisionPct))+'</span>':'');
        if(cuenta!=='USDT'&&esPagoDividido(r))sub+='<span class="marca">dividida</span>';
    }else if(l.tipo==='movimientos'){
        sub='<span>'+escHtml(r.nota||(l.variacion>0?'Ingreso':'Egreso'))+'</span>';
    }else{
        sub='<span>'+escHtml(r.motivo||'sin motivo')+'</span>';
    }
    if(fueEditado(r))sub+='<span class="marca" title="Editado">'+ico('lapiz')+'</span>';
    return filaRegistroHtml(it,{titulo,sub,montoTxt:montoEnCuenta(l.variacion,cuenta,{signo:l.variacion>0,unidad:false}),montoClase:'',
        derTxt:'queda '+montoEnCuenta(l.resultante,cuenta,{unidad:false}),derClase:''});
}
ACC['libro-mas']=t=>{const c=capaDe(t);if(!c)return;c.limite+=80;pintarLibro(c.cont,c)};
ACC['tab-cuentas-lotes']=()=>{cerrarTodasLasCapas();irATab('cuentas')};

/* ─── Límite diario ────────────────────────────────────────────────────── */
ACC['limite']=t=>{
    const cuenta=t.dataset.cuenta,bk=AppState.datos.bancos[cuenta];if(!bk)return;
    const dias=getDiasReset(cuenta);
    const html=cabHoja('Límite diario de '+nombreCuenta(cuenta),{chico:true})+
        '<div class="hoja-cuerpo"><div class="grupo-campos">'+
            '<div data-campo="limite"><label class="rotulo" for="liMonto">Cuánto podés mover por día, en dólares</label>'+
                '<div class="monto-grande"><span class="sim cifra">US$</span><input id="liMonto" data-r="monto" inputmode="decimal" autocomplete="off" placeholder="Sin límite"></div>'+
                '<p class="nota-campo">Cuentan las compras y las transferencias que salen de esta cuenta. Dejalo vacío si no tiene límite.</p></div>'+
            '<div><span class="rotulo">Se renueva a las 0:30 de estos días</span><div class="dias-sel" data-r="dias">'+
                [1,2,3,4,5,6,0].map(i=>'<button type="button" data-a="li-dia" data-d="'+i+'" aria-pressed="'+dias.includes(i)+'" aria-label="'+DIAS_LARGO[i]+'">'+DIAS_LETRA[i]+'</button>').join('')+'</div>'+
                '<p class="nota-campo">Los días sin marcar siguen con el cupo del último día marcado.</p></div>'+
        '</div></div>'+
        '<div class="hoja-pie"><div data-r="error"></div><button type="button" class="btn" data-a="li-guardar" data-primario>Guardar</button></div>';
    abrirCapa({tipo:'hoja',etiqueta:'Límite diario',html,
        montar(cont,capa){capa.st={cuenta};const m=q(cont,'monto');m.value=bk.limiteDiarioUSD>0?formatoCampo(bk.limiteDiarioUSD):'';formatearAlSalir(m)}});
};
ACC['li-dia']=t=>t.setAttribute('aria-pressed',String(t.getAttribute('aria-pressed')!=='true'));
ACC['li-guardar']=t=>{
    const capa=capaDe(t),cont=capa.cont;
    const dias=[...cont.querySelectorAll('[data-a="li-dia"][aria-pressed="true"]')].map(b=>Number(b.dataset.d));
    if(!dias.length){mostrarError(capa,'Marcá por lo menos un día de renovación.');return}
    const r=guardarLimiteCuenta(capa.st.cuenta,parseMonto(q(cont,'monto').value),dias);
    if(r.ok){cerrarCapa(capa);avisar('Límite guardado.')}else mostrarError(capa,r.error,r.campo);
};

/* ─── Agregar o quitar cuentas ─────────────────────────────────────────── */
ACC['activar-cuentas']=t=>{
    const html=cabHoja('Tus cuentas',{chico:true})+'<div class="hoja-cuerpo" style="padding-bottom:calc(24px + var(--seg-abajo))">'+
        '<p class="tenue" style="font-size:14px;margin-bottom:8px">Activá las cuentas que usás. Para cargar cuánto tiene cada una, usá Corregir saldo.</p><div data-r="lista"></div></div>';
    abrirCapa({tipo:'hoja',etiqueta:'Tus cuentas',reemplazar:desdeAcciones(t),html,
        montar(cont,capa){pintarActivar(capa)},actualizar(cont,capa){pintarActivar(capa)}});
};
function pintarActivar(capa){
    q(capa.cont,'lista').innerHTML=CONFIG.BANCOS.map(b=>{
        const bk=AppState.datos.bancos[b.nombre]||{};
        return'<button type="button" class="opc" role="switch" aria-checked="'+!!bk.activo+'" data-a="cuenta-activa" data-cuenta="'+escHtml(b.nombre)+'">'+
            mono(b.nombre,true)+'<span class="t">'+escHtml(nombreCuenta(b.nombre))+'<small>'+(b.moneda==='USD'?'Dólares':'Pesos')+
            (Math.abs(bk.saldo||0)>=0.005?', '+escHtml(dinero(bk.saldo,b.moneda||'UYU')):'')+'</small></span><span class="interruptor"></span></button>';
    }).join('');
}
ACC['cuenta-activa']=async t=>{
    const n=t.dataset.cuenta,bk=AppState.datos.bancos[n]||{};
    const activar=!bk.activo;
    if(!activar&&Math.abs(bk.saldo||0)>=0.005){
        const si=await preguntar({titulo:'¿Desactivar '+nombreCuenta(n)+'?',
            texto:'Tiene '+dinero(bk.saldo,monedaDeCuenta(n))+'. Va a seguir sumando en tu capital, pero no vas a poder elegirla al cargar.',si:'Desactivar'});
        if(!si)return;
    }
    activarCuenta(n,activar);
};
