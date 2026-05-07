/* ═══════════════════════════════════════════════════════════════════
   09-ui-glue.js
   Generated piece — concatenated into dist/index.html by build/build.js
   Source of truth: src/js/09-ui-glue.js
   Do NOT edit dist/index.html directly. Edit the source and re-run build.
   ═══════════════════════════════════════════════════════════════════ */
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
    if(l){setText('editarLoteHeader','✏️ Editar Lote');$('lotePrecio').value=fmtNum(l.precioCompra,l.moneda==='USD'?3:2);$('loteDisponible').value=fmtNum(l.disponible);$('loteFecha').value=l.fecha||'';$('btnEliminarLote').style.display='';$('loteButtons').style.gridTemplateColumns='1fr 1fr 1fr'}
    else{setText('editarLoteHeader','➕ Agregar Lote');$('lotePrecio').value=AppState.datos.ultimaTasaCompra?fmtNum(AppState.datos.ultimaTasaCompra):'';$('loteDisponible').value='';$('loteFecha').value=getUDateStr();$('btnEliminarLote').style.display='none';$('loteButtons').style.gridTemplateColumns='1fr 1fr'}
    abrirModal('modalEditarLote');
}
async function guardarLote(){
    if(AppState.ui.guardandoLote)return;
    const btn=$('btnGuardarLote');if(btn.disabled)return;
    const p=pv('lotePrecio'),d=pv('loteDisponible');const f=$('loteFecha').value||getUDateStr();
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
        if(loteId){const l=AppState.datos.lotes.find(x=>x.id===loteId);if(l&&l.manual){l.precioCompra=roundMoney(p,3);l.disponible=truncUsdt(d);l.cantidad=truncUsdt(d);l.fecha=f}}
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
            await guardarDatos();actualizarVista();
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
        await guardarDatos(true);
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
function importarDatos(){
    if(!AppState.currentUser){alert('No hay usuario activo');return}
    const input=document.createElement('input');
    input.type='file';input.accept='.json,application/json';
    input.addEventListener('change',e=>{
        const file=e.target.files?.[0];if(!file)return;
        const reader=new FileReader();
        reader.onload=async evt=>{
            try{
                const txt=evt.target.result;
                const parsed=JSON.parse(txt);
                /* Aceptar formato nuevo (con _meta.datos) o legacy (datos directos) */
                const datos=parsed.datos&&parsed._meta?parsed.datos:parsed;
                /* Validación estructural */
                if(!datos||typeof datos!=='object'){alert('❌ Archivo inválido: no es un objeto JSON de datos.');return}
                const camposRequeridos=['operaciones','movimientos','transferencias','conversiones','bancos','lotes'];
                const faltantes=camposRequeridos.filter(c=>datos[c]===undefined);
                if(faltantes.length===camposRequeridos.length){
                    alert('❌ Archivo inválido: no contiene ninguno de los campos esperados (operaciones, bancos, etc.).');return;
                }
                /* Normalizar campos faltantes para que la app no reviente */
                camposRequeridos.forEach(c=>{if(datos[c]===undefined)datos[c]=(c==='bancos')?{}:[]});
                /* Validación de tipos: los arrays deben serlo, bancos debe ser objeto */
                const tiposMal=[];
                ['operaciones','movimientos','transferencias','conversiones','lotes'].forEach(c=>{
                    if(!Array.isArray(datos[c]))tiposMal.push(c);
                });
                if(typeof datos.bancos!=='object'||Array.isArray(datos.bancos))tiposMal.push('bancos');
                if(tiposMal.length){alert('❌ Archivo con tipos inválidos en: '+tiposMal.join(', '));return}
                /* Validar que los montos numéricos sean realmente números */
                let numericosMal=0;
                (datos.operaciones||[]).forEach(op=>{
                    if(typeof op.monto!=='number'||!isFinite(op.monto))numericosMal++;
                    if(op.tasa!==undefined&&(typeof op.tasa!=='number'||!isFinite(op.tasa)))numericosMal++;
                });
                (datos.movimientos||[]).forEach(m=>{
                    if(typeof m.monto!=='number'||!isFinite(m.monto))numericosMal++;
                });
                if(numericosMal>0){
                    if(!confirm(`⚠️ Se detectaron ${numericosMal} campos numéricos inválidos en el archivo. Esto puede causar errores de cálculo.\n\n¿Importar de todos modos?`))return;
                }
                if(esDatosVacios(datos)){
                    alert('⚠️ El archivo contiene un estado vacío. No se importará — sería destructivo.');return;
                }
                /* Resumen + confirmación */
                const meta=parsed._meta||{};
                let resumen=`¿Importar este respaldo?\n\n`;
                if(meta.user)resumen+=`👤 Usuario: ${meta.user}\n`;
                if(meta.exported_at){
                    try{resumen+=`📅 Exportado: ${new Date(meta.exported_at).toLocaleString('es-UY')}\n`}catch(e){}
                }
                if(meta.version)resumen+=`🏷️ App v${meta.version}\n`;
                resumen+=`\n📊 Contenido:\n`
                    +`  • ${(datos.operaciones||[]).length} operaciones\n`
                    +`  • ${(datos.movimientos||[]).length} ajustes\n`
                    +`  • ${(datos.transferencias||[]).length} transferencias\n`
                    +`  • ${(datos.conversiones||[]).length} conversiones\n`
                    +`  • ${(datos.lotes||[]).length} lotes USDT\n`
                    +`  • ${Object.values(datos.bancos||{}).filter(b=>b&&b.activo).length} bancos activos\n\n`;
                /* Advertencia si el archivo era de otro usuario */
                if(meta.user){
                    const actual=emailToUser(AppState.currentUser.email);
                    if(meta.user!==actual){
                        resumen+=`⚠️ ATENCIÓN: este archivo es del usuario "${meta.user}" pero estás logueado como "${actual}".\n`
                            +`Si confirmás, los datos se aplicarán a tu cuenta actual.\n\n`;
                    }
                }
                resumen+=`Esta acción reemplazará los datos actuales. El estado actual se guardará como respaldo previo.`;
                if(!confirm(resumen))return;
                await _aplicarRespaldo(datos,'importado desde archivo');
            }catch(ex){
                console.error('[P2P] Error importando:',ex);
                alert('❌ Error al leer el archivo: '+(ex.message||'formato inválido'));
            }
        };
        reader.onerror=()=>alert('❌ Error al leer el archivo.');
        reader.readAsText(file);
    });
    input.click();
}

/* ═══════════════════════════════════════
   §18 — EVENT LISTENERS (sin inline)
   ═══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{
    // Auth
    $('tabLogin').addEventListener('click',()=>{$('tabLogin').classList.add('active');$('tabRegister').classList.remove('active');$('loginForm').style.display='block';$('registerForm').style.display='none';$('authError').classList.remove('show')});
    $('tabRegister').addEventListener('click',()=>{$('tabRegister').classList.add('active');$('tabLogin').classList.remove('active');$('registerForm').style.display='block';$('loginForm').style.display='none';$('authError').classList.remove('show')});
    $('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('authError').classList.remove('show');const u=$('loginUser').value.trim(),p=$('loginPass').value,b=$('loginBtn');b.disabled=true;b.textContent='Entrando...';try{await AppState.auth.signInWithEmailAndPassword(userToEmail(u),p)}catch(er){$('authError').textContent='Usuario o contraseña incorrectos';$('authError').classList.add('show');b.disabled=false;b.textContent='Iniciar Sesión'}});
    $('registerForm').addEventListener('submit',async e=>{e.preventDefault();$('authError').classList.remove('show');const u=$('regUser').value.trim(),p=$('regPass').value,p2=$('regPassConfirm').value,ae=$('authError');
        if(!/^[a-zA-Z0-9_-]{3,20}$/.test(u)){ae.textContent='Usuario inválido';ae.classList.add('show');return}if(p.length<6){ae.textContent='Mínimo 6 caracteres';ae.classList.add('show');return}if(p!==p2){ae.textContent='No coinciden';ae.classList.add('show');return}
        const b=$('registerBtn');b.disabled=true;b.textContent='Creando...';try{await AppState.auth.createUserWithEmailAndPassword(userToEmail(u),p)}catch(er){ae.textContent=er.code==='auth/email-already-in-use'?'Usuario ya existe':'Error';ae.classList.add('show');b.disabled=false;b.textContent='Crear Cuenta'}});

    // Menu panel (full-screen)
    function abrirMenuPanel(){
        $('menuPanel').classList.add('active');
        $('menuBackdrop').classList.add('active');
        $('menuBtn').classList.add('active');
        document.body.style.overflow='hidden';
        /* Set avatar initial */
        const name=$('menuUserName').textContent||'U';
        $('menuUserAvatar').textContent=(name[0]||'U').toUpperCase();
    }
    function cerrarMenuPanel(){
        $('menuPanel').classList.remove('active');
        $('menuBackdrop').classList.remove('active');
        $('menuBtn').classList.remove('active');
        if(!document.querySelector('.modal.active'))document.body.style.overflow='';
    }
    $('menuBtn').addEventListener('click',e=>{e.stopPropagation();if($('menuPanel').classList.contains('active'))cerrarMenuPanel();else abrirMenuPanel()});
    $('menuBack').addEventListener('click',cerrarMenuPanel);
    $('menuBackdrop').addEventListener('click',cerrarMenuPanel);
    setText('menuVersion',CONFIG.APP_VERSION);

    // Mobile: tap modal header (back arrow) to close
    document.addEventListener('click',e=>{
        if(window.innerWidth>=768)return;
        const header=e.target.closest('.modal.active .modal-header');
        if(!header)return;
        const modal=header.closest('.modal');
        if(modal&&modal.id)cerrarModal(modal.id);
    });
    $('menuPanel').addEventListener('click',e=>{const item=e.target.closest('[data-action]');if(!item)return;cerrarMenuPanel();
        const a=item.dataset.action;
        if(a==='calendario'){AppState.ui.calendarDate=new Date();AppState.ui.calSelectedDay=null;renderizarCalendario();abrirModal('modalCalendario')}
        else if(a==='inventario'){renderizarInventario();abrirModal('modalInventario')}
        else if(a==='movimiento')abrirModalMovimiento();
        else if(a==='bancos'){renderizarListaBancos();abrirModal('modalBancos')}
        else if(a==='transferencia')abrirModalTransferencia();
        else if(a==='gestion-tags'){renderizarGestionTags();abrirModal('modalGestionTags')}
        else if(a==='historial-mensual')cargarHistorialMensual();
        else if(a==='restaurar-respaldo')restaurarRespaldoManual();
        else if(a==='exportar-datos')exportarDatos();
        else if(a==='importar-datos')importarDatos();
        else if(a==='exportar-diagnostico')exportarDiagnostico();
        else if(a==='borrar-todo')borrarTodo();
        else if(a==='cerrar-sesion'){if(confirm('¿Cerrar sesión?')){flushGuardaDebounce().finally(()=>{if(AppState.unsubscribe){AppState.unsubscribe();AppState.unsubscribe=null}AppState._localVersion=0;AppState._datosStale=false;AppState._legacyMigrado=false;_guardando=false;_guardarPendiente=false;_syncPending=0;_syncErrors=0;_localDirty=0;backupToLocal._lastSig=null;clearTimeout(_retryTimer);AppState.auth.signOut()})}}
    });

    // Toggle sections
    document.querySelectorAll('.toggle-header').forEach(h=>h.addEventListener('click',e=>{
        /* Si el click fue en el trigger de filtros, ignorar — lo maneja el dispatcher global */
        if(e.target.closest('.ops-filtros-trigger'))return;
        h.closest('.toggle-section')?.classList.toggle('open');
    }));

    // Formulario — Toggle compra/venta
    function setTipoOp(v){$('tipo').value=v;AppState.ui.tasaManual=false;AppState.ui.ultimoMonedaBanco=null;actualizarFormulario();actualizarColorSelect()}
    $('opToggleCompra').addEventListener('click',()=>setTipoOp('compra'));
    $('opToggleVenta').addEventListener('click',()=>setTipoOp('venta'));
    $('tipo').addEventListener('change',()=>{AppState.ui.tasaManual=false;AppState.ui.ultimoMonedaBanco=null;AppState.ui.splitExtras=[];actualizarFormulario();actualizarColorSelect();renderSplitPanel()});
    $('monto').addEventListener('input',()=>{calcularPreview();renderSplitPanel()});
    $('tasa').addEventListener('input',()=>{AppState.ui.tasaManual=true;calcularPreview()});
    $('banco').addEventListener('change',()=>{AppState.ui.splitExtras=[];mostrarSaldoBanco();actualizarFormulario();actualizarColorBancoSelect();renderSplitPanel()});
    $('comisionBanco').addEventListener('input',()=>{calcularPreview();renderSplitPanel()});
    /* Split pago: listeners delegados para select/input internos */
    $('splitPanel').addEventListener('change',e=>{
        const el=e.target;const a=el.dataset?.action;
        if(a==='split-set-banco'){
            const idx=parseInt(el.dataset.idx);
            if(isNaN(idx)||!AppState.ui.splitExtras[idx])return;
            AppState.ui.splitExtras[idx].banco=el.value;
            renderSplitPanel();
        }
    });
    $('splitPanel').addEventListener('input',e=>{
        const el=e.target;const a=el.dataset?.action;
        if(a==='split-set-monto'){
            const idx=parseInt(el.dataset.idx);
            if(isNaN(idx)||!AppState.ui.splitExtras[idx])return;
            /* Parse manteniendo formato es-UY (coma decimal, punto miles) */
            const raw=el.value.toString().trim();
            let v=0;
            if(raw){
                if(raw.includes(',')){v=parseFloat(raw.replace(/\./g,'').replace(',','.'))||0}
                else if(raw.includes('.')){const parts=raw.split('.');v=parts.length===2&&parts[1].length<3?parseFloat(raw)||0:parseFloat(raw.replace(/\./g,''))||0}
                else v=parseFloat(raw)||0;
            }
            AppState.ui.splitExtras[idx].monto=v;
            /* No re-render completo para no perder foco del input; actualizar solo status */
            _updateSplitStatus();
        }
    });
    $('comisionPlataforma').addEventListener('input',guardarComisionYCalcular);
    $('comisionPlataforma').addEventListener('blur',()=>{
        /* Al perder foco: si el valor quedó inválido, revertir al último guardado.
           Si está vacío, poner el valor actual formateado. */
        const inp=$('comisionPlataforma');
        const v=parsearComisionPct(inp.value.replace(',','.').trim());
        if(v===null){
            const cv=getMonedaBanco()==='USD'?AppState.datos.comisionUSD:AppState.datos.comisionPlataforma;
            inp.value=fmtNum(cv||0.14);
            inp.classList.remove('error');
            calcularPreview();
        }
    });
    $('btnAgregarOp').addEventListener('click',agregarOperacion);

    // Paginación
    $('btnPrevOp').addEventListener('click',()=>pagOp.cambiar(-1));
    $('btnNextOp').addEventListener('click',()=>pagOp.cambiar(1));
    $('btnPrevMov').addEventListener('click',()=>pagMov.cambiar(-1));
    $('btnNextMov').addEventListener('click',()=>pagMov.cambiar(1));
    $('btnPrevTrans').addEventListener('click',()=>pagTrans.cambiar(-1));
    $('btnNextTrans').addEventListener('click',()=>pagTrans.cambiar(1));
    $('btnPrevConv').addEventListener('click',()=>pagConv.cambiar(-1));
    $('btnNextConv').addEventListener('click',()=>pagConv.cambiar(1));

    // Modales con botones fijos
    $('tabIngreso').addEventListener('click',()=>setTipoMovimiento('ingreso'));
    $('tabEgreso').addEventListener('click',()=>setTipoMovimiento('egreso'));
    $('movTipoCuenta').addEventListener('change',()=>{actualizarCuentasMovimiento();actualizarMovResumen()});
    $('movBanco').addEventListener('change',()=>{const v=$('movBanco').value;$('movBanco').style.color=v?getBancoColor(v):'#1e293b';$('movBanco').style.fontWeight=v?'600':'400';actualizarMovResumen()});
    $('btnGuardarMov').addEventListener('click',guardarMovimiento);
    $('btnCancelMov').addEventListener('click',()=>{AppState.ui.movEditandoId=null;cerrarModal('modalMovimiento')});
    $('btnCerrarBancos').addEventListener('click',()=>{cerrarModal('modalBancos');actualizarVista();guardaOptimista('update','bancos','close')});
    $('bancoOrigen').addEventListener('change',()=>{const v=$('bancoOrigen').value;$('bancoOrigen').style.color=v?getBancoColor(v):'#1e293b';mostrarSaldoOrigen();actualizarTransfUI()});
    $('bancoDestino').addEventListener('change',()=>{const v=$('bancoDestino').value;$('bancoDestino').style.color=v?getBancoColor(v):'#1e293b';actualizarTransfUI()});
    $('montoTransferencia').addEventListener('input',actualizarTransfPreview);
    $('transfTasa').addEventListener('input',actualizarTransfPreview);
    $('btnTransferir').addEventListener('click',realizarTransferencia);
    $('btnCancelTransf').addEventListener('click',()=>{AppState.ui.transEditandoId=null;AppState.ui.transEditandoIsConv=false;cerrarModal('modalTransferencia')});
    $('movMonto').addEventListener('input',()=>{actualizarFifoPreview();actualizarMovResumen()});
    $('btnCancelSaldo').addEventListener('click',()=>{cerrarModal('modalEditarSaldo');AppState.ui.bancoEditando=null});
    $('btnGuardarSaldo').addEventListener('click',async()=>{const ns=roundMoney(pv('nuevoSaldoBanco')),n=AppState.ui.bancoEditando;if(n&&AppState.datos.bancos[n]){AppState.datos.bancos[n].saldo=fixNeg(ns);AppState.datos.bancos[n].limiteDiarioUSD=roundMoney(pv('limiteDiarioBanco'))}actualizarVista();renderizarListaBancos();cerrarModal('modalEditarSaldo');AppState.ui.bancoEditando=null;guardaOptimista('update','bancos',n||'saldo')});
    $('btnAgregarLote').addEventListener('click',()=>abrirEditarLote(null));
    $('btnCerrarInventario').addEventListener('click',()=>cerrarModal('modalInventario'));
    $('btnCancelLote').addEventListener('click',()=>{cerrarModal('modalEditarLote');AppState.ui.loteEditandoId=null});
    $('btnEliminarLote').addEventListener('click',eliminarLoteActual);
    $('btnGuardarLote').addEventListener('click',guardarLote);
    $('btnCerrarTags').addEventListener('click',()=>cerrarModal('modalGestionTags'));
    /* Merge tag modal */
    $('btnCancelMerge').addEventListener('click',()=>cerrarModal('modalMergeTag'));
    $('btnConfirmMerge').addEventListener('click',confirmarFusion);
    $('mergeTabExisting').addEventListener('click',()=>setMergeTab('existing'));
    $('mergeTabNew').addEventListener('click',()=>setMergeTab('new'));
    $('mergeSearch').addEventListener('input',e=>renderMergeDestinations(e.target.value));
    $('mergeNewName').addEventListener('input',updateMergeConfirmBox);
    $('btnCerrarHistorial').addEventListener('click',()=>cerrarModal('modalHistorial'));
    /* Centro de novedades */
    $('newsBellBtn').addEventListener('click',e=>{e.stopPropagation();abrirCentroNoticias()});
    $('btnCerrarNoticias').addEventListener('click',()=>cerrarModal('modalNoticias'));
    $('btnCancelEditOp').addEventListener('click',()=>{cerrarModal('modalEditarOp');AppState.ui.opEditandoId=null});
    $('btnGuardarEditOp').addEventListener('click',guardarEditarOperacion);
    $('editOpMonto').addEventListener('input',calcularEditOpPreview);
    $('editOpTasa').addEventListener('input',calcularEditOpPreview);
    /* Comisión editable en modal de editar — live preview + blur validation */
    $('editOpComisionPct').addEventListener('input',()=>{
        const inp=$('editOpComisionPct'),raw=inp.value.replace(',','.').trim();
        if(raw===''||raw==='.'||raw.endsWith('.')){inp.classList.remove('error');calcularEditOpPreview();return}
        const v=parsearComisionPct(raw);
        if(v===null){inp.classList.add('error');return}
        inp.classList.remove('error');
        calcularEditOpPreview();
    });
    $('editOpComisionPct').addEventListener('blur',()=>{
        const op=AppState.datos.operaciones.find(o=>o.id===AppState.ui.opEditandoId);if(!op)return;
        const inp=$('editOpComisionPct');
        const v=parsearComisionPct(inp.value.replace(',','.').trim());
        if(v===null){
            /* Revertir al valor persistido o fallback */
            const cv=op.comisionPct!==undefined?op.comisionPct:(op.moneda==='USD'?(AppState.datos.comisionUSD||0.14):(AppState.datos.comisionPlataforma||0.14));
            inp.value=fmtNum(cv);
            inp.classList.remove('error');
            calcularEditOpPreview();
        }
    });
    $('editOpBanco').addEventListener('change',()=>{const v=$('editOpBanco').value;$('editOpBanco').style.color=v?getBancoColor(v):'#1e293b';$('editOpBanco').style.fontWeight=v?'600':'400'});
    $('tagSearch').addEventListener('input',renderizarGestionTags);
    $('movDescripcion').addEventListener('input',()=>{AppState.ui._tagShowAll=false;renderizarTagsSugerencias('movDescripcion','tagSugerenciasMov')});
    $('btnCalPrev').addEventListener('click',()=>{AppState.ui.calendarDate.setMonth(AppState.ui.calendarDate.getMonth()-1);AppState.ui.calSelectedDay=null;renderizarCalendario()});
    $('btnCalNext').addEventListener('click',()=>{AppState.ui.calendarDate.setMonth(AppState.ui.calendarDate.getMonth()+1);AppState.ui.calSelectedDay=null;renderizarCalendario()});
    $('btnCerrarCalendario').addEventListener('click',()=>cerrarModal('modalCalendario'));

    // Delegación de eventos para contenido dinámico
    document.addEventListener('click',e=>{
        /* Tap en el borde derecho de una tarjeta con límite (últimos 16px) →
           mostrar tip con el % sin abrir el modal de edición del banco */
        const maybeCard=e.target.closest('.banco-mini-card.has-gauge');
        if(maybeCard){
            const rect=maybeCard.getBoundingClientRect();
            const offsetX=e.clientX-rect.left;
            if(offsetX>rect.width-16){
                e.stopPropagation();
                e.preventDefault();
                document.querySelectorAll('.banco-mini-card.show-tip').forEach(c=>{
                    if(c!==maybeCard)c.classList.remove('show-tip');
                });
                maybeCard.classList.add('show-tip');
                clearTimeout(AppState.ui._gaugeTipTimer);
                AppState.ui._gaugeTipTimer=setTimeout(()=>maybeCard.classList.remove('show-tip'),2200);
                return;
            }
        }
        const t=e.target.closest('[data-action]');if(!t)return;
        const a=t.dataset.action,id=parseInt(t.dataset.id),banco=t.dataset.banco,loteId=parseInt(t.dataset.loteId);
        if(a==='eliminar-op')eliminarOperacion(id);
        else if(a==='editar-op')abrirEditarOperacion(id);
        else if(a==='dismiss-news'){const v=t.dataset.version;if(v)descartarNovedad(v)}
        else if(a==='eliminar-mov')eliminarMovimiento(id);
        else if(a==='eliminar-trans')eliminarTransferencia(id);
        else if(a==='eliminar-conv')eliminarConversion(id);
        else if(a==='editar-mov')abrirModalMovimiento(id);
        else if(a==='editar-trans')abrirModalTransferencia(id);
        else if(a==='editar-conv')abrirModalTransferencia(id);
        else if(a==='resumen-view'){
            AppState.ui._resumenView=t.dataset.view||'months';
            cargarHistorialMensual();
        }
        else if(a==='resumen-toggle'){
            /* Click on month header → toggle collapse. Persist state + update DOM without full re-render. */
            const mes=t.closest('.resumen-mes')?.dataset.mes;if(!mes)return;
            AppState.ui._collapsedMonths=AppState.ui._collapsedMonths||{};
            const mesEl=document.querySelector(`.resumen-mes[data-mes="${mes}"]`);
            if(mesEl){
                mesEl.classList.toggle('collapsed');
                AppState.ui._collapsedMonths[mes]=mesEl.classList.contains('collapsed');
            }
        }
        else if(a==='resumen-chart'){
            /* Chart tabs live in .resumen-body (sibling of .resumen-header), no bubbling conflict */
            const mes=t.dataset.mes,chart=t.dataset.chart;if(!mes||!chart)return;
            AppState.ui._chartTypes=AppState.ui._chartTypes||{};
            AppState.ui._chartTypes[mes]=chart;
            /* Re-render: cheap, preserves collapse state via _collapsedMonths */
            cargarHistorialMensual();
        }
        else if(a==='editar-saldo'){if(banco==='USDT'){renderizarInventario();abrirModal('modalInventario')}else{AppState.ui.bancoEditando=banco;$('editarSaldoHeader').innerHTML='Editar '+colorBanco(banco);$('nuevoSaldoBanco').value=fmtNum(AppState.datos.bancos[banco]?.saldo||0);$('limiteDiarioGroup').style.display='block';$('limiteDiarioBanco').value=fmtNum(AppState.datos.bancos[banco]?.limiteDiarioUSD||0,0);abrirModal('modalEditarSaldo')}}
        else if(a==='toggle-banco'){const n=t.dataset.banco;if(!AppState.datos.bancos[n])AppState.datos.bancos[n]={activo:false,saldo:0,limiteDiarioUSD:0,limiteUsadoUSD:0};AppState.datos.bancos[n].activo=!AppState.datos.bancos[n].activo;renderizarListaBancos();actualizarVista();guardaOptimista('update','bancos',n)}
        else if(a==='inventario'){renderizarInventario();abrirModal('modalInventario')}
        else if(a==='editar-lote')abrirEditarLote(loteId);
        else if(a==='usar-tag'){
            const tag=t.dataset.tag,target=t.dataset.target;
            if(tag&&target){const inp=$(target);if(inp){
                /* Toggle: deselect if already selected */
                inp.value=(tagKey(inp.value.trim())===tagKey(tag))?'':tag;
                inp.focus();renderizarTagsSugerencias(target,target==='movDescripcion'?'tagSugerenciasMov':'');
            }}
        }
        else if(a==='tag-crear'){
            const tag=t.dataset.tag,target=t.dataset.target;
            if(tag){agregarTag(tag);const inp=$(target);if(inp){inp.value=tag;inp.focus();renderizarTagsSugerencias(target,target==='movDescripcion'?'tagSugerenciasMov':'')}}
        }
        else if(a==='tag-ver-mas'){
            const target=t.dataset.target;
            AppState.ui._tagShowAll=true;
            if(target)renderizarTagsSugerencias(target,target==='movDescripcion'?'tagSugerenciasMov':'');
        }
        else if(a==='toggle-ops-filters'){
            toggleOpsFilters();
        }
        else if(a==='ops-filter'){
            const filter=t.dataset.filter,val=t.dataset.val;
            if(filter&&val)setOpsFilter(filter,val);
        }
        else if(a==='ops-filter-clear'){
            clearOpsFilters();
        }
        else if(a==='toggle-mov-filters'){toggleMovsFilters()}
        else if(a==='movs-filter'){
            const filter=t.dataset.filter,val=t.dataset.val;
            if(filter&&val)setMovsFilter(filter,val);
        }
        else if(a==='movs-filter-clear'){clearMovsFilters()}
        else if(a==='toggle-trans-filters'){toggleTransFilters()}
        else if(a==='trans-filter'){
            const filter=t.dataset.filter,val=t.dataset.val;
            if(filter&&val)setTransFilter(filter,val);
        }
        else if(a==='trans-filter-clear'){clearTransFilters()}
        else if(a==='split-add'){
            AppState.ui.splitExtras=AppState.ui.splitExtras||[];
            AppState.ui.splitExtras.push({banco:'',monto:0});
            renderSplitPanel();
        }
        else if(a==='split-remove'){
            const idx=parseInt(t.dataset.idx);
            if(isNaN(idx))return;
            AppState.ui.splitExtras.splice(idx,1);
            renderSplitPanel();
        }
        else if(a==='usar-tasa'){
            const v=t.dataset.valor;if(v){$('tasa').value=fmtTasa(parseFloat(v),getMonedaBanco());AppState.ui.tasaManual=true;calcularPreview()}
        }
        else if(a==='tasa-step'){
            const mon=getMonedaBanco();
            const STEP=0.01;
            const dir=t.dataset.dir==='down'?-1:1;
            const cur=parsearTasa($('tasa').value)||0;
            /* Integer-cent math to avoid floating-point drift */
            const cents=Math.round(cur*100)+dir;
            const nuevo=Math.max(0,cents/100);
            $('tasa').value=fmtTasa(nuevo,mon);
            AppState.ui.tasaManual=true;
            calcularPreview();
        }
        else if(a==='editar-tag'){
            const oldTag=t.dataset.tag;if(!oldTag)return;
            const nuevoNombre=prompt('Editar categoría:',oldTag);
            if(nuevoNombre!==null){if(editarTag(oldTag,nuevoNombre)){guardarDatos();renderizarGestionTags()}else{alert('Nombre inválido o ya existe')}}
        }
        else if(a==='merge-tag'){
            const srcTag=t.dataset.tag;if(!srcTag)return;
            abrirModalMergeTag(srcTag);
        }
        else if(a==='merge-select-dest'){
            AppState.ui.mergeSelectedDest=t.dataset.tag||null;
            renderMergeDestinations($('mergeSearch').value||'');
            updateMergeConfirmBox();
        }
        else if(a==='eliminar-tag'){
            const tag=t.dataset.tag;if(!tag)return;
            if(confirm(`¿Eliminar la categoría "${tag}"?`)){eliminarTag(tag);guardarDatos();renderizarGestionTags()}
        }
        else if(a==='tag-periodo'){
            AppState.ui.tagPeriodo=t.dataset.periodo||'total';renderizarGestionTags();
        }
        else if(a==='tag-view'){
            AppState.ui.tagView=t.dataset.view||'dona';renderizarGestionTags();
        }
        else if(a==='cal-day'){
            const ds=t.dataset.date;if(!ds)return;
            if(AppState.ui.calSelectedDay===ds)cerrarDetalleDia();
            else mostrarDetalleDia(ds);
        }
        else if(a==='cal-day-close'){
            cerrarDetalleDia();
        }
        else if(a==='reconnect')reconnectFirebase();
    });

    // Escape cierra modales
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelectorAll('.modal.active').forEach(m=>m.classList.remove('active'));document.body.style.overflow='';$('menuPanel')?.classList.remove('active');$('menuBackdrop')?.classList.remove('active');$('menuBtn')?.classList.remove('active')}});

    // Init
    actualizarFormulario();actualizarColorSelect();instalarErrorBoundary();inicializarFirebase();
    /* Scheduler horario — corre cada 60s pero SOLO cuando la pestaña está visible.
       Evita wake-ups de CPU con app en background (crítico en Android WebView). */
    (function installHourlyTick(){
        let _tickInterval=null;
        let _lastTickDay='';  /* guarda fecha del último tick para evitar trabajo redundante */
        function tick(){
            if(!AppState.currentUser)return;
            if(document.hidden)return;  /* no hacer nada si la pestaña está oculta */
            verificarResetLimites();
            /* actualizarVista solo si cambió el día — evita re-render a cada minuto */
            const hoyStr=getUDateStr();
            if(hoyStr!==_lastTickDay){
                _lastTickDay=hoyStr;
                actualizarVista();
                verificarCambioMes();
            }
        }
        function start(){if(!_tickInterval)_tickInterval=setInterval(tick,60000)}
        function stop(){if(_tickInterval){clearInterval(_tickInterval);_tickInterval=null}}
        start();
        document.addEventListener('visibilitychange',()=>{
            if(document.hidden)stop();
            else{start();tick()}  /* al volver, hacer un tick inmediato */
        });
    })();
});
