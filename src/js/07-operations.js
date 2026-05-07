/* ═══════════════════════════════════════════════════════════════════
   07-operations.js
   Generated piece — concatenated into dist/index.html by build/build.js
   Source of truth: src/js/07-operations.js
   Do NOT edit dist/index.html directly. Edit the source and re-run build.
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════
   §9 — FORMULARIO OPERACIÓN
   ═══════════════════════════════════════ */
function actualizarColorSelect(){
    const v=$('tipo').value,isC=v==='compra';
    $('opToggleCompra').className='op-toggle-btn'+(isC?' active-compra':'');
    $('opToggleVenta').className='op-toggle-btn'+(isC?'':' active-venta');
    const btn=$('btnAgregarOp');
    btn.textContent=isC?'📥 Comprar USDT':'📤 Vender USDT';
    btn.className='btn '+(isC?'op-btn-compra':'op-btn-venta');
}
function actualizarColorBancoSelect(){const s=$('banco'),v=s.value;s.style.color=v?getBancoColor(v):'#1e293b';s.style.fontWeight=v?'600':'400'}

function actualizarFormulario(){
    const t=$('tipo').value,mon=getMonedaBanco(),isU=mon==='USD';
    const prevMon=AppState.ui.ultimoMonedaBanco;
    const monedaCambiada=prevMon!==null&&prevMon!==mon;
    AppState.ui.ultimoMonedaBanco=mon;
    const sy=isU?'USD':'UYU';
    setText('montoLabel',t==='compra'?`Comprás por (${sy})`:`Vendés por (${sy})`);
    setText('bancoLabel',t==='compra'?'Sale de':'Entra a');
    $('comisionBancoGroup').style.display=t==='compra'?'block':'none';
    $('comisionBancoGroup').parentElement.style.gridTemplateColumns=t==='compra'?'1fr 1fr':'1fr';
    if(t==='venta')$('comisionBanco').value='0';
    const ti=$('tasa');
    if(document.activeElement!==ti&&(!AppState.ui.tasaManual||monedaCambiada)){
        const ta=t==='compra'?(isU?AppState.datos.ultimaTasaCompraUSD:AppState.datos.ultimaTasaCompra):(isU?AppState.datos.ultimaTasaVentaUSD:AppState.datos.ultimaTasaVenta);
        ti.value=ta>0?fmtTasa(ta,mon):'';
        if(monedaCambiada)AppState.ui.tasaManual=false;
    }
    setText('tasaHelp','');$('tasaHelp').style.display='none';
    const ci=$('comisionPlataforma');if(document.activeElement!==ci){const cv=isU?AppState.datos.comisionUSD:AppState.datos.comisionPlataforma;ci.value=fmtNum(cv);setText('comisionPctLabel',fmtNum(cv))}
    calcularPreview();renderizarTasasRecientes();
}

function calcularPreview(){
    const t=$('tipo').value,m=pv('monto'),ta=parsearTasa($('tasa').value),cp=getComisionDec(),mon=getMonedaBanco(),isU=mon==='USD';
    $('tasa').classList.remove('error');const th=$('tasaHelp');th.className='';th.textContent='';th.style.display='none';
    const sum=$('opSummary'),btn=$('btnAgregarOp');
    const isC=t==='compra',sy=isU?'US$':'$';

    if(m>0&&ta){
        /* UYU-centric: monto is fiat, compute USDT */
        const u=usdtBase(m/ta,t),c=truncar(u*cp,2);
        const neto=usdtNeto(u,c,t);
        setText('comisionPlataformaInfo',fmtTrunc(c,2)+' USDT');

        sum.style.display='block';
        sum.className='op-summary '+(isC?'modo-compra':'modo-venta');

        if(isC){
            /* COMPRA: total=base, liberada=neto (lo que recibís) */
            setText('opSumTotalLabel','Cantidad total');
            $('opSumTotalValue').innerHTML=`<b style="color:#1e293b">${fmtNum(u,2)} USDT</b>`;
            setText('opSumLibLabel','Cantidad a recibir');
            $('opSumLibValue').innerHTML=`<b style="color:#1e293b">${fmtNum(neto,2)} USDT</b>`;
        }else{
            /* VENTA: total=neto (lo que sale del wallet), liberada=base */
            setText('opSumTotalLabel','Entregás');
            $('opSumTotalValue').innerHTML=`<b style="color:#1e293b">${fmtNum(neto,2)} USDT</b>`;
            setText('opSumLibLabel','Cantidad liberada');
            $('opSumLibValue').innerHTML=`<b style="color:#1e293b">${fmtNum(u,2)} USDT</b>`;
        }
        setText('opSumComision',fmtTrunc(c,2)+' USDT');

        /* Bank saldo impact */
        const b=$('banco').value,cb=roundMoney(pv('comisionBanco'));
        if(b&&AppState.datos.bancos[b]){
            const sActual=AppState.datos.bancos[b].saldo,bsy=getSym(getBancoInfo(b)?.moneda);
            const sDesp=isC?fixNeg(sActual-(m+cb)):fixNeg(sActual+m);
            setText('opSumBancoLabel',b);
            $('opSumBancoValue').innerHTML=`${bsy}${fmtNum(sActual)} → <b style="color:${sDesp>=sActual?'#16a34a':'#dc2626'}">${bsy}${fmtNum(sDesp)}</b>`;
        }else{setText('opSumBancoLabel','Saldo');setText('opSumBancoValue','--')}

        /* Dynamic button */
        btn.textContent=isC?`📥 Comprar ${fmtTrunc(neto,2)} USDT`:`📤 Vender ${fmtTrunc(neto,2)} USDT`;

        $('previewBox').style.display='none';
    }else{
        sum.style.display='none';$('previewBox').style.display='none';
        setText('comisionPlataformaInfo','0 USDT');
        btn.textContent=isC?'📥 Comprar USDT':'📤 Vender USDT';
    }
}

function guardarComisionYCalcular(){
    const inp=$('comisionPlataforma'),raw=inp.value.replace(',','.').trim();
    /* Si el valor es vacío o transitorio ("0." mientras el usuario escribe) no persistir 
       pero tampoco marcar como error — dejar al usuario terminar de tipear */
    if(raw===''||raw==='.'||raw.endsWith('.')){
        inp.classList.remove('error');
        calcularPreview();
        return;
    }
    const v=parsearComisionPct(raw);
    if(v===null){
        /* Valor inválido (negativo, >10%, formato roto) → marcar visualmente pero no bloquear tipeo */
        inp.classList.add('error');
        return;
    }
    inp.classList.remove('error');
    if(getMonedaBanco()==='USD')AppState.datos.comisionUSD=v;else AppState.datos.comisionPlataforma=v;
    setText('comisionPctLabel',fmtNum(v));
    clearTimeout(AppState.ui.comisionDebounce);
    AppState.ui.comisionDebounce=setTimeout(()=>guardaOptimista('update','settings','comision'),1200);
    calcularPreview();
}

/* ═══════════════════════════════════════
   §X — SPLIT PAGO (compra con múltiples cuentas)
   ═══════════════════════════════════════ */
/* AppState.ui.splitExtras: [{banco, monto}] — cuentas adicionales más allá del banco principal */
/* Tolerancia única para comparaciones de faltante: medio centésimo.
   Por debajo de esto se considera "completo" (ruido de redondeo). */
const SPLIT_EPSILON=0.005;
function _initSplitState(){
    if(!AppState.ui.splitExtras)AppState.ui.splitExtras=[];
}
function _splitDisponible(bancoNombre,excluirBanco){
    const bk=AppState.datos.bancos[bancoNombre];
    if(!bk)return 0;
    return Math.max(0,bk.saldo);
}
/* ═══ Fuente única de verdad para el estado del split ═══
   Devuelve null si el contexto no aplica (no compra, sin banco, etc.).
   Todos los renders + validación usan este mismo objeto. Garantiza que
   el botón, el resumen, el monto y la persistencia coincidan al centésimo. */
function _computeSplitState(){
    if($('tipo').value!=='compra')return null;
    const bancoPrinc=$('banco').value;if(!bancoPrinc)return null;
    const bk=AppState.datos.bancos[bancoPrinc];if(!bk)return null;
    const monto=pv('monto'),comisionBanco=roundMoney(pv('comisionBanco'));
    if(!monto||monto<=0)return null;
    const totalNecesario=roundMoney(monto+comisionBanco);
    const saldoPrinc=roundMoney(bk.saldo);
    /* Si el principal cubre todo, no hay split */
    if(saldoPrinc>=totalNecesario-SPLIT_EPSILON){
        return{aplicaSplit:false,totalNecesario,saldoPrinc,bancoPrinc,bk};
    }
    /* Aporte del banco principal: lo que tenga, capeado al total */
    const aporte1=roundMoney(Math.min(saldoPrinc,totalNecesario));
    /* Suma de aportes extra (filtrando inválidos) */
    _initSplitState();
    let aportadoExtra=0;
    AppState.ui.splitExtras.forEach(e=>{
        const m=roundMoney(e.monto||0);
        if(m>0)aportadoExtra=roundMoney(aportadoExtra+m);
    });
    const totalAportado=roundMoney(aporte1+aportadoExtra);
    const faltante=roundMoney(totalNecesario-totalAportado);
    /* Estado normalizado */
    const cubierto=Math.abs(faltante)<SPLIT_EPSILON;
    const exceso=faltante<-SPLIT_EPSILON;
    return{
        aplicaSplit:true,
        bancoPrinc,bk,
        monto,comisionBanco,totalNecesario,
        saldoPrinc,aporte1,aportadoExtra,totalAportado,
        faltante,
        cubierto,
        exceso,
        falta:!cubierto&&!exceso
    };
}
/* Formato monetario inteligente: si el monto tiene centésimos significativos,
   muestra 2 decimales; si es entero, muestra 0 decimales. Evita "Faltan $0"
   cuando en realidad faltan $0,47. */
function fmtMonto(n){
    const abs=Math.abs(n);
    if(abs<SPLIT_EPSILON)return fmtNum(0,0);
    /* Si el redondeo a entero coincide exactamente con el valor → mostrar entero */
    const entero=Math.round(n);
    if(Math.abs(n-entero)<SPLIT_EPSILON)return fmtNum(entero,0);
    /* Hay centésimos significativos → 2 decimales */
    return fmtNum(n,2);
}
function renderSplitPanel(){
    _initSplitState();
    const panel=$('splitPanel');if(!panel)return;
    const state=_computeSplitState();
    /* No aplica split (otro tipo, sin banco, monto inválido, o saldo cubre todo) */
    if(!state||!state.aplicaSplit){
        panel.style.display='none';
        if($('tipo').value!=='compra'||(state&&state.aplicaSplit===false))AppState.ui.splitExtras=[];
        return;
    }
    const{bancoPrinc,totalNecesario,aporte1,totalAportado,faltante,cubierto,exceso}=state;
    /* Opciones para banco adicional: activos, distintos del principal y de otros ya elegidos */
    const usados=new Set([bancoPrinc]);AppState.ui.splitExtras.forEach(e=>{if(e.banco)usados.add(e.banco)});
    const disponibles=getBancosActivos().filter(b=>!usados.has(b.nombre));
    const sy=getSym(getBancoInfo(bancoPrinc)?.moneda||'UYU');
    const faltanteInicial=roundMoney(totalNecesario-aporte1);
    let h=`<div class="split-panel-title">⚠️ Saldo insuficiente · faltan ${sy}${fmtMonto(faltanteInicial)}</div>
        <div style="font-size:0.7em;color:#78350f;margin-bottom:10px;line-height:1.4">Completá el pago con una o más cuentas adicionales hasta cubrir el total.</div>
        <div class="split-row aporte">
            <div class="split-row-label"><span style="color:${getBancoColor(bancoPrinc)}">●</span> <b>${escHtml(bancoPrinc)}</b> aporta</div>
            <div class="split-row-monto">${sy}${fmtMonto(aporte1)}</div>
        </div>`;
    /* Render cuentas adicionales */
    AppState.ui.splitExtras.forEach((ex,idx)=>{
        const selOpts='<option value="">Seleccionar…</option>'+disponibles.concat(ex.banco&&AppState.datos.bancos[ex.banco]?[{nombre:ex.banco,color:getBancoColor(ex.banco)}]:[]).map(b=>`<option value="${b.nombre}" style="color:${b.color||'#1e293b'};font-weight:600"${ex.banco===b.nombre?' selected':''}>${b.nombre}</option>`).join('');
        const disp=ex.banco?_splitDisponible(ex.banco):0;
        h+=`<div class="split-extra-row">
            <select data-action="split-set-banco" data-idx="${idx}">${selOpts}</select>
            <input type="text" inputmode="decimal" data-action="split-set-monto" data-idx="${idx}" value="${ex.monto?fmtMonto(ex.monto):''}" placeholder="${sy}0" />
            <button type="button" class="split-remove" data-action="split-remove" data-idx="${idx}" aria-label="Quitar">✕</button>
        </div>`;
        if(ex.banco&&disp<(ex.monto||0)-SPLIT_EPSILON){
            h+=`<div style="font-size:0.68em;color:#b91c1c;margin:-2px 4px 6px">⚠ ${escHtml(ex.banco)} solo tiene ${sy}${fmtMonto(disp)}</div>`;
        }
    });
    /* Botón agregar cuenta — solo si hay faltante real (>= EPSILON) */
    if(faltante>=SPLIT_EPSILON&&disponibles.length>0){
        h+=`<button type="button" class="split-add-btn" data-action="split-add">＋ Agregar cuenta para cubrir ${sy}${fmtMonto(faltante)}</button>`;
    }
    /* Status — usa estado normalizado, sin re-comparar con 0 */
    if(cubierto){
        h+=`<div class="split-status ok">✓ Total cubierto · ${sy}${fmtMonto(totalAportado)}</div>`;
    }else if(exceso){
        h+=`<div class="split-status error">Exceso de ${sy}${fmtMonto(Math.abs(faltante))} · ajustá los aportes</div>`;
    }else{
        h+=`<div class="split-status error">Falta ${sy}${fmtMonto(faltante)} · aportado ${sy}${fmtMonto(totalAportado)} de ${sy}${fmtMonto(totalNecesario)}</div>`;
    }
    panel.innerHTML=h;panel.style.display='block';
}
/* Determinar si hay split activo y válido */
function splitActivo(){
    /* GUARD: split pago solo aplica a COMPRAS — en ventas el usuario recibe UYU,
       no paga, por lo que no hay validación de saldo que justifique split. */
    if($('tipo').value!=='compra')return false;
    if(!AppState.ui.splitExtras||AppState.ui.splitExtras.length===0)return false;
    const state=_computeSplitState();
    return!!(state&&state.aplicaSplit);
}
/* Devuelve array de aportes [{banco,monto}] si split activo, null si no */
function getAportes(){
    if(!splitActivo())return null;
    const state=_computeSplitState();
    if(!state||!state.aplicaSplit)return null;
    const aportes=[{banco:state.bancoPrinc,monto:state.aporte1}];
    AppState.ui.splitExtras.forEach(ex=>{
        const m=roundMoney(ex.monto||0);
        if(ex.banco&&m>0)aportes.push({banco:ex.banco,monto:m});
    });
    return aportes;
}
function _updateSplitStatus(){
    /* Re-render parcial del status sin tocar inputs (preserva foco) */
    const panel=$('splitPanel');if(!panel||panel.style.display==='none')return;
    const statusEl=panel.querySelector('.split-status');if(!statusEl)return;
    const state=_computeSplitState();if(!state||!state.aplicaSplit)return;
    const{bancoPrinc,totalNecesario,totalAportado,faltante,cubierto,exceso}=state;
    const sy=getSym(getBancoInfo(bancoPrinc)?.moneda||'UYU');
    if(cubierto){
        statusEl.className='split-status ok';
        statusEl.textContent=`✓ Total cubierto · ${sy}${fmtMonto(totalAportado)}`;
    }else if(exceso){
        statusEl.className='split-status error';
        statusEl.textContent=`Exceso de ${sy}${fmtMonto(Math.abs(faltante))} · ajustá los aportes`;
    }else{
        statusEl.className='split-status error';
        statusEl.textContent=`Falta ${sy}${fmtMonto(faltante)} · aportado ${sy}${fmtMonto(totalAportado)} de ${sy}${fmtMonto(totalNecesario)}`;
    }
    /* Actualizar también el botón "Agregar cuenta para cubrir $X" si está presente */
    const addBtn=panel.querySelector('[data-action="split-add"]');
    if(addBtn){
        if(faltante>=SPLIT_EPSILON){
            addBtn.textContent=`＋ Agregar cuenta para cubrir ${sy}${fmtMonto(faltante)}`;
            addBtn.style.display='';
        }else{
            addBtn.style.display='none';
        }
    }
}
/* Validar que aportes cubran totalNecesario exactamente y cada banco tenga saldo */
function validarAportes(){
    const aportes=getAportes();
    if(!aportes)return{ok:true};
    const state=_computeSplitState();
    if(!state||!state.aplicaSplit)return{ok:true};
    const sy=getSym(getBancoInfo(state.bancoPrinc)?.moneda||'UYU');
    /* Usar el faltante normalizado del estado — misma fuente de verdad que la UI */
    if(!state.cubierto){
        if(state.exceso){
            return{ok:false,msg:`Los aportes exceden el total por ${sy}${fmtMonto(Math.abs(state.faltante))}. Ajustá los montos.`};
        }
        return{ok:false,msg:`Faltan ${sy}${fmtMonto(state.faltante)} para cubrir el total. Agregá una cuenta o ajustá los montos.`};
    }
    /* Validar saldos individuales con tolerancia consistente */
    for(const a of aportes){
        const bk=AppState.datos.bancos[a.banco];
        if(!bk)return{ok:false,msg:`El banco ${a.banco} no existe`};
        if(bk.saldo<a.monto-SPLIT_EPSILON)return{ok:false,msg:`${a.banco} solo tiene ${sy}${fmtMonto(bk.saldo)}`};
    }
    return{ok:true,aportes};
}

async function agregarOperacion(){
    if(AppState.ui.enCooldown||AppState.ui.guardandoOperacion)return;const btn=$('btnAgregarOp');if(btn.disabled)return;
    const t=$('tipo').value,m=pv('monto'),ti=$('tasa'),ta=parsearTasa(ti.value),b=$('banco').value,cb=roundMoney(pv('comisionBanco')),f=getUDateStr(),h=getUTimeStr(),mon=getMonedaBanco(),isU=mon==='USD',cpv=getComisionActual(),cp=cpv/100;
    if(!m){alert('Ingresá el monto');return}
    if(!ta){ti.classList.add('error');$('tasaHelp').textContent='Formato inválido';$('tasaHelp').className='error-text';$('tasaHelp').style.display='block';alert('Tasa inválida (ej: '+(isU?'1,025':'39,50')+')');return}
    if(!b){$('bancoHelp').textContent='Seleccioná un banco';$('bancoHelp').className='error-text';$('banco').classList.add('error');alert('Seleccioná un banco');return}
    $('banco').classList.remove('error');
    /* Split pago: si activo, validar aportes antes de continuar */
    const isSplit=t==='compra'&&splitActivo();
    let aportes=null;
    if(isSplit){
        const val=validarAportes();
        if(!val.ok){alert(val.msg);return}
        aportes=val.aportes;
    }
    /* monto = UYU directamente */
    const u=usdtBase(m/ta,t),cpl=truncar(u*cp,2);
    if(t==='compra'){
        const bk=AppState.datos.bancos[b];
        if(bk.limiteDiarioUSD>0){const mU=isU?m:truncar(m/ta),dU=roundMoney(bk.limiteDiarioUSD-(bk.limiteUsadoUSD||0));if(mU>dU){alert(`Excede el límite diario. Disponible: US$${fmtNum(dU,0)} (${fmtNum(mU,2)} USD requeridos)`);return}}
        /* INTEGRIDAD: validación dura — no se permite saldo negativo bajo ninguna circunstancia */
        if(isSplit){
            const valI=validarDeltas({aportes});
            if(!valI.ok){alert('🚫 No se puede guardar:\n\n'+valI.reason);return}
        }else{
            const valI=validarDeltas({bancos:{[b]:-(m+cb)}});
            if(!valI.ok){alert('🚫 No se puede comprar:\n\n'+valI.reason);return}
        }
    }else{
        /* INTEGRIDAD: no se puede vender más USDT del disponible en lotes activos de la moneda */
        const un=usdtNeto(u,cpl,t);
        const valI=validarDeltas({usdt:-un,usdtMoneda:mon||'UYU'});
        if(!valI.ok){alert('🚫 No se puede vender:\n\n'+valI.reason);return}
    }
    AppState.ui.guardandoOperacion=true;btn.disabled=true;btn.textContent='Guardando...';
    try{
        const opId=uid();
        if(t==='compra'){
            /* Construir deltas: saldos + límite USD (solo al banco principal) */
            const deltas={bancos:{},limitesUSD:{}};
            if(isSplit){
                aportes.forEach(a=>{deltas.bancos[a.banco]=(deltas.bancos[a.banco]||0)-a.monto});
            }else{
                deltas.bancos[b]=-(m+cb);
            }
            const mU=_montoEnUSDLimite(b,isSplit?m:m);
            if(mU>0)deltas.limitesUSD[b]=mU;
            aplicarDeltas(deltas);
        }else{
            aplicarDeltas({bancos:{[b]:m}});
        }
        const opRecord={id:opId,tipo:t,monto:m,tasa:ta,usdt:u,banco:b,moneda:mon,comisionBanco:t==='compra'?cb:0,comisionPlataforma:cpl,comisionPct:cpv,fecha:f,hora:h,ganancia:0,timestamp:new Date().toISOString()};
        /* Persistir aportes para trazabilidad y reverso correcto en delete/edit */
        if(isSplit)opRecord.aportes=aportes;
        AppState.datos.operaciones.unshift(opRecord);
        recalcularLotesYGanancias();
        agregarTasaReciente(ta,t,mon);
        $('monto').value='';$('comisionBanco').value='0';$('previewBox').style.display='none';$('opSummary').style.display='none';AppState.ui.paginaOp=1;AppState.ui.tasaManual=false;
        /* Reset banco selection — prevents accidental reuse of prior bank on next op */
        $('banco').value='';
        $('bancoHelp').textContent='';
        $('saldoBancoInfo').textContent='';
        AppState.ui.splitExtras=[];
        renderSplitPanel();
        actualizarColorBancoSelect();
        actualizarVista();actualizarColorSelect();activarCooldown();
        guardaOptimista('create','operaciones',opId);
        const sy2=mon==='USD'?'US$':'$';
        const subMsg=isSplit?`Pago dividido entre ${aportes.length} cuentas`:'Tasa: '+sy2+fmtNum(ta,mon==='USD'?3:2)+' · '+b;
        showSuccess({amount:sy2+fmtNum(m),message:(t==='compra'?'Comprados ':'Vendidos ')+fmtTrunc(u,2)+' USDT con éxito',sub:subMsg});
    }catch(e){console.error('[P2P] Error guardando operación:',e)}finally{AppState.ui.guardandoOperacion=false;btn.disabled=false;actualizarColorSelect()}
}

async function eliminarOperacion(id){
    const op=AppState.datos.operaciones.find(o=>o.id===id);if(!op)return;
    /* INTEGRIDAD: pre-validar que el rollback no deje saldos negativos */
    const deltas={bancos:{}};
    if(op.tipo==='compra'){
        if(Array.isArray(op.aportes)&&op.aportes.length){
            op.aportes.forEach(a=>{deltas.bancos[a.banco]=(deltas.bancos[a.banco]||0)+a.monto});
        }else if(op.banco){
            deltas.bancos[op.banco]=roundMoney(op.monto+(op.comisionBanco||0));
        }
    }else{
        /* Venta: revertir suma positiva al banco → restar. Si banco ya gastó esos UYU, queda negativo. */
        if(op.banco)deltas.bancos[op.banco]=-op.monto;
    }
    const valI=validarDeltas(deltas);
    if(!valI.ok){
        alert('🚫 No se puede eliminar esta operación:\n\n'+valI.reason+'\n\nProbablemente ya gastaste los fondos generados. Eliminá primero las operaciones posteriores que los consumen.');
        return;
    }
    if(!confirm('¿Eliminar operación? Se recalcularán los lotes y ganancias.'))return;
    try{
        if(op.tipo==='compra'){
            if(Array.isArray(op.aportes)&&op.aportes.length){
                op.aportes.forEach(a=>{
                    if(AppState.datos.bancos[a.banco])AppState.datos.bancos[a.banco].saldo=fixNeg(AppState.datos.bancos[a.banco].saldo+a.monto);
                });
                if(op.banco&&AppState.datos.bancos[op.banco]&&AppState.datos.bancos[op.banco].limiteDiarioUSD>0&&op.tasa>0){
                    const mU=roundMoney(op.monto/op.tasa);
                    AppState.datos.bancos[op.banco].limiteUsadoUSD=Math.max(0,roundMoney((AppState.datos.bancos[op.banco].limiteUsadoUSD||0)-mU));
                }
            }else if(op.banco&&AppState.datos.bancos[op.banco]){
                AppState.datos.bancos[op.banco].saldo=fixNeg(AppState.datos.bancos[op.banco].saldo+roundMoney(op.monto+(op.comisionBanco||0)));
                if(AppState.datos.bancos[op.banco].limiteDiarioUSD>0&&op.tasa>0){const mU=roundMoney(op.monto/op.tasa);AppState.datos.bancos[op.banco].limiteUsadoUSD=Math.max(0,roundMoney((AppState.datos.bancos[op.banco].limiteUsadoUSD||0)-mU))}
            }
        }else{
            if(op.banco&&AppState.datos.bancos[op.banco])AppState.datos.bancos[op.banco].saldo=fixNeg(AppState.datos.bancos[op.banco].saldo-op.monto);
        }
        AppState.datos.operaciones=AppState.datos.operaciones.filter(o=>o.id!==id);
        recalcularLotesYGanancias();actualizarVista();
        verificarIntegridadGlobal();
        guardaOptimista('delete','operaciones',id);
    }catch(e){console.error('[P2P] Error eliminando operación:',e)}
}

function abrirEditarOperacion(id){
    const op=AppState.datos.operaciones.find(o=>o.id===id);if(!op)return;
    /* Cualquier operación con aportes (split pago) no puede editarse directamente — 
       hay que eliminar y recrear para mantener la coherencia de los saldos por banco */
    if(Array.isArray(op.aportes)&&op.aportes.length>0){
        alert('Esta operación se pagó con múltiples cuentas. Por ahora no se puede editar directamente — eliminala y recreala si necesitás cambiarla.');
        return;
    }
    AppState.ui.opEditandoId=id;
    const sy=op.moneda==='USD'?'US$':'$',td=op.moneda==='USD'?3:2;
    const badge=op.tipo==='compra'?'📥 Compra':'📤 Venta';
    setText('editarOpHeader','✏️ Editar '+badge);
    setText('editOpMontoLabel',op.tipo==='compra'?`Monto pagado (${op.moneda||'UYU'})`:`Monto recibido (${op.moneda||'UYU'})`);
    $('editOpMonto').value=fmtNum(op.monto);
    $('editOpTasa').value=fmtTasa(op.tasa,op.moneda||'UYU');
    /* Comisión Binance: poblar con el valor persistido en la operación.
       Fallback al global de la moneda si la op no tiene (datos legacy). */
    const cpOp=op.comisionPct!==undefined?op.comisionPct:(op.moneda==='USD'?(AppState.datos.comisionUSD||0.14):(AppState.datos.comisionPlataforma||0.14));
    $('editOpComisionPct').value=fmtNum(cpOp);
    $('editOpComisionPct').classList.remove('error');
    /* Poblar select de bancos */
    const sel=$('editOpBanco');sel.innerHTML='';
    getBancosActivos().forEach(b=>{sel.innerHTML+=`<option value="${b.nombre}" style="color:${b.color||'#1e293b'};font-weight:600"${b.nombre===op.banco?' selected':''}>${b.nombre}</option>`});
    sel.style.color=getBancoColor(op.banco);sel.style.fontWeight='600';
    /* Info y preview */
    $('editarOpInfo').innerHTML=`${fmtFechaCorta(op.fecha)} ${op.hora||''} · ${sy}${fmtNum(op.tasa,td)} · ${fmtTrunc(op.usdt,2)} USDT`;
    calcularEditOpPreview();
    abrirModal('modalEditarOp');
}

/* Lee el % de comisión del input del modal. Si está inválido, retorna fallback de la op.
   Separado para poder reutilizarse en preview y en guardar. */
function _editOpComisionPctLeida(op){
    const raw=$('editOpComisionPct').value.replace(',','.').trim();
    const v=parsearComisionPct(raw);
    if(v!==null)return v;
    /* Fallback — mismo que en abrir */
    return op.comisionPct!==undefined?op.comisionPct:(op.moneda==='USD'?(AppState.datos.comisionUSD||0.14):(AppState.datos.comisionPlataforma||0.14));
}

function calcularEditOpPreview(){
    const op=AppState.datos.operaciones.find(o=>o.id===AppState.ui.opEditandoId);if(!op)return;
    const m=pv('editOpMonto'),ta=parsearTasa($('editOpTasa').value),pbox=$('editOpPreview');
    if(m>0&&ta){
        /* Usar el % del input editable (no el persistido) para preview en vivo */
        const cpct=_editOpComisionPctLeida(op)/100;
        const u=usdtBase(m/ta,op.tipo),c=truncar(u*cpct,2),neto=usdtNeto(u,c,op.tipo);
        setText('editOpComisionInfo',fmtTrunc(c,2)+' USDT');
        pbox.innerHTML=op.tipo==='compra'
            ?`📥 Recibís <b>${fmtNum(neto,2)} USDT</b> <span style="color:#64748b;font-size:0.85em">(base: ${fmtNum(u,2)})</span>`
            :`📤 Entregás <b>${fmtNum(neto,2)} USDT</b>`;
        pbox.style.display='block';
    }else{
        setText('editOpComisionInfo','0 USDT');
        pbox.style.display='none';
    }
}

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
        showSuccess({amount:(op.moneda==='USD'?'US$':'$')+fmtNum(newM),message:'Operación actualizada con éxito',sub:op.tipo==='compra'?'Compra editada':'Venta editada'});
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
    else{const bi=getBancoInfo(b);const sym=bi?.moneda==='USD'?'US$':'$';target=b;monto=sym+fmtNum(m)}
    r.className='mov-resumen'+(isIngreso?'':' egreso');
    r.style.display='flex';
    r.innerHTML=`<span class="mov-resumen-icon">${isIngreso?'📥':'📤'}</span><span class="mov-resumen-text">${verbo} <b>${monto}</b> ${prep} <b>${escHtml(target)}</b></span>`;
}

async function guardarMovimiento(){
    if(AppState.ui.guardandoMovimiento||AppState.ui.enCooldown)return;
    const btn=$('btnGuardarMov');if(btn.disabled)return;
    const editId=AppState.ui.movEditandoId;
    const editing=!!editId;
    const original=editing?AppState.datos.movimientos.find(m=>m.id===editId):null;
    if(editing&&!original){AppState.ui.movEditandoId=null;return}
    const tc=$('movTipoCuenta').value,b=$('movBanco').value,m=pv('movMonto'),desc=$('movDescripcion').value,tRef=tc==='usdt'&&AppState.ui.tipoMovimiento==='ingreso'?pv('movTasaRef'):0;
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
    const o=$('bancoOrigen').value,d=$('bancoDestino').value,m=pv('montoTransferencia'),t=pv('transfTasa');
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
        const t=cross?pv('transfTasa'):0;
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
        const t=pv('transfTasa');
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

