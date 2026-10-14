/* ═══════════════════════════════════════════════════════════════════════════
   §18 — BASE DE LA PANTALLA (v8.0.0)
   ═══════════════════════════════════════════════════════════════════════════
   Lo que usan todas las pantallas: íconos, formato de dinero y fechas, las
   hojas que suben desde abajo, las vistas a pantalla completa, los diálogos,
   el aviso con "Deshacer", las pestañas y el botón atrás del teléfono.

   Cada pantalla se dibuja a partir de los datos. actualizarVista() redibuja la
   pestaña visible y las capas abiertas. Los formularios no se redibujan
   enteros, porque se perdería lo que se está escribiendo: solo actualizan las
   partes que dependen de los datos, como el saldo de cada cuenta. */

/* ─── Íconos ───────────────────────────────────────────────────────────── */
const ICONOS={
    inicio:'M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
    registro:'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4',
    cuentas:'M3 10h18M4 10V9l8-5 8 5v1M6 10v7M10 10v7M14 10v7M18 10v7M3 20h18',
    mas:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    sumar:'M12 5v14M5 12h14',
    cerrar:'M6 6l12 12M18 6L6 18',
    volver:'M15 18l-6-6 6-6',
    sig:'M9 6l6 6-6 6',
    abajo:'M6 9l6 6 6-6',
    compra:'M12 3v12M7 10l5 5 5-5M5 21h14',
    venta:'M12 15V3M7 8l5-5 5 5M5 21h14',
    ingreso:'M12 6v12M6 12h12',
    egreso:'M6 12h12',
    transf:'M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8',
    corregir:'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    reloj:'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
    editar:'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z',
    lapiz:'M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z',
    borrar:'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6',
    papelera:'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6',
    buscar:'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
    campana:'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
    ok:'M5 12.5l4.5 4.5L19 7.5',
    flecha:'M5 12h14M13 6l6 6-6 6',
    resumen:'M4 19V10M10 19V5M16 19v-6M22 19H2',
    calendario:'M3 6a2 2 0 012-2h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6zm0 4h18M8 2v4M16 2v4',
    torta:'M21 15.5A9 9 0 118.5 3v9h9a9 9 0 013.5 3.5zM20.9 9.5A9 9 0 0014.5 3.1V9.5h6.4z',
    escudo:'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
    exportar:'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M12 3v13M7 8l5-5 5 5',
    importar:'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M12 16V3M7 11l5 5 5-5',
    restaurar:'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
    archivar:'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
    caja:'M3 8l9-5 9 5v8l-9 5-9-5V8zm0 0l9 5 9-5M12 13v8',
    porcentaje:'M19 5L5 19M6.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM17.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    etiqueta:'M20.6 13.4L12 22l-9-9V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01',
    salir:'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
    alerta:'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z',
    info:'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
    wifi:'M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01M2 9a15 15 0 0120 0',
    unir:'M8 3v6a4 4 0 004 4h0a4 4 0 014 4v4M16 3v6M8 21v-4'
};
function ico(n,cls){
    return '<svg class="i'+(cls?' '+cls:'')+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(ICONOS[n]||'')+'"/></svg>';
}

/* ─── Dinero ───────────────────────────────────────────────────────────── */
const MENOS='−';
/* Signo menos pegado al número: sin esto, en una frase larga el signo podía
   quedar al final de un renglón y el importe en el siguiente */
const MENOS_PEGADO=MENOS+'\u2060';
/* $1.039,07 · US$800,00 · con signo: +$335,58 · −$320,00 */
function dinero(n,moneda,o){
    o=o||{};n=Number(n)||0;
    const dec=o.dec===undefined?2:o.dec;
    const txt=(moneda==='USD'?'US$':'$')+fmtNum(Math.abs(n),dec);
    const lim=dec===0?0.5:0.005;
    if(o.signo)return(n>=lim?'+':n<=-lim?MENOS_PEGADO:'')+txt;
    return(n<=-lim?MENOS_PEGADO:'')+txt;
}
/* USDT: siempre truncado a centésimos, como el inventario */
function usdtTxt(n,o){
    o=o||{};n=Number(n)||0;
    const t=fmtTrunc(Math.abs(n),2)+(o.unidad===false?'':' USDT');
    if(o.signo)return(n>=0.005?'+':n<=-0.005?MENOS_PEGADO:'')+t;
    return(n<=-0.005?MENOS_PEGADO:'')+t;
}
function montoEnCuenta(n,cuenta,o){return cuenta==='USDT'?usdtTxt(n,o):dinero(n,monedaDeCuenta(cuenta),o)}
function pctTxt(n){return formateador(2,3).format(Number(n||0))+' %'}
/* Tamaño de los números grandes según el largo, para que entren en el teléfono */
function tamCifra(txt,l,xl){const n=String(txt).length;return n>=xl?'xl':n>=l?'l':''}
/* Texto que se tipeó en un campo de monto, ya formateado: 15000 → 15.000 */
function formatoCampo(n){
    n=Number(n)||0;
    const entero=Math.abs(n-Math.round(n))<1e-9;
    return fmtNum(n,entero?0:2);
}

/* ─── Fechas ───────────────────────────────────────────────────────────── */
const DIAS_LARGO=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const DIAS_LETRA=['D','L','M','X','J','V','S'];
function fechaObj(f){const p=String(f||'').split('-');return new Date(+p[0],(+p[1]||1)-1,+p[2]||1,12)}
function fechaStr(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function sumarDias(f,n){const d=fechaObj(f);d.setDate(d.getDate()+n);return fechaStr(d)}
function sumarMeses(mes,n){const p=mes.split('-');const d=new Date(+p[0],+p[1]-1+n,1,12);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')}
function diasDelMes(mes){const p=mes.split('-');return new Date(+p[0],+p[1],0).getDate()}
function mayus(s){s=String(s||'');return s.charAt(0).toUpperCase()+s.slice(1)}
function nombreMesLargo(mes){return mayus(nombreMes(mes))}
/* "Hoy, miércoles 14" · "Ayer, martes 13" · "Lunes 12" · "Viernes 9 de septiembre" */
function tituloDia(f){
    const hoy=getUDateStr(),d=fechaObj(f),nom=DIAS_LARGO[d.getDay()];
    if(f===hoy)return'Hoy, '+nom+' '+d.getDate();
    if(f===sumarDias(hoy,-1))return'Ayer, '+nom+' '+d.getDate();
    let t=mayus(nom)+' '+d.getDate();
    if(f.slice(0,7)!==hoy.slice(0,7))t+=' de '+_MESES_LARGO[d.getMonth()];
    if(f.slice(0,4)!==hoy.slice(0,4))t+=' de '+d.getFullYear();
    return t;
}
/* "hoy a las 12:40" · "ayer a las 9:10" · "el lunes 12 a las 10:05" */
function cuandoTexto(f,h){
    const hoy=getUDateStr(),d=fechaObj(f);
    const hora=h?' a las '+h:'';
    if(f===hoy)return'hoy'+hora;
    if(f===sumarDias(hoy,-1))return'ayer'+hora;
    let t='el '+DIAS_LARGO[d.getDay()]+' '+d.getDate();
    if(f.slice(0,7)!==hoy.slice(0,7))t+=' de '+_MESES_LARGO[d.getMonth()];
    if(f.slice(0,4)!==hoy.slice(0,4))t+=' de '+d.getFullYear();
    return t+hora;
}
/* "Hoy 12:58" · "Ayer 09:10" · "12/10 18:00" */
function cuandoCorto(f,h){
    const hoy=getUDateStr();
    let t;
    if(f===hoy)t='Hoy';
    else if(f===sumarDias(hoy,-1))t='Ayer';
    else{const p=f.split('-');t=p[2]+'/'+p[1]+(p[0]!==hoy.slice(0,4)?'/'+p[0].slice(2):'')}
    return h?t+' '+h:t;
}
/* Una marca ISO pasada a fecha y hora de Uruguay */
function isoAUY(iso){
    const d=new Date(iso);
    if(isNaN(d.getTime()))return null;
    const u=new Date(d.getTime()-3*3600000);
    const f=u.getUTCFullYear()+'-'+String(u.getUTCMonth()+1).padStart(2,'0')+'-'+String(u.getUTCDate()).padStart(2,'0');
    const h=String(u.getUTCHours()).padStart(2,'0')+':'+String(u.getUTCMinutes()).padStart(2,'0');
    return{fecha:f,hora:h};
}
function cuandoIso(iso){const x=isoAUY(iso);return x?cuandoCorto(x.fecha,x.hora):''}

/* ─── Cuentas ──────────────────────────────────────────────────────────── */
/* Monograma de color: la sigla del banco, o ₮ para USDT */
function mono(cuenta,grande){
    const cls='mono'+(grande?' m':'');
    if(cuenta==='USDT')return'<span class="'+cls+' usdt" aria-hidden="true">₮</span>';
    const b=getBancoInfo(cuenta);
    const sig=(b&&b.sigla)||String(cuenta||'?').slice(0,2).toUpperCase();
    return'<span class="'+cls+'" style="background:'+((b&&b.color)||'#445066')+'" aria-hidden="true">'+escHtml(sig)+'</span>';
}
function saldoDe(cuenta){
    if(cuenta==='USDT')return roundMoney(AppState.datos.saldoUsdt||0);
    const bk=AppState.datos.bancos[cuenta];
    return roundMoney((bk&&bk.saldo)||0);
}
/* Cuentas para mostrar: las activas y las desactivadas que tienen plata */
function cuentasVisibles(){
    return ordenarBancosPorSaldo(CONFIG.BANCOS.filter(b=>{
        const bk=AppState.datos.bancos[b.nombre];
        return bk&&(bk.activo||Math.abs(bk.saldo||0)>=0.005);
    }));
}
/* Cupo diario de una cuenta: cuánto queda hoy, en dólares */
function infoCupo(cuenta){
    const bk=AppState.datos.bancos[cuenta];
    if(!bk||!(bk.limiteDiarioUSD>0))return null;
    const lim=roundMoney(bk.limiteDiarioUSD);
    const disp=Math.max(0,roundMoney(cupoDisponibleUSD(cuenta)));
    const usado=Math.max(0,Math.min(lim,roundMoney(lim-disp)));
    return{lim,disp,usado,pct:lim>0?Math.round(usado/lim*1000)/10:0};
}
const _DIAS_PLURAL=['domingos','lunes','martes','miércoles','jueves','viernes','sábados'];
function textoRenovacion(cuenta){
    const d=getDiasReset(cuenta).slice();
    if(d.length>=7)return'Se renueva todos los días a las 0:30.';
    /* En orden de semana empezando el lunes */
    const orden=[1,2,3,4,5,6,0].filter(x=>d.includes(x));
    const pos=orden.map(x=>(x+6)%7);
    const seguidos=pos.every((p,i)=>i===0||p===pos[i-1]+1);
    if(seguidos&&orden.length>=3)return'Se renueva de '+DIAS_LARGO[orden[0]]+' a '+DIAS_LARGO[orden[orden.length-1]]+' a las 0:30.';
    const nombres=orden.map(x=>_DIAS_PLURAL[x]);
    const lista=nombres.length>1?nombres.slice(0,-1).join(', ')+' y '+nombres[nombres.length-1]:nombres[0];
    return'Se renueva los '+lista+' a las 0:30.';
}

/* ─── Capas: hojas, vistas y diálogos ──────────────────────────────────── */
/* La pila de lo que está abierto. Cada capa: {el, cont, def}. def trae:
   tipo ('hoja' | 'vista' | 'dialogo'), clase, etiqueta, html, montar(cont,capa),
   actualizar(cont,capa) y alCerrar(capa). */
const _capas=[];
/* Botón atrás del teléfono: mientras haya algo abierto (o una pestaña que no
   sea Inicio) hay una entrada en el historial; al tocar atrás se cierra lo de
   arriba en vez de salir de la app. */
let _histArmada=false,_ignorarPop=0;
function _armarHistoria(){
    if(_histArmada)return;
    try{history.pushState({p2p:1},'');_histArmada=true}catch(_){}
}
function _desarmarHistoria(){
    if(!_histArmada)return;
    _histArmada=false;_ignorarPop++;
    try{history.back()}catch(_){_ignorarPop--}
}
function capaDe(el){return _capas.find(c=>c.el.contains(el))||null}

function abrirCapa(def){
    if(def.reemplazar&&_capas.length)_quitarCapa(_capas.length-1,true);
    const el=document.createElement('div');
    el.className='capa capa-'+def.tipo;
    const et=escHtml(def.etiqueta||'');
    if(def.tipo==='vista')el.innerHTML='<section class="vista '+(def.clase||'')+'" aria-label="'+et+'"></section>';
    else if(def.tipo==='dialogo')el.innerHTML='<div class="fondo"></div><section class="dialogo" role="alertdialog" aria-modal="true" aria-label="'+et+'"></section>';
    else el.innerHTML='<div class="fondo" data-a="cerrar-capa"></div><section class="hoja '+(def.clase||'')+'" role="dialog" aria-modal="true" aria-label="'+et+'"></section>';
    const cont=el.lastElementChild;
    cont.innerHTML=def.html||'';
    cont.setAttribute('tabindex','-1');
    $('capas').appendChild(el);
    const capa={el,cont,def,foco:document.activeElement};
    _capas.push(capa);
    document.documentElement.classList.add('con-capa');
    _armarHistoria();
    if(def.montar){
        try{def.montar(cont,capa)}catch(e){console.error('[P2P] capa',e)}
    }
    try{cont.focus({preventScroll:true})}catch(_){}
    posicionarAviso();
    return capa;
}
function _quitarCapa(i,porReemplazo){
    const c=_capas[i];if(!c)return;
    _capas.splice(i,1);
    if(c.def.alCerrar){try{c.def.alCerrar(c)}catch(e){console.error('[P2P] capa',e)}}
    c.el.remove();
    if(!_capas.length)document.documentElement.classList.remove('con-capa');
    posicionarAviso();
    if(!porReemplazo&&c.foco&&document.contains(c.foco)){try{c.foco.focus({preventScroll:true})}catch(_){}}
}
function cerrarCapa(capa){
    const i=capa?_capas.indexOf(capa):_capas.length-1;
    if(i<0)return;
    _quitarCapa(i);
    if(!_capas.length&&AppState.ui.tab==='inicio')_desarmarHistoria();
}
function cerrarTodasLasCapas(){
    while(_capas.length)_quitarCapa(_capas.length-1);
    if(AppState.ui.tab==='inicio')_desarmarHistoria();
}
window.addEventListener('popstate',()=>{
    if(_ignorarPop>0){_ignorarPop--;return}
    _histArmada=false;
    if(_capas.length){
        _quitarCapa(_capas.length-1);
        if(_capas.length||AppState.ui.tab!=='inicio')_armarHistoria();
        return;
    }
    if(AppState.ui.tab!=='inicio')irATab('inicio',{sinHistoria:true});
});

/* Encabezados comunes */
function cabHoja(titulo,o){
    o=o||{};
    return'<div class="hoja-cab"><div class="manija"></div><div class="hoja-titulo">'+
        (o.izquierda||'<h2'+(o.chico?' class="chico"':'')+'>'+escHtml(titulo)+'</h2>')+
        '<button type="button" class="cerrar" data-a="cerrar-capa" aria-label="Cerrar">'+ico('cerrar')+'</button></div></div>';
}
function cabVista(titulo,o){
    o=o||{};
    return'<header class="vista-cab"><button type="button" class="atras" data-a="cerrar-capa" aria-label="Volver">'+ico('volver')+'</button>'+
        (o.centro||((o.mono||'')+'<h1>'+escHtml(titulo)+'</h1>'))+(o.derecha||'')+'</header>';
}

/* ─── Aviso de abajo ───────────────────────────────────────────────────── */
let _avisoTimer=0,_avisoDeshacer=null;
function avisar(texto,o){
    o=o||{};
    const el=$('aviso');if(!el)return;
    _avisoDeshacer=o.deshacer||null;
    el.className='aviso'+(o.error?' error':'');
    el.setAttribute('role',o.error?'alert':'status');
    el.innerHTML='<span>'+escHtml(texto)+'</span>'+(o.deshacer?'<button type="button" data-a="aviso-deshacer">Deshacer</button>':'');
    posicionarAviso();
    void el.offsetWidth;
    el.classList.add('ver');
    clearTimeout(_avisoTimer);
    _avisoTimer=setTimeout(()=>{el.classList.remove('ver');_avisoDeshacer=null},o.deshacer?7000:o.error?5500:3200);
}
/* Con una hoja abierta, el aviso va justo arriba de sus botones, sin taparlos */
function posicionarAviso(){
    const el=$('aviso');if(!el)return;
    const c=_capas[_capas.length-1];
    const pie=c&&c.cont.querySelector('.hoja-pie');
    el.style.bottom=pie?Math.round(pie.getBoundingClientRect().height+12)+'px':'';
}
function ocultarAviso(){clearTimeout(_avisoTimer);$('aviso')?.classList.remove('ver');_avisoDeshacer=null}

/* ─── Diálogo: una pregunta con dos respuestas ─────────────────────────── */
function preguntar(o){
    return new Promise(res=>{
        let resp=false;
        abrirCapa({tipo:'dialogo',etiqueta:o.titulo,
            html:'<h2>'+escHtml(o.titulo)+'</h2>'+(o.texto?'<p>'+escHtml(o.texto)+'</p>':'')+
                 '<div class="botones"><button type="button" class="btn'+(o.peligro?' rojo':'')+'" data-a="dlg-si">'+escHtml(o.si||'Aceptar')+'</button>'+
                 (o.no===false?'':'<button type="button" class="btn gris" data-a="dlg-no">'+escHtml(o.no||'Cancelar')+'</button>')+'</div>',
            montar(cont,capa){capa.responder=v=>{resp=v;cerrarCapa(capa)}},
            alCerrar(){res(resp)}
        });
    });
}
/* Guardar con la regla del motor: si devuelve {confirmar}, se pregunta y, si
   la persona acepta, se vuelve a llamar con {forzar:true}. */
async function conConfirmacion(fn,o){
    o=o||{};
    let r=fn({});
    if(r&&r.confirmar){
        const si=await preguntar({titulo:o.titulo||'¿Guardar igual?',texto:r.confirmar,si:o.si||'Guardar igual',no:'Volver'});
        if(!si)return{ok:false,cancelado:true};
        r=fn({forzar:true});
    }
    return r||{ok:false,error:'No se pudo guardar.'};
}

/* ─── Acciones: un solo escuchador para toda la app ────────────────────── */
/* Cada botón dice qué hace con data-a="nombre"; cada campo, con data-in. */
const ACC={},ENT={};
document.addEventListener('click',e=>{
    const t=e.target.closest('[data-a]');if(!t)return;
    if(t.disabled||t.getAttribute('aria-disabled')==='true')return;
    const fn=ACC[t.dataset.a];if(!fn)return;
    e.preventDefault();
    try{fn(t,e)}catch(err){console.error('[P2P] acción '+t.dataset.a,err);avisar('Algo falló. Probá de nuevo.',{error:true})}
});
document.addEventListener('input',e=>{
    const t=e.target,k=t&&t.dataset&&t.dataset.in;
    if(k&&ENT[k]){try{ENT[k](t,e)}catch(err){console.error('[P2P] campo '+k,err)}}
});
document.addEventListener('change',e=>{
    const t=e.target,k=t&&t.dataset&&t.dataset.ch;
    if(k&&ENT[k]){try{ENT[k](t,e)}catch(err){console.error('[P2P] campo '+k,err)}}
});
document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&_capas.length){e.preventDefault();cerrarCapa();return}
    /* Enter en un campo de un formulario = tocar su botón principal */
    if(e.key==='Enter'&&e.target&&e.target.tagName==='INPUT'&&e.target.type!=='search'){
        const c=capaDe(e.target);
        const b=c&&c.cont.querySelector('[data-primario]');
        if(b&&!b.disabled){e.preventDefault();e.target.blur();b.click()}
    }
});
ACC['cerrar-capa']=t=>cerrarCapa(capaDe(t));
ACC['dlg-si']=t=>{const c=capaDe(t);if(c&&c.responder)c.responder(true)};
ACC['dlg-no']=t=>{const c=capaDe(t);if(c&&c.responder)c.responder(false)};
ACC['aviso-deshacer']=()=>{const f=_avisoDeshacer;ocultarAviso();if(f)f()};
ACC['sync']=()=>{
    const s=AppState.ui.syncState;
    if(s==='offline'||s==='reconnecting'){reconnectFirebase();return}
    avisar(s==='online'?'Todo está guardado en tu cuenta.':'Guardando tus cambios…');
};
ACC['tab']=t=>{cerrarTodasLasCapas();irATab(t.dataset.tab)};

/* ─── Pestañas ─────────────────────────────────────────────────────────── */
const TABS=['inicio','registro','cuentas','mas'];
const PANTALLAS={};   /* pestaña → {pintar()} — las registra cada archivo de pantalla */
function irATab(tab,o){
    o=o||{};
    if(!TABS.includes(tab))tab='inicio';
    const antes=AppState.ui.tab;
    AppState.ui.tab=tab;
    TABS.forEach(t=>{const s=$('p'+mayus(t));if(s)s.hidden=t!==tab});
    document.querySelectorAll('.tabs .tab').forEach(b=>{
        if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
    });
    if(!o.sinHistoria){
        if(tab==='inicio'){if(!_capas.length)_desarmarHistoria()}
        else _armarHistoria();
    }
    /* Otra pestaña: arriba de todo. La misma otra vez: sube suave, como en
       cualquier app del teléfono. */
    if(antes!==tab)window.scrollTo(0,0);
    else if(!o.sinHistoria&&window.scrollY>0){try{window.scrollTo({top:0,behavior:'smooth'})}catch(_){window.scrollTo(0,0)}}
    pintarTab();
}
function pintarTab(){
    const p=PANTALLAS[AppState.ui.tab];
    if(p){try{p.pintar()}catch(e){console.error('[P2P] pantalla '+AppState.ui.tab,e)}}
}
function pintarCabecera(){
    const d=fechaObj(getUDateStr());
    setText('inicioFecha',mayus(DIAS_LARGO[d.getDay()])+' '+d.getDate()+' de '+_MESES_LARGO[d.getMonth()]);
}
/* Redibuja lo que se ve. La llaman el motor después de cada cambio y la
   sincronización cuando llegan datos de otro dispositivo. */
function actualizarVista(){
    if(!AppState.datos)return;
    pintarCabecera();
    pintarTab();
    _capas.slice().forEach(c=>{
        if(c.def.actualizar&&c.el.isConnected){
            try{c.def.actualizar(c.cont,c)}catch(e){console.error('[P2P] capa',e)}
        }
    });
}

/* ─── Registros como filas ─────────────────────────────────────────────── */
/* Todo lo que se puede cargar se muestra igual: hora, qué fue, cuánto, en qué
   cuenta y un dato extra a la derecha (la ganancia de una venta, los USDT de
   una compra). Esto lo usan el inicio, el registro y el libro de cada cuenta. */
function tipoDeRegistro(ent,rec){
    if(ent==='operaciones')return rec.tipo==='venta'?'venta':'compra';
    if(ent==='movimientos')return rec.tipoMovimiento==='ingreso'?'ingreso':'egreso';
    if(ent==='transferencias'||ent==='conversiones')return'transferencia';
    return'correccion';
}
function cuentasDeRegistro(ent,rec){
    if(ent==='operaciones')return aportesDe(rec).map(a=>a.banco);
    if(ent==='movimientos')return[rec.tipoCuenta==='usdt'?'USDT':rec.banco];
    if(ent==='transferencias'||ent==='conversiones')return[rec.origen,rec.destino];
    if(ent==='ajustesSaldo')return[rec.cuenta];
    return[];
}
function fueEditado(rec){
    return Array.isArray(rec&&rec.cambios)&&rec.cambios.some(c=>c&&Array.isArray(c.c)&&c.c.some(x=>x&&x[0]!=='recuperado'));
}
function tituloCategoria(desc,porDefecto){return desc?mayus(desc):porDefecto}
function itemRegistro(ent,rec){
    const tipo=tipoDeRegistro(ent,rec);
    const it={ent,id:rec.id,rec,tipo,fecha:rec.fecha||'',hora:rec.hora||'',clave:_claveOrden(rec),
              cuentas:cuentasDeRegistro(ent,rec).filter(Boolean)};
    const monos=it.cuentas.map(c=>mono(c)).join('');
    const lapiz=fueEditado(rec)?'<span class="marca" title="Editado">'+ico('lapiz')+'</span>':'';
    let buscable='';
    if(tipo==='venta'||tipo==='compra'){
        const mon=rec.moneda||'UYU';
        it.titulo=tipo==='venta'?'Venta USDT':'Compra USDT';
        it.sub=monos+'<span>a '+escHtml(fmtTasaMon(rec.tasa,mon))+'</span>'+
            (isFinite(rec.comisionPct)?'<span class="marca" title="Comisión de Binance">'+escHtml(pctTxt(rec.comisionPct))+'</span>':'')+lapiz;
        if(tipo==='venta'){
            it.montoTxt=dinero(rec.monto,mon,{signo:true});it.montoClase='sube';
            const g=Number(rec.ganancia)||0;
            it.derTxt=(g>=-0.004?'ganancia ':'pérdida ')+dinero(Math.abs(g),mon);
            it.derClase=g>=-0.004?'sube':'baja';
        }else{
            it.montoTxt=dinero(-(roundMoney((Number(rec.monto)||0)+(Number(rec.comisionBanco)||0))),mon);
            it.derTxt=usdtTxt(usdtNeto(Number(rec.usdt)||0,Number(rec.comisionPlataforma)||0,'compra'),{signo:true});
        }
        buscable=[it.titulo,fmtNum(rec.monto),fmtTasa(rec.tasa,mon),String(rec.monto)].join(' ');
    }else if(tipo==='ingreso'||tipo==='egreso'){
        const cuenta=it.cuentas[0]||'';
        it.titulo=tituloCategoria(rec.descripcion,tipo==='ingreso'?'Ingreso':'Egreso');
        it.montoTxt=montoEnCuenta(tipo==='ingreso'?rec.monto:-rec.monto,cuenta,{signo:tipo==='ingreso'});
        it.montoClase=tipo==='ingreso'?'sube':'';
        it.sub=monos+'<span>'+escHtml(rec.nota?rec.nota:(tipo==='ingreso'?'Ingreso':'Egreso'))+'</span>'+lapiz;
        buscable=[tipo,rec.descripcion,rec.nota,fmtNum(rec.monto),String(rec.monto)].join(' ');
    }else if(tipo==='transferencia'){
        const mo=monedaDeCuenta(rec.origen);
        it.sub=mono(rec.origen)+ico('flecha')+mono(rec.destino)+lapiz;
        if(ent==='conversiones'){
            it.titulo='Conversión';
            it.montoTxt=dinero(rec.montoOrigen,rec.monedaOrigen||mo);
            it.derTxt='entran '+dinero(rec.montoDestino,rec.monedaDestino||monedaDeCuenta(rec.destino));
            buscable=['conversión',fmtNum(rec.montoOrigen),String(rec.montoOrigen)].join(' ');
        }else{
            it.titulo='Transferencia';
            it.montoTxt=dinero(rec.monto,mo);
            it.derTxt=(Number(rec.comision)||0)>0?'comisión '+dinero(rec.comision,mo):'entre tus cuentas';
            buscable=['transferencia',fmtNum(rec.monto),String(rec.monto)].join(' ');
        }
    }else{
        const cuenta=rec.cuenta||'';
        it.titulo='Corrección de saldo';
        it.montoTxt=dinero(rec.delta,monedaDeCuenta(cuenta),{signo:true});
        it.sub=mono(cuenta)+'<span>'+escHtml(rec.motivo||'sin motivo')+'</span>'+lapiz;
        buscable=['corrección',rec.motivo,fmtNum(Math.abs(rec.delta||0)),String(Math.abs(rec.delta||0))].join(' ');
    }
    it.buscable=tagKey(buscable+' '+it.cuentas.map(nombreCuenta).join(' '));
    return it;
}
function filaRegistroHtml(it,o){
    o=o||{};
    const der=o.derTxt!==undefined?o.derTxt:it.derTxt;
    const derClase=o.derTxt!==undefined?(o.derClase||''):(it.derClase||'');
    return'<button type="button" class="fila" data-a="detalle" data-ent="'+it.ent+'" data-id="'+escHtml(it.id)+'">'+
        '<span class="hora">'+escHtml(it.hora)+'</span>'+
        '<span class="fila-t">'+escHtml(o.titulo||it.titulo)+'</span>'+
        '<span class="fila-m '+(o.montoClase!==undefined?o.montoClase:(it.montoClase||''))+'">'+escHtml(o.montoTxt||it.montoTxt)+'</span>'+
        '<span class="fila-s">'+(o.sub!==undefined?o.sub:it.sub)+'</span>'+
        (der?'<span class="fila-ms '+derClase+'">'+escHtml(der)+'</span>':'')+
    '</button>';
}
/* Todos los registros en una sola lista, de lo más nuevo a lo más viejo */
let _itemsCache={clave:null,items:[]};
function invalidarItems(){_itemsCache.clave=null}
function itemsDelRegistro(){
    const clave=_gananciaCacheKey('_items')+'|'+ENTIDADES_REGISTRO.map(e=>listaDe(e).length).join(',');
    if(_itemsCache.clave===clave)return _itemsCache.items;
    const items=[];
    ENTIDADES_REGISTRO.forEach(ent=>listaDe(ent).forEach(rec=>{if(rec)items.push(itemRegistro(ent,rec))}));
    items.sort((a,b)=>a.clave>b.clave?-1:a.clave<b.clave?1:0);
    _itemsCache={clave,items};
    return items;
}
/* Neto de un registro sobre un conjunto de cuentas, por moneda. Lo que pasa
   entre dos cuentas propias se compensa solo: una transferencia aporta solo
   su comisión. */
function netoPorMoneda(it,cuentas){
    const ef=efectoEnBancos(it.ent,it.rec);
    const r={};
    Object.entries(ef).forEach(([c,v])=>{
        if(cuentas&&!cuentas.includes(c))return;
        const m=monedaDeCuenta(c);
        r[m]=roundMoney((r[m]||0)+v);
    });
    return r;
}
/* Ganancia de un registro, con el mismo criterio que la ganancia del día:
   operaciones en pesos (una compra con comisión del banco resta) y egresos */
function gananciaDeItem(it){
    if(it.ent==='operaciones'&&(it.rec.moneda||'UYU')!=='USD')return Number(it.rec.ganancia)||0;
    if(it.ent==='movimientos'&&it.rec.tipoMovimiento==='egreso')return-movimientoValorUYU(it.rec);
    return 0;
}
