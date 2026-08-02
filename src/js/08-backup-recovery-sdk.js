function esDatosVacios(d){
    if(!d||typeof d!=='object')return true;
    const ops=(d.operaciones||[]).length;
    const movs=(d.movimientos||[]).length;
    const trans=(d.transferencias||[]).length;
    const conv=(d.conversiones||[]).length;
    const lotes=(d.lotes||[]).length;
    const bancosCount=Object.keys(d.bancos||{}).length;
    const bancosActivos=Object.values(d.bancos||{}).filter(b=>b&&b.activo).length;
    /* Estado con contenido real */
    if(ops>0||movs>0||trans>0||conv>0||lotes>0||bancosActivos>0)return false;
    return true;
}
/* Comparar cuál estado tiene más contenido (para decidir si un backup supera al remoto vacío) */
/* v4.9.4 — Marker local de archivado: recuerda (fuera del doc) que este uid
   ya archivó y desde qué mes. Permite decisiones correctas de backup ANTES de
   que llegue el primer snapshot, y en dispositivos con estado viejo. */
function _puntajeDatos(d){
    if(!d)return -1;
    return (d.operaciones||[]).length*10
        + (d.movimientos||[]).length*5
        + (d.transferencias||[]).length*5
        + (d.conversiones||[]).length*5
        + (d.lotes||[]).length*3
        + Object.values(d.bancos||{}).filter(b=>b&&b.activo).length*2;
}

/* ─── localStorage safety net con rotación ─── */
function backupToLocal(){
    try{
        if(!AppState.datos||!AppState.currentUser)return;
        /* No respaldar estados vacíos — preservaría bug #1 */
        if(esDatosVacios(AppState.datos))return;
        const k='p2p_backup_'+AppState.currentUser.uid;
        /* Skip si ya respaldamos esta versión exacta — evita escritura duplicada
           cuando guardaOptimista (backup inmediato) y guardarDatos (backup en write)
           corren ambos en el mismo "ciclo" de mutación. */
        const curV=AppState.datos._version||0;
        const curLen=(AppState.datos.operaciones||[]).length+(AppState.datos.movimientos||[]).length+(AppState.datos.transferencias||[]).length;
        /* v4.8.2: la firma incluye _mutSeq — sin él, dos updates in-place seguidos
           (misma versión, mismo length, mismo dirty) compartían firma y el segundo
           NO se respaldaba hasta el próximo save confirmado. */
        const sig=curV+'|'+curLen+'|'+_localDirty+'|'+(typeof _mutSeq!=='undefined'?_mutSeq:0);
        if(backupToLocal._lastSig===sig)return;
        backupToLocal._lastSig=sig;
        const prevKey=k+'_prev';
        const prev=localStorage.getItem(k);
        /* Rotación: el actual pasa a ser previo antes de sobrescribir */
        if(prev)localStorage.setItem(prevKey,prev);
        localStorage.setItem(k,JSON.stringify({
            v:curV,
            ts:Date.now(),
            datos:AppState.datos
        }));
        backupToLocal._quotaWarned=false; /* reset flag al guardar exitoso */
    }catch(e){
        /* Detectar específicamente quota excedida — el browser tiene espacio limitado
           (típico 5MB en localStorage). Si el usuario tiene 10k+ ops, podría llegar.
           Estrategia: borrar el backup _prev (rotación) para liberar espacio y reintentar. */
        const isQuota=e&&(e.name==='QuotaExceededError'||e.code===22||e.code===1014||(e.message||'').toLowerCase().includes('quota'));
        if(isQuota){
            console.warn('[P2P] localStorage quota excedida — intentando liberar espacio');
            try{
                /* Liberar el backup previo (rotación) y reintentar */
                if(AppState.currentUser){
                    const k='p2p_backup_'+AppState.currentUser.uid;
                    localStorage.removeItem(k+'_prev');
                    localStorage.setItem(k,JSON.stringify({v:AppState.datos._version||0,ts:Date.now(),datos:AppState.datos}));
                    return;
                }
            }catch(e2){
                /* Aun fallando: avisar al usuario UNA vez por sesión, no en cada intento */
                if(!backupToLocal._quotaWarned){
                    backupToLocal._quotaWarned=true;
                    setSyncStatus('offline','Espacio local lleno — exportá tus datos');
                    console.error('[P2P] localStorage quota crítica — el backup local podría estar desactualizado');
                }
            }
        }else{
            console.warn('[P2P] backupToLocal failed:',e.message);
        }
    }
}
function restoreFromLocal(){
    try{
        if(!AppState.currentUser)return null;
        const k='p2p_backup_'+AppState.currentUser.uid;
        const raw=localStorage.getItem(k);
        if(!raw)return null;
        const b=JSON.parse(raw);
        /* Ya no expirar a las 24h — puede ser la única copia válida en caso de bug de sync.
           El backup se limpia solo cuando se confirmó un estado mayor o igual en Firebase. */
        return b;
    }catch(e){return null}
}
/* Clear backup solo cuando el estado actual es DEMOSTRABLEMENTE mayor o igual al backup.
   Nunca borrar si el estado actual está vacío o tiene menos puntaje. */
function updateSyncBadge(){
    const badge=$('syncBadge');if(!badge)return;
    const n=_syncPending+_syncErrors;
    badge.textContent=n>0?n:'';badge.style.display=n>0?'inline-block':'none';
}

async function guardarDatos(forzar,opts){
    if(!AppState.currentUser)return;
    /* Guard contra procesos que congelan la sincronización (archivado, migración,
       subida total): mientras corren, ningún write competidor. */
    const allowDuringRecovery=opts&&opts.allowDuringRecovery===true;
    if(AppState._recoveryActive&&!allowDuringRecovery){
        _syncLog&&_syncLog('save:blocked-by-recovery',{forzar:!!forzar});
        return;
    }

    /* ═══ Guard contra cliente Firestore terminado (v4.7.42) ═══
       Si en algún save anterior detectamos 'failed-precondition: client terminated',
       no intentamos más writes. Cada call fallaría instantáneamente con el mismo error
       y solo agregaría ruido al log + presión sobre el SDK ya inválido.
       Los datos están a salvo localmente; al recargar la app se reinicializa todo. */
    if(AppState._clientTerminated){
        console.warn('[P2P] guardarDatos abortado: Firebase client terminated. Recargá la app.');
        try{if(typeof mostrarBannerClienteTerminado==='function')mostrarBannerClienteTerminado()}catch(_){}
        return;
    }
    /* ═══ Guard contra recovery en progreso ═══
       Si iniciarRecuperacionFirestore está limpiando el SDK (terminate + clearPersistence),
       cualquier write nuevo sería sobre una instancia inválida → INTERNAL ASSERTION garantizado.
       El backup local ya tiene los datos, así que es seguro abortar — al recargar, 
       restoreFromLocal los recupera. */
    if(iniciarRecuperacionFirestore._activa){
        console.warn('[P2P] guardarDatos abortado: recovery en progreso');
        return;
    }
    /* BLINDAJE ANTI-WIPE: si estoy por pushear un estado vacío pero existe un backup local
       con contenido real, abortar y alertar. Esto evita que un snapshot corrupto + auto-save
       termine sobrescribiendo los datos reales del usuario en Firebase. */
    if(!forzar&&esDatosVacios(AppState.datos)){
        const backup=restoreFromLocal();
        if(backup&&backup.datos&&!esDatosVacios(backup.datos)){
            console.warn('[P2P] guardarDatos abortado: estado vacío con backup válido disponible. Usá "Restaurar respaldo".');
            setSyncStatus('offline','Datos protegidos');
            return;
        }
    }
    /* ═══ v5.0 — Modelo v2: escritura incremental ═══
       En vez de reescribir el documento entero, se traduce la cola de mutaciones
       a un batch con los documentos de los eventos tocados + el de estado. */
    if(AppState._schema===2&&window._v2sync){
        return window._v2sync.guardar(forzar);
    }
    /* ═══ v5.2.0 — No hay camino v1 ═══
       El modelo de documento único se retiró. Si el esquema no es 2, algo quedó
       a medias (documento sin migrar, o revertido desde otro dispositivo): no
       escribimos NADA, para no mezclar formatos ni pisar datos buenos. */
    console.error('[P2P] Documento en formato anterior: la escritura quedó bloqueada.');
    setSyncStatus('offline','Formato anterior — ver consola');
}

function cargarDatosUsuario(){
    if(!AppState.currentUser)return;
    /* ═══ Guard contra recovery en progreso ═══
       Si iniciarRecuperacionFirestore está corriendo (terminate + clearPersistence + reload),
       NO setear nuevo onSnapshot — la instancia vieja del SDK está siendo desmontada.
       Setear un listener acá causaría INTERNAL ASSERTION sobre la instancia ya terminada. */
    if(iniciarRecuperacionFirestore._activa)return;
    /* ═══ Idempotencia ═══
       Limpieza explícita del listener anterior antes de crear uno nuevo. Si hay un 
       cargarDatosUsuario en flight (raro pero posible en re-login rápido), evitamos
       dos onSnapshot apuntando al mismo doc — otro trigger del bug #6256. */
    /* v5.0 — Pista de esquema ANTES del primer snapshot: si este dispositivo ya
       operaba en v2, una escritura temprana debe tomar el camino correcto. El
       snapshot confirma (o corrige) el valor enseguida. */
    try{if(localStorage.getItem('p2p_schema_'+AppState.currentUser.uid)==="2")AppState._schema=2}catch(_){}
    try{if(window._v2sync)window._v2sync.detach()}catch(_){}
    if(AppState.unsubscribe){
        try{AppState.unsubscribe()}catch(e){console.warn('[P2P] unsubscribe error:',e.message)}
        AppState.unsubscribe=null;
    }
    AppState.unsubscribe=AppState.db.collection('users').doc(AppState.currentUser.uid)
    .onSnapshot({includeMetadataChanges:true},doc=>{
        /* Si recovery está en progreso, ignorar snapshots — la instancia se va a recargar */
        if(iniciarRecuperacionFirestore._activa)return;
        /* ═══ v4.7.64 — Freeze del listener durante recoveryWrite ═══
           CRÍTICO: durante recoveryWrite, snapshots entrantes pueden traer:
           (a) el doc legacy de 951 KB (estado pre-recovery) — rehidrataría memoria
               con el formato viejo y contaminaría el snapshot que vamos a escribir.
           (b) el doc comprimido que NUESTRO recovery write acaba de subir, pero
               antes de que recoveryWrite verifique el resultado — race que rompe
               el flujo de verificación.
           Mientras _recoveryActive: NO procesar snapshots. recoveryWrite hace su
           propio ref.get() controlado al final para verificar. Cuando recovery
           termina (success o fail), levantamos el flag y los snapshots vuelven. */
        if(AppState._recoveryActive){
            _syncLog&&_syncLog('snapshot:ignored-during-recovery',{
                fromCache:doc.metadata.fromCache,
                hasPending:doc.metadata.hasPendingWrites
            });
            return;
        }
        /* ═══ v5.0 — Delegación al modelo v2 (un documento por evento) ═══
           Si el documento de estado declara _schema:2, TODO el procesamiento pasa
           al módulo 16: este handler v1 (merge de arrays, versiones, recalc) no
           corre. Si alguna vez se revierte a v1, soltamos la escucha de eventos y
           seguimos por el camino de siempre sin tocar nada más. */
        if(doc.exists&&window._v2sync&&(doc.data()||{})._schema===2){
            try{return window._v2sync.onEstado(doc)}
            catch(e){console.error('[P2P][v2] snapshot de estado:',e);return}
        }
        if(AppState._schema===2&&doc.exists){
            console.warn('[P2P][v2] El documento volvió a formato v1 — retomando camino clásico');
            AppState._schema=1;
            try{if(window._v2sync)window._v2sync.detach()}catch(_){}
            try{localStorage.removeItem('p2p_schema_'+AppState.currentUser.uid)}catch(_){}
        }
        /* ═══ v5.2.0 — Camino único: modelo v2 ═══ */
        if(!doc.exists){
            /* Cuenta nueva: sembrar el documento de estado ya en formato v2 */
            if(AppState._localVersion===0&&esDatosVacios(AppState.datos)){
                AppState.datos=crearDatosVacios();
                AppState._schema=2;
                inicializarBancos();actualizarVista();ocultarLoading();
                setSyncStatus('online');
                if(window._v2sync)window._v2sync.guardar(true);
            }
            return;
        }
        const _d=doc.data()||{};
        const _desdeCache=doc.metadata.fromCache;
        /* v5.2.1 — Marcar el snapshot de servidor ANTES de cualquier salida: si no,
           el watchdog concluía "Sin conexión con Firestore" con la conexión sana,
           solo porque este camino retornaba antes de marcarlo. */
        if(!_desdeCache)AppState._snapshotServidorOk=true;
        if(_d._schema!==2){
            if(_desdeCache){
                /* ═══ v5.2.1 — Una caché vieja NO concluye nada ═══
                   Un dispositivo que no se abría desde antes de la migración tiene
                   guardado el documento en el formato anterior. Tomarlo como
                   verdad dejaba la app en "Formato anterior" con cero operaciones,
                   aunque en el servidor estuviera todo bien. Esperamos al servidor. */
                setSyncStatus('syncing','Conectando…');
                return;
            }
            /* ═══ v5.2.7 — Documento sin migrar: se migra solo ═══
               Confirmado por el servidor. Antes acá se bloqueaba la app con
               "Formato anterior", lo que dejaba fuera a cualquier persona cuya
               cuenta no hubiera sido migrada a mano — es decir, a todas menos una.
               Cargamos el estado v1 en memoria (para no perder nada si la
               migración se interrumpe) y lanzamos la migración automática, que
               conserva todas sus verificaciones. */
            console.warn('[P2P] Documento en formato anterior: migrando automáticamente.');
            setSyncStatus('syncing','Actualizando formato…');
            if(!cargarDatosUsuario._autoMigrando&&window.migracionAutomatica){
                cargarDatosUsuario._autoMigrando=true;
                AppState.datos={...crearDatosVacios(),...(_d||{})};
                if(Array.isArray(_d.lotesManuales))AppState.datos.lotes=_d.lotesManuales.map(l=>({...l}));
                delete AppState.datos.lotesManuales;
                AppState._localVersion=_d._version||0;
                try{recalcularLotesYGanancias()}catch(_){}
                setTimeout(()=>window.migracionAutomatica(),300);
            }
            ocultarLoading();
            return;
        }
        try{window._v2sync.onEstado(doc)}
        catch(e){console.error('[P2P][v2] snapshot de estado:',e)}
    },err=>{
        console.error('[P2P] Snapshot error:',err.code||err.message);
        setSyncStatus('offline');ocultarLoading();
    });
}

function showApp(u){
    AppState.currentUser=u;
    const uname=emailToUser(u.email);
    setText('menuUserName',uname);
    setText('menuUserEmail',u.email);
    $('menuUserAvatar').textContent=(uname[0]||'U').toUpperCase();
    $('authContainer').classList.add('hidden');
    $('appContainer').classList.add('active');
    /* ═══════════════════════════════════════════════════════════════════
       §UI-BOOTSTRAP v4.7.38 — Hidratar UI desde cache local INMEDIATAMENTE
       ═══════════════════════════════════════════════════════════════════
       Antes (v4.7.37 y anteriores): la UI esperaba el primer snapshot de Firestore
       para renderizar. Si el snapshot tardaba (red lenta, doc pesado, hasPending:true 
       skipea el render), el overlay "Cargando..." quedaba visible indefinidamente.
       
       Ahora: leemos el backup local (que YA contiene un estado válido del último
       cierre/sync exitoso), poblamos AppState.datos, renderizamos la UI completa,
       y ocultamos el overlay en <100ms. Después, onSnapshot trae las novedades del 
       servidor y la escucha de eventos las aplica encima — la UI se actualiza sola.
       
       Garantías:
       - Si NO hay backup local (primer login, cuenta nueva), se mantiene el flow
         original — cargarDatosUsuario espera el snapshot, watchdog cubre timeouts.
       - Si hay backup, AppState._localVersion queda con la versión del backup, así 
         la comparación de versiones funcione cuando llegue el snapshot.
       - El render desde cache marca AppState._uiHydratedFromCache=true para que el
         badge muestre "Modo local — sincronizando…" hasta que llegue el snapshot real. */
    _syncLog('ui:bootstrap-start',{uid:safeIdTail(u.uid,8)});
    let hidratoDesdeCache=false;
    try{
        const backup=restoreFromLocal();
        if(backup&&backup.datos&&!esDatosVacios(backup.datos)){
            /* Solo hidratamos si el backup tiene contenido real — nunca con un estado
               vacío (que sobrescribiría datos válidos si llegaran después por bug). */
            AppState.datos=backup.datos;
            AppState._localVersion=backup.v||0;
            AppState._restoredFrom='backup-bootstrap';
            AppState._uiHydratedFromCache=true;
            /* Render inmediato — la UI queda usable. */
            try{
                inicializarBancos();
                if(typeof recalcularLotesYGanancias==='function')recalcularLotesYGanancias();
                actualizarVista();
                actualizarFormulario();
                actualizarColorSelect();
                ocultarLoading();
                setSyncStatus('syncing','Modo local activo');
                hidratoDesdeCache=true;
                _syncLog('ui:cache-hydrated',{v:AppState._localVersion,ops:(AppState.datos.operaciones||[]).length});
                _syncLog('ui:render-ready',{from:'local-cache'});
                _syncLog('ui:overlay-hidden',{reason:'cache-hydrate'});
            }catch(e){
                console.warn('[P2P] Render desde cache falló (no crítico):',e.message);
                hidratoDesdeCache=false;
            }
        }
    }catch(e){
        console.warn('[P2P] Hidratación desde cache falló:',e.message);
    }
    /* ═══ Watchdog de 3 segundos ═══
       Si por cualquier motivo el overlay sigue visible después de 3 segundos
       (cache vacío Y snapshot no llegó), lo forzamos a ocultar. La app queda 
       usable sobre los datos vacíos por defecto — el snapshot, cuando llegue, 
       va a poblar todo correctamente. Sin esto, una red colgada congelaba la app. */
    setTimeout(()=>{
        const ov=$('loadingOverlay');
        if(ov&&!ov.classList.contains('hidden')){
            ov.classList.add('hidden');
            _syncLog('ui:forced-unlock',{reason:'watchdog-3s',cacheHydrated:hidratoDesdeCache});
            console.warn('[P2P] Watchdog desbloqueó la UI tras 3s — el sync continúa en background');
            /* Si no había cache, al menos mostramos vista por defecto */
            if(!hidratoDesdeCache){
                try{actualizarVista();actualizarFormulario();actualizarColorSelect()}catch(e){}
                setSyncStatus('syncing','Conectando…');
            }
        }
    },3000);
    /* Iniciar sync remota en background — la UI ya está usable */
    _syncLog('sync:background-mode',{cacheHydrated:hidratoDesdeCache});
    cargarDatosUsuario();
}
function showAuth(){AppState.currentUser=null;$('authContainer')?.classList.remove('hidden');$('appContainer')?.classList.remove('active');['loginBtn','registerBtn'].forEach(id=>{const b=$(id);if(b){b.disabled=false;b.textContent=id==='loginBtn'?'Iniciar Sesión':'Crear Cuenta'}});['loginUser','loginPass','regUser','regPass','regPassConfirm'].forEach(id=>{const e=$(id);if(e)e.value=''});ocultarLoading()}

/* ═══════════════════════════════════════════════════════════════════
   §ERR — Error boundary + telemetría local
   ═══════════════════════════════════════════════════════════════════
   Captura errores no manejados. Los guarda en localStorage (circular buffer de 50
   entradas) bajo 'p2p_errlog'. El usuario puede exportarlos con "Diagnóstico" en
   el menú Sistema para enviarlos si reporta un bug.
*/
const _ERRLOG_KEY='p2p_errlog';
const _ERRLOG_MAX=50;
function _readErrLog(){
    try{const raw=localStorage.getItem(_ERRLOG_KEY);return raw?JSON.parse(raw):[]}catch(e){return[]}
}
function _writeErrLog(arr){
    try{localStorage.setItem(_ERRLOG_KEY,JSON.stringify(arr.slice(-_ERRLOG_MAX)))}catch(e){}
}
function registrarError(tipo,detalle){
    try{
        const det=(detalle||'').toString();
        /* Filtro de ruido conocido — iOS Safari + Firestore IndexedDB:
           "Attempt to get records from database without an in-progress transaction"
           ocurre cuando la transacción IDB se cierra mid-operation por backgrounding.
           Es benigno (Firestore reintenta), pero ensuciaba el log y ocultaba errores reales. */
        if(det.includes('in-progress transaction'))return;
        /* Otro ruido: "The operation couldn't be completed" — típico de fetch abortado */
        if(det.includes("operation couldn't be completed")&&det.includes('aborted'))return;
        /* "Script error. @ :?" — error cross-origin sin detalle (el browser oculta el stack
           por CORS cuando viene de gstatic.com). En la práctica son los mismos errores del 
           SDK que ya filtramos abajo, pero con stack hidden. Sin info útil → descartar. */
        if(det.startsWith('Script error.'))return;
        /* "FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state" — bug conocido del SDK 
           Firestore (issue #6256, abierto desde 2022). Una vez que ocurre, el SDK queda en 
           estado inválido y todas las queries fallan hasta recargar la página.
           Lo registramos UNA vez por sesión y disparamos auto-recovery — sin spammear el log. */
        const isFirestoreInternal=det.includes('INTERNAL ASSERTION FAILED')||det.includes('INTERNAL UNHANDLED ERROR');
        if(isFirestoreInternal){
            if(registrarError._firestoreInternalSeen)return; /* skip duplicados */
            registrarError._firestoreInternalSeen=true;
            /* Disparar recovery con un pequeño delay para que el usuario alcance a ver el aviso */
            setTimeout(()=>iniciarRecuperacionFirestore(),1500);
            /* Continuar registrando el primer hit — útil para diagnóstico */
        }
        const log=_readErrLog();
        log.push({
            ts:new Date().toISOString(),
            tipo:tipo||'unknown',
            detalle:det.slice(0,800),
            user:AppState.currentUser?emailToUser(AppState.currentUser.email):null,
            version:CONFIG.APP_VERSION,
            ua:navigator.userAgent.slice(0,120),
            url:location.hash||''
        });
        _writeErrLog(log);
    }catch(e){/* no-op */}
}

/* ═══════════════════════════════════════════════════════════════════
   §FBR — Recuperación automática del SDK Firestore
   ═══════════════════════════════════════════════════════════════════
   El SDK Firestore tiene un bug conocido (issue #6256) donde IndexedDB
   queda en estado inconsistente y lanza "INTERNAL ASSERTION FAILED".
   Una vez que ocurre, el SDK no se recupera solo — necesita un reload.
   
   Estrategia:
   1. Mostrar aviso claro al usuario (pero no modal bloqueante)
   2. Forzar flush del backup local antes de cualquier acción
   3. Llamar clearIndexedDbPersistence() para limpiar el estado corrupto
   4. Recargar la página
   
   Como backupToLocal() corre antes del debounce, los datos están a salvo
   en localStorage. Al recargar, restoreFromLocal() los recupera. */
function iniciarRecuperacionFirestore(){
    if(iniciarRecuperacionFirestore._activa)return;
    iniciarRecuperacionFirestore._activa=true;
    /* ═══ Cancelar todo trabajo en flight ═══
       Cualquier retry timer, debounce timer o snapshot listener activo apuntando a la 
       instancia corrupta del SDK podría disparar más errores durante la recovery.
       Cortamos todo antes de tocar el SDK. */
    try{
        clearTimeout(_retryTimer);
        clearTimeout(_guardaDebounceTimer);
        _guardaDebounceTimer=null;
        _guardaFirstPendingTs=0;
        if(AppState.unsubscribe){
            try{AppState.unsubscribe()}catch(e){}
            AppState.unsubscribe=null;
        }
        /* Garantizar que cualquier mutación pendiente esté en localStorage antes de tocar Firebase */
        if(typeof backupToLocal==='function')backupToLocal();
    }catch(e){/* aún si falla, seguimos */}
    setSyncStatus('offline','Reiniciando conexión segura…');
    /* Aviso visible pero no bloqueante */
    try{
        const banner=document.createElement('div');
        banner.style.cssText='position:fixed;top:0;left:0;right:0;background:#fef3c7;color:#78350f;padding:14px 18px;font-size:0.88em;font-weight:600;text-align:center;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,0.15);line-height:1.4';
        banner.innerHTML='⚠️ Detectamos un problema con la base de datos local. Reiniciando en 3 segundos para evitar pérdida de datos…<br><span style="font-weight:400;font-size:0.85em;opacity:0.85">Tus datos están respaldados localmente.</span>';
        document.body.appendChild(banner);
    }catch(e){}
    /* ═══ Limpieza ordenada del SDK Firestore ═══
       Secuencia obligatoria según docs:
       1. terminate() — cierra todas las conexiones y libera resources
       2. clearPersistence() — borra IndexedDB del SDK (solo funciona post-terminate)
       3. reload() — fresh start
       
       Cualquier paso puede fallar (terminate timeout, clearPersistence con quota, etc).
       Si algo falla, igual recargamos — la página fresh re-inicializa todo correctamente. */
    setTimeout(()=>{
        /* v5.2.6 — El respaldo era window.location.href=window.location.href, que
           es una autoasignación: los navegadores actuales la ignoran y NO recargan.
           Como esto corre después de terminar el SDK y borrar su base local, quedarse
           sin recargar deja la app inutilizable hasta que el usuario la cierre a mano.
           location.replace(href) sí recarga, y además no ensucia el historial. */
        const reload=()=>{
            try{location.reload()}
            catch(e){
                try{window.location.replace(window.location.href)}
                catch(e2){console.error('[P2P] No se pudo recargar automáticamente:',e2)}
            }
        };
        const TERMINATE_TIMEOUT=4000;
        const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('terminate-timeout')),ms))]);
        try{
            const db=AppState.db||(firebase.firestore&&firebase.firestore());
            if(!db||typeof db.terminate!=='function'){reload();return}
            withTimeout(db.terminate(),TERMINATE_TIMEOUT)
                .then(()=>{
                    /* Después de terminate, db.clearPersistence existe pero la instancia ya
                       no se puede usar para queries — solo para clearPersistence. */
                    if(typeof db.clearPersistence==='function'){
                        return withTimeout(db.clearPersistence(),TERMINATE_TIMEOUT);
                    }
                })
                .then(reload)
                .catch(err=>{
                    console.warn('[P2P] Recovery cleanup falló (no crítico, recargando igual):',err&&err.message);
                    reload();
                });
        }catch(e){console.warn('[P2P] Recovery exception:',e.message);reload()}
    },3000);
}
function instalarErrorBoundary(){
    window.addEventListener('error',e=>{
        registrarError('window.error',
            (e.message||'?')+' @ '+(e.filename||'').split('/').pop()+':'+(e.lineno||'?')
        );
        /* No prevenir default — dejar que el navegador lo loguee también */
    });
    window.addEventListener('unhandledrejection',e=>{
        const reason=e.reason;
        const msg=reason?(reason.message||reason.code||JSON.stringify(reason).slice(0,300)):'(no reason)';
        registrarError('promise.rejection',msg);
    });
    /* Wrap console.error para capturar errores de sync y lógica no-throw */
    const origConsoleError=console.error.bind(console);
    console.error=(...args)=>{
        try{
            const msg=args.map(a=>{
                if(a instanceof Error)return a.message;
                if(typeof a==='object')return JSON.stringify(a).slice(0,200);
                return String(a);
            }).join(' ');
            /* Solo loguear si parece un error real (evitar ruido de debug) */
            if(msg.includes('[P2P]')||msg.includes('error')||msg.includes('Error')){
                registrarError('console.error',msg);
            }
        }catch(e){}
        origConsoleError(...args);
    };
}
/* Exportar log + snapshot de estado mínimo para diagnóstico */

