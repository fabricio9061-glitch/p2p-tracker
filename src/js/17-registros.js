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
     {ok:false, confirmar}              se puede, pero algo queda raro (un saldo
                                        en negativo, por ejemplo): la pantalla
                                        pregunta y, si la persona acepta, vuelve
                                        a llamar con {forzar:true}.             */

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
function anotarCambios(entidad,antes,despues){
    const c=[];
    (CAMPOS_CAMBIO[entidad]||[]).forEach(campo=>{
        const a=_valorCampo(entidad,antes,campo),d=_valorCampo(entidad,despues,campo);
        const iguales=(typeof a==='number'&&typeof d==='number')?Math.abs(a-d)<1e-9:String(a)===String(d);
        if(!iguales)c.push([campo,a,d]);
    });
    if(!c.length)return 0;
    const previos=Array.isArray(antes&&antes.cambios)?antes.cambios:[];
    despues.cambios=[{t:new Date().toISOString(),c},...previos].slice(0,CAMBIOS_MAX);
    despues.editadoEn=despues.cambios[0].t;
    return c.length;
}

/* ─── Problemas de saldo, en palabras ──────────────────────────────────── */
/* deltas = {bancos:{cuenta:variación}, usdt, usdtMoneda} */
function problemasDeSaldo(deltas){
    const lineas=[];
    Object.entries((deltas&&deltas.bancos)||{}).forEach(([n,dl])=>{
        const bk=AppState.datos.bancos[n];if(!bk||!(dl<0))return;
        const nuevo=roundMoney((bk.saldo||0)+dl);
        if(nuevo<-INTEG_EPSILON)lineas.push(nombreCuenta(n)+' quedaría en −'+fmtMonto(Math.abs(nuevo),monedaDeCuenta(n)));
    });
    if(deltas&&deltas.usdt<0){
        const disp=deltas.usdtMoneda?usdtDisponibleEn(deltas.usdtMoneda):roundMoney(AppState.datos.saldoUsdt||0);
        const falta=roundMoney(-deltas.usdt-disp);
        if(falta>INTEG_EPSILON)lineas.push('Te faltarían '+fmtTrunc(falta,2)+' USDT (tenés '+fmtTrunc(Math.max(0,disp),2)+')');
    }
    return lineas;
}
function _usdtDe(entidad,rec){
    if(!rec)return 0;
    if(entidad==='lotes')return roundMoney(rec.cantidad||0);
    return efectoEnUsdt(entidad,rec)||0;
}
function _monedaUsdtDe(entidad,rec){
    if(entidad==='operaciones')return rec.moneda||'UYU';
    if(entidad==='lotes')return rec.moneda||'UYU';
    return'UYU';   /* los movimientos de USDT van contra lotes en pesos, por convención */
}
/* Diferencia completa (cuentas y USDT) entre dos versiones de un registro */
function deltasEntre(entidad,antes,despues){
    const d=entidad==='lotes'?{bancos:{}}:diferenciaDeEfecto(entidad,antes,despues);
    const ref=despues||antes;
    const du=roundMoney(_usdtDe(entidad,despues)-_usdtDe(entidad,antes));
    if(Math.abs(du)>=0.005){d.usdt=du;if(du<0)d.usdtMoneda=_monedaUsdtDe(entidad,ref)}
    return d;
}

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
function eliminarRegistro(entidad,id,opts){
    opts=opts||{};
    const rec=entidad==='lotes'
        ?(AppState.datos.lotes||[]).find(l=>l&&String(l.id)===String(id))
        :buscarRegistro(entidad,id);
    if(!rec)return{ok:false,error:'Ese movimiento ya no existe.'};
    if(entidad==='lotes'&&!rec.manual)return{ok:false,error:'Este lote viene de una compra: para sacarlo, borrá la compra.'};
    if(!opts.forzar){
        const probs=problemasDeSaldo(deltasEntre(entidad,rec,null));
        if(probs.length)return{ok:false,confirmar:'Si lo borrás:\n'+probs.join('\n')};
    }
    const clave=entidad+':'+rec.id+':'+Date.now();
    let copia=_copiaLimpia(rec);
    if(entidad==='lotes'){
        /* Los de arrastre se declaran aparte: hay que sacar su declaración, si no
           el recálculo los vuelve a crear */
        const decl=rec.carryover?(AppState.datos._archivoCarryover||[]).find(x=>String(x.id)===String(rec.id)):null;
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
function restaurarEliminado(clave,opts){
    opts=opts||{};
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
    if(!opts.forzar){
        const probs=problemasDeSaldo(deltasEntre(entidad,null,rec));
        if(probs.length)return{ok:false,confirmar:'Si lo recuperás:\n'+probs.join('\n')};
    }
    const copia=JSON.parse(JSON.stringify(rec));
    copia.cambios=[{t:new Date().toISOString(),c:[['recuperado','','']]},...(copia.cambios||[])].slice(0,CAMBIOS_MAX);
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
/* Valida saldos con la regla del libro: lo nuevo se bloquea, una edición o
   un borrado se pregunta (si no, un error viejo quedaría atrapado). */
function _chequeoSaldos(entidad,viejo,nuevo,opts){
    const probs=problemasDeSaldo(deltasEntre(entidad,viejo,nuevo));
    if(!probs.length)return null;
    if(!viejo)return{ok:false,error:probs.join('. ')+'.'};
    if(opts.forzar)return null;
    return{ok:false,confirmar:'Con este cambio:\n'+probs.join('\n')};
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
    const sal=_chequeoSaldos('operaciones',viejo,nuevo,opts);if(sal)return sal;
    /* Cupo diario de cada cuenta que paga, solo si cae en el cupo de hoy */
    if(tipo==='compra'){
        for(const a of aportesDe(nuevo)){
            if(fecha<_cupoDesde(a.banco))continue;
            const disp=cupoDisponibleUSD(a.banco,viejo?{tipo:'operaciones',id:viejo.id}:null);
            if(disp===Infinity)continue;
            const req=moneda==='USD'?roundMoney(a.monto):truncar(a.monto/tasa);
            if(req>disp+0.005){
                const txt=nombreCuenta(a.banco)+': el cupo de hoy no alcanza. Quedan US$'+fmtNum(Math.max(0,disp),0)+' y esta compra usa US$'+fmtNum(req,0)+'.';
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
    const sal=_chequeoSaldos('movimientos',viejo,nuevo,opts);if(sal)return sal;
    if(descripcion&&!(AppState.datos.tags||[]).some(t=>tagKey(t)===tagKey(descripcion)))agregarTag(descripcion);
    return _terminar('movimientos',viejo,nuevo);
}

/* ─── Transferencias y conversiones ─────────────────────────────────────── */
/* d = {origen, destino, monto, comision, tasa, fecha, hora}. Si las cuentas
   son de distinta moneda es una conversión y hace falta la tasa.
   opts.id + opts.entidad para editar (puede cambiar de una a la otra). */
function guardarTransferencia(d,opts){
    opts=opts||{};
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
    /* Validación con el efecto de lo viejo y lo nuevo, aunque cambie de tipo */
    const dif=diferenciaDeEfecto(entNueva,null,nuevo);
    if(viejo){
        const quita=diferenciaDeEfecto(entViejo,viejo,null);
        Object.entries(quita.bancos).forEach(([k,v])=>{dif.bancos[k]=roundMoney((dif.bancos[k]||0)+v)});
    }
    const probs=problemasDeSaldo(dif);
    if(probs.length){
        if(!viejo)return{ok:false,error:probs.join('. ')+'.'};
        if(!opts.forzar)return{ok:false,confirmar:'Con este cambio:\n'+probs.join('\n')};
    }
    /* Cupo: una transferencia en la misma moneda también consume el de la cuenta de origen */
    if(!cruce&&fecha>=_cupoDesde(o)){
        const disp=cupoDisponibleUSD(o,viejo&&entViejo==='transferencias'?{tipo:'transferencias',id:viejo.id}:null);
        const req=_montoEnUSDLimite(o,monto+comision);
        if(disp!==Infinity&&req>disp+0.005){
            const txt=nombreCuenta(o)+': el cupo de hoy no alcanza. Quedan US$'+fmtNum(Math.max(0,disp),0)+' y esto usa US$'+fmtNum(req,0)+'.';
            if(!viejo)return{ok:false,error:txt,campo:'origen'};
            if(!opts.forzar)return{ok:false,confirmar:txt};
        }
    }
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
    if(!AppState.datos.bancos[cuenta])return{ok:false,error:'Elegí la cuenta.',campo:'cuenta'};
    const real=roundMoney(Number(saldoReal));
    if(!isFinite(real))return{ok:false,error:'Ingresá el saldo real.',campo:'monto'};
    const aj=registrarAjusteSaldo(cuenta,real,motivo);
    if(!aj)return{ok:false,error:'Ese ya es el saldo registrado: no hay nada que corregir.',campo:'monto'};
    aj.creado=aj.timestamp;
    _quitarDeLista('ajustesSaldo',aj.id);_insertarOrdenado(listaDe('ajustesSaldo'),aj);
    confirmarCambios([{tipo:'create',entidad:'ajustesSaldo',id:aj.id}]);
    return{ok:true,id:aj.id,entidad:'ajustesSaldo',delta:aj.delta};
}
/* Editar una corrección ya hecha: diferencia (con signo) y motivo */
function editarCorreccion(id,d,opts){
    opts=opts||{};
    const viejo=buscarRegistro('ajustesSaldo',id);
    if(!viejo)return{ok:false,error:'Esa corrección ya no existe.'};
    const delta=roundMoney(Number(d.delta)||0);
    if(Math.abs(delta)<0.005)return{ok:false,error:'Ingresá la diferencia. Para quitar la corrección, borrala.',campo:'monto'};
    const nuevo=_limpiarParaGuardar({...JSON.parse(JSON.stringify(viejo)),delta,motivo:String(d.motivo||'').trim().slice(0,120)});
    const sal=_chequeoSaldos('ajustesSaldo',viejo,nuevo,opts);if(sal)return sal;
    return _terminar('ajustesSaldo',viejo,nuevo);
}

/* ─── Lotes de USDT cargados a mano ─────────────────────────────────────── */
/* d = {cantidad, precio, fecha}. Los de arrastre del archivo se editan en su
   declaración, que es lo único que el recálculo respeta. */
function guardarLoteManual(d,opts){
    opts=opts||{};
    const cantidad=truncUsdt(Number(d.cantidad)||0),precio=roundMoney(Number(d.precio)||0,3);
    if(!(cantidad>0))return{ok:false,error:'Ingresá cuántos USDT.',campo:'cantidad'};
    if(!(precio>0))return{ok:false,error:'Ingresá a cuánto te salió cada uno.',campo:'precio'};
    const fecha=d.fecha||getUDateStr();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)||fecha>getUDateStr())return{ok:false,error:'Elegí una fecha válida.',campo:'fecha'};
    if(opts.id!=null){
        const l=(AppState.datos.lotes||[]).find(x=>x&&String(x.id)===String(opts.id));
        if(!l||!l.manual)return{ok:false,error:'Ese lote no se puede editar acá.'};
        const decl=l.carryover?(AppState.datos._archivoCarryover||[]).find(x=>String(x.id)===String(l.id)):l;
        const antes={...decl};
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
function guardarLimiteCuenta(cuenta,limiteUSD,diasReset){
    const bk=AppState.datos.bancos[cuenta];
    if(!bk)return{ok:false,error:'Esa cuenta no existe.'};
    const lim=roundMoney(Number(limiteUSD)||0);
    if(lim<0)return{ok:false,error:'El límite no puede ser negativo.',campo:'limite'};
    bk.limiteDiarioUSD=lim;
    const dias=(diasReset||[]).map(Number).filter(x=>x>=0&&x<=6);
    bk.diasReset=dias.length?Array.from(new Set(dias)).sort((a,b)=>a-b):DIAS_RESET_TODOS.slice();
    confirmarCambios([{tipo:'update',entidad:'bancos',id:cuenta}]);
    return{ok:true};
}
function activarCuenta(cuenta,activa){
    if(!AppState.datos.bancos[cuenta])AppState.datos.bancos[cuenta]={activo:false,saldo:0,limiteDiarioUSD:0,limiteUsadoUSD:0,ultimoResetLimite:null};
    AppState.datos.bancos[cuenta].activo=!!activa;
    confirmarCambios([{tipo:'update',entidad:'bancos',id:cuenta}]);
    return{ok:true};
}
function guardarComisionBinance(pctPesos,pctDolares){
    const a=Number(pctPesos),b=Number(pctDolares);
    if(!(a>=0&&a<=5)||!(b>=0&&b<=5))return{ok:false,error:'La comisión tiene que estar entre 0 y 5 %.'};
    AppState.datos.comisionPlataforma=a;AppState.datos.comisionUSD=b;
    guardaOptimista('update','settings','comision');
    return{ok:true};
}
