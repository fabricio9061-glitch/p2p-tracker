async function guardarEditarOperacion(){
    const op=AppState.datos.operaciones.find(o=>o.id===AppState.ui.opEditandoId);if(!op)return;
    const btn=$('btnGuardarEditOp');if(btn.disabled)return;
    const dividida=esPagoDividido(op);
    /* Con pago dividido, el monto y las cuentas no se editan (ver abrirEditarOperacion) */
    const newM=dividida?op.monto:pv('editOpMonto'),newTa=parsearTasa($('editOpTasa').value),newB=dividida?op.banco:$('editOpBanco').value;
    if(!newM||newM<=0){alert('Monto inválido');return}
    if(!newTa){alert('Tasa inválida');return}
    if(!newB){alert('Seleccioná un banco');return}
    /* No se puede pasar a una cuenta de otra moneda: cambiaría la moneda de la
       operación, su tasa y los lotes que consume. */
    const newBi=getBancoInfo(newB),opMon=op.moneda||'UYU',newMon=newBi?.moneda||'UYU';
    if(newMon!==opMon){alert(`No podés cambiar el banco a una cuenta ${newMon} cuando la operación está en ${opMon}. Eliminá y recreá la operación.`);return}
    const newCpct=_editOpComisionPctLeida(op);
    /* v7.3.0 — Se compara el efecto de la versión vieja con el de la nueva, con la
       misma regla que arma el libro de cada cuenta. */
    const despues={...op,monto:roundMoney(newM),banco:newB};
    if(!confirmarSiQuedaNegativo(diferenciaDeEfecto('operaciones',op,despues),'Con este cambio una cuenta queda en negativo.'))return;
    btn.disabled=true;btn.textContent='Guardando...';
    try{
        op.monto=roundMoney(newM);op.tasa=newTa;op.banco=newB;
        op.comisionPct=newCpct;
        op.usdt=usdtBase(op.monto/op.tasa,op.tipo);
        op.comisionPlataforma=truncar(op.usdt*(newCpct/100),2);
        op.updatedAt=new Date().toISOString();
        cerrarModal('modalEditarOp');AppState.ui.opEditandoId=null;
        confirmarCambios([{tipo:'update',entidad:'operaciones',id:op.id}]);
        showSuccess({amount:fmtMonto(op.monto,op.moneda),message:'Operación actualizada',sub:op.tipo==='compra'?'Compra editada':'Venta editada'});
    }catch(e){console.error('[P2P] Error editando operación:',e)}finally{btn.disabled=false;btn.textContent='Guardar'}
}

/* ═══════════════════════════════════════
   §10 — MOVIMIENTOS
   ═══════════════════════════════════════ */
function abrirModalMovimiento(editId){
    AppState.ui.guardandoMovimiento=false;AppState.ui._tagShowAll=false;
    AppState.ui.movEditandoId=editId||null;
    const editing=!!editId;
    const existing=editing?AppState.datos.movimientos.find(m=>m.id===editId):null;
    if(editing&&!existing){AppState.ui.movEditandoId=null;return}
    /* Header + button labels */
    const header=document.querySelector('#modalMovimiento .modal-header');
    /* v5.6.2 — Se escribía con textContent y pisaba el ícono puesto en la página,
       así que el emoji volvía a aparecer. Mismo caso que el botón de comprar. */
    if(header)header.innerHTML='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>'+(editing?' Editar ajuste':' Ajuste Externo');
    $('btnGuardarMov').textContent=editing?'Guardar cambios':'Guardar';
    $('btnGuardarMov').disabled=false;
    $('btnEliminarMov').style.display=editing?'':'none';
    /* Populate fields */
    if(editing){
        AppState.ui.tipoMovimiento=existing.tipoMovimiento;
        $('movTipoCuenta').value=existing.tipoCuenta;
        $('movMonto').value=fmtNum(existing.monto);
        $('movTasaRef').value=existing.tasaRef?fmtNum(existing.tasaRef):'';
        $('movDescripcion').value=existing.descripcion||'';
    }else{
        AppState.ui.tipoMovimiento='ingreso';
        $('movTipoCuenta').value='banco';$('movMonto').value='';$('movTasaRef').value='';$('movDescripcion').value='';
    }
    $('tabIngreso').className='tab tab-ingreso'+(AppState.ui.tipoMovimiento==='ingreso'?' active':'');
    $('tabEgreso').className='tab tab-egreso'+(AppState.ui.tipoMovimiento==='egreso'?' active':'');
    const _r=$('movResumen');if(_r)_r.style.display='none';
    actualizarCuentasMovimiento();
    if(editing&&existing.tipoCuenta==='banco'){
        /* Select bank after populating options */
        const sel=$('movBanco');
        if(existing.banco&&!Array.from(sel.options).some(o=>o.value===existing.banco)){
            /* Bank may be deactivated — add option temporarily */
            sel.innerHTML+=`<option value="${existing.banco}" style="color:${getBancoColor(existing.banco)};font-weight:600">${existing.banco}</option>`;
        }
        sel.value=existing.banco||'';
    }
    renderizarTagsSugerencias('movDescripcion','tagSugerenciasMov');
    actualizarMovResumen();
    abrirModal('modalMovimiento');
}
function setTipoMovimiento(t){AppState.ui.tipoMovimiento=t;AppState.ui._tagShowAll=false;$('tabIngreso').className='tab tab-ingreso'+(t==='ingreso'?' active':'');$('tabEgreso').className='tab tab-egreso'+(t==='egreso'?' active':'');actualizarCuentasMovimiento();renderizarTagsSugerencias('movDescripcion','tagSugerenciasMov');actualizarMovResumen()}
/* v5.6.3 — El ícono del tipo de cuenta acompaña a la opción elegida. Va fuera
   de la lista porque sus opciones solo aceptan texto. */
const _ICO_TIPO_BANCO='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10h18M4 10V9l8-5 8 5v1M6 10v7M10 10v7M14 10v7M18 10v7M3 20h18"/></svg>';
const _ICO_TIPO_USDT='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v10M9.5 9.5h4a2 2 0 010 4h-4M9.5 13.5h5"/></svg>';
function _pintarIconoTipoCuenta(){
    const el=$('movTipoIcono');if(!el)return;
    el.innerHTML=($('movTipoCuenta')||{}).value==='usdt'?_ICO_TIPO_USDT:_ICO_TIPO_BANCO;
}

function actualizarCuentasMovimiento(){
    _pintarIconoTipoCuenta();
    const tc=$('movTipoCuenta').value;$('movBancoGroup').style.display=tc==='usdt'?'none':'block';setText('movMontoLabel',tc==='usdt'?'Monto (USDT)':'Monto');
    const esUsdtIngreso=tc==='usdt'&&AppState.ui.tipoMovimiento==='ingreso';
    $('movTasaRefGroup').style.display=esUsdtIngreso?'block':'none';
    if(esUsdtIngreso){$('movTasaRef').value=AppState.datos.ultimaTasaCompra?fmtNum(AppState.datos.ultimaTasaCompra):'';setText('movTasaRefLabel','Tasa referencia (precio de compra)')}
    const fp=$('movFifoPreview');if(fp)fp.style.display=tc==='usdt'&&AppState.ui.tipoMovimiento==='egreso'?'block':'none';
    if(tc!=='usdt'){const s=$('movBanco');s.innerHTML='<option value="">Seleccionar banco</option>';getBancosActivos().forEach(b=>{s.innerHTML+=`<option value="${b.nombre}" style="color:${b.color||'#1e293b'};font-weight:600">${b.nombre}</option>`})}
    actualizarFifoPreview();
}
function actualizarFifoPreview(){
    const fp=$('movFifoPreview');if(!fp)return;
    const tc=$('movTipoCuenta').value,m=pv('movMonto');
    if(tc!=='usdt'||AppState.ui.tipoMovimiento!=='egreso'||m<=0){fp.innerHTML='<div style="color:#94a3b8;font-size:0.8em">Ingresá un monto para ver los lotes que se consumirán</div>';return}
    const lots=previewFIFO(m);
    if(!lots.length){fp.innerHTML='<div style="color:#dc2626;font-size:0.8em"><svg class="ico ico-alerta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z"/></svg> Sin lotes disponibles</div>';return}
    let tot=0,h='<div style="font-size:0.75em;color:#64748b;margin-bottom:4px"><b>Lotes FIFO a consumir:</b></div>';
    lots.forEach(l=>{tot+=l.subtotal;h+=`<div style="font-size:0.8em;padding:3px 0;display:flex;justify-content:space-between"><span>${fmtTrunc(l.cantidad,2)} USDT × $${fmtNum(l.precio)}</span><span style="color:#64748b">= $${fmtNum(l.subtotal)}</span></div>`});
    h+=`<div style="font-size:0.8em;padding:5px 0 0;border-top:1px solid #e2e8f0;margin-top:4px;display:flex;justify-content:space-between;font-weight:600"><span>Costo real total:</span><span style="color:#2563eb">$${fmtNum(tot)}</span></div>`;
    fp.innerHTML=h;
}
function actualizarMovResumen(){
    const r=$('movResumen');if(!r)return;
    const tc=$('movTipoCuenta').value,b=$('movBanco').value,m=pv('movMonto');
    const tipo=AppState.ui.tipoMovimiento||'egreso';
    if(!m||m<=0||(tc==='banco'&&!b)){r.style.display='none';return}
    const isIngreso=tipo==='ingreso';
    const verbo=isIngreso?'Se suma':'Se descuenta';
    const prep=isIngreso?'a':'de';
    let target='',monto='';
    if(tc==='usdt'){target='Inventario USDT';monto=fmtTrunc(m,2)+' USDT'}
    else{const bi=getBancoInfo(b);target=b;monto=fmtMonto(m,bi?.moneda)}
    r.className='mov-resumen'+(isIngreso?'':' egreso');
    r.style.display='flex';
    r.innerHTML=`<span class="mov-resumen-icon">${isIngreso?'<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M12 16V3M7 11l5 5 5-5"/></svg>':'<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M12 3v13M7 8l5-5 5 5"/></svg>'}</span><span class="mov-resumen-text">${verbo} <b>${monto}</b> ${prep} <b>${escHtml(target)}</b></span>`;
}

async function guardarMovimiento(){
    if(AppState.ui.guardandoMovimiento||AppState.ui.enCooldown)return;
    const btn=$('btnGuardarMov');if(btn.disabled)return;
    const editId=AppState.ui.movEditandoId;
    const editing=!!editId;
    const original=editing?AppState.datos.movimientos.find(m=>m.id===editId):null;
    if(editing&&!original){AppState.ui.movEditandoId=null;return}
    const tc=$('movTipoCuenta').value,b=$('movBanco').value,m=pv('movMonto'),desc=$('movDescripcion').value.trim(),tRef=tc==='usdt'&&AppState.ui.tipoMovimiento==='ingreso'?pvTasa('movTasaRef'):0;
    if(!m||m<=0)return alert('Monto inválido');if(tc==='banco'&&!b)return alert('Seleccioná un banco');
    if(tc==='usdt'&&AppState.ui.tipoMovimiento==='ingreso'&&(!tRef||tRef<=0))return alert('Ingresá una tasa de referencia válida');
    const mR=tc==='usdt'?truncUsdt(m):roundMoney(m);
    const isIngreso=AppState.ui.tipoMovimiento==='ingreso';
    const nuevo={tipoMovimiento:AppState.ui.tipoMovimiento,tipoCuenta:tc,banco:tc==='banco'?b:null,monto:mR,
                 tasaRef:tc==='usdt'&&isIngreso?tRef:0,descripcion:desc};
    /* INTEGRIDAD — v7.3.0: la validación usa la misma regla que el saldo.
       Un gasto nuevo no puede dejar la cuenta en negativo; al editar uno viejo
       se avisa y se deja decidir. */
    const deltas=diferenciaDeEfecto('movimientos',original,{...(original||{}),...nuevo});
    const usdtAntes=original?efectoEnUsdt('movimientos',original):0;
    const usdtDespues=efectoEnUsdt('movimientos',nuevo);
    if(Math.abs(usdtDespues-usdtAntes)>=0.005){deltas.usdt=roundMoney(usdtDespues-usdtAntes);if(deltas.usdt<0)deltas.usdtMoneda='UYU'}
    if(editing){
        if(!confirmarSiQuedaNegativo(deltas,'Con este cambio algo queda en negativo.'))return;
    }else{
        const valI=validarDeltas(deltas);
        if(!valI.ok){alert('No se puede guardar este ajuste:\n\n'+valI.reason);return}
    }
    AppState.ui.guardandoMovimiento=true;btn.disabled=true;btn.textContent='Guardando...';
    try{
        let id;
        if(editing){
            /* Se modifica en su lugar: conserva id, fecha, hora y marca de tiempo */
            Object.assign(original,nuevo,{updatedAt:new Date().toISOString(),valorUYU:0});
            id=editId;
        }else{
            id=uid();
            AppState.datos.movimientos.unshift({id,...nuevo,valorUYU:0,fecha:getUDateStr(),hora:getUTimeStr(),timestamp:new Date().toISOString()});
        }
        cerrarModal('modalMovimiento');activarCooldown();
        AppState.ui.movEditandoId=null;
        confirmarCambios([{tipo:editing?'update':'create',entidad:'movimientos',id}]);
        const movSy=tc==='usdt'?'':getSym(getBancoInfo(b)?.moneda||'UYU');
        showSuccess({amount:tc==='usdt'?fmtTrunc(mR,2)+' USDT':movSy+fmtNum(mR),message:editing?'Ajuste actualizado':'Ajuste guardado',sub:(isIngreso?'Ingreso':'Egreso')+(tc==='banco'?' · '+b:' · USDT')});
    }catch(e){console.error('[P2P] Error guardando movimiento:',e)}finally{AppState.ui.guardandoMovimiento=false;btn.disabled=false;btn.textContent=AppState.ui.movEditandoId?'Guardar cambios':'Guardar'}
}

async function eliminarMovimiento(id){
    const mv=AppState.datos.movimientos.find(m=>m.id===id);if(!mv)return;
    const txt=(mv.tipoMovimiento==='ingreso'?'el ingreso':'el egreso')+' de '+(mv.tipoCuenta==='usdt'?fmtTrunc(mv.monto,2)+' USDT':fmtMonto(mv.monto,getBancoInfo(mv.banco)?.moneda))+(mv.descripcion?' ('+mv.descripcion+')':'');
    if(!confirm('¿Eliminar '+txt+'?'))return;
    const deltas=diferenciaDeEfecto('movimientos',mv,null);
    const u=-efectoEnUsdt('movimientos',mv);
    if(Math.abs(u)>=0.005){deltas.usdt=u;if(u<0)deltas.usdtMoneda='UYU'}
    if(!confirmarSiQuedaNegativo(deltas,'Sin este ajuste algo queda en negativo.'))return;
    try{
        AppState.datos.movimientos=AppState.datos.movimientos.filter(m=>m.id!==id);
        confirmarCambios([{tipo:'delete',entidad:'movimientos',id}]);
    }catch(e){console.error('[P2P] Error eliminando movimiento:',e)}
}

/* ═══════════════════════════════════════
   §11 — TRANSFERENCIAS (+ CONVERSIÓN INTEGRADA)
   ═══════════════════════════════════════ */
function hayBancosUSD(){return CONFIG.BANCOS.some(b=>AppState.datos.bancos[b.nombre]?.activo&&b.moneda==='USD')}

function esCrossMoneda(){
    const o=$('bancoOrigen')?.value,d=$('bancoDestino')?.value;
    if(!o||!d)return false;
    const oi=getBancoInfo(o),di=getBancoInfo(d);
    return oi&&di&&oi.moneda!==di.moneda;
}

const _ICO_TRANSF='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8"/></svg>';
const _ICO_CONV='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5H6l3-3M9 19h9l-3 3M4 12a8 8 0 018-8M20 12a8 8 0 01-8 8"/></svg>';
/* v7.3.0 — El encabezado se escribía con textContent y un dibujo adentro: en
   pantalla aparecía el código del ícono como texto. */
function actualizarTransfUI(){
    const cross=esCrossMoneda(),tg=$('transfTasaGroup'),pvEl=$('transfConvPreview'),hd=$('transfHeader');
    const editando=!!AppState.ui.transEditandoId;
    tg.style.display=cross?'block':'none';
    const btn=$('btnTransferir');
    if(cross){
        hd.innerHTML=_ICO_CONV+(editando?' Editar conversión':' Conversión entre monedas');
        btn.textContent=editando?'Guardar cambios':'Convertir';btn.classList.add('btn-conv');
    }else{
        hd.innerHTML=_ICO_TRANSF+(editando?' Editar transferencia':' Transferencia entre cuentas');
        btn.textContent=editando?'Guardar cambios':'Transferir';btn.classList.remove('btn-conv');
        pvEl.style.display='none';
    }
    $('comisionTransfGroup').style.display=cross?'none':'block';
    const del=$('btnEliminarTransf');if(del)del.style.display=editando?'':'none';
    actualizarTransfPreview();
}

function actualizarTransfPreview(){
    const pvEl=$('transfConvPreview');if(!esCrossMoneda()){pvEl.style.display='none';return}
    const o=$('bancoOrigen').value,d=$('bancoDestino').value,m=pv('montoTransferencia'),t=pvTasa('transfTasa');
    if(!m||!t){pvEl.style.display='none';return}
    const oi=getBancoInfo(o),di=getBancoInfo(d);
    let recibe;
    if(oi.moneda==='UYU'&&di.moneda==='USD')recibe='US$'+fmtNum(m/t,2);
    else recibe='$'+fmtNum(m*t,2);
    pvEl.style.display='block';
    pvEl.innerHTML=`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8"/></svg> Debita <b>${getSym(oi.moneda)}${fmtNum(m)}</b> de ${colorBanco(o)} → Recibe <b>${recibe}</b> en ${colorBanco(d)}<div style="margin-top:4px;font-size:0.8em;color:#64748b">Solo mueve saldos · No afecta ganancia</div>`;
}

function abrirModalTransferencia(editId){
    AppState.ui.transEditandoId=editId||null;
    const editing=!!editId;
    /* Look up in transferencias OR conversiones (both share this modal) */
    let existing=null,isConv=false;
    if(editing){
        existing=AppState.datos.transferencias.find(t=>t.id===editId);
        if(!existing){existing=AppState.datos.conversiones.find(c=>c.id===editId);isConv=!!existing}
        if(!existing){AppState.ui.transEditandoId=null;return}
    }
    AppState.ui.transEditandoIsConv=isConv;
    const opts='<option value="">Seleccionar</option>'+getBancosActivos().map(b=>`<option value="${b.nombre}" style="color:${b.color||'#1e293b'};font-weight:600">${b.nombre} (${b.moneda})</option>`).join('');
    $('bancoOrigen').innerHTML=opts;$('bancoDestino').innerHTML=opts;
    if(editing){
        const orig=isConv?existing.origen:existing.origen;
        const dest=isConv?existing.destino:existing.destino;
        /* If banks are now deactivated, add options temporarily */
        [orig,dest].forEach(bn=>{
            [$('bancoOrigen'),$('bancoDestino')].forEach(sel=>{
                if(bn&&!Array.from(sel.options).some(o=>o.value===bn)){
                    const bi=getBancoInfo(bn);
                    sel.innerHTML+=`<option value="${bn}" style="color:${getBancoColor(bn)};font-weight:600">${bn}${bi?' ('+bi.moneda+')':''}</option>`;
                }
            });
        });
        $('bancoOrigen').value=orig;
        $('bancoDestino').value=dest;
        $('montoTransferencia').value=fmtNum(isConv?existing.montoOrigen:existing.monto);
        $('comisionTransferencia').value=fmtNum(isConv?0:(existing.comision||0));
        $('transfTasa').value=isConv?fmtNum(existing.tasa):'';
    }else{
        $('montoTransferencia').value='';$('comisionTransferencia').value='0';$('transfTasa').value='';$('transfConvPreview').style.display='none';
    }
    $('saldoOrigenInfo').textContent='';$('btnTransferir').disabled=false;
    ['bancoOrigen','bancoDestino'].forEach(i=>{const v=$(i).value;$(i).style.color=v?getBancoColor(v):'';});
    actualizarTransfUI();
    if(editing)mostrarSaldoOrigen();
    abrirModal('modalTransferencia');
}

/* Crear o editar una transferencia entre cuentas propias, o una conversión
   entre monedas. v7.3.0 — Los saldos y el cupo ya no se tocan a mano en ningún
   camino: se valida con la misma regla del libro y se confirma con
   confirmarCambios, que recalcula todo. Antes, editar revertía el registro
   viejo a mano pero no aplicaba el nuevo, y crear no recalculaba: la pantalla
   mostraba saldos equivocados hasta que respondía el servidor. */
async function realizarTransferencia(){
    if(AppState.ui.enCooldown||AppState.ui.guardandoTransferencia)return;const btn=$('btnTransferir');if(btn.disabled)return;
    const editId=AppState.ui.transEditandoId;
    const editing=!!editId;
    const origIsConv=AppState.ui.transEditandoIsConv;
    const original=editing?(origIsConv?AppState.datos.conversiones.find(c=>c.id===editId):AppState.datos.transferencias.find(t=>t.id===editId)):null;
    if(editing&&!original){AppState.ui.transEditandoId=null;return}
    const o=$('bancoOrigen').value,d=$('bancoDestino').value,m=roundMoney(pv('montoTransferencia')),cross=esCrossMoneda();
    const c=cross?0:roundMoney(pv('comisionTransferencia'));
    if(!o||!d||o===d)return alert('Seleccioná dos cuentas distintas');if(!m||m<=0)return alert('Monto inválido');
    if(c<0)return alert('La comisión no puede ser negativa');
    const t=cross?pvTasa('transfTasa'):0;
    if(cross&&(!t||t<=0))return alert('Ingresá una tasa de conversión válida');
    const oi=getBancoInfo(o),di=getBancoInfo(d);
    const montoRecibido=cross?(oi.moneda==='UYU'&&di.moneda==='USD'?roundMoney(m/t):roundMoney(m*t)):m;
    const nuevaEntidad=cross?'conversiones':'transferencias';
    const nuevo=cross
        ?{origen:o,destino:d,montoOrigen:m,montoDestino:montoRecibido,tasa:t,monedaOrigen:oi.moneda,monedaDestino:di.moneda}
        :{origen:o,destino:d,monto:m,comision:c};
    /* Validación de saldos: el efecto nuevo menos el del registro original */
    const deltas={bancos:{}};
    const sumarDif=dif=>Object.entries(dif.bancos).forEach(([k,v])=>{deltas.bancos[k]=roundMoney((deltas.bancos[k]||0)+v)});
    sumarDif(diferenciaDeEfecto(nuevaEntidad,null,nuevo));
    if(editing)sumarDif(diferenciaDeEfecto(origIsConv?'conversiones':'transferencias',original,null));
    if(editing){
        if(!confirmarSiQuedaNegativo(deltas,'Con este cambio una cuenta queda en negativo.'))return;
    }else{
        const valI=validarDeltas(deltas);
        if(!valI.ok){alert('No se puede '+(cross?'convertir':'transferir')+':\n\n'+valI.reason);return}
    }
    /* Cupo diario de la cuenta de origen (solo transferencias en la misma moneda).
       Una transferencia de antes de la última renovación ya no cuenta para el
       cupo de hoy, así que corregirla no se frena por el cupo. */
    const fechaTr=editing?String(original.fecha||''):getUDateStr();
    if(!cross&&fechaTr>=String(_cupoDesde(o)||'')){
        const disp=cupoDisponibleUSD(o,editing&&!origIsConv?{tipo:'transferencias',id:editId}:null);
        const req=_montoEnUSDLimite(o,m+c);
        if(disp!==Infinity&&req>disp+0.005){alert(`Excede el límite diario de ${o}. Disponible: US$${fmtNum(Math.max(0,disp),0)} (necesitás US$${fmtNum(req,0)})`);return}
    }
    btn.disabled=true;btn.textContent='Guardando...';AppState.ui.guardandoTransferencia=true;
    try{
        const cambios=[];
        let id;
        if(editing){
            id=editId;
            const eraEntidad=origIsConv?'conversiones':'transferencias';
            const base={fecha:original.fecha,hora:original.hora,timestamp:original.timestamp,updatedAt:new Date().toISOString()};
            if(eraEntidad===nuevaEntidad){
                /* Mismo tipo: se modifica en su lugar */
                if(!cross)delete original.tasa;
                Object.assign(original,nuevo,{updatedAt:base.updatedAt});
                cambios.push({tipo:'update',entidad:nuevaEntidad,id});
            }else{
                /* Pasó de transferencia a conversión o al revés: cambia de lista,
                   conserva el id y la fecha */
                AppState.datos[eraEntidad]=AppState.datos[eraEntidad].filter(x=>x.id!==id);
                AppState.datos[nuevaEntidad].unshift({id,...nuevo,...base});
                cambios.push({tipo:'delete',entidad:eraEntidad,id},{tipo:'update',entidad:nuevaEntidad,id});
            }
        }else{
            id=uid();
            AppState.datos[nuevaEntidad].unshift({id,...nuevo,fecha:getUDateStr(),hora:getUTimeStr(),timestamp:new Date().toISOString()});
            cambios.push({tipo:'create',entidad:nuevaEntidad,id});
        }
        cerrarModal('modalTransferencia');activarCooldown();
        AppState.ui.transEditandoId=null;AppState.ui.transEditandoIsConv=false;
        confirmarCambios(cambios);
        showSuccess(cross
            ?{amount:getSym(di.moneda)+fmtNum(montoRecibido),message:editing?'Conversión actualizada':'Conversión realizada',sub:o+' → '+d}
            :{amount:getSym(oi.moneda)+fmtNum(m),message:editing?'Transferencia actualizada':'Transferencia realizada',sub:o+' → '+d});
    }catch(e){console.error('[P2P] Error en transferencia:',e)}finally{AppState.ui.guardandoTransferencia=false;btn.disabled=false;actualizarTransfUI()}
}

async function eliminarTransferencia(id){
    const t=AppState.datos.transferencias.find(x=>x.id===id);if(!t)return;
    const sy=getSym(getBancoInfo(t.origen)?.moneda);
    if(!confirm('¿Eliminar la transferencia de '+sy+fmtNum(t.monto)+' de '+t.origen+' a '+t.destino+'?'))return;
    if(!confirmarSiQuedaNegativo(diferenciaDeEfecto('transferencias',t,null),'Sin esta transferencia una cuenta queda en negativo: probablemente ese dinero ya se usó.'))return;
    try{
        AppState.datos.transferencias=AppState.datos.transferencias.filter(x=>x.id!==id);
        cerrarModal('modalTransferencia');AppState.ui.transEditandoId=null;
        confirmarCambios([{tipo:'delete',entidad:'transferencias',id}]);
    }catch(e){console.error('[P2P] Error eliminando transferencia:',e)}
}

async function eliminarConversion(id){
    const c=AppState.datos.conversiones.find(x=>x.id===id);if(!c)return;
    if(!confirm('¿Eliminar la conversión de '+getSym(c.monedaOrigen)+fmtNum(c.montoOrigen)+' de '+c.origen+' a '+c.destino+'?'))return;
    if(!confirmarSiQuedaNegativo(diferenciaDeEfecto('conversiones',c,null),'Sin esta conversión una cuenta queda en negativo.'))return;
    try{
        AppState.datos.conversiones=AppState.datos.conversiones.filter(x=>x.id!==id);
        cerrarModal('modalTransferencia');AppState.ui.transEditandoId=null;
        confirmarCambios([{tipo:'delete',entidad:'conversiones',id}]);
    }catch(e){console.error('[P2P] Error eliminando conversión:',e)}
}
/* Botón Eliminar dentro del formulario de edición */
function eliminarTransferenciaEnEdicion(){
    const id=AppState.ui.transEditandoId;if(!id)return;
    if(AppState.ui.transEditandoIsConv)eliminarConversion(id);else eliminarTransferencia(id);
}

/* ═══════════════════════════════════════
   §12 — CALENDARIO
   ═══════════════════════════════════════ */
/* Cache for ganancia calculations — invalidated by data version changes.
   Per-moneda slots (Map) para que distintos filtros no se pisen mutuamente. */
const _gananciaCache={diaria:new Map(),total:new Map(),key:null};
function _gananciaCacheKey(monedaFiltro){
    const v=AppState.datos._version||0;
    const opsLen=AppState.datos.operaciones.length,movsLen=AppState.datos.movimientos.length;
    const bump=AppState.ui._cacheBump||0;
    return (monedaFiltro||'_all')+'|'+v+'|'+opsLen+'|'+movsLen+'|'+bump;
}
function invalidarGananciaCache(){
    _gananciaCache.diaria.clear();
    _gananciaCache.total.clear();
    _gananciaCache.key=null;
    AppState.ui._cacheBump=(AppState.ui._cacheBump||0)+1;
}
/* ═══ Ingresos externos (separados de ganancia P2P) ═══
   Suma monto en UYU de TODOS los ingresos registrados desde Ajustes
   (banco UYU, banco USD convertido, USDT con tasaRef).
   No participan en cálculo de ganancia P2P — son una métrica paralela. */
function calcularIngresosExternosDia(fecha){
    if(!fecha)return 0;
    const tasaFb=AppState.datos.ultimaTasaCompra||1;
    let total=0;
    AppState.datos.movimientos.forEach(m=>{
        if(m.tipoMovimiento!=='ingreso'||m.fecha!==fecha)return;
        total=roundMoney(total+movimientoValorUYU(m,tasaFb));
    });
    return total;
}

function calcularGananciaDiaria(monedaFiltro){
    const key=_gananciaCacheKey(monedaFiltro);
    const cached=_gananciaCache.diaria.get(key);
    if(cached)return cached;
    const g={};AppState.datos.operaciones.forEach(op=>{
        if(monedaFiltro&&op.moneda!==monedaFiltro)return;
        if(!monedaFiltro&&op.moneda==='USD')return;
        if(!g[op.fecha])g[op.fecha]=0;if(op.ganancia!==undefined)g[op.fecha]=roundMoney(g[op.fecha]+op.ganancia)});
    if(!monedaFiltro||monedaFiltro==='UYU'){
        const tasaFb=AppState.datos.ultimaTasaCompra||1;
        AppState.datos.movimientos.forEach(mv=>{if(mv.tipoMovimiento==='egreso'){if(!g[mv.fecha])g[mv.fecha]=0;g[mv.fecha]=roundMoney(g[mv.fecha]-movimientoValorUYU(mv,tasaFb))}});
    }
    _gananciaCache.diaria.set(key,g);
    return g;
}
function calcularGananciaTotal(monedaFiltro){
    const key=_gananciaCacheKey(monedaFiltro);
    const cached=_gananciaCache.total.get(key);
    if(cached!==undefined)return cached;
    let g=0;AppState.datos.operaciones.forEach(op=>{
        if(monedaFiltro&&op.moneda!==monedaFiltro)return;
        if(!monedaFiltro&&op.moneda==='USD')return;
        if(op.ganancia!==undefined)g=roundMoney(g+op.ganancia)});
    if(!monedaFiltro||monedaFiltro==='UYU'){
        const tasaFb=AppState.datos.ultimaTasaCompra||1;
        AppState.datos.movimientos.forEach(mv=>{if(mv.tipoMovimiento==='egreso')g=roundMoney(g-movimientoValorUYU(mv,tasaFb))});
    }
    _gananciaCache.total.set(key,g);
    return g;
}

const _dayStatsCache={data:new Map(),key:null};
function getDayStats(fecha){
    if(!fecha)return null;
    const cacheKey=_gananciaCacheKey('_ds');
    if(_dayStatsCache.key!==cacheKey){_dayStatsCache.data.clear();_dayStatsCache.key=cacheKey}
    if(_dayStatsCache.data.has(fecha))return _dayStatsCache.data.get(fecha);
    const ops=AppState.datos.operaciones.filter(o=>o.fecha===fecha&&o.moneda!=='USD');
    const movs=AppState.datos.movimientos.filter(m=>m.fecha===fecha);
    const trans=AppState.datos.transferencias.filter(t=>t.fecha===fecha);
    let compras=0,ventas=0,montoCompras=0,montoVentas=0,gananciaOps=0,sumTasaC=0,sumTasaV=0;
    ops.forEach(op=>{
        if(op.tipo==='compra'){compras++;montoCompras=roundMoney(montoCompras+op.monto);sumTasaC+=op.tasa}
        else{ventas++;montoVentas=roundMoney(montoVentas+op.monto);sumTasaV+=op.tasa}
        gananciaOps=roundMoney(gananciaOps+(op.ganancia||0));
    });
    const tasaPromC=compras?roundMoney(sumTasaC/compras):0;
    const tasaPromV=ventas?roundMoney(sumTasaV/ventas):0;
    const spread=(compras&&ventas)?roundMoney(tasaPromV-tasaPromC):0;
    const tasaFb=AppState.datos.ultimaTasaCompra||1;
    let gastos=0;
    movs.forEach(m=>{if(m.tipoMovimiento==='egreso')gastos=roundMoney(gastos+movimientoValorUYU(m,tasaFb))});
    const gananciaNeta=roundMoney(gananciaOps-gastos);
    const result={fecha,ops:ops.length,compras,ventas,montoCompras,montoVentas,ajustes:movs.length,transferencias:trans.length,spread,gananciaOps,gastos,gananciaNeta,tasaPromC,tasaPromV};
    _dayStatsCache.data.set(fecha,result);
    return result;
}
function mostrarDetalleDia(fecha){
    AppState.ui.calSelectedDay=fecha;
    renderizarCalendario();
}
function cerrarDetalleDia(){
    AppState.ui.calSelectedDay=null;
    renderizarCalendario();
}