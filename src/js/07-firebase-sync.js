function renderizarInventario(){
    const la=getLotesActivosFIFO();
    if(!la.length){setHtml('inventarioContent','<div style="text-align:center;padding:30px;color:#94a3b8"><div style="font-size:2em;margin-bottom:8px">📭</div><div>Sin USDT en inventario</div></div>');return}
    let tot=0,h='';
    la.forEach((l,i)=>{tot=truncar(tot+l.disponible,2);const mon=l.moneda||'UYU',sy=mon==='USD'?'US$':'$',v=roundMoney(l.disponible*l.precioCompra,2);
        const tag=l.manual?'<span style="display:inline-block;font-size:0.6em;background:#e0e7ff;color:#4338ca;padding:1px 5px;border-radius:4px;font-weight:600;vertical-align:middle;margin-left:4px;letter-spacing:0.3px">manual</span>':'';
        h+=`<div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;padding:13px 0;${i>0?'border-top:1px solid #f1f5f9':''}">
            <div style="min-width:0">
                <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
                    <span style="font-size:0.88em;font-weight:700;color:#2563eb">${fmtTrunc(l.disponible,2)} USDT</span>
                    <span style="font-size:0.7em;color:#94a3b8;font-weight:500">#${i+1}${tag}</span>
                </div>
                <div style="display:flex;gap:10px;margin-top:3px;font-size:0.72em;color:#64748b">
                    <span>Precio: <b style="color:#475569">${sy}${fmtNum(l.precioCompra,mon==='USD'?3:2)}</b></span>
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
const _SYNC_QUEUE_MAX=500;/* Cap defensivo: en escenarios offline largos, la queue 
   podría crecer sin tope. 500 es 10x más de lo que un usuario real genera 
   en una sesión típica — suficiente como red de seguridad sin perder casos reales. */
function enqueueSync(type,entity,id){
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
function auditarCompresionWire(){
    const ops=Array.isArray(AppState.datos.operaciones)?AppState.datos.operaciones:[];
    const result={
        totalOps:ops.length,
        roundtripOk:0,
        diffsPorCampo:{},
        opsConDiff:[],
        bancoNoMapeado:[],
        tipoNoMapeado:[],
        monedaNoMapeado:[],
        sizeBefore:0,
        sizeAfter:0,
        savingsKB:0,
        verdict:'unknown'
    };
    const camposCriticos=['id','fecha','hora','tipo','banco','moneda','monto','tasa','usdt','comisionBanco'];
    ops.forEach(op=>{
        /* Verificar mapeos antes de comprimir */
        if(op.banco&&!(op.banco in WIRE_BANCO_TO_INT)){
            result.bancoNoMapeado.push({id:op.id,banco:op.banco});
        }
        if(op.tipo&&!(op.tipo in WIRE_TIPO_TO_INT)){
            result.tipoNoMapeado.push({id:op.id,tipo:op.tipo});
        }
        if(op.moneda&&!(op.moneda in WIRE_MONEDA_TO_INT)){
            result.monedaNoMapeado.push({id:op.id,moneda:op.moneda});
        }
        /* Round-trip */
        const c=_compressOpForWire(op);
        const r=_decompressOpFromWire(c);
        let ok=true;
        const diffsLocal=[];
        camposCriticos.forEach(k=>{
            if(op[k]!==undefined&&op[k]!==r[k]){
                ok=false;
                diffsLocal.push({campo:k,antes:op[k],despues:r[k]});
                result.diffsPorCampo[k]=(result.diffsPorCampo[k]||0)+1;
            }
        });
        /* comisionPct: tolerancia (puede haberse omitido por default) */
        if(op.comisionPct!==undefined){
            const diff=Math.abs(op.comisionPct-r.comisionPct);
            if(diff>WIRE_COMISION_PCT_EPS+0.0001){
                ok=false;
                diffsLocal.push({campo:'comisionPct',antes:op.comisionPct,despues:r.comisionPct});
                result.diffsPorCampo.comisionPct=(result.diffsPorCampo.comisionPct||0)+1;
            }
        }
        if(ok)result.roundtripOk++;
        else if(result.opsConDiff.length<10)result.opsConDiff.push({id:op.id,diffs:diffsLocal});
    });
    /* Tamaño aproximado before/after */
    try{
        const sBefore=JSON.stringify(ops).length;
        const sAfter=JSON.stringify(ops.map(_compressOpForWire)).length;
        result.sizeBefore=sBefore;
        result.sizeAfter=sAfter;
        result.savingsKB=Math.round((sBefore-sAfter)/1024);
    }catch(e){/* no critical */}
    /* Veredicto */
    const totalProblems=result.bancoNoMapeado.length+result.tipoNoMapeado.length+
                        result.monedaNoMapeado.length+(result.totalOps-result.roundtripOk);
    if(totalProblems===0)result.verdict='SAFE-TO-COMPRESS';
    else result.verdict='ISSUES-DETECTED';
    _syncLog&&_syncLog('audit-wire:done',{
        verdict:result.verdict,
        roundtripOk:result.roundtripOk,
        total:result.totalOps,
        savingsKB:result.savingsKB
    });
    return result;
}

function auditarSplitsCorruptos(){
    const ops=Array.isArray(AppState.datos.operaciones)?AppState.datos.operaciones:[];
    const bancos=AppState.datos.bancos||{};
    const result={
        totalOps:ops.length,
        bancoVacio:[],
        bancoInexistente:[],
        aportesVacios:[],
        sumaIncorrecta:[],
        resumen:''
    };
    ops.forEach(op=>{
        if(!Array.isArray(op.aportes))return; /* op sin split, OK */
        let sumaAportes=0;
        let tieneBancoVacio=false;
        let bancosInexistentes=[];
        op.aportes.forEach((a,idx)=>{
            const m=Number(a&&a.monto)||0;
            sumaAportes+=m;
            if(!a||!a.banco){
                tieneBancoVacio=true;
            }else if(!bancos[a.banco]){
                bancosInexistentes.push(a.banco);
            }
        });
        const ref={id:op.id,fecha:op.fecha,hora:op.hora,tipo:op.tipo,
            monto:op.monto,banco:op.banco,aportes:op.aportes};
        if(tieneBancoVacio)result.bancoVacio.push(ref);
        if(bancosInexistentes.length>0){
            result.bancoInexistente.push({...ref,bancosFantasma:bancosInexistentes});
        }
        if(op.aportes.length===0)result.aportesVacios.push(ref);
        /* Suma de aportes vs monto: tolerar 0.01 por roundeos */
        if(op.tipo==='compra'){
            const totalEsperado=Number(op.monto)+Number(op.comisionBanco||0);
            if(Math.abs(sumaAportes-totalEsperado)>0.05){
                result.sumaIncorrecta.push({...ref,
                    sumaAportes:roundMoney(sumaAportes),
                    esperado:roundMoney(totalEsperado),
                    diferencia:roundMoney(sumaAportes-totalEsperado)});
            }
        }
    });
    const totalAnomalias=result.bancoVacio.length+result.bancoInexistente.length+
        result.aportesVacios.length+result.sumaIncorrecta.length;
    if(totalAnomalias===0){
        result.resumen=`✓ ${ops.length} operaciones revisadas. No se detectaron splits corruptos.`;
        result.verdict='CLEAN';
    }else{
        const partes=[];
        if(result.bancoVacio.length)partes.push(`${result.bancoVacio.length} con banco vacío`);
        if(result.bancoInexistente.length)partes.push(`${result.bancoInexistente.length} con banco inexistente`);
        if(result.aportesVacios.length)partes.push(`${result.aportesVacios.length} con aportes vacíos`);
        if(result.sumaIncorrecta.length)partes.push(`${result.sumaIncorrecta.length} con suma de aportes ≠ monto`);
        result.resumen=`⚠ ${totalAnomalias} operación(es) con anomalía: ${partes.join(', ')}`;
        result.verdict='ANOMALIES';
    }
    _syncLog&&_syncLog('audit-splits:done',{
        verdict:result.verdict,
        bancoVacio:result.bancoVacio.length,
        bancoInexistente:result.bancoInexistente.length,
        aportesVacios:result.aportesVacios.length,
        sumaIncorrecta:result.sumaIncorrecta.length
    });
    return result;
}


function auditarComisionPlataforma(){
    const ops=Array.isArray(AppState.datos.operaciones)?AppState.datos.operaciones:[];
    const result={
        totalOps:ops.length,
        exact:0,
        tolerance:0,
        small:0,
        significant:0,
        missingPct:0,
        missingCp:0,
        invalid:0,
        worstCases:[],
        legacyCases:[],
        verdict:'unknown',
        formula:'truncar(usdtBase × comisionPct/100, 2) donde usdtBase=roundMoney(m/t,2) para compras y truncar(m/t,2) para ventas',
        tiempoAnalisisMs:0
    };
    if(ops.length===0){result.verdict='no-ops';return result}
    const t0=performance.now();
    /* Funciones puras locales — evitar dependencia de helpers globales por si la auditoría
       se ejecuta en contextos donde estos pudieron redefinirse. */
    const _trunc=(n,d=2)=>{if(isNaN(n)||!isFinite(n))return 0;const f=Number(n+'e'+d);return Number(Math.floor(f)+'e-'+d)};
    const _round=(n,d=2)=>{if(isNaN(n)||!isFinite(n))return 0;const r=Number(Math.round(parseFloat(n+'e'+d))+'e-'+d);return Object.is(r,-0)?0:r};
    const _usdtBase=(n,tipo)=>tipo==='compra'?_round(n,2):_trunc(n,2);
    const discrepancias=[];
    ops.forEach((op,idx)=>{
        if(!op||typeof op!=='object'){result.invalid++;return}
        /* Datos inválidos: tasa<=0, monto inválido, etc. */
        if(!op.tasa||op.tasa<=0||!op.monto||op.monto<=0||!op.tipo){
            result.invalid++;
            return;
        }
        /* comisionPct ausente: legacy. NO podemos verificar derivabilidad. */
        if(op.comisionPct===undefined||op.comisionPct===null){
            result.missingPct++;
            if(result.legacyCases.length<5){
                result.legacyCases.push({
                    idx,id:safeIdTail(op.id,10),
                    fecha:op.fecha,tipo:op.tipo,
                    cpGuardada:op.comisionPlataforma,
                    razon:'sin comisionPct'
                });
            }
            return;
        }
        /* comisionPlataforma ausente: campo no fue persistido. */
        if(op.comisionPlataforma===undefined||op.comisionPlataforma===null){
            result.missingCp++;
            return;
        }
        /* Calcular el valor esperado con la fórmula canónica del FIFO replay */
        const cpct=op.comisionPct/100;
        const uBaseExpected=_usdtBase(op.monto/op.tasa,op.tipo);
        const cpExpected=_trunc(uBaseExpected*cpct,2);
        const cpGuardada=Number(op.comisionPlataforma)||0;
        const diff=Math.abs(cpGuardada-cpExpected);
        /* Categorizar la discrepancia */
        if(diff===0){
            result.exact++;
        }else if(diff<=0.01){
            result.tolerance++;
            /* Aún registramos algunos para inspección visual */
            if(discrepancias.length<20){
                discrepancias.push({idx,id:safeIdTail(op.id,10),diff,cpGuardada,cpExpected,
                                    monto:op.monto,tasa:op.tasa,usdt:op.usdt,comisionPct:op.comisionPct,
                                    fecha:op.fecha,tipo:op.tipo,category:'tolerance'});
            }
        }else if(diff<=0.10){
            result.small++;
            discrepancias.push({idx,id:safeIdTail(op.id,10),diff,cpGuardada,cpExpected,
                                monto:op.monto,tasa:op.tasa,usdt:op.usdt,comisionPct:op.comisionPct,
                                fecha:op.fecha,tipo:op.tipo,category:'small'});
        }else{
            result.significant++;
            discrepancias.push({idx,id:safeIdTail(op.id,10),diff,cpGuardada,cpExpected,
                                monto:op.monto,tasa:op.tasa,usdt:op.usdt,comisionPct:op.comisionPct,
                                fecha:op.fecha,tipo:op.tipo,category:'significant'});
        }
    });
    /* Ordenar discrepancias por magnitud descendente, quedarnos con las top 10 */
    result.worstCases=discrepancias.sort((a,b)=>b.diff-a.diff).slice(0,10);
    /* Verdict */
    const hasReal=result.significant>0||result.small>0||result.missingPct>0;
    if(hasReal){
        result.verdict='DO-NOT-STRIP';
        result.verdictReason=
            (result.significant>0?result.significant+' ops con discrepancia >0.10 USDT. ':'')+
            (result.small>0?result.small+' ops con discrepancia 0.01-0.10 USDT. ':'')+
            (result.missingPct>0?result.missingPct+' ops legacy sin comisionPct (no podemos derivar). ':'');
    }else if(result.exact===0&&result.tolerance===0){
        result.verdict='INSUFFICIENT-DATA';
        result.verdictReason='No hay ops verificables (todas inválidas o sin comisionPlataforma)';
    }else{
        result.verdict='SAFE-TO-STRIP';
        result.verdictReason='Todas las ops verificables coinciden con la fórmula (exact: '+result.exact+', tolerance: '+result.tolerance+')';
    }
    result.tiempoAnalisisMs=Math.round(performance.now()-t0);
    return result;
}

/* ═══════════════════════════════════════════════════════════════════
   §PAYLOAD-AUDIT — Análisis exhaustivo de qué pesa en el documento
   ═══════════════════════════════════════════════════════════════════
   Mide tamaños reales (no estimaciones) de cada sección del payload.
   Útil para identificar campos inflados, datos derivados accidentalmente
   persistidos, arrays repetidos, metadata UI persistida, etc.
   
   Costo: ~30-100ms en mobile (un JSON.stringify por sección). Se ejecuta
   bajo demanda desde el panel de diagnóstico, no en cada save. */
function analizarPayload(datos){
    if(!datos||typeof datos!=='object')return null;
    const t0=performance.now();
    const result={
        totalKB:0,
        remoteKB:0,
        savedByStripKB:0,
        savedByStripPct:0,
        secciones:{},
        topKeys:[],
        topOperaciones:[],
        avgBytesPerOp:0,
        cantidadOps:0,
        flags:{},
        memUsedMB:null,
        tiempoStringifyMs:0
    };
    /* Tamaño raw total */
    const tStringify=performance.now();
    let rawJson='';
    try{rawJson=JSON.stringify(datos)}catch(e){return{error:'serializacion-fallo',msg:e.message}}
    result.tiempoStringifyMs=Math.round(performance.now()-tStringify);
    result.totalKB=Math.round(rawJson.length/1024);
    /* ═══ v4.7.41: medir tamaño REAL del payload remoto ═══
       Hasta v4.7.40, el panel reportaba el tamaño de AppState.datos (estado local).
       Pero AppState.datos local SIEMPRE tiene lotes, saldoUsdt, ganancia, consumedLots
       porque recalcularLotesYGanancias los reconstruye. El payload remoto NO los lleva.
       
       Ahora simulamos el strip exacto que guardarDatos aplica:
         - Per-op: _syncState, consumedLots, ganancia
         - Top-level: lotes, saldoUsdt
       Y medimos el resultado. Eso es lo que realmente sube a Firestore. */
    try{
        const stripPerOp=arr=>Array.isArray(arr)?arr.map(x=>{
            if(!x||typeof x!=='object')return x;
            const{_syncState,consumedLots,ganancia,comisionPlataforma,...rest}=x;
            return rest;
        }):arr;
        const stripRuntimeOnly=arr=>Array.isArray(arr)?arr.map(x=>{
            if(!x||typeof x!=='object'||!x._syncState)return x;
            const{_syncState,...rest}=x;
            return rest;
        }):arr;
        const simulado={
            ...datos,
            operaciones:stripPerOp(datos.operaciones),
            movimientos:stripRuntimeOnly(datos.movimientos),
            transferencias:stripRuntimeOnly(datos.transferencias),
            conversiones:stripRuntimeOnly(datos.conversiones||[])
        };
        delete simulado.lotes;
        delete simulado.saldoUsdt;
        const remoteJson=JSON.stringify(simulado);
        result.remoteKB=Math.round(remoteJson.length/1024);
        result.savedByStripKB=Math.max(0,result.totalKB-result.remoteKB);
        result.savedByStripPct=result.totalKB>0?Math.round(100*result.savedByStripKB/result.totalKB):0;
    }catch(e){result.remoteKB=0}
    /* Tamaño por sección de primer nivel */
    Object.keys(datos).forEach(key=>{
        try{
            const val=datos[key];
            const json=JSON.stringify(val);
            const kb=Math.round(json.length/1024);
            const bytes=json.length;
            result.secciones[key]={
                bytes,
                kb,
                pctTotal:rawJson.length?Math.round(100*bytes/rawJson.length):0,
                tipo:Array.isArray(val)?'array':typeof val,
                len:Array.isArray(val)?val.length:(val&&typeof val==='object'?Object.keys(val).length:1)
            };
        }catch(e){/* skip */}
    });
    /* Top 20 keys por bytes */
    result.topKeys=Object.entries(result.secciones)
        .sort((a,b)=>b[1].bytes-a[1].bytes)
        .slice(0,20)
        .map(([k,v])=>({key:k,kb:v.kb,pct:v.pctTotal,len:v.len,tipo:v.tipo}));
    /* Análisis específico de operaciones */
    const ops=datos.operaciones||[];
    result.cantidadOps=ops.length;
    if(ops.length>0){
        let totalOpsBytes=0;
        const opSizes=[];
        const fieldFreq={};
        const fieldBytes={};
        ops.forEach((op,i)=>{
            try{
                const js=JSON.stringify(op);
                totalOpsBytes+=js.length;
                opSizes.push({idx:i,id:op&&op.id,bytes:js.length});
                /* Contar uso de cada campo y bytes acumulados */
                if(op&&typeof op==='object'){
                    Object.keys(op).forEach(k=>{
                        fieldFreq[k]=(fieldFreq[k]||0)+1;
                        try{
                            const fb=JSON.stringify(op[k]).length+k.length+4; /* "k":v, */
                            fieldBytes[k]=(fieldBytes[k]||0)+fb;
                        }catch(e){}
                    });
                }
            }catch(e){}
        });
        result.avgBytesPerOp=Math.round(totalOpsBytes/ops.length);
        /* Top 10 operaciones más pesadas */
        result.topOperaciones=opSizes.sort((a,b)=>b.bytes-a.bytes).slice(0,10)
            .map(o=>({id:safeIdTail(o.id,10),bytes:o.bytes,kb:Math.round(o.bytes/100)/10}));
        /* Top campos dentro de operaciones por bytes acumulados */
        result.campoOpsTop=Object.entries(fieldBytes)
            .sort((a,b)=>b[1]-a[1])
            .slice(0,15)
            .map(([k,b])=>({campo:k,bytesTotal:b,kbTotal:Math.round(b/1024),
                            freq:fieldFreq[k],pct:totalOpsBytes?Math.round(100*b/totalOpsBytes):0}));
        /* Detección de duplicación: si un campo de string aparece miles de veces 
           con valores repetidos, podría compactarse */
        const stringRepetitions={};
        ops.forEach(op=>{
            if(!op||typeof op!=='object')return;
            Object.keys(op).forEach(k=>{
                const v=op[k];
                if(typeof v==='string'&&v.length>2){
                    if(!stringRepetitions[k])stringRepetitions[k]={};
                    stringRepetitions[k][v]=(stringRepetitions[k][v]||0)+1;
                }
            });
        });
        /* Top valores repetidos: campo:valor con cuántas veces aparece */
        const repTop=[];
        Object.entries(stringRepetitions).forEach(([campo,valores])=>{
            Object.entries(valores).forEach(([v,count])=>{
                if(count>=10){
                    repTop.push({campo,valor:v.slice(0,30),count,bytesGastadosUnnecesarios:count*v.length});
                }
            });
        });
        result.valoresRepetidos=repTop.sort((a,b)=>b.bytesGastadosUnnecesarios-a.bytesGastadosUnnecesarios).slice(0,10);
    }
    /* ═══ v4.7.41: flags ahora distinguen "local enriquecido" (esperado) de 
       "problemas reales" (algo que está mal). 
       
       AppState.datos local SIEMPRE tiene lotes/saldoUsdt/ganancia/consumedLots después
       de recalcular — eso es por diseño. Marcar esos como ⚠ era falso positivo.
       
       Problemas reales que sí marcamos:
         - syncStateOrphans: items con _syncState pending sin razón
         - tasasRecientes/dismissedVersions inflados (acumulación sin limpiar)
         - tagsLen muy grande (acumulación) */
    result.flags.tieneLotesLocal=Array.isArray(datos.lotes)&&datos.lotes.length>0;
    result.flags.tieneLotesKB=result.secciones.lotes?result.secciones.lotes.kb:0;
    result.flags.tieneSaldoUsdtLocal=datos.saldoUsdt!==undefined;
    result.flags.tieneTasasRecientes=Array.isArray(datos.tasasRecientes)&&datos.tasasRecientes.length>0;
    result.flags.tasasRecientesLen=result.flags.tieneTasasRecientes?datos.tasasRecientes.length:0;
    result.flags.dismissedVersionsLen=Array.isArray(datos.dismissedVersions)?datos.dismissedVersions.length:0;
    result.flags.tagsLen=Array.isArray(datos.tags)?datos.tags.length:0;
    /* Detección de campos _syncState que NO deberían haberse persistido */
    let syncStateOrphans=0;
    ['operaciones','movimientos','transferencias','conversiones'].forEach(k=>{
        const arr=datos[k]||[];
        arr.forEach(item=>{if(item&&item._syncState)syncStateOrphans++});
    });
    result.flags.syncStateOrphans=syncStateOrphans;
    /* Memoria del heap (Chrome/Edge/Brave) */
    try{
        if(performance.memory&&performance.memory.usedJSHeapSize){
            result.memUsedMB=Math.round(performance.memory.usedJSHeapSize/1024/1024);
            result.memLimitMB=Math.round(performance.memory.jsHeapSizeLimit/1024/1024);
        }
    }catch(e){}
    result.tiempoAnalisisMs=Math.round(performance.now()-t0);
    /* ═══ Veredicto basado en payload REMOTO (lo que realmente sube a Firestore) ═══
       Antes (v4.7.40-): el verdict usaba totalKB (state local), reportando "Crítico"
       aunque el payload remoto fuera mucho más chico. Ahora usa remoteKB. */
    const judgeKB=result.remoteKB||result.totalKB;
    if(judgeKB<700)result.estado='✓ Seguro';
    else if(judgeKB<850)result.estado='⚠ Alto';
    else if(judgeKB<950)result.estado='⚠⚠ Muy alto';
    else result.estado='🛑 Crítico (cerca del límite 1MB)';
    return result;
}
function getSyncDiagnostics(){
    return {
        version:CONFIG.APP_VERSION,
        online:navigator.onLine,
        syncState:AppState.ui.syncState||'unknown',
        localVersion:AppState._localVersion,
        dataVersion:(AppState.datos&&AppState.datos._version)||0,
        localDirty:_localDirty,
        syncQueueSize:_syncQueue.length,
        syncQueueSample:_syncQueue.slice(0,5),
        guardando:_guardando,
        guardarPendiente:_guardarPendiente,
        syncPending:_syncPending,
        syncErrors:_syncErrors,
        retryDelay:_retryDelay,
        retryActive:_retryTimer!==null&&_retryTimer!==undefined,
        debounceActive:_guardaDebounceTimer!==null,
        listenerActive:AppState.unsubscribe!==null,
        recoveryActive:!!(typeof iniciarRecuperacionFirestore!=='undefined'&&iniciarRecuperacionFirestore._activa),
        clientTerminated:!!AppState._clientTerminated,
        clientTerminatedAt:AppState._clientTerminatedAt||null,
        restoredFrom:AppState._restoredFrom,
        datosStale:AppState._datosStale,
        postRestoreLockExpires:AppState._postRestoreLockTs?new Date(AppState._postRestoreLockTs).toISOString():null,
        logTail:_syncLogRing.slice(-30).map(e=>({...e,ts:new Date(e.ts).toISOString()}))
    };
}
/* Botón "Forzar sync" seguro:
   - Si hay debounce pendiente → flush ahora
   - Si _guardando es true → no hacer nada (ya está corriendo)
   - Si hay items en _syncQueue pero nada corriendo → disparar guardarDatos
   No duplica writes, no fuerza estado vacío, no toca _localVersion. */
async function forzarSyncManual(){
    if(!AppState.currentUser){
        _syncLog('manual-sync:no-user');
        return{ok:false,reason:'No hay sesión activa'};
    }
    /* v4.7.42: si el cliente está terminado, "Forzar sync" no puede hacer nada útil.
       Solo recargar la app reinicializa el SDK. Mostrar el banner si no está visible. */
    if(AppState._clientTerminated){
        try{if(typeof mostrarBannerClienteTerminado==='function')mostrarBannerClienteTerminado()}catch(_){}
        return{ok:false,reason:'Firebase quedó en estado inválido. Recargá la app para reactivar.'};
    }
    if(typeof iniciarRecuperacionFirestore!=='undefined'&&iniciarRecuperacionFirestore._activa){
        return{ok:false,reason:'Recovery en progreso — esperá a que termine'};
    }
    _syncLog('manual-sync:start',{queueSize:_syncQueue.length,guardando:_guardando,dirty:_localDirty});
    /* 1. Flush del debounce si está pendiente */
    if(_guardaDebounceTimer){
        clearTimeout(_guardaDebounceTimer);
        _guardaDebounceTimer=null;
        _guardaFirstPendingTs=0;
    }
    /* 2. Cancelar retry y arrancar limpio (reset del circuit breaker) */
    clearTimeout(_retryTimer);
    _retryTimer=null;
    _syncErrors=0;
    _retryDelay=2000;
    updateSyncBadge();
    /* 3. Detección de deadlock: si _guardando lleva >60s sin completar, está colgado.
       Causa típica: un setTimeout viejo, promise huérfana, o el SDK bloqueado.
       Forzamos reset para que el siguiente intento pueda arrancar. */
    if(_guardando){
        const lastStart=_syncLogRing.slice().reverse().find(e=>e.event==='save:start');
        const stuckMs=lastStart?Date.now()-lastStart.ts:0;
        if(stuckMs>60000){
            _syncLog('manual-sync:deadlock-detected',{stuckSeconds:Math.round(stuckMs/1000)});
            console.warn('[P2P] Deadlock detectado: _guardando=true por '+Math.round(stuckMs/1000)+'s. Reseteando flags.');
            _guardando=false;
            _guardarPendiente=false;
            _syncPending=0;
            updateSyncBadge();
        }else{
            _syncLog('manual-sync:already-running',{stuckSeconds:Math.round(stuckMs/1000)});
            return{ok:true,reason:'Sync ya está en progreso (hace '+Math.round(stuckMs/1000)+'s) — esperá'};
        }
    }
    /* 4. Si hay nada que sincronizar, NO disparar tx innecesario */
    if(_syncQueue.length===0&&_localDirty===0){
        _syncLog('manual-sync:nothing-to-sync');
        return{ok:true,reason:'Todo está sincronizado'};
    }
    /* 5. Disparar el sync */
    try{
        await guardarDatos();
        _syncLog('manual-sync:done');
        return{ok:true,reason:'Sync ejecutado'};
    }catch(e){
        _syncLog('manual-sync:error',{err:e.message||e.code||'unknown'});
        return{ok:false,reason:'Error: '+(e.message||e.code||'desconocido')};
    }
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