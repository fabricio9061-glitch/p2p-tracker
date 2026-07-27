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

/* ─── Detección del estado del doc remoto ─────────────────────────────────────
   Lee el doc directamente con ref.get(). NO usa el listener (que estaría en
   freeze). Pregunta: ¿tiene _wireFormat? Si no, es legacy → recovery candidate.
   Devuelve: {exists, wireFormat, version, sizeApprox} o null si no hay user. */
async function _inspectRemoteDoc(){
    if(!AppState.currentUser||!AppState.db)return null;
    const ref=AppState.db.collection('users').doc(AppState.currentUser.uid);
    try{
        const snap=await ref.get();
        if(!snap.exists)return{exists:false,wireFormat:null,version:0,sizeApprox:0};
        const d=snap.data();
        const sizeApprox=JSON.stringify(d).length;
        return{
            exists:true,
            wireFormat:d._wireFormat||null,
            version:d._version||0,
            sizeApprox,
            countOps:Array.isArray(d.operaciones)?d.operaciones.length:0
        };
    }catch(e){
        RECOVERY_LOG('inspect:failed',{error:String(e&&e.message||e)});
        return null;
    }
}

/* ─── Construcción del payload mínimo de recovery ────────────────────────────
   Estrategia: tomar AppState.datos (memoria expandida, autoritativa), comprimir
   operaciones, escribir set(merge:false) con SOLO los campos que la app necesita.
   
   QUÉ INCLUIMOS:
     - operaciones (comprimidas)
     - movimientos, transferencias, conversiones, bancos, lotes (sin tocar)
     - tags, tasasRecientes, saldoUsdt
     - ultimasTasas (compra/venta/USD)
     - comisionPlataforma, comisionUSD
     - ultimoMesProcesado
     - _version, _wireFormat:'v1'
     - ultimaActualizacion (server timestamp)
   
   QUÉ NO INCLUIMOS (intencionalmente, para mantener el write mínimo):
     - lastSeenVersion (es metadata cosmética del modal "qué hay nuevo")
     - dismissedVersions (mismo motivo)
     - _syncState orphans (residuos de sync)
     - Cualquier campo derivable (lotes top-level, ya stripped en flujo normal) */
function _buildRecoveryPayload(){
    const d=AppState.datos||{};
    /* Strip de campos runtime por op */
    const stripDerived=arr=>Array.isArray(arr)?arr.map(x=>{
        if(!x||typeof x!=='object')return x;
        const{_syncState,consumedLots,ganancia,comisionPlataforma,...rest}=x;
        return rest;
    }):[];
    const stripRuntime=arr=>Array.isArray(arr)?arr.map(x=>{
        if(!x||typeof x!=='object'||!x._syncState)return x;
        const{_syncState,...rest}=x;
        return rest;
    }):[];
    const opsStripped=stripDerived(d.operaciones);
    /* Comprimir operaciones */
    const opsCompr=_compressOpsArrayForWire(opsStripped);
    const newVersion=(AppState._localVersion||0)+1;
    return{
        operaciones:opsCompr,
        movimientos:stripRuntime(d.movimientos),
        transferencias:stripRuntime(d.transferencias),
        conversiones:stripRuntime(d.conversiones||[]),
        bancos:d.bancos||{},
        tags:Array.isArray(d.tags)?d.tags:[],
        tasasRecientes:Array.isArray(d.tasasRecientes)?d.tasasRecientes:[],
        saldoUsdt:typeof d.saldoUsdt==='number'?d.saldoUsdt:0,
        ultimaTasaCompra:d.ultimaTasaCompra||0,
        ultimaTasaVenta:d.ultimaTasaVenta||0,
        ultimaTasaCompraUSD:d.ultimaTasaCompraUSD||0,
        ultimaTasaVentaUSD:d.ultimaTasaVentaUSD||0,
        comisionPlataforma:d.comisionPlataforma!==undefined?d.comisionPlataforma:0.14,
        comisionUSD:d.comisionUSD!==undefined?d.comisionUSD:0.14,
        ultimoMesProcesado:d.ultimoMesProcesado||'',
        /* v4.9.0 — no derivables: lotes manuales/carryover + metadata de archivado */
        lotesManuales:(d.lotes||[]).filter(l=>l&&l.manual&&!l.carryover).map(l=>{const{_syncState,...r}=l;return r}),
        _archivoCarryover:Array.isArray(d._archivoCarryover)?d._archivoCarryover:null,
        _archivoSeeds:d._archivoSeeds||null,
        _archivoIndex:d._archivoIndex||null,
        _version:newVersion,
        _wireFormat:WIRE_FORMAT_VERSION,
        ultimaActualizacion:firebase.firestore.FieldValue.serverTimestamp()
    };
}

/* ─── Validación pre-write completa (condición #4) ───────────────────────────
   Verifica que la compresión preserva integridad ANTES de escribir. Si algo
   falla, NO se escribe nada. */
function _validateRecoveryPayload(payload,snapAntes){
    const errors=[];
    /* 1. Counts coherentes */
    if(!Array.isArray(payload.operaciones)){
        errors.push('operaciones no es array');
        return{ok:false,errors};
    }
    if(payload.operaciones.length!==snapAntes.countOps){
        errors.push('countOps cambió: '+snapAntes.countOps+' → '+payload.operaciones.length);
    }
    /* 2. Round-trip de operaciones */
    let opsRT;
    try{opsRT=_decompressOpsArrayFromWire(payload.operaciones);}
    catch(e){errors.push('decompress falló: '+e.message);return{ok:false,errors}}
    /* 3. Comparar sumas críticas */
    const snapDespues=_capturarSnapshotIntegridad({
        operaciones:opsRT,
        movimientos:payload.movimientos,
        transferencias:payload.transferencias,
        lotes:[],
        bancos:payload.bancos
    });
    const cmp=_compararSnapshotsIntegridad(snapAntes,snapDespues);
    if(!cmp.ok)cmp.diffs.forEach(d=>errors.push('integridad: '+d));
    /* 4. Tamaño del payload — no debe acercarse al 1MB */
    let sizeKB=0;
    try{
        /* serverTimestamp() no es serializable directamente; stub para medir */
        const{ultimaActualizacion,...rest}=payload;
        sizeKB=Math.round(JSON.stringify(rest).length/1024);
    }catch(_){}
    if(sizeKB>900)errors.push('payload demasiado grande: '+sizeKB+' KB');
    /* 5. FIFO sanity — verificar lotes/saldos no rotos
       (No comparamos contra antes porque recovery viene de memoria saneada;
       solo verificamos consistencia interna) */
    return{ok:errors.length===0,errors,sizeKB,snapDespues};
}

/* ─── Verificación POST-write — leer doc remoto y confirmar ──────────────────
   Lee el doc recién escrito con ref.get(). Verifica:
     - existe
     - _wireFormat === 'v1'
     - count operaciones === esperado
     - _version === esperado
     - tamaño aproximado < 700 KB
   Devuelve: {ok, diffs} */
async function _verifyRecoveryWrite(expectedVersion,expectedCount){
    if(!AppState.currentUser||!AppState.db)return{ok:false,diffs:['no user/db']};
    const ref=AppState.db.collection('users').doc(AppState.currentUser.uid);
    try{
        /* Force server-only get para no leer del cache local (que tendría
           el doc viejo si el listener estaba frozen) */
        const snap=await ref.get({source:'server'});
        if(!snap.exists)return{ok:false,diffs:['doc no existe post-write']};
        const d=snap.data();
        const diffs=[];
        if(d._wireFormat!==WIRE_FORMAT_VERSION){
            diffs.push('_wireFormat='+d._wireFormat+' (esperado: '+WIRE_FORMAT_VERSION+')');
        }
        if(!Array.isArray(d.operaciones)){
            diffs.push('operaciones no es array');
        }else if(d.operaciones.length!==expectedCount){
            diffs.push('countOps='+d.operaciones.length+' (esperado: '+expectedCount+')');
        }
        if((d._version||0)!==expectedVersion){
            diffs.push('_version='+(d._version||0)+' (esperado: '+expectedVersion+')');
        }
        const sizeKB=Math.round(JSON.stringify(d).length/1024);
        if(sizeKB>800)diffs.push('payload remoto sigue grande: '+sizeKB+' KB');
        return{ok:diffs.length===0,diffs,sizeKB,version:d._version||0,countOps:Array.isArray(d.operaciones)?d.operaciones.length:0};
    }catch(e){
        return{ok:false,diffs:['get post-write falló: '+(e.message||String(e))]};
    }
}

/* ─── Reset post-recovery exitoso (condición #6) ─────────────────────────────
   Boot limpio sobre el doc nuevo: limpiar caches legacy, resetear syncQueue,
   resetear localDirty, re-suscribir listener. NO recargamos la página entera
   (eso reiniciaría TODA la app y la experiencia sería brusca). Hacemos un
   reset controlado en lugar. */
async function _postRecoveryReset(){
    RECOVERY_LOG('reset:start',{});
    /* 1. Clear syncQueue */
    if(typeof _syncQueue!=='undefined'&&Array.isArray(_syncQueue))_syncQueue.length=0;
    /* 2. Reset localDirty */
    if(typeof _localDirty!=='undefined')_localDirty=0;
    /* 3. Reset flags */
    if(typeof _syncPending!=='undefined')_syncPending=0;
    if(typeof _syncErrors!=='undefined')_syncErrors=0;
    if(typeof _guardando!=='undefined')_guardando=false;
    if(typeof _guardarPendiente!=='undefined')_guardarPendiente=false;
    /* 4. Re-suscribir listener para empezar con stream limpio */
    try{
        if(AppState.unsubscribe){
            AppState.unsubscribe();
            AppState.unsubscribe=null;
        }
    }catch(_){}
    /* 5. Liberar el flag de recovery ANTES de re-suscribir */
    AppState._recoveryActive=false;
    /* 6. Re-suscribir — el snapshot va a llegar con el doc comprimido nuevo */
    try{
        if(typeof cargarDatosUsuario==='function')cargarDatosUsuario();
    }catch(e){
        RECOVERY_LOG('reset:resubscribe-failed',{error:String(e&&e.message||e)});
    }
    RECOVERY_LOG('reset:done',{});
}

/* ─── Write helper con timeout extendido ─────────────────────────────────────
   Wrap de ref.set con timeout configurable y rejection limpia. Usa set(payload)
   plano (no transaction). Si el SDK termina o resuelve, se cancela el timeout. */
function _writeWithTimeout(ref,payload,timeoutMs){
    return new Promise((resolve,reject)=>{
        let done=false;
        const handle=setTimeout(()=>{
            if(done)return;
            done=true;
            reject(new Error('recovery-write-timeout'));
        },timeoutMs);
        ref.set(payload).then(()=>{
            if(done)return;
            done=true;
            clearTimeout(handle);
            resolve();
        }).catch(err=>{
            if(done)return;
            done=true;
            clearTimeout(handle);
            reject(err);
        });
    });
}

/* ─── ORQUESTACIÓN PRINCIPAL: recoveryWrite ──────────────────────────────────
   1. Marcar _recoveryActive (bloquea writes, freeze listener)
   2. Mostrar overlay
   3. Capturar snapshot integridad ANTES
   4. Construir payload comprimido
   5. Validar (round-trip + sumas + tamaño)
   6. Loop de write con backoff: 3 intentos, timeouts 90s, esperas 5/15/30s
   7. Verificar post-write con ref.get({source:'server'})
   8. Si OK: reset limpio
   9. Si falla: modo seguro con UI manual
   
   IMPORTANTE: una sola corrida a la vez. Si ya está activa, return inmediato. */
let _recoveryRunning=false;
async function recoveryWrite(opts){
    if(_recoveryRunning){
        RECOVERY_LOG('start:already-running',{});
        return{ok:false,reason:'already-running'};
    }
    _recoveryRunning=true;
    AppState._recoveryActive=true;
    const trigger=opts&&opts.trigger||'auto';
    RECOVERY_LOG('start',{trigger,memOps:(AppState.datos&&AppState.datos.operaciones||[]).length});
    _ensureRecoveryOverlay();
    _setRecoveryPhase('Verificando integridad local…');
    _setRecoveryMeta(1,3);
    /* ── Fase 1: snapshot integridad ANTES ── */
    let snapAntes;
    try{
        snapAntes=_capturarSnapshotIntegridad({
            operaciones:AppState.datos.operaciones||[],
            movimientos:AppState.datos.movimientos||[],
            transferencias:AppState.datos.transferencias||[],
            lotes:[],
            bancos:AppState.datos.bancos||{}
        });
        RECOVERY_LOG('snap-antes',{countOps:snapAntes.countOps,sumUsdt:snapAntes.sumUsdt.toFixed(2)});
    }catch(e){
        RECOVERY_LOG('snap-antes:failed',{error:String(e&&e.message||e)});
        _enterSafeMode('Error capturando snapshot inicial: '+(e&&e.message||e));
        _recoveryRunning=false;
        return{ok:false,reason:'snap-antes-failed'};
    }
    /* ── Fase 2: construir + validar payload ── */
    _setRecoveryPhase('Comprimiendo datos…');
    let payload,validation;
    try{
        payload=_buildRecoveryPayload();
        validation=_validateRecoveryPayload(payload,snapAntes);
        RECOVERY_LOG('payload-built',{
            ops:payload.operaciones.length,
            sizeKB:validation.sizeKB,
            valid:validation.ok
        });
    }catch(e){
        RECOVERY_LOG('payload-build:failed',{error:String(e&&e.message||e)});
        _enterSafeMode('Error construyendo payload: '+(e&&e.message||e));
        _recoveryRunning=false;
        return{ok:false,reason:'build-failed'};
    }
    if(!validation.ok){
        RECOVERY_LOG('payload-invalid',{errors:validation.errors});
        _enterSafeMode('Validación pre-write falló:\n• '+validation.errors.join('\n• '));
        _recoveryRunning=false;
        return{ok:false,reason:'validation-failed',errors:validation.errors};
    }
    /* ═══ v4.9.1 — Cortar el loop condenado ANTES de escribir ═══
       Si el payload YA COMPRIMIDO supera 800 KB, el write va a "funcionar"
       pero la verificación post-write (<800 KB) va a fallar SIEMPRE: era el
       loop "Escribiendo 851 KB → Optimización falló" en cadena. La compresión
       no puede achicar lo ya comprimido — la única salida real es archivar.
       Se salta con opts.force (escape hatch consciente). */
    if(validation.sizeKB>800&&typeof window.archivarHistorial==='function'&&!(opts&&opts.force)){
        RECOVERY_LOG('pre-block:too-big',{sizeKB:validation.sizeKB});
        _enterSafeMode('El documento comprimido pesa '+validation.sizeKB+' KB (límite de verificación: 800 KB).\n\nReescribirlo no puede achicarlo: la compresión ya está aplicada. La solución es mover los meses viejos a documentos separados con el botón de abajo.');
        _recoveryRunning=false;
        return{ok:false,reason:'too-big-use-archive',sizeKB:validation.sizeKB};
    }
    /* ── Fase 3: loop de write con backoff ── */
    const RETRY_DELAYS=[5000,15000,30000];
    const MAX_ATTEMPTS=3;
    const WRITE_TIMEOUT=90000;
    const ref=AppState.db.collection('users').doc(AppState.currentUser.uid);
    let lastError=null;
    let writeOk=false;
    for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
        _setRecoveryPhase('Escribiendo snapshot ('+validation.sizeKB+' KB)…');
        _setRecoveryMeta(attempt,MAX_ATTEMPTS);
        RECOVERY_LOG('write-start',{attempt,maxAttempts:MAX_ATTEMPTS,sizeKB:validation.sizeKB});
        const tStart=performance.now();
        try{
            await _writeWithTimeout(ref,payload,WRITE_TIMEOUT);
            const ms=Math.round(performance.now()-tStart);
            RECOVERY_LOG('write-confirmed',{attempt,ms});
            writeOk=true;
            break;
        }catch(err){
            const ms=Math.round(performance.now()-tStart);
            lastError=err;
            const errCode=err&&err.code||'';
            const errMsg=err&&err.message||String(err);
            RECOVERY_LOG('write-failed',{attempt,ms,errCode,errMsg});
            if(attempt<MAX_ATTEMPTS){
                _setRecoveryPhase('Reintento en '+(RETRY_DELAYS[attempt-1]/1000)+'s…');
                await new Promise(res=>setTimeout(res,RETRY_DELAYS[attempt-1]));
            }
        }
    }
    if(!writeOk){
        RECOVERY_LOG('failed-all-attempts',{lastError:String(lastError)});
        _enterSafeMode('No se pudo escribir el snapshot comprimido después de '+
            MAX_ATTEMPTS+' intentos.\nÚltimo error: '+
            (lastError&&lastError.message||String(lastError)));
        _recoveryRunning=false;
        return{ok:false,reason:'write-failed',error:lastError};
    }
    /* ── Fase 4: verificación post-write ── */
    _setRecoveryPhase('Verificando integridad remota…');
    await new Promise(res=>setTimeout(res,1500));/* breathing room */
    const verification=await _verifyRecoveryWrite(payload._version,payload.operaciones.length);
    RECOVERY_LOG('verify',verification);
    if(!verification.ok){
        _enterSafeMode('Verificación post-write falló:\n• '+verification.diffs.join('\n• '));
        _recoveryRunning=false;
        return{ok:false,reason:'verify-failed',diffs:verification.diffs};
    }
    /* ── Fase 5: reset limpio ── */
    _setRecoveryPhase('Sincronizando estado limpio…');
    AppState._localVersion=verification.version;
    if(AppState.datos)AppState.datos._version=verification.version;
    /* Limpiar backup local viejo si existe — el doc nuevo es la fuente de verdad */
    try{
        if(typeof clearLocalBackup==='function')clearLocalBackup();
    }catch(_){}
    await _postRecoveryReset();
    _setRecoveryPhase('✓ Listo. Optimización completada.');
    RECOVERY_LOG('success',{
        sizeBefore:opts&&opts.sizeBefore||null,
        sizeAfter:verification.sizeKB,
        version:verification.version,
        countOps:verification.countOps
    });
    /* Esperar 1.5s para que el usuario vea el ✓ antes de cerrar */
    setTimeout(()=>{_hideRecoveryOverlay();_recoveryRunning=false},1500);
    return{ok:true,sizeKB:verification.sizeKB,version:verification.version};
}

/* ─── Entrar a modo seguro ───────────────────────────────────────────────────
   Bloquea TODO. Muestra al usuario opciones manuales. */
function _enterSafeMode(reasonText){
    AppState._recoveryActive=false;/* recovery terminó (mal) */
    AppState._recoverySafeMode=true;/* pero quedamos bloqueados */
    RECOVERY_LOG('safemode:enter',{reason:reasonText});
    _setRecoveryError(
        'Recovery falló',
        reasonText,
        [
            {label:'📦 Archivar historial (recomendado)',color:'#059669',onClick:()=>{
                /* v4.9.0 — Si recovery falla por tamaño (doc ya comprimido >800 KB),
                   reintentar recovery es un loop: la salida real es archivar. */
                if(typeof window.archivarHistorial==='function'){
                    AppState._recoverySafeMode=false;
                    _hideRecoveryOverlay();
                    setTimeout(()=>window.archivarHistorial({trigger:'safemode'}),200);
                }else alert('Módulo de archivado no cargado (15-archivo.js).');
            }},
            {label:'🔄 Reintentar recovery',color:'#3b82f6',onClick:()=>{
                AppState._recoverySafeMode=false;
                _hideRecoveryOverlay();
                setTimeout(()=>recoveryWrite({trigger:'manual-retry'}),300);
            }},
            {label:'📤 Exportar estado actual (JSON)',color:'#16a34a',onClick:()=>{
                try{
                    if(typeof exportarDatos==='function')exportarDatos();
                    else alert('Función de exportar no disponible. Anotá los datos críticos manualmente.');
                }catch(e){alert('Error exportando: '+(e.message||e))}
            }},
            {label:'♻️ Restaurar desde backup local',color:'#a855f7',onClick:()=>{
                /* v4.9.4 — backup pre-archivado detectado → advertir explícitamente */
                let _msj='Esto sobrescribe el estado actual con el último backup local. ¿Continuar?';
                try{
                    const _b=restoreFromLocal();
                    if(_b&&_b.datos&&!_b.datos._archivoIndex&&typeof _archivoMarkerGet==='function'&&_archivoMarkerGet()){
                        _msj='⚠️ Este backup es ANTERIOR al archivado (contiene todos los meses viejos). Restaurarlo y sincronizar desharía el archivado y volvería al límite de 1 MB.\n\nSolo continuá si sabés lo que hacés. ¿Restaurar igual?';
                    }
                }catch(_){}
                if(!confirm(_msj))return;
                try{
                    if(typeof restoreFromLocal==='function'){
                        const b=restoreFromLocal();
                        if(b&&b.datos){
                            AppState.datos=b.datos;
                            AppState._localVersion=b.v||0;
                            alert('Backup restaurado a memoria. Reintentá recovery cuando quieras.');
                        }else alert('No hay backup local disponible.');
                    }
                }catch(e){alert('Error restaurando: '+(e.message||e))}
            }},
            {label:'❌ Cerrar (queda en modo seguro)',color:'#64748b',onClick:()=>{
                _hideRecoveryOverlay();
                /* _recoverySafeMode sigue true — writes seguirán bloqueados hasta
                   que el usuario haga un reintento exitoso o recargue la página */
            }}
        ]
    );
}

/* ─── Detección automática inicial ───────────────────────────────────────────
   Se llama UNA vez después del primer snapshot exitoso. Si el doc remoto NO
   tiene _wireFormat y memoria tiene ops, dispara recovery automáticamente. */
let _autoCheckDone=false;
async function _autoCheckRecoveryNeeded(){
    if(_autoCheckDone)return;
    _autoCheckDone=true;
    /* Esperar a que la app esté estable */
    if(!AppState.currentUser||!AppState.db)return;
    if(!AppState.datos||!Array.isArray(AppState.datos.operaciones))return;
    if(AppState.datos.operaciones.length===0)return;/* fresh user, nada que migrar */
    /* Pequeña espera para que el bootstrap termine */
    await new Promise(res=>setTimeout(res,2500));
    /* Re-chequear que no se inició otra recovery */
    if(_recoveryRunning||AppState._recoveryActive)return;
    /* Inspeccionar doc remoto */
    const info=await _inspectRemoteDoc();
    if(!info){
        RECOVERY_LOG('auto-check:inspect-null',{});
        return;
    }
    if(!info.exists){
        RECOVERY_LOG('auto-check:remote-empty',{});
        return;
    }
    if(info.wireFormat===WIRE_FORMAT_VERSION){
        RECOVERY_LOG('auto-check:already-compressed',{sizeKB:Math.round(info.sizeApprox/1024)});
        return;
    }
    /* Doc remoto legacy detectado */
    RECOVERY_LOG('auto-check:legacy-detected',{
        sizeKB:Math.round(info.sizeApprox/1024),
        countOps:info.countOps,
        version:info.version
    });
    /* Dispará recovery */
    recoveryWrite({trigger:'auto-detect',sizeBefore:Math.round(info.sizeApprox/1024)});
}

/* ─── Guard permanente post-recovery — payload > 850 KB ──────────────────────
   Si en algún momento el payload local proyectado supera 850 KB, bloquear
   nuevos writes y alertar. Nunca más zona crítica silenciosa. */
function _checkPayloadGuard(payloadKB){
    if(payloadKB>850&&!AppState._payloadGuardTriggered){
        AppState._payloadGuardTriggered=true;
        AppState._recoverySafeMode=true;/* freno los writes */
        RECOVERY_LOG('payload-guard:tripped',{payloadKB});
        try{
            _setRecoveryError(
                '⚠️ Payload crítico ('+payloadKB+' KB)',
                'El tamaño del documento se acercó al límite de Firestore. Writes bloqueados preventivamente.',
                [
                    {label:'📦 Archivar historial (recomendado)',color:'#059669',onClick:()=>{
                        /* v4.9.0 — Solución definitiva: mueve meses viejos a docs
                           separados. El guard queda liberado por el propio flujo. */
                        if(typeof window.archivarHistorial==='function'){
                            _hideRecoveryOverlay();
                            setTimeout(()=>window.archivarHistorial({trigger:'guard'}),200);
                        }else alert('Módulo de archivado no cargado (15-archivo.js).');
                    }},
                    {label:'📤 Exportar backup',color:'#16a34a',onClick:()=>{
                        try{if(typeof exportarDatos==='function')exportarDatos()}catch(_){}
                    }},
                    {label:'🔧 Forzar recovery write',color:'#3b82f6',onClick:()=>{
                        AppState._recoverySafeMode=false;
                        AppState._payloadGuardTriggered=false;
                        _hideRecoveryOverlay();
                        setTimeout(()=>recoveryWrite({trigger:'guard-trip'}),300);
                    }},
                    {label:'❌ Continuar de todas formas',color:'#64748b',onClick:()=>{
                        AppState._recoverySafeMode=false;
                        _hideRecoveryOverlay();
                    }}
                ]
            );
        }catch(_){}
    }
}

/* ─── Exposición pública ─────────────────────────────────────────────────────
   Para que el botón de Diagnóstico pueda dispararlo manualmente. */
window.recoveryWrite=recoveryWrite;
/* v4.9.0 — hooks de UI del overlay para el módulo de archivado (15) */
window._recoveryUI={
    ensure:_ensureRecoveryOverlay,
    hide:_hideRecoveryOverlay,
    setPhase:_setRecoveryPhase,
    setMeta:_setRecoveryMeta,
    error:_setRecoveryError
};
window._inspectRemoteDoc=_inspectRemoteDoc;
window._checkPayloadGuard=_checkPayloadGuard;

/* Auto-check al cargar — espera 4 segundos después de DOMContentLoaded para
   que el primer snapshot ya haya hidratado memoria */
if(document.readyState==='complete'||document.readyState==='interactive'){
    setTimeout(_autoCheckRecoveryNeeded,4000);
}else{
    document.addEventListener('DOMContentLoaded',()=>setTimeout(_autoCheckRecoveryNeeded,4000));
}

})();
