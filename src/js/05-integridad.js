function sincronizarSaldoUsdt(){AppState.datos.saldoUsdt=roundMoney(AppState.datos.lotes.reduce((s,l)=>roundMoney(s+l.disponible),0))}

/* ═══════════════════════════════════════════════════════════════════════
   §IG — INTEGRIDAD FINANCIERA
   Los saldos, los lotes y el cupo NO se modifican a mano en ningún lado: se
   reconstruyen desde los registros (recalcularLotesYGanancias). Acá viven las
   reglas que dicen cuánto mueve cada registro y la validación previa.
   ═══════════════════════════════════════════════════════════════════════ */
const INTEG_EPSILON=0.005;

/* Diferencia de saldos entre dos versiones de un registro (null = no existe) */
function diferenciaDeEfecto(tipo,antes,despues){
    const d={};
    const a=antes?efectoEnBancos(tipo,antes):{},b=despues?efectoEnBancos(tipo,despues):{};
    new Set([...Object.keys(a),...Object.keys(b)]).forEach(c=>{
        const x=roundMoney((b[c]||0)-(a[c]||0));
        if(Math.abs(x)>=0.005)d[c]=x;
    });
    return{bancos:d};
}

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
            /* Sale el monto más la comisión del banco. */
            const total=roundMoney((Number(ev.monto)||0)+(Number(ev.comisionBanco)||0));
            if(esPagoDividido(ev)){
                /* ═══ v7.3.0 — La comisión del banco se cobra una sola vez ═══
                   El panel de pago dividido exige que los aportes cubran el monto
                   MÁS la comisión, así que la comisión ya viene adentro de los
                   aportes. Se restaba además aparte, y en un pago dividido con
                   comisión la cuenta principal la pagaba dos veces. Si los aportes
                   no llegan al total —registros viejos que no la incluían—, lo que
                   falta lo paga la cuenta principal. */
                let cubierto=0;
                aportesDe(ev).forEach(a=>{sumar(a.banco,-a.monto);cubierto=roundMoney(cubierto+a.monto)});
                const resto=roundMoney(total-cubierto);
                if(resto>=0.005)sumar(ev.banco,-resto);
            }else{
                sumar(ev.banco,-total);
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
/* Marca de tiempo comparable de un registro, siempre en hora universal.
   ═══ v7.3.0 — Las horas sin zona son de Uruguay ═══
   Las operaciones que vuelven del servidor traen una marca armada con su fecha
   y hora locales ("2026-09-26T10:20:00"), mientras que los ajustes y las
   transferencias guardan la hora universal ("…T13:20:00.000Z"). Compararlas
   como texto mezclaba las dos escalas, con tres horas de diferencia: el libro
   de cada cuenta salía desordenado. Ahora toda marca se lleva a hora universal
   antes de comparar. Uruguay no tiene horario de verano desde 2015, igual que
   asume getUDate(). */
function _aIso(texto){
    let s=String(texto||'');
    if(!s)return '';
    if(!/[zZ]$|[+-]\d\d:?\d\d$/.test(s))s+=(s.length<=16?':00':'')+'-03:00';
    const d=new Date(s);
    return isFinite(d.getTime())?d.toISOString():'';
}
/* v8.0.0 — El momento de un registro es su fecha y hora, no el momento en que
   se cargó: ahora se puede cargar algo con fecha de otro día, y tiene que
   quedar en su lugar del libro, igual que en el recálculo de lotes. */
function _marcaEvento(ev){
    if(!ev)return '';
    return _aIso(String(ev.fecha||'')+'T'+String(ev.hora||'00:00'))||(ev.timestamp&&_aIso(ev.timestamp))||'';
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
   CUPO DIARIO DERIVADO (v7.0.0)
   ═══════════════════════════════════════════════════════════════════════════
   El cupo consumido de cada cuenta se llevaba sumando y restando en veintinueve
   lugares distintos del programa: al comprar, al editar, al borrar, al revertir.
   Veintinueve puntos que tenían que estar todos de acuerdo, y esta semana ya
   fallaron dos —el pago dividido cargaba todo a una sola cuenta, y borrar una
   compra no devolvía el cupo—. Además, cuando quedaba mal no había forma de
   arreglarlo: había que esperar a que renovara al día siguiente.

   Es exactamente el mismo problema que tenían los saldos, y la solución es la
   misma: el cupo consumido no es un dato que haya que mantener, es el resultado
   de sumar las compras hechas desde la última renovación. Se recalcula solo, y
   un error deja de ser permanente.                                            */
/* Fecha desde la cual cuentan las compras para el cupo: el último día de
   renovación ya cumplido (renueva a las 0:30, hora de Uruguay).
   v7.3.0 — Se calcula con los días marcados, sin depender de que la app haya
   estado abierta ese día. Antes se usaba la fecha anotada la última vez que la
   app vio una renovación: si no la abrías el día que renovaba, el cupo seguía
   sumando compras de días anteriores y frenaba compras que el banco permitía;
   y con un límite recién puesto contaba toda la historia. */
function _cupoDesde(nombre){
    const dias=getDiasReset(nombre);
    const d=getUDate();
    if(d.getHours()*60+d.getMinutes()<30)d.setDate(d.getDate()-1);   /* antes de las 0:30 sigue el día anterior */
    for(let i=0;i<6&&!dias.includes(d.getDay());i++)d.setDate(d.getDate()-1);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

/* Consumo de cupo de cada cuenta con límite, sumando compras y transferencias
   salientes desde su última renovación. `excluir` ({tipo,id}) deja afuera un
   registro: sirve para validar una edición sin contar el valor viejo. */
function _consumoDeCupos(excluir){
    const usado={};
    Object.keys(AppState.datos.bancos).forEach(n=>{
        const bk=AppState.datos.bancos[n];
        usado[n]=(bk&&bk.limiteDiarioUSD>0)?0:null;   /* null = sin límite, no se calcula */
    });
    const excluido=(tipo,ev)=>excluir&&excluir.tipo===tipo&&String(excluir.id)===String(ev.id);
    /* Las transferencias salientes también consumen cupo de la cuenta de origen:
       es dinero que sale igual que en una compra. */
    (AppState.datos.transferencias||[]).forEach(tr=>{
        if(!tr||!tr.origen||excluido('transferencias',tr))return;
        if(usado[tr.origen]===undefined||usado[tr.origen]===null)return;
        const desde=_cupoDesde(tr.origen);
        if(desde&&String(tr.fecha||'')<String(desde))return;
        const u=_montoEnUSDLimite(tr.origen,(tr.monto||0)+(tr.comision||0));
        if(u>0)usado[tr.origen]=roundMoney(usado[tr.origen]+u);
    });
    (AppState.datos.operaciones||[]).forEach(op=>{
        if(!op||op.tipo!=='compra'||excluido('operaciones',op))return;
        /* Cada cuenta que aportó consume su parte; sin pago dividido, todo el monto */
        aportesDe(op).forEach(p=>{
            if(usado[p.banco]===undefined||usado[p.banco]===null)return;
            const desde=_cupoDesde(p.banco);
            if(desde&&String(op.fecha||'')<String(desde))return;   /* anterior a la renovación */
            const u=_montoEnUSDLimite(p.banco,p.monto);
            if(u>0)usado[p.banco]=roundMoney(usado[p.banco]+u);
        });
    });
    return usado;
}
function recalcularCuposDiarios(){
    if(!AppState.datos||!AppState.datos.bancos)return;
    const usado=_consumoDeCupos(null);
    Object.keys(usado).forEach(n=>{
        if(usado[n]===null)return;
        AppState.datos.bancos[n].limiteUsadoUSD=usado[n];
    });
}
/* Cupo que le queda a una cuenta, en dólares. Infinity si no tiene límite. */
function cupoDisponibleUSD(nombre,excluir){
    const bk=AppState.datos.bancos[nombre];
    if(!bk||!(bk.limiteDiarioUSD>0))return Infinity;
    const usado=_consumoDeCupos(excluir)[nombre]||0;
    return roundMoney(bk.limiteDiarioUSD-usado);
}

/* ═══════════════════════════════════════════════════════════════════════════
   EFECTO DE CADA REGISTRO SOBRE EL USDT (v6.5.0)
   El equivalente de efectoEnBancos pero para la billetera, para poder armar su
   libro leyendo los mismos registros de los que ya sale el inventario.       */
function efectoEnUsdt(tipo,ev){
    if(!ev)return 0;
    if(tipo==='operaciones'){
        /* ═══ v7.3.0 — Con la comisión de Binance incluida ═══
           Se tomaba la cantidad base: en una compra entra la base MENOS la
           comisión y en una venta sale la base MÁS la comisión. Con 0,14 % la
           diferencia es chica por operación pero se acumula: el libro de la
           billetera no terminaba en el inventario real y la verificación
           marcaba "USDT de menos" a todos los que operan con comisión. */
        const neto=usdtNeto(Number(ev.usdt)||0,Number(ev.comisionPlataforma)||0,ev.tipo);
        return ev.tipo==='compra'?neto:-neto;
    }
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
/* Orden cronológico de dos líneas del libro: por momento y, si coinciden, por
   id (los ids crecen con el tiempo), para que el orden no dependa de la lista. */
function _ordenLinea(a,b){
    if(a.ts!==b.ts)return a.ts<b.ts?-1:1;
    return (Number(a.id)||0)-(Number(b.id)||0);
}
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

    lineas.sort(_ordenLinea);

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
/* USDT que existe sin venir de una operación: lotes cargados a mano y lotes de
   arrastre del archivado. Se leen las DECLARACIONES: el lote de arrastre ya
   calculado absorbe las compras a su mismo precio, y sumarlo contaba esas
   compras dos veces. */
function _aperturaUsdt(){
    const d=AppState.datos||{};
    const carry=(d._archivoCarryover||[]).reduce((a,l)=>a+(Number(l&&l.cantidad)||0),0);
    const man=(d.lotes||[]).filter(l=>l&&l.manual&&!l.carryover).reduce((a,l)=>a+(Number(l.cantidad)||0),0);
    return roundMoney(carry+man);
}
function _historialUsdt(limite){
    const d=AppState.datos||{};
    const apertura=_aperturaUsdt();
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
    lineas.sort(_ordenLinea);
    let corriente=apertura;
    const base={ts:'',tipo:'inicial',clase:'inicial',variacion:0,anterior:corriente,resultante:corriente};
    lineas.forEach(l=>{l.anterior=corriente;corriente=roundMoney(corriente+l.variacion);l.resultante=corriente});
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


/* ═══════════════════════════════════════════════════════════════════════════
   CORRECCIONES DE SALDO (v6.1.0, editables desde v7.3.0)
   Una corrección es un asiento más: dice cuánto había de diferencia entre lo
   que calculaba la app y lo que había de verdad en el banco. No toca
   operaciones, ganancias ni estadísticas. Se puede editar o borrar como
   cualquier otro registro, y el saldo se recalcula solo.
   ═══════════════════════════════════════════════════════════════════════════ */
function registrarAjusteSaldo(cuenta,nuevoSaldo,motivo){
    if(!AppState.datos.bancos[cuenta])return null;
    if(!Array.isArray(AppState.datos.ajustesSaldo))AppState.datos.ajustesSaldo=[];
    const actual=roundMoney(AppState.datos.bancos[cuenta].saldo||0);
    const delta=roundMoney(nuevoSaldo-actual);
    if(Math.abs(delta)<0.005)return null;
    const aj={id:uid(),cuenta,delta,
              motivo:String(motivo||'').trim().slice(0,120),
              fecha:getUDateStr(),hora:getUTimeStr(),
              timestamp:new Date().toISOString()};
    /* v7.3.0 — Sin tope. Con 200 se descartaba el más viejo en silencio, y como
       el saldo es la suma de las correcciones, el saldo cambiaba solo. Cada
       corrección es un documento propio, así que no engorda nada. */
    AppState.datos.ajustesSaldo.unshift(aj);
    return aj;
}


/* ═══════════════════════════════════════════════════════════════════════════
   UN SOLO CAMINO PARA CONFIRMAR UN CAMBIO (v7.3.0)
   ═══════════════════════════════════════════════════════════════════════════
   Crear, editar o borrar cualquier registro termina acá. Antes cada pantalla lo
   resolvía por su cuenta y varias se olvidaban de recalcular: un ajuste externo
   en un banco, una transferencia editada o una corrección de saldo quedaban
   guardados, pero la pantalla seguía mostrando el saldo viejo hasta que
   respondía el servidor —y sin conexión, hasta recargar—.

   Orden fijo: se reconstruyen lotes, saldos y cupos desde los registros, se
   anota qué hay que subir y se redibuja. Si el libro de una cuenta está
   abierto, también se actualiza. */
function confirmarCambios(cambios){
    const lista=(cambios||[]).filter(c=>c&&c.tipo&&c.entidad&&c.id!==undefined&&c.id!==null);
    recalcularLotesYGanancias();
    lista.slice(0,-1).forEach(c=>enqueueSync(c.tipo,c.entidad,c.id));
    const ultimo=lista[lista.length-1];
    if(ultimo)guardaOptimista(ultimo.tipo,ultimo.entidad,ultimo.id);else guardaOptimista();
    actualizarVista();
}

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
function reconciliarTodo(){
    if(!AppState.datos)return null;

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
    /* v7.3.0 — Lo que debería haber sale del mismo libro que la billetera: la
       apertura declarada más lo que movió cada operación y cada ajuste, con la
       comisión de Binance incluida. Antes se usaba la cantidad base y a todos
       los que operan con comisión les marcaba "USDT de menos" sin serlo. */
    let usdtSinCubrir=0;
    {
        let teorico=_aperturaUsdt();
        ['operaciones','movimientos'].forEach(t=>(AppState.datos[t]||[]).forEach(ev=>{
            if(ev)teorico=roundMoney(teorico+efectoEnUsdt(t,ev));
        }));
        usdtSinCubrir=roundMoney((AppState.datos.saldoUsdt||0)-teorico);
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

    return informe;
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


function agregarTag(texto){
    const raw=normalizarTag(texto);if(!raw||raw.length<2)return;
    /* Always store lowercase, accent-stripped */
    const t=stripAccents(raw).toLowerCase();
    const key=tagKey(t);
    const existe=AppState.datos.tags.find(x=>tagKey(x)===key);
    if(!existe){AppState.datos.tags.push(t);AppState.datos.tags.sort((a,b)=>a.localeCompare(b,'es'));_guardarCambioDeCategorias([])}
}
/* ═══ v7.3.0 — Cambiar una categoría se guarda de verdad ═══
   Las categorías viven en el documento de configuración, pero el nombre que
   usa cada ajuste vive en el documento de ese ajuste. Renombrar o fusionar
   cambiaba ambos en pantalla y solo pedía subir la configuración —y renombrar
   ni siquiera eso—: al llegar la siguiente foto del servidor, los ajustes
   volvían al nombre viejo. Ahora cada ajuste tocado se anota para subir. */
function _guardarCambioDeCategorias(idsAjustes){
    (idsAjustes||[]).forEach(id=>enqueueSync('update','movimientos',id));
    guardaOptimista('update','tags','categorias');
}
function eliminarTag(texto){
    AppState.datos.tags=AppState.datos.tags.filter(t=>tagKey(t)!==tagKey(texto));
    _guardarCambioDeCategorias([]);
}
function editarTag(viejo,nuevo){
    const nv=normalizarTag(nuevo);if(!nv||nv.length<2)return false;
    const nvKey=tagKey(nv),vjKey=tagKey(viejo);
    const dup=AppState.datos.tags.find(t=>tagKey(t)===nvKey&&tagKey(t)!==vjKey);
    if(dup)return false;
    const idx=AppState.datos.tags.findIndex(t=>tagKey(t)===vjKey);
    const tocados=[];
    if(idx>=0){
        AppState.datos.tags[idx]=nv;AppState.datos.tags.sort((a,b)=>a.localeCompare(b,'es'));
        AppState.datos.movimientos.forEach(m=>{
            if(m.descripcion&&tagKey(m.descripcion)===vjKey){m.descripcion=nv;tocados.push(m.id)}
        });
    }
    _guardarCambioDeCategorias(tocados);
    return true;
}
function mergeTag(origen,destino){
    /* Fusionar: todas las refs de origen → destino, luego eliminar origen */
    const orKey=tagKey(origen),dsKey=tagKey(destino);
    if(orKey===dsKey)return false;
    if(!AppState.datos.tags.some(t=>tagKey(t)===dsKey))return false;
    const tocados=[];
    const nombre=AppState.datos.tags.find(t=>tagKey(t)===dsKey)||destino;
    AppState.datos.movimientos.forEach(m=>{
        if(m.descripcion&&tagKey(m.descripcion)===orKey){m.descripcion=nombre;tocados.push(m.id)}
    });
    AppState.datos.tags=AppState.datos.tags.filter(t=>tagKey(t)!==orKey);
    _guardarCambioDeCategorias(tocados);
    return true;
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
/* ═══ v7.3.0 — Tasas rápidas desde las operaciones reales ═══
   Se guardaba una lista aparte, a la que se agregaba cada tasa al cargar una
   operación. Esa lista no se enteraba si la operación después se editaba o se
   borraba, y cada dispositivo la armaba en su propio orden. Ahora salen de las
   operaciones mismas: las últimas cinco tasas distintas del mismo tipo y la
   misma moneda, de la más nueva a la más vieja por fecha y hora reales. */
function tasasRecientesDe(tipo,moneda,cantidad){
    const n=cantidad||5,vistas=new Set(),res=[];
    const ops=(AppState.datos&&AppState.datos.operaciones)||[];
    /* La lista ya está ordenada de la más nueva a la más vieja */
    for(const op of ops){
        if(!op||op.tipo!==tipo||(op.moneda||'UYU')!==moneda||!(op.tasa>0))continue;
        const clave=Math.round(op.tasa*1000);
        if(vistas.has(clave))continue;
        vistas.add(clave);res.push(op.tasa);
        if(res.length>=n)break;
    }
    return res;
}

function getLotesActivosFIFO(){return AppState.datos.lotes.filter(l=>l.disponible>0).sort((a,b)=>(a.fecha+(a.hora||'00:00')).localeCompare(b.fecha+(b.hora||'00:00')))}

/* ═══ Swipe gestures for cards (mobile) ═══ */