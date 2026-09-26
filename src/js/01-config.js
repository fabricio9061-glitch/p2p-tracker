/* ╔═══════════════════════════════════════════════════════════╗
   ║  REGISTRO P2P — Código refactorizado                     ║
   ║  • Estado centralizado (AppState)                        ║
   ║  • Sin eventos inline (event delegation)                 ║
   ║  • Funciones de DOM centralizadas                        ║
   ║  • Paginación genérica reutilizable                      ║
   ║  • FIFO encapsulado                                      ║
   ╚═══════════════════════════════════════════════════════════╝ */
'use strict';

/* ═══════════════════════════════════════
   §1 — CONFIGURACIÓN
   ═══════════════════════════════════════ */
/* ═══ Logos embebidos (base64) v4.7.51 — sin dependencia externa ═══
   v7.3.0: reducidos a 60px (se muestran a 20px; alcanza para pantallas 3x) —
   pesaban 24 KB y ahora 6 KB. Reemplazan emojis/texto plano en tarjetas de saldo.
   Robustez: no dependen de Wikimedia ni de ninguna CDN. */
const LOGO_USDT='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAMAAAANIilAAAAAkFBMVEVMaXEWoHkVonkVk28VoHgVpHwVg2QGjm8UonoUonoVn3gUonoVlG8WiWUWmnQVn3cVcVYWmnQVnXYVo3v///8WpX3+//4Jn3QQoXgVq4EWroMDnHATo3sapn78/v3r9/QhqILU7udWvKAtrIma18VkwqdLuJk8spH1+/lyx6/g8+6r3c+R08DY8OmEzbm+5dpe2QlVAAAAE3RSTlMAss9IweggAvz+pfNUKn79FWqPd4tNzgAAAAlwSFlzAAALEwAACxMBAJqcGAAAA6NJREFUeNqdlwt3qjAMgEHAUp9z0EFBhIGAqNv+/7+7SUEoWEBvjp6DlY88SJtE04ZCCHyXm52+sPZ0v18v9N1mSer1aRHkdmdaPOCcMcdhjMOlZe62BP4kMyzZ6HbAmW3blDoglMIV48FaN8ikdni0seCBA6TTE1wIuGnALeNqtzrndAA2Qm3Ko9VyRDmsHtaBrUYb/YF1UNJE+1gFbAIV2hn/JM+mE21pBjZ1ZoTagfkxpIFdBLYzL0AvBjSy/BUWPX+iP8zgRRZpU/abaKvXWaQ/Oxje0Tss0HzzoCE31qyN83FC2qgxa9kq1t9TjIavatVE27SBZl56/R6Tn7/MZw+aGYImpHtLUZi7J1ctX24swdxEGBW3DjOEx0SGHRoJ1UTv0oO9qvnh9VYKloC/GnlAjQw0H9db8Hknhfpln1H1AWBTSmrm5Zf4IZca6hZ+ejCETNtaTNqIxyh5iH9GI05u7rRLve2FibLp76aj38gxbOA0pO1aL1Eg3p9P2cVQosh7wF4UiaWnLNtp+mAfwz2+74E8NBch/vJ9Z4DbfKX1XGYMOJpkZZHm6R/CX+4dLosyS+AfX+ZtvtCkDQXB9rI0r3K8u0xuTcCSEp9VVXmRhB6TI6btpQB6xfk3zSJhtd8FrP6dlOnvvQy7NGFrTTLaP8cl3EXriCGMeQUBE9E6wjPSuOpeNdt3MPNK95qF4FjUwuhzDQPue2FxihO/VbbvmX0/nW5p4odhiGbfRW5dCjQblvws/3MvlS+bLQUMfL7F7uX79ptDeKOslgSDn99v3xf3ei49JgfM6kU7jIrf2zW+4P6N6/NDXF/in1tVOmEvuRf9JMH3DDZHWZFW1Tc4DJ9bVaVFFuE67b1n2NHD9IRwOXWG3cWhUmcYJBgk6VN6bhRlRkRbym1FZqPPxmBLOtK50MJMWfHE2W2qK9wcLA6D3jH0DiyOoa26WszAcABixSG60u4ZuD56e4f+G5qjpt4oQzYNN+UGvsZ/wE2hGymxk3BbYrG4KxJFwJieClgq7uq2QjoM2ERbUTc0+2F+h/f4ChIXHptqaETEn3RD5YlQnvUGeq+FVDaAVFFj6jZM0QI+tZ5MUWUU7aNoel9pXKFr1j9UbS+ZbZmdkZa5btat6WadBtZmZFAAeinGBDo2JvDRMaE23TDVAwqdGVCa0cjQ1zAa0WY2ouICR6PVzGgkhiNpKDt2Q9lhq80NZd04aOA4uIZp0FqsdsbIOPgPiErtvOa+o6EAAAAASUVORK5CYII=';
const LOGO_ITAU='data:image/png;base64,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';
const LOGO_MP='data:image/png;base64,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';
const _BANK_LOGOS={'Itau':LOGO_ITAU,'Itaú':LOGO_ITAU,'Mercado Pago':LOGO_MP,'MercadoPago':LOGO_MP};
function _bancoLogoImg(nombre,size){
    const src=_BANK_LOGOS[nombre];
    if(!src)return '';
    return `<img src="${src}" alt="" class="banco-logo-img" style="width:${size||20}px;height:${size||20}px;object-fit:contain;border-radius:5px;vertical-align:middle;flex:0 0 auto" loading="lazy" onerror="this.style.display='none'">`;
}

const CONFIG = {
    firebase: {apiKey:"AIzaSyC5GPlXKziT4XdGpcdUR_gtnQE5RIrricw",authDomain:"binancp2p-f831f.firebaseapp.com",projectId:"binancp2p-f831f",storageBucket:"binancp2p-f831f.firebasestorage.app",messagingSenderId:"118313786206",appId:"1:118313786206:web:a964400f85dac298a78dcf"},
    /* ═══════════════════════════════════════════════════════════════════════
     * 📌 VERSION BUMP POLICY — REGLA OBLIGATORIA
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
     * ⚠️ ANTES DE CADA COMMIT: bumpear APP_VERSION y agregar entrada en CHANGELOG.
     * ⚠️ NO DEJAR la versión desactualizada — la ve el usuario en "Configuración".
     * ═══════════════════════════════════════════════════════════════════════ */
    APP_VERSION: '7.3.0',
    /* v5.4.6 — Eran 10: con 286 operaciones daban 29 páginas y llegar a una del
       medio pedía una docena de toques. Con 25 quedan 12 y la lista sigue liviana. */
    POR_PAGINA: 25,
    EMAIL_DOMAIN: '@p2p-tracker.app',
    COOLDOWN_MS: 300,
    BANCOS: [
        {nombre:'Santander',moneda:'UYU',color:'#ec0000'},
        {nombre:'BBVA',moneda:'UYU',color:'#004481'},
        {nombre:'Itau',moneda:'UYU',especial:'itau',color:'#ef6c00'},
        {nombre:'Scotiabank',moneda:'UYU',color:'#ec111a'},
        {nombre:'BROU',moneda:'UYU',color:'#003087'},
        {nombre:'Prex',moneda:'UYU',color:'#6d28d9'},
        {nombre:'OCA',moneda:'UYU',color:'#005baa'},
        {nombre:'Mercado Pago',moneda:'UYU',color:'#009ee3'},
        {nombre:'Midinero',moneda:'UYU',color:'#00b460'},
        {nombre:'Zelle',moneda:'USD',color:'#6c1cd3'},
        {nombre:'Zinli',moneda:'USD',color:'#00c28e'},
        {nombre:'Skrill',moneda:'USD',color:'#862165'}
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
            'consumedLots','ganancia','comisionPlataforma','_syncState'].includes(k))return;
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
 * 📜 CHANGELOG — registro de cambios por versión
 * ═══════════════════════════════════════════════════════════════════════
 * Mantener esta lista en sync con CONFIG.APP_VERSION. Cada release
 * debe agregar una entrada al INICIO del array (más reciente primero).
 * Formato: { version, date (YYYY-MM-DD), changes: [array de strings] }
 * ═══════════════════════════════════════════════════════════════════════ */
/* CHANGELOG schema:
 * { version, date, headline (resumen corto p/ modal "qué hay nuevo"), changes: [{type,title,desc?}] }
 * type: 'feature' | 'improve' | 'fix' | 'perf'
 * Para entradas viejas legacy (changes: [string]) hay normalizador en normalizarChangelog().
 */
const CHANGELOG = [
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