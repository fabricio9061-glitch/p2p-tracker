function sincronizarSaldoUsdt(){AppState.datos.saldoUsdt=roundMoney(AppState.datos.lotes.reduce((s,l)=>roundMoney(s+l.disponible),0))}

/* ═══════════════════════════════════════════════════════════════════════
   §IG — INTEGRIDAD FINANCIERA (capa central de validación)
   Reglas duras: ningún saldo bancario o lote puede quedar negativo.
   Toda mutación de saldo debe pasar por aplicarDeltaBanco() para garantía.
   ═══════════════════════════════════════════════════════════════════════ */
const INTEG_EPSILON=0.005; /* tolerancia uniforme para comparaciones de saldo */

/* Verifica si una operación puede aplicarse SIN ejecutarla.
   Devuelve {ok, reason?}. Acepta un objeto con deltas planificados:
     { bancos: {Itau: -80000, BBVA: +5000}, usdt: -100 }
   Aplica todos los deltas en una "vista simulada" y verifica que ninguno
   quede negativo (más allá del epsilon). */
function validarDeltas(deltas){
    deltas=deltas||{};
    const errs=[];
    /* Bancos */
    if(deltas.bancos){
        for(const [nombre,delta] of Object.entries(deltas.bancos)){
            if(typeof delta!=='number'||!isFinite(delta))continue;
            const bk=AppState.datos.bancos[nombre];
            if(!bk){errs.push(`Banco ${nombre} no existe`);continue}
            const nuevoSaldo=roundMoney(bk.saldo+delta);
            if(nuevoSaldo<-INTEG_EPSILON){
                errs.push(`${nombre} quedaría con saldo negativo: ${getSym(getBancoInfo(nombre)?.moneda)}${fmtNum(nuevoSaldo,2)} (saldo actual ${getSym(getBancoInfo(nombre)?.moneda)}${fmtNum(bk.saldo,2)}, requeridos ${getSym(getBancoInfo(nombre)?.moneda)}${fmtNum(Math.abs(delta),2)})`);
            }
        }
    }
    /* USDT total disponible */
    if(deltas.usdt&&typeof deltas.usdt==='number'&&isFinite(deltas.usdt)){
        const nuevo=roundMoney(AppState.datos.saldoUsdt+deltas.usdt);
        if(nuevo<-INTEG_EPSILON){
            errs.push(`Inventario USDT quedaría negativo: ${fmtTrunc(nuevo,2)} USDT (disponible ${fmtTrunc(AppState.datos.saldoUsdt,2)}, requeridos ${fmtTrunc(Math.abs(deltas.usdt),2)})`);
        }
        /* Validación FIFO por moneda — solo si es egreso de USDT que va contra inventario */
        if(deltas.usdt<0&&deltas.usdtMoneda){
            const requerido=Math.abs(deltas.usdt);
            const disponibleEnMoneda=AppState.datos.lotes
                .filter(l=>(l.moneda||'UYU')===deltas.usdtMoneda&&l.disponible>0)
                .reduce((s,l)=>roundMoney(s+l.disponible),0);
            if(requerido>disponibleEnMoneda+INTEG_EPSILON){
                errs.push(`Inventario USDT en ${deltas.usdtMoneda} insuficiente: ${fmtTrunc(disponibleEnMoneda,2)} disponible, ${fmtTrunc(requerido,2)} requerido`);
            }
        }
    }
    /* Aportes (split pago): cada banco debe poder cubrir su parte */
    if(Array.isArray(deltas.aportes)){
        for(const a of deltas.aportes){
            const bk=AppState.datos.bancos[a.banco];
            if(!bk){errs.push(`Banco ${a.banco} no existe`);continue}
            if(bk.saldo<a.monto-INTEG_EPSILON){
                errs.push(`${a.banco} no tiene saldo suficiente: ${getSym(getBancoInfo(a.banco)?.moneda)}${fmtNum(bk.saldo,2)} disponible, ${getSym(getBancoInfo(a.banco)?.moneda)}${fmtNum(a.monto,2)} requerido`);
            }
        }
    }
    return errs.length?{ok:false,reason:errs[0],all:errs}:{ok:true};
}

/* Verifica integridad post-mutación: ningún banco/lote quedó negativo.
   Llamado al final de operaciones críticas como red de seguridad. */
function verificarIntegridadGlobal(){
    const errs=[];
    Object.entries(AppState.datos.bancos||{}).forEach(([n,bk])=>{
        if(bk&&bk.saldo<-INTEG_EPSILON)errs.push(`${n}: ${fmtNum(bk.saldo,2)}`);
    });
    (AppState.datos.lotes||[]).forEach(l=>{
        if(l.disponible<-INTEG_EPSILON)errs.push(`Lote ${l.id}: ${fmtTrunc(l.disponible,2)} USDT`);
    });
    if(errs.length)console.error('[INTEGRIDAD] Saldos negativos detectados tras mutación:',errs);
    return errs;
}

/* Aplica los deltas a los saldos. Asume que ya pasaron validarDeltas().
   Tras aplicar, fixNeg() es safety net contra -0 epsilon.
   deltas.bancos: {nombre: deltaSaldo}
   deltas.limitesUSD: {nombre: deltaLimiteUsado}  (opcional, + aumenta uso, - lo reduce)
*/
/* ═══════════════════════════════════════════════════════════════════════════
   EFECTO DE CADA EVENTO SOBRE LOS SALDOS (v5.8.0)
   ═══════════════════════════════════════════════════════════════════════════
   Hasta acá el saldo de cada cuenta se modificaba en diecinueve lugares
   distintos del programa: al crear, al editar y al borrar cada tipo de registro.
   Diecinueve lugares que tienen que estar todos de acuerdo, y basta que uno
   falle para que el saldo quede mal para siempre, porque nadie lo recalcula.

   Pero los eventos son solo CUATRO, y cada uno tiene un efecto bien definido.
   Esta función es ese efecto, en un único lugar. Con ella se puede reconstruir
   cualquier saldo sumando los eventos, igual que el saldo USDT se reconstruye
   reproduciendo las operaciones. Es la pieza que faltaba para que todo derive
   de la misma fuente.

   Devuelve un objeto {cuenta: variación}. Los montos ya vienen redondeados. */
function efectoEnBancos(tipo,ev){
    const d={};
    const sumar=(cuenta,monto)=>{
        if(!cuenta||!isFinite(monto)||!monto)return;
        d[cuenta]=roundMoney((d[cuenta]||0)+monto);
    };
    if(!ev)return d;
    if(tipo==='ajustesSaldo'){
        /* v6.1.0 — Corrección manual del saldo. Es un asiento como cualquier otro:
           no reescribe el pasado ni toca las estadísticas, solo suma o resta la
           diferencia entre lo que decía la app y lo que hay de verdad en el banco. */
        sumar(ev.cuenta,ev.delta||0);
    }else if(tipo==='operaciones'){
        if(ev.tipo==='compra'){
            /* Pago dividido: cada cuenta aporta su parte. La comisión bancaria
               la cobra siempre la cuenta principal. */
            if(Array.isArray(ev.aportes)&&ev.aportes.length){
                ev.aportes.forEach(a=>sumar(a.banco,-(a.monto||0)));
                sumar(ev.banco,-(ev.comisionBanco||0));
            }else{
                sumar(ev.banco,-((ev.monto||0)+(ev.comisionBanco||0)));
            }
        }else{
            sumar(ev.banco,ev.monto||0);
        }
    }else if(tipo==='movimientos'){
        /* Los movimientos sobre la billetera USDT no tocan cuentas bancarias */
        if(ev.tipoCuenta==='usdt')return d;
        sumar(ev.banco,ev.tipoMovimiento==='ingreso'?(ev.monto||0):-(ev.monto||0));
    }else if(tipo==='transferencias'){
        sumar(ev.origen,-((ev.monto||0)+(ev.comision||0)));
        sumar(ev.destino,ev.monto||0);
    }else if(tipo==='conversiones'){
        sumar(ev.origen,-(ev.montoOrigen||0));
        sumar(ev.destino,ev.montoDestino||0);
    }
    return d;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SALDOS DERIVADOS (v6.0.0) — el saldo es el resultado, no un dato aparte
   ═══════════════════════════════════════════════════════════════════════════
   Así trabaja un contador: no guarda el saldo de una cuenta, lo obtiene sumando
   los asientos. Si algo no cuadra, se vuelve a sumar y listo.

   Hasta acá la app hacía lo contrario con las cuentas bancarias: guardaba el
   saldo y lo iba modificando en cada operación, en diecinueve lugares distintos.
   Bastaba con que una modificación se perdiera —por una desconexión, por dos
   pestañas abiertas, por un error a mitad de camino— para que el número quedara
   mal PARA SIEMPRE, porque nadie lo volvía a calcular. Todo lo que veníamos
   agregando —vigilancia, auditoría, reconciliación manual— eran formas de
   convivir con ese problema en vez de resolverlo.

   Ahora el saldo de cada cuenta se reconstruye igual que los lotes y el USDT:
   punto de partida más el efecto de cada operación, ajuste, transferencia y
   conversión posterior. Se recalcula solo, en el mismo momento que todo lo
   demás. Una modificación perdida deja de importar, porque el número no depende
   de que se aplique: depende de los eventos, que sí están guardados uno por uno.

   El punto de partida es el último saldo que fijaste a mano. Tiene que existir,
   porque la app no conoce tu historia anterior a ella: la primera vez se adopta
   el saldo actual, sin cambiar ningún número.                                 */
/* Marca de tiempo comparable de un registro. Si no tiene una propia, se arma
   con su fecha y hora, que están en hora local: convertirla evita comparar hora
   local contra hora universal, que son tres horas de diferencia. */
function _marcaEvento(ev){
    if(ev&&ev.timestamp)return String(ev.timestamp);
    const d=new Date(String((ev&&ev.fecha)||'')+'T'+String((ev&&ev.hora)||'00:00')+':00');
    return isFinite(d.getTime())?d.toISOString():'';
}

function recalcularSaldosBancos(){
    if(!AppState.datos||!AppState.datos.bancos)return;

    /* ═══ v6.3.0 — Sin marcas de tiempo: se cuenta TODO ═══
       Las versiones anteriores guardaban un punto de partida con la hora en que
       se había fijado, y sumaban solo lo posterior a esa hora. Eso arrastró un
       problema tras otro: empates de marca que descartaban una operación, horas
       locales comparadas contra horas universales, y relojes distintos entre el
       teléfono y la computadora que hacían que cada uno calculara un saldo
       diferente. Todos eran variantes del mismo error: depender de una hora
       invisible para decidir qué cuenta y qué no.

       Ahora no hay corte. El punto de partida es el saldo de apertura de la
       cuenta —lo que había antes de que existiera cualquier registro— y el saldo
       actual es ese valor más el efecto de TODOS los registros, sin importar
       cuándo ocurrieron. Se cuenta cada uno exactamente una vez.

       Para las cuentas que ya venían en uso, el saldo de apertura se deduce:
       es el saldo que se muestra hoy menos lo que los registros ya explican. Por
       construcción el número no cambia al adoptarlo, y de ahí en adelante todo
       cuadra sin depender de ninguna hora. */
    const efectoTotal={};
    Object.keys(AppState.datos.bancos).forEach(n=>{efectoTotal[n]=0});
    ['operaciones','movimientos','transferencias','conversiones','ajustesSaldo'].forEach(tipo=>{
        (AppState.datos[tipo]||[]).forEach(ev=>{
            if(!ev)return;
            const efecto=efectoEnBancos(tipo,ev);
            for(const cuenta in efecto){
                if(efectoTotal[cuenta]===undefined)continue;
                efectoTotal[cuenta]=roundMoney(efectoTotal[cuenta]+efecto[cuenta]);
            }
        });
    });

    /* ═══ v6.6.0 — La apertura se fija UNA vez y con todo cargado ═══
       Se deducía restándole al saldo visible lo que los registros explican. Eso
       la hacía dependiente del momento: si se deducía antes de que llegaran los
       registros, o con un saldo que venía desactualizado del servidor, la
       apertura absorbía ese error y el libro quedaba coherente pero terminaba en
       un número equivocado. Peor: cada dispositivo deducía la suya desde lo que
       tenía a mano, así que el teléfono y la computadora llegaban a aperturas
       distintas y ganaba el último que sincronizaba.

       Ahora se deduce solo cuando los datos están completos, se guarda con la
       fecha en que se fijó, y no se vuelve a tocar nunca. Si falta con los datos
       incompletos, se deja el saldo como está y se reintenta más tarde. */
    const _completos=(typeof _v2EstadoOk==='undefined')||(_v2EstadoOk&&_v2EventosOk);
    Object.keys(AppState.datos.bancos).forEach(n=>{
        const bk=AppState.datos.bancos[n];
        if(!isFinite(bk.saldoApertura)){
            if(!_completos)return;         /* todavía no: se reintenta al terminar de cargar */
            bk.saldoApertura=roundMoney((bk.saldo||0)-efectoTotal[n]);
            bk.saldoAperturaTs=new Date().toISOString();
            delete bk.saldoBase;delete bk.saldoBaseTs;
            console.warn('[P2P] Saldo de apertura fijado para '+n+': '+bk.saldoApertura);
        }
        bk.saldo=fixNeg(roundMoney(bk.saldoApertura+efectoTotal[n]));
    });
}

/* ═══════════════════════════════════════════════════════════════════════════
   EFECTO DE CADA REGISTRO SOBRE EL USDT (v6.5.0)
   El equivalente de efectoEnBancos pero para la billetera, para poder armar su
   libro leyendo los mismos registros de los que ya sale el inventario.       */
function efectoEnUsdt(tipo,ev){
    if(!ev)return 0;
    if(tipo==='operaciones')return ev.tipo==='compra'?truncUsdt(ev.usdt||0):-truncUsdt(ev.usdt||0);
    if(tipo==='movimientos'&&ev.tipoCuenta==='usdt')
        return ev.tipoMovimiento==='ingreso'?truncUsdt(ev.monto||0):-truncUsdt(ev.monto||0);
    return 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIBRO DE MOVIMIENTOS POR CUENTA (v6.1.0)
   ═══════════════════════════════════════════════════════════════════════════
   No hace falta guardar un libro aparte: los asientos ya están: cada operación,
   ajuste, transferencia y conversión es uno. Este libro se arma leyéndolos, así
   que no puede quedar desincronizado de los saldos —sale de la misma fuente— ni
   necesita migrar nada de lo que ya tenés guardado.

   Cada línea trae el saldo antes, la variación y el saldo después, para poder
   seguir la cuenta paso a paso hasta el número que muestra la tarjeta.        */
function historialCuenta(nombre,limite){
    if(nombre==='USDT')return _historialUsdt(limite);   /* v6.5.0 */
    const bk=AppState.datos&&AppState.datos.bancos&&AppState.datos.bancos[nombre];
    if(!bk)return[];
    const marca=_marcaEvento;
    const lineas=[];

    ['operaciones','movimientos','transferencias','conversiones','ajustesSaldo'].forEach(tipo=>{
        (AppState.datos[tipo]||[]).forEach(ev=>{
            if(!ev)return;
            const t=marca(ev);
            const efecto=efectoEnBancos(tipo,ev);
            const v=efecto[nombre];
            if(v===undefined||Math.abs(v)<0.005)return;
            lineas.push({ts:t,tipo,id:ev.id,variacion:v,ev,
                         clase:_claseMovimiento(tipo,ev,v)});
        });
    });

    lineas.sort((a,b)=>a.ts<b.ts?-1:a.ts>b.ts?1:0);

    /* Encadenar desde el saldo de apertura. Sin corte por fecha: cada registro
       de esta cuenta aparece, y la suma tiene que dar exactamente el saldo. */
    let corriente=roundMoney(bk.saldoApertura||0);
    const base={ts:'',tipo:'inicial',clase:'inicial',variacion:0,
                anterior:corriente,resultante:corriente};
    lineas.forEach(l=>{
        l.anterior=corriente;
        corriente=roundMoney(corriente+l.variacion);
        l.resultante=corriente;
    });

    const todo=[base,...lineas];
    /* Más recientes primero, que es como se lee un extracto */
    todo.reverse();
    return limite>0?todo.slice(0,limite):todo;
}

/* Libro de la billetera. Su apertura son los lotes declarados a mano y los de
   arrastre: lo que existe sin venir de una operación. */
function _historialUsdt(limite){
    const d=AppState.datos||{};
    const apertura=truncUsdt((d.lotes||[]).filter(l=>l&&l.manual).reduce((a,l)=>a+(l.cantidad||0),0));
    const lineas=[];
    ['operaciones','movimientos'].forEach(tipo=>{
        (d[tipo]||[]).forEach(ev=>{
            if(!ev)return;
            const v=efectoEnUsdt(tipo,ev);
            if(!v||Math.abs(v)<0.005)return;
            lineas.push({ts:_marcaEvento(ev),tipo,id:ev.id,variacion:v,ev,
                         clase:_claseMovimiento(tipo,ev,v)});
        });
    });
    lineas.sort((a,b)=>a.ts<b.ts?-1:a.ts>b.ts?1:0);
    let corriente=apertura;
    const base={ts:'',tipo:'inicial',clase:'inicial',variacion:0,anterior:corriente,resultante:corriente};
    lineas.forEach(l=>{l.anterior=corriente;corriente=truncUsdt(corriente+l.variacion);l.resultante=corriente});
    const todo=[base,...lineas];todo.reverse();
    return limite>0?todo.slice(0,limite):todo;
}

/* Etiqueta legible de cada asiento */
function _claseMovimiento(tipo,ev,v){
    if(tipo==='ajustesSaldo')return'ajuste';
    if(tipo==='operaciones')return ev.tipo==='compra'?'compra':'venta';
    if(tipo==='movimientos')return v>0?'ingreso':'egreso';
    if(tipo==='transferencias')return v>0?'transf-entra':'transf-sale';
    return v>0?'conv-entra':'conv-sale';
}
const _ETIQUETA_MOV={
    inicial:'Saldo inicial',compra:'Compra USDT',venta:'Venta USDT',
    ingreso:'Ingreso',egreso:'Egreso',ajuste:'Ajuste manual',
    'transf-entra':'Transferencia recibida','transf-sale':'Transferencia enviada',
    'conv-entra':'Conversión recibida','conv-sale':'Conversión enviada'
};

/* Dibuja los movimientos de una cuenta. Empieza mostrando los últimos cinco,
   como pediste, con la opción de ver todo el historial. */
let _movsCuentaActual=null,_movsCuentaTodo=false;
function abrirMovimientosCuenta(nombre){
    _movsCuentaActual=nombre;_movsCuentaTodo=false;
    _pintarMovimientosCuenta();
    abrirModal('modalMovsCuenta');
}
function _pintarMovimientosCuenta(){
    const nombre=_movsCuentaActual;
    const cont=$('movsCuentaBody');if(!cont||!nombre)return;
    /* v6.5.0 — La billetera se dibuja con la misma pantalla que las cuentas */
    const esUsdt=nombre==='USDT';
    const bk=esUsdt?{saldo:AppState.datos.saldoUsdt||0}:AppState.datos.bancos[nombre];
    if(!bk)return;
    const hd=$('movsCuentaHeader');
    if(hd)hd.innerHTML=escHtml(esUsdt?'Movimientos de USDT':nombre);
    /* ═══ v6.3.1 — El listado completo se limita al último mes ═══
       Con miles de movimientos, mostrarlos todos no sirve para nada: no se puede
       recorrer con el dedo y el teléfono tarda en dibujarlos. El último mes es
       lo que se consulta de verdad; lo anterior está en la lista de operaciones
       y en el archivo histórico. El saldo sigue calculándose con TODO: acá solo
       se recorta lo que se muestra. */
    const todas=historialCuenta(nombre);
    const desde=Date.now()-30*24*60*60*1000;
    const delMes=todas.filter(l=>l.tipo!=='inicial'&&Date.parse(l.ts||'')>=desde);
    const TOPE=120;
    const recortado=_movsCuentaTodo&&delMes.length>TOPE;
    const lista=_movsCuentaTodo?delMes.slice(0,TOPE):todas.slice(0,5);
    const sym=esUsdt?'':(getSym(getBancoInfo(nombre)&&getBancoInfo(nombre).moneda));
    const suf=esUsdt?' USDT':'';
    const dinero=v=>sym+fmtNum(Math.abs(v),2)+suf;

    let h='<div class="movc-saldo"><div class="l">'+(esUsdt?'Inventario actual':'Saldo actual')+'</div>'+
          '<div class="v">'+sym+fmtNum(bk.saldo||0,2)+suf+'</div></div>';

    if(!todas.length){
        h+='<div class="movc-nota">Sin movimientos registrados en esta cuenta.</div>';
    }else{
        h+='<div class="movc-lista">';
        lista.forEach(l=>{
            const entra=l.variacion>0, esInicial=l.tipo==='inicial', esAjuste=l.clase==='ajuste';
            const cls=esInicial?'inicial':esAjuste?'ajuste':(entra?'entra':'sale');
            const cuando=String(l.ts||'').replace('T',' ').slice(0,16);
            let detalle='';
            if(esAjuste&&l.ev&&l.ev.motivo)detalle=' · '+escHtml(l.ev.motivo);
            else if(l.tipo==='operaciones'&&l.ev)detalle=' · '+fmtTasaMon(l.ev.tasa,l.ev.moneda);
            else if(l.tipo==='movimientos'&&l.ev&&l.ev.descripcion)detalle=' · '+escHtml(l.ev.descripcion);
            else if(l.tipo==='transferencias'&&l.ev)detalle=' · '+escHtml(entra?l.ev.origen:l.ev.destino);
            h+='<div class="movc-row '+cls+'"><div class="movc-i">'+
               '<div class="t">'+(_ETIQUETA_MOV[l.clase]||'Movimiento')+detalle+'</div>'+
               '<div class="m">'+escHtml(cuando)+'</div></div>'+
               '<div class="movc-d">'+
               (esInicial?'':'<div class="v '+(entra?'entra':'sale')+'">'+(entra?'+':'-')+dinero(l.variacion)+'</div>')+
               '<div class="s">'+sym+fmtNum(l.resultante,2)+suf+'</div></div></div>';
        });
        h+='</div>';
        if(!_movsCuentaTodo&&todas.length>5){
            h+='<button class="movc-mas" data-action="movs-cuenta-todo">'+
               (delMes.length?'Ver el último mes ('+delMes.length+')':'Ver más')+'</button>';
        }
        h+='<div class="movc-nota">'+(esUsdt
             ? 'Cada línea muestra cuánto entró o salió y el inventario que quedó. Las compras suman, las ventas restan. '
             : 'Cada línea muestra la variación y el saldo que quedó. ')+
           (_movsCuentaTodo
             ? (recortado
                 ? 'Se muestran los '+TOPE+' más recientes de los '+delMes.length+' del último mes. '
                 : 'Se muestra el último mes. ')+
               'Lo anterior está en la lista de operaciones y en el historial archivado.'
             : 'El saldo actual es el resultado de sumarlas todas desde el saldo inicial.')+'</div>';
    }
    if(!esUsdt)h+='<button class="movc-mas" data-action="corregir-saldo">Corregir saldo o límites</button>';
    cont.innerHTML=h;
}
window.abrirMovimientosCuenta=abrirMovimientosCuenta;

/* Registra una corrección manual como un asiento más */
function registrarAjusteSaldo(cuenta,nuevoSaldo,motivo){
    if(!AppState.datos.bancos[cuenta])return null;
    if(!Array.isArray(AppState.datos.ajustesSaldo))AppState.datos.ajustesSaldo=[];
    const actual=roundMoney(AppState.datos.bancos[cuenta].saldo||0);
    const delta=roundMoney(nuevoSaldo-actual);
    if(Math.abs(delta)<0.005)return null;
    const aj={id:(typeof uid==='function'?uid():Date.now()),cuenta,delta,
              motivo:String(motivo||'').slice(0,120),
              fecha:(typeof getUDateStr==='function'?getUDateStr():''),
              hora:(typeof getUTimeStr==='function'?getUTimeStr():''),
              timestamp:new Date().toISOString()};
    AppState.datos.ajustesSaldo.push(aj);
    /* Se conservan los últimos 200 por cuenta para no engordar el documento */
    if(AppState.datos.ajustesSaldo.length>200)AppState.datos.ajustesSaldo.shift();
    return aj;
}
window.registrarAjusteSaldo=registrarAjusteSaldo;

/* ═══════════════════════════════════════════════════════════════════════════
   RECONCILIACIÓN GENERAL (v5.8.0)
   ═══════════════════════════════════════════════════════════════════════════
   Reconstruye todo desde la única fuente que no puede mentir: los eventos.

   Cada cuenta guarda un punto de partida —el último saldo que fijaste a mano— y
   la fecha en que lo fijaste. A partir de ahí, su saldo correcto es ese punto
   más el efecto de todos los eventos posteriores. Es el mismo principio con el
   que ya funcionan los lotes y el saldo USDT, que se reconstruyen reproduciendo
   las operaciones y por eso se corrigen solos.

   Si una cuenta nunca tuvo punto de partida, se adopta su saldo actual como tal
   en el momento de correr esto. Eso no cambia ningún número: solo fija la
   referencia desde la cual se podrá verificar de ahí en adelante.

   NO aplica nada por su cuenta: muestra cada diferencia encontrada y pregunta.
   Sobre dinero, un ajuste automático a partir de un diagnóstico equivocado es
   peor que el problema que intenta resolver.                                  */
function reconciliarTodo(opts){
    opts=opts||{};
    if(!AppState.datos)return null;
    const ahora=new Date().toISOString();
    /* v6.3.0 — Sin corte por fecha: se recorren todos los registros. */

    /* 1 ── Lotes, ganancias y saldo USDT: ya se reconstruyen solos */
    const usdtAntes=AppState.datos.saldoUsdt;
    recalcularLotesYGanancias();
    const usdtDespues=AppState.datos.saldoUsdt;

    /* v6.0.0 — Ya no se comparan saldos: se reconstruyen en cada recálculo, así
       que no pueden estar desviados. Lo que sí hay que buscar son registros
       repetidos y estados imposibles, que sí son datos mal cargados. */
    /* ═══ 3 ── Registros con el mismo identificador ═══
       v6.0.1 — Se intentó además detectar registros "gemelos" comparando su
       contenido: mismo tipo, monto y cuenta con pocos minutos de diferencia. En
       una app de uso general habría servido; acá no. Operando P2P se venden
       muchas veces montos redondos a tasas parecidas en el mismo rato, así que
       esa comparación marcó ciento sesenta operaciones legítimas como si fueran
       errores. Una lista de falsos avisos es peor que no avisar nada: entrena a
       ignorarla, y el día que aparezca uno real va a pasar desapercibido.

       Queda solo lo que sí es inequívoco: dos registros con el mismo
       identificador. Eso nunca puede ser correcto. */
    const duplicados=[];
    ['operaciones','movimientos','transferencias','conversiones','ajustesSaldo'].forEach(tipo=>{
        const vistos=new Set();
        (AppState.datos[tipo]||[]).forEach(ev=>{
            if(!ev)return;
            const id=String(ev.id);
            if(vistos.has(id))duplicados.push({tipo,id,motivo:'identificador repetido',ev});
            vistos.add(id);
        });
    });

    /* ═══ v6.5.0 — Ventas que no encontraron inventario ═══
       Cuando una venta se reproduce y no hay lotes suficientes en ese momento,
       el motor consume lo que hay y descarta el resto sin decir nada. Pasa al
       borrar una compra vieja que ventas posteriores ya habían consumido: esas
       ventas quedan sin de dónde restar y el USDT sube en vez de bajar. Era
       completamente invisible; ahora se informa cuánto se perdió. */
    let usdtSinCubrir=0;
    {
        const compras=(AppState.datos.operaciones||[]).filter(o=>o&&o.tipo==='compra')
            .reduce((a,o)=>a+truncUsdt(o.usdt||0),0);
        const ventas=(AppState.datos.operaciones||[]).filter(o=>o&&o.tipo==='venta')
            .reduce((a,o)=>a+truncUsdt(o.usdt||0),0);
        const manuales=(AppState.datos.lotes||[]).filter(l=>l&&l.manual)
            .reduce((a,l)=>a+(l.cantidad||0),0);
        const ajustes=(AppState.datos.movimientos||[]).filter(m=>m&&m.tipoCuenta==='usdt')
            .reduce((a,m)=>a+(m.tipoMovimiento==='ingreso'?truncUsdt(m.monto||0):-truncUsdt(m.monto||0)),0);
        const teorico=truncUsdt(manuales+compras-ventas+ajustes);
        usdtSinCubrir=truncUsdt((AppState.datos.saldoUsdt||0)-teorico);
    }

    /* ═══ 4 ── Estados que no pueden darse ═══
       Un saldo negativo o un lote con más disponible del que se compró siempre
       significan que algo se contó mal. Antes no se avisaba de ninguno. */
    const imposibles=[];
    /* ═══ v6.6.0 — Cuentas sin apertura fijada ═══
       Mientras una cuenta no tenga su saldo de apertura guardado, su saldo se
       deduce de lo que hay en pantalla, y eso hace que dos dispositivos puedan
       mostrar números distintos. Es la causa de que el teléfono y la computadora
       no coincidan, así que conviene verlo antes que cualquier otra cosa. */
    Object.keys(AppState.datos.bancos||{}).forEach(n=>{
        const bk=AppState.datos.bancos[n];
        if(!bk)return;
        if(!isFinite(bk.saldoApertura)){
            imposibles.push({que:n+': sin saldo de apertura fijado',valor:roundMoney(bk.saldo||0)});
        }
    });
    if(Math.abs(usdtSinCubrir)>0.05){
        imposibles.push({que:usdtSinCubrir>0
            ? 'USDT de más: ventas que no encontraron inventario'
            : 'USDT de menos que lo que indican las operaciones',
            valor:Math.abs(usdtSinCubrir)});
    }
    Object.keys(AppState.datos.bancos||{}).forEach(n=>{
        const v=roundMoney(AppState.datos.bancos[n].saldo||0);
        if(v<-0.005)imposibles.push({que:'Saldo negativo en '+n,valor:v});
    });
    if(roundMoney(AppState.datos.saldoUsdt||0)<-0.005){
        imposibles.push({que:'Saldo USDT negativo',valor:roundMoney(AppState.datos.saldoUsdt)});
    }
    (AppState.datos.lotes||[]).forEach(l=>{
        if(l&&l.disponible>(l.cantidad||0)+0.005){
            imposibles.push({que:'Lote con más disponible que lo comprado',valor:l.disponible});
        }
    });

    const informe={
        usdt:{antes:usdtAntes,despues:usdtDespues,cambio:roundMoney(usdtDespues-usdtAntes)},
        duplicados,
        imposibles,
        ok:duplicados.length===0&&imposibles.length===0
    };

    console.log('%c[Verificación]',informe.ok?'color:#15803d;font-weight:bold':'color:#b91c1c;font-weight:bold',informe);

    if(opts.silencioso)return informe;
    _pintarReconciliacion(informe);
    return informe;
}

/* ═══ v5.8.1 — El resultado se muestra en la app ═══
   Antes esto salía por avisos del navegador, que no permiten formato y obligan a
   leer un bloque de texto corrido con cifras mezcladas. Acá cada diferencia se ve
   como una fila con el valor que hay en pantalla, el que surge de los eventos y
   cuánto difieren, que es lo que hace falta para decidir si corregir. */
function _pintarReconciliacion(inf){
    const cont=$('reconciliarBody');
    if(!cont){console.log('[P2P][verificación]',inf);return}
    let h='';

    const problemas=inf.duplicados.length+(inf.imposibles||[]).length;
    if(!problemas){
        h+='<div class="rec-estado ok"><div class="t">Todo cuadra</div>'+
           '<div class="s">Los saldos de tus cuentas, los lotes y el USDT salen de '+
           'sumar tus operaciones, ajustes, transferencias y conversiones. No hay '+
           'registros repetidos ni cifras imposibles.</div></div>';
    }else{
        const partes=[];
        if(inf.duplicados.length)partes.push(inf.duplicados.length+' registro'+(inf.duplicados.length===1?'':'s')+' repetido'+(inf.duplicados.length===1?'':'s'));
        if((inf.imposibles||[]).length)partes.push(inf.imposibles.length+' cifra'+(inf.imposibles.length===1?'':'s')+' imposible'+(inf.imposibles.length===1?'':'s'));
        h+='<div class="rec-estado alerta"><div class="t">'+partes.join(' · ')+'</div>'+
           '<div class="s">Los saldos se recalculan solos, así que lo que aparece acá '+
           'son datos mal cargados, no errores de cuenta. Borrando lo que sobra, todo '+
           'lo demás se acomoda en el momento.</div></div>';
    }

    h+='<div class="rec-linea"><span class="n">Saldo USDT</span>'+
       '<span class="v">'+fmtNum(inf.usdt.despues,2)+'</span></div>';
    h+='<div class="rec-linea"><span class="n">Cuentas</span>'+
       '<span class="v">'+Object.keys(AppState.datos.bancos||{}).length+'</span></div>';
    const nEv=['operaciones','movimientos','transferencias','conversiones','ajustesSaldo']
        .reduce((a,k)=>a+((AppState.datos[k]||[]).length),0);
    h+='<div class="rec-linea"><span class="n">Registros considerados</span>'+
       '<span class="v">'+nEv+'</span></div>';
    /* v6.7.0 — Detalle por tipo. Sirve para comparar dos dispositivos: si una
       misma cuenta muestra saldos distintos, acá se ve enseguida si es porque a
       uno le faltan registros o porque difiere el saldo de apertura. */
    [['operaciones','Operaciones'],['movimientos','Ajustes externos'],
     ['transferencias','Transferencias'],['conversiones','Conversiones'],
     ['ajustesSaldo','Correcciones de saldo']].forEach(([k,et])=>{
        const c=(AppState.datos[k]||[]).length;
        if(c)h+='<div class="rec-linea"><span class="n" style="padding-left:12px;opacity:0.8">'+et+'</span>'+
               '<span class="v" style="font-weight:600">'+c+'</span></div>';
    });
    Object.keys(AppState.datos.bancos||{}).forEach(n=>{
        const bk=AppState.datos.bancos[n];
        if(bk&&isFinite(bk.saldoApertura))
            h+='<div class="rec-linea"><span class="n" style="padding-left:12px;opacity:0.8">Apertura '+escHtml(n)+'</span>'+
               '<span class="v" style="font-weight:600">'+fmtNum(bk.saldoApertura,2)+'</span></div>';
    });

    if(inf.duplicados.length){
        h+='<div class="rec-dups"><div class="rec-dups-t">Registros repetidos</div>'+
           '<div class="rec-dups-s">Aparecen dos veces y por eso se cuentan doble. '+
           'Suele pasar cuando la app falla a mitad de una operación y el registro '+
           'se vuelve a crear. Revisá cuál sobra antes de borrarlo.</div>';
        inf.duplicados.forEach(d=>{
            const ev=d.ev||{};
            let desc='';
            if(d.tipo==='operaciones')desc=(ev.tipo==='compra'?'Compra ':'Venta ')+fmtMonto(ev.monto,ev.moneda)+' a '+fmtTasaMon(ev.tasa,ev.moneda);
            else if(d.tipo==='movimientos')desc=(ev.tipoMovimiento==='ingreso'?'Ingreso ':'Egreso ')+
                (ev.tipoCuenta==='usdt'?fmtTrunc(ev.monto,2)+' USDT':fmtMonto(ev.monto))+
                (ev.descripcion?' · '+escHtml(ev.descripcion):'');
            else if(d.tipo==='transferencias')desc=fmtMonto(ev.monto)+' · '+escHtml(ev.origen||'')+' → '+escHtml(ev.destino||'');
            else desc='Conversión '+fmtMonto(ev.montoOrigen);
            h+='<div class="rec-dup"><div class="rec-dup-i">'+
               '<div class="d">'+desc+'</div>'+
               '<div class="m">'+escHtml(String(ev.fecha||''))+' '+escHtml(String(ev.hora||''))+' · '+escHtml(d.motivo)+'</div></div>'+
               '<button data-action="rec-borrar-dup" data-tipo="'+d.tipo+'" data-id="'+escHtml(String(d.id))+'">Borrar</button></div>';
        });
        h+='</div>';
    }

    if((inf.imposibles||[]).length){
        h+='<div class="rec-imposibles"><div class="rec-dups-t">Cifras imposibles</div>';
        inf.imposibles.forEach(x=>{h+='<div class="rec-imp">'+escHtml(x.que)+' <b>'+fmtNum(x.valor,2)+'</b></div>'});
        h+='<div class="rec-dups-s">Un saldo negativo o un lote con más disponible del '+
           'que se compró indican que algo se cargó de más. Suele resolverse borrando '+
           'el registro repetido de arriba.</div></div>';
    }

    h+=_recHerramientas();
    h+='<div class="rec-acciones"><button class="pri" data-action="cerrar-reconciliar">Listo</button></div>';
    cont.innerHTML=h;
    abrirModal('modalReconciliar');
}


/* v5.8.1 — Las otras dos verificaciones también se alcanzan desde acá.
   Estaban solo por consola, que en un teléfono es inaccesible: eran código que
   se descargaba y nunca podía usarse. */
function _recHerramientas(){
    const hayArchivo=!!(AppState.datos._archivoIndex&&AppState.datos._archivoIndex.meses&&
                        Object.keys(AppState.datos._archivoIndex.meses).length);
    let h='<div class="rec-otras"><div class="rec-otras-t">Otras verificaciones</div>';
    h+='<button data-action="rec-servidor">Comparar con el servidor'+
       '<small>Revisa que lo guardado en la nube coincida con lo que ves</small></button>';
    /* ═══ v6.8.0 — Resolver una discrepancia entre dispositivos ═══
       Cuando el teléfono y la computadora muestran saldos distintos, hace falta
       poder decidir cuál tiene razón. Esto sube TODO lo de este dispositivo y
       reemplaza lo de la nube, con lo que el otro queda alineado al recargar. */
    h+='<button data-action="rec-imponer" style="border-color:#fcd34d;background:#fffbeb">'+
       'Este dispositivo tiene los datos correctos'+
       '<small>Sube todo lo de acá y reemplaza lo de la nube. Usalo solo si otro '+
       'dispositivo muestra saldos equivocados.</small></button>';
    if(hayArchivo){
        h+='<button data-action="rec-arrastre">Recalcular lotes de arrastre'+
           '<small>Los reconstruye desde el historial archivado</small></button>';
    }
    h+='</div>';
    return h;
}



/* v6.0.0 — Se retiró la corrección manual de saldos: dejaron de poder desviarse
   cuando pasaron a recalcularse desde los eventos, así que no había nada que
   corregir. */


window.reconciliarTodo=reconciliarTodo;

/* La auditoría de saldos se retiró en v6.0.0: vigilaba que el saldo guardado no
   se desviara del esperado, y eso dejó de tener sentido cuando el saldo pasó a
   recalcularse desde los eventos en cada actualización. No hay nada que vigilar
   si el número se reconstruye solo. */

function aplicarDeltas(deltas){
    deltas=deltas||{};
    if(deltas.bancos){
        for(const [nombre,delta] of Object.entries(deltas.bancos)){
            const bk=AppState.datos.bancos[nombre];
            if(!bk)continue;
            bk.saldo=fixNeg(roundMoney(bk.saldo+delta));
            /* ═══ v5.7.2 — Sin esto el descuento se perdía ═══
               El saldo de cada cuenta no se recalcula nunca: se le suma y se le
               resta. Al cargar una operación se anotaba como pendiente la
               operación, pero NO el cambio de saldo, así que el guardián que
               protege lo local no lo veía. Si en esa ventana llegaba una foto del
               servidor —el eco de un guardado anterior, u otro dispositivo— el
               saldo remoto pisaba al recién descontado y la resta desaparecía
               para siempre, porque nadie la vuelve a calcular. */
            if(typeof enqueueSync==='function')enqueueSync('update','bancos',nombre);
        }
    }
    if(deltas.limitesUSD){
        for(const [nombre,delta] of Object.entries(deltas.limitesUSD)){
            const bk=AppState.datos.bancos[nombre];
            if(!bk||!(bk.limiteDiarioUSD>0))continue;
            const nuevo=roundMoney((bk.limiteUsadoUSD||0)+delta);
            bk.limiteUsadoUSD=Math.max(0,Math.min(bk.limiteDiarioUSD,nuevo));
        }
    }
}

/* Helper: convierte monto en UYU (o USD) a su equivalente en USD para tracking de límite diario.
   Si el banco es USD, el monto ya está en USD. Si es UYU, divide por ultimaTasaCompra. 
   Si no hay tasa válida, devuelve 0 (no se trackea). */
function _montoEnUSDLimite(bancoNombre,monto){
    if(!monto||monto<=0)return 0;
    const bi=getBancoInfo(bancoNombre);
    if(bi?.moneda==='USD')return roundMoney(monto);
    const tasa=AppState.datos.ultimaTasaCompra;
    if(!tasa||tasa<=0)return 0;
    return roundMoney(monto/tasa);
}

/* ═══ Conversión unificada de movimientos a UYU ═══
   Fuente única de verdad para convertir cualquier movimiento a UYU.
   Prioridad:
     1. m.valorUYU persistido (calculado en replay FIFO)
     2. m.monto * m.tasaRef (tasa manual del registro)
     3. m.monto * tasaFallback (última tasa de compra)
   Para movs en banco: si banco USD → multiplica por tasaFallback; si banco UYU → retorna monto directo.
   Garantiza consistencia entre dashboard, análisis, resumen mensual y listados. */
function movimientoValorUYU(m,tasaFallback){
    if(!m)return 0;
    const tasaFb=tasaFallback||AppState.datos.ultimaTasaCompra||1;
    if(m.tipoCuenta==='usdt'){
        if(typeof m.valorUYU==='number'&&m.valorUYU>0)return m.valorUYU;
        return roundMoney(m.monto*(m.tasaRef||tasaFb));
    }
    /* Banco: respetar moneda */
    const bi=m.banco?getBancoInfo(m.banco):null;
    if(bi&&bi.moneda==='USD')return roundMoney(m.monto*tasaFb);
    return m.monto; /* UYU directo */
}

/* ═══ Tags ═══ */
const TAG_MAX_LEN=24; /* Cap length to avoid overflow into banco column */
function normalizarTag(t){return(t||'').trim().replace(/\s+/g,' ').slice(0,TAG_MAX_LEN)}
function stripAccents(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
function tagKey(t){return stripAccents(t).toLowerCase()}

/* Keyword → category aliases for smart suggestions */
const TAG_ALIASES={
    'uber':'transporte','cabify':'transporte','taxi':'transporte','bus':'transporte','omnibus':'transporte','nafta':'transporte','combustible':'transporte','estacionamiento':'transporte','peaje':'transporte',
    'netflix':'suscripciones','spotify':'suscripciones','youtube':'suscripciones','hbo':'suscripciones','disney':'suscripciones','amazon':'suscripciones','prime':'suscripciones',
    'antel':'servicios','ute':'servicios','ose':'servicios','luz':'servicios','agua':'servicios','internet':'servicios','celular':'servicios','telefono':'servicios',
    'alquiler':'vivienda','renta':'vivienda','expensas':'vivienda','gastos comunes':'vivienda',
    'super':'alimentacion','supermercado':'alimentacion','comida':'alimentacion','restaurante':'alimentacion','delivery':'alimentacion','rappi':'alimentacion','pedidosya':'alimentacion',
    'farmacia':'salud','medico':'salud','mutualista':'salud','emergencia':'salud','dentista':'salud',
    'gimnasio':'deporte','gym':'deporte','futbol':'deporte','cancha':'deporte'
};

function getAliasSuggestion(text){
    if(!text||text.length<2)return null;
    const k=tagKey(text);
    const kNoSpace=k.replace(/\s+/g,'');
    /* Direct match (with and without spaces) */
    if(TAG_ALIASES[k])return TAG_ALIASES[k];
    if(TAG_ALIASES[kNoSpace])return TAG_ALIASES[kNoSpace];
    /* Partial match */
    for(const[alias,cat] of Object.entries(TAG_ALIASES)){
        const aliasNS=alias.replace(/\s+/g,'');
        if(alias.startsWith(k)||k.startsWith(alias))return cat;
        if(aliasNS.startsWith(kNoSpace)||kNoSpace.startsWith(aliasNS))return cat;
    }
    return null;
}

function agregarTag(texto){
    const raw=normalizarTag(texto);if(!raw||raw.length<2)return;
    /* Always store lowercase, accent-stripped */
    const t=stripAccents(raw).toLowerCase();
    const key=tagKey(t);
    const existe=AppState.datos.tags.find(x=>tagKey(x)===key);
    if(!existe){AppState.datos.tags.push(t);AppState.datos.tags.sort((a,b)=>a.localeCompare(b,'es'))}
}
function eliminarTag(texto){AppState.datos.tags=AppState.datos.tags.filter(t=>tagKey(t)!==tagKey(texto))}
function editarTag(viejo,nuevo){
    const nv=normalizarTag(nuevo);if(!nv||nv.length<2)return false;
    const nvKey=tagKey(nv),vjKey=tagKey(viejo);
    const dup=AppState.datos.tags.find(t=>tagKey(t)===nvKey&&tagKey(t)!==vjKey);
    if(dup)return false;
    const idx=AppState.datos.tags.findIndex(t=>tagKey(t)===vjKey);
    if(idx>=0){
        AppState.datos.tags[idx]=nv;AppState.datos.tags.sort((a,b)=>a.localeCompare(b,'es'));
        AppState.datos.movimientos.forEach(m=>{
            if(m.descripcion&&tagKey(m.descripcion)===vjKey)m.descripcion=nv;
        });
    }
    return true;
}
function mergeTag(origen,destino){
    /* Fusionar: todas las refs de origen → destino, luego eliminar origen */
    const orKey=tagKey(origen),dsKey=tagKey(destino);
    if(orKey===dsKey)return false;
    if(!AppState.datos.tags.some(t=>tagKey(t)===dsKey))return false;
    AppState.datos.movimientos.forEach(m=>{
        if(m.descripcion&&tagKey(m.descripcion)===orKey){
            m.descripcion=AppState.datos.tags.find(t=>tagKey(t)===dsKey)||destino;
        }
    });
    AppState.datos.tags=AppState.datos.tags.filter(t=>tagKey(t)!==orKey);
    return true;
}

/* ─── Tag merge: similarity + smart suggestions ─── */
function tagSimilarityScore(a,b){
    const na=stripAccents((a||'').toLowerCase()).trim();
    const nb=stripAccents((b||'').toLowerCase()).trim();
    if(!na||!nb)return 0;
    if(na===nb)return 100;
    if(na.startsWith(nb)||nb.startsWith(na))return 80;
    if(na.includes(nb)||nb.includes(na))return 60;
    if(na.substring(0,3)===nb.substring(0,3))return 40;
    /* Bigram overlap */
    const bigrams=s=>{const r=new Set();for(let i=0;i<s.length-1;i++)r.add(s.substring(i,i+2));return r};
    const ba=bigrams(na),bb=bigrams(nb);
    if(!ba.size||!bb.size)return 0;
    let inter=0;ba.forEach(g=>{if(bb.has(g))inter++});
    const jaccard=inter/(ba.size+bb.size-inter);
    return Math.round(jaccard*40);
}
function abrirModalMergeTag(srcTag){
    if(!srcTag)return;
    const tags=AppState.datos.tags||[];
    const otros=tags.filter(t=>tagKey(t)!==tagKey(srcTag));
    if(!otros.length){alert('No hay otras categorías para fusionar. Creá una nueva primero.');return}
    /* Compute source stats */
    const movs=AppState.datos.movimientos.filter(m=>m.descripcion&&tagKey(m.descripcion)===tagKey(srcTag));
    const tasaFb=AppState.datos.ultimaTasaCompra||1;
    let totalUYU=0;
    movs.forEach(m=>{totalUYU=roundMoney(totalUYU+movimientoValorUYU(m,tasaFb))});
    AppState.ui.mergeSrcTag=srcTag;
    AppState.ui.mergeSrcStats={count:movs.length,totalUYU};
    AppState.ui.mergeSelectedDest=null;
    AppState.ui.mergeMode='existing';
    /* Render source card */
    const card=$('mergeSourceCard');
    card.innerHTML=`<div class="merge-source-label">Categoría a fusionar</div>
        <div class="merge-source-name">${escHtml(srcTag)}</div>
        <div class="merge-source-stats">
            <span class="merge-source-stat"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h11M8 12h11M8 18h11M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg> ${movs.length} movimiento${movs.length!==1?'s':''}</span>
            ${totalUYU>0?`<span class="merge-source-stat"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h20v10H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 10h.01M18 14h.01"/></svg> $${fmtNum(totalUYU,0)}</span>`:''}
        </div>`;
    /* Reset UI state */
    $('mergeSearch').value='';
    $('mergeNewName').value='';
    setMergeTab('existing');
    renderMergeDestinations('');
    updateMergeConfirmBox();
    abrirModal('modalMergeTag');
}
function setMergeTab(tab){
    AppState.ui.mergeMode=tab;
    AppState.ui.mergeSelectedDest=null;
    $('mergeTabExisting').className='merge-tab'+(tab==='existing'?' active':'');
    $('mergeTabNew').className='merge-tab'+(tab==='new'?' active':'');
    $('mergePanelExisting').style.display=tab==='existing'?'block':'none';
    $('mergePanelNew').style.display=tab==='new'?'block':'none';
    if(tab==='new')setTimeout(()=>$('mergeNewName').focus(),100);
    updateMergeConfirmBox();
}
function renderMergeDestinations(searchQuery){
    const cont=$('mergeDestList');if(!cont)return;
    const srcTag=AppState.ui.mergeSrcTag;if(!srcTag)return;
    const tags=AppState.datos.tags||[];
    const otros=tags.filter(t=>tagKey(t)!==tagKey(srcTag));
    const stats=getTagStats();
    /* Score each destination */
    const scored=otros.map(t=>{
        const sim=tagSimilarityScore(srcTag,t);
        const usos=stats[tagKey(t)]?.usos||0;
        /* Boost for high-usage destinations (more "main" categories) */
        const usageBoost=Math.log(usos+1)*8;
        return{tag:t,score:sim+usageBoost,sim,usos,suggested:sim>=40};
    }).sort((a,b)=>b.score-a.score);
    /* Filter by search */
    const q=stripAccents((searchQuery||'').toLowerCase()).trim();
    const filtered=q?scored.filter(s=>stripAccents(s.tag.toLowerCase()).includes(q)):scored;
    if(!filtered.length){
        cont.innerHTML='<div class="merge-dest-empty">Sin resultados</div>';
        return;
    }
    const selectedKey=AppState.ui.mergeSelectedDest?tagKey(AppState.ui.mergeSelectedDest):null;
    cont.innerHTML=filtered.map(s=>{
        const isSel=selectedKey===tagKey(s.tag);
        const cls='merge-dest-item'+(s.suggested?' suggested':'')+(isSel?' selected':'');
        const meta=s.usos>0?`${s.usos} movimiento${s.usos!==1?'s':''}`:'Sin usos';
        return `<div class="${cls}" data-action="merge-select-dest" data-tag="${escHtml(s.tag)}">
            <div class="merge-dest-radio"></div>
            <div class="merge-dest-info">
                <div class="merge-dest-name">${escHtml(s.tag)}</div>
                <div class="merge-dest-meta">${meta}</div>
            </div>
            ${s.suggested?'<span class="merge-dest-badge">Sugerida</span>':''}
        </div>`;
    }).join('');
}
function updateMergeConfirmBox(){
    const box=$('mergeConfirmBox'),btn=$('btnConfirmMerge');
    const src=AppState.ui.mergeSrcTag,stats=AppState.ui.mergeSrcStats||{count:0,totalUYU:0};
    let dest=null;
    if(AppState.ui.mergeMode==='existing')dest=AppState.ui.mergeSelectedDest;
    else dest=normalizarTag($('mergeNewName').value||'');
    if(!dest||(src&&tagKey(dest)===tagKey(src))){
        box.style.display='none';btn.disabled=true;return;
    }
    const tags=AppState.datos.tags||[];
    const isNew=AppState.ui.mergeMode==='new'&&!tags.some(t=>tagKey(t)===tagKey(dest));
    box.style.display='block';
    box.innerHTML=`<div>Se moverán <b>${stats.count} movimiento${stats.count!==1?'s':''}</b>${stats.totalUYU>0?` (<b>$${fmtNum(stats.totalUYU,0)}</b>)`:''} de <b>${escHtml(src)}</b> hacia <b>${escHtml(dest)}</b>${isNew?' <span style="font-size:0.7em;background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:6px;font-weight:700">NUEVA</span>':''}.</div>
        <div class="merge-confirm-warning"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z"/></svg> <span><b>${escHtml(src)}</b> se eliminará y el historial quedará unificado bajo <b>${escHtml(dest)}</b>.</span></div>`;
    btn.disabled=false;
}
function confirmarFusion(){
    const src=AppState.ui.mergeSrcTag;if(!src)return;
    let dest=null;
    if(AppState.ui.mergeMode==='existing')dest=AppState.ui.mergeSelectedDest;
    else dest=normalizarTag($('mergeNewName').value||'');
    if(!dest)return;
    if(tagKey(dest)===tagKey(src))return;
    const tags=AppState.datos.tags||[];
    /* Create new tag if needed */
    if(!tags.some(t=>tagKey(t)===tagKey(dest)))AppState.datos.tags.push(dest);
    if(mergeTag(src,dest)){
        AppState.ui.mergeSrcTag=null;AppState.ui.mergeSelectedDest=null;
        cerrarModal('modalMergeTag');
        renderizarGestionTags();
        guardaOptimista('update','tags',dest);
    }
}
/* Conteo de usos y tipo dominante por tag */
function getTagStats(){
    const stats={};
    (AppState.datos.tags||[]).forEach(t=>{stats[tagKey(t)]={nombre:t,usos:0,ingresos:0,egresos:0}});
    AppState.datos.movimientos.forEach(m=>{
        if(!m.descripcion)return;
        const k=tagKey(m.descripcion),s=stats[k];
        if(!s)return;
        s.usos++;
        if(m.tipoMovimiento==='ingreso')s.ingresos++;else s.egresos++;
    });
    return stats;
}
function renderizarTagsSugerencias(inputId,containerId){
    const input=$(inputId),cont=$(containerId);if(!cont||!input)return;
    const val=normalizarTag(input.value),valKey=stripAccents(val).toLowerCase();
    const tags=AppState.datos.tags||[];
    if(!valKey&&!tags.length){cont.innerHTML='';return}

    const stats=getTagStats();
    const tipoMov=AppState.ui.tipoMovimiento||'egreso';

    /* Check keyword alias */
    const aliasCat=getAliasSuggestion(valKey);
    const aliasKey=aliasCat?tagKey(aliasCat):null;

    let scored=tags.map(t=>{
        const k=tagKey(t),s=stats[k]||{usos:0,ingresos:0,egresos:0};
        let score=s.usos;
        if(tipoMov==='ingreso'&&s.ingresos>0)score+=10;
        if(tipoMov==='egreso'&&s.egresos>0)score+=10;
        if(tipoMov==='ingreso'&&s.egresos>0&&s.ingresos===0&&s.usos>2)score=-1;
        if(tipoMov==='egreso'&&s.ingresos>0&&s.egresos===0&&s.usos>2)score=-1;
        let match=0;
        if(valKey){
            const tk=stripAccents(t).toLowerCase();
            if(tk===valKey)match=100;
            else if(tk.startsWith(valKey))match=50;
            else if(tk.includes(valKey))match=20;
            /* Alias boost: if tag matches the alias category */
            else if(aliasKey&&tk===aliasKey)match=80;
            else if(aliasKey&&tk.includes(aliasKey))match=30;
            else match=-999;
        }
        return{tag:t,score:score+match,match,usos:s.usos};
    }).filter(t=>t.score>=0&&t.match>=-1);

    scored.sort((a,b)=>b.score-a.score);

    const MAX_VISIBLE=AppState.ui._tagShowAll?50:5;
    const visible=scored.slice(0,MAX_VISIBLE);
    const hasMore=scored.length>MAX_VISIBLE;
    const exactMatch=valKey&&tags.some(t=>tagKey(t)===valKey);
    const showCreate=valKey&&val.length>=2&&!exactMatch;

    if(!visible.length&&!showCreate&&!aliasCat){cont.innerHTML='';return}

    let h='<div class="tag-sugerencias"><div class="tags-container">';
    const selected=input.value.trim();
    visible.forEach(t=>{
        const isActive=tagKey(selected)===tagKey(t.tag);
        /* v5.6.2 — El número de usos era texto gris pegado al nombre y podía
           leerse como parte de la categoría ("Transporte 77"). Ahora es una
           insignia separada, con su propio fondo, que se lee como lo que es. */
        h+=`<span class="tag-pill${isActive?' tag-active':''}" data-action="usar-tag" data-tag="${escHtml(t.tag)}" data-target="${inputId}" title="${escHtml(t.tag)}: ${t.usos} ${t.usos===1?'uso':'usos'}">${escHtml(t.tag)}${t.usos>0?`<b class="tag-usos">${t.usos}</b>`:''}</span>`;
    });
    if(hasMore)h+=`<span class="tag-pill tag-pill-mas" data-action="tag-ver-mas" data-target="${inputId}">+${scored.length-MAX_VISIBLE} más</span>`;
    /* Alias suggestion: suggest creating the category name */
    if(showCreate&&aliasCat&&!tags.some(t=>tagKey(t)===aliasKey)){
        h+=`<span class="tag-pill tag-pill-idea" data-action="tag-crear" data-tag="${escHtml(aliasCat)}" data-target="${inputId}" title="Sugerencia según lo que escribiste"><svg class="ico ico-tag-idea" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg> ${escHtml(aliasCat)}</span>`;
    }
    if(showCreate)h+=`<span class="tag-pill tag-pill-nueva" data-action="tag-crear" data-tag="${escHtml(val)}" data-target="${inputId}" title="Crear esta categoría">+ ${escHtml(val)}</span>`;
    h+='</div></div>';
    cont.innerHTML=h;
}
function renderizarGestionTags(){
    const periodo=AppState.ui.tagPeriodo||'total';
    const view=AppState.ui.tagView||'dona';
    const pf=$('tagPeriodFilter');
    if(pf){const periodos=[['hoy','Hoy'],['semana','Semana'],['mes','Mes'],['total','Total']];
        pf.innerHTML=periodos.map(([k,l])=>`<button style="padding:4px 10px;font-size:0.7em;border-radius:12px;border:1px solid ${periodo===k?'#2563eb':'#e2e8f0'};background:${periodo===k?'#2563eb':'white'};color:${periodo===k?'white':'#64748b'};cursor:pointer;font-weight:500" data-action="tag-periodo" data-periodo="${k}">${l}</button>`).join('');
    }
    const vt=$('tagViewToggle');
    if(vt){const views=[['dona','<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15.5A9 9 0 118.5 3v9h9a9 9 0 013.5 3.5z"/><path d="M20.9 9.5A9 9 0 0014.5 3.1V9.5h6.4z"/></svg> Dona'],['barras','<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V10M10 19V5M16 19v-6M22 19H2"/></svg> Barras']];
        vt.innerHTML=views.map(([k,l])=>`<button class="gastos-view-btn ${view===k?'active':''}" data-action="tag-view" data-view="${k}">${l}</button>`).join('');
    }

    /* Build period filters: current + previous (for variation) */
    const hoy=getUDateStr(),hoyD=getUDate();
    function periodFilter(p,offset){
        if(p==='hoy'){const d=new Date(hoyD);d.setDate(d.getDate()+offset);const s=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return m=>m.fecha===s}
        if(p==='semana'){const start=new Date(hoyD);start.setDate(start.getDate()-hoyD.getDay()+7*offset);const end=new Date(start);end.setDate(end.getDate()+6);const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const s=fmt(start),e=fmt(end);return m=>m.fecha>=s&&m.fecha<=e}
        if(p==='mes'){const d=new Date(hoyD.getFullYear(),hoyD.getMonth()+offset,1);const s=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;return m=>m.fecha?.startsWith(s)}
        return ()=>true;
    }
    const currFilter=periodFilter(periodo,0);
    const prevFilter=periodo==='total'?null:periodFilter(periodo,-1);

    const movsFiltrados=AppState.datos.movimientos.filter(currFilter);
    const movsPrev=prevFilter?AppState.datos.movimientos.filter(prevFilter):[];

    /* Solo egresos */
    const egresos=movsFiltrados.filter(m=>m.tipoMovimiento==='egreso');
    const egresosPrev=movsPrev.filter(m=>m.tipoMovimiento==='egreso');
    const tasaFallback=AppState.datos.ultimaTasaCompra||1;
    const egresoUYU=m=>movimientoValorUYU(m,tasaFallback);

    const tags=AppState.datos.tags||[],search=($('tagSearch')?.value||'').toLowerCase();
    function buildStats(egresoList){
        return tags.map(t=>{
            const movs=egresoList.filter(m=>m.descripcion&&tagKey(m.descripcion)===tagKey(t));
            const ops=movs.length;
            const egresoTotal=movs.reduce((s,m)=>roundMoney(s+egresoUYU(m)),0);
            const tieneConversion=movs.some(m=>m.tipoCuenta==='usdt'||(m.banco&&getBancoInfo(m.banco)?.moneda==='USD'));
            return{tag:t,ops,egresoTotal,tieneConversion};
        });
    }
    const tagStats=buildStats(egresos).sort((a,b)=>b.egresoTotal-a.egresoTotal);
    const prevStats=prevFilter?buildStats(egresosPrev):[];
    const prevByTag={};prevStats.forEach(t=>{prevByTag[tagKey(t.tag)]=t});

    const totalEgreso=tagStats.reduce((s,t)=>s+t.egresoTotal,0);
    const sinTagMovs=egresos.filter(m=>!m.descripcion||!tags.some(t=>tagKey(t)===tagKey(m.descripcion)));
    const sinTagUYU=sinTagMovs.reduce((s,m)=>roundMoney(s+egresoUYU(m)),0);
    const grandTotal=roundMoney(totalEgreso+sinTagUYU);
    const prevGrandTotal=prevStats.reduce((s,t)=>s+t.egresoTotal,0);

    /* Ganancia del período (UYU) for impact metric */
    const opsPeriodo=AppState.datos.operaciones.filter(op=>op.fecha&&currFilter({fecha:op.fecha})&&op.moneda!=='USD');
    const gananciaPeriodo=opsPeriodo.reduce((s,op)=>roundMoney(s+(op.ganancia||0)),0);
    const impactoPct=gananciaPeriodo>0?Math.round(grandTotal/gananciaPeriodo*100):0;
    const sinTagPct=grandTotal>0?Math.round(sinTagUYU/grandTotal*100):0;

    const ac=$('tagAnalytics');
    if(ac){
        const COLORS=['#3b82f6','#16a34a','#f59e0b','#dc2626','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
        const top=tagStats.filter(t=>t.egresoTotal>0).slice(0,8);
        if(grandTotal>0&&top.length>0){
            let chartHtml='';
            if(view==='dona'){
                let svg='',cum=0;const r=50,cx=60,cy=60,stroke=18,circ=2*Math.PI*r;
                top.forEach((t,i)=>{
                    const pct=t.egresoTotal/grandTotal;const dash=pct*circ;const gap=circ-dash;const offset=-cum*circ+circ*0.25;
                    svg+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLORS[i%COLORS.length]}" stroke-width="${stroke}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${offset}" />`;
                    cum+=pct;
                });
                if(sinTagUYU>0){const pct=sinTagUYU/grandTotal;const dash=pct*circ;const gap=circ-dash;const offset=-cum*circ+circ*0.25;
                    svg+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="${stroke}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${offset}" />`;}
                svg=`<svg viewBox="0 0 120 120" style="width:110px;height:110px"><text x="${cx}" y="${cy-4}" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">$${fmtNum(grandTotal,0)}</text><text x="${cx}" y="${cy+10}" text-anchor="middle" fill="#94a3b8" font-size="7">egresos UYU</text>${svg}</svg>`;
                let legend=top.map((t,i)=>{
                    const pct=grandTotal?Math.round(t.egresoTotal/grandTotal*100):0;
                    return`<div style="display:flex;align-items:center;gap:5px;font-size:0.7em"><span style="width:8px;height:8px;border-radius:50%;background:${COLORS[i%COLORS.length]};flex-shrink:0"></span><span style="color:#1e293b;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.tag)}</span><span style="color:#64748b;white-space:nowrap">$${fmtNum(t.egresoTotal,0)} · ${pct}%</span></div>`;
                }).join('');
                if(sinTagUYU>0)legend+=`<div style="display:flex;align-items:center;gap:5px;font-size:0.7em"><span style="width:8px;height:8px;border-radius:50%;background:#e2e8f0;flex-shrink:0"></span><span style="color:#94a3b8;flex:1">Sin tag</span><span style="color:#64748b">$${fmtNum(sinTagUYU,0)} · ${sinTagPct}%</span></div>`;
                chartHtml=`<div style="display:flex;gap:14px;align-items:center;padding:10px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0"><div style="flex-shrink:0">${svg}</div><div style="flex:1;display:flex;flex-direction:column;gap:3px">${legend}</div></div>`;
            }else{
                /* Bars view: ranking horizontal */
                const maxV=top[0].egresoTotal;
                let bars=top.map((t,i)=>{
                    const pct=maxV?Math.round(t.egresoTotal/maxV*100):0;
                    return`<div class="gastos-bar-row"><span class="label">${escHtml(t.tag)}</span><div class="track"><div class="fill" style="width:${pct}%;background:${COLORS[i%COLORS.length]}"></div></div><span class="amount">$${fmtNum(t.egresoTotal,0)}</span></div>`;
                }).join('');
                if(sinTagUYU>0){const pct=maxV?Math.round(sinTagUYU/maxV*100):0;bars+=`<div class="gastos-bar-row"><span class="label" style="color:#94a3b8">Sin tag</span><div class="track"><div class="fill" style="width:${pct}%;background:#cbd5e1"></div></div><span class="amount" style="color:#94a3b8">$${fmtNum(sinTagUYU,0)}</span></div>`}
                chartHtml=`<div class="gastos-bars-container"><div style="font-size:0.8em;font-weight:700;color:#1e293b;margin-bottom:4px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">Total: $${fmtNum(grandTotal,0)}</div>${bars}</div>`;
            }

            /* Meta chips: impact + sin tag warning + period variation */
            let metaChips='';
            if(impactoPct>0)metaChips+=`<span class="gastos-meta-chip impact"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l6 6 4-4 7 7M14 16h7v-7"/></svg> ${impactoPct}% de la ganancia</span>`;
            if(sinTagUYU>0&&sinTagPct>=10)metaChips+=`<span class="gastos-meta-chip warning"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z"/></svg> ${sinTagPct}% sin clasificar</span>`;
            if(prevFilter&&prevGrandTotal>0){
                const diff=roundMoney(grandTotal-prevGrandTotal);
                const pct=Math.abs(Math.round(diff/prevGrandTotal*100));
                const cls=diff>0?'warning':(diff<0?'gastos-meta-chip" style="background:#dcfce7;color:#15803d':'');
                const arrow=diff>0?'↑':(diff<0?'↓':'→');
                const sign=diff>=0?'+':'-';
                metaChips+=`<span class="gastos-meta-chip ${diff>0?'warning':''}" ${diff<0?'style="background:#dcfce7;color:#15803d"':''}>${arrow} ${sign}$${fmtNum(Math.abs(diff),0)} (${pct}%) vs período anterior</span>`;
            }

            /* Insights */
            const topEg=top[0];
            const topOps=tagStats.filter(t=>t.ops>0).sort((a,b)=>b.ops-a.ops)[0];
            let topGrowth=null,maxGrowthPct=0;
            if(prevFilter){
                top.forEach(t=>{
                    const prev=prevByTag[tagKey(t.tag)];
                    if(prev&&prev.egresoTotal>0){
                        const pct=Math.round((t.egresoTotal-prev.egresoTotal)/prev.egresoTotal*100);
                        if(pct>maxGrowthPct){maxGrowthPct=pct;topGrowth={tag:t.tag,pct,diff:roundMoney(t.egresoTotal-prev.egresoTotal)}}
                    }
                });
            }
            let insights=`<span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h20v10H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 10h.01M18 14h.01"/></svg> Mayor: <b>${escHtml(topEg.tag)}</b> ($${fmtNum(topEg.egresoTotal,0)})</span>`;
            if(topOps&&topOps.tag!==topEg.tag)insights+=`<span style="margin-left:10px"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5"/></svg> Más frec: <b>${escHtml(topOps.tag)}</b> (${topOps.ops})</span>`;
            if(topGrowth&&topGrowth.pct>=20)insights+=`<span style="margin-left:10px"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 7-7M14 8h7v7"/></svg> Mayor crecimiento: <b>${escHtml(topGrowth.tag)}</b> (+${topGrowth.pct}%)</span>`;
            const hayConv=top.some(t=>t.tieneConversion);

            ac.innerHTML=chartHtml
                +(metaChips?`<div class="gastos-header-meta">${metaChips}</div>`:'')
                +`<div style="margin-top:8px;font-size:0.68em;color:#64748b;display:flex;flex-wrap:wrap;gap:4px">${insights}</div>`
                +(hayConv?'<div style="margin-top:4px;font-size:0.6em;color:#94a3b8;font-style:italic">* Valores USDT/USD convertidos a UYU con precio FIFO</div>':'');
        }else{
            ac.innerHTML='<div style="text-align:center;padding:12px;color:#94a3b8;font-size:0.8em">Sin egresos en este período</div>';
        }
    }

    const cont=$('tagsList');if(!cont)return;
    const searchKey=stripAccents(search);
    const filtrados=searchKey?tagStats.filter(t=>stripAccents(t.tag.toLowerCase()).includes(searchKey)):tagStats;
    if(!filtrados.length){cont.innerHTML=`<div style="text-align:center;padding:20px;color:#94a3b8"><div style="font-size:1.8em;margin-bottom:6px"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4L12 22l-9-9V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01"/></svg></div><div>${search?'Sin resultados':'Sin categorías aún'}</div></div>`;return}
    let h='';
    filtrados.forEach(t=>{
        const pct=grandTotal?Math.round(t.egresoTotal/grandTotal*100):0;
        const ticketTxt=t.ops>0?`Ticket: $${fmtNum(roundMoney(t.egresoTotal/t.ops),0)}`:'';
        const convMark=t.tieneConversion?' *':'';
        const metaParts=[t.ops+' egreso'+(t.ops!==1?'s':'')];
        if(t.egresoTotal>0)metaParts.push('$'+fmtNum(t.egresoTotal,0)+' UYU'+convMark);
        if(ticketTxt)metaParts.push(ticketTxt);

        /* Variation chip vs previous period */
        let varChip='';
        if(prevFilter&&t.egresoTotal>0){
            const prev=prevByTag[tagKey(t.tag)];
            if(prev&&prev.egresoTotal>0){
                const diff=roundMoney(t.egresoTotal-prev.egresoTotal);
                const vpct=Math.abs(Math.round(diff/prev.egresoTotal*100));
                if(diff>0)varChip=`<span class="var-chip up">↑ ${vpct}%</span>`;
                else if(diff<0)varChip=`<span class="var-chip down">↓ ${vpct}%</span>`;
                else varChip=`<span class="var-chip flat">→</span>`;
            }else if(!prev||prev.egresoTotal===0){
                varChip=`<span class="var-chip new">nuevo</span>`;
            }
        }

        h+=`<div class="tag-manage-item">
            <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="tag-name">${escHtml(t.tag)}</span>${pct>0?`<span style="font-size:0.6em;background:#fef2f2;color:#dc2626;padding:1px 5px;border-radius:8px">${pct}%</span>`:''}${varChip}</div>
                <div style="font-size:0.65em;color:#94a3b8;margin-top:2px">${metaParts.join(' · ')}</div>
            </div>
            <div class="tag-actions"><button class="tag-edit-btn" data-action="merge-tag" data-tag="${escHtml(t.tag)}" title="Fusionar categoría" aria-label="Fusionar"><svg class="ico ico-accion" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/></svg></button><button class="tag-edit-btn" data-action="editar-tag" data-tag="${escHtml(t.tag)}" title="Editar nombre" aria-label="Editar"><svg class="ico ico-accion" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button><button class="tag-delete-btn" data-action="eliminar-tag" data-tag="${escHtml(t.tag)}" title="Eliminar categoría" aria-label="Eliminar"><svg class="ico ico-accion" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/></svg></button></div>
        </div>`;
    });
    cont.innerHTML=h;
}
function agregarTasaReciente(valor,tipo,moneda){
    const arr=AppState.datos.tasasRecientes;
    /* Eliminar duplicado exacto (mismo valor+tipo+moneda) */
    const idx=arr.findIndex(t=>t.valor===valor&&t.tipo===tipo&&t.moneda===moneda);
    if(idx!==-1)arr.splice(idx,1);
    arr.unshift({valor,tipo,moneda});
    /* Mantener máx 5 por combo tipo+moneda, máx 30 total */
    const count={};AppState.datos.tasasRecientes=arr.filter(t=>{const k=t.tipo+'_'+t.moneda;count[k]=(count[k]||0)+1;return count[k]<=5}).slice(0,30);
}
function renderizarTasasRecientes(){
    const cont=$('tasaTagsContainer');if(!cont)return;
    const tipo=$('tipo').value,mon=getMonedaBanco();
    const recientes=(AppState.datos.tasasRecientes||[]).filter(t=>t.tipo===tipo&&t.moneda===mon).slice(0,5);
    if(!recientes.length){cont.innerHTML='';return}
    /* v4.7.62 — marcar como "activa" la pill cuyo valor coincide con el input
       actual de tasa, NO la primera por posición. Antes el CSS usaba :first-child
       y esa pill siempre se veía azul aunque el usuario tocara otra. Ahora la
       pill activa es la que refleja el valor real del input. */
    const tasaActualNum=parsearTasa($('tasa').value);
    const epsilon=mon==='USD'?0.0005:0.005;
    /* v5.6.0 — Son las cinco tasas más recientes, pero no había forma de saber
       cuál usaste último: se marca la primera, que es la más nueva. */
    cont.innerHTML=recientes.map((t,idx)=>{
        /* v4.8.2: parsearTasa devuelve null para input vacío/inválido, e isFinite(null)
           es true (coerciona a 0) — comparaba contra 0 en vez de "sin tasa". */
        const isActive=tasaActualNum!==null&&Math.abs(t.valor-tasaActualNum)<epsilon;
        const cls='tag-pill'+(isActive?' tag-pill-active':'')+(idx===0?' tag-pill-ultima':'');
        const tit=idx===0?' title="La última tasa que usaste"':'';
        return `<span class="${cls}"${tit} data-action="usar-tasa" data-valor="${t.valor}" style="font-size:0.72em;padding:3px 9px;flex-shrink:0">${fmtTasa(t.valor,mon)}</span>`;
    }).join('');
}

function getLotesActivosFIFO(){return AppState.datos.lotes.filter(l=>l.disponible>0).sort((a,b)=>(a.fecha+(a.hora||'00:00')).localeCompare(b.fecha+(b.hora||'00:00')))}

/* ═══ Swipe gestures for cards (mobile) ═══ */