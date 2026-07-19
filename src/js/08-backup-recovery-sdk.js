function mergeRemoteState(d){
    /* ════════════════════════════════════════════════════════════════
       §v4.7.63 — Descompresión wire al recibir snapshot.
       ════════════════════════════════════════════════════════════════
       Si el doc remoto trae `_wireFormat: 'v1'`, descomprimir las
       operaciones a formato expandido ANTES de cualquier otro
       procesamiento. El resto de mergeRemoteState ya trabaja con el
       formato expandido (asume tipo:'venta', banco:'Itau', etc.).
       
       Si NO trae wireFormat, el doc es legacy → no se toca, sigue
       funcionando. Compatibilidad backward para el primer arranque
       después de implementar la compresión.
       
       Defensivo: clonamos `d` para no mutar el objeto que Firestore
       nos pasa. El framework podría tenerlo congelado o cachearlo. */
    if(d&&_isWireCompressed(d)){
        try{
            const opsDescomprimidas=_decompressOpsArrayFromWire(d.operaciones);
            /* Reemplazar el campo en la copia que vamos a procesar.
               No clonar todo el objeto entero — solo operaciones cambia
               (movs/transfs no se comprimen). */
            d={...d,operaciones:opsDescomprimidas};
            /* Limpiar el flag para no confundir downstream */
            delete d._wireFormat;
        }catch(e){
            console.error('[P2P] Descompresión wire FALLÓ:',e);
            _syncLog&&_syncLog('wire-decompress:failed',{error:String(e)});
            /* No abortar — dejar el doc como vino para que mergeRemoteState
               procese lo que pueda. Si las ops están corruptas, el render
               va a mostrar undefined, pero la app no muere. */
        }
    }
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
            /* Hash incluye campos que afectan FIFO o son visibles en UI:
                 - id, timestamp, updatedAt: identidad y orden cronológico
                 - monto, tasa, tipo, ganancia: FIFO + display
                 - banco, origen, destino: saldos por cuenta
                 - comisionPlataforma, comision: validación y display
                 - aportes (split): cantidad afecta inventario
                 - descripcion, tipoMovimiento (movs): display y métricas
               (v4.7.32: ampliado para detectar ediciones de banco/origen/destino/desc 
                en remoto — antes solo detectaba monto+tasa+tipo, dejando bugs de UI). */
            h+=x.id+
               (x.timestamp||x.fecha||'')+'|'+
               (x.updatedAt||'')+'|'+
               (x.monto||0)+'|'+
               (x.tasa||0)+'|'+
               (x.tipo||x.tipoMovimiento||'')+'|'+
               (x.banco||x.origen||'')+'|'+
               (x.destino||'')+'|'+
               (x.comisionPlataforma||x.comision||0)+'|'+
               (x.ganancia||0)+'|'+
               (x.descripcion||'')+'|'+
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
    /* ═══ IDs con writes pending locales por entidad ═══
       BUG CRÍTICO PREVIO: el merge preservaba TODOS los items locales que no estuvieran 
       en remoto, asumiendo que eran "pending local". Eso era incorrecto: si OTRO device 
       eliminó un item ya sincronizado, el item desaparecía de remoto y este device lo 
       preservaba como "local-only" → fantasma persistente.
       
       Fix: solo preservar items con entrada activa en _syncQueue (genuinamente pending 
       desde este device). Items sin pending Y sin remoto → eliminados en otro device. */
    const pendingIdsByEntity={};
    _syncQueue.forEach(a=>{
        if(a.type==='delete'||!a.entity||!a.id)return;
        if(!pendingIdsByEntity[a.entity])pendingIdsByEntity[a.entity]=new Set();
        pendingIdsByEntity[a.entity].add(a.id);
    });
    ['operaciones','movimientos','transferencias','conversiones'].forEach(key=>{
        const local=AppState.datos[key]||[];
        const remote=d[key]||[];
        const remoteIds=new Set(remote.map(e=>e.id));
        const pendingIds=pendingIdsByEntity[key]||new Set();
        /* Local-only: solo preservar si está en _syncQueue como pending genuino */
        const localOnly=local.filter(e=>e.id&&!remoteIds.has(e.id)&&pendingIds.has(e.id));
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
    /* ═══ v4.9.0 — Lotes manuales/carryover + metadata de archivado ═══
       Los lotes manuales ahora viajan en d.lotesManuales (no derivables).
       Regla: remoto manda, EXCEPTO lotes con edición local pendiente en
       _syncQueue (entity 'lotes') y los marcados para borrar (delIds).
       Los no-manuales locales se preservan tal cual: recalcular los regenera. */
    if(Array.isArray(d.lotesManuales)){
        const _pendLotes=new Set(_syncQueue.filter(a=>a.entity==='lotes').map(a=>a.id));
        const _manLocalPend=(AppState.datos.lotes||[]).filter(l=>l&&l.manual&&_pendLotes.has(l.id));
        const _manRemotos=d.lotesManuales.filter(l=>l&&!_pendLotes.has(l.id)&&!delIds.has(l.id));
        const _noManual=(AppState.datos.lotes||[]).filter(l=>l&&!l.manual);
        AppState.datos.lotes=[..._manRemotos,..._manLocalPend,..._noManual];
    }
    /* Seeds del archivado: gana el corte más reciente (encadenable) */
    if(d._archivoSeeds&&(!AppState.datos._archivoSeeds||String(d._archivoSeeds.corte||'')>String(AppState.datos._archivoSeeds.corte||''))){
        AppState.datos._archivoSeeds=d._archivoSeeds;
    }
    /* Índice del archivo: unión por mes (remoto pisa por mes) */
    if(d._archivoIndex&&d._archivoIndex.meses){
        const _mesesLocal=(AppState.datos._archivoIndex&&AppState.datos._archivoIndex.meses)||{};
        AppState.datos._archivoIndex={meses:{..._mesesLocal,...d._archivoIndex.meses},actualizado:d._archivoIndex.actualizado||_mesesLocal.actualizado||''};
        if(typeof mostrarBotonArchivo==='function'){try{mostrarBotonArchivo()}catch(_){}}
    }
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
        /* Arrays no cambiaron, pero pudo cambiar: bancos, tags, comisión global, etc.
           Invalidar cachés livianos Y forzar re-render — el caller llamará actualizarVista 
           después igual, pero garantizamos que las listas y el dashboard reflejen 
           cambios escalares aunque vengan de otro device. */
        if(typeof invalidarGananciaCache==='function')invalidarGananciaCache();
        if(typeof _invalidateListCache==='function')_invalidateListCache();
        if(typeof actualizarVistaDebounced==='function')actualizarVistaDebounced();
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

async function guardarDatos(forzar,opts){
    if(!AppState.currentUser)return;
    /* ═══ v4.7.64 — Guards contra recovery write activa ═══
       _recoveryActive: recoveryWrite() en curso. NINGÚN write competidor — el doc
         remoto debe ser reemplazado por el snapshot comprimido limpio sin
         interferencias. La única excepción: el propio recoveryWrite llama a este
         path interno con opts.allowDuringRecovery=true.
       _recoverySafeMode: recovery falló, modo seguro hasta acción manual del usuario.
         Bloquea TODOS los writes incluyendo recovery. La única salida es restoreBackup()
         o exportar manualmente.
       
       _localDirty se preserva durante el bloqueo: cuando recovery termine OK, la
       próxima edición real del usuario sincroniza lo pendiente. */
    const allowDuringRecovery=opts&&opts.allowDuringRecovery===true;
    if(AppState._recoveryActive&&!allowDuringRecovery){
        _syncLog&&_syncLog('save:blocked-by-recovery',{forzar:!!forzar});
        return;
    }
    if(AppState._recoverySafeMode){
        _syncLog&&_syncLog('save:blocked-by-safemode',{forzar:!!forzar});
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
    _localDirty++;
    if(AppState._datosStale&&!forzar){
        setSyncStatus('syncing','Sincronizando...');return;
    }
    if(_guardando){_guardarPendiente=true;return}
    _guardando=true;_syncPending++;updateSyncBadge();
    /* ═══ Captura del estado a sincronizar ANTES de empezar la tx ═══
       Snapshot de los IDs que tienen _syncState='pending' AHORA. Cuando la tx confirme,
       limpiamos solo esos IDs — no toda la queue. Esto resuelve el bug donde los dots 
       amarillos quedaban permanentes: si _syncPending nunca llegaba a 0 (porque el usuario
       mutaba constantemente), clearSyncQueue nunca corría y _syncState='pending' se 
       acumulaba para siempre. Ahora cada tx exitosa limpia exactamente lo que confirmó. */
    const idsSnapshot=_syncQueue.map(a=>({entity:a.entity,id:a.id,type:a.type}));
    _syncLog('save:start',{queueSize:idsSnapshot.length,pending:_syncPending});
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
    const _tBackupStart=performance.now();
    if(_syncQueue.length>0||forzar)backupToLocal();
    const _tBackupEnd=performance.now();
    if(_tBackupEnd-_tBackupStart>5)_syncLog('save:backup-local',{ms:Math.round(_tBackupEnd-_tBackupStart)});
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
        /* Timeout safety net: si el write no responde en 30s, asumimos red rota
           y lo abortamos con código tratable. Sin esto, _guardando=true podía quedar
           eterno y bloquear todos los saves siguientes. El backup local ya está hecho,
           así que es seguro fallar y reintentar via retry timer. */
        const TX_TIMEOUT=30000;
        /* ═══════════════════════════════════════════════════════════════
           §FIX1-v4.7.35 — Eliminación del tx.get para reducir latencia
           ═══════════════════════════════════════════════════════════════
           Antes (v4.7.34): runTransaction(async tx => { await tx.get(); ...; tx.set() })
           Ahora: ref.set(datos) sin lectura previa.

           Protecciones: snapshot listener + mergeRemoteState mantienen la coherencia
           multi-device. Si dos devices escriben simultáneamente, el snapshot subsiguiente
           lo reconcilia (mismo flow que ya manejaba multi-device).
           
           Strip de campos derivables (Fix 2 v4.7.36): lotes y saldoUsdt se reconstruyen
           localmente con recalcularLotesYGanancias(). No se suben al server. Eso reduce
           el payload típico de ~1140 KB a ~500-700 KB.
           
           Compatibilidad legacy: docs viejos que tengan lotes embebidos siguen funcionando 
           — al cargarse, recalcularLotesYGanancias los sobrescribe con los reconstruidos. */
        const tStart=performance.now();
        _syncLog('save:prep-start',{});
        const serverVersionConocido=AppState._localVersion||0;
        const newVersion=serverVersionConocido+1;
        _syncLog('payload:compact-start',{});
        /* Strip de campos runtime-only que NO deben persistirse en Firestore.
           _syncState es un hint local para mostrar el dot pulsante en la UI.
           Si se persistiera, otros devices verían "pending" eterno y el doc 
           crecería sin razón. */
        const stripRuntime=arr=>Array.isArray(arr)?arr.map(x=>{
            if(!x._syncState)return x;
            const{_syncState,...rest}=x;
            return rest;
        }):arr;
        /* ═══ v4.7.39 — Strip de campos derivables DENTRO de cada operación ═══
           Estos campos viven dentro de cada op pero son 100% reconstruibles vía 
           recalcularLotesYGanancias() (función pura: replay FIFO sobre operaciones):
             - consumedLots[]: lotes consumidos por una venta (FIFO replay lo reconstruye)
             - ganancia: ganancia de la op (FIFO replay la calcula)
           
           Comprobado en código (líneas ~3613-3622):
             op.ganancia = roundMoney(fifo.ganancia)
             op.consumedLots = fifo.consumed
           
           Si por algún bug el recalc no corre, la UI ve "ganancia: 0" temporal hasta
           que recalc se dispare (en cada snapshot vía necesitaRecalc check de v4.7.36).
           
        /* ═══ v4.7.39 — Strip de campos derivables DENTRO de cada operación ═══
           Estos campos viven dentro de cada op pero son 100% reconstruibles vía 
           recalcularLotesYGanancias() (función pura: replay FIFO sobre operaciones):
             - consumedLots[]: lotes consumidos por una venta (FIFO replay lo reconstruye)
             - ganancia: ganancia de la op (FIFO replay la calcula)
           
           v4.7.41 — sumamos comisionPlataforma al strip:
             - comisionPlataforma: derivable como truncar(usdtBase × comisionPct/100, 2)
               donde usdtBase = roundMoney(monto/tasa,2) para compras
                                truncar(monto/tasa,2)    para ventas
             - Verificado: auditarComisionPlataforma() reportó 3092/3092 exact en datos
               reales. SAFE-TO-STRIP con cero discrepancias. La fórmula es exactamente
               la que usa recalcularLotesYGanancias() línea ~3611.
             - Si una op carece de comisionPct (legacy), el recalc usa 0.14 como default.
           
           Comprobado en código (líneas ~3611, 3626):
             const cp = truncar(uBase * cpct, 2)
             op.ganancia = roundMoney(fifo.ganancia)
             op.consumedLots = fifo.consumed
             op.comisionPlataforma = cp
           
           CRÍTICO: NO mutar la op original — solo la copia para el payload remoto. 
           AppState.datos.operaciones[i] sigue intacta para la UI. */
        const stripDerived=arr=>Array.isArray(arr)?arr.map(x=>{
            if(!x||typeof x!=='object')return x;
            /* Crear copia sin los campos derivables */
            const{_syncState,consumedLots,ganancia,comisionPlataforma,...rest}=x;
            return rest;
        }):arr;
        const datosLimpios={
            ...AppState.datos,
            operaciones:stripDerived(AppState.datos.operaciones),
            movimientos:stripRuntime(AppState.datos.movimientos),
            transferencias:stripRuntime(AppState.datos.transferencias),
            conversiones:stripRuntime(AppState.datos.conversiones||[])
        };
        /* Medir tamaño ANTES del strip de campos top-level (lotes/saldoUsdt) */
        let payloadKBPreStrip=0;
        try{
            const sampleFull={...datosLimpios,_version:newVersion,ultimaActualizacion:'<server-ts>'};
            payloadKBPreStrip=Math.round(JSON.stringify(sampleFull).length/1024);
        }catch(e){/* no critical */}
        /* v4.9.0 FIX — Los lotes MANUALES (incluidos los carryover del archivado)
           NO son derivables del historial: hay que persistirlos. Antes se borraba
           `lotes` completo → en un dispositivo nuevo o tras limpiar caché, los
           lotes manuales desaparecían silenciosamente. Los no-manuales sí se
           regeneran con recalcularLotesYGanancias(), esos siguen fuera. */
        datosLimpios.lotesManuales=(AppState.datos.lotes||[]).filter(l=>l&&l.manual).map(l=>{const{_syncState,...r}=l;return r});
        /* Strip de derivables top-level (Fix 2 v4.7.36) */
        delete datosLimpios.lotes;
        delete datosLimpios.saldoUsdt;
        /* ════════════════════════════════════════════════════════════════
           §v4.7.63 — Compresión wire: operaciones a formato comprimido.
           ════════════════════════════════════════════════════════════════
           Solo si el self-test pasó al cargar la app (window._wireCompressionBroken
           sería true si falló). Si falló, escribimos formato legacy — más
           seguro perder ahorro que escribir data corrupta.
           
           Lo que cambia: cada op pasa por _compressOpForWire, que aplica:
             - tipo/banco/moneda → enums numéricos
             - elimina timestamp (regenerable desde fecha+hora)
             - comisionPct solo si difiere del default 0.14
           El payload incluye _wireFormat:'v1' para que mergeRemoteState sepa
           cómo decodificar al recibir.
           
           MEMORIA NO CAMBIA. AppState.datos.operaciones sigue con el formato
           expandido. Solo cambia lo que sube a Firestore.
           
           VALIDACIÓN DE INTEGRIDAD POST-COMPRESIÓN: en CADA write (no solo
           el primero), comprimimos → descomprimimos → comparamos. Si las
           sumas no coinciden, ABORTAMOS la escritura y degradamos a legacy
           para ese write. Mejor escribir formato viejo (más grande pero
           seguro) que escribir comprimido corrupto. */
        if(!window._wireCompressionBroken){
            /* Snapshot de integridad ANTES de comprimir */
            const snapAntes=_capturarSnapshotIntegridad({
                operaciones:datosLimpios.operaciones,
                movimientos:datosLimpios.movimientos||[],
                transferencias:datosLimpios.transferencias||[],
                lotes:[],
                bancos:datosLimpios.bancos||{}
            });
            /* Comprimir */
            const opsCompr=_compressOpsArrayForWire(datosLimpios.operaciones);
            /* Round-trip check: descomprimir y verificar */
            const opsRoundtrip=_decompressOpsArrayFromWire(opsCompr);
            const snapDespues=_capturarSnapshotIntegridad({
                operaciones:opsRoundtrip,
                movimientos:datosLimpios.movimientos||[],
                transferencias:datosLimpios.transferencias||[],
                lotes:[],
                bancos:datosLimpios.bancos||{}
            });
            const integridad=_compararSnapshotsIntegridad(snapAntes,snapDespues);
            if(integridad.ok){
                /* Integridad verificada → escribir comprimido */
                datosLimpios.operaciones=opsCompr;
                datosLimpios._wireFormat=WIRE_FORMAT_VERSION;
                _syncLog('wire-compress:ok',{ops:opsCompr.length});
            }else{
                /* Integridad rota → NO comprimir, escribir legacy + alerta crítica */
                console.error('[P2P] WIRE COMPRESSION INTEGRITY FAILED — escribiendo formato legacy:',integridad.diffs);
                _syncLog('wire-compress:integrity-fail',{diffs:integridad.diffs});
                /* Marcar broken para evitar reintentos en próximos saves */
                window._wireCompressionBroken=true;
                /* datosLimpios.operaciones queda en formato expandido (no se reemplaza) */
            }
        }
        const payload={
            ...datosLimpios,
            _version:newVersion,
            ultimaActualizacion:firebase.firestore.FieldValue.serverTimestamp()
        };
        /* Tamaño FINAL del payload */
        let payloadKB=0;
        try{
            const sample={...payload,ultimaActualizacion:'<server-ts>'};
            payloadKB=Math.round(JSON.stringify(sample).length/1024);
        }catch(e){/* if fails, payloadKB=0 — not critical */}
        /* ═══ Medición del baseline: cuánto pesaría SIN ningún strip ═══
           Para mostrar el ahorro real total (incluyendo strip per-op de consumedLots
           y ganancia). Calculado solo si el log está habilitado, porque es costoso. */
        let payloadKBBaseline=0;
        try{
            /* Baseline = AppState.datos sin tocar (con consumedLots, ganancia, lotes, saldoUsdt) */
            const baselineSample={...AppState.datos,_version:newVersion,ultimaActualizacion:'<server-ts>'};
            payloadKBBaseline=Math.round(JSON.stringify(baselineSample).length/1024);
        }catch(e){/* no critical */}
        const reductionPct=payloadKBPreStrip>0?Math.round(100*(payloadKBPreStrip-payloadKB)/payloadKBPreStrip):0;
        const reductionPerOpKB=Math.max(0,payloadKBBaseline-payloadKBPreStrip);
        const reductionTotalKB=Math.max(0,payloadKBBaseline-payloadKB);
        const reductionTotalPct=payloadKBBaseline>0?Math.round(100*reductionTotalKB/payloadKBBaseline):0;
        const tPrepEnd=performance.now();
        _syncLog('save:prep-end',{ms:Math.round(tPrepEnd-tStart),payloadKB,preKB:payloadKBPreStrip,
                                  baselineKB:payloadKBBaseline,reductionPct,reductionTotalKB,reductionTotalPct,
                                  newVersion,stripped:['consumedLots','ganancia','comisionPlataforma','lotes','saldoUsdt']});
        _syncLog('payload:compact-end',{baselineKB:payloadKBBaseline,finalKB:payloadKB,
                                        savedPerOpKB:reductionPerOpKB,savedTotalKB:reductionTotalKB});
        /* Optimistic version bump — el snapshot listener va a confirmar con el server.
           Si hay conflicto, mergeRemoteState lo reconcilia. */
        AppState._localVersion=newVersion;
        AppState.datos._version=newVersion;
        _syncLog('save:write-start',{payloadKB});
        /* v4.7.64 — Guard permanente: si el payload supera 850 KB, bloquear
           writes y mostrar alerta. Nunca más zona crítica silenciosa. */
        try{
            if(typeof window._checkPayloadGuard==='function')window._checkPayloadGuard(payloadKB);
        }catch(_){}
        /* v4.8.2 FIX: si el guard recién disparó safe mode, abortar TAMBIÉN este write.
           Antes solo se bloqueaban los writes FUTUROS (el chequeo de _recoverySafeMode
           está al inicio de guardarDatos), así que el payload >850 KB en curso igual
           se escribía una vez. Rollback de la versión optimista para que el snapshot
           listener no crea que estamos sincronizados. Los datos quedan a salvo en el
           backup local; el usuario decide desde el overlay del guard (exportar /
           recovery / continuar). */
        if(AppState._recoverySafeMode&&!allowDuringRecovery){
            AppState._localVersion=serverVersionConocido;
            AppState.datos._version=serverVersionConocido;
            _syncPending=Math.max(0,_syncPending-1);
            updateSyncBadge();
            clearTimeout(_syncIndicatorTimer);
            _syncLog('save:aborted-by-payload-guard',{payloadKB,rolledBackTo:serverVersionConocido});
            _guardando=false;
            return;
        }
        /* Guardar el version pre-bump para poder hacer rollback si el write falla.
           Sin esto, un error de red dejaría _localVersion adelantado y el snapshot 
           listener pensaría que estamos sincronizados cuando en realidad no escribimos. */
        const versionPreBump=serverVersionConocido;
        let versionRolledBack=false;
        let writeCompleted=false;
        /* ═══ CRÍTICO v4.7.36: cancelar el setTimeout del timeout ═══
           Bug detectado en v4.7.35: el setTimeout del timeout NUNCA se cancelaba cuando
           el write completaba exitosamente. Resultado: 30 segundos después del start,
           el callback ejecutaba rollback de _localVersion aunque la promesa del write 
           hubiera resuelto bien y _localVersion ya estuviera correcto.
           
           En el log de v4.7.35 esto se veía como: write completa OK a t+21s, pero a 
           t+30s (~9s después) aparece save:version-rollback porque el setTimeout viejo
           ejecuta su callback. Como cada save crea un nuevo timeout, se acumulaban.
           
           Fix: guardar el handle del setTimeout y cancelarlo en .then() y .catch().
           Además, writeCompleted flag para que aunque haya race, no se haga rollback. */
        let timeoutHandle=null;
        const writePromise=ref.set(payload).then(()=>{
            writeCompleted=true;
            if(timeoutHandle){clearTimeout(timeoutHandle);timeoutHandle=null}
            const tWriteEnd=performance.now();
            _syncLog('save:write-end',{ms:Math.round(tWriteEnd-tPrepEnd),totalMs:Math.round(tWriteEnd-tStart)});
        }).catch(err=>{
            if(timeoutHandle){clearTimeout(timeoutHandle);timeoutHandle=null}
            /* Rollback de la version optimista solo si el write realmente falló */
            if(!versionRolledBack&&!writeCompleted){
                AppState._localVersion=versionPreBump;
                AppState.datos._version=versionPreBump;
                versionRolledBack=true;
                _syncLog('save:version-rollback',{toVersion:versionPreBump,reason:'write-error'});
            }
            throw err;
        });
        const timeoutPromise=new Promise((_,reject)=>{
            timeoutHandle=setTimeout(()=>{
                timeoutHandle=null;
                /* Verificar que el write NO haya completado ya — protege contra race:
                   write completa pero callback de timeout estaba en cola de microtasks. */
                if(writeCompleted)return;
                if(!versionRolledBack){
                    AppState._localVersion=versionPreBump;
                    AppState.datos._version=versionPreBump;
                    versionRolledBack=true;
                    _syncLog('save:version-rollback',{toVersion:versionPreBump,reason:'timeout'});
                }
                reject({code:'tx-timeout'});
            },TX_TIMEOUT);
        });
        await Promise.race([writePromise,timeoutPromise]);
        _syncLog('save:confirmed',{idsConfirmed:idsSnapshot.length,newVersion:AppState._localVersion});
        _syncPending=Math.max(0,_syncPending-1);_syncErrors=0;_retryDelay=2000;
        clearTimeout(_retryTimer);
        /* ═══ Limpiar _syncState solo de los IDs que esta tx confirmó ═══
           Antes: clearSyncQueue() limpiaba TODO solo si _syncPending===0. Si el usuario 
           mutaba constantemente, eso nunca pasaba y los dots amarillos eran eternos.
           Ahora: limpiamos exactamente los IDs del idsSnapshot — los que se acaban de 
           subir al server. Los pending nuevos que llegaron mientras la tx corría quedan
           marcados y se limpiarán en el próximo ciclo. */
        const confirmedIds=new Set();
        idsSnapshot.forEach(a=>{
            if(a.type==='delete'||!a.entity||!a.id)return;
            const arr=AppState.datos[a.entity];
            if(Array.isArray(arr)){
                const item=arr.find(x=>x.id===a.id);
                if(item&&item._syncState==='pending'){
                    delete item._syncState;
                    confirmedIds.add(a.id);
                }
            }
        });
        /* Remover del _syncQueue los entries de IDs ya confirmados */
        if(confirmedIds.size>0){
            for(let i=_syncQueue.length-1;i>=0;i--){
                if(confirmedIds.has(_syncQueue[i].id))_syncQueue.splice(i,1);
            }
        }
        _localDirty=Math.max(0,_localDirty-1);
        if(_syncPending===0&&!_guardarPendiente){
            /* v4.8.2 FIX (race multi-device): la limpieza defensiva de remanentes solo
               es segura si NO hay un debounce pendiente. Escenario del bug: el usuario
               creaba una op mientras el write anterior estaba en vuelo; el write
               confirmaba, este bloque hacía _syncQueue.length=0 y _localDirty=0 con la
               op nueva TODAVÍA sin subir (su debounce dispara 100-400ms después). Si en
               esa ventana llegaba un snapshot de OTRO dispositivo (Branch 2 → merge),
               mergeRemoteState descartaba la op nueva por "local-only sin entrada en
               _syncQueue" → pérdida de datos real. Con debounce pendiente, dejamos la
               queue intacta: ese save la confirmará y drenará en su propio ciclo. */
            const hayDebouncePendiente=typeof _guardaDebounceTimer!=='undefined'&&_guardaDebounceTimer!==null;
            if(!hayDebouncePendiente){
                /* Cleanup final: cualquier remanente (defensive) + clear local backup */
                if(_syncQueue.length>0)_syncQueue.length=0;
                _localDirty=0;
                setSyncStatus('online');clearLocalBackup();
                _syncLog('save:queue-drained',{});
                /* Saneamiento de _syncState huérfanos justo después de drenar */
                if(typeof repairOrphanPendingStates==='function')repairOrphanPendingStates();
            }else{
                setSyncStatus('online');
                _syncLog('save:drain-deferred',{queue:_syncQueue.length,dirty:_localDirty});
            }
        }
        else setSyncStatus('syncing',_syncPending+' pendiente'+((_syncPending>1)?'s':''));
        updateSyncBadge();
    }catch(e){
        if(e.code==='offline-deferred'){
            /* Ya manejado arriba: no incrementar errores, no retry inmediato */
            _syncLog('save:offline-deferred',{queueSize:idsSnapshot.length});
        }else if(e.code==='tx-timeout'){
            /* Timeout de seguridad: la transacción no respondió en 30s.
               El backup local ya está hecho — los datos están a salvo. */
            _syncPending=Math.max(0,_syncPending-1);
            _syncErrors++;updateSyncBadge();
            _syncLog('save:tx-timeout',{retryIn:Math.min(_retryDelay,30000),consecutiveTimeouts:_syncErrors});
            console.warn('[P2P] Transacción excedió timeout de 30s ('+_syncErrors+' consecutivos)');
            /* ═══ CIRCUIT BREAKER v4.7.36 ═══
               Si llevamos 3+ timeouts consecutivos, NO reintentar automáticamente.
               Causa más probable: payload >1MB rechazado por Firestore, o SDK colgado.
               Reintentar genera loop infinito que congela la app. Mejor: parar, mantener 
               datos a salvo en local, mostrar mensaje claro, requerir acción manual.
               El usuario puede usar "Forzar sync" en el panel de diagnóstico cuando 
               crea que el problema se resolvió. */
            clearTimeout(_retryTimer);_retryTimer=null;
            if(_syncErrors>=3){
                setSyncStatus('offline','⚠ Sync bloqueado — abrí Diagnóstico');
                _syncLog('circuit-breaker:tripped',{consecutiveErrors:_syncErrors,reason:'tx-timeout'});
                console.error('[P2P] Circuit breaker activado: 3+ timeouts consecutivos. Auto-retry detenido. Usar Diagnóstico → Forzar sync para reintentar manualmente.');
                /* Reset de backoff para que el siguiente intento manual sea inmediato */
                _retryDelay=2000;
            }else{
                setSyncStatus('offline','Tiempo de espera agotado — reintentando…');
                _retryTimer=setTimeout(()=>{_syncErrors=0;updateSyncBadge();guardarDatos()},Math.min(_retryDelay,30000));
                _retryDelay=Math.min(_retryDelay*1.5,30000);
            }
        }else{
            _syncPending=Math.max(0,_syncPending-1);
            /* ═══════════════════════════════════════════════════════════════════
               §CLIENT-TERMINATED v4.7.42 — Detección de SDK en estado inválido
               ═══════════════════════════════════════════════════════════════════
               Firebase puede dejar el cliente Firestore en estado "terminated" 
               (por bugs internos, recovery mal finalizado, o paths raros del SDK).
               Una vez en ese estado, TODO write futuro falla instantáneamente con:
                 code: 'failed-precondition'
                 message: 'The client has already been terminated.'
               
               Los retries automáticos son inútiles — el cliente nunca se recupera 
               solo. Cada call falla en <1s, lo que rápidamente acumula errores y 
               saturaría el circuit breaker, pero el problema raíz no es de red.
               
               Acción correcta (acordada con el usuario):
                 1. Detener retries automáticos
                 2. Resetear _guardando, _syncPending (sin tocar _localDirty ni la queue)
                 3. Backup local inmediato (defensivo)
                 4. Mostrar banner con botones "Recargar ahora" / "Seguir en modo local"
                 5. Marcar AppState._clientTerminated = true (flag global)
                 6. Bloquear NUEVOS intentos de save hasta reload
               
               Lo que NO hacemos (acordado con el usuario):
                 - NO firebase.app().delete() + initializeApp() en caliente
                 - NO tocar payload, formato de datos, ni la queue
                 - NO recargar automáticamente — solo a pedido del usuario */
            const errMsg=(e.message||'').toString();
            const esClientTerminated=e.code==='failed-precondition'&&/client has already been terminated/i.test(errMsg);
            if(esClientTerminated){
                _syncLog('firebase:client-terminated',{msg:errMsg.slice(0,120),queueSize:_syncQueue.length,dirty:_localDirty});
                _syncLog('sync:requires-reload',{});
                /* Reset de flags de save en curso — pero NO tocar _localDirty ni _syncQueue.
                   Los datos pending deben preservarse para que después del reload se sincronicen. */
                _guardando=false;
                _syncPending=0;
                _guardarPendiente=false;
                clearTimeout(_retryTimer);_retryTimer=null;
                _syncErrors=0;
                _retryDelay=2000;
                /* Flag global para bloquear futuros saves hasta reload */
                AppState._clientTerminated=true;
                AppState._clientTerminatedAt=Date.now();
                /* Backup local defensivo — última red de seguridad */
                try{if(typeof backupToLocal==='function')backupToLocal()}catch(_){}
                setSyncStatus('offline','⚠ Recargá para reactivar sync');
                updateSyncBadge();
                /* Mostrar banner si la función está disponible (DOM ready) */
                try{if(typeof mostrarBannerClienteTerminado==='function')mostrarBannerClienteTerminado()}catch(_){}
                console.error('[P2P] Firebase client terminated — sync detenido. Recargar para reactivar.');
                /* Salir del catch SIN reintentar */
            }else if(e.code==='stale-version'){
                AppState._datosStale=true;
                setSyncStatus('syncing','Reconciliando…');
                _syncLog('save:stale-version',{serverV:e.serverV,localV:e.localV});
            }else{
                _syncErrors++;updateSyncBadge();
                _syncLog('save:error',{code:e.code||'?',msg:errMsg.slice(0,120),retryIn:Math.min(_retryDelay,30000),consecutiveErrors:_syncErrors});
                /* Circuit breaker para errores generales también */
                clearTimeout(_retryTimer);_retryTimer=null;
                if(_syncErrors>=3){
                    setSyncStatus('offline','⚠ Sync bloqueado — abrí Diagnóstico');
                    _syncLog('circuit-breaker:tripped',{consecutiveErrors:_syncErrors,reason:e.code||'error'});
                    console.error('[P2P] Circuit breaker activado: 3+ errores consecutivos. Datos a salvo localmente.');
                    _retryDelay=2000;
                }else{
                    setSyncStatus('offline',_syncErrors>0?_syncErrors+' error'+((_syncErrors>1)?'es':''):'Error sync');
                    _retryTimer=setTimeout(()=>{_syncErrors=0;updateSyncBadge();guardarDatos()},Math.min(_retryDelay,30000));
                    _retryDelay=Math.min(_retryDelay*1.5,30000);
                }
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
        const fromCache=doc.metadata.fromCache;
        const hasPending=doc.metadata.hasPendingWrites;
        if(typeof _syncLog==='function')_syncLog('snapshot:received',{fromCache,hasPending,exists:doc.exists,v:doc.exists?(doc.data()._version||0):0});

        /* Skip echoes of our own pending writes */
        if(hasPending)return;

        const ci=$('comisionPlataforma'),cf=document.activeElement===ci,lcU=AppState.datos.comisionPlataforma,lcD=AppState.datos.comisionUSD;
        /* v4.8.2: solo resetear la paginación cuando el snapshot realmente reemplazó
           o mergeó datos (Branch 1 / Branch 2 / restore). Antes, CUALQUIER snapshot
           que cayera al bloque común (p.ej. eco propio con pending local) devolvía
           al usuario a la página 1 mientras navegaba el historial. */
        let snapshotAplicoCambios=false;
        if(doc.exists){
            let d=doc.data();
            /* ════════════════════════════════════════════════════════════════
               §v4.7.63 — Descompresión wire en TODOS los paths del snapshot
               ════════════════════════════════════════════════════════════════
               Punto único de descompresión: si el doc trae _wireFormat='v1',
               descomprimir UNA sola vez aquí. Branch 1 (initial load) y Branch
               2 (merge remoto) reciben ambos `d` ya en formato expandido.
               
               Esto es defensivo: si en algún momento se llama otro path con
               `d` no descomprimido, ese path ve formato comprimido y rompe.
               Mejor centralizar la descompresión en el punto de entrada.
               
               Robustez: si la descompresión falla, dejar `d` como vino y
               loguear. La app va a ver ops con campos undefined pero no
               muere. mergeRemoteState/Branch 1 manejan defaults para todo. */
            if(_isWireCompressed(d)){
                try{
                    d={...d,operaciones:_decompressOpsArrayFromWire(d.operaciones)};
                    delete d._wireFormat;
                }catch(e){
                    console.error('[P2P] Descompresión wire en snapshot falló:',e);
                    _syncLog&&_syncLog('wire-decompress:failed',{path:'snapshot',error:String(e)});
                }
            }
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
                    snapshotAplicoCambios=true;
                    /* Re-push el backup para rehidratar Firebase — pero sólo si el servidor no tiene
                       algo mayor pendiente de llegar. Esperamos un ciclo antes de pushear. */
                    setTimeout(()=>{if(!esDatosVacios(AppState.datos))guardarDatos(true)},2500);
                }else{
                    AppState.datos={operaciones:d.operaciones||[],movimientos:d.movimientos||[],transferencias:d.transferencias||[],conversiones:d.conversiones||[],bancos:d.bancos||{},lotes:Array.isArray(d.lotesManuales)?d.lotesManuales:(d.lotes||[]),tags:d.tags||[],tasasRecientes:d.tasasRecientes||[],saldoUsdt:d.saldoUsdt||0,ultimaTasaCompra:d.ultimaTasaCompra||0,ultimaTasaVenta:d.ultimaTasaVenta||0,comisionPlataforma:d.comisionPlataforma!==undefined?d.comisionPlataforma:0.14,ultimaTasaCompraUSD:d.ultimaTasaCompraUSD||0,ultimaTasaVentaUSD:d.ultimaTasaVentaUSD||0,comisionUSD:d.comisionUSD!==undefined?d.comisionUSD:0.14,ultimoMesProcesado:d.ultimoMesProcesado||'',_version:serverVersion,lastSeenVersion:d.lastSeenVersion||'',dismissedVersions:Array.isArray(d.dismissedVersions)?d.dismissedVersions:[],_archivoSeeds:d._archivoSeeds||null,_archivoIndex:d._archivoIndex||null};
                    AppState._localVersion=serverVersion;
                    snapshotAplicoCambios=true;
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
                    snapshotAplicoCambios=true;
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
            /* Saneamiento post-snapshot: si el server confirmó nuestra versión, 
               cualquier _syncState='pending' sin entry real en queue es huérfano. */
            if(!fromCache&&!hasPending&&!AppState._datosStale){
                if(typeof repairOrphanPendingStates==='function')repairOrphanPendingStates();
                if(typeof reevaluarEstadoSync==='function')reevaluarEstadoSync();
            }
        }else{
            /* doc no existe — intentar backup local antes de crear vacío */
            const backup=restoreFromLocal();
            if(backup&&backup.datos&&!esDatosVacios(backup.datos)){
                AppState.datos=backup.datos;AppState._localVersion=backup.v||0;
                AppState._restoredFrom='backup-no-remote';
                snapshotAplicoCambios=true;
                console.log('[P2P] Restored from localStorage backup (no remote doc)');
                setTimeout(()=>guardarDatos(true),2000);
            }else{
                AppState.datos=crearDatosVacios();AppState._localVersion=0;AppState._datosStale=false;
                snapshotAplicoCambios=true;
            }
        }
        if(cf){AppState.datos.comisionPlataforma=lcU;AppState.datos.comisionUSD=lcD}
        inicializarBancos();verificarResetLimites();
        /* ═══ v4.7.36/39: si el snapshot vino SIN derivables (strip nuevo) ═══
           Los uploads de v4.7.36+ no incluyen lotes/saldoUsdt. v4.7.39+ tampoco incluye
           consumedLots/ganancia DENTRO de cada op. Cuando llega un snapshot así, hay 
           que reconstruir todo localmente via recalcularLotesYGanancias().
           
           Triggers de recalc:
             - lotes ausente o vacío (strip v4.7.36)
             - saldoUsdt undefined (strip v4.7.36)
             - alguna op de venta con ganancia undefined (strip v4.7.39)
             - alguna op de venta sin consumedLots[] (strip v4.7.39)
           
           Compatibilidad legacy: si el doc viejo SÍ tenía estos campos embebidos, 
           recalcularLotesYGanancias los sobrescribe con los reconstruidos (idempotente).
           
           Se ejecuta solo en Branch 1 (load inicial) y Branch 2 (merge con cambios).
           Branch 3 (echo de mi propio write) ya retornó antes. */
        let necesitaRecalc=!Array.isArray(AppState.datos.lotes)||AppState.datos.lotes.length===0||AppState.datos.saldoUsdt===undefined;
        if(!necesitaRecalc&&Array.isArray(AppState.datos.operaciones)){
            /* Detección rápida: si alguna op (compra o venta) no tiene los campos derivados,
               recalcular. Sampleamos las primeras 10 ops para no recorrer 3000+ cada snapshot.
               
               Triggers:
                 - venta sin ganancia o consumedLots (v4.7.39)
                 - cualquier op sin comisionPlataforma (v4.7.41)
                 
               Sampleamos 10 (no 5) porque ahora chequeamos compras también, no solo ventas. */
            let checked=0;
            for(let i=0;i<AppState.datos.operaciones.length&&checked<10;i++){
                const op=AppState.datos.operaciones[i];
                if(!op||typeof op!=='object')continue;
                checked++;
                /* Cualquier op debería tener comisionPlataforma (strip v4.7.41) */
                if(op.comisionPlataforma===undefined){
                    necesitaRecalc=true;
                    break;
                }
                /* Solo las ventas tienen ganancia + consumedLots */
                if(op.tipo==='venta'){
                    if(op.ganancia===undefined||!Array.isArray(op.consumedLots)){
                        necesitaRecalc=true;
                        break;
                    }
                }
            }
        }
        if(necesitaRecalc&&Array.isArray(AppState.datos.operaciones)&&AppState.datos.operaciones.length>0){
            try{
                recalcularLotesYGanancias();
                _syncLog('snapshot:hydrate-derived',{ops:AppState.datos.operaciones.length,lotes:(AppState.datos.lotes||[]).length});
            }catch(e){console.warn('[P2P] recalc post-snapshot falló:',e.message)}
        }
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
        if(snapshotAplicoCambios){AppState.ui.paginaOp=1;AppState.ui.paginaMov=1;AppState.ui.paginaTrans=1;AppState.ui.paginaConv=1}
        if(!cf){const mon=getMonedaBanco(),cv=mon==='USD'?AppState.datos.comisionUSD:AppState.datos.comisionPlataforma;ci.value=fmtNum(cv);setText('comisionPctLabel',fmtNum(cv))}
        actualizarVista();actualizarFormulario();actualizarColorSelect();ocultarLoading();
        setSyncStatus(fromCache?'syncing':'online',fromCache?'Caché local':undefined);
        /* Si veníamos del bootstrap hidratado desde cache, el primer snapshot real 
           (no fromCache) marca la transición a "online". Limpiamos el flag para no 
           seguir mostrando "Modo local activo" después de que el sync ya conectó. */
        if(!fromCache&&AppState._uiHydratedFromCache){
            AppState._uiHydratedFromCache=false;
            _syncLog('sync:background-mode',{transitioned:'cache-to-online'});
        }
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
       servidor y mergeRemoteState las aplica encima — la UI se actualiza naturalmente.
       
       Garantías:
       - Si NO hay backup local (primer login, cuenta nueva), se mantiene el flow
         original — cargarDatosUsuario espera el snapshot, watchdog cubre timeouts.
       - Si hay backup, AppState._localVersion queda con la versión del backup, así 
         mergeRemoteState puede comparar correctamente cuando llegue el snapshot.
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

