/* ═══════════════════════════════════════════════════════════════════════════
   §17 — REGISTROS: cargar, editar, borrar y recuperar (v8.0.0)
   ═══════════════════════════════════════════════════════════════════════════
   Todo lo que mueve plata es un registro: compras y ventas de USDT, ingresos y
   egresos, transferencias, conversiones y correcciones de saldo. Acá están las
   reglas comunes a todos ellos, y las funciones con las que la pantalla los
   guarda. Reciben los datos ya leídos del formulario: no leen la pantalla.

   - Cada edición deja anotado dentro del registro qué cambió y cuándo.
   - Lo que se borra no desaparece: pasa a Eliminados (30 días) y se puede
     recuperar, también desde otro dispositivo.
   - Se puede elegir la fecha y la hora, siempre que no sea futura ni caiga en
     un mes que ya se archivó.

   Los saldos, los lotes, las ganancias y el cupo nunca se tocan acá: salen del
   recálculo que dispara confirmarCambios.

   Las funciones de guardado devuelven siempre un objeto:
     {ok:true, id}                      quedó guardado
     {ok:false, error, campo?}          no se puede: el texto dice por qué
     {ok:false, error, negativo:true}   no se puede porque una cuenta o los USDT
                                        quedarían en negativo (v8.2.0: esto ya no
                                        se puede forzar)
     {ok:false, confirmar}              se puede, pero algo queda raro (el cupo
                                        del día, al editar una compra): la
                                        pantalla pregunta y, si la persona
                                        acepta, vuelve a llamar con {forzar:true}. */

const ENTIDADES_REGISTRO=['operaciones','movimientos','transferencias','conversiones','ajustesSaldo'];
const ELIMINADOS_MAX=80,ELIMINADOS_DIAS=30,CAMBIOS_MAX=20;

/* ─── Acceso ─────────────────────────────────────────────────────────────── */
function listaDe(entidad){
    if(!AppState.datos)return[];
    if(!Array.isArray(AppState.datos[entidad]))AppState.datos[entidad]=[];
    return AppState.datos[entidad];
}
function buscarRegistro(entidad,id){
    if(id===undefined||id===null)return null;
    return listaDe(entidad).find(x=>x&&String(x.id)===String(id))||null;
}
function monedaDeCuenta(nombre){
    if(nombre==='USDT')return'USDT';
    const b=getBancoInfo(nombre);
    return (b&&b.moneda)||'UYU';
}
/* USDT que queda en los lotes de una moneda */
function usdtDisponibleEn(moneda){
    return roundMoney((AppState.datos.lotes||[])
        .filter(l=>l&&(l.moneda||'UYU')===moneda&&l.disponible>0)
        .reduce((s,l)=>s+l.disponible,0));
}

/* Orden de las listas: de lo más nuevo a lo más viejo por fecha, hora e id.
   Es el mismo criterio del servidor, así que lo que se agrega acá queda en el
   mismo lugar que tendrá cuando vuelva la foto del servidor. */
function _claveOrden(x){return String(x.fecha||'')+String(x.hora||'00:00')+String(x.id||'').padStart(20,'0')}
function _insertarOrdenado(lista,rec){
    const k=_claveOrden(rec);
    let i=0;
    while(i<lista.length&&_claveOrden(lista[i])>k)i++;
    lista.splice(i,0,rec);
}
function _quitarDeLista(entidad,id){
    const lista=listaDe(entidad);
    const i=lista.findIndex(x=>x&&String(x.id)===String(id));
    if(i>=0)lista.splice(i,1);
}
function _ponerEnLista(entidad,rec){
    _quitarDeLista(entidad,rec.id);
    _insertarOrdenado(listaDe(entidad),rec);
}

/* ─── Fecha y hora ──────────────────────────────────────────────────────── */
function ahoraUY(){return{fecha:getUDateStr(),hora:getUTimeStr()}}
function ultimoMesArchivado(){
    const idx=AppState.datos&&AppState.datos._archivoIndex&&AppState.datos._archivoIndex.meses;
    const ms=idx?Object.keys(idx).filter(m=>/^\d{4}-\d{2}$/.test(m)).sort():[];
    return ms.length?ms[ms.length-1]:'';
}
const _MESES_LARGO=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function nombreMes(mes){
    const p=String(mes||'').split('-');
    const m=_MESES_LARGO[(parseInt(p[1],10)||1)-1]||'';
    return m+' '+(p[0]||'');
}
/* Devuelve el problema con la fecha, o null si está bien */
function problemaConFecha(fecha,hora){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha||''))return'Elegí una fecha válida.';
    if(hora&&!/^\d{2}:\d{2}$/.test(hora))return'Elegí una hora válida.';
    const ahora=ahoraUY();
    if((fecha+' '+(hora||'00:00'))>(ahora.fecha+' '+ahora.hora))return'La fecha no puede ser futura.';
    const arch=ultimoMesArchivado();
    if(arch&&fecha.slice(0,7)<=arch)return'Ese mes ya está archivado: no se le pueden agregar movimientos.';
    return null;
}
/* Marca de tiempo del momento del registro (no de cuándo se cargó) */
function _marcaDe(fecha,hora){return _aIso(fecha+'T'+(hora||'00:00'))||new Date().toISOString()}

/* ─── Historial de cambios ──────────────────────────────────────────────── */
/* Campos que, si cambian, quedan anotados. Lo derivado (ganancia, USDT base,
   comisión en USDT) no se anota: es consecuencia de estos. */
const CAMPOS_CAMBIO={
    operaciones:['monto','tasa','banco','aportes','comisionBanco','comisionPct','fecha','hora'],
    movimientos:['tipoMovimiento','cuenta','monto','tasaRef','descripcion','nota','fecha','hora'],
    transferencias:['origen','destino','monto','comision','tasa','fecha','hora'],
    conversiones:['origen','destino','montoOrigen','tasa','fecha','hora'],
    ajustesSaldo:['delta','motivo'],
    lotes:['cantidad','precioCompra','fecha']
};
function _valorCampo(entidad,rec,campo){
    if(!rec)return'';
    if(entidad==='movimientos'&&campo==='cuenta')return rec.tipoCuenta==='usdt'?'USDT':(rec.banco||'');
    if(campo==='aportes')return esPagoDividido(rec)?aportesDe(rec).map(a=>nombreCuenta(a.banco)+' '+fmtNum(a.monto)).join(' y '):'';
    const v=rec[campo];
    return(v===undefined||v===null)?'':v;
}
/* ═══ v8.0.1 — Cada cambio es {f: campo, a: antes, d: después} ═══
   En la 8.0.0 era una lista [campo, antes, después] dentro de otra lista.
   Firestore no acepta listas dentro de listas: desde la primera edición el
   teléfono dejaba de subir todo, lo guardaba solo en el teléfono, y al
   reabrirse la app se quedaba con lo de la nube y se perdía lo del día. Se
   leen los dos formatos, porque lo viejo pudo quedar guardado en el teléfono. */
function itemCambio(x){
    const v=y=>(y===undefined||y===null)?'':y;
    if(Array.isArray(x))return{f:String(x[0]),a:v(x[1]),d:v(x[2])};
    if(x&&typeof x==='object')return{f:String(x.f),a:v(x.a),d:v(x.d)};
    return null;
}
function itemsDeCambio(c){return(Array.isArray(c&&c.c)?c.c:[]).map(itemCambio).filter(Boolean)}
function normalizarCambios(lista){
    return(Array.isArray(lista)?lista:[]).filter(c=>c&&typeof c==='object').map(c=>({t:String(c.t||''),c:itemsDeCambio(c)}));
}
/* Pasa al formato nuevo el historial de todo lo que hay en memoria */
function normalizarHistoriales(datos){
    if(!datos)return;
    const arreglar=r=>{if(r&&r.cambios)r.cambios=normalizarCambios(r.cambios)};
    ENTIDADES_REGISTRO.forEach(e=>(datos[e]||[]).forEach(arreglar));
    (datos.lotes||[]).forEach(arreglar);
    (datos._archivoCarryover||[]).forEach(arreglar);
    (datos.eliminados||[]).forEach(x=>x&&arreglar(x.r));
}
function anotarCambios(entidad,antes,despues){
    const c=[];
    (CAMPOS_CAMBIO[entidad]||[]).forEach(campo=>{
        const a=_valorCampo(entidad,antes,campo),d=_valorCampo(entidad,despues,campo);
        const iguales=(typeof a==='number'&&typeof d==='number')?Math.abs(a-d)<1e-9:String(a)===String(d);
        if(!iguales)c.push({f:campo,a,d});
    });
    if(!c.length)return 0;
    const previos=normalizarCambios(antes&&antes.cambios);
    despues.cambios=[{t:new Date().toISOString(),c},...previos].slice(0,CAMBIOS_MAX);
    despues.editadoEn=despues.cambios[0].t;
    return c.length;
}

/* ═══ v8.2.0 — Ninguna cuenta queda en negativo, en ningún momento ═══════════
   Antes se miraba solo cómo terminaba el saldo, y si una edición o un borrado
   dejaba una cuenta en negativo se preguntaba "¿Guardar igual?". Así se podía
   borrar una transferencia cuya plata ya se había gastado, o bajar un ingreso
   que ya se había usado, y la cuenta quedaba en negativo. Tampoco se veía un
   negativo en el medio: un egreso cargado con fecha de ayer podía dejar la
   cuenta en rojo ayer a la tarde aunque hoy, con lo que entró después, cerrara
   en positivo.

   Ahora se recorre el libro de cada cuenta que el cambio toca, en el orden de
   fecha y hora del libro, como quedaría con el cambio y como estaba antes. Si
   en algún momento el saldo queda por debajo de cero, no se guarda: ni al
   cargar, ni al editar, ni al borrar, ni al recuperar, y no hay "guardar
   igual". Lo mismo con los USDT de cada moneda: no se puede vender ni sacar lo
   que todavía no se había comprado.

   Si una cuenta ya venía en negativo por datos de antes, se la deja mejorar
   —cualquier cambio que la acerque a cero se acepta— pero nunca empeorar.

   cambios = [{entidad, antes, despues}]: antes es el registro como está
   guardado (null si es nuevo) y despues como quedaría (null si se borra).
   Devuelve la lista de problemas; vacía si se puede guardar. */
const _NEG=0.005;
const _DIAS_LIBRO=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
function _idOrden(id){return String(Number(id)||0).padStart(20,'0')}
/* Mismo orden que el libro de la cuenta: momento y, si coincide, id */
function _ordenEnCuenta(ev){return _marcaEvento(ev)+'|'+_idOrden(ev&&ev.id)}
/* Mismo orden que el recálculo de los lotes */
function _ordenEnUsdt(entidad,ev){
    const f=entidad==='lotes'?(ev.fecha||'2000-01-01'):(ev.fecha||'');
    return f+(ev.hora||'00:00')+'|'+_idOrden(ev.id);
}
/* USDT que mueve un registro, y con qué moneda se compraron esos USDT */
function _usdtDe(entidad,rec){
    if(!rec)return 0;
    if(entidad==='lotes')return roundMoney(Number(rec.cantidad)||0);
    return efectoEnUsdt(entidad,rec)||0;
}
function _monedaUsdtDe(entidad,rec){
    if(entidad==='operaciones'||entidad==='lotes')return(rec&&rec.moneda)||'UYU';
    return'UYU';   /* los movimientos de USDT van contra lotes en pesos, igual que en el recálculo */
}
/* "hoy a las 15:30", "ayer a las 9:10", "el martes 3 a las 18:00" */
function _cuandoFue(f,h){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(f||'')||f<='2000-01-01')return'';
    const hoy=getUDateStr(),hora=h?' a las '+h:'';
    const fe=s=>new Date(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10),12);
    const ay=fe(hoy);ay.setDate(ay.getDate()-1);
    const ayer=ay.getFullYear()+'-'+String(ay.getMonth()+1).padStart(2,'0')+'-'+String(ay.getDate()).padStart(2,'0');
    if(f===hoy)return'hoy'+hora;
    if(f===ayer)return'ayer'+hora;
    const d=fe(f);
    let t='el '+_DIAS_LIBRO[d.getDay()]+' '+d.getDate();
    if(f.slice(0,7)!==hoy.slice(0,7))t+=' de '+_MESES_LARGO[d.getMonth()];
    if(f.slice(0,4)!==hoy.slice(0,4))t+=' de '+d.getFullYear();
    return t+hora;
}
/* Recorre una lista de asientos {k, a, d, ev} en orden, sumando lo de antes
   (a) y lo de después (d) desde el mismo punto de partida. Los asientos con
   el mismo orden se suman juntos (la versión vieja y la nueva de un registro
   que no cambió de momento). Devuelve el problema más claro: cómo termina, si
   termina mal; si no, el primer momento en que queda en negativo. */
function _recorrerSaldo(lista,inicio){
    lista.sort((x,y)=>x.k<y.k?-1:x.k>y.k?1:0);
    let sa=roundMoney(inicio),sd=sa,primero=null;
    const peor=()=>sd<-_NEG&&sd<sa-_NEG;
    for(let i=0;i<lista.length;){
        const k=lista[i].k;let ev=null;
        while(i<lista.length&&lista[i].k===k){
            const x=lista[i];
            sa=roundMoney(sa+x.a);sd=roundMoney(sd+x.d);
            if(!ev||x.d)ev=x.ev;
            i++;
        }
        if(!primero&&peor())primero={valor:sd,ev};
    }
    if(peor())return{final:true,valor:sd,antes:sa};
    return primero?{final:false,valor:primero.valor,ev:primero.ev,antes:sa}:null;
}
function revisarNegativos(cambios){
    const D=AppState.datos;
    const cs=(cambios||[]).filter(c=>c&&c.entidad&&(c.antes||c.despues));
    if(!D||!cs.length)return[];
    /* Las versiones viejas salen de "lo que hay": entran como asiento de antes */
    const fuera=new Set(cs.filter(c=>c.antes&&c.antes.id!=null).map(c=>c.entidad+':'+c.antes.id));
    const queda=(ent,ev)=>!fuera.has(ent+':'+ev.id);
    const cuentas={},monedas={};
    cs.forEach(c=>[c.antes,c.despues].forEach(r=>{
        if(!r)return;
        if(c.entidad!=='lotes')Object.keys(efectoEnBancos(c.entidad,r)).forEach(k=>{cuentas[k]=[]});
        if(Math.abs(_usdtDe(c.entidad,r))>=_NEG)monedas[_monedaUsdtDe(c.entidad,r)]=[];
    }));
    const hayCuentas=Object.keys(cuentas).length>0,hayUsdt=Object.keys(monedas).length>0;
    if(!hayCuentas&&!hayUsdt)return[];
    /* Un solo recorrido por los registros */
    ENTIDADES_REGISTRO.forEach(ent=>(D[ent]||[]).forEach(ev=>{
        if(!ev||!queda(ent,ev))return;
        if(hayCuentas){
            const ef=efectoEnBancos(ent,ev);
            for(const k in ef)if(cuentas[k])cuentas[k].push({k:_ordenEnCuenta(ev),a:ef[k],d:ef[k],ev});
        }
        if(hayUsdt&&(ent==='operaciones'||ent==='movimientos')){
            const u=_usdtDe(ent,ev);
            if(u){const m=monedas[_monedaUsdtDe(ent,ev)];if(m)m.push({k:_ordenEnUsdt(ent,ev),a:u,d:u,ev})}
        }
    }));
    if(hayUsdt){
        const lote=l=>{
            if(!l||!queda('lotes',l))return;
            const m=monedas[l.moneda||'UYU'],u=roundMoney(Number(l.cantidad)||0);
            if(m&&u)m.push({k:_ordenEnUsdt('lotes',l),a:u,d:u,ev:l});
        };
        (D.lotes||[]).forEach(l=>{if(l&&l.manual&&!l.carryover)lote(l)});
        (D._archivoCarryover||[]).forEach(lote);
    }
    /* Las dos versiones de lo que cambia */
    cs.forEach(c=>{
        const poner=(r,lado)=>{
            if(!r)return;
            if(c.entidad!=='lotes'){
                const ef=efectoEnBancos(c.entidad,r);
                for(const k in ef)cuentas[k].push({k:_ordenEnCuenta(r),a:lado?0:ef[k],d:lado?ef[k]:0,ev:r});
            }
            const u=_usdtDe(c.entidad,r);
            if(Math.abs(u)>=_NEG)monedas[_monedaUsdtDe(c.entidad,r)].push({k:_ordenEnUsdt(c.entidad,r),a:lado?0:u,d:lado?u:0,ev:r});
        };
        poner(c.antes,false);poner(c.despues,true);
    });
    const out=[];
    Object.keys(cuentas).forEach(k=>{
        const bk=D.bancos&&D.bancos[k];
        const lista=cuentas[k];
        let inicio=bk?Number(bk.saldoApertura):0;
        if(!isFinite(inicio))inicio=roundMoney((Number(bk&&bk.saldo)||0)-lista.reduce((s,x)=>s+x.a,0));
        const p=_recorrerSaldo(lista,inicio);
        if(!p)return;
        const cuanto='−'+fmtMonto(Math.abs(p.valor),monedaDeCuenta(k));
        let texto;
        if(p.final)texto=nombreCuenta(k)+' quedaría en '+cuanto;
        else{const w=_cuandoFue(p.ev&&p.ev.fecha,p.ev&&p.ev.hora);texto=nombreCuenta(k)+' habría quedado en '+cuanto+(w?' '+w:'')}
        out.push({texto,cuenta:k,valor:p.valor,final:p.final});
    });
    const conDolares=Object.keys(monedas).length>1||!!monedas.USD||(D.operaciones||[]).some(o=>o&&o.moneda==='USD');
    Object.keys(monedas).forEach(m=>{
        const p=_recorrerSaldo(monedas[m],0);
        if(!p)return;
        const cual=conDolares?(m==='USD'?' comprados con dólares':' comprados con pesos'):'';
        const falta=fmtTrunc(Math.abs(p.valor),2);
        let texto;
        if(p.final)texto='Te faltarían '+falta+' USDT'+cual+' (tenés '+fmtTrunc(Math.max(0,p.antes),2)+')';
        else{const w=_cuandoFue(p.ev&&p.ev.fecha,p.ev&&p.ev.hora);texto='Te faltarían '+falta+' USDT'+cual+(w?' '+w:'')+': todavía no los habías comprado'}
        out.push({texto,usdt:m,valor:p.valor,final:p.final});
    });
    return out;
}
/* Respuesta de "no se puede" con los problemas, una línea cada uno */
function _bloqueoNegativo(problemas,o){
    o=o||{};
    const r={ok:false,negativo:true,problemas,error:problemas.map(x=>x.texto+'.').join('\n')};
    if(o.borrar)r.pista=problemas.some(x=>x.cuenta)
        ?'Esa plata ya se usó: primero cambiá o borrá lo que se pagó con ella.'
        :'Esos USDT ya se usaron: primero cambiá o borrá las ventas que salieron de ellos.';
    if(o.campo)r.campo=o.campo;
    return r;
}
/* Antes de cualquier cambio: si llegó algo del servidor y su recálculo está
   pendiente, se hace ahora, para validar con los saldos de verdad. */
function _alDia(){if(typeof v2AlDia==='function')v2AlDia()}

/* ─── Eliminados ────────────────────────────────────────────────────────── */
function eliminadosLista(){
    if(!AppState.datos)return[];
    if(!Array.isArray(AppState.datos.eliminados))AppState.datos.eliminados=[];
    return AppState.datos.eliminados;
}
function _purgarEliminados(){
    const limite=Date.now()-ELIMINADOS_DIAS*86400000;
    AppState.datos.eliminados=eliminadosLista()
        .filter(x=>x&&x.r&&x.e&&Date.parse(x.t)>=limite)
        .slice(0,ELIMINADOS_MAX);
}
function _copiaLimpia(rec){
    const r=JSON.parse(JSON.stringify(rec));
    delete r._syncState;delete r.consumedLots;delete r.costoUsdt;
    return r;
}
/* Mover a Eliminados y sacar de su lista. Devuelve la clave para deshacer. */
function eliminarRegistro(entidad,id){
    _alDia();
    const rec=entidad==='lotes'
        ?(AppState.datos.lotes||[]).find(l=>l&&String(l.id)===String(id))
        :buscarRegistro(entidad,id);
    if(!rec)return{ok:false,error:'Ese movimiento ya no existe.'};
    if(entidad==='lotes'&&!rec.manual)return{ok:false,error:'Este lote viene de una compra: para sacarlo, borrá la compra.'};
    /* Los lotes de arrastre se declaran aparte: lo que vale es su declaración
       (el lote calculado puede tener sumadas compras al mismo precio) */
    const decl=entidad==='lotes'&&rec.carryover?(AppState.datos._archivoCarryover||[]).find(x=>String(x.id)===String(rec.id)):null;
    const probs=revisarNegativos([{entidad,antes:decl||rec,despues:null}]);
    if(probs.length)return _bloqueoNegativo(probs,{borrar:true});
    const clave=entidad+':'+rec.id+':'+Date.now();
    let copia=_copiaLimpia(rec);
    if(entidad==='lotes'){
        /* Hay que sacar también la declaración del de arrastre: si no, el
           recálculo lo vuelve a crear */
        if(decl)copia=_copiaLimpia(decl);
        if(rec.carryover&&Array.isArray(AppState.datos._archivoCarryover))
            AppState.datos._archivoCarryover=AppState.datos._archivoCarryover.filter(x=>String(x.id)!==String(rec.id));
        AppState.datos.lotes=AppState.datos.lotes.filter(l=>String(l.id)!==String(rec.id));
    }else{
        _quitarDeLista(entidad,rec.id);
    }
    eliminadosLista().unshift({k:clave,e:entidad,r:copia,t:new Date().toISOString(),...(rec.carryover?{arrastre:true}:{})});
    _purgarEliminados();
    confirmarCambios([{tipo:'delete',entidad,id:rec.id},{tipo:'update',entidad:'config',id:'eliminados'}]);
    return{ok:true,clave};
}
function restaurarEliminado(clave){
    _alDia();
    const lista=eliminadosLista();
    const i=lista.findIndex(x=>x&&x.k===clave);
    if(i<0)return{ok:false,error:'Ya no está en Eliminados.'};
    const {e:entidad,r:rec}=lista[i];
    const yaEsta=entidad==='lotes'
        ?(AppState.datos.lotes||[]).some(l=>l&&String(l.id)===String(rec.id))
        :!!buscarRegistro(entidad,rec.id);
    if(yaEsta){
        lista.splice(i,1);guardaOptimista('update','config','eliminados');
        return{ok:false,error:'Ya está otra vez en el registro.'};
    }
    if(entidad!=='lotes'){
        const arch=ultimoMesArchivado();
        if(arch&&String(rec.fecha||'').slice(0,7)<=arch)return{ok:false,error:'Es de un mes que ya se archivó: no se puede recuperar.'};
    }
    const probs=revisarNegativos([{entidad,antes:null,despues:rec}]);
    if(probs.length)return _bloqueoNegativo(probs);
    const copia=JSON.parse(JSON.stringify(rec));
    copia.cambios=[{t:new Date().toISOString(),c:[{f:'recuperado',a:'',d:''}]},...normalizarCambios(copia.cambios)].slice(0,CAMBIOS_MAX);
    if(entidad==='lotes'){
        if(lista[i].arrastre){
            if(!Array.isArray(AppState.datos._archivoCarryover))AppState.datos._archivoCarryover=[];
            AppState.datos._archivoCarryover.push({...copia,carryover:true});
        }else{
            AppState.datos.lotes.push({...copia,manual:true,disponible:copia.cantidad});
        }
    }else{
        _ponerEnLista(entidad,copia);
    }
    lista.splice(i,1);
    confirmarCambios([{tipo:'create',entidad,id:copia.id},{tipo:'update',entidad:'config',id:'eliminados'}]);
    return{ok:true,entidad,id:copia.id};
}

/* ─── Guardado común ────────────────────────────────────────────────────── */
/* v8.2.0 — Ni lo nuevo ni una edición pueden dejar algo en negativo, en
   ningún momento del libro (ver revisarNegativos). No se puede forzar. */
function _chequeoSaldos(entidad,viejo,nuevo){
    const probs=revisarNegativos([{entidad,antes:viejo,despues:nuevo}]);
    return probs.length?_bloqueoNegativo(probs):null;
}
function _fechaHoraDe(d,viejo){
    const ahora=ahoraUY();
    const fecha=d.fecha||(viejo&&viejo.fecha)||ahora.fecha;
    const hora=d.hora||(viejo&&viejo.hora)||ahora.hora;
    return{fecha,hora};
}
function _chequeoFecha(fecha,hora,viejo){
    /* Si la fecha no cambió no se vuelve a revisar: un registro de hoy a las
       23:59 cargado ayer no tiene por qué fallar */
    if(viejo&&viejo.fecha===fecha&&(viejo.hora||'')===(hora||''))return null;
    const p=problemaConFecha(fecha,hora);
    return p?{ok:false,error:p,campo:'fecha'}:null;
}
function _terminar(entidad,viejo,nuevo,extra){
    if(viejo)anotarCambios(entidad,viejo,nuevo);
    _ponerEnLista(entidad,nuevo);
    confirmarCambios([...(extra||[]),{tipo:viejo?'update':'create',entidad,id:nuevo.id}]);
    return{ok:true,id:nuevo.id,entidad};
}
function _limpiarParaGuardar(rec){
    delete rec._syncState;delete rec.consumedLots;delete rec.costoUsdt;
    return rec;
}

/* ─── Compras y ventas de USDT ──────────────────────────────────────────── */
/* d = {tipo, monto, tasa, banco, aportes:[{banco,monto}]?, comisionBanco,
        comisionPct, fecha, hora}. En una edición el tipo no cambia. */
function guardarOperacion(d,opts){
    opts=opts||{};
    _alDia();
    const viejo=opts.id!=null?buscarRegistro('operaciones',opts.id):null;
    if(opts.id!=null&&!viejo)return{ok:false,error:'Esa operación ya no existe.'};
    const tipo=viejo?viejo.tipo:(d.tipo==='venta'?'venta':'compra');
    const monto=roundMoney(Number(d.monto)||0),tasa=Number(d.tasa)||0;
    if(!(monto>0))return{ok:false,error:'Ingresá el monto.',campo:'monto'};
    if(!(tasa>0))return{ok:false,error:'Ingresá la tasa.',campo:'tasa'};
    let aportes=null;
    if(tipo==='compra'&&Array.isArray(d.aportes)){
        const a=d.aportes.filter(x=>x&&x.banco&&roundMoney(Number(x.monto)||0)>0)
                         .map(x=>({banco:x.banco,monto:roundMoney(Number(x.monto))}));
        if(a.length>1)aportes=a;
    }
    const banco=aportes?aportes[0].banco:d.banco;
    const bk=banco&&AppState.datos.bancos[banco];
    if(!bk||!getBancoInfo(banco))return{ok:false,error:'Elegí la cuenta.',campo:'cuenta'};
    const moneda=monedaDeCuenta(banco);
    if(viejo&&(viejo.moneda||'UYU')!==moneda)return{ok:false,error:'No se puede pasar a una cuenta en otra moneda. Borrala y cargala de nuevo.',campo:'cuenta'};
    const cb=tipo==='compra'?roundMoney(Number(d.comisionBanco)||0):0;
    if(cb<0)return{ok:false,error:'La comisión del banco no puede ser negativa.',campo:'comisiones'};
    const cpct=(d.comisionPct===undefined||d.comisionPct===null||d.comisionPct===''||!isFinite(Number(d.comisionPct)))
        ?(viejo&&isFinite(viejo.comisionPct)?Number(viejo.comisionPct):comisionConfigurada(moneda))
        :Number(d.comisionPct);
    if(cpct<0||cpct>5)return{ok:false,error:'La comisión de Binance tiene que estar entre 0 y 5 %.',campo:'comisiones'};
    if(aportes){
        for(const a of aportes){
            if(!AppState.datos.bancos[a.banco]||monedaDeCuenta(a.banco)!==moneda)
                return{ok:false,error:'Todas las cuentas del pago tienen que ser de la misma moneda.',campo:'cuenta'};
        }
        const suma=aportes.reduce((s,a)=>roundMoney(s+a.monto),0),total=roundMoney(monto+cb);
        if(Math.abs(suma-total)>=0.005)return{ok:false,campo:'cuenta',
            error:suma<total?'Falta repartir '+fmtMonto(roundMoney(total-suma),moneda)+'.':'Repartiste '+fmtMonto(roundMoney(suma-total),moneda)+' de más.'};
    }
    const {fecha,hora}=_fechaHoraDe(d,viejo);
    const pf=_chequeoFecha(fecha,hora,viejo);if(pf)return pf;
    const uBase=usdtBase(monto/tasa,tipo),cpl=truncar(uBase*(cpct/100),2);
    if(!(usdtNeto(uBase,cpl,tipo)>0))return{ok:false,error:'El monto es demasiado chico para esa tasa.',campo:'monto'};
    const nuevo=_limpiarParaGuardar({...(viejo?JSON.parse(JSON.stringify(viejo)):{}),
        id:viejo?viejo.id:uid(),tipo,monto,tasa,usdt:uBase,banco,moneda,
        comisionBanco:cb,comisionPlataforma:cpl,comisionPct:cpct,fecha,hora,
        timestamp:_marcaDe(fecha,hora)});
    if(aportes)nuevo.aportes=aportes;else delete nuevo.aportes;
    if(!viejo){nuevo.creado=new Date().toISOString();nuevo.ganancia=0}
    const sal=_chequeoSaldos('operaciones',viejo,nuevo);if(sal)return sal;
    /* Cupo diario, solo si cae en el cupo de hoy. v8.2.0 — Las cuentas que
       comparten límite (Itaú personal e Itaú empresa) suman juntas: un pago
       dividido entre las dos se compara entero contra el mismo cupo. */
    if(tipo==='compra'){
        const pide={};
        for(const a of aportesDe(nuevo)){
            const duena=cuentaDelLimite(a.banco);
            if(fecha<_cupoDesde(duena))continue;
            const req=moneda==='USD'?roundMoney(a.monto):truncar(a.monto/tasa);
            pide[duena]=roundMoney((pide[duena]||0)+req);
        }
        for(const duena of Object.keys(pide)){
            const disp=cupoDisponibleUSD(duena,viejo?{tipo:'operaciones',id:viejo.id}:null);
            if(disp===Infinity)continue;
            const req=pide[duena];
            if(req>disp+0.005){
                const txt=nombreDelCupo(duena)+': el cupo de hoy no alcanza. Quedan US$'+fmtNum(Math.max(0,disp),0)+' y esta compra usa US$'+fmtNum(req,0)+'.';
                if(!viejo)return{ok:false,error:txt,campo:'cuenta'};
                if(!opts.forzar)return{ok:false,confirmar:txt};
            }
        }
    }
    return _terminar('operaciones',viejo,nuevo);
}

/* ─── Ingresos y egresos ────────────────────────────────────────────────── */
/* d = {tipoMovimiento, cuenta ('USDT' o un banco), monto, tasaRef, descripcion,
        nota, fecha, hora} */
function guardarMovimiento(d,opts){
    opts=opts||{};
    _alDia();
    const viejo=opts.id!=null?buscarRegistro('movimientos',opts.id):null;
    if(opts.id!=null&&!viejo)return{ok:false,error:'Ese movimiento ya no existe.'};
    const tipoMovimiento=d.tipoMovimiento==='ingreso'?'ingreso':'egreso';
    const esUsdt=d.cuenta==='USDT';
    if(!esUsdt&&!(d.cuenta&&AppState.datos.bancos[d.cuenta]))return{ok:false,error:'Elegí la cuenta.',campo:'cuenta'};
    const monto=esUsdt?truncUsdt(Number(d.monto)||0):roundMoney(Number(d.monto)||0);
    if(!(monto>0))return{ok:false,error:'Ingresá el monto.',campo:'monto'};
    const tasaRef=(esUsdt&&tipoMovimiento==='ingreso')?Number(d.tasaRef)||0:0;
    if(esUsdt&&tipoMovimiento==='ingreso'&&!(tasaRef>0))
        return{ok:false,error:'Indicá a cuánto te salió cada USDT, para saber su costo.',campo:'tasaRef'};
    const descripcion=normalizarTag(d.descripcion||'');
    const nota=String(d.nota||'').trim().slice(0,140);
    const {fecha,hora}=_fechaHoraDe(d,viejo);
    const pf=_chequeoFecha(fecha,hora,viejo);if(pf)return pf;
    const nuevo=_limpiarParaGuardar({...(viejo?JSON.parse(JSON.stringify(viejo)):{}),
        id:viejo?viejo.id:uid(),tipoMovimiento,tipoCuenta:esUsdt?'usdt':'banco',banco:esUsdt?null:d.cuenta,
        monto,valorUYU:0,tasaRef,descripcion,fecha,hora,timestamp:_marcaDe(fecha,hora)});
    if(nota)nuevo.nota=nota;else delete nuevo.nota;
    if(!viejo)nuevo.creado=new Date().toISOString();
    const sal=_chequeoSaldos('movimientos',viejo,nuevo);if(sal)return sal;
    if(descripcion&&!(AppState.datos.tags||[]).some(t=>tagKey(t)===tagKey(descripcion)))agregarTag(descripcion);
    return _terminar('movimientos',viejo,nuevo);
}

/* ─── Transferencias y conversiones ─────────────────────────────────────── */
/* d = {origen, destino, monto, comision, tasa, fecha, hora}. Si las cuentas
   son de distinta moneda es una conversión y hace falta la tasa.
   opts.id + opts.entidad para editar (puede cambiar de una a la otra). */
function guardarTransferencia(d,opts){
    opts=opts||{};
    _alDia();
    const entViejo=opts.entidad==='conversiones'?'conversiones':'transferencias';
    const viejo=opts.id!=null?buscarRegistro(entViejo,opts.id):null;
    if(opts.id!=null&&!viejo)return{ok:false,error:'Esa transferencia ya no existe.'};
    const o=d.origen,de=d.destino;
    if(!o||!AppState.datos.bancos[o])return{ok:false,error:'Elegí de qué cuenta sale.',campo:'origen'};
    if(!de||!AppState.datos.bancos[de])return{ok:false,error:'Elegí a qué cuenta entra.',campo:'destino'};
    if(o===de)return{ok:false,error:'Elegí dos cuentas distintas.',campo:'destino'};
    const monto=roundMoney(Number(d.monto)||0);
    if(!(monto>0))return{ok:false,error:'Ingresá el monto.',campo:'monto'};
    const mo=monedaDeCuenta(o),md=monedaDeCuenta(de),cruce=mo!==md;
    const comision=cruce?0:roundMoney(Number(d.comision)||0);
    if(comision<0)return{ok:false,error:'La comisión no puede ser negativa.',campo:'comision'};
    const tasa=cruce?Number(d.tasa)||0:0;
    if(cruce&&!(tasa>0))return{ok:false,error:'Indicá la tasa de la conversión.',campo:'tasa'};
    const {fecha,hora}=_fechaHoraDe(d,viejo);
    const pf=_chequeoFecha(fecha,hora,viejo);if(pf)return pf;
    const entNueva=cruce?'conversiones':'transferencias';
    const base={id:viejo?viejo.id:uid(),origen:o,destino:de,fecha,hora,timestamp:_marcaDe(fecha,hora),
                ...(viejo&&viejo.creado?{creado:viejo.creado}:{creado:new Date().toISOString()}),
                ...(viejo&&viejo.cambios?{cambios:viejo.cambios}:{})};
    const nuevo=cruce
        ?{...base,montoOrigen:monto,montoDestino:mo==='UYU'&&md==='USD'?roundMoney(monto/tasa):roundMoney(monto*tasa),
          tasa,monedaOrigen:mo,monedaDestino:md}
        :{...base,monto,comision};
    /* Validación con lo viejo y lo nuevo, aunque cambie de transferencia a
       conversión o al revés. v8.2.0 — Las transferencias entre tus cuentas no
       gastan el cupo diario: el banco no las cuenta en el límite. */
    const cambios=!viejo?[{entidad:entNueva,antes:null,despues:nuevo}]
        :entViejo===entNueva?[{entidad:entNueva,antes:viejo,despues:nuevo}]
        :[{entidad:entViejo,antes:viejo,despues:null},{entidad:entNueva,antes:null,despues:nuevo}];
    const probs=revisarNegativos(cambios);
    if(probs.length)return _bloqueoNegativo(probs);
    if(viejo&&entViejo!==entNueva){
        /* Cambió de transferencia a conversión o al revés: cambia de lista,
           conserva el id, la fecha y lo anotado */
        anotarCambios(entNueva,{...viejo,tasa:viejo.tasa||0,montoOrigen:viejo.montoOrigen||viejo.monto},nuevo);
        _quitarDeLista(entViejo,viejo.id);
        _ponerEnLista(entNueva,nuevo);
        confirmarCambios([{tipo:'delete',entidad:entViejo,id:viejo.id},{tipo:'update',entidad:entNueva,id:nuevo.id}]);
        return{ok:true,id:nuevo.id,entidad:entNueva};
    }
    return _terminar(entNueva,viejo,nuevo);
}

/* ─── Correcciones de saldo ─────────────────────────────────────────────── */
/* Desde "Corregir saldo": se dice cuánto hay de verdad en el banco y queda
   anotada la diferencia. */
function corregirSaldo(cuenta,saldoReal,motivo){
    _alDia();
    if(!AppState.datos.bancos[cuenta])return{ok:false,error:'Elegí la cuenta.',campo:'cuenta'};
    const real=roundMoney(Number(saldoReal));
    if(saldoReal===''||saldoReal===null||saldoReal===undefined||!isFinite(Number(saldoReal)))return{ok:false,error:'Ingresá el saldo real.',campo:'monto'};
    /* v8.2.0 — Una cuenta no puede tener saldo negativo. La corrección queda
       como último asiento del libro, así que con un saldo real de cero o más
       la cuenta no queda en negativo en ningún momento. */
    if(real<-_NEG)return{ok:false,error:'El saldo no puede ser negativo.',campo:'monto'};
    const aj=registrarAjusteSaldo(cuenta,real,motivo);
    if(!aj)return{ok:false,error:'Ese ya es el saldo registrado: no hay nada que corregir.',campo:'monto'};
    aj.creado=aj.timestamp;
    _quitarDeLista('ajustesSaldo',aj.id);_insertarOrdenado(listaDe('ajustesSaldo'),aj);
    confirmarCambios([{tipo:'create',entidad:'ajustesSaldo',id:aj.id}]);
    return{ok:true,id:aj.id,entidad:'ajustesSaldo',delta:aj.delta};
}
/* Editar una corrección ya hecha: diferencia (con signo) y motivo */
function editarCorreccion(id,d){
    _alDia();
    const viejo=buscarRegistro('ajustesSaldo',id);
    if(!viejo)return{ok:false,error:'Esa corrección ya no existe.'};
    const delta=roundMoney(Number(d.delta)||0);
    if(Math.abs(delta)<0.005)return{ok:false,error:'Ingresá la diferencia. Para quitar la corrección, borrala.',campo:'monto'};
    const nuevo=_limpiarParaGuardar({...JSON.parse(JSON.stringify(viejo)),delta,motivo:String(d.motivo||'').trim().slice(0,120)});
    const sal=_chequeoSaldos('ajustesSaldo',viejo,nuevo);if(sal)return sal;
    return _terminar('ajustesSaldo',viejo,nuevo);
}

/* ─── Lotes de USDT cargados a mano ─────────────────────────────────────── */
/* d = {cantidad, precio, fecha}. Los de arrastre del archivo se editan en su
   declaración, que es lo único que el recálculo respeta. */
function guardarLoteManual(d,opts){
    opts=opts||{};
    _alDia();
    const cantidad=truncUsdt(Number(d.cantidad)||0),precio=roundMoney(Number(d.precio)||0,3);
    if(!(cantidad>0))return{ok:false,error:'Ingresá cuántos USDT.',campo:'cantidad'};
    if(!(precio>0))return{ok:false,error:'Ingresá a cuánto te salió cada uno.',campo:'precio'};
    const fecha=d.fecha||getUDateStr();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)||fecha>getUDateStr())return{ok:false,error:'Elegí una fecha válida.',campo:'fecha'};
    if(opts.id!=null){
        const l=(AppState.datos.lotes||[]).find(x=>x&&String(x.id)===String(opts.id));
        if(!l||!l.manual)return{ok:false,error:'Ese lote no se puede editar acá.'};
        const decl=l.carryover?(AppState.datos._archivoCarryover||[]).find(x=>String(x.id)===String(l.id)):l;
        const antes={...(decl||l)};
        /* v8.2.0 — Bajar la cantidad o correr la fecha después de ventas que
           usaron esos USDT dejaría vendido lo que no se tenía */
        const probs=revisarNegativos([{entidad:'lotes',antes,despues:{...antes,cantidad,precioCompra:precio,fecha}}]);
        if(probs.length)return _bloqueoNegativo(probs,{campo:'cantidad'});
        [l,decl].forEach(x=>{if(x){x.precioCompra=precio;x.cantidad=cantidad;x.disponible=cantidad;x.fecha=fecha}});
        if(decl)anotarCambios('lotes',antes,decl);
        if(decl&&decl!==l)l.cambios=decl.cambios;
        confirmarCambios([{tipo:'update',entidad:'lotes',id:l.id}]);
        return{ok:true,id:l.id,entidad:'lotes'};
    }
    const id=uid();
    AppState.datos.lotes.push({id,fecha,hora:getUTimeStr(),precioCompra:precio,cantidad,disponible:cantidad,moneda:'UYU',manual:true,creado:new Date().toISOString()});
    confirmarCambios([{tipo:'create',entidad:'lotes',id}]);
    return{ok:true,id,entidad:'lotes'};
}

/* ─── Configuración de cuentas ──────────────────────────────────────────── */
/* v8.2.0 — o.propio (solo cuentas agregadas): true para que tenga su propio
   límite, false para que use el de la cuenta de siempre de su banco. Sin
   decirlo, sigue como estaba. El límite se guarda en la cuenta dueña. */
function guardarLimiteCuenta(cuenta,limiteUSD,diasReset,o){
    o=o||{};
    const bk=AppState.datos.bancos[cuenta];
    if(!bk)return{ok:false,error:'Esa cuenta no existe.'};
    const lim=roundMoney(Number(limiteUSD)||0);
    if(lim<0)return{ok:false,error:'El límite no puede ser negativo.',campo:'limite'};
    const cambios=[];
    if(esCuentaAgregada(cuenta)&&typeof o.propio==='boolean'&&o.propio!==(bk.limitePropio===true)){
        bk.limitePropio=o.propio;
        cambios.push({tipo:'update',entidad:'bancos',id:cuenta});
    }
    const duena=cuentaDelLimite(cuenta),bd=AppState.datos.bancos[duena];
    if(!bd)return{ok:false,error:'Esa cuenta no existe.'};
    bd.limiteDiarioUSD=lim;
    const dias=(diasReset||[]).map(Number).filter(x=>x>=0&&x<=6);
    bd.diasReset=dias.length?Array.from(new Set(dias)).sort((a,b)=>a-b):DIAS_RESET_TODOS.slice();
    if(duena!==cuenta||!cambios.length)cambios.push({tipo:'update',entidad:'bancos',id:duena});
    confirmarCambios(cambios);
    return{ok:true,cuenta:duena};
}
function activarCuenta(cuenta,activa){
    if(!AppState.datos.bancos[cuenta])AppState.datos.bancos[cuenta]={activo:false,saldo:0,limiteDiarioUSD:0,limiteUsadoUSD:0,ultimoResetLimite:null};
    AppState.datos.bancos[cuenta].activo=!!activa;
    confirmarCambios([{tipo:'update',entidad:'bancos',id:cuenta}]);
    return{ok:true};
}
/* ─── v8.1.0 — Cuentas agregadas y nombres de cuenta ────────────────────── */
/* Una persona puede tener varias cuentas en el mismo banco (Itaú empresa e
   Itaú personal) y alguna en dólares (Itaú dólares). Cada una lleva su saldo,
   su límite y su libro, igual que las de siempre. */
const CUENTA_NOMBRE_MAX=24;
function _claveNombreCuenta(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim()}
/* El nombre como se escribió, sin espacios de más; error si es corto o repetido */
function revisarNombreCuenta(nombre,excepto){
    const n=String(nombre||'').trim().replace(/\s+/g,' ').slice(0,CUENTA_NOMBRE_MAX);
    if(n.length<2)return{ok:false,error:'Escribí un nombre de al menos 2 letras.',campo:'nombre'};
    const k=_claveNombreCuenta(n);
    const otra=todasLasCuentas().find(b=>b.nombre!==excepto&&_claveNombreCuenta(b.etiqueta||b.nombre)===k);
    if(otra)return{ok:false,error:'Ya tenés una cuenta que se llama '+nombreCuenta(otra.nombre)+'.',campo:'nombre'};
    return{ok:true,nombre:n};
}
/* d = {banco, moneda, nombre, saldo}. La cuenta queda activa; si se dice
   cuánto tiene, se anota como su saldo inicial (una corrección, igual que
   "Corregir saldo"). */
function crearCuenta(d){
    d=d||{};
    _alDia();
    const base=CONFIG.BANCOS.find(b=>b.nombre===d.banco);
    if(!base)return{ok:false,error:'Elegí el banco.',campo:'banco'};
    const moneda=d.moneda==='USD'?'USD':'UYU';
    const r=revisarNombreCuenta(d.nombre);if(!r.ok)return r;
    const saldo=(d.saldo===undefined||d.saldo===null||d.saldo==='')?0:roundMoney(Number(d.saldo));
    if(!isFinite(saldo)||saldo<0)return{ok:false,error:'El saldo no puede ser negativo.',campo:'saldo'};
    let clave;
    do{clave=base.nombre+'_'+moneda+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,4)}while(AppState.datos.bancos[clave]);
    const ahora=new Date().toISOString();
    AppState.datos.bancos[clave]={nombre:r.nombre,activo:true,saldo:0,saldoApertura:0,saldoAperturaTs:ahora,
        limiteDiarioUSD:0,limiteUsadoUSD:0,ultimoResetLimite:null,creada:ahora,
        limitePropio:false};   /* v8.2.0: usa el límite de la cuenta de siempre de su banco */
    confirmarCambios([{tipo:'update',entidad:'bancos',id:clave}]);
    if(saldo>=0.005)corregirSaldo(clave,saldo,'Saldo inicial');
    return{ok:true,clave,nombre:r.nombre};
}
/* Cambiar el nombre. En las cuentas de siempre, dejarlo vacío o igual al del
   banco le devuelve el nombre del banco. */
function renombrarCuenta(cuenta,nombre){
    const bk=AppState.datos.bancos[cuenta];
    if(!bk||!getBancoInfo(cuenta))return{ok:false,error:'Esa cuenta no existe.'};
    const fija=CONFIG.BANCOS.find(b=>b.nombre===cuenta);
    const txt=String(nombre||'').trim();
    if(fija&&(!txt||_claveNombreCuenta(txt)===_claveNombreCuenta(fija.etiqueta||fija.nombre))){
        delete bk.nombre;
    }else{
        const r=revisarNombreCuenta(txt,cuenta);if(!r.ok)return r;
        bk.nombre=r.nombre;
    }
    confirmarCambios([{tipo:'update',entidad:'bancos',id:cuenta}]);
    return{ok:true,nombre:nombreCuenta(cuenta)};
}
/* Cuántas operaciones, ingresos, egresos, transferencias y conversiones usan una cuenta */
function usosDeCuenta(cuenta){
    let n=0;
    (AppState.datos.operaciones||[]).forEach(o=>{if(o&&(o.banco===cuenta||(Array.isArray(o.aportes)&&o.aportes.some(a=>a&&a.banco===cuenta))))n++});
    (AppState.datos.movimientos||[]).forEach(m=>{if(m&&m.tipoCuenta!=='usdt'&&m.banco===cuenta)n++});
    ['transferencias','conversiones'].forEach(e=>(AppState.datos[e]||[]).forEach(t=>{if(t&&(t.origen===cuenta||t.destino===cuenta))n++}));
    return n;
}
/* Borrar una cuenta agregada que no tiene movimientos. Sus correcciones de
   saldo (por ejemplo, el saldo inicial) se van con ella. Si algo de Eliminados
   la usaba y se recupera, la cuenta vuelve sola (ver inicializarBancos). */
function borrarCuenta(cuenta){
    _alDia();
    const bk=AppState.datos.bancos[cuenta];
    if(!bk||!esCuentaAgregada(cuenta))return{ok:false,error:'Esta cuenta no se puede borrar. Si no la usás, desactivala.'};
    const n=usosDeCuenta(cuenta);
    if(n>0)return{ok:false,error:'Tiene '+(n===1?'un movimiento':n+' movimientos')+': no se puede borrar. Si no la usás más, desactivala.'};
    /* Movimientos de meses archivados: su efecto vive en el saldo de apertura */
    if(Math.abs(Number(bk.saldoApertura)||0)>=0.005)return{ok:false,error:'Tiene movimientos de meses archivados: no se puede borrar. Si no la usás más, desactivala.'};
    const ajustes=(AppState.datos.ajustesSaldo||[]).filter(a=>a&&a.cuenta===cuenta);
    AppState.datos.ajustesSaldo=(AppState.datos.ajustesSaldo||[]).filter(a=>!(a&&a.cuenta===cuenta));
    delete AppState.datos.bancos[cuenta];
    confirmarCambios([...ajustes.map(a=>({tipo:'delete',entidad:'ajustesSaldo',id:a.id})),{tipo:'update',entidad:'bancos',id:cuenta}]);
    return{ok:true};
}
function guardarComisionBinance(pctPesos,pctDolares){
    const a=Number(pctPesos),b=Number(pctDolares);
    if(!(a>=0&&a<=5)||!(b>=0&&b<=5))return{ok:false,error:'La comisión tiene que estar entre 0 y 5 %.'};
    AppState.datos.comisionPlataforma=a;AppState.datos.comisionUSD=b;
    guardaOptimista('update','settings','comision');
    return{ok:true};
}
