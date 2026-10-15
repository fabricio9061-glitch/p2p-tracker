/* Últimas N versiones del registro de cambios, para el centro de novedades */
function normalizarChangelog(){
    return CHANGELOG.slice(0,CHANGELOG_MAX_ENTRIES);
}

/* ═══════════════════════════════════════
   §2 — ESTADO CENTRALIZADO
   ═══════════════════════════════════════ */
const AppState = {
    db: null, auth: null, currentUser: null, unsubscribe: null,
    datos: null,
    _localVersion: 0,
    _datosStale: false,
    /* Estado de la pantalla: qué se está viendo y los filtros elegidos.
       No se guarda en ningún lado. */
    ui: { tab:'inicio', syncState:'offline',
          registro:{tipo:'todo',periodo:'mes',cuenta:'',buscar:'',dia:'',limite:60},
          tagPeriodo:'mes' }
};

function crearDatosVacios() {
    /* v6.8.2 — ajustesSaldo faltaba acá: tras un reseteo o una restauración
       quedaba sin definir y la app tenía que crearlo sobre la marcha. */
    return {operaciones:[],movimientos:[],transferencias:[],conversiones:[],ajustesSaldo:[],bancos:{},lotes:[],tags:[],tasasRecientes:[],
            saldoUsdt:0,ultimaTasaCompra:0,ultimaTasaVenta:0,comisionPlataforma:0.14,
            ultimaTasaCompraUSD:0,ultimaTasaVentaUSD:0,comisionUSD:0.14,ultimoMesProcesado:'',_version:0,
            lastSeenVersion:'',dismissedVersions:[],
            /* v5.2.2 — Explícitos en null: si no figuran, el reseteo no puede
               limpiarlos y los lotes de arrastre reaparecen con su saldo USDT. */
            _archivoCarryover:null,_archivoSeeds:null,_archivoIndex:null,
            /* v8.0.0 — Lo borrado en los últimos 30 días, para poder recuperarlo */
            eliminados:[]};
}
AppState.datos = crearDatosVacios();

/* ═══════════════════════════════════════
   §3 — HELPERS DOM
   ═══════════════════════════════════════ */
const $ = id => document.getElementById(id);
const setText = (id, t) => { const e=$(id); if(e) e.textContent=t; };

function setSyncStatus(s,t) {
    const el=$('syncStatus');
    const antes=AppState.ui.syncState;
    AppState.ui.syncState=s;
    /* v8.0.3 — Si se corta o vuelve la conexión, el detalle abierto lo dice */
    if(antes!==s&&typeof refrescarEstadoDetalles==='function'){try{refrescarEstadoDetalles()}catch(_){}}
    if(!el)return;
    const labels={online:'Todo guardado',offline:'Sin conexión: se guarda al volver',syncing:'Guardando…',reconnecting:'Reconectando…'};
    el.className='sync '+s;
    let lbl=t||labels[s]||s;
    if(s==='online'&&AppState._restoredFrom&&!t){
        const map={'backup-empty-remote':'Restaurado','backup-no-remote':'Restaurado','manual-backup':'Respaldo restaurado','manual-import':'Copia importada'};
        lbl=map[AppState._restoredFrom]||labels.online;
    }
    setText('syncText',lbl);
}

/* ═══ Reconnect Firebase sin recargar ═══ */
async function reconnectFirebase(){
    if(AppState.ui.syncState==='reconnecting')return;
    setSyncStatus('reconnecting');
    /* Marcar datos como stale ANTES de reconectar — bloquea escrituras hasta recibir datos frescos */
    AppState._datosStale=true;
    const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),12000));
    try{
        await Promise.race([timeout,(async()=>{
            if(AppState.unsubscribe){AppState.unsubscribe();AppState.unsubscribe=null}
            if(AppState.db){try{await AppState.db.enableNetwork()}catch(e){}}
            const user=AppState.auth?.currentUser;
            if(user){
                try{await user.getIdToken(true)}catch(e){}
                showApp(user);
            }else{
                await new Promise((res,rej)=>{const unsub=AppState.auth.onAuthStateChanged(u=>{unsub();u?res(showApp(u)):rej(new Error('no-auth'))},rej)});
            }
            /* Esperar a que el snapshot entregue datos frescos del server (no cache) */
            await new Promise((res,rej)=>{
                const t=setTimeout(()=>{rej(new Error('sync-timeout'))},8000);
                const check=setInterval(()=>{
                    if(!AppState._datosStale){clearInterval(check);clearTimeout(t);res()}
                },200);
            });
        })()]);
    }catch(e){
        const msg=e.message==='timeout'||e.message==='sync-timeout'?'La conexión está lenta: se guarda al volver':'No se pudo reconectar: tocá para reintentar';
        if(e.message==='sync-timeout'){
            /* Si el timeout es de sync pero la conexión se restableció, desbloquear de todas formas */
            AppState._datosStale=false;
            console.warn('[P2P] Sync timeout, desbloqueando escrituras con datos disponibles');
        }
        setSyncStatus(navigator.onLine?'online':'offline',msg);
    }
}

/* ═══ Detectar conectividad ═══ */
function inicializarConectividad(){
    window.addEventListener('online',()=>{
        if(!AppState.currentUser)return;
        /* Al volver online, intentar reconectar Firebase y vaciar cualquier cambio pendiente
           que quedó diferido por estar offline. El snapshot re-sincronizará el servidor. */
        if(AppState.ui.syncState==='offline')reconnectFirebase();
        /* Si quedó pending local por offline, re-disparar guardado con debounce */
        if(_syncQueue.length>0)guardaOptimista('resync','pending','online');
        /* Reevaluar el estado del badge: si la red ya está OK, no debe quedar 
           "Error al reconectar" pegado de un evento viejo. */
        if(typeof _syncLog==='function')_syncLog('connectivity:online',{queue:_syncQueue.length});
        setTimeout(()=>{
            if(typeof repairOrphanPendingStates==='function')repairOrphanPendingStates();
            if(typeof reevaluarEstadoSync==='function')reevaluarEstadoSync();
        },500);
    });
    window.addEventListener('offline',()=>{
        if(typeof _syncLog==='function')_syncLog('connectivity:offline',{});
        setSyncStatus('offline');
    });
    /* ═══ Safety net periódico ═══
       Cada 30s, si la app está en foreground, re-evaluamos el estado real de sync.
       Esto cubre el caso donde una transición de estado se perdió por algún motivo
       (background tabs en mobile, browser throttling, etc). Costo: <1ms cada 30s.
       Solo limpia errores residuales si el sistema YA está en estado sano. */
    setInterval(()=>{
        if(!AppState.currentUser)return;
        if(document.visibilityState!=='visible')return;
        if(typeof reevaluarEstadoSync==='function')reevaluarEstadoSync();
    },30000);
    /* Flush del debounce al perder foco — evita que cambios queden en buffer al cerrar pestaña/app */
    document.addEventListener('visibilitychange',()=>{
        if(document.visibilityState==='hidden'&&AppState.currentUser)flushGuardaDebounce();
        else if(document.visibilityState==='visible'&&AppState.currentUser){
            /* Al volver a foreground, reevaluar — el estado pudo cambiar mientras estuvimos hidden */
            if(typeof reevaluarEstadoSync==='function')reevaluarEstadoSync();
        }
    });
    window.addEventListener('beforeunload',()=>{
        if(AppState.currentUser)flushGuardaDebounce();
    });
    window.addEventListener('pagehide',()=>{
        if(AppState.currentUser)flushGuardaDebounce();
    });
}
