async function guardarEditarOperacion(){
    const op=AppState.datos.operaciones.find(o=>o.id===AppState.ui.opEditandoId);if(!op)return;
    const btn=$('btnGuardarEditOp');if(btn.disabled)return;
    const newM=pv('editOpMonto'),newTa=parsearTasa($('editOpTasa').value),newB=$('editOpBanco').value;
    if(!newM||newM<=0){alert('Monto inválido');return}
    if(!newTa){alert('Tasa inválida');return}
    if(!newB){alert('Seleccioná un banco');return}
    /* Guard: no permitir cambio de banco a una moneda distinta — rompería la coherencia de op.moneda/tasa/FIFO */
    const newBi=getBancoInfo(newB),opMon=op.moneda||'UYU',newMon=newBi?.moneda||'UYU';
    if(newMon!==opMon){alert(`No podés cambiar el banco a una cuenta ${newMon} cuando la operación está en ${opMon}. Eliminá y recreá la operación.`);return}
    /* INTEGRIDAD: validar deltas netos (revertir original + aplicar nuevo) */
    const oldB=op.banco,oldM=op.monto,oldCb=op.comisionBanco||0;
    const deltas={bancos:{}};
    if(op.tipo==='compra'){
        if(oldB)deltas.bancos[oldB]=(deltas.bancos[oldB]||0)+roundMoney(oldM+oldCb);
        deltas.bancos[newB]=(deltas.bancos[newB]||0)-roundMoney(newM+oldCb);
    }else{
        if(oldB)deltas.bancos[oldB]=(deltas.bancos[oldB]||0)-oldM;
        deltas.bancos[newB]=(deltas.bancos[newB]||0)+newM;
    }
    const valI=validarDeltas(deltas);
    if(!valI.ok){alert('🚫 No se puede guardar este cambio:\n\n'+valI.reason);return}
    btn.disabled=true;btn.textContent='Guardando...';
    try{
        /* 1. Revertir impacto bancario de la operación original */
        if(oldB&&AppState.datos.bancos[oldB]){
            if(op.tipo==='compra'){
                AppState.datos.bancos[oldB].saldo=fixNeg(AppState.datos.bancos[oldB].saldo+roundMoney(oldM+oldCb));
                if(AppState.datos.bancos[oldB].limiteDiarioUSD>0&&op.tasa>0){
                    const mU=roundMoney(oldM/op.tasa);
                    AppState.datos.bancos[oldB].limiteUsadoUSD=Math.max(0,roundMoney((AppState.datos.bancos[oldB].limiteUsadoUSD||0)-mU));
                }
            }else{
                AppState.datos.bancos[oldB].saldo=fixNeg(AppState.datos.bancos[oldB].saldo-oldM);
            }
        }
        /* 2. Aplicar nuevos valores */
        op.monto=roundMoney(newM);op.tasa=newTa;op.banco=newB;
        /* Comisión editable: persistir el % específico y recalcular derivados */
        const newCpct=_editOpComisionPctLeida(op);
        op.comisionPct=newCpct;
        op.usdt=usdtBase(op.monto/op.tasa,op.tipo);
        op.comisionPlataforma=truncar(op.usdt*(newCpct/100),2);
        op.updatedAt=new Date().toISOString();
        /* 3. Aplicar nuevo impacto bancario */
        if(newB&&AppState.datos.bancos[newB]){
            if(op.tipo==='compra'){
                AppState.datos.bancos[newB].saldo=fixNeg(AppState.datos.bancos[newB].saldo-roundMoney(newM+oldCb));
                if(AppState.datos.bancos[newB].limiteDiarioUSD>0){
                    const mU=op.moneda==='USD'?newM:truncar(newM/newTa);
                    AppState.datos.bancos[newB].limiteUsadoUSD=Math.min(AppState.datos.bancos[newB].limiteDiarioUSD,roundMoney((AppState.datos.bancos[newB].limiteUsadoUSD||0)+mU));
                }
            }else{
                AppState.datos.bancos[newB].saldo=fixNeg(AppState.datos.bancos[newB].saldo+newM);
            }
        }
        /* 4. Recalcular FIFO determinístico + guardar */
        recalcularLotesYGanancias();
        actualizarVista();cerrarModal('modalEditarOp');AppState.ui.opEditandoId=null;
        guardaOptimista('update','operaciones',op.id);
        showSuccess({amount:fmtMonto(newM,op.moneda),message:'Operación actualizada con éxito',sub:op.tipo==='compra'?'Compra editada':'Venta editada'});
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
    if(header)header.textContent=editing?'✏️ Editar ajuste':'📝 Ajuste Externo';
    $('btnGuardarMov').textContent=editing?'Guardar cambios':'Guardar';
    $('btnGuardarMov').disabled=false;
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
function actualizarCuentasMovimiento(){
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
    if(!lots.length){fp.innerHTML='<div style="color:#dc2626;font-size:0.8em">⚠️ Sin lotes disponibles</div>';return}
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
    const tc=$('movTipoCuenta').value,b=$('movBanco').value,m=pv('movMonto'),desc=$('movDescripcion').value,tRef=tc==='usdt'&&AppState.ui.tipoMovimiento==='ingreso'?pvTasa('movTasaRef'):0;
    if(!m||m<=0)return alert('Monto inválido');if(tc==='banco'&&!b)return alert('Seleccioná un banco');
    if(tc==='usdt'&&AppState.ui.tipoMovimiento==='ingreso'&&(!tRef||tRef<=0))return alert('Ingresá una tasa de referencia válida');
    /* INTEGRIDAD: validación dura previa.
       Para edits, los deltas se computan netos (revirtiendo el efecto original primero). */
    const mR=tc==='usdt'?truncUsdt(m):roundMoney(m);
    const isIngreso=AppState.ui.tipoMovimiento==='ingreso';
    const deltas={bancos:{}};
    /* Revertir efecto del original (si edit) */
    if(editing){
        if(original.tipoCuenta==='banco'&&original.banco){
            deltas.bancos[original.banco]=(deltas.bancos[original.banco]||0)+(original.tipoMovimiento==='ingreso'?-original.monto:original.monto);
        }else if(original.tipoCuenta==='usdt'){
            deltas.usdt=(deltas.usdt||0)+(original.tipoMovimiento==='ingreso'?-original.monto:original.monto);
        }
    }
    /* Aplicar nuevo efecto */
    if(tc==='banco'){
        deltas.bancos[b]=(deltas.bancos[b]||0)+(isIngreso?mR:-mR);
    }else{
        deltas.usdt=(deltas.usdt||0)+(isIngreso?mR:-mR);
        /* Egreso USDT: validar también que haya inventario en alguna moneda */
        if(!isIngreso)deltas.usdtMoneda='UYU'; /* movs USDT van contra lotes UYU por convención */
    }
    const valI=validarDeltas(deltas);
    if(!valI.ok){alert('🚫 No se puede guardar este ajuste:\n\n'+valI.reason);return}
    AppState.ui.guardandoMovimiento=true;btn.disabled=true;btn.textContent=editing?'Guardando...':'Guardando...';
    try{
        if(editing){
            /* Capture pre-mutation state for decisions that depend on it */
            const wasUsdt=original.tipoCuenta==='usdt';
            /* 1. Revertir impacto bancario del movimiento original (si era banco) */
            if(original.tipoCuenta==='banco'&&original.banco&&AppState.datos.bancos[original.banco]){
                AppState.datos.bancos[original.banco].saldo=fixNeg(AppState.datos.bancos[original.banco].saldo+(original.tipoMovimiento==='ingreso'?-original.monto:original.monto));
            }
            /* 2. Mutar el movimiento en su posición (preserva fecha/hora/timestamp/id) */
            original.tipoMovimiento=AppState.ui.tipoMovimiento;
            original.tipoCuenta=tc;
            original.banco=tc==='banco'?b:null;
            original.monto=mR;
            original.tasaRef=tc==='usdt'&&AppState.ui.tipoMovimiento==='ingreso'?tRef:0;
            original.descripcion=desc;
            original.updatedAt=new Date().toISOString();
            /* valorUYU: siempre 0 antes del replay FIFO — se recalcula solo para egresos USDT.
               Si el tc cambió de usdt→banco, el valor viejo queda irrelevante (igual 0). */
            original.valorUYU=0;
            /* 3. Aplicar nuevo impacto bancario */
            if(tc==='banco'&&AppState.datos.bancos[b]){
                AppState.datos.bancos[b].saldo=fixNeg(AppState.datos.bancos[b].saldo+(AppState.ui.tipoMovimiento==='ingreso'?mR:-mR));
            }
            /* 4. Recalcular FIFO si toca USDT (antes O ahora) */
            if(tc==='usdt'||wasUsdt)recalcularLotesYGanancias();
            actualizarVista();cerrarModal('modalMovimiento');activarCooldown();
            AppState.ui.movEditandoId=null;
            guardaOptimista('update','movimientos',editId);
            const movSy=tc==='usdt'?'':tc==='banco'?getSym(getBancoInfo(b)?.moneda||'UYU'):'';
            showSuccess({amount:tc==='usdt'?fmtTrunc(mR,2)+' USDT':movSy+fmtNum(mR),message:'Ajuste actualizado con éxito',sub:(AppState.ui.tipoMovimiento==='ingreso'?'Ingreso':'Egreso')+(tc==='banco'?' · '+b:'')});
        }else{
            const mId=uid();
            /* Actualizar saldo bancario (no FIFO) */
            if(tc==='banco'){
                AppState.datos.bancos[b].saldo=fixNeg(AppState.datos.bancos[b].saldo+(AppState.ui.tipoMovimiento==='ingreso'?mR:-mR));
            }
            /* Insertar movimiento (valorUYU se calcula en recalcular para egresos USDT) */
            const md={id:mId,tipoMovimiento:AppState.ui.tipoMovimiento,tipoCuenta:tc,banco:tc==='banco'?b:null,monto:mR,valorUYU:0,tasaRef:tc==='usdt'&&AppState.ui.tipoMovimiento==='ingreso'?tRef:0,descripcion:desc,fecha:getUDateStr(),hora:getUTimeStr(),timestamp:new Date().toISOString()};
            AppState.datos.movimientos.unshift(md);
            if(tc==='usdt')recalcularLotesYGanancias();
            actualizarVista();cerrarModal('modalMovimiento');activarCooldown();
            guardaOptimista('create','movimientos',mId);
            const movSy=tc==='usdt'?'':tc==='banco'?getSym(getBancoInfo(b)?.moneda||'UYU'):'';showSuccess({amount:tc==='usdt'?fmtTrunc(mR,2)+' USDT':movSy+fmtNum(mR),message:'Ajuste guardado con éxito',sub:(AppState.ui.tipoMovimiento==='ingreso'?'Ingreso':'Egreso')+(tc==='banco'?' · '+b:'')});
        }
    }catch(e){console.error('[P2P] Error guardando movimiento:',e)}finally{AppState.ui.guardandoMovimiento=false;btn.disabled=false;btn.textContent=AppState.ui.movEditandoId?'Guardar cambios':'Guardar'}
}

async function eliminarMovimiento(id){
    const mv=AppState.datos.movimientos.find(m=>m.id===id);if(!mv)return;
    /* INTEGRIDAD: pre-validar que el rollback no deje saldos negativos */
    const deltas={bancos:{}};
    if(mv.tipoCuenta==='banco'&&mv.banco){
        deltas.bancos[mv.banco]=mv.tipoMovimiento==='ingreso'?-mv.monto:mv.monto;
    }else if(mv.tipoCuenta==='usdt'){
        /* Revertir USDT: si era egreso → suma al inventario (siempre OK); si era ingreso → resta */
        deltas.usdt=mv.tipoMovimiento==='ingreso'?-mv.monto:mv.monto;
    }
    const valI=validarDeltas(deltas);
    if(!valI.ok){alert('🚫 No se puede eliminar este ajuste:\n\n'+valI.reason);return}
    if(!confirm('¿Eliminar?'))return;
    try{
        if(mv.tipoCuenta==='banco'&&mv.banco&&AppState.datos.bancos[mv.banco]){
            AppState.datos.bancos[mv.banco].saldo=fixNeg(AppState.datos.bancos[mv.banco].saldo+(mv.tipoMovimiento==='ingreso'?-mv.monto:mv.monto));
        }
        AppState.datos.movimientos=AppState.datos.movimientos.filter(m=>m.id!==id);
        recalcularLotesYGanancias();
        verificarIntegridadGlobal();
        actualizarVista();
        guardaOptimista('delete','movimientos',id);
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

function actualizarTransfUI(){
    const cross=esCrossMoneda(),tg=$('transfTasaGroup'),pvEl=$('transfConvPreview'),hd=$('transfHeader');
    tg.style.display=cross?'block':'none';
    if(cross){hd.textContent='💱 Conversión entre monedas';$('btnTransferir').textContent='Convertir';$('btnTransferir').style.background='#7c3aed'}
    else{hd.textContent='↔️ Transferencia entre Bancos';$('btnTransferir').textContent='Transferir';$('btnTransferir').style.background='#2563eb';pvEl.style.display='none'}
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
    pvEl.innerHTML=`💱 Debita <b>${getSym(oi.moneda)}${fmtNum(m)}</b> de ${colorBanco(o)} → Recibe <b>${recibe}</b> en ${colorBanco(d)}<div style="margin-top:4px;font-size:0.8em;color:#64748b">Solo mueve saldos · No afecta ganancia</div>`;
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
    actualizarTransfUI();
    /* Override button label in edit mode (after actualizarTransfUI sets default) */
    if(editing){
        $('btnTransferir').textContent='Guardar cambios';
    }
    abrirModal('modalTransferencia');
}

async function realizarTransferencia(){
    if(AppState.ui.enCooldown||AppState.ui.guardandoTransferencia)return;const btn=$('btnTransferir');if(btn.disabled)return;
    const editId=AppState.ui.transEditandoId;
    const editing=!!editId;
    const origIsConv=AppState.ui.transEditandoIsConv;
    const original=editing?(origIsConv?AppState.datos.conversiones.find(c=>c.id===editId):AppState.datos.transferencias.find(t=>t.id===editId)):null;
    if(editing&&!original){AppState.ui.transEditandoId=null;return}
    const o=$('bancoOrigen').value,d=$('bancoDestino').value,m=pv('montoTransferencia'),c=roundMoney(pv('comisionTransferencia')),f=getUDateStr();
    if(!o||!d||o===d)return alert('Seleccioná bancos diferentes');if(!m||m<=0)return alert('Monto inválido');
    const cross=esCrossMoneda();
    if(editing){
        const t=cross?pvTasa('transfTasa'):0;
        if(cross&&(!t||t<=0))return alert('Ingresá una tasa de conversión válida');
        /* INTEGRIDAD: calcular deltas netos (revertir + aplicar) y validar ANTES de mutar.
           Esto evita el bug de dejar el estado revertido si el nuevo impacto excede límite. */
        const netoDeltas={bancos:{}};
        /* Revertir impacto original (suma a deltas) */
        if(origIsConv){
            netoDeltas.bancos[original.origen]=(netoDeltas.bancos[original.origen]||0)+original.montoOrigen;
            netoDeltas.bancos[original.destino]=(netoDeltas.bancos[original.destino]||0)-original.montoDestino;
        }else{
            netoDeltas.bancos[original.origen]=(netoDeltas.bancos[original.origen]||0)+(original.monto+(original.comision||0));
            netoDeltas.bancos[original.destino]=(netoDeltas.bancos[original.destino]||0)-original.monto;
        }
        /* Aplicar nuevo impacto */
        if(cross){
            const oi2=getBancoInfo(o),di2=getBancoInfo(d);
            const montoRecibido2=oi2.moneda==='UYU'&&di2.moneda==='USD'?roundMoney(m/t):roundMoney(m*t);
            netoDeltas.bancos[o]=(netoDeltas.bancos[o]||0)-m;
            netoDeltas.bancos[d]=(netoDeltas.bancos[d]||0)+montoRecibido2;
        }else{
            netoDeltas.bancos[o]=(netoDeltas.bancos[o]||0)-(m+c);
            netoDeltas.bancos[d]=(netoDeltas.bancos[d]||0)+m;
        }
        const valEdit=validarDeltas(netoDeltas);
        if(!valEdit.ok){alert('🚫 No se puede guardar este cambio:\n\n'+valEdit.reason);return}
        /* Validar límite diario nuevo (si corresponde) ANTES de tocar nada */
        if(!cross&&AppState.datos.bancos[o].limiteDiarioUSD>0){
            const bi=getBancoInfo(o);
            let mU=0;
            if(bi?.moneda==='USD')mU=m+c;
            else if(AppState.datos.ultimaTasaCompra>0)mU=roundMoney((m+c)/AppState.datos.ultimaTasaCompra);
            /* Calcular uso "efectivo" tras revertir el original: si el original era del mismo banco origen, se descuenta su uso */
            let usoActual=AppState.datos.bancos[o].limiteUsadoUSD||0;
            if(!origIsConv&&original.origen===o&&AppState.datos.ultimaTasaCompra>0){
                const biOrig=getBancoInfo(original.origen);
                let mUorig=0;
                if(biOrig?.moneda==='USD')mUorig=original.monto+(original.comision||0);
                else mUorig=roundMoney((original.monto+(original.comision||0))/AppState.datos.ultimaTasaCompra);
                usoActual=Math.max(0,usoActual-mUorig);
            }
            const dU=roundMoney(AppState.datos.bancos[o].limiteDiarioUSD-usoActual);
            if(mU>dU){alert(`Excede el límite diario de ${o}. Disponible: US$${fmtNum(dU,0)} (necesitás US$${fmtNum(mU,0)})`);return}
        }
        btn.disabled=true;btn.textContent='Guardando...';AppState.ui.guardandoTransferencia=true;
        try{
            /* 1. Revertir impacto del registro original */
            if(origIsConv){
                const bo=AppState.datos.bancos[original.origen],bd=AppState.datos.bancos[original.destino];
                if(bo)bo.saldo=fixNeg(bo.saldo+original.montoOrigen);
                if(bd)bd.saldo=fixNeg(bd.saldo-original.montoDestino);
            }else{
                const bo=AppState.datos.bancos[original.origen],bd=AppState.datos.bancos[original.destino];
                if(bo)bo.saldo=fixNeg(bo.saldo+(original.monto+(original.comision||0)));
                if(bd)bd.saldo=fixNeg(bd.saldo-original.monto);
                if(bo&&bo.limiteDiarioUSD>0){const bi=getBancoInfo(original.origen);let mU=0;if(bi?.moneda==='USD')mU=original.monto+(original.comision||0);else if(AppState.datos.ultimaTasaCompra>0)mU=roundMoney((original.monto+(original.comision||0))/AppState.datos.ultimaTasaCompra);if(mU>0)bo.limiteUsadoUSD=Math.max(0,roundMoney((bo.limiteUsadoUSD||0)-mU))}
            }
            /* 2. Determinar tipo nuevo y aplicar */
            if(cross){
                const oi=getBancoInfo(o),di=getBancoInfo(d);
                const montoRecibido=oi.moneda==='UYU'&&di.moneda==='USD'?roundMoney(m/t):roundMoney(m*t);
                /* Si era transferencia → remover de transferencias, agregar a conversiones (preservando id/fecha) */
                if(!origIsConv){
                    AppState.datos.transferencias=AppState.datos.transferencias.filter(x=>x.id!==editId);
                    AppState.datos.conversiones.unshift({id:editId,origen:o,destino:d,montoOrigen:m,montoDestino:montoRecibido,tasa:t,monedaOrigen:oi.moneda,monedaDestino:di.moneda,fecha:original.fecha,hora:original.hora,timestamp:original.timestamp,updatedAt:new Date().toISOString()});
                }else{
                    original.origen=o;original.destino=d;original.montoOrigen=m;original.montoDestino=montoRecibido;original.tasa=t;original.monedaOrigen=oi.moneda;original.monedaDestino=di.moneda;original.updatedAt=new Date().toISOString();
                }
                AppState.datos.bancos[o].saldo=fixNeg(AppState.datos.bancos[o].saldo-m);
                AppState.datos.bancos[d].saldo=fixNeg(AppState.datos.bancos[d].saldo+montoRecibido);
                actualizarVista();cerrarModal('modalTransferencia');activarCooldown();
                AppState.ui.transEditandoId=null;AppState.ui.transEditandoIsConv=false;
                guardaOptimista('update','conversiones',editId);
                if(!origIsConv)guardaOptimista('delete','transferencias',editId);
                showSuccess({amount:getSym(di.moneda)+fmtNum(montoRecibido),message:'Conversión actualizada con éxito',sub:o+' → '+d});
            }else{
                /* Si era conversión → remover de conversiones, agregar a transferencias */
                if(origIsConv){
                    AppState.datos.conversiones=AppState.datos.conversiones.filter(x=>x.id!==editId);
                    AppState.datos.transferencias.unshift({id:editId,origen:o,destino:d,monto:m,comision:c,fecha:original.fecha,hora:original.hora,timestamp:original.timestamp,updatedAt:new Date().toISOString()});
                }else{
                    original.origen=o;original.destino=d;original.monto=m;original.comision=c;original.updatedAt=new Date().toISOString();
                }
                AppState.datos.bancos[o].saldo=fixNeg(AppState.datos.bancos[o].saldo-(m+c));
                AppState.datos.bancos[d].saldo=fixNeg(AppState.datos.bancos[d].saldo+m);
                if(AppState.datos.bancos[o].limiteDiarioUSD>0){const bi=getBancoInfo(o);let mU=0;if(bi?.moneda==='USD')mU=m+c;else if(AppState.datos.ultimaTasaCompra>0)mU=roundMoney((m+c)/AppState.datos.ultimaTasaCompra);if(mU>0)AppState.datos.bancos[o].limiteUsadoUSD=Math.min(AppState.datos.bancos[o].limiteDiarioUSD,roundMoney((AppState.datos.bancos[o].limiteUsadoUSD||0)+mU))}
                actualizarVista();cerrarModal('modalTransferencia');activarCooldown();
                AppState.ui.transEditandoId=null;AppState.ui.transEditandoIsConv=false;
                guardaOptimista('update','transferencias',editId);
                if(origIsConv)guardaOptimista('delete','conversiones',editId);
                const tSy=getSym(getBancoInfo(o)?.moneda||'UYU');showSuccess({amount:tSy+fmtNum(m),message:'Transferencia actualizada con éxito',sub:o+' → '+d});
            }
        }catch(e){console.error('[P2P] Error editando transferencia:',e)}finally{AppState.ui.guardandoTransferencia=false;btn.disabled=false;btn.textContent=AppState.ui.transEditandoId?'Guardar cambios':(esCrossMoneda()?'Convertir':'Transferir')}
        return;
    }
    if(cross){
        const t=pvTasa('transfTasa');
        if(!t||t<=0)return alert('Ingresá una tasa de conversión válida');
        const oi=getBancoInfo(o),di=getBancoInfo(d);
        let montoRecibido;
        if(oi.moneda==='UYU'&&di.moneda==='USD')montoRecibido=roundMoney(m/t);
        else montoRecibido=roundMoney(m*t);
        /* INTEGRIDAD: el banco origen debe poder cubrir el monto a convertir */
        const valI=validarDeltas({bancos:{[o]:-m,[d]:montoRecibido}});
        if(!valI.ok){alert('🚫 No se puede convertir:\n\n'+valI.reason);return}
        btn.disabled=true;btn.textContent='Convirtiendo...';AppState.ui.guardandoTransferencia=true;
        try{
            const convId=uid();
            AppState.datos.conversiones.unshift({id:convId,origen:o,destino:d,montoOrigen:m,montoDestino:montoRecibido,tasa:t,monedaOrigen:oi.moneda,monedaDestino:di.moneda,fecha:f,hora:getUTimeStr(),timestamp:new Date().toISOString()});
            AppState.datos.bancos[o].saldo=fixNeg(AppState.datos.bancos[o].saldo-m);
            AppState.datos.bancos[d].saldo=fixNeg(AppState.datos.bancos[d].saldo+montoRecibido);
            actualizarVista();cerrarModal('modalTransferencia');activarCooldown();
            guardaOptimista('create','conversiones',convId);
            showSuccess({amount:getSym(di.moneda)+fmtNum(montoRecibido),message:'Conversión realizada con éxito',sub:o+' → '+d});
        }catch(e){console.error('[P2P] Error en conversión:',e)}finally{AppState.ui.guardandoTransferencia=false;btn.disabled=false;btn.textContent='Convertir'}
    }else{
        if(AppState.datos.bancos[o].limiteDiarioUSD>0){const bi=getBancoInfo(o);let mU=0;if(bi?.moneda==='USD')mU=m+c;else if(AppState.datos.ultimaTasaCompra>0)mU=roundMoney((m+c)/AppState.datos.ultimaTasaCompra);const dU=roundMoney(AppState.datos.bancos[o].limiteDiarioUSD-(AppState.datos.bancos[o].limiteUsadoUSD||0));if(mU>dU){alert(`Excede el límite diario de ${o}. Disponible: US$${fmtNum(dU,0)} (necesitás US$${fmtNum(mU,0)})`);return}}
        /* INTEGRIDAD: el banco origen debe poder cubrir monto + comisión */
        const valI=validarDeltas({bancos:{[o]:-(m+c),[d]:m}});
        if(!valI.ok){alert('🚫 No se puede transferir:\n\n'+valI.reason);return}
        btn.disabled=true;btn.textContent='Transfiriendo...';AppState.ui.guardandoTransferencia=true;
        try{
            const trId=uid();
            AppState.datos.transferencias.unshift({id:trId,origen:o,destino:d,monto:m,comision:c,fecha:f,hora:getUTimeStr(),timestamp:new Date().toISOString()});
            AppState.datos.bancos[o].saldo=fixNeg(AppState.datos.bancos[o].saldo-(m+c));AppState.datos.bancos[d].saldo=fixNeg(AppState.datos.bancos[d].saldo+m);
            if(AppState.datos.bancos[o].limiteDiarioUSD>0){const bi=getBancoInfo(o);let mU=0;if(bi?.moneda==='USD')mU=m+c;else if(AppState.datos.ultimaTasaCompra>0)mU=roundMoney((m+c)/AppState.datos.ultimaTasaCompra);if(mU>0)AppState.datos.bancos[o].limiteUsadoUSD=Math.min(AppState.datos.bancos[o].limiteDiarioUSD,roundMoney((AppState.datos.bancos[o].limiteUsadoUSD||0)+mU))}
            actualizarVista();cerrarModal('modalTransferencia');activarCooldown();
            guardaOptimista('create','transferencias',trId);
            const tSy=getSym(getBancoInfo(o)?.moneda||'UYU');showSuccess({amount:tSy+fmtNum(m),message:'Transferencia realizada con éxito',sub:o+' → '+d});
        }catch(e){console.error('[P2P] Error en transferencia:',e)}finally{AppState.ui.guardandoTransferencia=false;btn.disabled=false;btn.textContent='Transferir'}
    }
}

async function eliminarTransferencia(id){
    const t=AppState.datos.transferencias.find(x=>x.id===id);if(!t)return;
    /* INTEGRIDAD: rollback de transfer suma a origen, resta de destino → puede dejar destino negativo */
    const deltas={bancos:{}};
    deltas.bancos[t.origen]=t.monto+(t.comision||0);
    deltas.bancos[t.destino]=-t.monto;
    const valI=validarDeltas(deltas);
    if(!valI.ok){alert('🚫 No se puede eliminar esta transferencia:\n\n'+valI.reason+'\n\nProbablemente ya gastaste los fondos transferidos al destino.');return}
    if(!confirm('¿Eliminar?'))return;
    try{
        const bo=AppState.datos.bancos[t.origen],bd=AppState.datos.bancos[t.destino];
        if(bo)bo.saldo=fixNeg(bo.saldo+(t.monto+t.comision));
        if(bd)bd.saldo=fixNeg(bd.saldo-t.monto);
        if(bo&&bo.limiteDiarioUSD>0){const bi=getBancoInfo(t.origen);let mU=0;if(bi?.moneda==='USD')mU=t.monto+t.comision;else if(AppState.datos.ultimaTasaCompra>0)mU=roundMoney((t.monto+t.comision)/AppState.datos.ultimaTasaCompra);if(mU>0)bo.limiteUsadoUSD=Math.max(0,roundMoney((bo.limiteUsadoUSD||0)-mU))}
        AppState.datos.transferencias=AppState.datos.transferencias.filter(x=>x.id!==id);
        verificarIntegridadGlobal();actualizarVista();
        guardaOptimista('delete','transferencias',id);
    }catch(e){console.error('[P2P] Error eliminando transferencia:',e)}
}

async function eliminarConversion(id){
    const c=AppState.datos.conversiones.find(x=>x.id===id);if(!c)return;
    const deltas={bancos:{}};
    deltas.bancos[c.origen]=c.montoOrigen;
    deltas.bancos[c.destino]=-c.montoDestino;
    const valI=validarDeltas(deltas);
    if(!valI.ok){alert('🚫 No se puede eliminar esta conversión:\n\n'+valI.reason);return}
    if(!confirm('¿Eliminar conversión?'))return;
    try{
        const bo=AppState.datos.bancos[c.origen],bd=AppState.datos.bancos[c.destino];if(bo)bo.saldo=fixNeg(bo.saldo+c.montoOrigen);if(bd)bd.saldo=fixNeg(bd.saldo-c.montoDestino);
        AppState.datos.conversiones=AppState.datos.conversiones.filter(x=>x.id!==id);actualizarVista();
        guardaOptimista('delete','conversiones',id);
    }catch(e){console.error('[P2P] Error eliminando conversión:',e)}
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