/* ═══════════════════════════════════════════════════════════════════════════
   §20 — REGISTRO, DETALLE Y ELIMINADOS (v8.0.0)
   ═══════════════════════════════════════════════════════════════════════════
   El registro junta todo lo que se cargó, por día, con filtros por tipo,
   período, cuenta y búsqueda. Tocar una fila abre su detalle: qué pasó, cómo
   cambió cada cuenta y qué se le cambió desde que se cargó. Desde ahí se edita
   o se elimina; lo eliminado queda 30 días en Eliminados. */
PANTALLAS.registro={pintar:pintarRegistro};

const TIPOS_REG=[['todo','Todo'],['venta','Ventas'],['compra','Compras'],['ingreso','Ingresos'],['egreso','Egresos'],
                 ['transferencia','Transferencias'],['correccion','Correcciones'],['eliminados','Eliminados']];
const PERIODOS_REG=[['hoy','Hoy'],['ayer','Ayer'],['semana','Últimos 7 días'],['mes','Este mes'],['mespasado','Mes pasado'],['todo','Todo']];
const REG_PAGINA=60;

function rangoRegistro(r){
    const hoy=getUDateStr();
    if(r.dia)return[r.dia,r.dia];
    switch(r.periodo){
        case'hoy':return[hoy,hoy];
        case'ayer':{const a=sumarDias(hoy,-1);return[a,a]}
        case'semana':return[sumarDias(hoy,-6),hoy];
        case'mes':return[hoy.slice(0,7)+'-01',hoy.slice(0,7)+'-31'];
        case'mespasado':{const m=sumarMeses(hoy.slice(0,7),-1);return[m+'-01',m+'-31']}
        default:return['','9999-99-99'];
    }
}
function etiquetaPeriodo(r){
    if(r.dia)return tituloDia(r.dia);
    return(PERIODOS_REG.find(p=>p[0]===r.periodo)||PERIODOS_REG[3])[1];
}
function filtrarRegistro(){
    const r=AppState.ui.registro;
    const[desde,hasta]=rangoRegistro(r);
    const q=tagKey(String(r.buscar||'').trim());
    return itemsDelRegistro().filter(it=>{
        if(r.tipo!=='todo'&&it.tipo!==r.tipo)return false;
        if(it.fecha<desde||it.fecha>hasta)return false;
        if(r.cuenta){
            if(r.cuenta==='USDT'){if(!(it.ent==='operaciones'||(it.ent==='movimientos'&&it.rec.tipoCuenta==='usdt')))return false}
            else if(!it.cuentas.includes(r.cuenta))return false;
        }
        if(q&&!it.buscable.includes(q))return false;
        return true;
    });
}
/* Lo que entró y salió de las cuentas elegidas, y la ganancia neta */
function resumenRegistro(items,cuenta){
    const entra={},sale={};let gan=0,hayGan=false;
    items.forEach(it=>{
        if(cuenta==='USDT'){
            const v=efectoEnUsdt(it.ent,it.rec);
            if(v>0)entra.USDT=roundMoney((entra.USDT||0)+v);else if(v<0)sale.USDT=roundMoney((sale.USDT||0)+v);
        }else{
            Object.entries(netoPorMoneda(it,cuenta?[cuenta]:null)).forEach(([m,v])=>{
                if(v>=0.005)entra[m]=roundMoney((entra[m]||0)+v);else if(v<=-0.005)sale[m]=roundMoney((sale[m]||0)+v);
            });
        }
        const g=gananciaDeItem(it);
        if(Math.abs(g)>=0.005||it.tipo==='venta'||it.tipo==='egreso'){hayGan=true;gan=roundMoney(gan+g)}
    });
    return{entra,sale,gan,hayGan};
}

function pintarRegistro(){
    if(!AppState.datos)return;
    const r=AppState.ui.registro;
    const f=$('registroFiltros'),cuerpo=$('registroCuerpo');if(!f||!cuerpo)return;
    /* Búsqueda: si viene puesta desde otra pantalla, mostrarla */
    const inp=$('regBuscar'),fila=$('regBuscarFila');
    if(inp&&document.activeElement!==inp&&inp.value!==(r.buscar||''))inp.value=r.buscar||'';
    if(fila&&r.buscar)fila.classList.remove('hidden');
    const chipsAntes=f.querySelector('.chips');
    const sl=chipsAntes?chipsAntes.scrollLeft:0;
    f.innerHTML='<div class="chips" role="group" aria-label="Qué mostrar">'+TIPOS_REG.map(([k,t])=>
            '<button type="button" class="chip" data-a="reg-tipo" data-tipo="'+k+'" aria-pressed="'+(r.tipo===k)+'">'+t+'</button>').join('')+'</div>'+
        (r.tipo==='eliminados'?'':'<div class="selectores">'+
            '<button type="button" class="selector" data-a="reg-periodo"><span>'+escHtml(etiquetaPeriodo(r))+'</span>'+ico('abajo')+'</button>'+
            '<button type="button" class="selector" data-a="reg-cuenta"><span>'+escHtml(r.cuenta?nombreCuenta(r.cuenta):'Todas las cuentas')+'</span>'+ico('abajo')+'</button></div>');
    const chips=f.querySelector('.chips');if(chips)chips.scrollLeft=sl;

    if(r.tipo==='eliminados'){cuerpo.innerHTML=htmlEliminados();return}

    const items=filtrarRegistro();
    if(!items.length){
        const sinNada=!itemsDelRegistro().length;
        cuerpo.innerHTML='<div class="bloque vacio" style="margin-top:14px">'+(sinNada
            ?'<b>Todavía no hay movimientos</b><p>Cargá el primero con el botón +.</p>'
            :'<b>No hay movimientos con estos filtros</b><p>Probá con otro período, otra cuenta u otra búsqueda.</p><button type="button" class="btn gris chico" data-a="reg-limpiar">Ver todo</button>')+'</div>';
        return;
    }
    /* Resumen */
    const res=resumenRegistro(items,r.cuenta);
    const dondeE=r.cuenta&&r.cuenta!=='USDT'?'Entró a '+nombreCuenta(r.cuenta):r.cuenta==='USDT'?'Entraron':'Entró a tus cuentas';
    const dondeS=r.cuenta&&r.cuenta!=='USDT'?'Salió de '+nombreCuenta(r.cuenta):r.cuenta==='USDT'?'Salieron':'Salió de tus cuentas';
    const fmt=(m,v,signo)=>m==='USDT'?usdtTxt(v,{signo}):dinero(v,m,{signo});
    let lineas='';
    const monedas=Array.from(new Set([...Object.keys(res.entra),...Object.keys(res.sale)])).sort((a,b)=>a==='UYU'?-1:b==='UYU'?1:0);
    monedas.forEach(m=>{
        const extra=m==='USD'?' en dólares':'';
        if(res.entra[m])lineas+='<span>'+escHtml(dondeE+extra)+'</span><b class="sube">'+fmt(m,res.entra[m],true)+'</b>';
        if(res.sale[m])lineas+='<span>'+escHtml(dondeS+extra)+'</span><b>'+fmt(m,res.sale[m],false)+'</b>';
    });
    if(res.hayGan&&r.cuenta!=='USDT')lineas+='<span class="total">Ganancia neta</span><b class="total cifra '+claseSigno(res.gan)+'">'+dinero(res.gan,'UYU',{signo:true})+'</b>';
    let html=lineas?'<div class="bloque resumen-reg">'+lineas+'</div>':'';

    /* Por día */
    const ganDia={},conGan={};
    items.forEach(it=>{
        const g=gananciaDeItem(it);
        if(Math.abs(g)>=0.005||it.tipo==='venta'||it.tipo==='egreso'){conGan[it.fecha]=true;ganDia[it.fecha]=roundMoney((ganDia[it.fecha]||0)+g)}
    });
    const vista=items.slice(0,r.limite||REG_PAGINA);
    let dia=null,filas='';
    const cerrarDia=()=>{if(dia!==null)html+='<div class="bloque">'+filas+'</div>';filas=''};
    vista.forEach(it=>{
        if(it.fecha!==dia){
            cerrarDia();dia=it.fecha;
            html+='<div class="dia"><b>'+escHtml(tituloDia(dia))+'</b>'+(conGan[dia]&&r.cuenta!=='USDT'
                ?'<span class="'+claseSigno(ganDia[dia])+'">'+(ganDia[dia]<=-0.005?'pérdida ':'ganancia ')+dinero(Math.abs(ganDia[dia]),'UYU',{signo:ganDia[dia]>=0.005})+'</span>':'')+'</div>';
        }
        filas+=filaRegistroHtml(it);
    });
    cerrarDia();
    if(items.length>vista.length)html+='<button type="button" class="ver-mas" data-a="reg-mas">Ver más ('+(items.length-vista.length)+')</button>';
    cuerpo.innerHTML=html;
}

ACC['reg-tipo']=t=>{
    const r=AppState.ui.registro;
    r.tipo=t.dataset.tipo||'todo';r.limite=REG_PAGINA;
    pintarRegistro();
    const b=$('registroFiltros').querySelector('[aria-pressed="true"]');
    if(b&&b.scrollIntoView)b.scrollIntoView({block:'nearest',inline:'nearest'});
};
ACC['reg-mas']=()=>{AppState.ui.registro.limite=(AppState.ui.registro.limite||REG_PAGINA)+REG_PAGINA;pintarRegistro()};
ACC['reg-limpiar']=()=>{
    Object.assign(AppState.ui.registro,{tipo:'todo',periodo:'todo',cuenta:'',buscar:'',dia:'',limite:REG_PAGINA});
    const inp=$('regBuscar');if(inp)inp.value='';
    pintarRegistro();
};
let _regBuscarT=0;
ACC['reg-buscar']=t=>{
    const fila=$('regBuscarFila'),inp=$('regBuscar');
    const abrir=fila.classList.contains('hidden');
    fila.classList.toggle('hidden',!abrir);
    t.setAttribute('aria-expanded',String(abrir));
    if(abrir){inp.focus()}
    else if(AppState.ui.registro.buscar){inp.value='';AppState.ui.registro.buscar='';pintarRegistro()}
};
ENT['reg-buscar']=el=>{
    AppState.ui.registro.buscar=el.value;AppState.ui.registro.limite=REG_PAGINA;
    clearTimeout(_regBuscarT);_regBuscarT=setTimeout(pintarRegistro,140);
};
ACC['reg-periodo']=()=>{
    const r=AppState.ui.registro;
    abrirCapa({tipo:'hoja',etiqueta:'Período',
        html:cabHoja('Período',{chico:true})+'<div class="hoja-cuerpo">'+
            PERIODOS_REG.map(([k,t])=>'<button type="button" class="opc" role="radio" aria-checked="'+(!r.dia&&r.periodo===k)+'" data-a="reg-periodo-elegir" data-p="'+k+'">'+t+ico('ok','marca-ok')+'</button>').join('')+
            '<label class="rotulo" for="regDia" style="margin-top:18px">Un día puntual</label>'+
            '<input class="campo" type="date" id="regDia" data-ch="reg-dia" max="'+getUDateStr()+'" value="'+escHtml(r.dia||'')+'">'+
        '</div>'});
};
ACC['reg-periodo-elegir']=t=>{
    const r=AppState.ui.registro;r.periodo=t.dataset.p;r.dia='';r.limite=REG_PAGINA;
    cerrarCapa(capaDe(t));pintarRegistro();
};
ENT['reg-dia']=el=>{
    if(!el.value)return;
    const r=AppState.ui.registro;r.dia=el.value;r.limite=REG_PAGINA;
    cerrarCapa(capaDe(el));pintarRegistro();
};
ACC['reg-cuenta']=()=>{
    const r=AppState.ui.registro;
    const ops=[['','Todas las cuentas']].concat(cuentasVisibles().map(b=>[b.nombre,nombreCuenta(b.nombre)]),[['USDT','USDT']]);
    abrirCapa({tipo:'hoja',etiqueta:'Cuenta',
        html:cabHoja('Cuenta',{chico:true})+'<div class="hoja-cuerpo">'+ops.map(([k,t])=>
            '<button type="button" class="opc" role="radio" aria-checked="'+((r.cuenta||'')===k)+'" data-a="reg-cuenta-elegir" data-c="'+escHtml(k)+'">'+
            (k?mono(k,true):'<span class="mono m" style="background:var(--tinta-2)" aria-hidden="true"></span>')+escHtml(t)+ico('ok','marca-ok')+'</button>').join('')+'</div>'});
};
ACC['reg-cuenta-elegir']=t=>{
    const r=AppState.ui.registro;r.cuenta=t.dataset.c||'';r.limite=REG_PAGINA;
    cerrarCapa(capaDe(t));pintarRegistro();
};
ACC['ver-eliminados']=t=>{
    const r=AppState.ui.registro;r.tipo='eliminados';
    cerrarTodasLasCapas();irATab('registro');
};

/* ─── Eliminados ───────────────────────────────────────────────────────── */
function itemLote(l){
    return{ent:'lotes',id:l.id,rec:l,tipo:'lote',fecha:l.fecha||'',hora:l.hora||'',cuentas:['USDT'],
           titulo:'USDT que ya tenías',montoTxt:usdtTxt(l.cantidad,{signo:true}),montoClase:'',
           sub:mono('USDT')+'<span>a '+escHtml(dinero(l.precioCompra,l.moneda||'UYU'))+' cada uno</span>'};
}
function itemDeEliminado(x){return x.e==='lotes'?itemLote(x.r):itemRegistro(x.e,x.r)}
function htmlEliminados(){
    const lista=eliminadosLista();
    if(!lista.length)return'<div class="bloque vacio" style="margin-top:14px"><b>No hay nada eliminado</b><p>Lo que borres va a quedar acá 30 días, y lo vas a poder recuperar.</p></div>';
    return'<p class="texto-ayuda">Lo que borraste en los últimos 30 días. Al recuperarlo vuelve a su lugar y los saldos se recalculan.</p>'+
        '<div class="bloque" style="margin-top:10px">'+lista.map(x=>{
            const it=itemDeEliminado(x);
            return'<div class="fila-eliminado"><button type="button" class="fila" data-a="eliminado-ver" data-k="'+escHtml(x.k)+'">'+
                '<span class="fila-t">'+escHtml(it.titulo)+'</span><span class="fila-m">'+escHtml(it.montoTxt)+'</span>'+
                '<span class="fila-s">'+it.cuentas.map(c=>mono(c)).join('')+'<span>'+escHtml(cuandoCorto(it.fecha,it.hora))+'</span></span></button>'+
                '<button type="button" class="recuperar" data-a="recuperar" data-k="'+escHtml(x.k)+'">Recuperar</button></div>';
        }).join('')+'</div>';
}
ACC['eliminado-ver']=t=>{
    const x=eliminadosLista().find(e=>e.k===t.dataset.k);if(!x)return;
    abrirCapa({tipo:'hoja',clase:'alta',etiqueta:'Eliminado',clave:'eliminado',
        html:htmlDetalle(x.e,x.r,{eliminado:x})});
};
ACC['recuperar']=t=>{
    const c=capaDe(t);if(c)cerrarCapa(c);
    recuperarEliminado(t.dataset.k);
};
async function recuperarEliminado(clave){
    const r=await conConfirmacion(o=>restaurarEliminado(clave,o),{titulo:'¿Recuperar igual?',si:'Recuperar igual'});
    if(r.ok)avisar('Se recuperó y los saldos se recalcularon.');
    else if(!r.cancelado)avisar(r.error||'No se pudo recuperar.',{error:true});
}

/* ─── Detalle de un registro ───────────────────────────────────────────── */
const TITULO_DETALLE={venta:'Venta de USDT',compra:'Compra de USDT',ingreso:'Ingreso',egreso:'Egreso',correccion:'Corrección de saldo',lote:'USDT que ya tenías'};
function tituloDetalle(it){return it.ent==='conversiones'?'Conversión':(TITULO_DETALLE[it.tipo]||'Transferencia')}
ACC['detalle']=t=>abrirDetalle(t.dataset.ent,t.dataset.id);
function abrirDetalle(ent,id,o){
    o=o||{};
    if(ent==='lotes'){abrirLoteDesdeDetalle(id);return}
    abrirCapa({tipo:'hoja',clase:'alta',etiqueta:'Detalle',clave:'detalle',reemplazar:!!o.reemplazar,
        montar(cont,capa){capa.ent=ent;capa.id=id;pintarDetalle(cont,capa)},
        actualizar(cont,capa){pintarDetalle(cont,capa)}});
}
function pintarDetalle(cont,capa){
    const rec=buscarRegistro(capa.ent,capa.id);
    if(!rec){
        cont.innerHTML=cabHoja('Detalle',{chico:true})+'<div class="hoja-cuerpo"><div class="vacio"><b>Este movimiento ya no está</b>'+
            '<p>Se borró, quizás desde otro dispositivo. Si fue un error, lo encontrás en Eliminados.</p>'+
            '<button type="button" class="btn gris chico" data-a="ver-eliminados">Ir a Eliminados</button></div></div>';
        return;
    }
    const sc=cont.querySelector('.hoja-cuerpo');const top=sc?sc.scrollTop:0;
    cont.innerHTML=htmlDetalle(capa.ent,rec,{});
    const sc2=cont.querySelector('.hoja-cuerpo');if(sc2)sc2.scrollTop=top;
}
/* Cómo quedó cada cuenta con este registro, según el libro de cada una */
function cambiosDeCuentas(ent,rec){
    const filas=[];
    Object.keys(efectoEnBancos(ent,rec)).forEach(c=>{
        const l=historialCuenta(c).find(x=>x.tipo===ent&&String(x.id)===String(rec.id));
        if(l)filas.push({c,a:l.anterior,d:l.resultante});
    });
    if(Math.abs(efectoEnUsdt(ent,rec))>=0.005){
        const l=historialCuenta('USDT').find(x=>x.tipo===ent&&String(x.id)===String(rec.id));
        if(l)filas.push({c:'USDT',a:l.anterior,d:l.resultante});
    }
    return filas;
}
/* Historial: "Cambiaste la tasa de $40,90 a $40,95" */
const ROTULO_CAMBIO={monto:'el monto',tasa:'la tasa',banco:'la cuenta',aportes:'el reparto entre cuentas',comisionBanco:'la comisión del banco',
    comisionPct:'la comisión de Binance',fecha:'la fecha',hora:'la hora',tipoMovimiento:'el tipo',cuenta:'la cuenta',tasaRef:'el costo por USDT',
    descripcion:'la categoría',nota:'la nota',origen:'la cuenta de origen',destino:'la cuenta de destino',comision:'la comisión',
    montoOrigen:'el monto',delta:'la diferencia',motivo:'el motivo',cantidad:'la cantidad',precioCompra:'el precio'};
function valorCambio(ent,rec,campo,v){
    if(v===''||v===null||v===undefined){
        return{descripcion:'ninguna',nota:'ninguna',motivo:'ninguno',aportes:'una sola cuenta'}[campo]||'nada';
    }
    const mon=ent==='operaciones'?(rec.moneda||'UYU'):ent==='movimientos'?(rec.tipoCuenta==='usdt'?'USDT':monedaDeCuenta(rec.banco))
        :ent==='ajustesSaldo'?monedaDeCuenta(rec.cuenta):ent==='conversiones'?(rec.monedaOrigen||monedaDeCuenta(rec.origen)):monedaDeCuenta(rec.origen);
    switch(campo){
        case'monto':case'comisionBanco':case'comision':case'montoOrigen':return mon==='USDT'?usdtTxt(v):dinero(v,mon);
        case'tasa':return ent==='conversiones'?fmtNum(v,v<10?3:2):fmtTasaMon(v,mon);
        case'tasaRef':case'precioCompra':return dinero(v,'UYU');
        case'comisionPct':return pctTxt(v);
        case'banco':case'cuenta':case'origen':case'destino':return nombreCuenta(v);
        case'fecha':return fmtFechaCorta(v);
        case'delta':return dinero(v,mon,{signo:true});
        case'cantidad':return usdtTxt(v);
        case'descripcion':case'nota':case'motivo':return'"'+v+'"';
        default:return String(v);
    }
}
function unirConY(partes){return partes.length>1?partes.slice(0,-1).join(', ')+' y '+partes[partes.length-1]:(partes[0]||'')}
function lineasDeCambios(ent,rec){
    const L=[];
    (Array.isArray(rec.cambios)?rec.cambios:[]).forEach(c=>{
        if(!c||!Array.isArray(c.c))return;
        let t;
        if(c.c.some(x=>x[0]==='recuperado'))t='Se recuperó de Eliminados';
        else t='Cambiaste '+unirConY(c.c.map(([campo,a,d])=>(ROTULO_CAMBIO[campo]||campo)+' de '+valorCambio(ent,rec,campo,a)+' a '+valorCambio(ent,rec,campo,d)));
        L.push({cuando:cuandoIso(c.t),t});
    });
    if(rec.creado)L.push({cuando:cuandoIso(rec.creado),t:ent==='movimientos'?'Lo cargaste':'La cargaste'});
    return L;
}
function dato(rot,val,o){
    o=o||{};
    return'<div class="dato"'+(o.estilo?' style="'+o.estilo+'"':'')+'><span'+(o.rotFuerte?' style="color:var(--tinta);font-weight:650"':'')+'>'+rot+(o.chicoRot?'<small>'+o.chicoRot+'</small>':'')+'</span>'+
        '<b'+(o.clase?' class="'+o.clase+'"':'')+'>'+val+(o.chico?'<small>'+o.chico+'</small>':'')+'</b></div>';
}
function htmlDetalle(ent,rec,o){
    o=o||{};
    const elim=o.eliminado||null;
    const it=ent==='lotes'?itemLote(rec):itemRegistro(ent,rec);
    const tipo=it.tipo,titulo=tituloDetalle(it);
    const cuando=cuandoTexto(rec.fecha||'',rec.hora||'');
    const nom=c=>mono(c)+'<b>'+escHtml(nombreCuenta(c))+'</b>';
    let cifra='',cifraClase='',donde='',datos='';
    const mon=rec.moneda||'UYU';
    if(tipo==='venta'||tipo==='compra'){
        const base=Number(rec.usdt)||0,com=Number(rec.comisionPlataforma)||0,neto=usdtNeto(base,com,tipo);
        const pct=isFinite(rec.comisionPct)?pctTxt(rec.comisionPct):'';
        if(tipo==='venta'){
            cifra=dinero(rec.monto,mon,{signo:true});cifraClase='sube';
            donde='Entraron a '+nom(rec.banco)+' '+escHtml(cuando);
            datos+=dato('Vendiste',usdtTxt(base));
            datos+=dato('Tasa',escHtml(fmtTasaMon(rec.tasa,mon)));
            datos+=dato('Comisión de Binance',escHtml(pct||'—'),{chico:com?usdtTxt(com):''});
            datos+=dato('Salieron de tu inventario',usdtTxt(neto));
            if(!elim){
                const lotes=Array.isArray(rec.consumedLots)?rec.consumedLots:[];
                let nota='';
                if(lotes.length===1){
                    const l=(AppState.datos.lotes||[]).find(x=>String(x.id)===String(lotes[0].lotId));
                    nota=(l&&l.fecha?'lote del '+fmtFechaCorta(l.fecha)+' ':'un lote ')+'a '+dinero(lotes[0].precio,mon)+' cada uno';
                }else if(lotes.length>1){
                    const ps=lotes.map(x=>x.precio);
                    nota='de '+lotes.length+' lotes, entre '+dinero(Math.min(...ps),mon)+' y '+dinero(Math.max(...ps),mon);
                }
                if(isFinite(rec.costoUsdt))datos+=dato('Lo que te habían costado',dinero(rec.costoUsdt,mon),{chicoRot:escHtml(nota)});
                const g=Number(rec.ganancia)||0;
                datos+=dato(g<=-0.005?'Pérdida':'Ganancia','<span class="cifra" style="font-size:24px;font-weight:760">'+dinero(g,mon,{signo:true})+'</span>',
                    {clase:claseSigno(g),rotFuerte:true,estilo:'border-top:1px solid var(--linea);margin-top:4px;padding-top:12px'});
                const consumido=lotes.reduce((s,x)=>s+(Number(x.amount)||0),0);
                if(consumido<neto-0.005)datos+='<div class="det-aviso">Cuando se cargó esta venta faltaban '+usdtTxt(neto-consumido)+' en tu inventario. La ganancia se calculó solo sobre lo que había.</div>';
            }
        }else{
            const cb=Number(rec.comisionBanco)||0;
            cifra=dinero(-(roundMoney((Number(rec.monto)||0)+cb)),mon);
            const cs=it.cuentas;
            donde='Salieron de '+cs.map(nom).join(' y ')+' '+escHtml(cuando);
            datos+=dato('Pagaste',dinero(rec.monto,mon),{chico:esPagoDividido(rec)?escHtml(aportesDe(rec).map(a=>nombreCuenta(a.banco)+' '+dinero(a.monto,mon)).join(' y ')):''});
            if(cb)datos+=dato('Comisión del banco',dinero(cb,mon));
            datos+=dato('Tasa',escHtml(fmtTasaMon(rec.tasa,mon)));
            datos+=dato('Compraste',usdtTxt(base));
            datos+=dato('Comisión de Binance',escHtml(pct||'—'),{chico:com?usdtTxt(com):''});
            datos+=dato('Recibiste','<span class="cifra sube" style="font-size:24px;font-weight:760">'+usdtTxt(neto)+'</span>',
                {rotFuerte:true,estilo:'border-top:1px solid var(--linea);margin-top:4px;padding-top:12px'});
            if(neto>0)datos+=dato('Te sale cada uno a',dinero(roundMoney((Number(rec.monto)||0)/neto,3),mon));
            if(!elim){
                const l=(AppState.datos.lotes||[]).find(x=>String(x.id)===String(rec.id)&&!x.manual);
                if(l)datos+=dato('En tu inventario',l.disponible>0.0049?'quedan '+usdtTxt(l.disponible)+' de este lote':'ya se vendieron todos');
            }
        }
    }else if(tipo==='ingreso'||tipo==='egreso'){
        const cuenta=it.cuentas[0]||'';
        cifra=montoEnCuenta(tipo==='ingreso'?rec.monto:-rec.monto,cuenta,{signo:tipo==='ingreso'});
        cifraClase=tipo==='ingreso'?'sube':'';
        donde=(tipo==='ingreso'?'Entraron a ':'Salieron de ')+nom(cuenta)+' '+escHtml(cuando);
        datos+=dato('Categoría',escHtml(rec.descripcion||'sin categoría'));
        if(rec.nota)datos+=dato('Nota',escHtml(rec.nota));
        if(cuenta==='USDT'&&tipo==='ingreso'&&rec.tasaRef>0)datos+=dato('Te salió cada uno a',dinero(rec.tasaRef,'UYU'));
        if(cuenta==='USDT'&&tipo==='egreso'&&!elim&&rec.valorUYU>0)datos+=dato('Lo que te habían costado',dinero(rec.valorUYU,'UYU'));
    }else if(tipo==='transferencia'){
        if(ent==='conversiones'){
            const mo=rec.monedaOrigen||monedaDeCuenta(rec.origen),md=rec.monedaDestino||monedaDeCuenta(rec.destino);
            cifra=dinero(rec.montoOrigen,mo);
            donde='De '+nom(rec.origen)+' a '+nom(rec.destino)+', '+escHtml(cuando);
            datos+=dato('Salieron',dinero(rec.montoOrigen,mo));
            datos+=dato('Entraron',dinero(rec.montoDestino,md));
            datos+=dato('Tasa',escHtml(fmtNum(rec.tasa,rec.tasa<10?3:2))+' por dólar');
        }else{
            const mo=monedaDeCuenta(rec.origen);
            cifra=dinero(rec.monto,mo);
            donde='De '+nom(rec.origen)+' a '+nom(rec.destino)+', '+escHtml(cuando);
            datos+=dato('Monto',dinero(rec.monto,mo));
            datos+=dato('Comisión',(Number(rec.comision)||0)>0?dinero(rec.comision,mo):'sin comisión');
        }
    }else if(tipo==='lote'){
        cifra=usdtTxt(rec.cantidad,{signo:true});cifraClase='sube';
        donde='Cargados a mano para el '+escHtml(fmtFechaCorta(rec.fecha||''));
        datos+=dato('Te salió cada uno a',dinero(rec.precioCompra,rec.moneda||'UYU'));
    }else{
        const mo=monedaDeCuenta(rec.cuenta);
        cifra=dinero(rec.delta,mo,{signo:true});
        donde='En '+nom(rec.cuenta)+', '+escHtml(cuando);
        datos+=dato('Diferencia',dinero(rec.delta,mo,{signo:true}));
        datos+=dato('Motivo',escHtml(rec.motivo||'sin motivo'));
    }

    let html=cabHoja(titulo,{chico:true})+'<div class="hoja-cuerpo">'+
        '<div class="det-cifra cifra '+cifraClase+' '+tamCifra(cifra,11,14)+'">'+escHtml(cifra)+'</div>'+
        '<div class="det-donde">'+donde+'</div>'+
        '<div class="corte"></div>'+datos;
    if(!elim){
        const cc=cambiosDeCuentas(ent,rec);
        if(cc.length){
            html+='<div class="corte" style="margin:14px 0 16px"></div><h3 class="h3">Cómo cambió cada cuenta</h3><div class="det-cuentas">'+
                cc.map(x=>mono(x.c)+'<span>'+escHtml(nombreCuenta(x.c))+'</span><span><span class="tenue">'+escHtml(montoEnCuenta(x.a,x.c,{unidad:false}))+' → </span><b>'+escHtml(montoEnCuenta(x.d,x.c,{unidad:false}))+'</b></span>').join('')+'</div>';
        }
    }
    const lc=lineasDeCambios(ent,rec);
    if(lc.length){
        html+='<h3 class="h3" style="margin-top:26px">Cambios</h3><ol class="det-cambios">'+
            lc.map(l=>'<li><span>'+escHtml(l.cuando)+'</span><span>'+escHtml(l.t)+'</span></li>').join('')+'</ol>';
    }
    html+='</div>';
    const fem=!(ent==='movimientos'||ent==='lotes');
    if(elim){
        const hasta=isoAUY(new Date(Date.parse(elim.t)+ELIMINADOS_DIAS*86400000).toISOString());
        html+='<div class="hoja-pie"><button type="button" class="btn" data-a="recuperar" data-k="'+escHtml(elim.k)+'">'+ico('restaurar')+'Recuperar</button>'+
            '<div class="nota-pie">Se borró '+escHtml(cuandoIso(elim.t).toLowerCase())+'. Queda en Eliminados hasta el '+escHtml(hasta?fmtFechaCorta(hasta.fecha):'')+'.</div></div>';
    }else{
        html+='<div class="hoja-pie"><div class="botones-2">'+
            '<button type="button" class="btn" data-a="editar">'+ico('editar')+'Editar</button>'+
            '<button type="button" class="btn peligro" data-a="eliminar">'+ico('borrar')+'Eliminar</button></div>'+
            '<div class="nota-pie">Si '+(fem?'la':'lo')+' eliminás, queda en Eliminados y '+(fem?'la':'lo')+' podés recuperar.</div></div>';
    }
    return html;
}

ACC['editar']=t=>{
    const c=capaDe(t);if(!c)return;
    const ent=c.ent,id=c.id;
    if(ent==='operaciones')abrirOperacion({id,reemplazar:true});
    else if(ent==='movimientos')abrirMovimiento({id,reemplazar:true});
    else if(ent==='transferencias'||ent==='conversiones')abrirTransferencia({id,ent,reemplazar:true});
    else if(ent==='ajustesSaldo')abrirCorreccion({id,reemplazar:true});
};
const TEXTO_ELIMINADO={venta:'Se eliminó la venta',compra:'Se eliminó la compra',ingreso:'Se eliminó el ingreso',egreso:'Se eliminó el egreso',
                       transferencia:'Se eliminó la transferencia',correccion:'Se eliminó la corrección',lote:'Se eliminó el lote'};
ACC['eliminar']=async t=>{
    const c=capaDe(t);if(!c)return;
    const ent=c.ent,id=c.id;
    const rec=buscarRegistro(ent,id);if(!rec){cerrarCapa(c);return}
    const tipo=tipoDeRegistro(ent,rec);
    const r=await conConfirmacion(o=>eliminarRegistro(ent,id,o),{titulo:'¿Eliminar igual?',si:'Eliminar igual'});
    if(r.ok){
        cerrarCapa(c);
        avisar(ent==='conversiones'?'Se eliminó la conversión':(TEXTO_ELIMINADO[tipo]||'Se eliminó'),{deshacer:()=>recuperarEliminado(r.clave)});
    }else if(!r.cancelado)avisar(r.error||'No se pudo eliminar.',{error:true});
};
