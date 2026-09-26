function _invalidateListCache(key){
    if(key)delete _renderFingerprints[key];
    else Object.keys(_renderFingerprints).forEach(k=>delete _renderFingerprints[k]);
}

/* ═══════════════════════════════════════
   §15 — LOTES MODAL
   ═══════════════════════════════════════ */
/* ═══ v7.3.0 — Se edita la cantidad del lote, no lo que queda ═══
   El formulario mostraba lo que quedaba disponible y al guardar lo tomaba como
   la cantidad original del lote. Como el recálculo vuelve a descontar las
   ventas desde la cantidad original, editar solo el precio de un lote que ya
   se había vendido en parte hacía perder esos USDT otra vez. Ahora el campo es
   la cantidad cargada (para los de arrastre, la que quedó al archivar) y lo
   disponible se muestra como dato. */
function _declaracionLote(l){
    if(l&&l.carryover&&Array.isArray(AppState.datos._archivoCarryover))
        return AppState.datos._archivoCarryover.find(x=>String(x.id)===String(l.id))||null;
    return l;
}
function abrirEditarLote(id){
    AppState.ui.loteEditandoId=id;const l=id?AppState.datos.lotes.find(x=>String(x.id)===String(id)):null;
    /* INTEGRIDAD: solo lotes manuales son editables. Los automáticos provienen de
       compras reales: se corrigen editando o borrando la compra. */
    if(l&&!l.manual){
        alert('Este lote viene de una compra. Para modificarlo, editá o borrá esa compra.');
        AppState.ui.loteEditandoId=null;
        return;
    }
    const hd=$('editarLoteHeader'),info=$('loteDisponibleInfo');
    if(l){
        const decl=_declaracionLote(l)||l;
        if(hd)hd.innerHTML=ICO_EDITAR+' Editar lote';
        $('lotePrecio').value=fmtNum(decl.precioCompra,l.moneda==='USD'?3:2);
        $('loteDisponible').value=fmtNum(decl.cantidad);
        $('loteFecha').value=decl.fecha||'';
        if(info){info.style.display='block';info.textContent='Quedan '+fmtTrunc(l.disponible,2)+' USDT sin vender'+(l.carryover?' · lote de arrastre del archivo':'');}
        $('btnEliminarLote').style.display='';$('loteButtons').style.gridTemplateColumns='1fr 1fr 1fr';
    }else{
        if(hd)hd.innerHTML='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> Agregar lote';
        $('lotePrecio').value=AppState.datos.ultimaTasaCompra?fmtNum(AppState.datos.ultimaTasaCompra):'';
        $('loteDisponible').value='';$('loteFecha').value=getUDateStr();
        if(info)info.style.display='none';
        $('btnEliminarLote').style.display='none';$('loteButtons').style.gridTemplateColumns='1fr 1fr';
    }
    abrirModal('modalEditarLote');
}
async function guardarLote(){
    if(AppState.ui.guardandoLote)return;
    const btn=$('btnGuardarLote');if(btn.disabled)return;
    const p=pvTasa('lotePrecio'),d=pv('loteDisponible');const f=$('loteFecha').value||getUDateStr();
    if(!p||p<=0||isNaN(p)){alert('Ingresá un precio válido');return}if(!(d>0)){alert('Ingresá una cantidad mayor que cero');return}
    const editId=AppState.ui.loteEditandoId;
    const l=editId?AppState.datos.lotes.find(x=>String(x.id)===String(editId)):null;
    if(editId&&(!l||!l.manual)){
        alert('Este lote viene de una compra y no se puede modificar acá.');
        cerrarModal('modalEditarLote');AppState.ui.loteEditandoId=null;
        return;
    }
    AppState.ui.guardandoLote=true;btn.disabled=true;btn.textContent='Guardando…';
    try{
        let loteId=editId;
        const cantidad=truncUsdt(d),precio=roundMoney(p,3);
        if(l){
            const decl=_declaracionLote(l);
            /* El lote calculado y su declaración: el recálculo solo respeta la
               declaración (la de arrastre vive en _archivoCarryover). */
            [l,decl].forEach(x=>{if(x){x.precioCompra=precio;x.cantidad=cantidad;x.disponible=cantidad;x.fecha=f}});
        }else{
            loteId=uid();
            AppState.datos.lotes.push({id:loteId,fecha:f,hora:getUTimeStr(),precioCompra:precio,cantidad,disponible:cantidad,moneda:'UYU',manual:true});
        }
        cerrarModal('modalEditarLote');AppState.ui.loteEditandoId=null;
        confirmarCambios([{tipo:l?'update':'create',entidad:'lotes',id:loteId}]);
        renderizarInventario();
    }catch(e){console.error('[P2P] Error guardando lote:',e)}finally{AppState.ui.guardandoLote=false;btn.disabled=false;btn.textContent='Guardar'}
}
async function eliminarLoteActual(){
    if(!AppState.ui.loteEditandoId||AppState.ui.guardandoLote)return;
    const delLoteId=AppState.ui.loteEditandoId;
    const lExist=AppState.datos.lotes.find(x=>String(x.id)===String(delLoteId));
    if(lExist&&!lExist.manual){alert('Este lote viene de una compra: se borra borrando la compra.');return}
    if(!confirm('¿Eliminar este lote del inventario?'))return;
    AppState.ui.guardandoLote=true;const btn=$('btnEliminarLote');btn.disabled=true;btn.textContent='Eliminando…';
    try{
        /* v5.9.0 — Si es de arrastre, se saca también de la declaración: si no,
           el recálculo lo vuelve a crear y parece que el borrado no funcionó. */
        if(lExist&&lExist.carryover&&Array.isArray(AppState.datos._archivoCarryover)){
            AppState.datos._archivoCarryover=AppState.datos._archivoCarryover.filter(x=>String(x.id)!==String(delLoteId));
        }
        AppState.datos.lotes=AppState.datos.lotes.filter(l=>String(l.id)!==String(delLoteId));
        cerrarModal('modalEditarLote');AppState.ui.loteEditandoId=null;
        confirmarCambios([{tipo:'delete',entidad:'lotes',id:delLoteId}]);
        renderizarInventario();
    }catch(e){console.error('[P2P] Error eliminando lote:',e)}finally{AppState.ui.guardandoLote=false;btn.disabled=false;btn.textContent='Eliminar'}
}

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
async function borrarTodo(){
    if(confirm('¿Borrar TODOS tus datos?\n\nOperaciones, ajustes, transferencias, saldos, lotes, historial archivado y resúmenes mensuales.')&&confirm('Esta acción no se puede deshacer. Si querés conservar algo, exportá tus datos antes.\n\n¿Borrar todo?')){
        try{
            AppState.datos=crearDatosVacios();AppState._localVersion=0;AppState._datosStale=false;
            inicializarBancos();AppState.ui.paginaOp=1;AppState.ui.paginaMov=1;AppState.ui.paginaTrans=1;AppState.ui.paginaConv=1;
            $('comisionPlataforma').value=fmtNum(comisionConfigurada('UYU'));
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
            /* v7.3.0 — El historial archivado y los resúmenes también se borran. Si
               quedaban, el índice del archivo se reconstruía desde ellos y la
               historia vieja volvía a aparecer después de resetear. */
            try{await _vaciarSubcoleccion('archivo');await _vaciarSubcoleccion('monthly_summaries')}
            catch(e){console.warn('[P2P] No se pudo borrar el archivo:',e&&e.message)}
            try{localStorage.removeItem('p2p_archivo_'+AppState.currentUser.uid)}catch(_){}
            recalcularLotesYGanancias();
            actualizarVista();
        }catch(e){console.error('[P2P] Error reiniciando datos:',e)}
    }
}

/* ═══════════════════════════════════════
   §17B — RESTAURACIÓN MANUAL + EXPORT/IMPORT JSON
   ═══════════════════════════════════════ */
/* Respaldos locales de la cuenta actual, el mejor primero.
   ═══ v7.3.0 — Solo los de esta cuenta ═══
   Se buscaban todas las claves de respaldo del teléfono, incluidas las de otros
   usuarios que hubieran iniciado sesión en él. Si la cuenta actual no tenía
   respaldo propio, se ofrecía restaurar el de otra persona y sus datos quedaban
   cargados en esta cuenta. Cada usuario ve solo lo suyo. */
function _buscarTodosLosRespaldos(){
    const encontrados=[];
    if(!AppState.currentUser)return encontrados;
    const propias=['p2p_backup_'+AppState.currentUser.uid,'p2p_backup_'+AppState.currentUser.uid+'_prev'];
    try{
        for(const k of propias){
            try{
                const raw=localStorage.getItem(k);
                if(!raw)continue;
                const b=JSON.parse(raw);
                if(!b||!b.datos)continue;
                const score=_puntajeDatos(b.datos);
                if(score<=0)continue;
                const isPrev=k.endsWith('_prev');
                encontrados.push({key:k,score,ts:b.ts||0,v:b.v||0,datos:b.datos,isPrev,isCurrent:true});
            }catch(e){/* key corrupto — ignorar */}
        }
    }catch(e){console.warn('[P2P] Error escaneando localStorage:',e.message)}
    /* Orden: por puntaje descendente, luego por fecha */
    encontrados.sort((a,b)=>a.score!==b.score?b.score-a.score:b.ts-a.ts);
    return encontrados;
}

async function restaurarRespaldoManual(){
    if(!AppState.currentUser){alert('No hay usuario activo');return}
    /* 1. Búsqueda exhaustiva — escanea TODO localStorage */
    const todos=_buscarTodosLosRespaldos();
    if(!todos.length){
        /* Sin respaldos — dar al usuario TODAS las opciones restantes */
        alert('No hay respaldos de esta cuenta en este dispositivo.\n\n'
            +'Si tenés un archivo .json exportado, usá "Importar datos".\n'
            +'Si otro dispositivo tiene los datos bien, abrí la app allí y usá "Exportar datos", o "Verificar y reconciliar" → "Este dispositivo tiene los datos correctos".');
        return;
    }
    /* 2. Elegir el mejor respaldo — el primero del array ordenado */
    const best=todos[0];
    const backup={v:best.v,ts:best.ts,datos:best.datos};
    const origen=best.isPrev?'respaldo previo':'respaldo principal';
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
        +`Origen: ${origen}\n`
        +`Guardado: ${edadTxt}\n`
        +`Contenido:\n`
        +`  • ${(d.operaciones||[]).length} operaciones\n`
        +`  • ${(d.movimientos||[]).length} ajustes\n`
        +`  • ${(d.transferencias||[]).length} transferencias\n`
        +`  • ${(d.conversiones||[]).length} conversiones\n`
        +`  • ${(d.lotes||[]).length} lotes USDT\n`
        +`  • ${Object.values(d.bancos||{}).filter(b=>b&&b.activo).length} bancos activos\n`;
    if(todos.length>1)resumen+=`\nHay ${todos.length} respaldos; se usa el más completo.\n`;
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