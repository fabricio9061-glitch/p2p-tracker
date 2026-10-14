/* ╔═══════════════════════════════════════════════════════════╗
   ║  REGISTRO P2P                                             ║
   ║  Compras y ventas de USDT, saldos y ganancias.            ║
   ║  Los archivos se cargan en orden (ver index.html) y       ║
   ║  comparten el mismo ámbito global.                        ║
   ╚═══════════════════════════════════════════════════════════╝ */

/* ═══════════════════════════════════════
   §1 — CONFIGURACIÓN
   ═══════════════════════════════════════ */
const CONFIG = {
    firebase: {apiKey:"AIzaSyC5GPlXKziT4XdGpcdUR_gtnQE5RIrricw",authDomain:"binancp2p-f831f.firebaseapp.com",projectId:"binancp2p-f831f",storageBucket:"binancp2p-f831f.firebasestorage.app",messagingSenderId:"118313786206",appId:"1:118313786206:web:a964400f85dac298a78dcf"},
    /* ═══════════════════════════════════════════════════════════════════════
     * REGLA DE VERSIONES
     * ═══════════════════════════════════════════════════════════════════════
     * Toda modificación visible, funcional o estructural DEBE incrementar
     * APP_VERSION siguiendo semantic versioning (MAJOR.MINOR.PATCH):
     *
     *   PATCH (x.x.+1) → fixes de bugs, micro-ajustes de UI, tweaks de texto,
     *                    ajustes de espaciado, correcciones de cálculo aisladas.
     *   MINOR (x.+1.0) → features nuevas, nuevos módulos o pantallas,
     *                    rediseños de UI sustanciales, nuevos flujos.
     *   MAJOR (+1.0.0) → cambios que rompen datos/estructura en Firebase,
     *                    migraciones no retrocompatibles, redesign integral.
     *
     * Antes de cada commit: subir APP_VERSION y agregar la entrada en CHANGELOG.
     * La versión la ve el usuario en Más y en Novedades.
     * ═══════════════════════════════════════════════════════════════════════ */
    APP_VERSION: '8.0.0',
    EMAIL_DOMAIN: '@p2p-tracker.app',
    /* v8.0.0 — Cada cuenta se identifica con su sigla sobre su color, sin logos
       (pesaban y solo tres cuentas tenían). Los colores se oscurecieron lo
       justo para que la sigla blanca se lea bien. El ORDEN no se toca nunca:
       la posición es el código con que viaja cada operación. */
    BANCOS: [
        {nombre:'Santander',moneda:'UYU',color:'#c40000',sigla:'SA'},
        {nombre:'BBVA',moneda:'UYU',color:'#004481',sigla:'BB'},
        {nombre:'Itau',etiqueta:'Itaú',moneda:'UYU',especial:'itau',color:'#c25100',sigla:'IT'},
        {nombre:'Scotiabank',moneda:'UYU',color:'#c8101a',sigla:'SC'},
        {nombre:'BROU',moneda:'UYU',color:'#003087',sigla:'BR'},
        {nombre:'Prex',moneda:'UYU',color:'#6d28d9',sigla:'PX'},
        {nombre:'OCA',moneda:'UYU',color:'#005baa',sigla:'OC'},
        {nombre:'Mercado Pago',moneda:'UYU',color:'#0076b0',sigla:'MP'},
        {nombre:'Midinero',moneda:'UYU',color:'#00804a',sigla:'MD'},
        {nombre:'Zelle',moneda:'USD',color:'#6c1cd3',sigla:'ZE'},
        {nombre:'Zinli',moneda:'USD',color:'#00805e',sigla:'ZI'},
        {nombre:'Skrill',moneda:'USD',color:'#862165',sigla:'SK'}
    ]
};

/* ════════════════════════════════════════════════════════════════════════════
   §WIRE-COMPRESSION v4.7.63 — compresión de payload para Firestore
   ════════════════════════════════════════════════════════════════════════════
   PROBLEMA: el doc remoto llegó a 951 KB (límite duro de Firestore es 1 MB).
   Síntomas reales en producción: resource-exhausted, write stream exhausted,
   Firebase client terminated, retries acumulados, rollback de versión.
   
   SOLUCIÓN: codificar campos repetitivos en el WIRE (lo que viaja a/desde
   Firestore). EN MEMORIA la app sigue trabajando con el formato expandido —
   render, FIFO, splits, validaciones, todo intacto. SOLO cambia lo que se
   persiste remotamente.
   
   AHORROS MEDIDOS sobre data real del usuario (3564 ops, backup verificado):
     • tipo (compra/venta)     → t (0/1)       ahorro ~32 KB
     • banco (string)          → bk (int)      ahorro ~52 KB  
     • moneda (UYU/USD)        → m (0/1)       ahorro ~46 KB
     • timestamp (regenerable) → eliminar      ahorro ~136 KB
     • comisionPct condicional → solo si ≠def  ahorro ~63 KB
     TOTAL proyectado: ~329 KB → 951 → ~622 KB (35% reducción)
   
   ARQUITECTURA:
     • Doc remoto tiene flag `_wireFormat: 'v1'` cuando está comprimido
     • Al recibir snapshot: si wireFormat==='v1' → decodificar a memoria
     • Al guardar: comprimir copia de memoria → escribir
     • MEMORIA siempre tiene formato expandido (UI, lógica intacta)
     • Compatible con docs viejos: si no hay `_wireFormat`, leer como legacy
   ════════════════════════════════════════════════════════════════════════════ */

/* ─── Mapas de codificación ─────────────────────────────────────────────────
   Decisión: los IDs son ESTABLES y nunca se reordenan. Agregar nuevo banco al
   final con nuevo ID. NUNCA cambiar el ID de uno existente o se rompe la
   decodificación de data histórica.
   Los nombres provienen de CONFIG.BANCOS (los 12 oficiales) + "Mercado Pago"
   como caso especial. Si un banco no está en el mapa, fallback: guardar string
   literal con prefijo "$" para distinguirlo. */
const WIRE_TIPO_TO_INT={'compra':0,'venta':1};
const WIRE_TIPO_FROM_INT={0:'compra',1:'venta'};

const WIRE_MONEDA_TO_INT={'UYU':0,'USD':1};
const WIRE_MONEDA_FROM_INT={0:'UYU',1:'USD'};

/* Banco map: derivado de CONFIG.BANCOS en orden fijo. Si en el futuro se
   agregan bancos, van al final manteniendo IDs estables de los anteriores. */
const WIRE_BANCO_TO_INT=(()=>{
    const m={};
    CONFIG.BANCOS.forEach((b,i)=>{m[b.nombre]=i});
    return m;
})();
const WIRE_BANCO_FROM_INT=(()=>{
    const m={};
    CONFIG.BANCOS.forEach((b,i)=>{m[i]=b.nombre});
    return m;
})();

/* Comisión por defecto: el 95.51% de las ops tienen exactamente 0.14. Para
   esas ops, omitimos el campo del payload remoto (se asume default al leer).
   Solo se persiste cuando difiere. Ahorro real: ~63 KB. */
const WIRE_DEFAULT_COMISION_PCT=0.14;
/* Tolerancia para comparación de comisionPct (los floats no siempre son
   exactamente 0.14 después de round-trip JSON). Si difiere por menos de esto,
   se considera "default" y se omite. */
const WIRE_COMISION_PCT_EPS=0.0001;

/* Identificador del formato. Cambiar este string solo si se rompe
   compatibilidad con docs ya migrados. */
const WIRE_FORMAT_VERSION='v1';

/* ─── Codificación de una operación (memoria → wire) ─────────────────────────
   Convierte una op del formato expandido (interno) al formato comprimido (wire).
   No muta el original — devuelve copia. */
function _compressOpForWire(op){
    if(!op||typeof op!=='object')return op;
    const out={};
    /* id: string, siempre */
    if(op.id!==undefined)out.id=op.id;
    /* fecha + hora: strings cortas, no se comprimen (ya son chicas) */
    if(op.fecha!==undefined)out.f=op.fecha;
    if(op.hora!==undefined)out.h=op.hora;
    /* tipo → t (enum int) */
    if(op.tipo!==undefined){
        const v=WIRE_TIPO_TO_INT[op.tipo];
        if(v!==undefined)out.t=v;
        else out.tipo=op.tipo; /* fallback: tipo desconocido — guardar literal */
    }
    /* banco → bk (enum int) o bkn (literal si no está en map) */
    if(op.banco!==undefined){
        const v=WIRE_BANCO_TO_INT[op.banco];
        if(v!==undefined)out.bk=v;
        else out.bkn=op.banco; /* fallback: banco custom no en CONFIG */
    }
    /* moneda → m (enum int) */
    if(op.moneda!==undefined){
        const v=WIRE_MONEDA_TO_INT[op.moneda];
        if(v!==undefined)out.m=v;
        else out.moneda=op.moneda;
    }
    /* monto, tasa, usdt: numbers, no se comprimen */
    if(op.monto!==undefined)out.mo=op.monto;
    if(op.tasa!==undefined)out.ta=op.tasa;
    if(op.usdt!==undefined)out.u=op.usdt;
    if(op.comisionBanco!==undefined&&op.comisionBanco!==0)out.cb=op.comisionBanco;
    /* comisionPct: solo si difiere del default. El receptor asume default si falta. */
    if(op.comisionPct!==undefined){
        const diff=Math.abs(op.comisionPct-WIRE_DEFAULT_COMISION_PCT);
        if(diff>WIRE_COMISION_PCT_EPS)out.cp=op.comisionPct;
        /* si es default, NO se incluye — ahorra ~14 bytes por op default */
    }
    /* aportes (split): mantener tal cual, los bancos internos se codifican
       igual que arriba pero como subobjetos. Es array chico (≤5 entradas
       típicamente), el ahorro de comprimirlos no compensa la complejidad. */
    /* ═══ v7.2.1 — Sin depender del orden de carga ═══
       Acá se llamaba a esPagoDividido(), que se define en 04-utils. Pero este
       archivo es el PRIMERO que carga y la autoprueba de compresión se ejecuta
       apenas termina de leerse, cuando esa función todavía no existe: el error
       cortaba la ejecución a la mitad y todo lo que venía después nunca llegaba
       a definirse. De ahí que la app quedara en modo local y que la campana no
       respondiera. La comprobación es de una línea y no vale la dependencia. */
    if(Array.isArray(op.aportes)&&op.aportes.length)out.ap=op.aportes;
    /* timestamp: ELIMINADO del wire — se regenera al decodificar desde fecha+hora.
       Es campo derivable (no fuente de verdad). Ahorro ~136 KB. */
    /* Cualquier OTRO campo: copiar tal cual con prefijo "x_" para no chocar
       con los keys cortos del formato comprimido. Ej: notas, _editadoEn, etc.
       Defensivo: si en el futuro se agregan campos, se preservan. */
    Object.keys(op).forEach(k=>{
        if(['id','fecha','hora','tipo','banco','moneda','monto','tasa','usdt',
            'comisionBanco','comisionPct','aportes','timestamp',
            'consumedLots','ganancia','comisionPlataforma','costoUsdt','_syncState'].includes(k))return;
        out['x_'+k]=op[k];
    });
    return out;
}

/* ─── Decodificación de una operación (wire → memoria) ───────────────────────
   Inversa de _compressOpForWire. Reconstruye el formato expandido para que la
   app trabaje en memoria como siempre.
   
   ROBUSTEZ: si recibe un objeto ya en formato viejo (sin las claves cortas),
   lo devuelve tal cual. Esto permite leer docs no migrados sin error. */
function _decompressOpFromWire(op){
    if(!op||typeof op!=='object')return op;
    /* Detección: si tiene `tipo` (string) o `banco` (string), es formato viejo.
       Si tiene `t` (number) o `bk` (number), es formato nuevo.
       Si tiene ambos (corrupción), gana el viejo (más conservador). */
    const esViejo=(typeof op.tipo==='string')||(typeof op.banco==='string');
    if(esViejo)return op; /* legacy: no tocar */
    const out={};
    if(op.id!==undefined)out.id=op.id;
    if(op.f!==undefined)out.fecha=op.f;
    if(op.h!==undefined)out.hora=op.h;
    if(op.t!==undefined){
        const v=WIRE_TIPO_FROM_INT[op.t];
        if(v!==undefined)out.tipo=v;
    }else if(op.tipo!==undefined)out.tipo=op.tipo;
    if(op.bk!==undefined){
        const v=WIRE_BANCO_FROM_INT[op.bk];
        if(v!==undefined)out.banco=v;
    }else if(op.bkn!==undefined)out.banco=op.bkn;
    else if(op.banco!==undefined)out.banco=op.banco;
    if(op.m!==undefined){
        const v=WIRE_MONEDA_FROM_INT[op.m];
        if(v!==undefined)out.moneda=v;
    }else if(op.moneda!==undefined)out.moneda=op.moneda;
    if(op.mo!==undefined)out.monto=op.mo;
    if(op.ta!==undefined)out.tasa=op.ta;
    if(op.u!==undefined)out.usdt=op.u;
    if(op.cb!==undefined)out.comisionBanco=op.cb;
    else out.comisionBanco=0;
    /* comisionPct: si falta, default. Si existe, usar el valor explícito. */
    if(op.cp!==undefined)out.comisionPct=op.cp;
    else out.comisionPct=WIRE_DEFAULT_COMISION_PCT;
    if(Array.isArray(op.ap))out.aportes=op.ap;
    /* Reconstrucción de timestamp desde fecha + hora.
       Formato target: "YYYY-MM-DDTHH:MM:SS" (sin TZ, igual al original).
       Si falta hora, usar "00:00:00". */
    if(out.fecha){
        const horaCompleta=out.hora?(out.hora.length===5?out.hora+':00':out.hora):'00:00:00';
        out.timestamp=out.fecha+'T'+horaCompleta;
    }
    /* Restaurar campos "x_" → su nombre original */
    Object.keys(op).forEach(k=>{
        if(k.startsWith('x_'))out[k.substring(2)]=op[k];
    });
    return out;
}

/* ─── Codificación de arrays completos ──────────────────────────────────────
   Aplicado a operaciones. movimientos/transferencias/lotes/conversiones se
   dejan SIN comprimir por ahora — su volumen acumulado es bajo y el riesgo
   de bug por tocar más campos no compensa el ahorro marginal. */
function _compressOpsArrayForWire(arr){
    if(!Array.isArray(arr))return arr;
    return arr.map(_compressOpForWire);
}
function _decompressOpsArrayFromWire(arr){
    if(!Array.isArray(arr))return arr;
    return arr.map(_decompressOpFromWire);
}

/* ─── Self-test del motor de compresión (corre al cargar) ────────────────────
   Comprime + descomprime una op de prueba y verifica que el round-trip sea
   exacto. Si falla, marcar un flag global para abortar el sync. */
function _selftestWireCompression(){
    const opPrueba={
        id:'test_99999',
        fecha:'2026-05-26',hora:'12:34',
        tipo:'venta',banco:'Mercado Pago',moneda:'UYU',
        monto:5000,tasa:42.50,usdt:117.32,
        comisionBanco:0,comisionPct:0.14,
        timestamp:'2026-05-26T12:34:00'
    };
    const comprimida=_compressOpForWire(opPrueba);
    const restaurada=_decompressOpFromWire(comprimida);
    const camposCriticos=['id','fecha','hora','tipo','banco','moneda','monto','tasa','usdt','comisionBanco','comisionPct'];
    const errores=[];
    camposCriticos.forEach(k=>{
        if(opPrueba[k]!==restaurada[k]){
            errores.push(`${k}: original=${opPrueba[k]} vs restaurado=${restaurada[k]}`);
        }
    });
    /* timestamp: se regenera, comparamos por separado */
    if(restaurada.timestamp!==opPrueba.timestamp){
        errores.push(`timestamp: original=${opPrueba.timestamp} vs regenerado=${restaurada.timestamp}`);
    }
    if(errores.length>0){
        console.error('[P2P] WIRE COMPRESSION SELF-TEST FALLÓ:',errores);
        window._wireCompressionBroken=true;
        return false;
    }
    return true;
}
/* Correr el self-test inmediatamente al cargar la app */
_selftestWireCompression();

/* ═══════════════════════════════════════════════════════════════════════
 * CHANGELOG — registro de cambios por versión
 * ═══════════════════════════════════════════════════════════════════════
 * Mantener esta lista en sync con CONFIG.APP_VERSION. Cada release
 * debe agregar una entrada al INICIO del array (más reciente primero).
 * ═══════════════════════════════════════════════════════════════════════ */
/* CHANGELOG schema:
 * { version, date, headline (resumen corto para Novedades), changes: [{type,title,desc?}] }
 * type: 'feature' | 'improve' | 'fix' | 'perf'
 */
const CHANGELOG = [
    {version:'8.0.0', date:'2026-10-14', headline:'App nueva, pensada para el celular: cada movimiento con su historial y una papelera para recuperar lo borrado.', changes:[
        {type:'feature', title:'Pantallas nuevas', desc:'Abajo están Inicio, Registro, Cuentas y Más, y en el medio el botón + para cargar cualquier cosa. El inicio muestra la ganancia de hoy, la semana, tus cuentas y lo que cargaste hoy.'},
        {type:'feature', title:'Registro completo', desc:'Todo lo que cargaste en una sola lista por día, con filtros por tipo, período y cuenta, y búsqueda. Cada compra y venta muestra la comisión con la que se cerró. Tocá cualquier movimiento para ver su detalle y cómo cambió cada cuenta.'},
        {type:'feature', title:'Historial de cambios', desc:'Cada edición queda anotada en el movimiento: qué cambiaste, de qué valor a cuál y cuándo.'},
        {type:'feature', title:'Eliminados', desc:'Lo que borrás queda 30 días en Eliminados y se puede recuperar, también desde otro dispositivo. Al borrar aparece "Deshacer".'},
        {type:'feature', title:'Fecha y hora a elección', desc:'Podés cargar un movimiento de otro día u hora. No se permiten fechas futuras ni meses ya archivados.'},
        {type:'fix', title:'La comisión de Binance se descuenta de la ganancia', desc:'La ganancia de cada venta se calculaba sin restar la comisión de Binance, así que salía un poco más alta que la real. Ahora es lo que entró al banco menos lo que costaron los USDT que salieron, con la comisión incluida. Las ganancias que ya tenías cargadas bajan un poco; los meses archivados conservan su cálculo.'},
        {type:'improve', title:'Capital total y libro de cada cuenta', desc:'Cuentas muestra el capital total (bancos más tus USDT a lo que te costaron), el cupo de cada cuenta y tus lotes de USDT. El libro de cada cuenta muestra el saldo que dejó cada movimiento.'},
        {type:'improve', title:'Más rápida', desc:'Cada cambio se ve al instante y se sube a tu cuenta en segundo plano. Cómo se guardan tus datos no cambió.'}
    ]},
    {version:'7.3.0', date:'2026-09-26', headline:'Todo se recalcula al instante y cada movimiento se puede editar desde su cuenta.', changes:[
        {type:'fix', title:'Los ajustes, transferencias y correcciones recalculan al momento', desc:'Al crear o editar un ajuste externo en un banco, una transferencia o una corrección de saldo, el saldo quedaba viejo hasta que respondía el servidor (y sin conexión, hasta recargar). Ahora toda alta, edición o baja pasa por un mismo camino que recalcula saldos, lotes y cupos en el acto.'},
        {type:'fix', title:'Un cambio hecho mientras se guardaba se perdía', desc:'Si editabas algo mientras la app todavía subía lo anterior, la pantalla mostraba el valor nuevo pero en la nube quedaba el viejo: al recargar o en el otro dispositivo "volvía el saldo anterior". Ahora se confirma exactamente lo que viajó.'},
        {type:'fix', title:'Las cuentas nuevas no sincronizaban', desc:'Quien se registraba quedaba para siempre en "Esperando datos del servidor…" y no se guardaba nada en la nube.'},
        {type:'fix', title:'USDT inflado con compra y venta en el mismo minuto', desc:'El recálculo procesaba al revés dos operaciones del mismo minuto: la venta no encontraba el lote y el USDT quedaba de más. Tampoco se pierden más centavos al restar lotes.'},
        {type:'fix', title:'Pago dividido, lotes y categorías', desc:'El pago dividido cobraba dos veces la comisión del banco; editar solo el precio de un lote manual volvía a descontar sus ventas; renombrar o fusionar una categoría no se guardaba en la nube.'},
        {type:'fix', title:'El cupo diario renueva el día que corresponde', desc:'Si no abrías la app el día de renovación, el cupo seguía sumando compras de días anteriores y podía frenar una compra que el banco sí permitía. Ahora la renovación sale de los días marcados en la cuenta. Corregir una transferencia de otro día tampoco se frena por el cupo de hoy.'},
        {type:'feature', title:'Cada movimiento se abre desde el libro de su cuenta', desc:'Tocá una cuenta en Mis Saldos y después cualquier línea: se abre la operación, el ajuste, la transferencia o la corrección para editarla o borrarla. Las correcciones de saldo ahora también se editan y se borran.'},
        {type:'improve', title:'Menú nuevo', desc:'Cuatro accesos grandes a lo más usado, análisis y datos agrupados, el historial archivado a mano y "Borrar todos los datos" separado al final. Suma la opción de archivar meses anteriores.'},
        {type:'improve', title:'Más liviana y sin emojis', desc:'Se retiró código que ya no se usaba, los logos pesan un cuarto y los emojis que quedaban pasaron a íconos. Las tasas rápidas salen de tus operaciones reales, y "Restaurar respaldo" solo ofrece respaldos de tu cuenta.'}
    ]},
    {version:'7.2.1', date:'2026-08-24', headline:'Corregido el error que dejaba la app en modo local.', changes:[
        {type:'fix', title:'La aplicación arrancaba a medias', desc:'En la versión anterior se usó dentro del primer archivo que carga una función que se define en el cuarto. Ese archivo ejecuta al terminar de leerse una comprobación de la compresión de datos, y ahí la función todavía no existía: saltaba un error que cortaba su ejecución a la mitad, así que todo lo que venía después nunca llegaba a definirse. La aplicación arrancaba igual pero incompleta, y por eso quedaba en modo local sin sincronizar y la campana de novedades no respondía. Los síntomas aparecían lejos de la causa, que es lo que hace difíciles estos errores. La comprobación es de una sola línea, así que se escribió directamente y no depende de ningún otro archivo.'},
        {type:'improve', title:'El verificador detecta este tipo de error', desc:'Se le agregó una comprobación que sigue la cadena de llamadas: si un archivo ejecuta algo al cargarse, y eso llama a una función de un archivo posterior, lo informa con la cadena completa. Se comprobó reintroduciendo el error a propósito, y lo detecta. Ninguna de las herramientas anteriores podía verlo, porque el código es correcto: el problema es únicamente el momento en que se ejecuta.'}
    ]},
    {version:'7.2.0', date:'2026-08-24', headline:'La última regla repetida ya tiene una sola función dueña.', changes:[
        {type:'improve', title:'Quién pagó cuánto se responde en un solo lugar', desc:'Una compra puede pagarse desde una cuenta o repartida entre varias, y esa pregunta se respondía en diez lugares distintos, cada uno con su propia versión. De ahí salieron cuatro fallas en una sola semana: el saldo se descontaba a una cuenta que no había pagado, el cupo diario se cargaba entero a la principal, la validación pedía el total a una sola cuenta y rechazaba compras que sí entraban, y el resumen mostraba un saldo negativo imposible. Ahora hay una única función que devuelve siempre la lista de cuentas con lo que puso cada una, tenga la compra pago dividido o no, así que quien la usa no necesita saber la diferencia. También se retiró un bloque que había quedado completamente vacío al simplificar el borrado.'},
        {type:'improve', title:'Las seis reglas quedaron con dueño único', desc:'Era el último de los seis casos que el verificador venía señalando: la fecha de un registro, el efecto sobre las cuentas, el efecto sobre la billetera, el cupo diario, el saldo de un banco y ahora el pago dividido. Cada uno dejó de producir fallas apenas se unificó. El verificador de coherencia informa cero problemas.'}
    ]},
    {version:'7.1.0', date:'2026-08-24', headline:'Diecinueve ajustes de saldo redundantes, retirados.', changes:[
        {type:'improve', title:'El saldo dejó de tocarse a mano al editar y borrar', desc:'Desde que el saldo se reconstruye sumando los registros, los ajustes manuales que quedaban en los caminos de editar, borrar y cambiar de cuenta ya no servían para nada: el recálculo posterior los pisaba siempre. Se comprobó midiendo el resultado con y sin ellos en los tres escenarios —borrar una operación, cambiarle el monto y cambiarle la cuenta— y da exactamente lo mismo. Eran diecinueve líneas que había que mantener de acuerdo entre sí sin ningún beneficio, y donde ya nos había fallado el pago dividido en cuatro lugares distintos. Retirarlas no cambia ningún número y deja una sola función responsable del saldo.'},
        {type:'improve', title:'Queda una sola regla repetida', desc:'De las seis reglas que estaban escritas en muchos lugares a la vez, cinco ya tienen una única función dueña: la fecha de un registro, el efecto sobre las cuentas, el efecto sobre la billetera, el cupo diario y ahora el saldo. Cada una dejó de producir fallas apenas se unificó. La que queda es la interpretación del pago dividido, que es justamente la que más problemas dio.'}
    ]},
];
/* ═══ Regla fija: solo las últimas N versiones viven en el bundle ═══
   Si al subir de versión se olvida retirar las viejas, el centro de novedades
   igual muestra solo las últimas N. */
const CHANGELOG_MAX_ENTRIES=5;