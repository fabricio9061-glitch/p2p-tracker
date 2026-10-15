/* ═══════════════════════════════════════
   §8 — FIREBASE & AUTH
   ═══════════════════════════════════════ */
function userToEmail(u){return u.toLowerCase().trim()+CONFIG.EMAIL_DOMAIN}
function emailToUser(e){return e.replace(CONFIG.EMAIL_DOMAIN,'')}

let _guardando=false,_guardarPendiente=false,_syncPending=0,_syncErrors=0,_retryTimer=null,_retryDelay=2000;

/* ─── Sync queue: tracks what's pending ─── */
const _syncQueue=[];/* [{type:'create'|'delete'|'update',entity:string,id:string,ts:number}] */
/* v4.8.2 — Contador monotónico de mutaciones. Lo usa backupToLocal en su firma de
   deduplicación: antes la firma era version|len|dirty, que NO cambia entre dos
   ediciones in-place consecutivas (misma versión, mismo length) → la segunda edición
   quedaba FUERA del backup local hasta el próximo save confirmado. Si el SO mataba
   la pestaña en esa ventana, esa edición se perdía pese a la promesa de "backup
   inmediato". Con _mutSeq, cada mutación fuerza un backup nuevo. */
let _mutSeq=0;
/* ═══ v7.3.0 — Sin tope en la cola ═══
   Había un tope de 500 que descartaba las entradas más viejas, con el argumento
   de que la cola solo servía para el punto amarillo. Desde el modelo v2 no es
   así: la cola es la lista de lo que hay que subir, y lo que se descartaba no
   llegaba nunca al servidor (pasaba con muchos cambios sin conexión o al
   fusionar una categoría muy usada). Una misma entrada repetida se guarda una
   sola vez: la escritura toma siempre el estado actual del registro. */
function enqueueSync(type,entity,id){
    _mutSeq++;
    const ultima=_syncQueue[_syncQueue.length-1];
    /* Nunca se fusiona con una entrada que ya está viajando: esa escritura
       lleva el estado de antes y este cambio tiene que salir en la próxima. */
    if(!(ultima&&!ultima.enVuelo&&ultima.type===type&&ultima.entity===entity&&String(ultima.id)===String(id)))
        _syncQueue.push({type,entity,id,ts:Date.now(),_t:performance.now()});
    guardarColaLocal();
    if(typeof _syncLog==='function')_syncLog('enqueue',{type,entity,id:safeIdTail(id,12),queueSize:_syncQueue.length});
    /* Marca la entidad como _syncState:'pending' — visible como dot sutil en la lista.
       'synced' es el default (no se setea para no inflar el doc en Firestore — la ausencia 
       del campo significa "todo OK"). */
    if(id&&entity){
        const arr=AppState.datos[entity];
        if(Array.isArray(arr)){
            const item=arr.find(x=>x.id===id);
            if(item)item._syncState='pending';
        }
    }
}
/* ═══ v8.0.1 — La cola de pendientes sobrevive a un reinicio ═══
   Vivía solo en memoria. Si la app se cerraba con cambios sin subir (el
   teléfono la cierra solo cuando queda en segundo plano), al abrirla otra vez
   la foto del servidor —que no los tenía— los borraba de la pantalla y del
   respaldo. Ahora la cola se guarda en el teléfono y al abrir se repone: lo
   pendiente se conserva y se sube. Cada vez que la cola cambia, se guarda. */
function _claveCola(){return AppState.currentUser?'p2p_cola_'+AppState.currentUser.uid:null}
function guardarColaLocal(){
    const k=_claveCola();if(!k)return;
    try{
        if(!_syncQueue.length){localStorage.removeItem(k);return}
        localStorage.setItem(k,JSON.stringify(_syncQueue.map(a=>({type:a.type,entity:a.entity,id:a.id,ts:a.ts}))));
    }catch(_){}
}
/* Vuelve a poner en la cola lo que quedó guardado. Devuelve cuántos. */
function reponerColaLocal(){
    const k=_claveCola();if(!k)return 0;
    let lista=[];
    try{lista=JSON.parse(localStorage.getItem(k)||'[]')||[]}catch(_){lista=[]}
    let n=0;
    (Array.isArray(lista)?lista:[]).forEach(a=>{
        if(!a||!a.type||!a.entity||a.id===undefined||a.id===null)return;
        if(_syncQueue.some(x=>x.type===a.type&&x.entity===a.entity&&String(x.id)===String(a.id)))return;
        _syncQueue.push({type:a.type,entity:a.entity,id:a.id,ts:a.ts||Date.now(),_t:performance.now()});
        n++;
    });
    return n;
}
/* Registros marcados como pendientes en el respaldo que no están en la cola
   (por si la cola guardada no llegó a escribirse): se vuelven a encolar. */
function rescatarPendientes(){
    if(!AppState.datos)return 0;
    let n=0;
    ['operaciones','movimientos','transferencias','conversiones','ajustesSaldo'].forEach(e=>{
        (AppState.datos[e]||[]).forEach(r=>{
            if(!r||r._syncState!=='pending')return;
            if(_syncQueue.some(a=>a.entity===e&&String(a.id)===String(r.id)))return;
            _syncQueue.push({type:'update',entity:e,id:r.id,ts:Date.now(),_t:performance.now()});
            n++;
        });
    });
    if(n)guardarColaLocal();
    return n;
}
/* v4.8.2: clearSyncQueue() eliminada — código muerto verificado (0 referencias en
   JS/HTML; solo aparecía citada en un comentario histórico). Su rol lo cumplen el
   mecanismo de confirmedIds en guardarDatos + repairOrphanPendingStates. */

/* ═══════════════════════════════════════════════════════════════════
   §SANEAMIENTO — Limpieza de _syncState huérfanos
   ═══════════════════════════════════════════════════════════════════
   Un item puede quedar con _syncState:'pending' "huérfano" si:
   - Una transacción falla y se reintenta varias veces — entries quedan duplicados
   - Un crash de la app deja el flag pero el item ya fue confirmado en otro device
   - Bug viejo donde clearSyncQueue solo corría con _syncPending===0
   - Restore manual donde el flag se conservó del backup
   
   Reglas para decidir si un pending es "huérfano":
   1. No hay entry en _syncQueue para ese id
   2. _localVersion === AppState.datos._version (sincronizados con server)
   3. !_guardando && !_guardarPendiente (nada en flight ni encolado)
   
   Si TODAS las condiciones se cumplen, NO HAY RAZÓN para tener _syncState='pending'.
   El item ya está confirmado, el flag es solo "deuda visual" de un ciclo viejo.
   
   Esta función se llama:
   - Después de cada save:queue-drained (sync exitoso completo)
   - Después de cada snapshot:received con serverVersion === localVersion
   - Al abrir el panel de diagnóstico (limpia antes de mostrar números) */
function repairOrphanPendingStates(){
    /* Salvavidas: si CUALQUIER condición de "no es seguro limpiar" se cumple, abortamos.
       Mejor dejar dots amarillos transitorios que limpiar pending real → datos perdidos. */
    if(_guardando||_guardarPendiente)return 0;
    if(AppState._datosStale)return 0;
    const dataVersion=(AppState.datos&&AppState.datos._version)||0;
    if(AppState._localVersion!==dataVersion)return 0;
    /* IDs que SÍ tienen razón legítima para estar pending: están en _syncQueue */
    const pendingIds=new Set();
    _syncQueue.forEach(a=>{if(a.id!==null&&a.id!==undefined)pendingIds.add(String(a.id))});
    let cleaned=0;
    /* v6.9.0 — ajustesSaldo faltaba: sus marcas de "pendiente" no se limpiaban
       nunca y quedaban visibles para siempre. */
    ['operaciones','movimientos','transferencias','conversiones','ajustesSaldo','lotes'].forEach(key=>{
        const arr=AppState.datos[key];if(!Array.isArray(arr))return;
        arr.forEach(item=>{
            if(item&&item._syncState==='pending'&&!pendingIds.has(String(item.id))){
                delete item._syncState;
                cleaned++;
            }
        });
    });
    if(cleaned>0){
        if(typeof _syncLog==='function')_syncLog('repair:orphans-cleaned',{count:cleaned});
        if(typeof actualizarVistaDebounced==='function')actualizarVistaDebounced();
    }
    return cleaned;
}

/* ═══════════════════════════════════════════════════════════════════
   §STATE-RECOVERY — "Error al reconectar" no debe quedar pegado
   ═══════════════════════════════════════════════════════════════════
   Si el listener está activo, la versión local matchea con la del documento,
   no hay nada en _syncQueue y el SDK no reporta recovery:
   el sistema YA está reconectado. Cualquier _syncErrors residual es ruido.
   Esta función verifica el estado real y baja el badge si corresponde. */
function reevaluarEstadoSync(){
    if(!AppState.currentUser)return;
    if(typeof iniciarRecuperacionFirestore!=='undefined'&&iniciarRecuperacionFirestore._activa)return;
    /* Síntomas de que en realidad estamos OK aunque el badge diga error */
    const listenerActivo=AppState.unsubscribe!==null&&AppState.unsubscribe!==undefined;
    const versionesMatch=AppState._localVersion===((AppState.datos&&AppState.datos._version)||0);
    const sinPending=_syncQueue.length===0;
    const sinFlight=!_guardando&&!_guardarPendiente;
    const online=navigator.onLine;
    if(listenerActivo&&versionesMatch&&sinPending&&sinFlight&&online&&_syncErrors>0){
        if(typeof _syncLog==='function')_syncLog('reconnect:auto-clear-errors',{prevErrors:_syncErrors});
        _syncErrors=0;
        _retryDelay=2000;
        clearTimeout(_retryTimer);_retryTimer=null;
        if(typeof setSyncStatus==='function')setSyncStatus('online');
        if(typeof updateSyncBadge==='function')updateSyncBadge();
    }
}

/* ═══════════════════════════════════════════════════════════════════
   §SYNCLOG — Logger estructurado del flujo de sincronización
   ═══════════════════════════════════════════════════════════════════
   Registra eventos clave del flujo para diagnóstico. Cap circular de 100.
   Eventos típicos: enqueue, save:start, save:confirmed, save:queue-drained,
   save:error, snapshot:received, snapshot:merge, snapshot:skip-echo,
   tx-timeout, retry-scheduled, offline-deferred, recovery-start.
   El panel de diagnóstico (Config → Herramientas) lee de acá. */
const _SYNC_LOG_MAX=100;
const _syncLogRing=[];
function _syncLog(event,payload){
    try{
        _syncLogRing.push({ts:Date.now(),event,...(payload||{})});
        if(_syncLogRing.length>_SYNC_LOG_MAX)_syncLogRing.shift();
        /* Solo loguear a console si está habilitado el debug verbose */
        if(window._P2P_VERBOSE)console.log('[P2P sync]',event,payload||'');
    }catch(e){/* no-op */}
}

/* Debounce: agrupa cambios rápidos (typing, sliders) en una sola escritura a Firebase.
   Window de 400ms — si la última mutación fue hace <400ms, espera.
   Si se superan 2000ms acumulados, flushea igual (safety net contra keyboards lentos). */
let _guardaDebounceTimer=null,_guardaFirstPendingTs=0;
function guardaOptimista(type,entity,id){
    if(type&&entity&&id)enqueueSync(type,entity,id);
    /* ═══ Persistencia local INMEDIATA ═══
       Antes de cualquier debounce o write remoto, guardamos un snapshot a localStorage.
       Esto cierra la ventana donde el cambio vive solo en RAM y se podría perder si:
         • iOS/Android matan la pestaña por presión de memoria sin disparar eventos
         • El navegador crashea
         • El usuario cierra antes que beforeunload/pagehide se disparen
       
       Costo: ~5-15ms en Android low-end por la escritura síncrona a localStorage.
       Beneficio: cero pérdida de datos en escenarios de cierre abrupto.
       
       Adicionalmente, backupToLocal valida que el estado no esté vacío antes de
       guardar (esDatosVacios), evitando sobrescribir un backup bueno con uno malo. */
    try{backupToLocal()}catch(e){console.warn('[P2P] backup inmediato falló:',e.message)}
    const now=Date.now();
    if(!_guardaFirstPendingTs)_guardaFirstPendingTs=now;
    clearTimeout(_guardaDebounceTimer);
    /* ═══ Debounce inteligente — dispara antes para mutaciones críticas ═══
       Triple safety net + tipo de mutación:
       1. Flush por TIPO crítico: create/delete → 100ms (apenas lo justo para batchear 
          mutaciones en cascada, ej. crear op + actualizar lote + sync)
       2. Flush por TIEMPO acumulado: >2s desde el primer pending
       3. Flush por CANTIDAD acumulada: >=10 entries en la cola
       4. Debounce normal: 400ms para updates (typing, sliders)
       
       Antes era 400ms uniforme, lo que hacía sentir "lenta" la app al crear/eliminar.
       (v4.7.32: critical-fast path con 100ms para create/delete). */
    const elapsed=now-_guardaFirstPendingTs;
    const queueLen=_syncQueue.length;
    const isCritical=type==='create'||type==='delete';
    let delay=400;
    if(elapsed>=2000)delay=0;
    else if(queueLen>=10)delay=0;
    else if(isCritical)delay=100;
    _guardaDebounceTimer=setTimeout(()=>{
        _guardaDebounceTimer=null;
        _guardaFirstPendingTs=0;
        guardarDatos().catch(e=>console.error('[P2P] Sync error:',e));
    },delay);
}
/* Flush inmediato — usar antes de cerrar sesión / visibilitychange / beforeunload */
function flushGuardaDebounce(){
    if(_guardaDebounceTimer){
        clearTimeout(_guardaDebounceTimer);
        _guardaDebounceTimer=null;
        _guardaFirstPendingTs=0;
        return guardarDatos().catch(e=>console.error('[P2P] Sync error:',e));
    }
    return Promise.resolve();
}

/* ─── Merge: NEVER drops local-only entities ─── */