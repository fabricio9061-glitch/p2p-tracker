/* ═══════════════════════════════════════
   §9 — ARRANQUE DE FIREBASE
   ═══════════════════════════════════════
   Las operaciones se guardan con guardarOperacion (17-registros.js) y su
   formulario está en 21-ui-cargar.js. */
function inicializarFirebase(){
    if(typeof firebase==='undefined'){ocultarLoading();return}
    try{
        firebase.initializeApp(CONFIG.firebase);AppState.auth=firebase.auth();AppState.db=firebase.firestore();
        /* v4.9.3 — Redes/proxies que rompen el WebChannel de Firestore dejan al
           SDK colgado (writes que nunca resuelven, snapshot que nunca llega,
           "Modo local activo" eterno). Con auto-detección, el SDK degrada solo
           a long-polling. Debe llamarse ANTES de cualquier otra operación. */
        try{AppState.db.settings({experimentalAutoDetectLongPolling:true,merge:true})}
        catch(e){console.warn('[P2P] settings long-polling:',e&&e.message||e)}
        /* ═══ Persistence init serializado ═══
           Bug conocido del SDK Firestore (issue #6256, "INTERNAL ASSERTION FAILED: Unexpected
           state"): si onSnapshot se dispara antes que enablePersistence resuelva, Firestore 
           queda en estado inconsistente. Especialmente común en Samsung Browser/Android.
           
           Antes: enablePersistence().catch(...) sin await → race condition con cargarDatosUsuario.
           Ahora: gateamos toda la inicialización de auth detrás de enablePersistence. 
           Si falla unimplemented (browsers viejos), seguimos igual sin persistence. */
        const initAuth=()=>{
            inicializarConectividad();
            AppState.auth.onAuthStateChanged(u=>u?showApp(u):showAuth());
        };
        AppState.db.enablePersistence({synchronizeTabs:true}).then(()=>{
            AppState._persistenceReady=true;
            initAuth();
        }).catch(e=>{
            /* unimplemented = browser viejo (sin IndexedDB). Seguimos sin persistence. */
            if(e.code==='unimplemented')console.warn('[P2P] Persistence no soportada en este navegador');
            /* failed-precondition = ya hay otra tab con persistence. Sigue funcionando, solo single-tab. */
            else if(e.code==='failed-precondition')console.warn('[P2P] Persistence single-tab (otra pestaña abierta)');
            else console.warn('[P2P] enablePersistence error:',e.code||e.message);
            AppState._persistenceReady=true;
            initAuth();
        });
    }catch(e){console.error('[P2P] Firebase init error:',e);setSyncStatus('offline','No se pudo conectar');ocultarLoading()}
}
