/* ═══════════════════════════════════════════════════════════════════
   01-config.js
   Generated piece — concatenated into docs/index.html by build/build.js
   Source of truth: src/js/01-config.js
   Do NOT edit docs/index.html directly. Edit the source and re-run build.

   ⚠️ SINCRONIZADO MANUALMENTE con docs/index.html v4.7.43 (2026-05-15)
      Las versiones v4.7.32–v4.7.43 fueron editadas directamente en
      docs/index.html. Este archivo se regeneró desde ese index para
      eliminar el drift. Si vas a usar el build, verificá que las demás
      piezas (02-09) también estén sincronizadas antes de correrlo.
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
    APP_VERSION: '4.7.43',
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
    {version:'4.7.43', date:'2026-05-15', headline:'🇧🇷 Migración a Firebase Brasil (São Paulo) — latencia mucho menor desde Uruguay.', changes:[
        {type:'perf', title:'Cambio de proyecto Firebase: us-central → southamerica-east1', desc:'El proyecto viejo (p2p-tracker-dc9cc) estaba en us-central1 (Iowa). Latencia desde Uruguay: 180-250 ms por roundtrip, contribuyendo a writes de 17-20s con payload de 840 KB. Nuevo proyecto (binancp2p-f831f) en southamerica-east1 (São Paulo). Latencia esperada: 30-60 ms. Esperado: writes en 3-6 segundos. Esto es lo único que cambió — la arquitectura interna del sync engine es idéntica.'},
        {type:'verified', title:'Lo que NO se tocó', desc:'Strip de payload (consumedLots, ganancia, comisionPlataforma, lotes, saldoUsdt) sigue activo. Circuit breaker, bootstrap independiente, repair de orphans, fix de setTimeout fantasma, manejo de client-terminated — todo intacto. Solo cambiaron las credenciales del proyecto Firebase.'},
        {type:'verified', title:'Migración: pasos exactos', desc:'1) Desde iPhone con datos buenos: Menú → Exportar datos → guardar JSON. 2) Subir v4.7.43 a GitHub Pages. 3) Hard refresh en iPhone → app conecta al proyecto nuevo (vacío). 4) Registrarte (no login — es cuenta nueva en proyecto nuevo). 5) Importar el JSON guardado. 6) La app pushea todo al server en Brasil. 7) En PC y Galaxy: hard refresh + login con el mismo email/password registrado en paso 4. Datos aparecen automáticamente.'},
        {type:'verified', title:'Si algo sale mal', desc:'El proyecto viejo (p2p-tracker-dc9cc) NO se borra todavía. Si necesitás volver atrás: cambiar las credenciales en index.html a las del proyecto viejo y subir. Todos los datos siguen ahí. Recomendación: mantener el proyecto viejo durante 1-2 semanas como red de seguridad antes de borrarlo.'},
        {type:'verified', title:'Verificar que la migración funcionó', desc:'Después del primer write, abrir Diagnóstico de sincronización. En "TIMING DEL ÚLTIMO SAVE": Tiempo de write esperado <6 segundos (vs 17s antes). Si sigue tardando >10s, hay otra causa (red local, ISP, persistence corrupta) y vemos.'}
    ]},
    {version:'4.7.42', date:'2026-05-14', headline:'🛑 Manejo seguro del error "client has already been terminated".', changes:[
        {type:'fix', title:'Detección del estado terminated del SDK Firebase', desc:'Log de v4.7.41 reveló error específico: failed-precondition "The client has already been terminated". Es un estado interno del SDK Firebase (probablemente por bug del SDK o recovery mal finalizado) donde TODOS los writes futuros fallan instantáneamente. Los retries automáticos son inútiles — el cliente nunca se recupera solo. Solución conservadora (acordada): detectar este error específico y detener TODO el sync remoto hasta que el usuario recargue la app. NO intentar re-inicialización en caliente (firebase.app().delete() + initializeApp()) que es riesgosa.'},
        {type:'feature', title:'Banner persistente con opciones claras', desc:'Cuando el SDK queda terminated, aparece un banner naranja en la parte inferior: "Firebase quedó en estado interno inválido. Tus datos están guardados localmente. Recargá la app para reactivar la sincronización." Dos botones: 🔄 Recargar ahora (verde, hace flush + backup local + reload) y "Seguir en modo local" (oculta el banner pero mantiene el bloqueo de sync). La app sigue 100% usable en modo local en ambos casos.'},
        {type:'feature', title:'Bloqueo seguro de saves futuros', desc:'Una vez detectado el estado terminated: AppState._clientTerminated=true bloquea TODO intento de guardarDatos() y forzarSyncManual() hasta el reload. Se resetean _guardando, _syncPending, _guardarPendiente, _retryTimer. Pero se PRESERVAN intactos _syncQueue y _localDirty — los datos pending se mantienen para sincronizarse después del reload.'},
        {type:'feature', title:'Estado en panel de Diagnóstico', desc:'Nuevo campo "Firebase client" en la sección General del panel. Muestra "✓ activo" o "🛑 TERMINATED — requiere recarga" con la hora exacta en que pasó al estado terminated. Logs nuevos: firebase:client-terminated y sync:requires-reload.'},
        {type:'verified', title:'Lo que NO se toca', desc:'NO se ejecuta firebase.app().delete() en caliente. NO se reinicializa el SDK sin reload. NO se reintenta el write fallido (sería loop infinito). NO se modifica payload, formato, ni se hace migración. Solo manejo seguro del error específico.'},
        {type:'verified', title:'Cómo probar', desc:'Difícil reproducir el bug a propósito (es un error interno del SDK que aparece esporádicamente). Cuando aparezca: 1) Aparece banner naranja abajo. 2) Tocar "Recargar ahora" → la app se reinicia, lee del cache local, los datos pending se sincronizan automáticamente. 3) Si tocás "Seguir en modo local", podés seguir usando la app pero el sync remoto queda bloqueado hasta que recargues manualmente. 4) En Diagnóstico: "Firebase client: 🛑 TERMINATED" + log con firebase:client-terminated.'}
    ]},
    {version:'4.7.41', date:'2026-05-14', headline:'⚡ Strip comisionPlataforma (verificado 3092/3092 exact) + fix analizador.', changes:[
        {type:'perf', title:'Strip de comisionPlataforma — verificación exhaustiva', desc:'Auditoría v4.7.40 reportó SAFE-TO-STRIP con 3092/3092 exact match. La fórmula canónica truncar(usdtBase × comisionPct/100, 2) — donde usdtBase = roundMoney(monto/tasa,2) para compras y truncar(monto/tasa,2) para ventas — reproduce el valor guardado en TODAS las ops del usuario. Strip aplicado solo a la copia del payload — AppState.datos.operaciones[i].comisionPlataforma sigue intacta para la UI. Ahorro estimado adicional: ~75 KB.'},
        {type:'fix', title:'Analizador medía AppState.datos en vez del payload remoto', desc:'BUG: el analizador hacía JSON.stringify(AppState.datos) y reportaba ese tamaño como veredicto. Pero AppState.datos contiene los campos derivables (lotes, saldoUsdt, ganancia, consumedLots) porque recalcularLotesYGanancias los reconstruye después de cada snapshot. El payload remoto NO los incluye. Resultado: el panel decía "🛑 Crítico 1143 KB" cuando el payload real era 905 KB. Fix: el analizador ahora simula exactamente el mismo strip que guardarDatos y reporta ambos: "Payload REMOTO (real)" y "Estado LOCAL completo".'},
        {type:'fix', title:'Falsas alarmas en flags "lotes embebidos" y "saldoUsdt persistido"', desc:'Las flags marcaban estos campos como problemas cuando en realidad son comportamiento esperado: el state local SIEMPRE los tiene porque recalc los reconstruye. El payload remoto NO los lleva (verificable comparando remoteKB vs totalKB). Las flags ahora solo aparecen para problemas reales: syncStateOrphans, tasasRecientes inflado, dismissedVersions sin limpiar, tagsLen acumulado. Si no hay nada, muestra "✓ ningún problema detectado".'},
        {type:'fix', title:'Recalc post-snapshot también detecta comisionPlataforma faltante', desc:'El check necesitaRecalc ahora samplea las primeras 10 ops (no 5) buscando ganancia, consumedLots O comisionPlataforma faltantes. Si cualquiera falta, dispara recalc. Esto garantiza que al recibir un snapshot stripeado (de v4.7.41+), todos los campos derivables se reconstruyen automáticamente antes de renderizar la UI.'},
        {type:'verified', title:'Veredicto basado en payload remoto', desc:'El estado (✓ Seguro / ⚠ Alto / 🛑 Crítico) ahora se calcula sobre remoteKB, no sobre totalKB. Esperado para tu cuenta: payload remoto baja de 905 KB → ~830 KB. Veredicto debería pasar de "⚠⚠ Muy alto" a "⚠ Alto". Tiempo de write esperado: ~14-15s (vs 17s actual).'},
        {type:'verified', title:'Cómo probar', desc:'1) Hard refresh. 2) Crear una op cualquiera. 3) Menú → Diagnóstico → 🔍 Auditar tamaño. 4) Buscar las líneas: "Payload REMOTO (real): ~830 KB" + "Estado LOCAL completo: ~1140 KB" + "Ahorrado por strip: ~310 KB". 5) Las flags NO deberían marcar lotes/saldoUsdt como problema. 6) En "TIMING DEL ÚLTIMO SAVE" payload enviado <850 KB. 7) Verificar que las ganancias y comisiones se ven correctamente en la lista de ops.'}
    ]},
    {version:'4.7.40', date:'2026-05-14', headline:'🔍 Auditoría de comisionPlataforma — solo diagnóstico, sin strip.', changes:[
        {type:'feature', title:'Auditoría financiera de comisionPlataforma', desc:'Nueva función auditarComisionPlataforma() que recorre TODAS las operaciones y compara comisionPlataforma guardada contra el valor canónico truncar(usdtBase × comisionPct/100, 2), donde usdtBase = roundMoney(monto/tasa,2) para compras y truncar(monto/tasa,2) para ventas. Esta es exactamente la fórmula que usa recalcularLotesYGanancias (línea 3611). Categoriza cada op en: exact (diff=0), tolerance (≤0.01), small (0.01-0.10), significant (>0.10), missing-pct (legacy sin comisionPct), missing-cp (sin comisionPlataforma), invalid (datos malformados).'},
        {type:'feature', title:'Verdict claro: SAFE-TO-STRIP / DO-NOT-STRIP', desc:'Después del análisis, la auditoría emite un verdict explícito: SAFE-TO-STRIP solo si TODAS las ops son exact o tolerance. DO-NOT-STRIP si hay alguna small/significant/missing-pct. La auditoría también lista las top 10 discrepancias con detalle completo (id, fecha, tipo, monto, tasa, usdt, comisionPct, cpGuardada, cpEsperada, diff) para inspección humana antes de decidir.'},
        {type:'feature', title:'Botón "💰 Auditar comisión" en panel diagnóstico', desc:'Nuevo botón cian al lado de "🔍 Auditar tamaño". Corre la auditoría en ~50-200ms (depende de N ops). El resultado queda cacheado en window._ultimaAuditoriaComision hasta el próximo análisis. El panel muestra: distribución por categoría, top 10 discrepancias, casos legacy, fórmula usada, verdict final con razón.'},
        {type:'verified', title:'comisionPlataforma NO fue stripeada', desc:'Esta versión es exclusivamente diagnóstico. La comisionPlataforma sigue persistiéndose en Firestore exactamente igual que antes. Decisión consciente: la comisión es un dato financiero clave para trazabilidad histórica. Solo evaluaremos stripearla si la auditoría confirma SAFE-TO-STRIP con cero discrepancias relevantes. Si hay aunque sea UNA op con diff >0.01, NO se toca.'},
        {type:'verified', title:'Cómo usar la auditoría', desc:'1) Hard refresh. 2) Menú → Diagnóstico de sincronización. 3) Tocar "💰 Auditar comisión". 4) Esperar 1-2 segundos. 5) Aparece sección "AUDITORÍA DE comisionPlataforma" con todo el detalle. 6) Tocar "📋 Copiar" y mandar el output. Si el verdict es SAFE-TO-STRIP, en una próxima versión podríamos stripear con confianza. Si es DO-NOT-STRIP, comisionPlataforma se queda en el payload.'}
    ]},
    {version:'4.7.39', date:'2026-05-14', headline:'⚡ Payload -20% — strip de consumedLots y ganancia (derivables vía FIFO).', changes:[
        {type:'perf', title:'Strip de consumedLots dentro de cada operación', desc:'Auditoría v4.7.37 reveló que consumedLots ocupaba 167 KB en 2229 de 3092 ops. Es 100% reconstruible: recalcularLotesYGanancias() asigna op.consumedLots=fifo.consumed cuando hace el replay FIFO de cada venta. Strip aplicado solo a la COPIA del payload — AppState.datos.operaciones[i].consumedLots sigue intacto para la UI y los cálculos locales. Ahorro estimado: ~120-140 KB.'},
        {type:'perf', title:'Strip de ganancia dentro de cada operación', desc:'Similar a consumedLots: la ganancia se calcula durante el replay FIFO (op.ganancia=roundMoney(fifo.ganancia)). Ocupaba ~49 KB. Reconstruible. Strip aplicado. Combinado con consumedLots: ~170 KB de ahorro total (-20%).'},
        {type:'fix', title:'Recalc post-snapshot detecta también ganancia/consumedLots faltantes', desc:'El check necesitaRecalc de v4.7.36 buscaba solo lotes/saldoUsdt ausentes. Si por algún edge case el doc tenía lotes pero faltaban ganancia o consumedLots, no se disparaba el recalc. Ahora muestrea las primeras 5 ventas: si alguna no tiene ganancia o consumedLots, recalcular. Sampling para no recorrer 3000+ ops por snapshot.'},
        {type:'feature', title:'Panel diagnóstico muestra el ahorro completo', desc:'Antes mostraba solo "Antes del strip → Después". Ahora desglosa: Baseline (todo sin tocar) → Ahorro per-op (consumedLots+ganancia) → Ahorro top-level (lotes+saldoUsdt) → Reducción TOTAL. Nuevos logs: payload:compact-start, payload:compact-end, snapshot:hydrate-derived.'},
        {type:'verified', title:'No destructivo', desc:'AppState.datos sigue conteniendo todos los campos enriquecidos. Solo la COPIA del payload (destructured con spread) excluye los derivables. La UI sigue mostrando ganancias y consumedLots normalmente. Al recibir snapshot de otro device, recalcularLotesYGanancias() reconstruye todo. Compatible con docs legacy que tengan estos campos embebidos.'},
        {type:'verified', title:'Cómo probar', desc:'1) Subir v4.7.39. 2) Crear una op cualquiera. 3) Abrir Diagnóstico → tocar 🔍 Auditar tamaño. 4) En "TIMING DEL ÚLTIMO SAVE" debería verse: Baseline ~1140 KB, Ahorro per-op ~170 KB, Ahorro top-level ~25 KB, Reducción TOTAL ~195 KB. Payload final ~950 KB o menos. 5) Verificar que las ganancias se ven correctamente en la lista de ops. 6) En el log: payload:compact-start → payload:compact-end → snapshot:hydrate-derived.'}
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
