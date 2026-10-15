/* ═══════════════════════════════════════════════════════════════════════════
   §23 — MÁS: ANÁLISIS, TUS DATOS Y AJUSTES (v8.0.0)
   ═══════════════════════════════════════════════════════════════════════════
   Resumen del mes, calendario de ganancias, egresos por categoría, la
   verificación de que todo cuadre, copias de seguridad, archivo de meses
   viejos, comisión de Binance, categorías y novedades. */
PANTALLAS.mas={pintar:pintarMas};

function opc(accion,icono,texto,o){
    o=o||{};
    return'<button type="button" class="opc'+(o.peligro?' peligro':'')+'" data-a="'+accion+'"'+(o.datos||'')+'>'+ico(icono)+
        '<span class="t">'+escHtml(texto)+(o.sub?'<small>'+escHtml(o.sub)+'</small>':'')+'</span>'+
        (o.valor!==undefined?'<span class="v">'+o.valor+'</span>':'')+(o.sinFlecha?'':ico('sig','ch'))+'</button>';
}
function pintarMas(){
    const c=$('masCuerpo');if(!c||!AppState.datos||!AppState.currentUser)return;
    const d=AppState.datos;
    const usuario=emailToUser(AppState.currentUser.email||'');
    const g=calcularGananciaDiaria(),mes=getMesActivo();
    let gMes=0;Object.entries(g).forEach(([f,v])=>{if(f.startsWith(mes))gMes=roundMoney(gMes+v)});
    const ver=AppState.ui.verificacion;
    const meses=Object.keys((d._archivoIndex&&d._archivoIndex.meses)||{}).filter(m=>/^\d{4}-\d{2}$/.test(m));
    const verVal=ver?'<span style="display:flex;align-items:center;gap:6px;color:'+(ver.ok?'var(--sube)':'var(--baja)')+';font-weight:600"><span class="punto'+(ver.ok?'':' mal')+'"></span>'+(ver.ok?'Cuadra':'Revisar')+'</span>':undefined;
    c.innerHTML=
        '<div class="bloque usuario"><span class="avatar" aria-hidden="true">'+escHtml((usuario[0]||'U').toUpperCase())+'</span>'+
        '<div><b>'+escHtml(usuario)+'</b><span>Tus datos se guardan en tu cuenta</span></div></div>'+
        '<h2 class="grupo">Análisis</h2><div class="bloque">'+
            opc('resumen','resumen','Resumen del mes',{valor:escHtml(dinero(gMes,'UYU',{signo:true}))})+
            opc('calendario','calendario','Calendario de ganancias')+
            opc('egresos-cat','torta','Egresos por categoría')+
        '</div>'+
        '<h2 class="grupo">Tus datos</h2><div class="bloque">'+
            opc('verificar','escudo','Verificar que todo cuadre',{valor:verVal})+
            opc('exportar','exportar','Exportar una copia')+
            opc('importar','importar','Importar una copia')+
            opc('copias','restaurar','Copias automáticas',{sub:'Las 3 últimas, en este teléfono'})+
            opc('archivar','archivar','Archivar meses anteriores')+
            (meses.length?opc('meses-archivados','caja','Meses archivados',{valor:String(meses.length)}):'')+
        '</div>'+
        '<h2 class="grupo">Ajustes</h2><div class="bloque">'+
            opc('comision','porcentaje','Comisión de Binance',{valor:escHtml(pctTxt(comisionConfigurada('UYU')))})+
            opc('categorias','etiqueta','Categorías',{valor:String((d.tags||[]).length)})+
            opc('novedades','campana','Novedades',{valor:'versión '+escHtml(CONFIG.APP_VERSION.split('.').slice(0,2).join('.'))})+
        '</div>'+
        '<div class="bloque" style="margin-top:24px">'+opc('salir','salir','Cerrar sesión',{sinFlecha:true})+'</div>'+
        '<div class="bloque" style="margin-top:12px">'+opc('borrar-todo','papelera','Borrar todos los datos',{sinFlecha:true,peligro:true})+'</div>'+
        '<p class="version">Registro P2P '+escHtml(CONFIG.APP_VERSION)+'</p>';
}

/* ─── Resumen del mes ──────────────────────────────────────────────────── */
/* Todo sale de las operaciones y los egresos del mes: la misma cuenta que la
   ganancia del día, así que los números de una pantalla y otra coinciden. */
function resumenMes(mes,ops,movs){
    const dias=diasDelMes(mes),porDia=new Array(dias).fill(0),egrDia=new Array(dias).fill(null);
    let ganOps=0,egresos=0,ganUSD=0,comUsdt=0,comPesos=0;
    const compras={n:0,monto:0,usdt:0},ventas={n:0,monto:0,usdt:0};
    (ops||[]).forEach(o=>{
        if(!o||!String(o.fecha||'').startsWith(mes))return;
        const i=(parseInt(o.fecha.slice(8,10),10)||1)-1;
        if((o.moneda||'UYU')==='USD'){ganUSD=roundMoney(ganUSD+(Number(o.ganancia)||0));return}
        const g=Number(o.ganancia)||0;
        ganOps=roundMoney(ganOps+g);porDia[i]=roundMoney(porDia[i]+g);
        const k=o.tipo==='compra'?compras:ventas;
        k.n++;k.monto=roundMoney(k.monto+(Number(o.monto)||0));k.usdt=roundMoney(k.usdt+(Number(o.usdt)||0));
        const cp=Number(o.comisionPlataforma)||0;
        comUsdt=roundMoney(comUsdt+cp);comPesos=roundMoney(comPesos+cp*(Number(o.tasa)||0));
    });
    const cats={};
    (movs||[]).forEach(m=>{
        if(!m||m.tipoMovimiento!=='egreso'||!String(m.fecha||'').startsWith(mes))return;
        const i=(parseInt(m.fecha.slice(8,10),10)||1)-1;
        const v=movimientoValorUYU(m);
        egresos=roundMoney(egresos+v);porDia[i]=roundMoney(porDia[i]-v);
        const k=m.descripcion?tagKey(m.descripcion):'';
        if(!cats[k])cats[k]={nombre:m.descripcion||'sin categoría',total:0,n:0};
        cats[k].total=roundMoney(cats[k].total+v);cats[k].n++;
        if(!egrDia[i]||v>egrDia[i].v)egrDia[i]={v,nombre:m.descripcion||'un egreso'};
    });
    return{mes,dias,porDia,egrDia,ganOps,egresos,neta:roundMoney(ganOps-egresos),ganUSD,comUsdt,comPesos,compras,ventas,
           categorias:Object.values(cats).sort((a,b)=>b.total-a.total)};
}
function mesesConDatos(){
    const s=new Set([getMesActivo()]);
    ['operaciones','movimientos'].forEach(e=>(AppState.datos[e]||[]).forEach(x=>{if(x&&x.fecha)s.add(x.fecha.slice(0,7))}));
    Object.keys((AppState.datos._archivoIndex&&AppState.datos._archivoIndex.meses)||{}).forEach(m=>{if(/^\d{4}-\d{2}$/.test(m))s.add(m)});
    return[...s].sort();
}
function mesArchivado(mes){
    const idx=AppState.datos._archivoIndex&&AppState.datos._archivoIndex.meses;
    if(!idx||!idx[mes])return false;
    return!(AppState.datos.operaciones||[]).some(o=>o&&String(o.fecha||'').startsWith(mes));
}
function navMes(mes,accion){
    const ms=mesesConDatos();
    const ant=ms.filter(m=>m<mes).pop(),sig=ms.find(m=>m>mes);
    return'<div class="mes-nav"><button type="button" data-a="'+accion+'" data-mes="'+(ant||'')+'" aria-label="Mes anterior"'+(ant?'':' disabled')+'>'+ico('volver')+'</button>'+
        '<h1>'+escHtml(nombreMesLargo(mes))+'</h1><button type="button" data-a="'+accion+'" data-mes="'+(sig||'')+'" aria-label="Mes siguiente"'+(sig?'':' disabled')+'>'+ico('sig')+'</button></div><span class="espacio-44"></span>';
}
ACC['resumen']=()=>abrirResumen(getMesActivo());
function abrirResumen(mes,o){
    o=o||{};
    abrirCapa({tipo:'vista',etiqueta:'Resumen del mes',clave:'resumen',reemplazar:!!o.reemplazar,
        montar(cont,capa){capa.mes=mes;capa.archivo={};pintarResumen(cont,capa)},
        actualizar(cont,capa){pintarResumen(cont,capa)}});
}
ACC['resumen-mes']=t=>{const c=capaDe(t);if(!c||!t.dataset.mes)return;c.mes=t.dataset.mes;pintarResumen(c.cont,c);c.cont.scrollTop=0};
function pintarResumen(cont,capa){
    const mes=capa.mes,arch=mesArchivado(mes);
    let html=cabVista('',{centro:navMes(mes,'resumen-mes')})+'<div class="vista-cuerpo">';
    let r=null;
    if(arch){
        const cargado=capa.archivo[mes];
        if(cargado)r=resumenMes(mes,cargado.ops,cargado.movimientos);
        else{
            const s=AppState.datos._archivoIndex.meses[mes]||{};
            const tG=dinero(s.ganancia||0,'UYU',{signo:true});
            html+='<section><div class="heroe-rot">Ganancia de las operaciones</div><div class="heroe-cifra cifra '+claseSigno(s.ganancia||0)+' '+tamCifra(tG,10,13)+'" style="font-size:56px">'+tG+'</div></section>'+
                '<div class="bloque datos-linea" style="padding:6px 16px;margin-top:22px">'+
                    dato('Compraste',dinero(s.montoCompras||0,'UYU'))+dato('Vendiste',dinero(s.montoVentas||0,'UYU'))+dato('Operaciones',String(s.ops||0))+'</div>'+
                '<p class="texto-ayuda">Este mes está archivado. Para ver el detalle por día, los egresos y las categorías hay que traerlo de internet.</p>'+
                '<button type="button" class="btn gris" style="margin-top:12px" data-a="resumen-cargar">Ver el detalle</button>';
            cont.innerHTML=html+'</div>';
            return;
        }
    }else r=resumenMes(mes,AppState.datos.operaciones,AppState.datos.movimientos);
    const tN=dinero(r.neta,'UYU',{signo:true});
    const hoy=getUDateStr();
    html+='<section><div class="heroe-rot">Ganancia neta del mes</div><div class="heroe-cifra cifra '+claseSigno(r.neta)+' '+tamCifra(tN,10,13)+'" style="font-size:56px">'+tN+'</div>'+
        '<div class="heroe-desglose"><span>Operaciones</span><span class="'+claseSigno(r.ganOps)+'">'+dinero(r.ganOps,'UYU',{signo:true})+'</span>'+
        '<span>Egresos</span><span>'+dinero(-r.egresos,'UYU')+'</span>'+
        (Math.abs(r.ganUSD)>=0.005?'<span>En dólares</span><span class="'+claseSigno(r.ganUSD)+'">'+dinero(r.ganUSD,'USD',{signo:true})+'</span>':'')+'</div>';
    /* Barras por día */
    const max=Math.max(1,...r.porDia.map(Math.abs));
    html+='<div class="mes-barras" style="--dias:'+r.dias+'" role="img" aria-label="Ganancia de cada día de '+escHtml(nombreMes(mes))+'">'+r.porDia.map((v,i)=>{
        const f=mes+'-'+String(i+1).padStart(2,'0');
        const h=Math.abs(v)>=0.005?Math.max(2,Math.round(Math.abs(v)/max*40)):0;
        return'<div class="col'+(f===hoy?' hoy':'')+(f>hoy?' futuro':'')+'"><div class="arr">'+(v>0&&h?'<div class="b" style="height:'+h+'px"></div>':'')+'</div><div class="eje"></div>'+
            '<div class="aba">'+(v<0&&h?'<div class="bn" style="height:'+h+'px"></div>':'')+'</div></div>';
    }).join('')+'</div>';
    const marcas=[1,8,15,22,29].filter(x=>x<=r.dias);
    html+='<div class="mes-ejes" style="--dias:'+r.dias+'">'+marcas.map(x=>'<span style="grid-column:'+x+'">'+x+'</span>').join('')+'</div></section>';
    /* Mejor y peor día */
    let mejor=-1,peor=-1;
    r.porDia.forEach((v,i)=>{if(Math.abs(v)<0.005)return;if(mejor<0||v>r.porDia[mejor])mejor=i;if(peor<0||v<r.porDia[peor])peor=i});
    if(mejor>=0){
        const nombreDia=i=>{const dd=fechaObj(mes+'-'+String(i+1).padStart(2,'0'));return DIAS_LARGO[dd.getDay()]+' '+(i+1)};
        html+='<div class="bloque datos-linea" style="padding:6px 16px;margin-top:22px">'+
            dato('Mejor día',dinero(r.porDia[mejor],'UYU',{signo:true}),{clase:claseSigno(r.porDia[mejor]),chico:escHtml(nombreDia(mejor))})+
            (peor!==mejor?dato('Peor día',dinero(r.porDia[peor],'UYU',{signo:true}),{clase:claseSigno(r.porDia[peor]),
                chico:escHtml(nombreDia(peor)+(r.egrDia[peor]?', pagaste '+r.egrDia[peor].nombre:''))}):'')+'</div>';
    }
    /* Operaciones */
    const pc=r.compras.usdt>0?r.compras.monto/r.compras.usdt:0,pv=r.ventas.usdt>0?r.ventas.monto/r.ventas.usdt:0;
    if(r.compras.n||r.ventas.n){
        html+='<h2 class="h3" style="margin-top:24px;font-size:17px">Operaciones</h2><div class="bloque datos-linea" style="padding:6px 16px;margin-top:10px">'+
            dato('Compraste',dinero(r.compras.monto,'UYU'),{chico:r.compras.n?r.compras.n+(r.compras.n===1?' compra':' compras')+' a '+dinero(pc,'UYU')+' promedio':''})+
            dato('Vendiste',dinero(r.ventas.monto,'UYU'),{chico:r.ventas.n?r.ventas.n+(r.ventas.n===1?' venta':' ventas')+' a '+dinero(pv,'UYU')+' promedio':''})+
            (pc&&pv?dato('Diferencia promedio',dinero(pv-pc,'UYU')+' por USDT'):'')+
            dato('Comisiones de Binance',usdtTxt(r.comUsdt),{chico:r.comUsdt?dinero(r.comPesos,'UYU')+' en pesos, ya descontados':''})+'</div>';
    }
    /* Categorías */
    if(r.categorias.length){
        const mx=r.categorias[0].total||1;
        html+='<h2 class="h3" style="margin-top:24px;font-size:17px">Egresos por categoría</h2><div class="bloque" style="padding:8px 16px;margin-top:10px">'+
            r.categorias.map(c=>'<div class="cat"><span>'+escHtml(c.nombre)+'</span><i style="width:'+Math.max(2,Math.round(c.total/mx*100))+'%"></i><b>'+dinero(c.total,'UYU')+'</b></div>').join('')+'</div>';
    }
    if(!r.compras.n&&!r.ventas.n&&!r.categorias.length)html+='<div class="bloque vacio" style="margin-top:22px"><b>Sin movimientos este mes</b></div>';
    html+='</div>';
    cont.innerHTML=html;
}
ACC['resumen-cargar']=async t=>{
    const c=capaDe(t);if(!c)return;
    t.disabled=true;t.textContent='Trayendo el mes…';
    try{
        if(!navigator.onLine)throw new Error('Necesitás conexión a internet.');
        const d=await cargarMesArchivado(c.mes);
        c.archivo[c.mes]=d;
        pintarResumen(c.cont,c);
    }catch(e){
        if(t.isConnected){t.disabled=false;t.textContent='Ver el detalle'}
        avisar('No se pudo traer el mes: '+(e&&e.message||e),{error:true});
    }
};

/* ─── Calendario ───────────────────────────────────────────────────────── */
ACC['calendario']=()=>abrirCapa({tipo:'vista',etiqueta:'Calendario',clave:'calendario',
    montar(cont,capa){capa.mes=getMesActivo();capa.archivo={};pintarCalendario(cont,capa)},
    actualizar(cont,capa){pintarCalendario(cont,capa)}});
ACC['cal-mes']=t=>{const c=capaDe(t);if(!c||!t.dataset.mes)return;c.mes=t.dataset.mes;pintarCalendario(c.cont,c)};
function pintarCalendario(cont,capa){
    const mes=capa.mes,arch=mesArchivado(mes)&&!capa.archivo[mes];
    let html=cabVista('',{centro:navMes(mes,'cal-mes')})+'<div class="vista-cuerpo">';
    if(arch){
        html+='<p class="texto-ayuda">Este mes está archivado. Para ver cada día hay que traerlo de internet.</p><button type="button" class="btn gris" style="margin-top:12px" data-a="cal-cargar">Ver los días</button></div>';
        cont.innerHTML=html;return;
    }
    const fuente=capa.archivo[mes];
    const r=fuente?resumenMes(mes,fuente.ops,fuente.movimientos):resumenMes(mes,AppState.datos.operaciones,AppState.datos.movimientos);
    const hoy=getUDateStr();
    html+='<div class="heroe-rot">Ganancia neta</div><div class="cifra '+claseSigno(r.neta)+'" style="font-size:40px;font-weight:760;line-height:1;margin-top:4px">'+dinero(r.neta,'UYU',{signo:true})+'</div>';
    const primero=fechaObj(mes+'-01').getDay();          /* 0 = domingo */
    const corrimiento=(primero+6)%7;                     /* la semana empieza el lunes */
    html+='<div class="calendario">'+['L','M','X','J','V','S','D'].map(x=>'<div class="cab-dia">'+x+'</div>').join('');
    for(let i=0;i<corrimiento;i++)html+='<div class="cal-dia vacio-mes"></div>';
    for(let dnum=1;dnum<=r.dias;dnum++){
        const f=mes+'-'+String(dnum).padStart(2,'0'),v=r.porDia[dnum-1];
        const hay=Math.abs(v)>=0.005;
        html+='<button type="button" class="cal-dia'+(f===hoy?' hoy':'')+'" data-a="ir-dia" data-fecha="'+f+'"'+(f>hoy||fuente?' disabled':'')+
            ' aria-label="'+escHtml(dnum+': '+(hay?dinero(v,'UYU',{signo:true}):'sin ganancia'))+'"><span class="d">'+dnum+'</span>'+
            '<span class="g '+claseSigno(v)+'">'+(hay?(v>0?'+':MENOS)+fmtNum(Math.abs(v),2):'')+'</span></button>';
    }
    html+='</div><p class="texto-ayuda">Tocá un día para ver sus movimientos.</p></div>';
    cont.innerHTML=html;
}
ACC['cal-cargar']=async t=>{
    const c=capaDe(t);if(!c)return;
    t.disabled=true;t.textContent='Trayendo el mes…';
    try{c.archivo[c.mes]=await cargarMesArchivado(c.mes);pintarCalendario(c.cont,c)}
    catch(e){if(t.isConnected){t.disabled=false;t.textContent='Ver los días'}avisar('No se pudo traer el mes: '+(e&&e.message||e),{error:true})}
};

/* ─── Egresos por categoría ────────────────────────────────────────────── */
const PERIODOS_CAT=[['mes','Este mes'],['mespasado','Mes pasado'],['tres','Últimos 3 meses'],['todo','Todo']];
ACC['egresos-cat']=()=>abrirCapa({tipo:'vista',etiqueta:'Egresos por categoría',clave:'egresos-cat',
    montar:pintarEgresosCat,actualizar:pintarEgresosCat});
function pintarEgresosCat(cont){
    const p=AppState.ui.tagPeriodo||'mes',hoy=getUDateStr(),mes=hoy.slice(0,7);
    const desde=p==='mes'?mes:p==='mespasado'?sumarMeses(mes,-1):p==='tres'?sumarMeses(mes,-2):'';
    const hasta=p==='mespasado'?sumarMeses(mes,-1):'9999-99';
    const cats={};let total=0;
    (AppState.datos.movimientos||[]).forEach(m=>{
        if(!m||m.tipoMovimiento!=='egreso')return;
        const mm=String(m.fecha||'').slice(0,7);if(mm<desde||mm>hasta)return;
        const v=movimientoValorUYU(m),k=m.descripcion?tagKey(m.descripcion):'';
        if(!cats[k])cats[k]={nombre:m.descripcion||'',total:0,n:0};
        cats[k].total=roundMoney(cats[k].total+v);cats[k].n++;total=roundMoney(total+v);
    });
    const lista=Object.values(cats).sort((a,b)=>b.total-a.total);
    let html=cabVista('Egresos por categoría')+'<div class="vista-cuerpo">'+
        '<div class="chips" role="group" aria-label="Período">'+PERIODOS_CAT.map(([k,t])=>'<button type="button" class="chip" data-a="cat-periodo" data-p="'+k+'" aria-pressed="'+(p===k)+'">'+t+'</button>').join('')+'</div>';
    if(!lista.length){html+='<div class="bloque vacio" style="margin-top:16px"><b>No hay egresos en este período</b></div></div>';cont.innerHTML=html;return}
    html+='<div style="margin-top:18px"><div class="heroe-rot">Total</div><div class="cifra" style="font-size:40px;font-weight:760;line-height:1;margin-top:4px">'+dinero(total,'UYU')+'</div></div>'+
        '<div class="bloque" style="padding:8px 16px;margin-top:16px">'+lista.map(c=>
            '<button type="button" class="cat" data-a="cat-ver" data-cat="'+escHtml(c.nombre)+'"><span>'+escHtml(c.nombre||'sin categoría')+'</span><i style="width:'+Math.max(2,Math.round(c.total/lista[0].total*100))+'%"></i>'+
            '<b>'+dinero(c.total,'UYU')+'<small>'+c.n+(c.n===1?' vez':' veces')+'</small></b></button>').join('')+'</div>'+
        '<p class="texto-ayuda">Tocá una categoría para ver sus egresos.</p></div>';
    cont.innerHTML=html;
}
ACC['cat-periodo']=t=>{AppState.ui.tagPeriodo=t.dataset.p;const c=capaDe(t);if(c)pintarEgresosCat(c.cont)};
ACC['cat-ver']=t=>{
    const r=AppState.ui.registro,p=AppState.ui.tagPeriodo||'mes';
    Object.assign(r,{tipo:'egreso',buscar:t.dataset.cat||'',cuenta:'',dia:'',limite:60,periodo:p==='tres'?'todo':p});
    cerrarTodasLasCapas();irATab('registro');
};

/* ─── Categorías ───────────────────────────────────────────────────────── */
ACC['categorias']=()=>abrirCapa({tipo:'vista',etiqueta:'Categorías',clave:'categorias',
    montar:pintarCategorias,actualizar:pintarCategorias});
function pintarCategorias(cont){
    const st=getTagStats();
    const lista=Object.values(st).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
    cont.innerHTML=cabVista('Categorías')+'<div class="vista-cuerpo">'+
        '<div class="buscar-fila" style="margin-top:0"><input class="campo" data-r="nueva" maxlength="24" placeholder="Nueva categoría" autocomplete="off" aria-label="Nueva categoría">'+
        '<button type="button" class="btn chico" style="width:auto;padding:0 18px" data-a="cat-agregar" data-primario>Agregar</button></div>'+
        (lista.length?'<div class="bloque" style="margin-top:16px">'+lista.map(c=>
            '<button type="button" class="opc" data-a="cat-editar" data-cat="'+escHtml(c.nombre)+'">'+ico('etiqueta')+'<span class="t">'+escHtml(c.nombre)+'</span>'+
            '<span class="v">'+(c.usos?c.usos+(c.usos===1?' uso':' usos'):'sin usar')+'</span>'+ico('sig','ch')+'</button>').join('')+'</div>'
            :'<div class="bloque vacio" style="margin-top:16px"><b>Todavía no hay categorías</b><p>Se crean solas al cargar un egreso, o agregalas acá.</p></div>')+
        '</div>';
}
ACC['cat-agregar']=t=>{
    const c=capaDe(t),inp=c.cont.querySelector('[data-r="nueva"]');
    const v=normalizarTag(inp.value);
    if(v.length<2){avisar('Escribí un nombre de al menos 2 letras.',{error:true});return}
    if((AppState.datos.tags||[]).some(x=>tagKey(x)===tagKey(v))){avisar('Esa categoría ya existe.',{error:true});return}
    agregarTag(v);inp.value='';invalidarItems();pintarCategorias(c.cont);avisar('Categoría agregada.');
};
ACC['cat-editar']=t=>{
    const nombre=t.dataset.cat;
    const otras=(AppState.datos.tags||[]).filter(x=>tagKey(x)!==tagKey(nombre)).sort((a,b)=>a.localeCompare(b,'es'));
    const usos=(getTagStats()[tagKey(nombre)]||{}).usos||0;
    abrirCapa({tipo:'hoja',etiqueta:'Categoría',
        html:cabHoja(mayus(nombre),{chico:true})+'<div class="hoja-cuerpo"><div class="grupo-campos">'+
            '<div><label class="rotulo" for="ctNombre">Cambiar el nombre</label><div class="buscar-fila" style="margin-top:0">'+
                '<input class="campo" id="ctNombre" data-r="nombre" maxlength="24" autocomplete="off" value="'+escHtml(nombre)+'">'+
                '<button type="button" class="btn chico" style="width:auto;padding:0 18px" data-a="cat-renombrar">Guardar</button></div>'+
                '<p class="nota-campo">Cambia también en '+(usos===1?'el egreso que la usa':'los '+usos+' movimientos que la usan')+'.</p></div>'+
            (otras.length?'<div><label class="rotulo" for="ctUnir">Unir con otra</label><div class="buscar-fila" style="margin-top:0">'+
                '<select class="campo" id="ctUnir" data-r="unir">'+otras.map(x=>'<option value="'+escHtml(x)+'">'+escHtml(x)+'</option>').join('')+'</select>'+
                '<button type="button" class="btn chico gris" style="width:auto;padding:0 18px" data-a="cat-unir">Unir</button></div>'+
                '<p class="nota-campo">Sus movimientos pasan a la otra y esta desaparece.</p></div>':'')+
            '<button type="button" class="btn peligro chico" data-a="cat-borrar">'+ico('borrar')+'Borrar categoría</button>'+
            '<p class="nota-campo" style="margin-top:-8px">Los movimientos que la usan no se borran: conservan el nombre.</p>'+
        '</div></div>',
        montar(cont,capa){capa.cat=nombre}});
};
function _trasCambioCategorias(capa,texto){invalidarItems();cerrarCapa(capa);actualizarVista();avisar(texto)}
ACC['cat-renombrar']=t=>{
    const c=capaDe(t),nuevo=c.cont.querySelector('[data-r="nombre"]').value;
    if(normalizarTag(nuevo)===c.cat){cerrarCapa(c);return}
    if(!editarTag(c.cat,nuevo)){avisar('Ese nombre no sirve o ya existe.',{error:true});return}
    _trasCambioCategorias(c,'Categoría renombrada.');
};
ACC['cat-unir']=async t=>{
    const c=capaDe(t),dest=c.cont.querySelector('[data-r="unir"]').value;
    const si=await preguntar({titulo:'¿Unir "'+c.cat+'" con "'+dest+'"?',texto:'Todos sus movimientos pasan a "'+dest+'".',si:'Unir'});
    if(!si)return;
    if(!mergeTag(c.cat,dest)){avisar('No se pudo unir.',{error:true});return}
    _trasCambioCategorias(c,'Categorías unidas.');
};
ACC['cat-borrar']=async t=>{
    const c=capaDe(t);
    const si=await preguntar({titulo:'¿Borrar "'+c.cat+'"?',texto:'Deja de aparecer para elegir. Los movimientos que la usan conservan el nombre.',si:'Borrar',peligro:true});
    if(!si)return;
    eliminarTag(c.cat);_trasCambioCategorias(c,'Categoría borrada.');
};

/* ─── Verificar que todo cuadre ────────────────────────────────────────── */
ACC['verificar']=()=>abrirCapa({tipo:'vista',etiqueta:'Verificar',clave:'verificar',
    montar(cont,capa){capa.informe=reconciliarTodo();capa.servidor=null;guardarResultadoVerificacion(capa.informe);pintarVerificar(cont,capa);pintarTab()},
    actualizar(cont,capa){pintarVerificar(cont,capa)}});
function guardarResultadoVerificacion(inf){if(inf)AppState.ui.verificacion={ok:!!inf.ok,t:Date.now()}}
/* Cada problema del informe, en palabras: título, qué hacer, y cómo se
   muestra su valor (pesos de la cuenta o USDT) */
const _QUE_IMPOSIBLE=[
    [/sin saldo de apertura/,'Falta fijar el saldo inicial','Corregí el saldo de esta cuenta una vez para fijarlo.','saldo'],
    [/USDT de más/,'Hay más USDT que lo que indican tus operaciones','Alguna venta no encontró USDT para descontar: suele pasar al borrar una compra vieja.','usdt'],
    [/USDT de menos/,'Hay menos USDT que lo que indican tus operaciones','Revisá los lotes cargados a mano y los de meses archivados.','usdt'],
    [/Saldo negativo en/,'Una cuenta quedó en negativo','Revisá su libro: puede faltar un ingreso o sobrar un egreso.','saldo'],
    [/Saldo USDT negativo/,'El USDT quedó en negativo','Vendiste más USDT de los que tenías cargados.','usdt'],
    [/Lote con más disponible/,'Un lote tiene más USDT de los comprados','Usá Reparar lotes de meses archivados.','usdt']
];
function pintarVerificar(cont,capa){
    const inf=capa.informe||{ok:true,duplicados:[],imposibles:[]};
    const total=ENTIDADES_REGISTRO.reduce((n,e)=>n+listaDe(e).length,0);
    let html=cabVista('Verificar que todo cuadre')+'<div class="vista-cuerpo">';
    html+='<div class="bloque estado-grande"><span class="circulo'+(inf.ok?'':' mal')+'">'+ico(inf.ok?'ok':'alerta')+'</span><div><b>'+(inf.ok?'Todo cuadra':'Hay cosas para revisar')+'</b>'+
        '<span>'+(inf.ok?'Revisé '+total+' movimientos: no hay repetidos ni saldos imposibles, y el USDT coincide con tus compras y ventas.':'Revisé '+total+' movimientos y encontré lo de abajo.')+'</span></div></div>';
    if(!inf.ok){
        html+='<div class="bloque" style="margin-top:12px">';
        (inf.imposibles||[]).forEach(p=>{
            const m=_QUE_IMPOSIBLE.find(x=>x[0].test(p.que));
            const cuenta=(p.que.match(/^(\w[\w ]*): sin saldo/)||p.que.match(/Saldo negativo en (.+)$/)||[])[1];
            const valor=!isFinite(p.valor)?'':m&&m[3]==='usdt'?' ('+usdtTxt(p.valor)+')':cuenta?' Saldo: '+dinero(p.valor,monedaDeCuenta(cuenta))+'.':'';
            const cab='<b>'+escHtml(m?m[1]:p.que)+(cuenta?': '+escHtml(nombreCuenta(cuenta)):'')+'</b><span>'+escHtml((m?m[2]:'')+valor)+'</span>';
            html+=cuenta&&AppState.datos.bancos[cuenta]
                ?'<button type="button" class="problema" data-a="libro" data-cuenta="'+escHtml(cuenta)+'">'+cab+'</button>'
                :'<div class="problema">'+cab+'</div>';
        });
        (inf.duplicados||[]).forEach(dd=>{
            html+='<div class="problema"><b>Un registro aparece dos veces</b><span>'+escHtml(tituloDetalle(itemRegistro(dd.tipo,dd.ev))+' del '+fmtFechaCorta(dd.ev.fecha||''))+'</span></div>';
        });
        html+='</div>';
    }
    if(inf.usdt&&Math.abs(inf.usdt.cambio||0)>=0.005)html+='<p class="texto-ayuda">El USDT se recalculó: '+escHtml(usdtTxt(inf.usdt.antes))+' pasó a '+escHtml(usdtTxt(inf.usdt.despues))+'.</p>';
    /* Comparación con internet */
    const sv=capa.servidor;
    html+='<h2 class="grupo">Más controles</h2><div class="bloque">'+
        opc('verificar-servidor','wifi','Comparar con lo guardado en internet',{sub:'Revisa que la nube tenga lo mismo que este teléfono'})+
        ((AppState.datos._archivoCarryover||[]).length?opc('reparar-arrastre','caja','Reparar lotes de meses archivados'):'')+
        opc('reiniciar-conexion','restaurar','Reiniciar la conexión',{sub:'Si no se guarda nada aunque haya internet'})+
    '</div>';
    if(sv){
        if(sv.cargando)html+='<p class="texto-ayuda">Comparando…</p>';
        else if(sv.error)html+='<div class="bloque problema" style="margin-top:12px"><b>No se pudo comparar</b><span>'+escHtml(sv.error)+'</span></div>';
        else{
            html+='<div class="bloque" style="margin-top:12px"><div class="estado-grande"><span class="circulo'+(sv.ok?'':' mal')+'">'+ico(sv.ok?'ok':'alerta')+'</span><div><b>'+(sv.ok?'Internet tiene lo mismo':'Hay diferencias con internet')+'</b>'+
                '<span>'+escHtml((sv.eventosServidor||0)+' movimientos guardados en internet.')+'</span></div></div>'+
                (sv.problemas||[]).map(p=>'<div class="problema"><span style="color:var(--tinta);margin:0">'+escHtml(p)+'</span></div>').join('')+
                (sv.avisos||[]).map(p=>'<div class="problema"><span style="margin:0">'+escHtml(p)+'</span></div>').join('')+'</div>';
        }
    }
    html+='<p class="texto-ayuda">Esta revisión no cambia nada por su cuenta.</p></div>';
    cont.innerHTML=html;
}
ACC['verificar-servidor']=async t=>{
    const c=capaDe(t);if(!c)return;
    c.servidor={cargando:true};pintarVerificar(c.cont,c);
    const r=await verificarIntegridad({silencioso:true});
    if(!c.el.isConnected)return;
    c.servidor=r&&r.error?{error:r.error}:(r||{error:'No se pudo comparar.'});
    pintarVerificar(c.cont,c);
};
ACC['reparar-arrastre']=()=>repararCarryover();
ACC['reiniciar-conexion']=()=>_archivoResetConexion();

/* ─── Copias de seguridad ──────────────────────────────────────────────── */
ACC['exportar']=()=>exportarDatos();
ACC['importar']=()=>importarDatos();

/* ─── Copias automáticas (v8.0.1) ──────────────────────────────────────── */
/* Lista las 3 copias guardadas en el teléfono, dice si a la app le falta algo
   de cada una y permite recuperarlo (solo agrega, nunca borra). */
ACC['copias']=()=>{
    cerrarTodasLasCapas();
    abrirCapa({tipo:'vista',etiqueta:'Copias automáticas',clave:'copias',
        montar(cont,capa){capa.info={};pintarCopias(cont,capa);revisarCopias(capa)},
        actualizar(cont,capa){revisarCopias(capa)}});
};
async function revisarCopias(capa){
    const lista=listaCopias(),info={};
    for(const c of lista){
        try{const cont=await leerCopia(c);info[c.id]=cont?{faltan:faltantesDe(cont)}:{error:true}}
        catch(_){info[c.id]={error:true}}
    }
    capa.info=info;
    if(capa.el.isConnected)pintarCopias(capa.cont,capa);
}
function _cuandoCopia(ts){const x=isoAUY(new Date(ts).toISOString());return x?mayus(cuandoTexto(x.fecha,x.hora)):''}
function _movimientosTxt(n){return n+(n===1?' movimiento':' movimientos')}
function pintarCopias(cont,capa){
    const lista=listaCopias();
    let html=cabVista('Copias automáticas')+'<div class="vista-cuerpo">'+
        '<p class="texto-ayuda" style="padding-top:0">La app guarda en este teléfono una copia de todos tus movimientos cada 30 minutos, y se quedan las 3 últimas. '+
        'Recuperar agrega lo que falte: no borra ni cambia nada de lo que ya tenés.</p>';
    if(!lista.length){
        html+='<div class="bloque vacio" style="margin-top:14px"><b>Todavía no hay copias</b><p>La primera se hace sola en un minuto, o tocá el botón de abajo.</p></div>';
    }else{
        html+='<div class="copias">'+lista.map(c=>{
            const inf=capa.info&&capa.info[c.id];
            let estado,boton='';
            if(!inf)estado='<span class="tenue">Revisando…</span>';
            else if(inf.error)estado='<span class="baja">No se pudo leer esta copia</span>';
            else if(inf.faltan.length){
                estado='<span class="baja">A la app le '+(inf.faltan.length===1?'falta ':'faltan ')+_movimientosTxt(inf.faltan.length)+'</span>';
                boton='<button type="button" class="btn chico" data-a="copia-recuperar" data-id="'+escHtml(c.id)+'">'+ico('restaurar')+'Recuperar '+_movimientosTxt(inf.faltan.length)+'</button>';
            }else estado='<span class="sube">Tenés todo lo de esta copia</span>';
            return'<div class="copia"><div class="copia-cab"><b>'+escHtml(_cuandoCopia(c.ts))+'</b><span>'+((c.n&&c.n.total)||0)+' registros</span></div>'+
                '<div class="copia-estado">'+estado+'</div>'+
                (c.protegida?'<div class="copia-nota">Se guarda hasta el '+escHtml(fmtFechaCorta((isoAUY(new Date(c.protegida).toISOString())||{}).fecha||''))+' porque tenía cosas que después faltaron.</div>':'')+
                boton+'</div>';
        }).join('')+'</div>';
    }
    html+='<button type="button" class="btn claro" style="margin-top:16px" data-a="copia-ahora">'+ico('caja')+'Hacer una copia ahora</button></div>';
    cont.innerHTML=html;
}
ACC['copia-recuperar']=async t=>{
    const capa=capaDe(t),id=t.dataset.id;
    const inf=capa&&capa.info&&capa.info[id];
    const n=inf&&inf.faltan?inf.faltan.length:0;
    const si=await preguntar({titulo:'¿Recuperar '+_movimientosTxt(n)+'?',
        texto:'Vuelven a la app tal como estaban en la copia, y se suben a tu cuenta. No se borra ni se cambia nada de lo que ya tenés.',si:'Recuperar'});
    if(!si)return;
    const r=await recuperarDeCopia(id);
    if(r.ok)avisar(!r.n?'No faltaba nada.':r.n===1?'Se recuperó 1 movimiento.':'Se recuperaron '+_movimientosTxt(r.n)+'.');
    else avisar(r.error||'No se pudo recuperar.',{error:true});
    if(capa&&capa.el.isConnected)revisarCopias(capa);
};
ACC['copia-ahora']=async t=>{
    const capa=capaDe(t);
    t.disabled=true;
    const m=await copiaAutomatica('a mano',{nueva:true});
    t.disabled=false;
    avisar(m?'Copia hecha.':'No se pudo hacer la copia.',m?{}:{error:true});
    if(capa&&capa.el.isConnected){capa.info={};pintarCopias(capa.cont,capa);revisarCopias(capa)}
};

/* ─── Archivar meses anteriores ────────────────────────────────────────── */
ACC['archivar']=()=>{
    const inf=infoArchivar();
    const mesCorte=nombreMes(inf.corte);
    abrirCapa({tipo:'hoja',etiqueta:'Archivar meses anteriores',
        html:cabHoja('Archivar meses anteriores',{chico:true})+'<div class="hoja-cuerpo">'+
            (inf.viejos?'<p style="font-size:15px;color:var(--tinta-2)">Los '+inf.viejos+' movimientos anteriores a '+escHtml(mesCorte)+' se guardan aparte. La app queda más liviana y rápida.</p>'+
                '<p class="texto-ayuda" style="padding-left:0">Los saldos, los lotes y las ganancias no cambian. Los meses archivados se ven desde Más, en Meses archivados, y ya no se pueden editar.</p>'
               :'<p style="font-size:15px;color:var(--tinta-2)">No hay movimientos anteriores a '+escHtml(mesCorte)+' para archivar.</p>')+
            '</div>'+(inf.viejos?'<div class="hoja-pie"><div data-r="error"></div><button type="button" class="btn" data-a="archivar-si">Archivar</button></div>':'')});
};
ACC['archivar-si']=t=>{
    const c=capaDe(t);
    if(!navigator.onLine){mostrarError(c,'Necesitás conexión a internet para archivar.');return}
    cerrarCapa(c);
    archivarHistorial({trigger:'menu'});
};
ACC['meses-archivados']=()=>abrirCapa({tipo:'vista',etiqueta:'Meses archivados',clave:'meses',
    montar:pintarMesesArchivados,actualizar:pintarMesesArchivados});
function pintarMesesArchivados(cont){
    const idx=(AppState.datos._archivoIndex&&AppState.datos._archivoIndex.meses)||{};
    const meses=Object.keys(idx).filter(m=>/^\d{4}-\d{2}$/.test(m)).sort().reverse();
    cont.innerHTML=cabVista('Meses archivados')+'<div class="vista-cuerpo">'+
        (meses.length?'<div class="bloque">'+meses.map(m=>{
            const s=idx[m]||{};
            return'<button type="button" class="opc" data-a="mes-archivado" data-mes="'+m+'">'+ico('caja')+'<span class="t">'+escHtml(nombreMesLargo(m))+
                '<small>'+(s.ops||0)+' operaciones</small></span><span class="v '+claseSigno(s.ganancia||0)+'">'+dinero(s.ganancia||0,'UYU',{signo:true})+'</span>'+ico('sig','ch')+'</button>';
        }).join('')+'</div>':'<div class="bloque vacio"><b>No hay meses archivados</b></div>')+
        '<button type="button" class="btn-texto" style="margin-top:8px" data-a="buscar-meses">Buscar meses que falten</button></div>';
}
ACC['mes-archivado']=t=>abrirResumen(t.dataset.mes);
ACC['buscar-meses']=async()=>{
    if(!navigator.onLine){avisar('Necesitás conexión a internet.',{error:true});return}
    const n=await _archivoSincronizarIndice();
    avisar(n?'Se encontraron '+n+(n===1?' mes que faltaba.':' meses que faltaban.'):'No falta ningún mes.');
    actualizarVista();
};

/* ─── Comisión de Binance ──────────────────────────────────────────────── */
ACC['comision']=()=>{
    const usd=hayBancosUSD();
    abrirCapa({tipo:'hoja',etiqueta:'Comisión de Binance',
        html:cabHoja('Comisión de Binance',{chico:true})+'<div class="hoja-cuerpo"><div class="grupo-campos">'+
            '<div data-campo="pesos"><label class="rotulo" for="cmPesos">En pesos</label><div class="campo-sufijo"><input class="campo" id="cmPesos" data-r="pesos" inputmode="decimal" autocomplete="off"><span>%</span></div></div>'+
            (usd?'<div><label class="rotulo" for="cmDol">En dólares</label><div class="campo-sufijo"><input class="campo" id="cmDol" data-r="dolares" inputmode="decimal" autocomplete="off"><span>%</span></div></div>':'')+
            '<p class="nota-campo" style="margin-top:-6px">Se usa en las operaciones nuevas. Cada operación guarda la comisión con la que se cerró, y la podés cambiar al editarla.</p>'+
        '</div></div><div class="hoja-pie"><div data-r="error"></div><button type="button" class="btn" data-a="comision-guardar" data-primario>Guardar</button></div>',
        montar(cont){
            q(cont,'pesos').value=pctCampo(comisionConfigurada('UYU'));
            const d=q(cont,'dolares');if(d)d.value=pctCampo(comisionConfigurada('USD'));
        }});
};
ACC['comision-guardar']=t=>{
    const c=capaDe(t),cont=c.cont;
    const a=parsearComisionPct(q(cont,'pesos').value);
    const dEl=q(cont,'dolares'),b=dEl?parsearComisionPct(dEl.value):comisionConfigurada('USD');
    if(a===null||b===null){mostrarError(c,'Escribí un porcentaje entre 0 y 5.');return}
    const r=guardarComisionBinance(a,b);
    if(r.ok){cerrarCapa(c);actualizarVista();avisar('Comisión guardada.')}else mostrarError(c,r.error);
};

/* ─── Novedades ────────────────────────────────────────────────────────── */
ACC['novedades']=()=>{
    abrirCapa({tipo:'vista',etiqueta:'Novedades',clave:'novedades',
        html:cabVista('Novedades')+'<div class="vista-cuerpo">'+normalizarChangelog().map(e=>
            '<article class="bloque nov"><div class="nov-cab"><b>Versión '+escHtml(e.version)+'</b><span>'+escHtml(e.date?fmtFechaCorta(e.date)+'/'+e.date.slice(0,4):'')+'</span></div>'+
            (e.headline?'<p>'+escHtml(e.headline)+'</p>':'')+
            '<ul>'+(e.changes||[]).map(ch=>'<li><span class="tipo">'+escHtml(TYPE_LABELS[ch.type]||'Cambio')+'</span><b>'+escHtml(ch.title)+'</b>'+(ch.desc?'<p>'+escHtml(ch.desc)+'</p>':'')+'</li>').join('')+'</ul></article>').join('')+'</div>',
        montar(){marcarVersionVista();AppState.ui.hayNovedad=false;pintarTab()}});
};

/* ─── Sesión y borrado ─────────────────────────────────────────────────── */
ACC['salir']=async()=>{
    const si=await preguntar({titulo:'¿Cerrar sesión?',texto:'Tus datos quedan guardados en tu cuenta.',si:'Cerrar sesión'});
    if(si)cerrarSesion();
};
ACC['borrar-todo']=async()=>{
    const uno=await preguntar({titulo:'¿Borrar todos los datos?',texto:'Se borran todas tus operaciones, movimientos, cuentas y meses archivados, en este teléfono y en internet. No se puede deshacer.\n\nAntes, conviene exportar una copia.',si:'Seguir',peligro:true});
    if(!uno)return;
    const dos=await preguntar({titulo:'Última confirmación',texto:'Vas a borrar todo. ¿Estás seguro?',si:'Borrar todo',no:'No, volver',peligro:true});
    if(!dos)return;
    const ok=await borrarTodo();
    if(ok){cerrarTodasLasCapas();irATab('inicio');avisar('Se borraron todos los datos.')}
};
