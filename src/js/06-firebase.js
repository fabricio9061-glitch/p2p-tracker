/* ═══════════════════════════════════════════════════════════════════
   06-firebase.js
   Generated piece — concatenated into dist/index.html by build/build.js
   Source of truth: src/js/06-firebase.js
   Do NOT edit dist/index.html directly. Edit the source and re-run build.
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════
   §8 — FIREBASE & AUTH
   ═══════════════════════════════════════ */
function userToEmail(u){return u.toLowerCase().trim()+CONFIG.EMAIL_DOMAIN}
function emailToUser(e){return e.replace(CONFIG.EMAIL_DOMAIN,'')}

let _guardando=false,_guardarPendiente=false,_syncPending=0,_syncErrors=0,_retryTimer=null,_retryDelay=2000,_localDirty=0;

/* ─── Sync queue: tracks what's pending ─── */
const _syncQueue=[];/* [{type:'create'|'delete'|'update',entity:string,id:string,ts:number}] */
const _SYNC_QUEUE_MAX=500;/* Cap defensivo: en escenarios offline largos, la queue 
   podría crecer sin tope. 500 es 10x más de lo que un usuario real genera 
   en una sesión típica — suficiente como red de seguridad sin perder casos reales. */
function enqueueSync(type,entity,id){
    _syncQueue.push({type,entity,id,ts:Date.now()});
    /* Si excede el cap, descartar el más viejo (FIFO) — los entries antiguos solo
       sirven para tracking visual del dot pulsante; el sync real de datos NO depende
       del syncQueue (depende de _localDirty + _version). */
    if(_syncQueue.length>_SYNC_QUEUE_MAX){
        _syncQueue.splice(0,_syncQueue.length-_SYNC_QUEUE_MAX);
    }
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
function clearSyncQueue(){
    /* Al confirmar sync exitoso, limpiar todos los _syncState:'pending' */
    _syncQueue.forEach(a=>{
        const arr=AppState.datos[a.entity];
        if(Array.isArray(arr)){
            const item=arr.find(x=>x.id===a.id);
            if(item&&item._syncState==='pending')delete item._syncState;
        }
    });
    _syncQueue.length=0;
    _localDirty=0;
}
function hasPendingLocal(){return _syncQueue.length>0||_localDirty>0||_guardando||_guardarPendiente}
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
    /* Invalidar fingerprints de listas → próximo actualizarVista re-renderiza las listas
       aunque no cambie array.length (ej. editar monto de una transferencia) */
    if(typeof _invalidateListCache==='function')_invalidateListCache();
    const now=Date.now();
    if(!_guardaFirstPendingTs)_guardaFirstPendingTs=now;
    clearTimeout(_guardaDebounceTimer);
    /* Triple safety net para forzar flush:
       1. Flush por TIEMPO acumulado: >2s desde el primer pending
       2. Flush por CANTIDAD acumulada: >=10 entries en la cola
       3. Debounce normal: 400ms
       
       (1) protege keyboards lentos / mutaciones espaciadas
       (2) protege bursts (importaciones, entrada rápida) — sin esto, 50 ops creadas
           en 1.5s esperarían el flush por tiempo y un crash perdería el batch en remoto
       (3) optimiza el caso normal de mutación única */
    const elapsed=now-_guardaFirstPendingTs;
    const queueLen=_syncQueue.length;
    let delay=400;
    if(elapsed>=2000)delay=0;
    else if(queueLen>=10)delay=0;
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
function mergeRemoteState(d){
    const delIds=new Set(_syncQueue.filter(a=>a.type==='delete').map(a=>a.id));
    /* ═══ Snapshot pre-merge para detectar cambios reales en arrays ═══
       Si después del merge los arrays terminan con los mismos ids/timestamps que antes,
       saltamos recalcularLotesYGanancias (que es el cuello de botella ~400ms en iOS
       con 2k+ ops). Hash basado en id + timestamps + campos críticos para FIFO. */
    const _hashArr=arr=>{
        if(!Array.isArray(arr))return '0';
        let h=arr.length+'|';
        for(let i=0;i<arr.length;i++){
            const x=arr[i];if(!x||!x.id)continue;
            /* Hash incluye:
                 - id: identidad del registro
                 - timestamp: orden cronológico (no cambia en ediciones)
                 - updatedAt: marca cuando se editó (cambia en ediciones de op/mov/etc)
                 - monto, tasa, tipo: campos que afectan FIFO/ganancia
                 - aportes (split): cantidad de aportes afecta inventario
               
               Sin estos campos críticos, una edición de monto en otro device pasaba 
               desapercibida → hash igual → skip recalc → ganancia desactualizada.
               (Bug detectado en auditoría v4.7.31 — el hash de v4.7.28 era insuficiente). */
            h+=x.id+
               (x.timestamp||x.fecha||'')+'|'+
               (x.updatedAt||'')+'|'+
               (x.monto||0)+'|'+
               (x.tasa||0)+'|'+
               (x.tipo||x.tipoMovimiento||'')+'|'+
               (Array.isArray(x.aportes)?x.aportes.length:0)+'|';
        }
        return h;
    };
    const preHash={
        operaciones:_hashArr(AppState.datos.operaciones),
        movimientos:_hashArr(AppState.datos.movimientos),
        transferencias:_hashArr(AppState.datos.transferencias),
        conversiones:_hashArr(AppState.datos.conversiones),
        lotesManualLen:(AppState.datos.lotes||[]).filter(l=>l.manual).length
    };
    ['operaciones','movimientos','transferencias','conversiones'].forEach(key=>{
        const local=AppState.datos[key]||[];
        const remote=d[key]||[];
        const remoteIds=new Set(remote.map(e=>e.id));
        /* Local items not in remote → pending creates/edits → KEEP */
        const localOnly=local.filter(e=>e.id&&!remoteIds.has(e.id));
        /* Remote items not deleted locally → ACCEPT */
        const remoteClean=remote.filter(e=>!delIds.has(e.id));
        AppState.datos[key]=[...localOnly,...remoteClean];
    });
    /* Bancos: per-bank merge — preserve local saldos (reflect pending ops), accept remote structure/activo */
    const remoteBancos=d.bancos||{};
    const localBancos=AppState.datos.bancos||{};
    const hasPendingBankChanges=_syncQueue.some(a=>a.entity==='bancos');
    if(!Object.keys(localBancos).length){
        /* Local bancos empty → accept remote entirely */
        AppState.datos.bancos=remoteBancos;
    }else{
        /* Per-bank merge */
        Object.keys(remoteBancos).forEach(name=>{
            const rb=remoteBancos[name];
            const lb=localBancos[name];
            if(!lb){
                /* Bank exists in remote but not local → accept */
                localBancos[name]=rb;
            }else if(!hasPendingBankChanges){
                /* No pending bank changes → accept remote state but keep local saldo if we have pending ops */
                const hasPendingOps=_syncQueue.some(a=>a.entity==='operaciones'||a.entity==='movimientos'||a.entity==='transferencias'||a.entity==='conversiones');
                if(hasPendingOps){
                    /* Keep local saldo (reflects pending ops), accept remote config */
                    lb.activo=rb.activo;
                    lb.limiteDiarioUSD=rb.limiteDiarioUSD!==undefined?rb.limiteDiarioUSD:lb.limiteDiarioUSD;
                }else{
                    /* No pending anything → accept remote fully */
                    localBancos[name]=rb;
                }
            }
            /* If hasPendingBankChanges → keep local entirely (pending saldo/activo edit) */
        });
    }
    /* Scalars: accept remote config */
    AppState.datos.tags=d.tags||AppState.datos.tags;
    AppState.datos.tasasRecientes=d.tasasRecientes||AppState.datos.tasasRecientes;
    AppState.datos.comisionPlataforma=d.comisionPlataforma!==undefined?d.comisionPlataforma:AppState.datos.comisionPlataforma;
    AppState.datos.comisionUSD=d.comisionUSD!==undefined?d.comisionUSD:AppState.datos.comisionUSD;
    AppState.datos.ultimoMesProcesado=d.ultimoMesProcesado&&d.ultimoMesProcesado>(AppState.datos.ultimoMesProcesado||'')?d.ultimoMesProcesado:(AppState.datos.ultimoMesProcesado||d.ultimoMesProcesado||'');
    /* lastSeenVersion: aceptar el más alto entre local y remoto (multi-device sync) */
    const remoteSeen=d.lastSeenVersion||'';
    const localSeen=AppState.datos.lastSeenVersion||'';
    if(cmpVersion(remoteSeen,localSeen)>0)AppState.datos.lastSeenVersion=remoteSeen;
    /* dismissedVersions: union de ambos lados — un descarte en cualquier device se respeta.
       Además, filtrado a versiones que sigan en el CHANGELOG actual (garbage collection). */
    const remoteDism=Array.isArray(d.dismissedVersions)?d.dismissedVersions:[];
    const localDism=Array.isArray(AppState.datos.dismissedVersions)?AppState.datos.dismissedVersions:[];
    const union=Array.from(new Set([...localDism,...remoteDism]));
    const versionesActuales=new Set(CHANGELOG.slice(0,CHANGELOG_MAX_ENTRIES).map(e=>e.version));
    AppState.datos.dismissedVersions=union.filter(v=>versionesActuales.has(v));
    AppState.datos._version=d._version||AppState.datos._version;

    /* ═══ Skip o defer recalcularLotesYGanancias ═══
       Detectar si los arrays que afectan FIFO realmente cambiaron.
       Si el snapshot solo trajo cambios en tags / lastSeenVersion / dismissedVersions, 
       no hay nada que recalcular. Skip ahorra ~300-500ms en iOS con 2k+ ops. */
    const postHash={
        operaciones:_hashArr(AppState.datos.operaciones),
        movimientos:_hashArr(AppState.datos.movimientos),
        transferencias:_hashArr(AppState.datos.transferencias),
        conversiones:_hashArr(AppState.datos.conversiones),
        lotesManualLen:(AppState.datos.lotes||[]).filter(l=>l.manual).length
    };
    const arraysChanged=preHash.operaciones!==postHash.operaciones||
                        preHash.movimientos!==postHash.movimientos||
                        preHash.transferencias!==postHash.transferencias||
                        preHash.conversiones!==postHash.conversiones||
                        preHash.lotesManualLen!==postHash.lotesManualLen;
    if(arraysChanged){
        /* Defer recalcular con requestIdleCallback en este path (snapshot remoto).
           El usuario no está esperando este cómputo — la app está reaccionando a 
           cambios externos. Mientras espera el idle, la UI sigue respondiendo.
           Fallback a setTimeout(0) para Safari (no soporta requestIdleCallback). */
        const runRecalc=()=>{
            recalcularLotesYGanancias();
            /* Re-render después del recalc para reflejar ganancias actualizadas */
            if(typeof actualizarVistaDebounced==='function')actualizarVistaDebounced();
        };
        if(typeof requestIdleCallback==='function'){
            requestIdleCallback(runRecalc,{timeout:1500});
        }else{
            setTimeout(runRecalc,0);
        }
    }else{
        /* Solo invalidar cachés livianos — no requiere FIFO */
        if(typeof invalidarGananciaCache==='function')invalidarGananciaCache();
        if(typeof _invalidateListCache==='function')_invalidateListCache();
    }
}

/* ═══════════════════════════════════════════════════════════════════
   §BKP — Integridad de datos + red de seguridad
   ═══════════════════════════════════════════════════════════════════ */
/* Heurística: detectar documento/estado vacío o triviamente inicializado.
   Un estado "real" tiene al menos ops, movs, transfers, conversiones o bancos configurados. */
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
        const sig=curV+'|'+curLen+'|'+_localDirty;
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
function restoreFromLocalPrev(){
    try{
        if(!AppState.currentUser)return null;
        const k='p2p_backup_'+AppState.currentUser.uid+'_prev';
        const raw=localStorage.getItem(k);
        if(!raw)return null;
        return JSON.parse(raw);
    }catch(e){return null}
}
/* Clear backup solo cuando el estado actual es DEMOSTRABLEMENTE mayor o igual al backup.
   Nunca borrar si el estado actual está vacío o tiene menos puntaje. */
function clearLocalBackup(){
    try{
        if(!AppState.currentUser)return;
        const b=restoreFromLocal();
        if(b&&b.datos){
            const currentScore=_puntajeDatos(AppState.datos);
            const backupScore=_puntajeDatos(b.datos);
            /* Si el backup tiene MÁS contenido que el actual → NO borrar.
               Esto protege contra escenarios donde el snapshot remoto llegó vacío
               y nosotros estamos por guardar vacío también. */
            if(backupScore>currentScore){
                console.warn('[P2P] clearLocalBackup skipped: backup has more data than current state');
                return;
            }
        }
        localStorage.removeItem('p2p_backup_'+AppState.currentUser.uid);
        /* Invalidar firma para que el próximo backupToLocal cree uno nuevo si hace falta */
        backupToLocal._lastSig=null;
    }catch(e){}
}

function updateSyncBadge(){
    const badge=$('syncBadge');if(!badge)return;
    const n=_syncPending+_syncErrors;
    badge.textContent=n>0?n:'';badge.style.display=n>0?'inline-block':'none';
}

async function guardarDatos(forzar){
    if(!AppState.currentUser)return;
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
    _localDirty++;
    if(AppState._datosStale&&!forzar){
        setSyncStatus('syncing','Sincronizando...');return;
    }
    if(_guardando){_guardarPendiente=true;return}
    _guardando=true;_syncPending++;updateSyncBadge();
    /* ═══ Indicador "Sincronizando" diferido ═══
       En vez de mostrar el badge inmediatamente (genera ansiedad y hace que la app
       parezca lenta aunque la sync sea instantánea), esperamos 800ms.
       Si la operación termina antes, el usuario nunca ve el indicador.
       Solo aparece cuando realmente la red está demorada. */
    const _syncIndicatorTimer=setTimeout(()=>{
        if(_guardando){
            setSyncStatus('syncing',_syncPending>1?'Sincronizando '+_syncPending+'…':'Sincronizando…');
        }
    },800);
    /* Backup solo si hay cambios reales pendientes — evita writes inútiles a localStorage 
       en cada save (bloqueo síncrono en Android de gama baja). */
    if(_syncQueue.length>0||forzar)backupToLocal();
    const ref=AppState.db.collection('users').doc(AppState.currentUser.uid);
    try{
        if(!navigator.onLine){
            /* OFFLINE: no escribir a Firebase con un _version bumped — esto evita
               race conditions con otros devices. Solo marcamos que hay pending local y
               esperamos al evento 'online' para disparar un guardaOptimista real.
               El backup local ya está hecho arriba, así que los datos están a salvo. */
            setSyncStatus('offline','Sin conexión');
            _syncPending=Math.max(0,_syncPending-1);
            updateSyncBadge();
            throw{code:'offline-deferred'};
        }
        /* Timeout safety net: si la transacción no responde en 30s, asumimos red rota
           y la abortamos con código tratable. Sin esto, _guardando=true podía quedar
           eterno y bloquear todos los saves siguientes. El backup local ya está hecho,
           así que es seguro fallar y reintentar via retry timer. */
        const TX_TIMEOUT=30000;
        const txPromise=AppState.db.runTransaction(async tx=>{
            const doc=await tx.get(ref);
            const serverVersion=doc.exists?(doc.data()._version||0):0;
            if(serverVersion>AppState._localVersion){
                throw{code:'stale-version',serverV:serverVersion,localV:AppState._localVersion};
            }
            const newVersion=serverVersion+1;
            /* Strip de campos runtime-only que NO deben persistirse en Firestore.
               _syncState es un hint local para mostrar el dot pulsante en la UI.
               Si se persistiera, otros devices verían "pending" eterno y el doc 
               crecería sin razón. */
            const stripRuntime=arr=>Array.isArray(arr)?arr.map(x=>{
                if(!x._syncState)return x;
                const{_syncState,...rest}=x;
                return rest;
            }):arr;
            const datosLimpios={
                ...AppState.datos,
                operaciones:stripRuntime(AppState.datos.operaciones),
                movimientos:stripRuntime(AppState.datos.movimientos),
                transferencias:stripRuntime(AppState.datos.transferencias),
                conversiones:stripRuntime(AppState.datos.conversiones||[])
            };
            tx.set(ref,{
                ...datosLimpios,
                _version:newVersion,
                ultimaActualizacion:firebase.firestore.FieldValue.serverTimestamp()
            });
            AppState._localVersion=newVersion;
            AppState.datos._version=newVersion;
        });
        const timeoutPromise=new Promise((_,reject)=>setTimeout(()=>reject({code:'tx-timeout'}),TX_TIMEOUT));
        await Promise.race([txPromise,timeoutPromise]);
        _syncPending=Math.max(0,_syncPending-1);_syncErrors=0;_retryDelay=2000;
        clearTimeout(_retryTimer);
        if(_syncPending===0&&!_guardarPendiente){clearSyncQueue();setSyncStatus('online');clearLocalBackup()}
        else setSyncStatus('syncing',_syncPending+' pendiente'+((_syncPending>1)?'s':''));
        updateSyncBadge();
    }catch(e){
        if(e.code==='offline-deferred'){
            /* Ya manejado arriba: no incrementar errores, no retry inmediato */
        }else if(e.code==='tx-timeout'){
            /* Timeout de seguridad: la transacción no respondió en 30s.
               El backup local ya está hecho — los datos están a salvo.
               Tratamos como error de red y dejamos que el retry timer reintente. */
            _syncPending=Math.max(0,_syncPending-1);
            _syncErrors++;updateSyncBadge();
            setSyncStatus('offline','Tiempo de espera agotado — reintentando…');
            console.warn('[P2P] Transacción excedió timeout de 30s, reintentando');
            clearTimeout(_retryTimer);
            _retryTimer=setTimeout(()=>{_syncErrors=0;updateSyncBadge();guardarDatos()},Math.min(_retryDelay,30000));
            _retryDelay=Math.min(_retryDelay*1.5,30000);
        }else{
            _syncPending=Math.max(0,_syncPending-1);
            if(e.code==='stale-version'){
                AppState._datosStale=true;
                setSyncStatus('syncing','Reconciliando…');
            }else{
                _syncErrors++;updateSyncBadge();
                setSyncStatus('offline',_syncErrors>0?_syncErrors+' error'+((_syncErrors>1)?'es':''):'Error sync');
                /* Auto-retry with backoff */
                clearTimeout(_retryTimer);
                _retryTimer=setTimeout(()=>{_syncErrors=0;updateSyncBadge();guardarDatos()},Math.min(_retryDelay,30000));
                _retryDelay=Math.min(_retryDelay*1.5,30000);
            }
        }
    }finally{
        clearTimeout(_syncIndicatorTimer);
        _guardando=false;
        /* No re-consumir _guardarPendiente si estamos stale — el merge del snapshot siguiente
           disparará un guardaOptimista('merge',...) que hará el retry. Evita loop sobre 
           datos desactualizados. */
        if(_guardarPendiente&&!AppState._datosStale){_guardarPendiente=false;guardarDatos()}
    }
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
    if(AppState.unsubscribe){
        try{AppState.unsubscribe()}catch(e){console.warn('[P2P] unsubscribe error:',e.message)}
        AppState.unsubscribe=null;
    }
    AppState.unsubscribe=AppState.db.collection('users').doc(AppState.currentUser.uid)
    .onSnapshot({includeMetadataChanges:true},doc=>{
        /* Si recovery está en progreso, ignorar snapshots — la instancia se va a recargar */
        if(iniciarRecuperacionFirestore._activa)return;
        const fromCache=doc.metadata.fromCache;
        const hasPending=doc.metadata.hasPendingWrites;

        /* Skip echoes of our own pending writes */
        if(hasPending)return;

        const ci=$('comisionPlataforma'),cf=document.activeElement===ci,lcU=AppState.datos.comisionPlataforma,lcD=AppState.datos.comisionUSD;
        if(doc.exists){
            const d=doc.data();
            const serverVersion=d._version||0;
            const pending=hasPendingLocal();
            const remoteEmpty=esDatosVacios(d);

            /* Branch 1: Initial load (no local data yet) */
            if(AppState._localVersion===0){
                /* BLINDAJE: si el documento remoto viene vacío Y tenemos un backup local
                   con contenido real, priorizamos el backup (posible corrupción de cache Android). */
                const backup=restoreFromLocal();
                const backupTienedatos=backup&&backup.datos&&!esDatosVacios(backup.datos);
                if(remoteEmpty&&backupTienedatos){
                    console.warn('[P2P] Remote doc empty + local backup has data → restoring from backup');
                    AppState.datos=backup.datos;
                    AppState._localVersion=backup.v||0;
                    AppState._restoredFrom='backup-empty-remote';
                    /* Re-push el backup para rehidratar Firebase — pero sólo si el servidor no tiene
                       algo mayor pendiente de llegar. Esperamos un ciclo antes de pushear. */
                    setTimeout(()=>{if(!esDatosVacios(AppState.datos))guardarDatos(true)},2500);
                }else{
                    AppState.datos={operaciones:d.operaciones||[],movimientos:d.movimientos||[],transferencias:d.transferencias||[],conversiones:d.conversiones||[],bancos:d.bancos||{},lotes:d.lotes||[],tags:d.tags||[],tasasRecientes:d.tasasRecientes||[],saldoUsdt:d.saldoUsdt||0,ultimaTasaCompra:d.ultimaTasaCompra||0,ultimaTasaVenta:d.ultimaTasaVenta||0,comisionPlataforma:d.comisionPlataforma!==undefined?d.comisionPlataforma:0.14,ultimaTasaCompraUSD:d.ultimaTasaCompraUSD||0,ultimaTasaVentaUSD:d.ultimaTasaVentaUSD||0,comisionUSD:d.comisionUSD!==undefined?d.comisionUSD:0.14,ultimoMesProcesado:d.ultimoMesProcesado||'',_version:serverVersion,lastSeenVersion:d.lastSeenVersion||'',dismissedVersions:Array.isArray(d.dismissedVersions)?d.dismissedVersions:[]};
                    AppState._localVersion=serverVersion;
                }
            }
            /* Branch 2: Remote is newer → ALWAYS merge (never full replace after initial load) */
            else if(serverVersion>AppState._localVersion){
                /* ═══ Post-restore lock check ═══
                   Si acabamos de hacer un manual restore, los datos locales son authoritative
                   por unos segundos. Snapshots remotos durante esa ventana se ignoran para
                   evitar mergeRemoteState → recalcularLotesYGanancias → ~300-400ms perdidos.
                   El lock se libera automáticamente cuando guardarDatos(true) confirma. */
                if(AppState._postRestoreLockTs&&Date.now()<AppState._postRestoreLockTs){
                    console.log('[P2P] Snapshot ignorado por post-restore lock (faltan',
                                Math.ceil((AppState._postRestoreLockTs-Date.now())/1000)+'s)');
                    return;
                }
                /* BLINDAJE: si el remote newer viene VACÍO pero tenemos datos locales reales,
                   NO mergear ciegamente — posible wipe corrupto en otro dispositivo o cache. */
                if(remoteEmpty&&!esDatosVacios(AppState.datos)){
                    console.warn('[P2P] Remote newer but empty, local has data → ignoring remote, forcing re-sync up');
                    /* No actualizamos _localVersion → próximo guardarDatos tendrá newVersion > serverVersion */
                    AppState._datosStale=true;
                    setSyncStatus('syncing','Protegiendo datos locales…');
                    /* Forzar re-push de datos locales para restaurar el servidor */
                    setTimeout(()=>{AppState._datosStale=false;if(!esDatosVacios(AppState.datos))guardarDatos(true)},1500);
                }else{
                    mergeRemoteState(d);
                    AppState._localVersion=serverVersion;
                    /* If we had pending local changes, re-push merged state */
                    if(pending)guardaOptimista('merge','state','reconcile');
                }
            }
            /* Branch 3: serverVersion <= localVersion → echo of our own write, ignore.
               Si no estamos stale y no hay pending, podemos salir sin re-renderizar. */
            else if(serverVersion<=AppState._localVersion){
                if(!fromCache&&!hasPending&&!pending&&!AppState._datosStale&&!AppState._restoredFrom){
                    /* Echo puro — no hay nada que actualizar en UI */
                    if(!remoteEmpty)clearLocalBackup();
                    return;
                }
            }

            if(!fromCache&&AppState._datosStale){
                AppState._datosStale=false;
                _syncErrors=0;clearTimeout(_retryTimer);updateSyncBadge();
            }
            /* Solo limpiar backup si el servidor confirmó estado con contenido real */
            if(!fromCache&&!hasPending&&!pending&&!remoteEmpty&&!esDatosVacios(AppState.datos))clearLocalBackup();
        }else{
            /* doc no existe — intentar backup local antes de crear vacío */
            const backup=restoreFromLocal();
            if(backup&&backup.datos&&!esDatosVacios(backup.datos)){
                AppState.datos=backup.datos;AppState._localVersion=backup.v||0;
                AppState._restoredFrom='backup-no-remote';
                console.log('[P2P] Restored from localStorage backup (no remote doc)');
                setTimeout(()=>guardarDatos(true),2000);
            }else{
                AppState.datos=crearDatosVacios();AppState._localVersion=0;AppState._datosStale=false;
            }
        }
        if(cf){AppState.datos.comisionPlataforma=lcU;AppState.datos.comisionUSD=lcD}
        inicializarBancos();verificarResetLimites();
        /* Migración: normalizar datos legacy (solo si hay datos sin moneda o sin ganancia).
           IMPORTANTE: guard por sesión — si Firestore stripea undefined al marshallizar, 
           ganancia=undefined vuelve en cada snapshot, y eso dispararía un loop 
           de guardarDatos. La flag evita re-ejecutar en cada snapshot. */
        if(!AppState._legacyMigrado){
            const hasLegacyLotes=AppState.datos.lotes.some(l=>!l.moneda);
            const hasLegacyOps=AppState.datos.operaciones.some(op=>op.ganancia===undefined);
            const hasLegacyCom=AppState.datos.operaciones.some(op=>op.comisionPct===undefined);
            if(hasLegacyLotes||hasLegacyOps||hasLegacyCom){
                AppState.datos.lotes.forEach(l=>{if(!l.moneda)l.moneda='UYU'});
                AppState.datos.operaciones.forEach(op=>{
                    if(!op.tasa||op.tasa<=0)return;
                    /* Backfill comisionPct: primero intentar derivarlo de los valores existentes
                       (usdt + comisionPlataforma) para respetar la tasa real de cada op.
                       Si no se puede derivar, usar default 0.14%. Esto garantiza que operaciones
                       viejas conserven su comisión real en vez de asumir la global actual. */
                    if(op.comisionPct===undefined){
                        if(op.usdt>0&&op.comisionPlataforma>=0){
                            const derivado=roundMoney((op.comisionPlataforma/op.usdt)*100,3);
                            op.comisionPct=(derivado>=0&&derivado<=10)?derivado:0.14;
                        }else{
                            op.comisionPct=0.14;
                        }
                    }
                    const exp=usdtBase(op.monto/op.tasa,op.tipo);
                    if(Math.abs((op.usdt||0)-exp)>0.001){
                        op.usdt=exp;
                        op.comisionPlataforma=truncar(op.usdt*(op.comisionPct/100),2);
                    }
                    /* Asegurar ganancia numérica — sino recalcularLotesYGanancias la setea */
                    if(op.ganancia===undefined)op.ganancia=0;
                });
                recalcularLotesYGanancias();
                guardarDatos();
            }
            AppState._legacyMigrado=true;
        }
        AppState.ui.paginaOp=1;AppState.ui.paginaMov=1;AppState.ui.paginaTrans=1;AppState.ui.paginaConv=1;
        if(!cf){const mon=getMonedaBanco(),cv=mon==='USD'?AppState.datos.comisionUSD:AppState.datos.comisionPlataforma;ci.value=fmtNum(cv);setText('comisionPctLabel',fmtNum(cv))}
        actualizarVista();actualizarFormulario();actualizarColorSelect();ocultarLoading();
        setSyncStatus(fromCache?'syncing':'online',fromCache?'Caché local':undefined);
        /* Centro de Novedades — actualizar badge en cada snapshot, mostrar whatsnew solo 1 vez */
        actualizarBadgeNoticias();
        if(!AppState.ui._noticiasInicializadas){
            AppState.ui._noticiasInicializadas=true;
            chequearWhatsNewAlInicio();
        }
        /* Verificar cambio de mes para snapshot automático */
        if(!fromCache)verificarCambioMes();
    },err=>{
        console.error('[P2P] Snapshot error:',err.code||err.message);
        setSyncStatus('offline');ocultarLoading();
    });
}

function showApp(u){AppState.currentUser=u;const uname=emailToUser(u.email);setText('menuUserName',uname);setText('menuUserEmail',u.email);$('menuUserAvatar').textContent=(uname[0]||'U').toUpperCase();$('authContainer').classList.add('hidden');$('appContainer').classList.add('active');cargarDatosUsuario()}
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
        const reload=()=>{try{location.reload()}catch(e){window.location.href=window.location.href}};
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
function exportarDiagnostico(){
    try{
        const log=_readErrLog();
        const snap=AppState.datos?{
            counts:{
                operaciones:(AppState.datos.operaciones||[]).length,
                movimientos:(AppState.datos.movimientos||[]).length,
                transferencias:(AppState.datos.transferencias||[]).length,
                conversiones:(AppState.datos.conversiones||[]).length,
                lotes:(AppState.datos.lotes||[]).length,
                bancosActivos:Object.values(AppState.datos.bancos||{}).filter(b=>b&&b.activo).length
            },
            _version:AppState.datos._version,
            _localVersion:AppState._localVersion,
            _datosStale:AppState._datosStale,
            _restoredFrom:AppState._restoredFrom||null,
            syncState:AppState.ui.syncState
        }:null;
        const payload={
            _meta:{
                app:'P2P Tracker',
                version:CONFIG.APP_VERSION,
                exported_at:new Date().toISOString(),
                user:AppState.currentUser?emailToUser(AppState.currentUser.email):'(no login)',
                ua:navigator.userAgent,
                online:navigator.onLine,
                storageOk:(function(){try{localStorage.setItem('_t','1');localStorage.removeItem('_t');return true}catch(e){return false}})()
            },
            snapshot:snap,
            errores:log
        };
        const json=JSON.stringify(payload,null,2);
        const blob=new Blob([json],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        const uname=AppState.currentUser?emailToUser(AppState.currentUser.email):'anon';
        const fecha=new Date().toISOString().slice(0,10);
        a.href=url;a.download=`p2p-diagnostico-${uname}-${fecha}.json`;
        document.body.appendChild(a);a.click();document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setTimeout(()=>alert(`✅ Diagnóstico exportado.\n\n`
            +`• Errores capturados: ${log.length}\n`
            +`• Versión: ${CONFIG.APP_VERSION}\n\n`
            +`Compartí este archivo si reportás un bug — contiene info técnica que ayuda a diagnosticar el problema.`),100);
    }catch(e){
        console.error('[P2P] Error exportando diagnóstico:',e);
        alert('❌ Error exportando diagnóstico: '+(e.message||'desconocido'));
    }
}
function limpiarLogErrores(){
    if(!confirm('¿Borrar el log de errores local?\n\nEsto solo afecta los datos de diagnóstico, no tus datos de la app.'))return;
    try{localStorage.removeItem(_ERRLOG_KEY);alert('✅ Log de errores borrado.')}catch(e){alert('Error: '+e.message)}
}

function inicializarFirebase(){
    if(typeof firebase==='undefined'){ocultarLoading();return}
    try{
        firebase.initializeApp(CONFIG.firebase);AppState.auth=firebase.auth();AppState.db=firebase.firestore();
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
    }catch(e){console.error('[P2P] Firebase init error:',e);setSyncStatus('offline','Error init');ocultarLoading()}
}

