function _invalidateListCache(key){
    if(key)delete _renderFingerprints[key];
    else Object.keys(_renderFingerprints).forEach(k=>delete _renderFingerprints[k]);
}

/* ═══════════════════════════════════════
   §15 — LOTES MODAL
   ═══════════════════════════════════════ */
function abrirEditarLote(id){
    AppState.ui.loteEditandoId=id;const l=id?AppState.datos.lotes.find(x=>x.id===id):null;
    /* INTEGRIDAD: solo lotes manuales son editables. Los automáticos provienen de
       compras reales y editarlos rompería trazabilidad y FIFO. */
    if(l&&!l.manual){
        alert('🔒 Este lote fue generado automáticamente por una operación de compra. No se puede editar para preservar la trazabilidad y la consistencia FIFO.\n\nPara modificarlo, editá o eliminá la operación que lo originó.');
        AppState.ui.loteEditandoId=null;
        return;
    }
    if(l){{const _h=$('editarLoteHeader');if(_h)_h.innerHTML='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>'+' Editar Lote';}$('lotePrecio').value=fmtNum(l.precioCompra,l.moneda==='USD'?3:2);$('loteDisponible').value=fmtNum(l.disponible);$('loteFecha').value=l.fecha||'';$('btnEliminarLote').style.display='';$('loteButtons').style.gridTemplateColumns='1fr 1fr 1fr'}
    else{{const _h=$('editarLoteHeader');if(_h)_h.innerHTML='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'+' Agregar Lote';}$('lotePrecio').value=AppState.datos.ultimaTasaCompra?fmtNum(AppState.datos.ultimaTasaCompra):'';$('loteDisponible').value='';$('loteFecha').value=getUDateStr();$('btnEliminarLote').style.display='none';$('loteButtons').style.gridTemplateColumns='1fr 1fr'}
    abrirModal('modalEditarLote');
}
async function guardarLote(){
    if(AppState.ui.guardandoLote)return;
    const btn=$('btnGuardarLote');if(btn.disabled)return;
    const p=pvTasa('lotePrecio'),d=pv('loteDisponible');const f=$('loteFecha').value||getUDateStr();
    if(!p||p<=0||isNaN(p)){alert('Ingresá un precio válido');return}if(d===undefined||d<0||isNaN(d)){alert('Ingresá una cantidad válida');return}
    /* INTEGRIDAD: re-validar al guardar — defensa en profundidad contra DOM forzado */
    if(AppState.ui.loteEditandoId){
        const lExist=AppState.datos.lotes.find(x=>x.id===AppState.ui.loteEditandoId);
        if(lExist&&!lExist.manual){
            alert('🔒 Este lote fue generado automáticamente. No se puede modificar.');
            cerrarModal('modalEditarLote');AppState.ui.loteEditandoId=null;
            return;
        }
    }
    AppState.ui.guardandoLote=true;btn.disabled=true;btn.textContent='⏳ Guardando';
    try{
        let loteId=AppState.ui.loteEditandoId;
        if(loteId){
            const l=AppState.datos.lotes.find(x=>x.id===loteId);
            if(l&&l.manual){
                l.precioCompra=roundMoney(p,3);l.disponible=truncUsdt(d);l.cantidad=truncUsdt(d);l.fecha=f;
                /* ═══ v5.9.0 — Los lotes de arrastre también se guardan ═══
                   Desde que la declaración del arrastre vive en su propio campo, el
                   editor cambiaba solo la copia calculada: el próximo recálculo la
                   reconstruía desde la declaración original y el cambio desaparecía
                   sin ningún aviso. Se veía como que los lotes de arrastre no se
                   pueden modificar. Ahora se actualiza la declaración, que es lo
                   único que el recálculo respeta. */
                if(l.carryover&&Array.isArray(AppState.datos._archivoCarryover)){
                    const decl=AppState.datos._archivoCarryover.find(x=>String(x.id)===String(loteId));
                    if(decl){decl.precioCompra=l.precioCompra;decl.cantidad=l.cantidad;decl.disponible=l.disponible;decl.fecha=l.fecha}
                }
            }
        }
        else{loteId=uid();AppState.datos.lotes.push({id:loteId,fecha:f,hora:getUTimeStr(),precioCompra:roundMoney(p,3),cantidad:truncUsdt(d),disponible:truncUsdt(d),moneda:'UYU',manual:true})}
        const isEdit=!!AppState.ui.loteEditandoId;
        recalcularLotesYGanancias();actualizarVista();renderizarInventario();cerrarModal('modalEditarLote');AppState.ui.loteEditandoId=null;
        guardaOptimista(isEdit?'update':'create','lotes',loteId);
    }catch(e){console.error('[P2P] Error guardando lote:',e)}finally{AppState.ui.guardandoLote=false;btn.disabled=false;btn.textContent='Guardar'}
}
async function eliminarLoteActual(){
    if(!AppState.ui.loteEditandoId||AppState.ui.guardandoLote)return;
    /* INTEGRIDAD: solo se pueden eliminar lotes manuales */
    const lExist=AppState.datos.lotes.find(x=>x.id===AppState.ui.loteEditandoId);
    if(lExist&&!lExist.manual){
        alert('🔒 No se puede eliminar un lote generado automáticamente.');
        return;
    }
    if(!confirm('¿Eliminar este lote del inventario?'))return;
    AppState.ui.guardandoLote=true;const btn=$('btnEliminarLote');btn.disabled=true;btn.textContent='⏳ Eliminando';
    try{
        const delLoteId=AppState.ui.loteEditandoId;
        /* v5.9.0 — Si es de arrastre, se saca también de la declaración: si no,
           el recálculo lo vuelve a crear y parece que el borrado no funcionó. */
        if(lExist&&lExist.carryover&&Array.isArray(AppState.datos._archivoCarryover)){
            AppState.datos._archivoCarryover=AppState.datos._archivoCarryover.filter(x=>String(x.id)!==String(delLoteId));
        }
        AppState.datos.lotes=AppState.datos.lotes.filter(l=>l.id!==delLoteId);
        recalcularLotesYGanancias();actualizarVista();renderizarInventario();
        guardaOptimista('delete','lotes',delLoteId);
        cerrarModal('modalEditarLote');AppState.ui.loteEditandoId=null;
    }catch(e){console.error('[P2P] Error eliminando lote:',e)}finally{AppState.ui.guardandoLote=false;btn.disabled=false;btn.textContent='Eliminar'}
}

/* ═══════════════════════════════════════
   §16 — REINICIAR DATOS
   ═══════════════════════════════════════ */
async function borrarTodo(){
    if(confirm('⚠️ ¿Reiniciar todos los datos?')&&confirm('Esta acción no se puede deshacer. ¿Continuar?')){
        try{
            AppState.datos=crearDatosVacios();AppState._localVersion=0;AppState._datosStale=false;
            inicializarBancos();AppState.ui.paginaOp=1;AppState.ui.paginaMov=1;AppState.ui.paginaTrans=1;AppState.ui.paginaConv=1;
            $('comisionPlataforma').value='0,14';setText('comisionPctLabel','0,14');
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
            if(AppState._schema===2&&window._v2sync&&typeof window._v2sync.subirTodo==='function'){
                await window._v2sync.subirTodo();
            }else{
                /* forzar=true → saltea el guard anti-wipe SOLO en esta acción explícita y doble-confirmada */
                await guardarDatos(true);
            }
            actualizarVista();
        }catch(e){console.error('[P2P] Error reiniciando datos:',e)}
    }
}

/* ═══════════════════════════════════════
   §17B — RESTAURACIÓN MANUAL + EXPORT/IMPORT JSON
   ═══════════════════════════════════════ */
/* Busca TODOS los respaldos posibles en localStorage — incluye claves huérfanas de
   sesiones anteriores, cambios de uid, formatos viejos. Devuelve array ordenado por
   puntaje (mejor primero). */
function _buscarTodosLosRespaldos(){
    const encontrados=[];
    try{
        for(let i=0;i<localStorage.length;i++){
            const k=localStorage.key(i);
            if(!k||!k.startsWith('p2p_backup_'))continue;
            try{
                const raw=localStorage.getItem(k);
                if(!raw)continue;
                const b=JSON.parse(raw);
                if(!b||!b.datos)continue;
                const score=_puntajeDatos(b.datos);
                if(score<=0)continue;
                const isPrev=k.endsWith('_prev');
                const isCurrent=AppState.currentUser&&(k==='p2p_backup_'+AppState.currentUser.uid||k==='p2p_backup_'+AppState.currentUser.uid+'_prev');
                encontrados.push({key:k,score,ts:b.ts||0,v:b.v||0,datos:b.datos,isPrev,isCurrent});
            }catch(e){/* key corrupto — ignorar */}
        }
    }catch(e){console.warn('[P2P] Error escaneando localStorage:',e.message)}
    /* Orden: primero los del uid actual, luego por puntaje descendente, luego por timestamp */
    encontrados.sort((a,b)=>{
        if(a.isCurrent!==b.isCurrent)return a.isCurrent?-1:1;
        if(a.score!==b.score)return b.score-a.score;
        return b.ts-a.ts;
    });
    return encontrados;
}

async function restaurarRespaldoManual(){
    if(!AppState.currentUser){alert('No hay usuario activo');return}
    /* 1. Búsqueda exhaustiva — escanea TODO localStorage */
    const todos=_buscarTodosLosRespaldos();
    if(!todos.length){
        /* Sin respaldos — dar al usuario TODAS las opciones restantes */
        alert('📭 No se encontraron respaldos locales con datos útiles.\n\n'
            +'═══ OPCIONES DE RECUPERACIÓN ═══\n\n'
            +'1️⃣ IMPORTAR DESDE ARCHIVO\n'
            +'Si tenés un archivo .json de respaldo manual (exportado previamente o desde otro dispositivo), usá "Importar datos" en este mismo menú.\n\n'
            +'2️⃣ OTRO DISPOSITIVO/NAVEGADOR\n'
            +'Si abriste la app en otro navegador o dispositivo antes del problema, abrí la app allí e inmediatamente usá "Exportar datos". Luego importá acá.\n\n'
            +'3️⃣ FIREBASE CONSOLE (admin)\n'
            +'Si tenés acceso a la consola de Firebase y el proyecto tiene Point-in-Time Recovery o backups programados, podés restaurar el documento del usuario desde allí (ventana de 7 días para PITR).\n\n'
            +'4️⃣ PREVENCIÓN A FUTURO\n'
            +'Usá "Exportar datos" regularmente para tener un archivo propio de respaldo que no depende de la caché del navegador.');
        return;
    }
    /* 2. Elegir el mejor respaldo — el primero del array ordenado */
    const best=todos[0];
    const backup={v:best.v,ts:best.ts,datos:best.datos};
    let origen='respaldo principal';
    if(best.isPrev)origen='respaldo previo (rotado)';
    if(!best.isCurrent)origen='respaldo de sesión anterior';
    /* 3. Mostrar resumen al usuario */
    const d=backup.datos;
    const ts=backup.ts?new Date(backup.ts):null;
    const edad=ts?Math.floor((Date.now()-backup.ts)/60000):null;
    const edadTxt=edad===null?'fecha desconocida':
                  edad<1?'hace menos de 1 minuto':
                  edad<60?`hace ${edad} min`:
                  edad<1440?`hace ${Math.floor(edad/60)} h`:
                  `hace ${Math.floor(edad/1440)} días`;
    let resumen=`¿Restaurar este respaldo?\n\n`
        +`📅 Origen: ${origen}\n`
        +`⏱️ Guardado: ${edadTxt}\n`
        +`📊 Contenido:\n`
        +`  • ${(d.operaciones||[]).length} operaciones\n`
        +`  • ${(d.movimientos||[]).length} ajustes\n`
        +`  • ${(d.transferencias||[]).length} transferencias\n`
        +`  • ${(d.conversiones||[]).length} conversiones\n`
        +`  • ${(d.lotes||[]).length} lotes USDT\n`
        +`  • ${Object.values(d.bancos||{}).filter(b=>b&&b.activo).length} bancos activos\n`;
    if(todos.length>1)resumen+=`\n📦 Hay ${todos.length} respaldos totales. Se usa el mejor disponible.\n`;
    resumen+=`\nEsta acción reemplazará los datos actuales de la app con los del respaldo.\n`
        +`Los datos actuales se guardarán como respaldo previo antes de aplicar.`;
    if(!confirm(resumen))return;
    await _aplicarRespaldo(backup.datos,origen);
}
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
        AppState._localVersion=0;
        AppState._restoredFrom=origen.includes('importado')?'manual-import':'manual-backup';
        AppState._datosStale=false;
        /* ═══ Post-restore lock ═══
           Durante los próximos N segundos después de un restore manual, los snapshots de 
           Firebase deben ignorarse para reconcile/merge. Razón: con _localVersion=0, 
           cualquier snapshot remoto (incluso el echo de nuestro propio guardarDatos(true)) 
           cae en Branch 2 → mergeRemoteState → recalcularLotesYGanancias → ~300-400ms 
           extra de "Reconciliando…" innecesario. Los datos locales son authoritative justo 
           después de un restore manual. El lock se libera automáticamente cuando 
           guardarDatos(true) confirma el push y _localVersion se sincroniza.
           
           Window de 6s es defensivo: cubre red lenta + retries + echo del propio write. */
        AppState._postRestoreLockTs=Date.now()+6000;
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
        /* Liberar el lock apenas el push confirma exitosamente — ya no hay necesidad de bloquear */
        AppState._postRestoreLockTs=0;
        alert(`✅ Datos restaurados correctamente.\n\n`
            +`Origen: ${origen}\n`
            +`Operaciones: ${(datos.operaciones||[]).length}\n`
            +`Bancos activos: ${Object.values(datos.bancos||{}).filter(b=>b&&b.activo).length}\n\n`
            +`Los datos fueron sincronizados con Firebase.`);
    }catch(e){
        console.error('[P2P] Error aplicando respaldo:',e);
        alert('❌ Error al restaurar: '+(e.message||e.code||'desconocido'));
    }
}

/* Exportar — descarga JSON con todo el estado actual */
function exportarDatos(){
    if(!AppState.currentUser){alert('No hay usuario activo');return}
    if(esDatosVacios(AppState.datos)){
        if(!confirm('⚠️ Los datos actuales están vacíos. ¿Exportar de todos modos?\n\nSi acabás de ser víctima del bug de wipe en Android, NO exportes ahora — usá "Restaurar último respaldo" primero.'))return;
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
        setTimeout(()=>alert(`✅ Respaldo exportado.\n\n`
            +`Archivo: p2p-backup-${uname}-${fechaStr}.json\n`
            +`Operaciones: ${payload._meta.counts.operaciones}\n`
            +`Movimientos: ${payload._meta.counts.movimientos}\n\n`
            +`Guardalo en un lugar seguro (email, Drive, etc.).\n`
            +`Podrás importarlo cuando lo necesites con "Importar datos".`),100);
    }catch(e){
        console.error('[P2P] Error exportando:',e);
        alert('❌ Error al exportar: '+(e.message||'desconocido'));
    }
}

/* Importar — usuario sube un JSON y se aplica tras validación */