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
    /* v8.1.0 — Nombre de la cuenta (y borrarla, si es una agregada sin movimientos) */
    const editar=esUsdt?'':'<button type="button" class="vista-accion" data-a="cuenta-editar" data-cuenta="'+escHtml(cuenta)+'">'+ico('lapiz')+'<span>Editar</span></button>';
    let html=cabVista(nombreCuenta(cuenta),{mono:mono(cuenta,true),derecha:editar})+'<div class="vista-cuerpo">'+
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
        sub=monoCuenta(otra)+'<span>'+(l.tipo==='conversiones'?'a '+escHtml(fmtNum(r.tasa,r.tasa<10?3:2))+' por dólar':((Number(r.comision)||0)>0&&l.variacion<0?'con comisión de '+escHtml(dinero(r.comision,monedaDeCuenta(cuenta))):'entre tus cuentas'))+'</span>';
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
/* v8.1.0 — Además de las de siempre, se pueden agregar otras: una segunda
   cuenta del mismo banco (Itaú empresa) o una en dólares (Itaú dólares). */
ACC['activar-cuentas']=t=>{
    const html=cabHoja('Tus cuentas',{chico:true})+'<div class="hoja-cuerpo" style="padding-bottom:calc(24px + var(--seg-abajo))">'+
        '<p class="tenue" style="font-size:14px;margin-bottom:12px">Activá las cuentas que usás. Si tenés dos en el mismo banco, o una en dólares, agregala acá.</p>'+
        '<button type="button" class="boton-punteado con-icono" data-a="cuenta-nueva">'+ico('sumar')+'Agregar otra cuenta</button>'+
        '<div data-r="lista" style="margin-top:8px"></div></div>';
    abrirCapa({tipo:'hoja',etiqueta:'Tus cuentas',clave:'tus-cuentas',reemplazar:desdeAcciones(t),html,
        montar(cont,capa){pintarActivar(capa)},actualizar(cont,capa){pintarActivar(capa)}});
};
function pintarActivar(capa){
    q(capa.cont,'lista').innerHTML=todasLasCuentas().map(b=>{
        const n=b.nombre,bk=AppState.datos.bancos[n]||{};
        return'<button type="button" class="opc'+(b.agregada?' agregada':'')+'" role="switch" aria-checked="'+!!bk.activo+'" data-a="cuenta-activa" data-cuenta="'+escHtml(n)+'">'+
            mono(n,true)+'<span class="t">'+escHtml(nombreCuenta(n))+'<small>'+(b.moneda==='USD'?'Dólares':'Pesos')+
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

/* ─── Nueva cuenta ─────────────────────────────────────────────────────── */
ACC['cuenta-nueva']=()=>{
    const bancos=CONFIG.BANCOS.map(b=>'<button type="button" class="pastilla con-mono" data-a="cn-banco" data-banco="'+escHtml(b.nombre)+'" aria-pressed="false">'+
        mono(b.nombre)+'<span>'+escHtml(b.etiqueta||b.nombre)+'</span></button>').join('');
    const html=cabHoja('Nueva cuenta',{chico:true})+'<div class="hoja-cuerpo"><div class="grupo-campos">'+
            '<div data-campo="banco"><span class="rotulo">Banco</span><div class="pastillas" role="group" aria-label="Banco">'+bancos+'</div></div>'+
            '<div><span class="rotulo">Moneda</span><div class="segmento ancho" role="tablist" aria-label="Moneda">'+
                '<button type="button" role="tab" data-a="cn-moneda" data-moneda="UYU" aria-selected="true">Pesos</button>'+
                '<button type="button" role="tab" data-a="cn-moneda" data-moneda="USD" aria-selected="false">Dólares</button></div></div>'+
            '<div data-campo="nombre"><label class="rotulo" for="cnNombre">Nombre</label>'+
                '<input class="campo" id="cnNombre" data-r="nombre" maxlength="'+CUENTA_NOMBRE_MAX+'" autocomplete="off" autocapitalize="sentences" placeholder="Por ejemplo, Itaú empresa" data-in="cn-nombre">'+
                '<p class="nota-campo">Así la vas a ver en todos lados.</p></div>'+
            '<div data-campo="saldo"><label class="rotulo" for="cnSaldo">Cuánto tiene hoy</label>'+
                '<div class="monto-grande"><span class="sim cifra" data-r="sim">$</span><input id="cnSaldo" data-r="saldo" inputmode="decimal" autocomplete="off" placeholder="0"></div>'+
                '<p class="nota-campo">Si la dejás en 0, después lo cargás con Corregir saldo.</p></div>'+
        '</div></div>'+
        '<div class="hoja-pie"><div data-r="error"></div><button type="button" class="btn" data-a="cn-guardar" data-primario>Agregar cuenta</button></div>';
    abrirCapa({tipo:'hoja',clase:'alta',etiqueta:'Nueva cuenta',clave:'cuenta-nueva',html,
        montar(cont,capa){capa.st={banco:'',moneda:'UYU',nombreTocado:false};formatearAlSalir(q(cont,'saldo'))}});
};
/* El nombre se propone solo mientras no se haya escrito uno: "Itaú dólares"
   para una cuenta en dólares de un banco de pesos; si no, se deja para escribir. */
function cnProponerNombre(capa){
    const st=capa.st,inp=q(capa.cont,'nombre');
    if(st.nombreTocado||!st.banco)return;
    const b=CONFIG.BANCOS.find(x=>x.nombre===st.banco),et=b?(b.etiqueta||b.nombre):'';
    let v=st.moneda==='USD'&&b&&b.moneda!=='USD'?et+' dólares':'';
    if(v&&!revisarNombreCuenta(v).ok)v='';
    inp.value=v;
    inp.placeholder='Por ejemplo, '+et+(st.moneda==='USD'&&b&&b.moneda!=='USD'?' dólares':' empresa');
}
ACC['cn-banco']=t=>{
    const capa=capaDe(t);if(!capa)return;
    const st=capa.st,b=CONFIG.BANCOS.find(x=>x.nombre===t.dataset.banco);if(!b)return;
    st.banco=b.nombre;
    capa.cont.querySelectorAll('[data-a="cn-banco"]').forEach(x=>x.setAttribute('aria-pressed',String(x===t)));
    /* Los bancos de dólares (Zelle, Zinli, Skrill) solo tienen cuentas en dólares */
    const soloUSD=b.moneda==='USD';
    if(soloUSD)st.moneda='USD';
    capa.cont.querySelectorAll('[data-a="cn-moneda"]').forEach(x=>{
        x.setAttribute('aria-selected',String(x.dataset.moneda===st.moneda));
        x.disabled=soloUSD&&x.dataset.moneda==='UYU';
    });
    q(capa.cont,'sim').textContent=st.moneda==='USD'?'US$':'$';
    limpiarError(capa);cnProponerNombre(capa);
};
ACC['cn-moneda']=t=>{
    const capa=capaDe(t);if(!capa)return;
    capa.st.moneda=t.dataset.moneda==='USD'?'USD':'UYU';
    capa.cont.querySelectorAll('[data-a="cn-moneda"]').forEach(x=>x.setAttribute('aria-selected',String(x===t)));
    q(capa.cont,'sim').textContent=capa.st.moneda==='USD'?'US$':'$';
    limpiarError(capa);cnProponerNombre(capa);
};
ENT['cn-nombre']=el=>{const capa=capaDe(el);if(!capa)return;capa.st.nombreTocado=el.value.trim()!=='';limpiarError(capa)};
ACC['cn-guardar']=t=>{
    const capa=capaDe(t);if(!capa)return;
    const st=capa.st,cont=capa.cont;
    const txt=q(cont,'saldo').value.trim();
    const r=crearCuenta({banco:st.banco,moneda:st.moneda,nombre:q(cont,'nombre').value,saldo:txt?parseMonto(txt):0});
    if(!r.ok){st.hayError=true;mostrarError(capa,r.error,r.campo);return}
    cerrarCapa(capa);
    avisar('Se agregó '+r.nombre+'.');
};

/* ─── Editar una cuenta: nombre y, si es agregada, borrarla ────────────── */
ACC['cuenta-editar']=t=>{
    const cuenta=t.dataset.cuenta;
    if(!AppState.datos.bancos[cuenta])return;
    abrirCapa({tipo:'hoja',etiqueta:'Cuenta',clave:'cuenta-editar',
        montar(cont,capa){capa.cuenta=cuenta;pintarEditarCuenta(cont,capa)},
        actualizar(cont,capa){const a=document.activeElement;if(a&&cont.contains(a)&&a.tagName==='INPUT')return;pintarEditarCuenta(cont,capa)}});
};
function pintarEditarCuenta(cont,capa){
    const n=capa.cuenta,b=getBancoInfo(n);
    if(!b||!AppState.datos.bancos[n]){cont.innerHTML=cabHoja('Cuenta',{chico:true})+'<div class="hoja-cuerpo"><div class="vacio"><b>Esta cuenta ya no está</b></div></div>';return}
    const banco=CONFIG.BANCOS.find(x=>x.nombre===bancoDeCuenta(n))||{};
    const etBanco=banco.etiqueta||banco.nombre||'';
    const nom=nombreCuenta(n),bk=AppState.datos.bancos[n];
    /* Con movimientos (o con meses archivados) no se borra: se desactiva */
    const usos=b.agregada?usosDeCuenta(n):0,archivada=b.agregada&&Math.abs(Number(bk.saldoApertura)||0)>=0.005;
    let h=cabHoja(nom,{chico:true})+'<div class="hoja-cuerpo">'+
        '<p class="cat-resumen">Cuenta en '+(b.moneda==='USD'?'dólares':'pesos')+' de '+escHtml(etBanco)+'.</p>'+
        '<section class="cat-seccion"><label class="rotulo" for="ceNombre">Nombre</label>'+
            '<div class="cat-accion"><input class="campo" id="ceNombre" data-r="nombre" maxlength="'+CUENTA_NOMBRE_MAX+'" autocomplete="off" autocapitalize="sentences" value="'+escHtml(nom)+'" data-in="ce-nombre">'+
            '<button type="button" class="btn chico" data-a="ce-renombrar" data-r="guardar" data-primario disabled>Guardar</button></div>'+
            '<p class="nota-campo">'+(b.agregada?'Por ejemplo, '+escHtml(etBanco)+' empresa.':'Por ejemplo, '+escHtml(etBanco)+' personal. Si lo dejás vacío, vuelve a llamarse '+escHtml(etBanco)+'.')+'</p></section>';
    if(b.agregada){
        h+='<section class="cat-seccion">'+(usos||archivada
            ?'<p class="nota-campo" style="margin-top:0">'+(usos?'Tiene '+(usos===1?'un movimiento':usos+' movimientos'):'Tiene movimientos de meses archivados')+': no se puede borrar. Si no la usás más, desactivala en Agregar o quitar cuentas.</p>'
            :'<button type="button" class="btn peligro chico" data-a="ce-borrar">'+ico('borrar')+'Borrar cuenta</button>'+
             '<p class="nota-campo">No tiene movimientos.'+(Math.abs(saldoDe(n))>=0.005?' Su saldo inicial se borra con ella.':'')+'</p>')+'</section>';
    }
    h+='</div>';
    cont.innerHTML=h;
}
ENT['ce-nombre']=el=>{
    const capa=capaDe(el);if(!capa)return;
    const v=el.value.trim().replace(/\s+/g,' ');
    const fija=!esCuentaAgregada(capa.cuenta);
    q(capa.cont,'guardar').disabled=(v.length<2&&!(fija&&v===''))||v===nombreCuenta(capa.cuenta);
};
ACC['ce-renombrar']=t=>{
    const capa=capaDe(t);if(!capa)return;
    const r=renombrarCuenta(capa.cuenta,q(capa.cont,'nombre').value);
    if(!r.ok){avisar(r.error,{error:true});return}
    cerrarCapa(capa);actualizarVista();
    avisar('Ahora se llama '+r.nombre+'.');
};
ACC['ce-borrar']=async t=>{
    const capa=capaDe(t);if(!capa)return;
    const n=capa.cuenta,nom=nombreCuenta(n);
    const si=await preguntar({titulo:'¿Borrar '+nom+'?',texto:'La cuenta deja de aparecer en la app.',si:'Borrar',peligro:true});
    if(!si||!capa.el.isConnected)return;
    const r=borrarCuenta(n);
    if(!r.ok){avisar(r.error,{error:true});return}
    /* Se cierran la hoja y el libro de la cuenta, que ya no existe */
    _capas.slice().reverse().forEach(c=>{if(c===capa||c.def.clave==='libro:'+n)cerrarCapa(c)});
    actualizarVista();
    avisar('Se borró '+nom+'.');
};
