/* ═══════════════════════════════════════
   §16 — REINICIAR DATOS
   ═══════════════════════════════════════ */
/* Borra en tandas todos los documentos de una subcolección del usuario */
async function _vaciarSubcoleccion(nombre){
    const ref=AppState.db.collection('users').doc(AppState.currentUser.uid).collection(nombre);
    const snap=await ref.get();
    const ids=[];snap.forEach(d=>ids.push(d.id));
    for(let i=0;i<ids.length;i+=400){
        const b=AppState.db.batch();
        ids.slice(i,i+400).forEach(id=>b.delete(ref.doc(id)));
        await b.commit();
    }
    return ids.length;
}
/* Borra todo lo de la cuenta. La pantalla pide la confirmación antes (dos veces). */
async function borrarTodo(){
    {
        try{
            AppState.datos=crearDatosVacios();AppState._localVersion=0;AppState._datosStale=false;
            inicializarBancos();
            /* v4.7.65 FIX (B1): limpiar el backup local ANTES de guardar. Sin esto, el
               blindaje anti-wipe de guardarDatos aborta el write (estado vacío + backup con
               datos) y el próximo snapshot restaura los datos viejos por Branch 1 → el reset
               "no funcionaba". El guard anti-wipe sigue intacto para todos los demás writes. */
            try{
                if(AppState.currentUser){
                    localStorage.removeItem('p2p_backup_'+AppState.currentUser.uid);
                    localStorage.removeItem('p2p_backup_'+AppState.currentUser.uid+'_prev');
                }
            }catch(_){}
            if(typeof backupToLocal==='function')backupToLocal._lastSig=null;
            /* v5.2.2 — En el modelo v2 cada operación es un documento propio: un
               guardado normal escribe solo el estado y los eventos quedarían en
               Firestore, volviendo con el siguiente snapshot. La subida total deja
               la subcolección igual a la memoria (vacía), o sea que los borra. */
            try{
                if(AppState.currentUser){
                    localStorage.removeItem('p2p_v2count_'+AppState.currentUser.uid);
                    localStorage.removeItem('p2p_archivo_snooze_'+AppState.currentUser.uid);
                }
            }catch(_){}
            /* v8.0.1 — Lo pendiente y las copias automáticas también se van */
            _syncQueue.length=0;guardarColaLocal();
            try{borrarCopias()}catch(_){}
            if(AppState._schema===2&&window._v2sync&&typeof window._v2sync.subirTodo==='function'){
                await window._v2sync.subirTodo();
            }else{
                /* forzar=true → saltea el guard anti-wipe SOLO en esta acción explícita y doble-confirmada */
                await guardarDatos(true);
            }
            /* v7.3.0 — El historial archivado y los resúmenes también se borran. Si
               quedaban, el índice del archivo se reconstruía desde ellos y la
               historia vieja volvía a aparecer después de resetear. */
            try{await _vaciarSubcoleccion('archivo');await _vaciarSubcoleccion('monthly_summaries')}
            catch(e){console.warn('[P2P] No se pudo borrar el archivo:',e&&e.message)}
            try{localStorage.removeItem('p2p_archivo_'+AppState.currentUser.uid)}catch(_){}
            recalcularLotesYGanancias();
            actualizarVista();
            return true;
        }catch(e){console.error('[P2P] Error reiniciando datos:',e);return false}
    }
}

/* ═══════════════════════════════════════
   §17B — RESTAURACIÓN MANUAL + EXPORT/IMPORT JSON
   ═══════════════════════════════════════ */
/* v8.0.1 — "Restaurar el último respaldo" se reemplazó por las copias
   automáticas (24-copias.js): reemplazaba todo y borraba de la nube lo que no
   estuviera en el respaldo. Recuperar de una copia solo agrega lo que falta. */
/* Helper común: aplica un objeto datos al estado, rotando el actual a _prev */
async function _aplicarRespaldo(datos,origen){
    try{
        /* Backup defensivo del estado actual antes de sobreescribir */
        if(!esDatosVacios(AppState.datos)){
            try{
                const cur=localStorage.getItem('p2p_backup_'+AppState.currentUser.uid);
                if(cur)localStorage.setItem('p2p_backup_'+AppState.currentUser.uid+'_prev',cur);
            }catch(e){}
        }
        AppState.datos=datos;
        try{normalizarHistoriales(AppState.datos)}catch(_){}
        AppState._localVersion=0;
        AppState._restoredFrom=origen.includes('importado')?'manual-import':'manual-backup';
        AppState._datosStale=false;
        inicializarBancos();
        /* ═══ Recalcular diferido ═══
           El backup ya contiene op.ganancia y lotes consistentes (fueron persistidos así).
           El recalc es defensivo (cubre cambios de schema/legacy migration) pero no es 
           estrictamente necesario para que la UI funcione. Lo deferimos a idle para que el 
           usuario vea sus datos restaurados al instante.
           
           sincronizarSaldoUsdt corre síncrono (es rápido y crítico para mostrar saldos). */
        if(typeof sincronizarSaldoUsdt==='function')sincronizarSaldoUsdt();
        AppState.ui.paginaOp=1;AppState.ui.paginaMov=1;AppState.ui.paginaTrans=1;AppState.ui.paginaConv=1;
        actualizarVista();
        const runDeferredRecalc=()=>{
            try{
                recalcularLotesYGanancias();
                if(typeof actualizarVistaDebounced==='function')actualizarVistaDebounced();
            }catch(e){console.error('[P2P] recalc post-restore falló:',e)}
        };
        if(typeof requestIdleCallback==='function'){
            requestIdleCallback(runDeferredRecalc,{timeout:1500});
        }else{
            setTimeout(runDeferredRecalc,50);
        }
        /* v5.1.0 — En el modelo v2 los eventos son documentos propios: un guardado
           normal escribiría SOLO el documento de estado y los eventos del respaldo
           nunca llegarían al servidor. La subida total reemplaza la subcolección
           entera para que coincida con lo restaurado. */
        if(AppState._schema===2&&window._v2sync&&typeof window._v2sync.subirTodo==='function'){
            const r=await window._v2sync.subirTodo();
            console.log('[P2P] respaldo aplicado en v2:',r);
        }else{
            await guardarDatos(true);
        }
        alert(`Datos restaurados.\n\n`
            +`Origen: ${origen}\n`
            +`Operaciones: ${(datos.operaciones||[]).length}\n`
            +`Bancos activos: ${Object.values(datos.bancos||{}).filter(b=>b&&b.activo).length}\n\n`
            +`Los datos fueron sincronizados con Firebase.`);
    }catch(e){
        console.error('[P2P] Error aplicando respaldo:',e);
        alert('No se pudo restaurar: '+(e.message||e.code||'error desconocido'));
    }
}

/* Exportar — descarga JSON con todo el estado actual */
function exportarDatos(){
    if(!AppState.currentUser){alert('No hay usuario activo');return}
    if(esDatosVacios(AppState.datos)){
        if(!confirm('No hay datos para exportar. ¿Exportar igual un archivo vacío?'))return;
    }
    try{
        const uname=emailToUser(AppState.currentUser.email);
        const payload={
            _meta:{
                app:'P2P Tracker',
                version:CONFIG.APP_VERSION,
                exported_at:new Date().toISOString(),
                user:uname,
                uid:AppState.currentUser.uid,
                counts:{
                    operaciones:(AppState.datos.operaciones||[]).length,
                    movimientos:(AppState.datos.movimientos||[]).length,
                    transferencias:(AppState.datos.transferencias||[]).length,
                    conversiones:(AppState.datos.conversiones||[]).length,
                    lotes:(AppState.datos.lotes||[]).length,
                    bancosActivos:Object.values(AppState.datos.bancos||{}).filter(b=>b&&b.activo).length
                }
            },
            datos:AppState.datos
        };
        const json=JSON.stringify(payload,null,2);
        const blob=new Blob([json],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        const fechaStr=new Date().toISOString().slice(0,10);
        a.href=url;a.download=`p2p-backup-${uname}-${fechaStr}.json`;
        document.body.appendChild(a);a.click();document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setTimeout(()=>alert(`Respaldo exportado.\n\n`
            +`Archivo: p2p-backup-${uname}-${fechaStr}.json\n`
            +`Operaciones: ${payload._meta.counts.operaciones}\n`
            +`Movimientos: ${payload._meta.counts.movimientos}\n\n`
            +`Guardalo en un lugar seguro (email, Drive, etc.).\n`
            +`Podrás importarlo cuando lo necesites con "Importar datos".`),100);
    }catch(e){
        console.error('[P2P] Error exportando:',e);
        alert('No se pudo exportar: '+(e.message||'error desconocido'));
    }
}

/* Importar — usuario sube un JSON y se aplica tras validación */