/* ═══════════════════════════════════════════════════════════════════════════
   §21 — CARGAR Y EDITAR (v8.0.0)
   ═══════════════════════════════════════════════════════════════════════════
   Los formularios: comprar y vender USDT, ingresos y egresos, transferencias
   (y conversiones entre monedas), correcciones de saldo, USDT cargados a mano
   y la elección de fecha y hora. Leen lo que se escribió y se lo pasan a las
   funciones de 17-registros.js, que son las que validan y guardan.

   Cada formulario guarda su estado en la capa (capa.st). Cuando cambian los
   datos —por ejemplo, llega algo de otro dispositivo— solo se actualizan los
   saldos de las cuentas y la cuenta de abajo, nunca lo que se está escribiendo. */

/* ─── Botón + ──────────────────────────────────────────────────────────── */
ACC['cargar']=()=>{
    const a=(accion,dato,clase,icono,titulo,sub)=>'<button type="button" class="accion '+clase+'" data-a="'+accion+'"'+(dato?' data-tipo="'+dato+'"':'')+'>'+ico(icono)+'<div><b>'+titulo+'</b><span>'+sub+'</span></div></button>';
    abrirCapa({tipo:'hoja',etiqueta:'Qué querés cargar',clave:'acciones',
        html:cabHoja('¿Qué querés cargar?')+'<div class="hoja-cuerpo" style="padding-bottom:calc(30px + var(--seg-abajo))"><div class="acciones">'+
            a('op-nueva','compra','compra','compra','Comprar USDT','Pagás desde un banco')+
            a('op-nueva','venta','venta','venta','Vender USDT','Cobrás en un banco')+
            a('mov-nuevo','ingreso','','ingreso','Ingreso','Plata que entra')+
            a('mov-nuevo','egreso','','egreso','Egreso','Un gasto o un pago')+
            a('transf-nueva','','','transf','Transferencia','Entre tus cuentas')+
            a('corregir','','','corregir','Corregir saldo','Igualar con el banco')+
        '</div></div>'});
};
/* Si se abre desde el botón +, el formulario reemplaza a la lista de opciones */
function desdeAcciones(t){const c=capaDe(t);return!!(c&&c.def.clave==='acciones')}
ACC['op-nueva']=t=>abrirOperacion({tipo:t.dataset.tipo,reemplazar:desdeAcciones(t)});
ACC['mov-nuevo']=t=>abrirMovimiento({tipo:t.dataset.tipo,reemplazar:desdeAcciones(t)});
ACC['transf-nueva']=t=>abrirTransferencia({reemplazar:desdeAcciones(t)});
ACC['corregir']=t=>abrirCorreccion({cuenta:t.dataset.cuenta||'',reemplazar:desdeAcciones(t)});

/* ─── Comunes ──────────────────────────────────────────────────────────── */
function _ultimas(){try{return JSON.parse(localStorage.getItem('p2p_ultimas_cuentas')||'{}')||{}}catch(_){return{}}}
function recordarCuenta(k,c){try{const u=_ultimas();u[k]=c;localStorage.setItem('p2p_ultimas_cuentas',JSON.stringify(u))}catch(_){}}
function cuentaInicial(k,lista){const u=_ultimas()[k];return(u&&lista.includes(u))?u:(lista[0]||'')}
function bancosActivos(){return getBancosActivos().map(b=>b.nombre)}
function q(cont,r){return cont.querySelector('[data-r="'+r+'"]')}
function simDe(mon){return mon==='USD'?'US$':mon==='USDT'?'':'$'}
/* Al salir de un campo de monto, se escribe con puntos de miles */
function formatearAlSalir(inp){
    if(!inp)return;
    inp.addEventListener('blur',()=>{const n=parseMonto(inp.value);if(n>0)inp.value=formatoCampo(n)});
}
function pctCampo(n){return formateador(0,3).format(Number(n||0))}
function mostrarError(capa,texto,campo){
    const cont=capa.cont,box=q(cont,'error');
    cont.querySelectorAll('.campo-con-error').forEach(x=>x.classList.remove('campo-con-error'));
    if(box)box.innerHTML=texto?'<div class="error-form" role="alert">'+ico('alerta')+'<span>'+escHtml(texto)+'</span></div>':'';
    if(campo){
        const el=cont.querySelector('[data-campo="'+campo+'"]');
        if(el){el.classList.add('campo-con-error');try{el.scrollIntoView({block:'nearest',behavior:'smooth'})}catch(_){}}
    }
}
function limpiarError(capa){if(capa&&capa.st&&capa.st.hayError){capa.st.hayError=false;mostrarError(capa,'')}}
/* Cuentas para elegir, como tarjetas */
function tilesCuentas(lista,elegida,o){
    o=o||{};
    if(!lista.length)return'<div class="vacio" style="padding:14px 6px"><p>No tenés cuentas activas.</p><button type="button" class="btn gris chico" data-a="activar-cuentas">Elegir mis cuentas</button></div>';
    return'<div class="cuentas-sel">'+lista.map(n=>{
        const sel=n===elegida,dis=o.deshabilitada?o.deshabilitada(n):false;
        const s=saldoDe(n);
        return'<button type="button" class="cuenta" data-a="'+o.accion+'" data-cuenta="'+escHtml(n)+'" aria-pressed="'+sel+'"'+(dis?' disabled':'')+'>'+
            '<span class="c-n">'+mono(n)+'<b>'+escHtml(nombreCuenta(n))+'</b>'+(sel?ico('ok'):'')+'</span>'+
            '<span class="c-s">'+(n==='USDT'?usdtTxt(s,{unidad:false}):dinero(s,monedaDeCuenta(n)))+'</span>'+
            (o.sub?'<span class="c-x">'+escHtml(o.sub(n)||'')+'</span>':'')+'</button>';
    }).join('')+'</div>';
}
function textoCupo(n){
    const cu=infoCupo(n);
    if(!cu)return'Sin límite diario';
    return cu.disp>=0.005?'Quedan US$'+fmtExacto(cu.disp)+' hoy':'Sin cupo por hoy';
}
/* Cómo quedan las cuentas con un registro nuevo o editado */
function frasesSaldos(ent,viejo,nuevo){
    let dif;
    try{dif=diferenciaDeEfecto(ent,viejo,nuevo).bancos||{}}catch(_){dif={}}
    const partes=Object.entries(dif).filter(([,v])=>Math.abs(v)>=0.005).map(([c,v])=>{
        const fin=roundMoney(saldoDe(c)+v);
        const txt=nombreCuenta(c)+(fin<-0.004?' quedaría en ':' queda en ')+dinero(fin,monedaDeCuenta(c));
        return{txt,mal:fin<-0.004};
    });
    return partes;
}
/* Al guardar una edición: si se llegó desde el detalle, se vuelve a él con el
   cambio anotado; si se llegó deslizando la fila, se vuelve a la lista. */
function trasEditar(capa,ent,id){
    if(capa.st&&capa.st.desdeDetalle)abrirDetalle(ent,id,{reemplazar:true});
    else cerrarCapa(capa);
    avisar('Cambios guardados.');
}
function botonCuando(st,accion){
    return'<button type="button" class="campo" data-a="'+accion+'" data-campo="fecha" data-r="cuando"><span>'+escHtml(st.fecha?cuandoCorto(st.fecha,st.hora):'Ahora')+'</span>'+ico('abajo')+'</button>';
}
async function cambiarCuando(capa,accion){
    const st=capa.st;
    const v=await elegirCuando(st.fecha,st.hora,{edicion:!!st.id});
    if(!v||!capa.el.isConnected)return;
    st.fecha=v.fecha;st.hora=v.hora;
    const b=q(capa.cont,'cuando');
    if(b)b.querySelector('span').textContent=st.fecha?cuandoCorto(st.fecha,st.hora):'Ahora';
    limpiarError(capa);
}

/* ═══ Comprar y vender ═══════════════════════════════════════════════════ */
function abrirOperacion(o){
    o=o||{};
    const viejo=o.id!=null?buscarRegistro('operaciones',o.id):null;
    if(o.id!=null&&!viejo){avisar('Esa operación ya no existe.',{error:true});return}
    const tipo=viejo?viejo.tipo:(o.tipo==='venta'?'venta':'compra');
    const st={id:viejo?viejo.id:null,desdeDetalle:!!o.reemplazar,tipo,cuenta:'',dividir:false,reparto:[],extra:false,
              fecha:viejo?viejo.fecha:null,hora:viejo?viejo.hora:null,tasaTocada:!!viejo,cuentaTocada:!!viejo};
    if(viejo){
        st.cuenta=viejo.banco;
        if(esPagoDividido(viejo)){st.dividir=true;st.reparto=aportesDe(viejo).map(a=>({banco:a.banco,monto:a.monto}))}
        st.extra=(Number(viejo.comisionBanco)||0)>0||(isFinite(viejo.comisionPct)&&Math.abs(viejo.comisionPct-comisionConfigurada(viejo.moneda||'UYU'))>1e-9);
    }else st.cuenta=cuentaInicial(tipo,bancosActivos());
    const mon=monedaDeCuenta(st.cuenta)||'UYU';
    const seg=b=>'<button type="button" role="tab" class="'+b+'" data-a="op-tipo" data-tipo="'+b+'" aria-selected="'+(tipo===b)+'"'+(viejo&&tipo!==b?' disabled':'')+'>'+(b==='compra'?'Comprar':'Vender')+'</button>';
    const html=cabHoja('',{izquierda:'<div class="segmento" role="tablist" aria-label="Tipo de operación">'+seg('compra')+seg('venta')+'</div>'})+
        '<div class="hoja-cuerpo"><div class="grupo-campos">'+
            '<div><label class="rotulo" for="opMonto" data-r="rot-monto"></label>'+
                '<div class="monto-grande" data-campo="monto"><span class="sim cifra" data-r="sim"></span>'+
                '<input id="opMonto" data-r="monto" inputmode="decimal" autocomplete="off" placeholder="0" data-in="op-calc"><span class="mon" data-r="mon"></span></div></div>'+
            '<div><label class="rotulo" for="opTasa">Tasa por USDT</label>'+
                '<div class="paso-tasa" data-campo="tasa"><button type="button" data-a="op-tasa-paso" data-d="-1" aria-label="Bajar la tasa">'+MENOS+'</button>'+
                '<input id="opTasa" data-r="tasa" inputmode="decimal" autocomplete="off" placeholder="0,00" data-in="op-tasa">'+
                '<button type="button" data-a="op-tasa-paso" data-d="1" aria-label="Subir la tasa">+</button></div>'+
                '<div class="tasas-rapidas" data-r="tasas"></div></div>'+
            '<div data-campo="cuenta"><span class="rotulo" data-r="rot-cuenta"></span><div data-r="cuentas"></div>'+
                '<div class="opciones-form"><button type="button" class="btn-opcion" data-a="op-dividir" data-r="dividir" aria-pressed="false">'+ico('dividir')+'<span>Dividir el pago</span></button>'+
                '<button type="button" class="btn-opcion" data-a="op-extra" data-r="btn-extra" aria-expanded="false">'+ico('corregir')+'<span>Comisión y fecha</span>'+ico('abajo','ch')+'</button></div>'+
                '<div class="extra hidden" data-r="extra" data-campo="comisiones">'+
                    '<div class="fila-campo"><label for="opPct">Comisión de Binance</label><div class="campo-sufijo"><input class="campo" id="opPct" data-r="pct" inputmode="decimal" autocomplete="off" data-in="op-calc"><span>%</span></div></div>'+
                    '<div class="fila-campo" data-r="fila-cb"><label for="opCb">Comisión del banco</label><div class="campo-sufijo"><input class="campo" id="opCb" data-r="cb" inputmode="decimal" autocomplete="off" placeholder="0" data-in="op-calc"><span data-r="cb-mon"></span></div></div>'+
                    '<div class="fila-campo"><span>Cuándo</span>'+botonCuando(st,'op-cuando')+'</div>'+
                '</div></div>'+
        '</div></div>'+
        '<div class="hoja-pie"><div data-r="error"></div><div class="resumen-form" data-r="resumen"></div>'+
        '<button type="button" class="btn" data-a="op-guardar" data-r="guardar" data-primario></button></div>';
    abrirCapa({tipo:'hoja',clase:'alta',etiqueta:viejo?'Editar operación':'Comprar o vender',clave:'operacion',reemplazar:!!o.reemplazar,html,
        montar(cont,capa){
            capa.st=st;capa.viejo=viejo;
            q(cont,'monto').value=viejo?formatoCampo(viejo.monto):'';
            const t0=viejo?viejo.tasa:(tasasRecientesDe(tipo,mon,1)[0]||0);
            q(cont,'tasa').value=t0?fmtTasa(t0,mon):'';
            q(cont,'pct').value=pctCampo(viejo&&isFinite(viejo.comisionPct)?viejo.comisionPct:comisionConfigurada(mon));
            q(cont,'cb').value=viejo&&viejo.comisionBanco?formatoCampo(viejo.comisionBanco):'';
            formatearAlSalir(q(cont,'monto'));formatearAlSalir(q(cont,'cb'));
            opPintarTodo(capa);
        },
        actualizar(cont,capa){opPintarCuentas(capa);opCalcular(capa)}
    });
}
function opMoneda(st){return st.cuenta?monedaDeCuenta(st.cuenta):'UYU'}
function opPintarTodo(capa){
    const st=capa.st,cont=capa.cont,mon=opMoneda(st);
    cont.querySelectorAll('[data-a="op-tipo"]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tipo===st.tipo)));
    q(cont,'rot-monto').textContent=st.tipo==='compra'?'Pagás':'Cobrás';
    q(cont,'rot-cuenta').textContent=st.tipo==='compra'?(st.dividir?'Pagás desde':'Desde'):'Entra a';
    q(cont,'sim').textContent=simDe(mon);
    q(cont,'mon').textContent=mon;
    q(cont,'cb-mon').textContent=mon;
    q(cont,'fila-cb').classList.toggle('hidden',st.tipo!=='compra');
    const dv=q(cont,'dividir');
    dv.classList.toggle('hidden',st.tipo!=='compra');
    dv.setAttribute('aria-pressed',String(st.dividir));
    q(cont,'extra').classList.toggle('hidden',!st.extra);
    q(cont,'btn-extra').setAttribute('aria-expanded',String(st.extra));
    const g=q(cont,'guardar');
    g.className='btn '+(st.id?'':(st.tipo==='compra'?'verde':'rojo'));
    opPintarTasas(capa);
    opPintarCuentas(capa);
    opCalcular(capa);
}
function opPintarTasas(capa){
    const st=capa.st,mon=opMoneda(st);
    const ts=tasasRecientesDe(st.tipo,mon,3);
    q(capa.cont,'tasas').innerHTML=ts.length?'<span>Últimas</span>'+ts.map(t=>'<button type="button" class="pastilla chica" data-a="op-tasa-rapida" data-v="'+t+'">'+escHtml(fmtTasa(t,mon))+'</button>').join(''):'';
}
function opLeer(capa){
    const st=capa.st,cont=capa.cont,mon=opMoneda(st);
    const monto=roundMoney(parseMonto(q(cont,'monto').value));
    const tasa=parsearTasa(q(cont,'tasa').value)||0;
    const pctTxtCampo=q(cont,'pct').value.trim();
    const pctLeida=pctTxtCampo===''?null:parsearComisionPct(pctTxtCampo);
    const pct=pctLeida===null?comisionConfigurada(mon):pctLeida;
    const cb=st.tipo==='compra'?roundMoney(parseMonto(q(cont,'cb').value)):0;
    return{monto,tasa,pct,pctInvalida:pctTxtCampo!==''&&pctLeida===null,pctVacia:pctTxtCampo==='',cb,mon};
}
/* Reparto del pago dividido: la última cuenta paga lo que falta */
function opAportes(capa,v){
    const st=capa.st;
    const total=roundMoney(v.monto+v.cb);
    let suma=0;
    const ap=st.reparto.map((r,i)=>{
        if(i===st.reparto.length-1)return{banco:r.banco,monto:roundMoney(total-suma)};
        const m=roundMoney(r.monto||0);suma=roundMoney(suma+m);return{banco:r.banco,monto:m};
    });
    return ap;
}
function opPintarCuentas(capa){
    const st=capa.st,cont=capa.cont,v=opLeer(capa),mon=v.mon;
    const box=q(cont,'cuentas');
    if(st.dividir){
        /* Si se está escribiendo un monto del reparto, no se redibuja: se perdería el cursor */
        if(box.contains(document.activeElement)&&document.activeElement.tagName==='INPUT'){opActualizarResto(capa);return}
        const lista=bancosActivos().filter(n=>monedaDeCuenta(n)===mon);
        const ap=opAportes(capa,v);
        box.innerHTML='<div class="reparto">'+st.reparto.map((r,i)=>{
            const ultimo=i===st.reparto.length-1;
            /* El saldo va debajo, entero: dentro de la lista no entraba con los centavos */
            const opciones=Array.from(new Set([r.banco,...lista])).filter(Boolean).map(n=>'<option value="'+escHtml(n)+'"'+(n===r.banco?' selected':'')+'>'+escHtml(nombreCuenta(n))+'</option>').join('');
            return'<div class="reparto-fila"><div class="reparto-cuenta"><select class="campo" data-ch="op-rep-cuenta" data-i="'+i+'" aria-label="Cuenta '+(i+1)+'">'+opciones+'</select>'+
                '<span class="reparto-saldo">Tiene '+dinero(saldoDe(r.banco),mon)+'</span></div>'+
                (ultimo?'<span class="resto'+(ap[i].monto<-0.004?' baja':'')+'" data-r="resto">'+dinero(ap[i].monto,mon)+'</span>'
                       :'<input class="campo" inputmode="decimal" autocomplete="off" data-in="op-rep-monto" data-i="'+i+'" value="'+escHtml(r.txt!==undefined?r.txt:(r.monto?formatoCampo(r.monto):''))+'" placeholder="0" aria-label="Monto desde '+escHtml(nombreCuenta(r.banco))+'">')+
                (st.reparto.length>2?'<button type="button" class="quitar" data-a="op-rep-quitar" data-i="'+i+'" aria-label="Quitar esta cuenta">'+ico('cerrar')+'</button>':'<span></span>')+'</div>';
        }).join('')+'</div>'+
        (st.reparto.length<lista.length?'<button type="button" class="btn-texto" data-a="op-rep-agregar">Agregar otra cuenta</button>':'')+
        '<p class="reparto-nota">La última cuenta paga lo que falta para llegar a <span data-r="total-rep">'+dinero(roundMoney(v.monto+v.cb),mon)+'</span>.</p>';
        return;
    }
    let lista=bancosActivos();
    if(capa.viejo)lista=lista.filter(n=>monedaDeCuenta(n)===(capa.viejo.moneda||'UYU'));
    if(st.cuenta&&!lista.includes(st.cuenta)&&AppState.datos.bancos[st.cuenta])lista=[st.cuenta,...lista];
    const total=roundMoney(v.monto+v.cb);
    box.innerHTML=tilesCuentas(lista,st.cuenta,{accion:'op-cuenta',
        deshabilitada:n=>st.tipo==='compra'&&!capa.viejo&&v.monto>0&&saldoDe(n)<total-0.004&&n!==st.cuenta,
        sub:n=>st.tipo==='compra'?(!capa.viejo&&v.monto>0&&saldoDe(n)<total-0.004?'No alcanza':textoCupo(n)):''});
}
function opActualizarResto(capa){
    const v=opLeer(capa),ap=opAportes(capa,v),cont=capa.cont;
    const r=q(cont,'resto');
    if(r){const m=ap[ap.length-1].monto;r.textContent=dinero(m,v.mon);r.classList.toggle('baja',m<-0.004)}
    const tr=q(cont,'total-rep');if(tr)tr.textContent=dinero(roundMoney(v.monto+v.cb),v.mon);
}
function opCalcular(capa){
    const st=capa.st,cont=capa.cont,v=opLeer(capa),mon=v.mon;
    if(st.dividir)opActualizarResto(capa);
    const res=q(cont,'resumen'),g=q(cont,'guardar');
    const base=v.monto>0&&v.tasa>0?usdtBase(v.monto/v.tasa,st.tipo):0;
    const com=truncar(base*(v.pct/100),2);
    const neto=base>0?usdtNeto(base,com,st.tipo):0;
    const accion=st.tipo==='compra'?'Comprar':'Vender';
    g.textContent=st.id?'Guardar cambios':(neto>0?accion+' '+usdtTxt(neto):accion);
    if(!(neto>0)){
        res.innerHTML='<div class="r-1"><span>'+(st.tipo==='compra'?'Recibís':'Entregás')+'</span><b class="tenue">'+MENOS+'</b></div><div class="r-2">Escribí el monto y la tasa.</div>';
        return;
    }
    let r2='';
    if(st.tipo==='compra'){
        r2=fmtTrunc(base,2)+' menos '+fmtTrunc(com,2)+' de comisión de Binance ('+pctTxt(v.pct)+'). Te sale a '+dinero(roundMoney(v.monto/neto,3),mon)+' cada uno.';
    }else{
        r2=fmtTrunc(base,2)+' más '+fmtTrunc(com,2)+' de comisión de Binance ('+pctTxt(v.pct)+').';
        if(!st.id){
            const disp=usdtDisponibleEn(mon);
            if(neto>disp+0.005)r2+=' <span class="baja">Tenés '+usdtTxt(disp)+': te faltan '+usdtTxt(roundMoney(neto-disp))+'.</span>';
            else{
                const costo=previewFIFO(neto,mon).reduce((s,x)=>s+x.subtotal,0);
                const gan=roundMoney(v.monto-costo);
                r2+=' '+(gan>=0?'Ganás ':'Perdés ')+dinero(Math.abs(gan),mon)+'.';
            }
        }
    }
    const prov={tipo:st.tipo,monto:v.monto,banco:st.dividir?(st.reparto[0]||{}).banco:st.cuenta,comisionBanco:v.cb,
                ...(st.dividir?{aportes:opAportes(capa,v)}:{})};
    const fr=st.cuenta||st.dividir?frasesSaldos('operaciones',capa.viejo,prov):[];
    if(fr.length)r2+=' '+fr.map(f=>f.mal?'<span class="baja">'+escHtml(f.txt)+'.</span>':escHtml(f.txt)+'.').join(' ');
    res.innerHTML='<div class="r-1"><span>'+(st.tipo==='compra'?'Recibís':'Entregás')+'</span><b class="'+(st.tipo==='compra'?'sube':'')+'">'+usdtTxt(neto)+'</b></div><div class="r-2">'+r2+'</div>';
}
ACC['op-tipo']=t=>{
    const capa=capaDe(t),st=capa.st;
    if(st.id||st.tipo===t.dataset.tipo)return;
    st.tipo=t.dataset.tipo;
    if(st.tipo==='venta')st.dividir=false;
    if(!st.cuentaTocada)st.cuenta=cuentaInicial(st.tipo,bancosActivos());
    if(!st.tasaTocada){
        const mon=opMoneda(st),t0=tasasRecientesDe(st.tipo,mon,1)[0];
        q(capa.cont,'tasa').value=t0?fmtTasa(t0,mon):'';
    }
    limpiarError(capa);opPintarTodo(capa);
};
ENT['op-calc']=el=>{
    const capa=capaDe(el);if(!capa)return;
    limpiarError(capa);
    /* El monto cambia qué cuentas alcanzan: se redibujan las tarjetas */
    if(el.dataset.r==='monto'||el.dataset.r==='cb')opPintarCuentas(capa);
    opCalcular(capa);
};
ENT['op-tasa']=el=>{const capa=capaDe(el);if(!capa)return;capa.st.tasaTocada=true;limpiarError(capa);opCalcular(capa)};
ACC['op-tasa-paso']=t=>{
    const capa=capaDe(t),st=capa.st,mon=opMoneda(st),inp=q(capa.cont,'tasa');
    const paso=mon==='USD'?0.001:0.01;
    const actual=parsearTasa(inp.value)||0;
    const nueva=Math.max(0,roundMoney(actual+paso*Number(t.dataset.d),3));
    inp.value=nueva>0?fmtTasa(nueva,mon):'';
    st.tasaTocada=true;limpiarError(capa);opCalcular(capa);
};
ACC['op-tasa-rapida']=t=>{
    const capa=capaDe(t),mon=opMoneda(capa.st);
    q(capa.cont,'tasa').value=fmtTasa(Number(t.dataset.v),mon);
    capa.st.tasaTocada=true;limpiarError(capa);opCalcular(capa);
};
ACC['op-cuenta']=t=>{
    const capa=capaDe(t),st=capa.st;
    const antes=opMoneda(st);
    st.cuenta=t.dataset.cuenta;st.cuentaTocada=true;
    limpiarError(capa);
    if(opMoneda(st)!==antes){
        /* Cambió de moneda: la tasa y la comisión de la otra moneda no sirven */
        const mon=opMoneda(st),t0=tasasRecientesDe(st.tipo,mon,1)[0];
        q(capa.cont,'tasa').value=t0?fmtTasa(t0,mon):'';st.tasaTocada=false;
        q(capa.cont,'pct').value=pctCampo(comisionConfigurada(mon));
    }
    opPintarTodo(capa);
};
ACC['op-dividir']=t=>{
    const capa=capaDe(t),st=capa.st,v=opLeer(capa);
    if(st.dividir){
        st.dividir=false;st.cuenta=(st.reparto[0]||{}).banco||st.cuenta;st.reparto=[];
    }else{
        const lista=bancosActivos().filter(n=>monedaDeCuenta(n)===v.mon);
        if(lista.length<2){avisar('Para dividir el pago necesitás dos cuentas activas en la misma moneda.',{error:true});return}
        const a=lista.includes(st.cuenta)?st.cuenta:lista[0];
        const b=lista.find(n=>n!==a);
        const total=roundMoney(v.monto+v.cb);
        const primero=total>0?Math.min(total,Math.max(0,roundMoney(saldoDe(a)))):0;
        st.dividir=true;st.reparto=[{banco:a,monto:primero},{banco:b,monto:0}];
    }
    limpiarError(capa);opPintarTodo(capa);
};
ACC['op-rep-agregar']=t=>{
    const capa=capaDe(t),st=capa.st,v=opLeer(capa);
    const lista=bancosActivos().filter(n=>monedaDeCuenta(n)===v.mon&&!st.reparto.some(r=>r.banco===n));
    if(!lista.length)return;
    /* La nueva va antes de la última, que sigue pagando el resto */
    st.reparto.splice(st.reparto.length-1,0,{banco:lista[0],monto:0});
    opPintarCuentas(capa);opCalcular(capa);
};
ACC['op-rep-quitar']=t=>{
    const capa=capaDe(t),st=capa.st;
    if(st.reparto.length<=2)return;
    st.reparto.splice(Number(t.dataset.i),1);
    opPintarCuentas(capa);opCalcular(capa);
};
ENT['op-rep-cuenta']=el=>{
    const capa=capaDe(el);if(!capa)return;
    capa.st.reparto[Number(el.dataset.i)].banco=el.value;
    limpiarError(capa);opPintarCuentas(capa);opCalcular(capa);
};
ENT['op-rep-monto']=el=>{
    const capa=capaDe(el);if(!capa)return;
    const r=capa.st.reparto[Number(el.dataset.i)];
    r.monto=roundMoney(parseMonto(el.value));r.txt=el.value;
    limpiarError(capa);opCalcular(capa);
};
/* Mostrar u ocultar la parte de comisiones y fecha, y llevarla a la vista */
function alternarExtra(t){
    const capa=capaDe(t);capa.st.extra=!capa.st.extra;
    const ex=q(capa.cont,'extra');
    ex.classList.toggle('hidden',!capa.st.extra);
    t.setAttribute('aria-expanded',String(capa.st.extra));
    if(capa.st.extra)setTimeout(()=>{try{ex.scrollIntoView({block:'nearest',behavior:'smooth'})}catch(_){}},30);
}
ACC['op-extra']=alternarExtra;
ACC['op-cuando']=t=>cambiarCuando(capaDe(t));
ACC['op-guardar']=async t=>{
    const capa=capaDe(t),st=capa.st;
    if(st.guardando)return;
    const v=opLeer(capa);
    if(v.pctInvalida){st.hayError=true;st.extra=true;opPintarTodo(capa);mostrarError(capa,'Revisá la comisión de Binance: tiene que ser un número entre 0 y 5.','comisiones');return}
    let aportes=null;
    if(st.dividir){
        aportes=opAportes(capa,v);
        if(new Set(aportes.map(a=>a.banco)).size!==aportes.length){st.hayError=true;mostrarError(capa,'Elegí cuentas distintas para dividir el pago.','cuenta');return}
    }
    const d={tipo:st.tipo,monto:v.monto,tasa:v.tasa,banco:st.dividir?aportes[0].banco:st.cuenta,aportes,
             comisionBanco:v.cb,comisionPct:v.pctVacia?undefined:v.pct,
             ...(st.fecha?{fecha:st.fecha,hora:st.hora}:{})};
    st.guardando=true;t.disabled=true;
    try{
        const r=await conConfirmacion(o=>guardarOperacion(d,{...o,id:st.id}));
        if(r.ok){
            if(!st.dividir)recordarCuenta(st.tipo,st.cuenta);
            if(st.id)trasEditar(capa,'operaciones',r.id);
            else{cerrarCapa(capa);avisar(st.tipo==='compra'?'Compra guardada.':'Venta guardada.')}
        }else if(!r.cancelado){
            st.hayError=true;
            if(r.campo==='comisiones'||r.campo==='fecha'){st.extra=true;q(capa.cont,'extra').classList.remove('hidden')}
            mostrarError(capa,r.error,r.campo);
        }
    }finally{st.guardando=false;if(t.isConnected)t.disabled=false}
};

/* ═══ Ingresos y egresos ═════════════════════════════════════════════════ */
function categoriaCanonica(txt){
    const t=normalizarTag(txt||'');if(!t)return'';
    const ex=(AppState.datos.tags||[]).find(x=>tagKey(x)===tagKey(t));
    return ex||stripAccents(t).toLowerCase();
}
function categoriasOrdenadas(){
    const st=getTagStats();
    return Object.values(st).sort((a,b)=>(b.usos-a.usos)||a.nombre.localeCompare(b.nombre,'es')).map(x=>x.nombre);
}
function abrirMovimiento(o){
    o=o||{};
    const viejo=o.id!=null?buscarRegistro('movimientos',o.id):null;
    if(o.id!=null&&!viejo){avisar('Ese movimiento ya no existe.',{error:true});return}
    const tipo=viejo?viejo.tipoMovimiento:(o.tipo==='ingreso'?'ingreso':'egreso');
    const lista=[...bancosActivos(),'USDT'];
    const st={id:viejo?viejo.id:null,desdeDetalle:!!o.reemplazar,tipo,
              cuenta:viejo?(viejo.tipoCuenta==='usdt'?'USDT':viejo.banco):(o.cuenta||cuentaInicial(tipo,lista)),
              desc:viejo?(viejo.descripcion||''):'',nuevaCat:false,todas:false,
              fecha:viejo?viejo.fecha:null,hora:viejo?viejo.hora:null};
    const seg=b=>'<button type="button" role="tab" data-a="mv-tipo" data-tipo="'+b+'" aria-selected="'+(tipo===b)+'">'+(b==='ingreso'?'Ingreso':'Egreso')+'</button>';
    const html=cabHoja('',{izquierda:'<div class="segmento" role="tablist" aria-label="Tipo de movimiento">'+seg('ingreso')+seg('egreso')+'</div>'})+
        '<div class="hoja-cuerpo"><div class="grupo-campos">'+
            '<div><label class="rotulo" for="mvMonto">Monto</label><div class="monto-grande" data-campo="monto"><span class="sim cifra" data-r="sim"></span>'+
                '<input id="mvMonto" data-r="monto" inputmode="decimal" autocomplete="off" placeholder="0" data-in="mv-calc"><span class="mon" data-r="mon"></span></div></div>'+
            '<div data-campo="cuenta"><span class="rotulo" data-r="rot-cuenta"></span><div data-r="cuentas"></div></div>'+
            '<div data-r="bloque-tasa" data-campo="tasaRef"><label class="rotulo" for="mvTasa">A cuánto te salió cada USDT</label>'+
                '<div class="campo-sufijo"><input class="campo" id="mvTasa" data-r="tasa" inputmode="decimal" autocomplete="off" placeholder="0,00" data-in="mv-calc"><span>$</span></div>'+
                '<p class="nota-campo">Con esto se calcula la ganancia cuando los vendas.</p></div>'+
            '<div><span class="rotulo">Categoría</span><div data-r="cats"></div>'+
                '<input class="campo hidden" data-r="cat-nueva" data-in="mv-cat-nueva" placeholder="Nombre de la categoría" maxlength="24" autocomplete="off" style="margin-top:10px" aria-label="Nueva categoría"></div>'+
            '<div class="dos-campos" style="grid-template-columns:minmax(0,1fr) 140px"><div><label class="rotulo" for="mvNota">Nota</label>'+
                '<input class="campo" id="mvNota" data-r="nota" placeholder="Opcional" maxlength="140" autocomplete="off"></div>'+
                '<div><span class="rotulo">Cuándo</span>'+botonCuando(st,'mv-cuando')+'</div></div>'+
        '</div></div>'+
        '<div class="hoja-pie"><div data-r="error"></div><div class="linea-pie" data-r="pie"></div>'+
        '<button type="button" class="btn" data-a="mv-guardar" data-r="guardar" data-primario></button></div>';
    abrirCapa({tipo:'hoja',clase:'alta',etiqueta:viejo?'Editar movimiento':'Ingreso o egreso',clave:'movimiento',reemplazar:!!o.reemplazar,html,
        montar(cont,capa){
            capa.st=st;capa.viejo=viejo;
            if(viejo){
                q(cont,'monto').value=viejo.tipoCuenta==='usdt'?fmtTrunc(viejo.monto,2):formatoCampo(viejo.monto);
                if(viejo.tasaRef)q(cont,'tasa').value=fmtTasa(viejo.tasaRef,'UYU');
                q(cont,'nota').value=viejo.nota||'';
            }
            formatearAlSalir(q(cont,'monto'));
            mvPintarTodo(capa);
        },
        actualizar(cont,capa){mvPintarCuentas(capa);mvCalcular(capa)}
    });
}
function mvPintarTodo(capa){
    const st=capa.st,cont=capa.cont;
    cont.querySelectorAll('[data-a="mv-tipo"]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tipo===st.tipo)));
    const mon=st.cuenta==='USDT'?'USDT':monedaDeCuenta(st.cuenta||'');
    q(cont,'sim').textContent=simDe(mon);
    q(cont,'mon').textContent=mon;
    q(cont,'rot-cuenta').textContent=st.tipo==='ingreso'?'Entra a':'Sale de';
    q(cont,'bloque-tasa').classList.toggle('hidden',!(st.cuenta==='USDT'&&st.tipo==='ingreso'));
    mvPintarCategorias(capa);
    mvPintarCuentas(capa);
    mvCalcular(capa);
}
function mvPintarCuentas(capa){
    const st=capa.st;
    /* USDT primero, después los bancos de más plata a menos */
    let lista=['USDT',...bancosActivos()];
    if(st.cuenta&&!lista.includes(st.cuenta))lista=[...lista,st.cuenta];
    q(capa.cont,'cuentas').innerHTML=tilesCuentas(lista,st.cuenta,{accion:'mv-cuenta'});
}
function mvPintarCategorias(capa){
    const st=capa.st,todas=categoriasOrdenadas();
    const elegida=st.desc&&!st.nuevaCat?st.desc:'';
    let visibles=st.todas?todas:todas.slice(0,8);
    if(elegida&&!visibles.some(x=>tagKey(x)===tagKey(elegida)))visibles=[elegida,...visibles];
    q(capa.cont,'cats').innerHTML='<div class="pastillas">'+visibles.map(c=>
        '<button type="button" class="pastilla" data-a="mv-cat" data-cat="'+escHtml(c)+'" aria-pressed="'+(!!elegida&&tagKey(c)===tagKey(elegida))+'">'+escHtml(c)+'</button>').join('')+
        (!st.todas&&todas.length>8?'<button type="button" class="pastilla nueva" data-a="mv-cat-todas">Ver todas ('+todas.length+')</button>':'')+
        '<button type="button" class="pastilla nueva" data-a="mv-cat-nueva" aria-pressed="'+st.nuevaCat+'">Nueva</button></div>';
    q(capa.cont,'cat-nueva').classList.toggle('hidden',!st.nuevaCat);
}
function mvLeer(capa){
    const st=capa.st,cont=capa.cont;
    const raw=parseMonto(q(cont,'monto').value);
    return{monto:st.cuenta==='USDT'?truncUsdt(raw):roundMoney(raw),tasaRef:parsearTasa(q(cont,'tasa').value)||0,nota:q(cont,'nota').value.trim()};
}
function mvCalcular(capa){
    const st=capa.st,cont=capa.cont,v=mvLeer(capa);
    const g=q(cont,'guardar');
    g.textContent=st.id?'Guardar cambios':(st.tipo==='ingreso'?'Guardar ingreso':'Guardar egreso');
    const pie=q(cont,'pie');
    if(!st.cuenta||!(v.monto>0)){pie.textContent='';return}
    if(st.cuenta==='USDT'){
        const antes=saldoDe('USDT');
        const viejoEf=capa.viejo?efectoEnUsdt('movimientos',capa.viejo):0;
        const fin=roundMoney(antes-viejoEf+(st.tipo==='ingreso'?v.monto:-v.monto));
        pie.innerHTML=fin<-0.004?'<span class="baja">USDT quedaría en '+usdtTxt(fin)+'</span>':escHtml('USDT pasa de '+usdtTxt(antes,{unidad:false})+' a '+usdtTxt(fin,{unidad:false}));
        return;
    }
    const prov={tipoMovimiento:st.tipo,tipoCuenta:'banco',banco:st.cuenta,monto:v.monto};
    const fr=frasesSaldos('movimientos',capa.viejo,prov);
    if(!capa.viejo&&fr.length===1&&!fr[0].mal){
        const antes=saldoDe(st.cuenta),mon=monedaDeCuenta(st.cuenta);
        const fin=roundMoney(antes+(st.tipo==='ingreso'?v.monto:-v.monto));
        pie.textContent=nombreCuenta(st.cuenta)+' pasa de '+dinero(antes,mon)+' a '+dinero(fin,mon);
    }else pie.innerHTML=fr.map(f=>f.mal?'<span class="baja">'+escHtml(f.txt)+'</span>':escHtml(f.txt)).join('. ');
}
ACC['mv-tipo']=t=>{const capa=capaDe(t);capa.st.tipo=t.dataset.tipo;limpiarError(capa);mvPintarTodo(capa)};
ACC['mv-cuenta']=t=>{const capa=capaDe(t);capa.st.cuenta=t.dataset.cuenta;limpiarError(capa);mvPintarTodo(capa)};
ENT['mv-calc']=el=>{const capa=capaDe(el);if(!capa)return;limpiarError(capa);mvCalcular(capa)};
ACC['mv-cat']=t=>{
    const capa=capaDe(t),st=capa.st,c=t.dataset.cat;
    st.desc=st.desc&&tagKey(st.desc)===tagKey(c)&&!st.nuevaCat?'':c;
    st.nuevaCat=false;q(capa.cont,'cat-nueva').value='';
    mvPintarCategorias(capa);
};
ACC['mv-cat-todas']=t=>{const capa=capaDe(t);capa.st.todas=true;mvPintarCategorias(capa)};
ACC['mv-cat-nueva']=t=>{
    const capa=capaDe(t),st=capa.st;
    st.nuevaCat=!st.nuevaCat;
    const inp=q(capa.cont,'cat-nueva');
    if(st.nuevaCat){st.desc=inp.value.trim()}else{inp.value='';st.desc=''}
    mvPintarCategorias(capa);
    if(st.nuevaCat)inp.focus();
};
ENT['mv-cat-nueva']=el=>{const capa=capaDe(el);if(capa)capa.st.desc=el.value};
ACC['mv-cuando']=t=>cambiarCuando(capaDe(t));
ACC['mv-guardar']=async t=>{
    const capa=capaDe(t),st=capa.st;
    if(st.guardando)return;
    const v=mvLeer(capa);
    const d={tipoMovimiento:st.tipo,cuenta:st.cuenta,monto:v.monto,tasaRef:v.tasaRef,descripcion:categoriaCanonica(st.desc),nota:v.nota,
             ...(st.fecha?{fecha:st.fecha,hora:st.hora}:{})};
    st.guardando=true;t.disabled=true;
    try{
        const r=await conConfirmacion(o=>guardarMovimiento(d,{...o,id:st.id}));
        if(r.ok){
            recordarCuenta(st.tipo,st.cuenta);
            invalidarItems();
            if(st.id)trasEditar(capa,'movimientos',r.id);
            else{cerrarCapa(capa);avisar(st.tipo==='ingreso'?'Ingreso guardado.':'Egreso guardado.')}
        }else if(!r.cancelado){st.hayError=true;mostrarError(capa,r.error,r.campo)}
    }finally{st.guardando=false;if(t.isConnected)t.disabled=false}
};

/* ═══ Transferencias y conversiones ══════════════════════════════════════ */
function abrirTransferencia(o){
    o=o||{};
    const ent=o.ent==='conversiones'?'conversiones':'transferencias';
    const viejo=o.id!=null?buscarRegistro(ent,o.id):null;
    if(o.id!=null&&!viejo){avisar('Esa transferencia ya no existe.',{error:true});return}
    const lista=bancosActivos();
    const origen=viejo?viejo.origen:(o.origen||cuentaInicial('transf',lista));
    const st={id:viejo?viejo.id:null,desdeDetalle:!!o.reemplazar,ent,origen,destino:viejo?viejo.destino:(lista.find(n=>n!==origen)||''),
              extra:!!(viejo&&(Number(viejo.comision)||0)>0),fecha:viejo?viejo.fecha:null,hora:viejo?viejo.hora:null};
    const html=cabHoja(viejo?(ent==='conversiones'?'Editar conversión':'Editar transferencia'):'Transferencia')+
        '<div class="hoja-cuerpo"><div class="grupo-campos">'+
            '<div><label class="rotulo" for="trMonto">Monto</label><div class="monto-grande" data-campo="monto"><span class="sim cifra" data-r="sim"></span>'+
                '<input id="trMonto" data-r="monto" inputmode="decimal" autocomplete="off" placeholder="0" data-in="tr-calc"><span class="mon" data-r="mon"></span></div></div>'+
            '<div data-campo="origen"><span class="rotulo">Sale de</span><div data-r="origenes"></div></div>'+
            '<div data-campo="destino"><span class="rotulo">Entra a</span><div data-r="destinos"></div></div>'+
            '<div data-r="bloque-tasa" data-campo="tasa"><label class="rotulo" for="trTasa">Tasa: pesos por cada dólar</label>'+
                '<input class="campo" id="trTasa" data-r="tasa" inputmode="decimal" autocomplete="off" placeholder="0,00" data-in="tr-calc"></div>'+
            '<div><div class="opciones-form" style="margin-top:0"><button type="button" class="btn-opcion" data-a="tr-extra" data-r="btn-extra" aria-expanded="false">'+ico('corregir')+'<span>Comisión y fecha</span>'+ico('abajo','ch')+'</button></div>'+
                '<div class="extra hidden" data-r="extra">'+
                    '<div class="fila-campo" data-r="fila-com" data-campo="comision"><label for="trCom">Comisión</label><div class="campo-sufijo"><input class="campo" id="trCom" data-r="com" inputmode="decimal" autocomplete="off" placeholder="0" data-in="tr-calc"><span data-r="com-mon"></span></div></div>'+
                    '<div class="fila-campo"><span>Cuándo</span>'+botonCuando(st,'tr-cuando')+'</div>'+
                '</div></div>'+
        '</div></div>'+
        '<div class="hoja-pie"><div data-r="error"></div><div class="linea-pie" data-r="pie"></div>'+
        '<button type="button" class="btn" data-a="tr-guardar" data-r="guardar" data-primario></button></div>';
    abrirCapa({tipo:'hoja',clase:'alta',etiqueta:viejo?'Editar transferencia':'Transferencia',clave:'transferencia',reemplazar:!!o.reemplazar,html,
        montar(cont,capa){
            capa.st=st;capa.viejo=viejo;
            if(viejo){
                q(cont,'monto').value=formatoCampo(ent==='conversiones'?viejo.montoOrigen:viejo.monto);
                if(ent==='conversiones')q(cont,'tasa').value=fmtTasa(viejo.tasa,'USD');
                if(viejo.comision)q(cont,'com').value=formatoCampo(viejo.comision);
            }
            formatearAlSalir(q(cont,'monto'));formatearAlSalir(q(cont,'com'));
            trPintarTodo(capa);
        },
        actualizar(cont,capa){trPintarCuentas(capa);trCalcular(capa)}
    });
}
function trCruce(st){return!!(st.origen&&st.destino&&monedaDeCuenta(st.origen)!==monedaDeCuenta(st.destino))}
function trPintarTodo(capa){
    const st=capa.st,cont=capa.cont,mo=st.origen?monedaDeCuenta(st.origen):'UYU';
    q(cont,'sim').textContent=simDe(mo);
    q(cont,'mon').textContent=mo;
    q(cont,'com-mon').textContent=mo;
    const cruce=trCruce(st);
    q(cont,'bloque-tasa').classList.toggle('hidden',!cruce);
    q(cont,'fila-com').classList.toggle('hidden',cruce);
    q(cont,'btn-extra').innerHTML=ico(cruce?'calendario':'corregir')+'<span>'+(cruce?'Fecha':'Comisión y fecha')+'</span>'+ico('abajo','ch');
    q(cont,'extra').classList.toggle('hidden',!st.extra);
    q(cont,'btn-extra').setAttribute('aria-expanded',String(st.extra));
    trPintarCuentas(capa);trCalcular(capa);
}
function trPintarCuentas(capa){
    const st=capa.st;
    let lista=bancosActivos();
    [st.origen,st.destino].forEach(n=>{if(n&&!lista.includes(n)&&AppState.datos.bancos[n])lista=[...lista,n]});
    q(capa.cont,'origenes').innerHTML=tilesCuentas(lista,st.origen,{accion:'tr-origen'});
    q(capa.cont,'destinos').innerHTML=tilesCuentas(lista,st.destino,{accion:'tr-destino',deshabilitada:n=>n===st.origen});
}
function trLeer(capa){
    const cont=capa.cont;
    return{monto:roundMoney(parseMonto(q(cont,'monto').value)),tasa:parsearTasa(q(cont,'tasa').value)||0,comision:roundMoney(parseMonto(q(cont,'com').value))};
}
function trCalcular(capa){
    const st=capa.st,cont=capa.cont,v=trLeer(capa),cruce=trCruce(st);
    const mo=st.origen?monedaDeCuenta(st.origen):'UYU',md=st.destino?monedaDeCuenta(st.destino):'UYU';
    const g=q(cont,'guardar'),pie=q(cont,'pie');
    g.textContent=st.id?'Guardar cambios':(v.monto>0?(cruce?'Convertir ':'Transferir ')+dinero(v.monto,mo):(cruce?'Convertir':'Transferir'));
    if(!(v.monto>0)||!st.origen||!st.destino||st.origen===st.destino){pie.textContent='';return}
    let prov,ent;
    if(cruce){
        if(!(v.tasa>0)){pie.textContent='Escribí la tasa de la conversión.';return}
        const mdest=mo==='UYU'&&md==='USD'?roundMoney(v.monto/v.tasa):roundMoney(v.monto*v.tasa);
        prov={origen:st.origen,destino:st.destino,montoOrigen:v.monto,montoDestino:mdest,tasa:v.tasa,monedaOrigen:mo,monedaDestino:md};
        ent='conversiones';
    }else{prov={origen:st.origen,destino:st.destino,monto:v.monto,comision:v.comision};ent='transferencias'}
    /* Si cambió de transferencia a conversión, lo viejo se quita de la lista vieja */
    let fr;
    if(capa.viejo&&st.ent!==ent){
        const a=diferenciaDeEfecto(st.ent,capa.viejo,null).bancos||{},b=diferenciaDeEfecto(ent,null,prov).bancos||{};
        const tot={};[a,b].forEach(m=>Object.entries(m).forEach(([k,x])=>{tot[k]=roundMoney((tot[k]||0)+x)}));
        fr=Object.entries(tot).filter(([,x])=>Math.abs(x)>=0.005).map(([c,x])=>{const fin=roundMoney(saldoDe(c)+x);return{txt:nombreCuenta(c)+(fin<-0.004?' quedaría en ':' queda en ')+dinero(fin,monedaDeCuenta(c)),mal:fin<-0.004}});
    }else fr=frasesSaldos(ent,capa.viejo&&st.ent===ent?capa.viejo:null,prov);
    let txt=fr.map(f=>f.mal?'<span class="baja">'+escHtml(f.txt)+'</span>':escHtml(f.txt)).join(' y ');
    if(cruce)txt='Entran '+escHtml(dinero(prov.montoDestino,md))+'. '+txt;
    pie.innerHTML=txt;
}
ACC['tr-origen']=t=>{
    const capa=capaDe(t),st=capa.st;
    st.origen=t.dataset.cuenta;
    if(st.destino===st.origen)st.destino=bancosActivos().find(n=>n!==st.origen)||'';
    limpiarError(capa);trPintarTodo(capa);
};
ACC['tr-destino']=t=>{const capa=capaDe(t);capa.st.destino=t.dataset.cuenta;limpiarError(capa);trPintarTodo(capa)};
ENT['tr-calc']=el=>{const capa=capaDe(el);if(!capa)return;limpiarError(capa);trCalcular(capa)};
ACC['tr-extra']=alternarExtra;
ACC['tr-cuando']=t=>cambiarCuando(capaDe(t));
ACC['tr-guardar']=async t=>{
    const capa=capaDe(t),st=capa.st;
    if(st.guardando)return;
    const v=trLeer(capa);
    const d={origen:st.origen,destino:st.destino,monto:v.monto,comision:trCruce(st)?0:v.comision,tasa:v.tasa,...(st.fecha?{fecha:st.fecha,hora:st.hora}:{})};
    st.guardando=true;t.disabled=true;
    try{
        const r=await conConfirmacion(o=>guardarTransferencia(d,{...o,id:st.id,entidad:st.ent}));
        if(r.ok){
            recordarCuenta('transf',st.origen);
            if(st.id)trasEditar(capa,r.entidad,r.id);
            else{cerrarCapa(capa);avisar(r.entidad==='conversiones'?'Conversión guardada.':'Transferencia guardada.')}
        }else if(!r.cancelado){
            st.hayError=true;
            if(r.campo==='comision'||r.campo==='fecha'){st.extra=true;q(capa.cont,'extra').classList.remove('hidden')}
            mostrarError(capa,r.error,r.campo);
        }
    }finally{st.guardando=false;if(t.isConnected)t.disabled=false}
};

/* ═══ Correcciones de saldo ══════════════════════════════════════════════ */
function abrirCorreccion(o){
    o=o||{};
    if(o.id!=null){abrirEdicionCorreccion(o);return}
    const lista=bancosActivos();
    const st={cuenta:o.cuenta&&AppState.datos.bancos[o.cuenta]?o.cuenta:(lista[0]||'')};
    const html=cabHoja('Corregir saldo')+
        '<div class="hoja-cuerpo"><div class="grupo-campos">'+
            '<p class="tenue" style="font-size:14px;margin-top:-6px">Si la app no coincide con lo que dice el banco, escribí el saldo real. La diferencia queda anotada como una corrección.</p>'+
            '<div data-campo="cuenta"><span class="rotulo">Cuenta</span><div data-r="cuentas"></div></div>'+
            '<div><label class="rotulo" for="coReal">Saldo real en el banco</label><div class="monto-grande" data-campo="monto"><span class="sim cifra" data-r="sim"></span>'+
                '<input id="coReal" data-r="real" inputmode="decimal" data-negativo autocomplete="off" data-in="co-calc"><span class="mon" data-r="mon"></span></div>'+
                '<div class="diferencia" data-r="dif"></div></div>'+
            '<div><label class="rotulo" for="coMotivo">Motivo</label><input class="campo" id="coMotivo" data-r="motivo" maxlength="120" placeholder="Por ejemplo, una comisión que no anotaste" autocomplete="off"></div>'+
        '</div></div>'+
        '<div class="hoja-pie"><div data-r="error"></div><button type="button" class="btn" data-a="co-guardar" data-primario>Corregir saldo</button></div>';
    abrirCapa({tipo:'hoja',clase:'alta',etiqueta:'Corregir saldo',clave:'correccion',reemplazar:!!o.reemplazar,html,
        montar(cont,capa){capa.st=st;formatearAlSalir(q(cont,'real'));coPintar(capa)},
        actualizar(cont,capa){coPintar(capa)}});
}
function coPintar(capa){
    const st=capa.st,cont=capa.cont,mon=st.cuenta?monedaDeCuenta(st.cuenta):'UYU';
    q(cont,'cuentas').innerHTML=tilesCuentas(bancosActivos(),st.cuenta,{accion:'co-cuenta'});
    q(cont,'sim').textContent=simDe(mon);
    q(cont,'mon').textContent=mon;
    q(cont,'real').placeholder=st.cuenta?formatoCampo(saldoDe(st.cuenta)):'0';
    coCalcular(capa);
}
function coCalcular(capa){
    const st=capa.st,cont=capa.cont,box=q(cont,'dif');
    if(!st.cuenta){box.textContent='';return}
    const mon=monedaDeCuenta(st.cuenta),actual=saldoDe(st.cuenta);
    const txt=q(cont,'real').value.trim();
    if(!txt){box.innerHTML='<span class="tenue">La app tiene '+escHtml(dinero(actual,mon))+'.</span>';return}
    const dif=roundMoney(parseMonto(txt)-actual);
    box.innerHTML=Math.abs(dif)<0.005?'<span class="tenue">Es el mismo saldo que tiene la app: no hay nada que corregir.</span>'
        :'La app tiene '+escHtml(dinero(actual,mon))+'. Se anota una diferencia de <b class="'+claseSigno(dif)+'">'+escHtml(dinero(dif,mon,{signo:true}))+'</b>.';
}
ACC['co-cuenta']=t=>{const capa=capaDe(t);capa.st.cuenta=t.dataset.cuenta;limpiarError(capa);coPintar(capa)};
ENT['co-calc']=el=>{const capa=capaDe(el);if(!capa)return;limpiarError(capa);coCalcular(capa)};
ACC['co-guardar']=t=>{
    const capa=capaDe(t),st=capa.st,cont=capa.cont;
    const txt=q(cont,'real').value.trim();
    if(!txt){st.hayError=true;mostrarError(capa,'Escribí el saldo que dice el banco.','monto');return}
    const r=corregirSaldo(st.cuenta,parseMonto(txt),q(cont,'motivo').value);
    if(r.ok){
        cerrarCapa(capa);
        avisar('Saldo corregido: se anotó '+dinero(r.delta,monedaDeCuenta(st.cuenta),{signo:true})+'.',{deshacer:()=>{
            const e=eliminarRegistro('ajustesSaldo',r.id,{forzar:true});
            if(e.ok)avisar('Se deshizo la corrección.');
        }});
    }else{st.hayError=true;mostrarError(capa,r.error,r.campo)}
};
function abrirEdicionCorreccion(o){
    const viejo=buscarRegistro('ajustesSaldo',o.id);
    if(!viejo){avisar('Esa corrección ya no existe.',{error:true});return}
    const mon=monedaDeCuenta(viejo.cuenta);
    const st={id:viejo.id,desdeDetalle:!!o.reemplazar,signo:viejo.delta<0?-1:1};
    const seg=(v,t)=>'<button type="button" role="tab" data-a="co-signo" data-s="'+v+'" aria-selected="'+(st.signo===v)+'">'+t+'</button>';
    const html=cabHoja('Editar corrección')+
        '<div class="hoja-cuerpo"><div class="grupo-campos">'+
            '<div class="det-donde" style="margin-top:0">En '+mono(viejo.cuenta)+'<b>'+escHtml(nombreCuenta(viejo.cuenta))+'</b>, '+escHtml(cuandoTexto(viejo.fecha,viejo.hora))+'</div>'+
            '<div><span class="rotulo">La diferencia</span><div class="segmento" role="tablist" style="display:inline-flex;margin-bottom:10px">'+seg(1,'Suma')+seg(-1,'Resta')+'</div>'+
                '<div class="monto-grande" data-campo="monto"><span class="sim cifra">'+simDe(mon)+'</span><input data-r="monto" inputmode="decimal" autocomplete="off" aria-label="Diferencia"><span class="mon">'+mon+'</span></div></div>'+
            '<div><label class="rotulo" for="coMotivoE">Motivo</label><input class="campo" id="coMotivoE" data-r="motivo" maxlength="120" autocomplete="off"></div>'+
        '</div></div>'+
        '<div class="hoja-pie"><div data-r="error"></div><button type="button" class="btn" data-a="co-editar" data-primario>Guardar cambios</button></div>';
    abrirCapa({tipo:'hoja',clase:'alta',etiqueta:'Editar corrección',clave:'correccion',reemplazar:!!o.reemplazar,html,
        montar(cont,capa){capa.st=st;q(cont,'monto').value=formatoCampo(Math.abs(viejo.delta));q(cont,'motivo').value=viejo.motivo||'';formatearAlSalir(q(cont,'monto'))}});
}
ACC['co-signo']=t=>{
    const capa=capaDe(t);capa.st.signo=Number(t.dataset.s);
    capa.cont.querySelectorAll('[data-a="co-signo"]').forEach(b=>b.setAttribute('aria-selected',String(Number(b.dataset.s)===capa.st.signo)));
};
ACC['co-editar']=async t=>{
    const capa=capaDe(t),st=capa.st,cont=capa.cont;
    const delta=roundMoney(st.signo*parseMonto(q(cont,'monto').value));
    const r=await conConfirmacion(o=>editarCorreccion(st.id,{delta,motivo:q(cont,'motivo').value},o));
    if(r.ok)trasEditar(capa,'ajustesSaldo',r.id);
    else if(!r.cancelado){st.hayError=true;mostrarError(capa,r.error,r.campo)}
};

/* ═══ USDT que ya tenías (lotes cargados a mano) ═════════════════════════ */
function abrirLote(o){
    o=o||{};
    const l=o.id!=null?(AppState.datos.lotes||[]).find(x=>x&&String(x.id)===String(o.id)):null;
    if(o.id!=null&&(!l||!l.manual)){avisar('Ese lote no se puede editar.',{error:true});return}
    const decl=l&&l.carryover?(AppState.datos._archivoCarryover||[]).find(x=>String(x.id)===String(l.id))||l:l;
    const html=cabHoja(l?'Editar lote':'USDT que ya tenías')+
        '<div class="hoja-cuerpo"><div class="grupo-campos">'+
            '<p class="tenue" style="font-size:14px;margin-top:-6px">Para USDT que tenías antes de usar la app. Se usan para calcular la ganancia cuando los vendas, empezando siempre por los más viejos.</p>'+
            '<div><label class="rotulo" for="loCant">Cuántos USDT</label><div class="monto-grande" data-campo="cantidad">'+
                '<input id="loCant" data-r="cant" inputmode="decimal" autocomplete="off" placeholder="0"><span class="mon">USDT</span></div></div>'+
            '<div data-campo="precio"><label class="rotulo" for="loPrecio">A cuánto te salió cada uno</label>'+
                '<div class="campo-sufijo"><input class="campo" id="loPrecio" data-r="precio" inputmode="decimal" autocomplete="off" placeholder="0,00"><span>$</span></div></div>'+
            '<div data-campo="fecha"><label class="rotulo" for="loFecha">Fecha</label><input class="campo" type="date" id="loFecha" data-r="fecha" max="'+getUDateStr()+'"></div>'+
        '</div></div>'+
        '<div class="hoja-pie"><div data-r="error"></div><button type="button" class="btn" data-a="lo-guardar" data-primario>'+(l?'Guardar cambios':'Guardar')+'</button>'+
        (l?'<button type="button" class="btn peligro chico" style="margin-top:10px" data-a="lo-eliminar">'+ico('borrar')+'Eliminar lote</button>':'')+'</div>';
    abrirCapa({tipo:'hoja',clase:'alta',etiqueta:'USDT que ya tenías',clave:'lote',reemplazar:!!o.reemplazar,html,
        montar(cont,capa){
            capa.st={id:l?l.id:null};
            q(cont,'cant').value=decl?fmtTrunc(decl.cantidad,2):'';
            q(cont,'precio').value=decl?fmtTasa(decl.precioCompra,'UYU'):'';
            q(cont,'fecha').value=decl&&decl.fecha?decl.fecha:getUDateStr();
        }});
}
ACC['lote-nuevo']=t=>abrirLote({reemplazar:desdeAcciones(t)});
ACC['lo-guardar']=t=>{
    const capa=capaDe(t),cont=capa.cont,st=capa.st;
    const r=guardarLoteManual({cantidad:parseMonto(q(cont,'cant').value),precio:parsearTasa(q(cont,'precio').value)||0,fecha:q(cont,'fecha').value},{id:st.id});
    if(r.ok){cerrarCapa(capa);avisar(st.id?'Cambios guardados.':'USDT agregados a tu inventario.')}
    else{st.hayError=true;mostrarError(capa,r.error,r.campo)}
};
ACC['lo-eliminar']=async t=>{
    const capa=capaDe(t),st=capa.st;
    const r=await conConfirmacion(o=>eliminarRegistro('lotes',st.id,o),{titulo:'¿Eliminar igual?',si:'Eliminar igual'});
    if(r.ok){cerrarCapa(capa);avisar('Se eliminó el lote.',{deshacer:()=>recuperarEliminado(r.clave)})}
    else if(!r.cancelado)mostrarError(capa,r.error);
};

/* ═══ Fecha y hora ═══════════════════════════════════════════════════════ */
/* Devuelve {fecha, hora} elegidos, {fecha:null} para "ahora" en un registro
   nuevo, o null si se cerró sin elegir. */
function elegirCuando(fecha,hora,o){
    o=o||{};
    return new Promise(res=>{
        let resultado=null;
        const hoy=getUDateStr(),ahora=getUTimeStr();
        abrirCapa({tipo:'hoja',etiqueta:'Cuándo fue',
            html:cabHoja('¿Cuándo fue?',{chico:true})+'<div class="hoja-cuerpo">'+
                '<div class="pastillas" style="margin-bottom:16px"><button type="button" class="pastilla" data-a="cuando-rapido" data-v="ahora">Ahora</button>'+
                '<button type="button" class="pastilla" data-a="cuando-rapido" data-v="ayer">Ayer a esta hora</button></div>'+
                '<div class="dos-campos"><div><label class="rotulo" for="cuFecha">Día</label><input class="campo" type="date" id="cuFecha" data-r="fecha" max="'+hoy+'" value="'+escHtml(fecha||hoy)+'"></div>'+
                '<div><label class="rotulo" for="cuHora">Hora</label><input class="campo" type="time" id="cuHora" data-r="hora" value="'+escHtml(hora||ahora)+'"></div></div>'+
                '<div data-r="error" style="margin-top:14px"></div></div>'+
                '<div class="hoja-pie"><button type="button" class="btn" data-a="cuando-listo" data-primario>Listo</button></div>',
            montar(cont,capa){capa.st={edicion:!!o.edicion};capa.resolver=v=>{resultado=v;cerrarCapa(capa)}},
            alCerrar(){res(resultado)}
        });
    });
}
ACC['cuando-rapido']=t=>{
    const capa=capaDe(t);
    if(t.dataset.v==='ahora'){
        capa.resolver(capa.st.edicion?{fecha:getUDateStr(),hora:getUTimeStr()}:{fecha:null,hora:null});
        return;
    }
    q(capa.cont,'fecha').value=sumarDias(getUDateStr(),-1);
    q(capa.cont,'hora').value=getUTimeStr();
};
ACC['cuando-listo']=t=>{
    const capa=capaDe(t),cont=capa.cont;
    const f=q(cont,'fecha').value,h=q(cont,'hora').value;
    const p=problemaConFecha(f,h);
    if(p){mostrarError(capa,p);return}
    capa.resolver({fecha:f,hora:h});
};
