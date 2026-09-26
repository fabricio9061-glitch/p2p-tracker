/* ═══════════════════════════════════════════════════════════════════════════
   §14 — CONEXIÓN DE LA PANTALLA
   ═══════════════════════════════════════════════════════════════════════════ */
/* Cerrar sesión: se sube lo pendiente y se vacía todo lo del usuario saliente,
   para que otra persona que entre en el mismo teléfono no vea nada suyo. */
function cerrarSesion(){
    if(!confirm('¿Cerrar sesión?'))return;
    flushGuardaDebounce().finally(()=>{
        if(AppState.unsubscribe){AppState.unsubscribe();AppState.unsubscribe=null}
        try{if(window._v2sync)window._v2sync.detach()}catch(_){}
        AppState._schema=undefined;AppState._localVersion=0;AppState._datosStale=false;
        _guardando=false;_guardarPendiente=false;_syncPending=0;_syncErrors=0;
        backupToLocal._lastSig=null;clearTimeout(_retryTimer);
        AppState.datos=crearDatosVacios();
        AppState._restoredFrom=null;
        AppState._uiHydratedFromCache=false;
        _syncQueue.length=0;
        AppState.auth.signOut();
    });
}

/* Renovación del cupo mientras la app está abierta: recalcula y guarda */
function revisarRenovacionCupos(){
    if(verificarResetLimites()){
        recalcularCuposDiarios();
        guardaOptimista('update','bancos','renovacion-cupo');
        actualizarVista();
    }
}

document.addEventListener('DOMContentLoaded',()=>{
    // Auth
    $('tabLogin').addEventListener('click',()=>{$('tabLogin').classList.add('active');$('tabRegister').classList.remove('active');$('loginForm').style.display='block';$('registerForm').style.display='none';$('authError').classList.remove('show')});
    $('tabRegister').addEventListener('click',()=>{$('tabRegister').classList.add('active');$('tabLogin').classList.remove('active');$('registerForm').style.display='block';$('loginForm').style.display='none';$('authError').classList.remove('show')});
    $('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('authError').classList.remove('show');const u=$('loginUser').value.trim(),p=$('loginPass').value,b=$('loginBtn');b.disabled=true;b.textContent='Entrando...';try{await AppState.auth.signInWithEmailAndPassword(userToEmail(u),p)}catch(er){$('authError').textContent='Usuario o contraseña incorrectos';$('authError').classList.add('show');b.disabled=false;b.textContent='Iniciar Sesión'}});
    $('registerForm').addEventListener('submit',async e=>{e.preventDefault();$('authError').classList.remove('show');const u=$('regUser').value.trim(),p=$('regPass').value,p2=$('regPassConfirm').value,ae=$('authError');
        if(!/^[a-zA-Z0-9_-]{3,20}$/.test(u)){ae.textContent='Usuario inválido';ae.classList.add('show');return}if(p.length<6){ae.textContent='Mínimo 6 caracteres';ae.classList.add('show');return}if(p!==p2){ae.textContent='No coinciden';ae.classList.add('show');return}
        const b=$('registerBtn');b.disabled=true;b.textContent='Creando...';try{await AppState.auth.createUserWithEmailAndPassword(userToEmail(u),p)}catch(er){ae.textContent=er.code==='auth/email-already-in-use'?'Usuario ya existe':'Error';ae.classList.add('show');b.disabled=false;b.textContent='Crear Cuenta'}});

    /* ─── Menú (pantalla completa en el teléfono) ─── */
    function abrirMenuPanel(){
        $('menuPanel').classList.add('active');
        $('menuBackdrop').classList.add('active');
        $('menuBtn').classList.add('active');
        $('menuBtn').setAttribute('aria-expanded','true');
        document.body.style.overflow='hidden';
        const name=$('menuUserName').textContent||'U';
        $('menuUserAvatar').textContent=(name[0]||'U').toUpperCase();
        _pintarResumenMenu();
    }
    function cerrarMenuPanel(){
        $('menuPanel').classList.remove('active');
        $('menuBackdrop').classList.remove('active');
        $('menuBtn').classList.remove('active');
        $('menuBtn').setAttribute('aria-expanded','false');
        if(!document.querySelector('.modal.active'))document.body.style.overflow='';
    }
    /* Datos de un vistazo en el menú: cuántas cuentas en uso y el USDT */
    function _pintarResumenMenu(){
        const n=Object.values(AppState.datos.bancos||{}).filter(b=>b&&b.activo).length;
        setText('menuDatoCuentas',n?n+' en uso':'');
        setText('menuDatoLotes',fmtTrunc(Math.max(0,AppState.datos.saldoUsdt||0),2));
        const arch=AppState.datos._archivoIndex&&AppState.datos._archivoIndex.meses&&Object.keys(AppState.datos._archivoIndex.meses).length;
        const filaArch=$('menuFilaArchivo');if(filaArch)filaArch.style.display=arch?'':'none';
    }
    $('menuBtn').addEventListener('click',e=>{e.stopPropagation();if($('menuPanel').classList.contains('active'))cerrarMenuPanel();else abrirMenuPanel()});
    $('menuBack').addEventListener('click',cerrarMenuPanel);
    $('menuBackdrop').addEventListener('click',cerrarMenuPanel);
    setText('menuVersion',CONFIG.APP_VERSION);

    // Móvil: tocar el encabezado (flecha de volver) cierra el modal
    document.addEventListener('click',e=>{
        if(window.innerWidth>=768)return;
        const header=e.target.closest('.modal.active .modal-header');
        if(!header)return;
        const modal=header.closest('.modal');
        if(modal&&modal.id)cerrarModal(modal.id);
    });

    // Toggle sections
    document.querySelectorAll('.toggle-header').forEach(h=>h.addEventListener('click',e=>{
        if(e.target.closest('.ops-filtros-trigger'))return;
        h.closest('.toggle-section')?.classList.toggle('open');
    }));

    // Formulario — Toggle compra/venta
    function setTipoOp(v){$('tipo').value=v;AppState.ui.tasaManual=false;AppState.ui.ultimoMonedaBanco=null;actualizarFormulario();actualizarColorSelect()}
    $('opToggleCompra').addEventListener('click',()=>setTipoOp('compra'));
    $('opToggleVenta').addEventListener('click',()=>setTipoOp('venta'));
    $('tipo').addEventListener('change',()=>{AppState.ui.tasaManual=false;AppState.ui.ultimoMonedaBanco=null;AppState.ui.splitExtras=[];actualizarFormulario();actualizarColorSelect();renderSplitPanel()});
    $('monto').addEventListener('input',()=>{calcularPreview();renderSplitPanel()});
    $('tasa').addEventListener('input',()=>{AppState.ui.tasaManual=true;calcularPreview();renderSplitPanel();renderizarTasasRecientes()});
    $('banco').addEventListener('change',()=>{AppState.ui.splitExtras=[];mostrarSaldoBanco();actualizarFormulario();actualizarColorBancoSelect();renderSplitPanel();
        _marcarBancoPendiente();_updateBtnGuardarState()});
    $('comisionBanco').addEventListener('input',()=>{calcularPreview();renderSplitPanel()});
    /* Pago dividido: selects e inputs internos */
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
            /* Formato es-UY (coma decimal, punto de miles), igual que el resto */
            AppState.ui.splitExtras[idx].monto=parseMonto(el.value);
            _updateSplitStatus();   /* sin redibujar todo, para no perder el foco */
        }
    });
    $('comisionPlataforma').addEventListener('input',guardarComisionYCalcular);
    $('comisionPlataforma').addEventListener('blur',()=>{
        /* Si quedó inválido al salir, vuelve al último valor guardado (0 incluido) */
        const inp=$('comisionPlataforma');
        const v=parsearComisionPct(inp.value.replace(',','.').trim());
        if(v===null){
            inp.value=fmtNum(comisionConfigurada(getMonedaBanco()));
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

    // Ajuste externo
    $('tabIngreso').addEventListener('click',()=>setTipoMovimiento('ingreso'));
    $('tabEgreso').addEventListener('click',()=>setTipoMovimiento('egreso'));
    $('movTipoCuenta').addEventListener('change',()=>{actualizarCuentasMovimiento();actualizarMovResumen()});
    $('movBanco').addEventListener('change',()=>{const v=$('movBanco').value;$('movBanco').style.color=v?getBancoColor(v):'#1e293b';$('movBanco').style.fontWeight=v?'600':'400';actualizarMovResumen()});
    $('btnGuardarMov').addEventListener('click',guardarMovimiento);
    $('btnCancelMov').addEventListener('click',()=>{AppState.ui.movEditandoId=null;cerrarModal('modalMovimiento')});
    $('btnEliminarMov').addEventListener('click',()=>{const id=AppState.ui.movEditandoId;if(!id)return;cerrarModal('modalMovimiento');AppState.ui.movEditandoId=null;eliminarMovimiento(id)});
    $('movMonto').addEventListener('input',()=>{actualizarFifoPreview();actualizarMovResumen()});
    $('movDescripcion').addEventListener('input',()=>{AppState.ui._tagShowAll=false;renderizarTagsSugerencias('movDescripcion','tagSugerenciasMov')});

    // Cuentas
    $('btnCerrarBancos').addEventListener('click',()=>{cerrarModal('modalBancos');actualizarVista()});

    // Transferencias
    $('bancoOrigen').addEventListener('change',()=>{const v=$('bancoOrigen').value;$('bancoOrigen').style.color=v?getBancoColor(v):'#1e293b';mostrarSaldoOrigen();actualizarTransfUI()});
    $('bancoDestino').addEventListener('change',()=>{const v=$('bancoDestino').value;$('bancoDestino').style.color=v?getBancoColor(v):'#1e293b';actualizarTransfUI()});
    $('montoTransferencia').addEventListener('input',actualizarTransfPreview);
    $('transfTasa').addEventListener('input',actualizarTransfPreview);
    $('btnTransferir').addEventListener('click',realizarTransferencia);
    $('btnCancelTransf').addEventListener('click',()=>{AppState.ui.transEditandoId=null;AppState.ui.transEditandoIsConv=false;cerrarModal('modalTransferencia')});
    $('btnEliminarTransf').addEventListener('click',eliminarTransferenciaEnEdicion);

    /* ─── Saldo y límite de una cuenta ─── */
    $('btnCancelSaldo').addEventListener('click',()=>{cerrarModal('modalEditarSaldo');AppState.ui.bancoEditando=null});
    function _abrirEditarSaldo(banco){
        if(!banco||!AppState.datos.bancos[banco])return;
        AppState.ui.bancoEditando=banco;
        const bk=AppState.datos.bancos[banco];
        const sym=getSym(getBancoInfo(banco)&&getBancoInfo(banco).moneda);
        $('editarSaldoHeader').innerHTML='Editar '+colorBanco(banco);
        setText('saldoRegistrado',sym+fmtNum(bk.saldo||0,2));
        $('nuevoSaldoBanco').value=fmtNum(bk.saldo||0);
        $('motivoAjuste').value='';
        $('limiteDiarioGroup').style.display='block';
        $('limiteDiarioBanco').value=fmtNum(bk.limiteDiarioUSD||0,0);
        _pintarDiasReset(banco);
        _actualizarDiferenciaSaldo();
        abrirModal('modalEditarSaldo');
    }
    /* Muestra en vivo la diferencia que se va a registrar */
    function _actualizarDiferenciaSaldo(){
        const banco=AppState.ui.bancoEditando;if(!banco)return;
        const bk=AppState.datos.bancos[banco];if(!bk)return;
        const sym=getSym(getBancoInfo(banco)&&getBancoInfo(banco).moneda);
        const nuevo=roundMoney(pv('nuevoSaldoBanco'));
        const dif=roundMoney(nuevo-roundMoney(bk.saldo||0));
        const caja=$('saldoDiffBox'),grupo=$('motivoAjusteGroup'),val=$('saldoDiff');
        const hay=Math.abs(dif)>=0.005;
        if(caja)caja.style.display=hay?'flex':'none';
        if(grupo)grupo.style.display=hay?'block':'none';
        if(val){
            val.textContent=(dif>0?'+':'-')+sym+fmtNum(Math.abs(dif),2);
            val.className=dif>0?'sube':'baja';
        }
        $('btnGuardarSaldo').textContent=hay?'Registrar corrección':'Guardar';
    }
    $('nuevoSaldoBanco').addEventListener('input',_actualizarDiferenciaSaldo);

    /* v5.7.1 — Días en que renueva el cupo. Los marcados renuevan; los que quedan
       sin marcar siguen usando el del último día marcado. Siempre queda al menos
       uno: si no, el límite no se renovaría nunca. */
    function _pintarDiasReset(banco){
        const cont=$('diasResetBanco');if(!cont)return;
        const grupo=$('diasResetGroup');
        const lim=AppState.datos.bancos[banco]?.limiteDiarioUSD||0;
        if(grupo)grupo.style.display=lim>0?'block':'none';
        const activos=getDiasReset(banco);
        cont.innerHTML=DIAS_SEMANA.map((d,i)=>
            `<button type="button" data-dia="${i}" class="${activos.includes(i)?'on':''}" `+
            `title="${DIAS_SEMANA_LARGO[i]}" aria-pressed="${activos.includes(i)}">${d}</button>`).join('');
    }
    function _leerDiasReset(){
        const cont=$('diasResetBanco');if(!cont)return[0,1,2,3,4,5,6];
        const on=[...cont.querySelectorAll('button.on')].map(b=>parseInt(b.dataset.dia,10));
        return on.length?on.sort((a,b)=>a-b):[0,1,2,3,4,5,6];
    }
    $('diasResetBanco').addEventListener('click',e=>{
        const b=e.target.closest('button[data-dia]');if(!b)return;
        e.preventDefault();
        const marcados=$('diasResetBanco').querySelectorAll('button.on').length;
        if(b.classList.contains('on')&&marcados<=1)return;
        b.classList.toggle('on');
        b.setAttribute('aria-pressed',b.classList.contains('on'));
    });
    $('limiteDiarioBanco').addEventListener('input',()=>{
        const g=$('diasResetGroup');if(g)g.style.display=pv('limiteDiarioBanco')>0?'block':'none';
    });
    /* Guardar: el límite y los días van en la configuración de la cuenta; una
       diferencia de saldo queda como corrección con su motivo. El saldo no se
       pisa: lo recalcula el motor, así que operaciones, ganancias y estadísticas
       quedan intactas. v7.3.0 — Y se recalcula en el momento. */
    $('btnGuardarSaldo').addEventListener('click',()=>{
        const n=AppState.ui.bancoEditando;
        if(!n||!AppState.datos.bancos[n]){cerrarModal('modalEditarSaldo');return}
        const bk=AppState.datos.bancos[n];
        const lim=roundMoney(pv('limiteDiarioBanco'));
        if(lim<0){alert('El límite no puede ser negativo');return}
        bk.limiteDiarioUSD=lim;
        bk.diasReset=_leerDiasReset();
        const cambios=[{tipo:'update',entidad:'bancos',id:n}];
        const aj=registrarAjusteSaldo(n,roundMoney(pv('nuevoSaldoBanco')),$('motivoAjuste').value);
        if(aj)cambios.push({tipo:'create',entidad:'ajustesSaldo',id:aj.id});
        cerrarModal('modalEditarSaldo');AppState.ui.bancoEditando=null;
        confirmarCambios(cambios);
        if($('modalBancos').classList.contains('active'))renderizarListaBancos();
    });

    /* ─── Corrección de saldo (editar o borrar desde el libro) ─── */
    $('ajusteSaldoSuma').addEventListener('click',()=>{AppState.ui.ajusteSigno='suma';_pintarSignoAjuste()});
    $('ajusteSaldoResta').addEventListener('click',()=>{AppState.ui.ajusteSigno='resta';_pintarSignoAjuste()});
    $('btnGuardarAjusteSaldo').addEventListener('click',guardarAjusteSaldo);
    $('btnCancelAjusteSaldo').addEventListener('click',()=>{cerrarModal('modalAjusteSaldo');AppState.ui.ajusteEditandoId=null});
    $('btnEliminarAjusteSaldo').addEventListener('click',()=>{if(AppState.ui.ajusteEditandoId)eliminarAjusteSaldo(AppState.ui.ajusteEditandoId)});

    // Lotes
    $('btnAgregarLote').addEventListener('click',()=>abrirEditarLote(null));
    $('btnCerrarInventario').addEventListener('click',()=>cerrarModal('modalInventario'));
    $('btnCancelLote').addEventListener('click',()=>{cerrarModal('modalEditarLote');AppState.ui.loteEditandoId=null});
    $('btnEliminarLote').addEventListener('click',eliminarLoteActual);
    $('btnGuardarLote').addEventListener('click',guardarLote);

    // Categorías
    $('btnCerrarTags').addEventListener('click',()=>cerrarModal('modalGestionTags'));
    $('btnCancelMerge').addEventListener('click',()=>cerrarModal('modalMergeTag'));
    $('btnConfirmMerge').addEventListener('click',confirmarFusion);
    $('mergeTabExisting').addEventListener('click',()=>setMergeTab('existing'));
    $('mergeTabNew').addEventListener('click',()=>setMergeTab('new'));
    $('mergeSearch').addEventListener('input',e=>renderMergeDestinations(e.target.value));
    $('mergeNewName').addEventListener('input',updateMergeConfirmBox);
    $('tagSearch').addEventListener('input',renderizarGestionTags);

    // Resumen, novedades, calendario
    $('btnCerrarHistorial').addEventListener('click',()=>cerrarModal('modalHistorial'));
    $('newsBellBtn').addEventListener('click',e=>{e.stopPropagation();abrirCentroNoticias()});
    $('btnCerrarNoticias').addEventListener('click',()=>cerrarModal('modalNoticias'));
    $('btnCalPrev').addEventListener('click',()=>{AppState.ui.calendarDate.setMonth(AppState.ui.calendarDate.getMonth()-1);AppState.ui.calSelectedDay=null;renderizarCalendario()});
    $('btnCalNext').addEventListener('click',()=>{AppState.ui.calendarDate.setMonth(AppState.ui.calendarDate.getMonth()+1);AppState.ui.calSelectedDay=null;renderizarCalendario()});
    $('btnCerrarCalendario').addEventListener('click',()=>cerrarModal('modalCalendario'));

    // Editar operación
    $('btnCancelEditOp').addEventListener('click',()=>{cerrarModal('modalEditarOp');AppState.ui.opEditandoId=null});
    $('btnGuardarEditOp').addEventListener('click',guardarEditarOperacion);
    $('btnEliminarEditOp').addEventListener('click',()=>{const id=AppState.ui.opEditandoId;if(!id)return;cerrarModal('modalEditarOp');AppState.ui.opEditandoId=null;eliminarOperacion(id)});
    $('editOpMonto').addEventListener('input',calcularEditOpPreview);
    $('editOpTasa').addEventListener('input',calcularEditOpPreview);
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
            inp.value=fmtNum(op.comisionPct!==undefined?op.comisionPct:comisionConfigurada(op.moneda));
            inp.classList.remove('error');
            calcularEditOpPreview();
        }
    });
    $('editOpBanco').addEventListener('change',()=>{const v=$('editOpBanco').value;$('editOpBanco').style.color=v?getBancoColor(v):'#1e293b';$('editOpBanco').style.fontWeight=v?'600':'400'});

    /* ═══ v7.3.0 — Una sola tabla de acciones para toda la pantalla ═══
       Había dos escuchas: una solo para el menú y otra para el resto. Una acción
       que existía en una no existía en la otra: el botón "Nuevo ajuste" que
       aparece cuando la lista está vacía no hacía nada, porque su acción solo la
       conocía el menú. Ahora todos los botones pasan por la misma tabla, y los
       que están dentro del menú además lo cierran. */
    const ACCIONES={
        /* Menú */
        'calendario':()=>{AppState.ui.calendarDate=new Date();AppState.ui.calSelectedDay=null;renderizarCalendario();abrirModal('modalCalendario')},
        'inventario':()=>{renderizarInventario();abrirModal('modalInventario')},
        'movimiento':()=>abrirModalMovimiento(),
        'bancos':()=>{renderizarListaBancos();abrirModal('modalBancos')},
        'transferencia':()=>abrirModalTransferencia(),
        'gestion-tags':()=>{renderizarGestionTags();abrirModal('modalGestionTags')},
        'historial-mensual':()=>cargarHistorialMensual(),
        'restaurar-respaldo':()=>restaurarRespaldoManual(),
        'exportar-datos':()=>exportarDatos(),
        'importar-datos':()=>importarDatos(),
        'archivar':()=>archivarDesdeMenu(),
        'ver-archivo':()=>verArchivo(),
        'borrar-todo':()=>borrarTodo(),
        'cerrar-sesion':()=>cerrarSesion(),
        'reconnect':()=>reconnectFirebase(),
        /* Listas */
        'eliminar-op':(t,id)=>eliminarOperacion(id),
        'editar-op':(t,id)=>abrirEditarOperacion(id),
        'eliminar-mov':(t,id)=>eliminarMovimiento(id),
        'editar-mov':(t,id)=>abrirModalMovimiento(id),
        'eliminar-trans':(t,id)=>eliminarTransferencia(id),
        'editar-trans':(t,id)=>abrirModalTransferencia(id),
        'eliminar-conv':(t,id)=>eliminarConversion(id),
        'editar-conv':(t,id)=>abrirModalTransferencia(id),
        'ir-nueva-operacion':()=>{
            const sec=$('seccionNuevaOp');
            if(sec&&!sec.classList.contains('open'))sec.classList.add('open');
            const m=$('monto');
            if(m){m.scrollIntoView({block:'center',behavior:'smooth'});setTimeout(()=>m.focus(),300)}
        },
        /* Novedades */
        'dismiss-news':t=>{const v=t.dataset.version;if(v)descartarNovedad(v)},
        /* Verificar y reconciliar (también se abre desde Lotes) */
        'reconciliar':()=>{cerrarModal('modalInventario');setTimeout(()=>reconciliarTodo(),120)},
        'cerrar-reconciliar':()=>cerrarModal('modalReconciliar'),
        'rec-imponer':()=>{
            /* v6.8.0 — Reemplaza lo de la nube con lo de este dispositivo. Se muestra
               lo que se va a subir para comprobar que es el dispositivo correcto. */
            const d=AppState.datos||{};
            const resumen=Object.keys(d.bancos||{}).filter(n=>(d.bancos[n]||{}).activo).map(n=>
                '  '+n+': '+fmtNum((d.bancos[n]||{}).saldo||0,2)).join('\n');
            const n1=(d.operaciones||[]).length,n2=(d.movimientos||[]).length,
                  n3=(d.transferencias||[]).length,n4=(d.ajustesSaldo||[]).length;
            if(!confirm('Vas a reemplazar lo guardado en la nube con lo de ESTE dispositivo.\n\n'+
                'Saldos que se van a imponer:\n'+resumen+
                '\n\nUSDT: '+fmtTrunc(d.saldoUsdt||0,2)+
                '\nRegistros: '+n1+' operaciones · '+n2+' ajustes · '+n3+' transferencias · '+n4+' correcciones\n\n'+
                'Los otros dispositivos van a quedar con estos datos al recargar.\n'+
                'Comprobá que los saldos de arriba sean los correctos antes de continuar.'))return;
            cerrarModal('modalReconciliar');
            Promise.resolve(window._v2sync.subirTodo({motivo:'imponer-dispositivo'}))
                .then(()=>alert('Listo. Se subieron los datos de este dispositivo.\n\nAbrí el otro dispositivo y recargá la página para que tome estos valores.'))
                .catch(e=>alert('No se pudo completar la subida.\n\n'+(e&&e.message||e)));
        },
        'rec-servidor':()=>{cerrarModal('modalReconciliar');setTimeout(()=>verificarIntegridad(),120)},
        'rec-arrastre':()=>{cerrarModal('modalReconciliar');setTimeout(()=>repararCarryover(),120)},
        'rec-borrar-dup':(t,id)=>{
            /* Se borra con la misma función que el botón de la lista (que pide
               confirmación), y después se vuelve a verificar. */
            const tipo=t.dataset.tipo;
            const borrar={movimientos:eliminarMovimiento,operaciones:eliminarOperacion,transferencias:eliminarTransferencia,
                          conversiones:eliminarConversion,ajustesSaldo:eliminarAjusteSaldo}[tipo];
            if(!borrar){alert('No se pudo borrar desde acá. Buscalo en su lista y borralo con el botón de la fila.');return}
            Promise.resolve(borrar(id)).then(()=>setTimeout(()=>reconciliarTodo(),350));
        },
        /* Resumen mensual */
        'resumen-view':t=>{AppState.ui._resumenView=t.dataset.view||'months';cargarHistorialMensual()},
        'resumen-toggle':t=>{
            const mes=t.closest('.resumen-mes')?.dataset.mes;if(!mes)return;
            AppState.ui._collapsedMonths=AppState.ui._collapsedMonths||{};
            const mesEl=document.querySelector(`.resumen-mes[data-mes="${mes}"]`);
            if(mesEl){mesEl.classList.toggle('collapsed');AppState.ui._collapsedMonths[mes]=mesEl.classList.contains('collapsed')}
        },
        'resumen-chart':t=>{
            const mes=t.dataset.mes,chart=t.dataset.chart;if(!mes||!chart)return;
            AppState.ui._chartTypes=AppState.ui._chartTypes||{};
            AppState.ui._chartTypes[mes]=chart;
            cargarHistorialMensual();
        },
        /* Libro de cada cuenta */
        'editar-saldo':t=>{const b=t.dataset.banco;if(b==='USDT'){renderizarInventario();abrirModal('modalInventario')}else abrirMovimientosCuenta(b)},
        'movs-usdt':()=>{cerrarModal('modalInventario');setTimeout(()=>abrirMovimientosCuenta('USDT'),120)},
        'movs-cuenta-todo':()=>{_movsCuentaTodo=true;_pintarMovimientosCuenta()},
        'cerrar-movs-cuenta':()=>cerrarModal('modalMovsCuenta'),
        'movc-abrir':t=>abrirRegistroDelLibro(t.dataset.tipo,t.dataset.id),
        'corregir-saldo':t=>{
            const b=t.dataset.banco||_movsCuentaActual;
            if(!t.dataset.banco)cerrarModal('modalMovsCuenta');
            setTimeout(()=>_abrirEditarSaldo(b),t.dataset.banco?0:120);
        },
        'toggle-banco':t=>{
            const n=t.dataset.banco;
            if(!AppState.datos.bancos[n])AppState.datos.bancos[n]={activo:false,saldo:0,limiteDiarioUSD:0,limiteUsadoUSD:0};
            AppState.datos.bancos[n].activo=!AppState.datos.bancos[n].activo;
            confirmarCambios([{tipo:'update',entidad:'bancos',id:n}]);
            renderizarListaBancos();
        },
        'editar-lote':t=>abrirEditarLote(t.dataset.loteId),
        /* Categorías */
        'usar-tag':t=>{
            const tag=t.dataset.tag,target=t.dataset.target;
            const inp=tag&&target?$(target):null;if(!inp)return;
            inp.value=(tagKey(inp.value.trim())===tagKey(tag))?'':tag;   /* tocar de nuevo la quita */
            inp.focus();renderizarTagsSugerencias(target,'tagSugerenciasMov');
        },
        'tag-crear':t=>{
            const tag=t.dataset.tag,target=t.dataset.target;if(!tag)return;
            agregarTag(tag);
            const inp=$(target);if(inp){inp.value=tag;inp.focus();renderizarTagsSugerencias(target,'tagSugerenciasMov')}
        },
        'tag-ver-mas':t=>{AppState.ui._tagShowAll=true;const target=t.dataset.target;if(target)renderizarTagsSugerencias(target,'tagSugerenciasMov')},
        'editar-tag':t=>{
            const oldTag=t.dataset.tag;if(!oldTag)return;
            const nuevoNombre=prompt('Nuevo nombre de la categoría:',oldTag);
            if(nuevoNombre===null)return;
            if(editarTag(oldTag,nuevoNombre))renderizarGestionTags();
            else alert('Nombre inválido o ya existe');
        },
        'merge-tag':t=>{const srcTag=t.dataset.tag;if(srcTag)abrirModalMergeTag(srcTag)},
        'merge-select-dest':t=>{AppState.ui.mergeSelectedDest=t.dataset.tag||null;renderMergeDestinations($('mergeSearch').value||'');updateMergeConfirmBox()},
        'eliminar-tag':t=>{
            const tag=t.dataset.tag;if(!tag)return;
            if(confirm(`¿Eliminar la categoría "${tag}"?\n\nLos ajustes que la usan no se borran y conservan su descripción.`)){eliminarTag(tag);renderizarGestionTags()}
        },
        'tag-periodo':t=>{AppState.ui.tagPeriodo=t.dataset.periodo||'total';renderizarGestionTags()},
        'tag-view':t=>{AppState.ui.tagView=t.dataset.view||'dona';renderizarGestionTags()},
        /* Filtros */
        'toggle-ops-filters':()=>toggleOpsFilters(),
        'ops-filter':t=>{const f=t.dataset.filter,v=t.dataset.val;if(f&&v)setOpsFilter(f,v)},
        'ops-filter-clear':()=>clearOpsFilters(),
        'toggle-mov-filters':()=>toggleMovsFilters(),
        'movs-filter':t=>{const f=t.dataset.filter,v=t.dataset.val;if(f&&v)setMovsFilter(f,v)},
        'movs-filter-clear':()=>clearMovsFilters(),
        'toggle-trans-filters':()=>toggleTransFilters(),
        'trans-filter':t=>{const f=t.dataset.filter,v=t.dataset.val;if(f&&v)setTransFilter(f,v)},
        'trans-filter-clear':()=>clearTransFilters(),
        /* Pago dividido y tasa */
        'split-add':()=>{AppState.ui.splitExtras=AppState.ui.splitExtras||[];AppState.ui.splitExtras.push({banco:'',monto:0});renderSplitPanel()},
        'split-remove':t=>{const idx=parseInt(t.dataset.idx);if(isNaN(idx))return;AppState.ui.splitExtras.splice(idx,1);renderSplitPanel()},
        'usar-tasa':t=>{
            const v=t.dataset.valor;if(!v)return;
            $('tasa').value=fmtTasa(parseFloat(v),getMonedaBanco());AppState.ui.tasaManual=true;
            calcularPreview();renderSplitPanel();renderizarTasasRecientes();
        },
        'tasa-step':t=>{
            const dir=t.dataset.dir==='down'?-1:1;
            const cur=parsearTasa($('tasa').value)||0;
            const nuevo=Math.max(0,(Math.round(cur*100)+dir)/100);   /* en centésimos, sin error de coma flotante */
            $('tasa').value=fmtTasa(nuevo,getMonedaBanco());
            AppState.ui.tasaManual=true;
            calcularPreview();renderSplitPanel();renderizarTasasRecientes();
        },
        /* Calendario */
        'cal-day':t=>{const ds=t.dataset.date;if(!ds)return;if(AppState.ui.calSelectedDay===ds)cerrarDetalleDia();else mostrarDetalleDia(ds)},
        'cal-day-close':()=>cerrarDetalleDia()
    };
    document.addEventListener('click',e=>{
        /* Tap en el borde derecho de una tarjeta con límite (últimos 16px) →
           mostrar el porcentaje usado sin abrir la cuenta */
        const maybeCard=e.target.closest('.banco-mini-card.has-gauge');
        if(maybeCard){
            const rect=maybeCard.getBoundingClientRect();
            if(e.clientX-rect.left>rect.width-16){
                e.stopPropagation();e.preventDefault();
                document.querySelectorAll('.banco-mini-card.show-tip').forEach(c=>{if(c!==maybeCard)c.classList.remove('show-tip')});
                maybeCard.classList.add('show-tip');
                clearTimeout(AppState.ui._gaugeTipTimer);
                AppState.ui._gaugeTipTimer=setTimeout(()=>maybeCard.classList.remove('show-tip'),2200);
                return;
            }
        }
        const t=e.target.closest('[data-action]');if(!t)return;
        const fn=ACCIONES[t.dataset.action];if(!fn)return;
        if(t.closest('#menuPanel'))cerrarMenuPanel();
        fn(t,parseInt(t.dataset.id),e);
    });
    /* Accesible con teclado: Enter o espacio sobre una fila con acción */
    document.addEventListener('keydown',e=>{
        if(e.key!=='Enter'&&e.key!==' ')return;
        const t=e.target.closest&&e.target.closest('[data-action][role="button"],.menu-row[data-action]');
        if(!t||/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName))return;
        e.preventDefault();t.click();
    });

    // Escape cierra modales y menú
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelectorAll('.modal.active').forEach(m=>cerrarModal(m.id));cerrarMenuPanel()}});

    // Inicio
    actualizarFormulario();actualizarColorSelect();instalarErrorBoundary();inicializarFirebase();
    /* Revisión cada minuto, SOLO con la pestaña visible (no despierta el teléfono
       en segundo plano): renovación del cupo y cambio de día. */
    (function installHourlyTick(){
        let _tickInterval=null;
        let _lastTickDay='';
        function tick(){
            if(!AppState.currentUser)return;
            if(document.hidden)return;
            /* v7.3.0 — La renovación de las 0:30 cambiaba la fecha pero no
               recalculaba el consumo ni se guardaba: el cupo viejo seguía
               bloqueando compras hasta el próximo cambio. */
            revisarRenovacionCupos();
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
            else{start();tick()}  /* al volver, revisar enseguida */
        });
    })();
});

/* ═══════════════════════════════════════════════════════════════════════════
   CARTEL DE PROGRESO — lo usan el archivado (15), la migración y la subida
   total (16): bloquea la pantalla mientras corre un proceso largo y muestra en
   qué fase está.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

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
            '<div id="recoveryIcon" style="margin-bottom:8px;color:#fbbf24"><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/></svg></div>'+
            '<div style="font-size:1.15em;font-weight:700;color:#fbbf24;margin-bottom:12px;'+
                'line-height:1.3">Procesando tus datos</div>'+
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
    const icon=document.getElementById('recoveryIcon');if(icon)icon.innerHTML='<svg class="ico ico-alerta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 100-18 9 9 0 000 18zM9 9h6v6H9z"/></svg>';
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

window._recoveryUI={
    ensure:_ensureRecoveryOverlay,
    hide:_hideRecoveryOverlay,
    setPhase:_setRecoveryPhase,
    setMeta:_setRecoveryMeta,
    error:_setRecoveryError
};

})();
