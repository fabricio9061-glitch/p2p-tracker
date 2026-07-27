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
        else if(a==='borrar-todo')borrarTodo();
        else if(a==='cerrar-sesion'){if(confirm('¿Cerrar sesión?')){flushGuardaDebounce().finally(()=>{if(AppState.unsubscribe){AppState.unsubscribe();AppState.unsubscribe=null}try{if(window._v2sync)window._v2sync.detach()}catch(_){}AppState._schema=undefined;AppState._localVersion=0;AppState._datosStale=false;AppState._legacyMigrado=false;_guardando=false;_guardarPendiente=false;_syncPending=0;_syncErrors=0;_localDirty=0;backupToLocal._lastSig=null;clearTimeout(_retryTimer);
            /* v4.8.2 FIX: vaciar el estado en RAM y la sync queue al cerrar sesión.
               Antes AppState.datos conservaba los datos del usuario saliente: si otra
               persona iniciaba sesión en el mismo dispositivo, el watchdog de 3s podía
               renderizar esos datos ajenos antes del primer snapshot, y las entradas
               viejas de _syncQueue contaminaban el merge del usuario nuevo. */
            AppState.datos=crearDatosVacios();
            AppState._restoredFrom=null;
            AppState._uiHydratedFromCache=false;
            _syncQueue.length=0;
            AppState.auth.signOut()})}}
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
    /* v4.7.44: botones de monto rápido. Setea el input y dispara el mismo
       flujo que una escritura manual (calcularPreview + renderSplitPanel).
       "Otro" limpia y enfoca el campo para entrada libre. */
    /* v4.7.56: quick-amounts eliminados del HTML (decisión operativa del
       usuario — no usa montos redondos en su flujo de 40 ops/día).
       La función wireQuickAmounts y sus listeners se retiraron para no
       dejar código muerto. La pieza que quita la "selección" al tipear
       en #monto también se removió porque ya no hay selección que quitar. */
    /* v4.7.55: "Ver detalle ›" en la tarjeta GANANCIA HOY → abrir calendario.
       El handler global del menú panel no lo capturaba porque el botón vive
       en el home, fuera de #menuPanel. Lo conecto directo y reuso la MISMA
       lógica que la entrada del menú (consistencia: mismo enfoque al hoy). */
    (function wireHoyDetalleBtn(){
        const btn=$('hoyDetalleBtn');if(!btn)return;
        btn.addEventListener('click',()=>{
            try{
                AppState.ui.calendarDate=new Date();
                AppState.ui.calSelectedDay=null;
                renderizarCalendario();
                abrirModal('modalCalendario');
                if(typeof _syncLog==='function')_syncLog('ui:ver-detalle-calendario',{from:'hero'});
            }catch(e){
                console.warn('[P2P] ver-detalle (no crítico):',e&&e.message);
            }
        });
    })();
    $('tasa').addEventListener('input',()=>{AppState.ui.tasaManual=true;calcularPreview();/* v4.7.59: cambio de tasa puede activar/desactivar split */ renderSplitPanel();/* v4.7.62: re-evaluar pill activa */ renderizarTasasRecientes()});
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
            const v=t.dataset.valor;if(v){$('tasa').value=fmtTasa(parseFloat(v),getMonedaBanco());AppState.ui.tasaManual=true;calcularPreview();/* v4.7.59: re-evaluar split tras cambio de tasa */ renderSplitPanel();/* v4.7.62: re-evaluar pill activa */ renderizarTasasRecientes()}
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
            /* v4.7.59: re-evaluar split tras cambio de tasa */
            renderSplitPanel();
            /* v4.7.62: re-evaluar pill activa */
            renderizarTasasRecientes();
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

/* ═══════════════════════════════════════════════════════════════════════════════
   §RECOVERY-WRITE v4.7.64 — Migración controlada legacy → comprimido
   ═══════════════════════════════════════════════════════════════════════════════
   PROBLEMA QUE RESUELVE:
   El doc remoto quedó en estado degradado (~951 KB legacy) después de múltiples
   resource-exhausted/timeouts. v4.7.63 implementó compresión wire que reduce el
   payload a ~537 KB, pero el flujo normal de sync no logra completar el primer
   write comprimido encima del doc legacy gigante (Firestore aplica throttling).
   
   ESTRATEGIA:
   1. Detectar al cargar: doc remoto sin _wireFormat + memoria con ops → recovery
   2. Bloquear TODOS los writes (queue, listener, telemetry, config, banners)
   3. Hacer UN write dedicado, sin transaction, sin metadata extra, sin queue
   4. Timeout 90s + retries 3x con backoff 5s/15s/30s
   5. Verificar leyendo el doc post-write: _wireFormat, count, sumas
   6. Si OK: forzar reload limpio (cache reset + listener re-subscribe)
   7. Si falla: modo seguro con UI de restauración manual
   
   NO se llama solo (excepto detección automática inicial). El usuario también
   puede dispararlo manualmente desde Diagnóstico.
   ═══════════════════════════════════════════════════════════════════════════════ */

(function setupRecoveryWrite(){
'use strict';

const RECOVERY_LOG=(ev,data)=>{
    /* Log dedicado con prefijo "recovery:" para que sea fácilmente filtrable en
       el diagnóstico. Reusa _syncLog para que aparezca en el mismo buffer. */
    try{
        if(typeof _syncLog==='function')_syncLog('recovery:'+ev,data||{});
        else console.log('[P2P recovery]',ev,data||{});
    }catch(_){}
};

/* ─── UI Overlay bloqueante ───────────────────────────────────────────────────
   Overlay full-screen con z-index máximo. Mientras está visible, el usuario no
   puede interactuar con NADA de la app. Muestra: fase, retry count, conexión. */
function _ensureRecoveryOverlay(){
    let el=document.getElementById('recoveryOverlay');
    if(el)return el;
    el=document.createElement('div');
    el.id='recoveryOverlay';
    el.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.96);'+
        'display:flex;align-items:center;justify-content:center;padding:20px;'+
        'font-family:-apple-system,system-ui,sans-serif;color:#e2e8f0';
    el.innerHTML=
        '<div style="max-width:380px;width:100%;background:#1e293b;border-radius:14px;'+
        'padding:24px;box-shadow:0 25px 50px rgba(0,0,0,0.5);text-align:center">'+
            '<div id="recoveryIcon" style="font-size:48px;margin-bottom:8px">⚠️</div>'+
            '<div style="font-size:1.15em;font-weight:700;color:#fbbf24;margin-bottom:12px;'+
                'line-height:1.3">Optimización crítica de base de datos en progreso</div>'+
            '<div style="font-size:0.68em;color:#475569;margin:-8px 0 10px">v'+CONFIG.APP_VERSION+'</div>'+
            '<div id="recoverySubtitle" style="font-size:0.9em;color:#cbd5e1;margin-bottom:18px;line-height:1.45">'+
                'No cierres la app ni cambies de pestaña. La operación puede tardar hasta un minuto.</div>'+
            '<div id="recoverySpinner" style="display:inline-block;width:40px;height:40px;'+
                'border:4px solid #334155;border-top-color:#3b82f6;border-radius:50%;'+
                'animation:rwspin 0.9s linear infinite;margin-bottom:16px"></div>'+
            '<div id="recoveryPhase" style="font-size:0.88em;color:#94a3b8;'+
                'background:#0f172a;padding:10px 12px;border-radius:8px;margin-bottom:8px;'+
                'min-height:42px;display:flex;align-items:center;justify-content:center">'+
                'Inicializando…</div>'+
            '<div id="recoveryMeta" style="font-size:0.72em;color:#64748b;margin-top:6px">'+
                'Intento 1 · Conexión: verificando</div>'+
            '<div id="recoveryActions" style="margin-top:18px;display:none"></div>'+
        '</div>';
    /* Spinner keyframes inline una sola vez */
    if(!document.getElementById('rwspinStyle')){
        const s=document.createElement('style');
        s.id='rwspinStyle';
        s.textContent='@keyframes rwspin{to{transform:rotate(360deg)}}';
        document.head.appendChild(s);
    }
    document.body.appendChild(el);
    return el;
}
function _setRecoveryPhase(text){
    const p=document.getElementById('recoveryPhase');
    if(p)p.textContent=text;
}
function _setRecoveryMeta(attempt,maxAttempts){
    const m=document.getElementById('recoveryMeta');
    if(m){
        const conn=navigator.onLine?'OK':'sin conexión';
        m.textContent='Intento '+attempt+'/'+maxAttempts+' · Conexión: '+conn;
    }
}
function _hideRecoveryOverlay(){
    const el=document.getElementById('recoveryOverlay');
    if(el)el.remove();
}
function _setRecoveryError(title,desc,actions){
    /* Cambia el overlay a modo error con opciones manuales */
    const el=_ensureRecoveryOverlay();
    const icon=document.getElementById('recoveryIcon');if(icon)icon.textContent='🛑';
    const spinner=document.getElementById('recoverySpinner');if(spinner)spinner.style.display='none';
    const phase=document.getElementById('recoveryPhase');
    if(phase){
        phase.style.background='#7f1d1d';
        phase.style.color='#fecaca';
        phase.textContent=desc;
    }
    /* El header amarillo de "Optimización en progreso" → rojo */
    const card=el.querySelector('div > div:nth-child(2)');
    if(card){card.style.color='#fca5a5';card.textContent=title}
    /* v4.9.3 — target por id: el selector posicional (nth-child) pisaba el
       sello de versión y dejaba visible el subtítulo viejo en el estado de error */
    const sub=document.getElementById('recoverySubtitle');
    if(sub)sub.textContent='Restauración manual requerida.';
    const meta=document.getElementById('recoveryMeta');if(meta)meta.style.display='none';
    const ac=document.getElementById('recoveryActions');
    if(ac&&Array.isArray(actions)){
        ac.style.display='block';
        ac.innerHTML='';
        actions.forEach(a=>{
            const b=document.createElement('button');
            b.textContent=a.label;
            b.style.cssText='display:block;width:100%;margin-bottom:8px;padding:11px 14px;'+
                'border:none;border-radius:8px;font-size:0.92em;font-weight:600;cursor:pointer;'+
                'background:'+(a.color||'#475569')+';color:#fff';
            b.addEventListener('click',a.onClick);
            ac.appendChild(b);
        });
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   RETIRADO EN v5.1.0 — maquinaria del documento único
   ═══════════════════════════════════════════════════════════════════════════
   Acá vivían recoveryWrite, el payload guard, el modo seguro y sus auxiliares:
   ~500 líneas cuyo único propósito era mantener UN documento gigante por debajo
   del límite de 1 MiB de Firestore (recomprimir, verificar tamaño, bloquear
   escrituras preventivamente, reintentar).

   En el modelo v2 el documento de estado pesa menos de 1 KB y no crece con la
   historia: nada de esto puede activarse ni tiene qué reparar. Se conserva solo
   el overlay de progreso (_recoveryUI), que reutilizan el archivado (15), la
   migración y la subida total (16).

   Marcha atrás: si hiciera falta volver al documento único, revertir en git a
   la v5.0.1 (que trae esta maquinaria y revertirAV1) y ejecutar revertirAV1().
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Exposición pública ─────────────────────────────────────────────────────
   Para que el botón de Diagnóstico pueda dispararlo manualmente. */
/* Hooks del overlay de progreso — los usan el archivado (15), la migración y la
   subida total (16). Es lo único que sobrevive de este módulo. */
window._recoveryUI={
    ensure:_ensureRecoveryOverlay,
    hide:_hideRecoveryOverlay,
    setPhase:_setRecoveryPhase,
    setMeta:_setRecoveryMeta,
    error:_setRecoveryError
};

})();
