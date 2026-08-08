function renderizarInventario(){
    const la=getLotesActivosFIFO();
    if(!la.length){setHtml('inventarioContent','<div style="text-align:center;padding:30px;color:#94a3b8"><div style="margin-bottom:8px"><svg class="empty-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h11M8 12h11M8 18h11M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg></div><div>Sin USDT en inventario</div></div>');return}
    let tot=0,h='';
    la.forEach((l,i)=>{tot=truncar(tot+l.disponible,2);const mon=l.moneda||'UYU',sy=getSym(mon),v=roundMoney(l.disponible*l.precioCompra,2);
        const tag=l.manual?'<span style="display:inline-block;font-size:0.6em;background:#e0e7ff;color:#4338ca;padding:1px 5px;border-radius:4px;font-weight:600;vertical-align:middle;margin-left:4px;letter-spacing:0.3px">manual</span>':'';
        h+=`<div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;padding:13px 0;${i>0?'border-top:1px solid #f1f5f9':''}">
            <div style="min-width:0">
                <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
                    <span style="font-size:0.88em;font-weight:700;color:#2563eb">${fmtTrunc(l.disponible,2)} USDT</span>
                    <span style="font-size:0.7em;color:#94a3b8;font-weight:500">#${i+1}${tag}</span>
                </div>
                <div style="display:flex;gap:10px;margin-top:3px;font-size:0.72em;color:#64748b">
                    <span>Precio: <b style="color:#475569">${fmtTasaMon(l.precioCompra,mon)}</b></span>
                    <span>Valor: <b style="color:#475569">${sy}${fmtNum(v,2)}</b></span>
                </div>
            </div>
            ${l.manual?`<button class="btn-edit-small" style="padding:6px 10px;min-height:30px;flex-shrink:0" data-action="editar-lote" data-lote-id="${l.id}">✏️</button>`:''}
        </div>`});
    h+=`<div style="margin-top:14px;padding:13px 16px;background:#f0f9ff;border:1px solid #e0f2fe;border-radius:10px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:0.78em;color:#64748b">Total inventario</span><span style="font-size:1.05em;font-weight:700;color:#2563eb">${fmtTrunc(tot,2)} USDT</span></div>`;
    setHtml('inventarioContent',h);
}

/* ═══════════════════════════════════════
   §8 — FIREBASE & AUTH
   ═══════════════════════════════════════ */
function userToEmail(u){return u.toLowerCase().trim()+CONFIG.EMAIL_DOMAIN}
function emailToUser(e){return e.replace(CONFIG.EMAIL_DOMAIN,'')}

let _guardando=false,_guardarPendiente=false,_syncPending=0,_syncErrors=0,_retryTimer=null,_retryDelay=2000,_localDirty=0;

/* ─── Sync queue: tracks what's pending ─── */
const _syncQueue=[];/* [{type:'create'|'delete'|'update',entity:string,id:string,ts:number}] */
/* v4.8.2 — Contador monotónico de mutaciones. Lo usa backupToLocal en su firma de
   deduplicación: antes la firma era version|len|dirty, que NO cambia entre dos
   ediciones in-place consecutivas (misma versión, mismo length) → la segunda edición
   quedaba FUERA del backup local hasta el próximo save confirmado. Si el SO mataba
   la pestaña en esa ventana, esa edición se perdía pese a la promesa de "backup
   inmediato". Con _mutSeq, cada mutación fuerza un backup nuevo. */
let _mutSeq=0;
const _SYNC_QUEUE_MAX=500;/* Cap defensivo: en escenarios offline largos, la queue 
   podría crecer sin tope. 500 es 10x más de lo que un usuario real genera 
   en una sesión típica — suficiente como red de seguridad sin perder casos reales. */
function enqueueSync(type,entity,id){
    _mutSeq++;
    _syncQueue.push({type,entity,id,ts:Date.now(),_t:performance.now()});
    /* Si excede el cap, descartar el más viejo (FIFO) — los entries antiguos solo
       sirven para tracking visual del dot pulsante; el sync real de datos NO depende
       del syncQueue (depende de _localDirty + _version). */
    if(_syncQueue.length>_SYNC_QUEUE_MAX){
        _syncQueue.splice(0,_syncQueue.length-_SYNC_QUEUE_MAX);
    }
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
   2. _localDirty === 0
   3. _localVersion === AppState.datos._version (sincronizados con server)
   4. !_guardando && !_guardarPendiente (nada en flight ni encolado)
   
   Si TODAS las condiciones se cumplen, NO HAY RAZÓN para tener _syncState='pending'.
   El item ya está confirmado, el flag es solo "deuda visual" de un ciclo viejo.
   
   Esta función se llama:
   - Después de cada save:queue-drained (sync exitoso completo)
   - Después de cada snapshot:received con serverVersion === localVersion
   - Al abrir el panel de diagnóstico (limpia antes de mostrar números) */
function repairOrphanPendingStates(){
    /* Salvavidas: si CUALQUIER condición de "no es seguro limpiar" se cumple, abortamos.
       Mejor dejar dots amarillos transitorios que limpiar pending real → datos perdidos. */
    if(_localDirty>0)return 0;
    if(_guardando||_guardarPendiente)return 0;
    if(AppState._datosStale)return 0;
    const dataVersion=(AppState.datos&&AppState.datos._version)||0;
    if(AppState._localVersion!==dataVersion)return 0;
    /* IDs que SÍ tienen razón legítima para estar pending: están en _syncQueue */
    const pendingIds=new Set();
    _syncQueue.forEach(a=>{if(a.id!==null&&a.id!==undefined)pendingIds.add(String(a.id))});
    let cleaned=0;
    ['operaciones','movimientos','transferencias','conversiones','lotes'].forEach(key=>{
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
        if(typeof _invalidateListCache==='function')_invalidateListCache();
        if(typeof actualizarVistaDebounced==='function')actualizarVistaDebounced();
    }
    return cleaned;
}

/* ═══════════════════════════════════════════════════════════════════
   §STATE-RECOVERY — "Error al reconectar" no debe quedar pegado
   ═══════════════════════════════════════════════════════════════════
   Si el listener está activo, la versión local matchea con la del documento,
   no hay nada en _syncQueue ni _localDirty, y el SDK no reporta recovery:
   el sistema YA está reconectado. Cualquier _syncErrors residual es ruido.
   Esta función verifica el estado real y baja el badge si corresponde. */
function reevaluarEstadoSync(){
    if(!AppState.currentUser)return;
    if(typeof iniciarRecuperacionFirestore!=='undefined'&&iniciarRecuperacionFirestore._activa)return;
    /* Síntomas de que en realidad estamos OK aunque el badge diga error */
    const listenerActivo=AppState.unsubscribe!==null&&AppState.unsubscribe!==undefined;
    const versionesMatch=AppState._localVersion===((AppState.datos&&AppState.datos._version)||0);
    const sinPending=_syncQueue.length===0&&_localDirty===0;
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

/* ═══════════════════════════════════════════════════════════════════
   §AUDIT-COMISION — Verificación de derivabilidad de comisionPlataforma
   ═══════════════════════════════════════════════════════════════════
   Objetivo: determinar si comisionPlataforma puede stripearse del payload
   remoto sin perder trazabilidad financiera. Se considera "derivable" sí y
   solo sí, para CADA operación, vale:
     
     comisionPlataforma guardada == truncar(usdtBase × comisionPct/100, 2)
   
   donde usdtBase = roundMoney(monto/tasa, 2) para compras
                    truncar(monto/tasa, 2)    para ventas
   
   Esta es LA fórmula canónica que usa recalcularLotesYGanancias (línea ~3611).
   
   Categorías de discrepancia:
     - exact:        100% coincidencia (centavo a centavo)
     - tolerance:    discrepancia ≤0.01 USDT (redondeo aceptable)
     - small:        0.01 < discrepancia ≤0.10 USDT (sospechoso pero menor)
     - significant:  discrepancia >0.10 USDT (PRESERVAR comisionPlataforma)
     - missing-pct:  op sin comisionPct (legacy, fórmula no aplicable)
     - missing-cp:   op sin comisionPlataforma (campo ausente)
     - invalid:      datos malformados (tasa<=0, monto<=0, etc)
   
   Verdict:
     - SAFE-TO-STRIP: si todas las ops son exact o tolerance
     - DO-NOT-STRIP:  si hay ANY small/significant/missing-pct */
/* ════════════════════════════════════════════════════════════════
   §AUDITORÍA SPLITS v4.7.59 — Detectar ops con split corrupto
   ════════════════════════════════════════════════════════════════
   Investiga si existen operaciones con aportes corruptos por el bug
   de "fila de split con banco vacío" que pudo haberse disparado en
   versiones anteriores. Detecta:
     - ops con campo aportes presente pero algún aporte sin banco
     - ops con campo aportes pero algún banco no existe en CONFIG
     - ops sin aportes que parecen incoherentes (saldo banco insuficiente
       en momento de la op vs monto, indicio de que faltó split)

   Pura LECTURA — no muta nada. Devuelve un reporte para revisar.
   Es herramienta de diagnóstico, no de fix automático. El usuario
   decide qué hacer con las ops detectadas (editar manual o borrar+rehacer).
   ════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════
   §AUDITORÍA COMPRESIÓN WIRE v4.7.63
   ════════════════════════════════════════════════════════════════
   Verifica que cada operación en memoria puede comprimirse y
   descomprimirse sin pérdida. Pura lectura — no modifica nada.
   
   Reporta:
     - cuántas ops pasaron el round-trip exacto
     - cuántas tienen diff en algún campo crítico (y cuál)
     - ahorro proyectado de tamaño
   ════════════════════════════════════════════════════════════════ */




/* ═══════════════════════════════════════════════════════════════════
   §PAYLOAD-AUDIT — Análisis exhaustivo de qué pesa en el documento
   ═══════════════════════════════════════════════════════════════════
   Mide tamaños reales (no estimaciones) de cada sección del payload.
   Útil para identificar campos inflados, datos derivados accidentalmente
   persistidos, arrays repetidos, metadata UI persistida, etc.
   
   Costo: ~30-100ms en mobile (un JSON.stringify por sección). Se ejecuta
   bajo demanda desde el panel de diagnóstico, no en cada save. */
/* Botón "Forzar sync" seguro:
   - Si hay debounce pendiente → flush ahora
   - Si _guardando es true → no hacer nada (ya está corriendo)
   - Si hay items en _syncQueue pero nada corriendo → disparar guardarDatos
   No duplica writes, no fuerza estado vacío, no toca _localVersion. */
/* hasPendingLocal() retirada en v5.2.5: quedó sin usos al retirar el modelo v1. */
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