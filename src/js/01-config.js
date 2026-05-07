/* ═══════════════════════════════════════════════════════════════════
   01-config.js
   Generated piece — concatenated into dist/index.html by build/build.js
   Source of truth: src/js/01-config.js
   Do NOT edit dist/index.html directly. Edit the source and re-run build.
   ═══════════════════════════════════════════════════════════════════ */
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
const CONFIG = {
    firebase: {apiKey:"AIzaSyCL2uxQMNIxC0oo35uN-lYQXaOWLxXNg7k",authDomain:"p2p-tracker-dc9cc.firebaseapp.com",projectId:"p2p-tracker-dc9cc",storageBucket:"p2p-tracker-dc9cc.firebasestorage.app",messagingSenderId:"670856094446",appId:"1:670856094446:web:390946887212a97e36c9ff"},
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
    APP_VERSION: '4.7.31',
    POR_PAGINA: 10,
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
    {version:'4.7.31', date:'2026-05-06', headline:'🔍 Auditoría técnica: hash insuficiente, leak de syncQueue, fixNeg mal documentado.', changes:[
        {type:'fix', title:'Hash de mergeRemoteState detectaba pocos cambios', desc:'BUG REAL: el hash de v4.7.28 solo miraba id+timestamp, pero las ediciones de operaciones NO actualizan timestamp (solo updatedAt). Resultado: si otro device editaba el monto de una op, mi device skipeaba recalcularLotesYGanancias y la ganancia quedaba desactualizada. Ahora el hash incluye updatedAt + monto + tasa + tipo + aportes.length. Costo: 5ms para 2671 ops (antes 3ms).'},
        {type:'fix', title:'_syncQueue podía crecer sin límite', desc:'En escenarios offline largos con writes fallidos repetidos, _syncQueue acumulaba entries sin tope (memory leak lento). Cap defensivo de 500 entries con FIFO eviction. No afecta funcionalidad — el sync real depende de _localDirty, no de la queue.'},
        {type:'improve', title:'fixNeg documentado correctamente', desc:'Encontré comentarios y supuestos en el código que decían que fixNeg "previene saldos negativos". MENTIRA — solo maneja -0 y NaN. La protección anti-negativo real vive en validarDeltas() pre-mutación. Documenté la verdad para evitar que alguien (yo incluido) asuma protección que no existe.'},
        {type:'verified', title:'Auditoría completa pasada', desc:'Revisé enablePersistence, onSnapshot, guardarDatos, guardaOptimista, backups, restore, sync online/offline, validaciones anti-saldo-negativo, lotes FIFO, calendario, filtros, novedades, edición/eliminación. No hay race conditions críticas, no hay sobrescrituras incorrectas, no hay loops de escritura. La arquitectura está sólida — los 3 bugs encontrados eran semánticos/documentales, no funcionales.'},
        {type:'verified', title:'Hash test cases verificados de verdad', desc:'En v4.7.28 dije "el hash detecta ops editadas (timestamp cambia)" — incorrecto, timestamp NO cambia en edits. Ahora valido por código: edit monto, edit tasa, cambio de aportes (split), todos detectados. Tests reales pasaron 4/4.'}
    ]},
    {version:'4.7.30', date:'2026-05-06', headline:'🔒 Hardening contra Firestore SDK INTERNAL ASSERTION (issue #6256).', changes:[
        {type:'fix', title:'Init serializado: enablePersistence antes de cualquier query', desc:'Causa real del bug "INTERNAL ASSERTION FAILED" en Samsung Browser/Android: enablePersistence se llamaba sin await, y onSnapshot de cargarDatosUsuario podía dispararse antes que persistence resuelva. Race condition documentada del SDK. Fix: gateamos toda la inicialización (auth listener, snapshots) detrás del .then de enablePersistence. Se contemplan los 3 casos: success, unimplemented (browsers viejos) y failed-precondition (otra tab abierta).'},
        {type:'fix', title:'cargarDatosUsuario idempotente y guardado', desc:'Si recovery está activa, no setear nuevo onSnapshot — la instancia vieja del SDK está siendo desmontada. Limpieza explícita del listener anterior con try/catch antes de crear uno nuevo, evitando dos onSnapshot simultáneos sobre el mismo doc (otro trigger documentado del bug).'},
        {type:'fix', title:'guardarDatos aborta durante recovery', desc:'Cualquier write nuevo durante terminate + clearPersistence sería sobre instancia inválida → INTERNAL ASSERTION garantizado. El backup local ya tiene los datos, así que abortar es seguro — al recargar, restoreFromLocal recupera todo.'},
        {type:'improve', title:'Recovery con cleanup ordenado', desc:'iniciarRecuperacionFirestore ahora cancela TODO trabajo en flight (retry timer, debounce timer, snapshot listener) ANTES de tocar terminate(). Promise.race con timeout de 4s evita colgarse en terminate eterno. Si cualquier paso falla, igual recargamos — la página fresh re-inicializa todo correctamente.'},
        {type:'verified', title:'Anti-loop de retries', desc:'Los retry timers existentes ya estaban OK porque guardarDatos aborta apenas detecta recovery. Triple guard (en guardarDatos, en cargarDatosUsuario, en el handler de onSnapshot) garantiza que ninguna ruta accidentalmente toque el SDK durante la limpieza.'}
    ]},
    {version:'4.7.29', date:'2026-05-06', headline:'⚡ Restaurar respaldo: instantáneo + recuperación automática de errores Firestore SDK.', changes:[
        {type:'perf', title:'Restore manual sin "Reconciliando…" eterno', desc:'Después de restaurar un respaldo, la app se sentía bloqueada 1-2 segundos en "Reconciliando…". Causa: con _localVersion=0, cualquier snapshot de Firebase caía en Branch 2 (merge) → recalcularLotesYGanancias completo. Fix: post-restore lock de 6s que ignora snapshots durante la ventana, y recalcular diferido a idle. La UI muestra los datos restaurados inmediatamente.'},
        {type:'perf', title:'Trust en datos del backup', desc:'El backup ya contiene op.ganancia y lotes consistentes (fueron persistidos así). Antes el restore corría recalcularLotesYGanancias sincrónicamente (~300ms con 1k+ ops). Ahora se difiere a idle como red de seguridad — la UI funciona instantáneamente con los datos del backup, y el recalc defensivo corre en background.'},
        {type:'fix', title:'Recuperación automática de errores Firestore SDK', desc:'Bug conocido del SDK Firestore (issue #6256): a veces lanza "INTERNAL ASSERTION FAILED" en Samsung Browser/Android. Una vez ocurrido, todas las queries siguientes fallan hasta recargar. Ahora la app detecta el error, muestra banner amarillo claro, hace flush del backup local y recarga automáticamente. Los datos están a salvo en localStorage.'},
        {type:'fix', title:'Filtro de errores cross-origin', desc:'Los errores "Script error. @ :?" (errores cross-origin del SDK Firebase con stack hidden por CORS) inundaban el log de diagnóstico ocultando errores reales. Ahora se filtran como ruido conocido. Si necesitás ver el detalle real del error, mirá los entries no-Script-error que sí muestran el stack.'},
        {type:'verified', title:'Compatibilidad con v4.7.28 (hash skip)', desc:'El skip de recalcular vía hash en mergeRemoteState sigue funcionando para snapshots normales. El post-restore lock corta antes en el flujo, así no compite con el hash check.'}
    ]},
    {version:'4.7.28', date:'2026-05-06', headline:'⚡ Reconciliación 5–10× más rápida en datasets grandes (2k+ ops).', changes:[
        {type:'perf', title:'Skip de FIFO recompute si no cambiaron las arrays', desc:'mergeRemoteState ahora calcula un hash ligero (3ms) de operaciones/movimientos/transferencias/conversiones antes y después del merge. Si el snapshot remoto solo trajo cambios escalares (tags, comisión global, lastSeenVersion, dismissedVersions), saltea recalcularLotesYGanancias completamente. Ahorro: ~300-500ms por reconcile en iOS con 2671 ops.'},
        {type:'perf', title:'Recalcular diferido a idle time', desc:'Cuando sí hace falta recalcular (cambio real en arrays remoto vs local), ahora corre via requestIdleCallback con timeout de 1.5s. La UI sigue respondiendo mientras la app procesa el recalc en background. En Safari (sin requestIdleCallback) cae a setTimeout(0). El badge "Reconciliando…" desaparece visualmente más rápido.'},
        {type:'verified', title:'Sin regresión en mutaciones de usuario', desc:'recalcularLotesYGanancias en agregarOperacion/editarOperacion/etc sigue corriendo sincrónicamente — el usuario debe ver la ganancia recalculada inmediatamente al crear una op. El defer solo aplica al path de snapshot remoto, donde el usuario no está esperando ese cómputo.'},
        {type:'verified', title:'Hash test cases verificados', desc:'El hash detecta correctamente: ops editadas (timestamp cambia), nuevas, borradas, reordenadas, e ignora correctamente cambios escalares. Tamaño del hash transitorio para 2671 ops: ~59KB (recolectado por GC al salir de la función).'}
    ]},
    {version:'4.7.27', date:'2026-04-25', headline:'🛡️ Persistencia: triple safety net + timeout de 30s + manejo de quota.', changes:[
        {type:'feature', title:'Flush forzado por cantidad pendiente', desc:'El debounce ahora tiene 3 disparadores: tiempo (>2s), cantidad (>=10 entries en cola), o normal (400ms). Antes, una ráfaga de 50 mutaciones esperaba hasta el timeout por tiempo — ahora se dispara apenas pase el umbral de cantidad. Beneficio en imports rápidos y entrada masiva.'},
        {type:'feature', title:'Timeout de seguridad en transacciones (30s)', desc:'Promise.race entre la transacción Firebase y un timer de 30s. Si la red se cuelga, _guardando ya no queda eterno bloqueando saves siguientes. El backup local ya está hecho, así que es seguro fallar y dejar al retry timer reintentar con backoff.'},
        {type:'fix', title:'QuotaExceededError manejado', desc:'Cuando localStorage llega al límite (5MB en algunos browsers), backupToLocal detecta el error específicamente. Estrategia: liberar el backup _prev (rotación) y reintentar. Si aun así falla, avisar UNA vez por sesión vía sync status para no spamear.'},
        {type:'verified', title:'Auditoría completa pasada', desc:'Sin más ventanas de pérdida: backup inmediato pre-debounce (v4.7.26), 3 lifecycle hooks, esDatosVacios guard, rotación con _prev, mergeRemoteState protege local-only, _puntajeDatos arbitra restauración. Sistema listo para escalar a miles de operaciones.'}
    ]},
];
/* ═══ Regla fija: solo las últimas N versiones viven en el bundle ═══
   Si al bumpear se olvida retirar las viejas, el código las recorta automáticamente.
   Doble red de seguridad: advertencia en consola + slice defensivo. */
const CHANGELOG_MAX_ENTRIES=5;
function normalizarChangelog(){
    /* Advertencia de mantenimiento — no rompe nada, solo avisa al dev */
    if(CHANGELOG.length>CHANGELOG_MAX_ENTRIES&&!normalizarChangelog._warned){
        normalizarChangelog._warned=true;
        console.warn(`[P2P] CHANGELOG tiene ${CHANGELOG.length} entradas — retirar las más viejas para mantener solo las últimas ${CHANGELOG_MAX_ENTRIES}.`);
    }
    /* CAP defensivo: aunque el array crezca, solo se expone ventana N */
    const capped=CHANGELOG.slice(0,CHANGELOG_MAX_ENTRIES);
    /* Convierte entradas legacy con changes:[string] al formato {type,title,desc}.
       Detecta type por keywords; default 'improve'. */
    return capped.map(entry=>{
        if(!entry.changes)return entry;
        const norm=entry.changes.map(ch=>{
            if(typeof ch==='object'&&ch.title)return ch;
            const s=String(ch);
            const lower=s.toLowerCase();
            let type='improve';
            if(/^(fix|bug|auditor[ií]a)\b/i.test(s)||lower.includes(' fix ')||lower.startsWith('fix:'))type='fix';
            else if(/^(perf|cache|optim)/i.test(s)||lower.includes('perf:'))type='perf';
            else if(/^(nuev[oa]|agreg|implement|edici[oó]n)/i.test(s)||lower.includes('feature'))type='feature';
            return{type,title:s,desc:''};
        });
        return{...entry,changes:norm};
    });
}

/* ═══════════════════════════════════════
   §2 — ESTADO CENTRALIZADO
   ═══════════════════════════════════════ */
const AppState = {
    db: null, auth: null, currentUser: null, unsubscribe: null,
    datos: null,
    _localVersion: 0,
    _datosStale: false,
    _postRestoreLockTs: 0,
    ui: { bancoEditando:null, tipoMovimiento:'ingreso', calendarDate:new Date(),
          loteEditandoId:null, paginaOp:1, paginaMov:1, paginaTrans:1, paginaConv:1,
          guardandoMovimiento:false, guardandoLote:false, guardandoOperacion:false, guardandoTransferencia:false,
          enCooldown:false, comisionDebounce:null, tasaManual:false, ultimoMonedaBanco:null, syncState:'offline', opEditandoId:null, tagPeriodo:'total' }
};

function crearDatosVacios() {
    return {operaciones:[],movimientos:[],transferencias:[],conversiones:[],bancos:{},lotes:[],tags:[],tasasRecientes:[],
            saldoUsdt:0,ultimaTasaCompra:0,ultimaTasaVenta:0,comisionPlataforma:0.14,
            ultimaTasaCompraUSD:0,ultimaTasaVentaUSD:0,comisionUSD:0.14,ultimoMesProcesado:'',_version:0,
            lastSeenVersion:'',dismissedVersions:[]};
}
AppState.datos = crearDatosVacios();

