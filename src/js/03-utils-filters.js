/* ═══════════════════════════════════════════════════════════════════
   03-utils-filters.js
   Generated piece — concatenated into dist/index.html by build/build.js
   Source of truth: src/js/03-utils-filters.js
   Do NOT edit dist/index.html directly. Edit the source and re-run build.
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════
   §4 — UTILIDADES PURAS
   ═══════════════════════════════════════ */
/* fixNeg: redondea a 2 decimales y maneja -0 y NaN. NO impide saldos negativos.
   El nombre es histórico — la protección anti-negativo real vive en validarDeltas(),
   que se ejecuta ANTES de toda mutación crítica. fixNeg solo es una red de seguridad
   contra epsilon de punto flotante (-0 puede aparecer por restas exactas) y valores 
   inválidos de inputs. Si llegás a un saldo negativo en bk.saldo, validarDeltas falló 
   o se omitió en algún path — investigar ahí, no en fixNeg. */
function fixNeg(n){if(Object.is(n,-0))return 0;const r=Number(Math.round(parseFloat(n+'e2'))+'e-2');return isNaN(r)?0:r}
let _idCounter=Math.floor(Math.random()*1000);
function uid(){return Date.now()*1000+((_idCounter++)%1000)}
function truncar(n,d=2){if(isNaN(n)||!isFinite(n))return 0;const f=Number(n+'e'+d);return Number(Math.floor(f)+'e-'+d)}
function roundMoney(n,d=2){if(isNaN(n)||!isFinite(n))return 0;const r=Number(Math.round(parseFloat(n+'e'+d))+'e-'+d);return Object.is(r,-0)?0:r}
/* truncUsdt: truncar a 2dp — uso conservador para FIFO, lotes, saldos internos */
function truncUsdt(n){return truncar(n,2)}
/* Binance-matching: compra=round, venta=truncar para la base USDT (monto/tasa) */
function usdtBase(n,tipo){return tipo==='compra'?roundMoney(n,2):truncar(n,2)}
function usdtNeto(base,com,tipo){return tipo==='compra'?roundMoney(base-com,2):truncar(base+com,2)}
function fmtNum(n,d=2){if(!isFinite(n))n=0;return n.toLocaleString('es-UY',{minimumFractionDigits:d,maximumFractionDigits:d})}
/* Formatear con truncado (conservador) — para mostrar USDT de inventario/lotes */
function fmtTrunc(n,d=2){if(!isFinite(n))n=0;const t=truncar(n,d);return t.toLocaleString('es-UY',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fmtTasa(n,mon){if(!isFinite(n))return'0';if(mon==='USD'){const s=n.toString(),dec=s.includes('.')?s.split('.')[1].length:0;const d=dec>2?3:2;return n.toLocaleString('es-UY',{minimumFractionDigits:d,maximumFractionDigits:d})}return n.toLocaleString('es-UY',{minimumFractionDigits:2,maximumFractionDigits:2})}
function parsearTasa(v){if(!v)return null;const l=v.toString().replace(',','.').trim();if(!/^\d+(\.\d{1,3})?$/.test(l))return null;const n=parseFloat(l);return isNaN(n)||n<=0?null:n}
function parsearComisionPct(v){if(!v&&v!==0)return null;const l=v.toString().replace(',','.').trim();if(!l||l==='.')return null;if(!/^\d*\.?\d*$/.test(l))return null;const n=parseFloat(l);return isNaN(n)||n<0||n>10?null:n}
/* Leer valor numérico de cualquier input (formato es-UY).
   Reglas: coma presente → dots=miles, comma=decimal.
   Sin coma: dot+3dígitos al final (50.000) → miles; dot+1-2dígitos (42.50) → decimal. */
function pv(id){
    const el=$(id);if(!el)return 0;
    const v=el.value.toString().trim();if(!v)return 0;
    if(v.includes(',')){
        /* Coma presente → dots=miles, comma=decimal */
        const cleaned=v.replace(/\./g,'').replace(',','.');
        return parseFloat(cleaned)||0;
    }
    if(v.includes('.')){
        /* Dots sin coma: 
           - Todos los grupos tras el primer dot son de 3 dígitos → miles (42.000, 1.234.567)
           - Un solo dot con 1-2 dígitos al final → decimal (42.50)
           - Formato mixto ambiguo (1.234.5) → rechazar */
        const parts=v.split('.');
        if(parts.length===2){
            /* Un solo dot */
            if(parts[1].length===3&&/^\d+$/.test(parts[1]))return parseFloat(v.replace(/\./g,''))||0; /* miles */
            return parseFloat(v)||0; /* decimal */
        }
        /* Múltiples dots → todos deben ser grupos de 3 */
        if(parts.slice(1).every(g=>g.length===3&&/^\d+$/.test(g)))return parseFloat(v.replace(/\./g,''))||0;
        return 0; /* Formato ambiguo/inválido — safer than silently losing data */
    }
    return parseFloat(v)||0;
}
function getUDate(){const n=new Date(),u=n.getTime()+n.getTimezoneOffset()*60000;return new Date(u-3*3600000)}
function getUDateStr(){const d=getUDate();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function getMesActivo(){const d=getUDate();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function filtrarMes(arr){const m=getMesActivo();return arr.filter(x=>x.fecha&&x.fecha.startsWith(m))}
function opsMes(){return filtrarMes(AppState.datos.operaciones)}

/* ═══════════════════════════════════════
   §OF — FILTROS RÁPIDOS OPERACIONES
   ═══════════════════════════════════════ */
/* Estado de filtros persistido en AppState.ui.opsFilters */
function _initOpsFilters(){
    if(!AppState.ui.opsFilters)AppState.ui.opsFilters={tipo:'all',banco:'all',resultado:'all',fecha:'mes'};
}
function _opsFiltersActive(){
    _initOpsFilters();
    const f=AppState.ui.opsFilters;
    return f.tipo!=='all'||f.banco!=='all'||f.resultado!=='all'||f.fecha!=='mes';
}
/* Filtra operaciones aplicando todos los filtros combinables */
function aplicarOpsFilters(ops){
    _initOpsFilters();
    const f=AppState.ui.opsFilters;
    if(f.tipo==='all'&&f.banco==='all'&&f.resultado==='all'&&f.fecha==='mes')return ops;
    /* Para filtros de fecha distintos a "mes" usamos la lista completa */
    let src=(f.fecha==='mes')?ops:AppState.datos.operaciones;
    /* CRÍTICO: usar getUDate() (timezone Uruguay, UTC-3) — NO new Date() + toISOString() 
       que retorna UTC. Un usuario a las 21:00 local vería "ayer" desfasado por 3h. */
    const fmtUY=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const hoyUY=getUDate();
    const hoyStr=fmtUY(hoyUY);
    const ayerUY=new Date(hoyUY.getTime()-86400000);
    const ayerStr=fmtUY(ayerUY);
    const hace7UY=new Date(hoyUY.getTime()-6*86400000);
    const hace7Str=fmtUY(hace7UY);
    return src.filter(op=>{
        if(f.tipo!=='all'&&op.tipo!==f.tipo)return false;
        /* Banco: considera op.banco y aportes si hay split */
        if(f.banco!=='all'){
            let match=op.banco===f.banco;
            if(!match&&Array.isArray(op.aportes))match=op.aportes.some(a=>a.banco===f.banco);
            if(!match)return false;
        }
        if(f.resultado!=='all'){
            const g=op.ganancia||0;
            if(f.resultado==='ganancia'&&g<=0.005)return false;
            if(f.resultado==='perdida'&&g>=-0.005)return false;
            if(f.resultado==='sin-gan'&&Math.abs(g)>=0.005)return false;
        }
        if(f.fecha!=='mes'){
            if(f.fecha==='hoy'&&op.fecha!==hoyStr)return false;
            if(f.fecha==='ayer'&&op.fecha!==ayerStr)return false;
            if(f.fecha==='7dias'&&(op.fecha<hace7Str||op.fecha>hoyStr))return false;
        }
        return true;
    });
}
/* Lista de bancos que aparecen en las operaciones (para chip dinámico) */
function _bancosEnOperaciones(){
    const set=new Set();
    AppState.datos.operaciones.forEach(op=>{
        if(op.banco)set.add(op.banco);
        if(Array.isArray(op.aportes))op.aportes.forEach(a=>a.banco&&set.add(a.banco));
    });
    return [...set];
}
function renderOpsFilters(){
    _initOpsFilters();
    const count=_countActiveFilters();
    const isOpen=AppState.ui._filtersOpen||false;
    const f=AppState.ui.opsFilters;

    /* 1. Actualizar trigger en header */
    const trig=$('opsFiltrosTrigger'),label=$('opsFiltrosTriggerLabel'),badge=$('opsFiltrosBadge');
    if(trig){
        trig.classList.toggle('open',isOpen);
        trig.classList.toggle('has-active',count>0);
        if(label)label.textContent=count>0?`${count} activo${count>1?'s':''}`:'Filtros';
        if(badge){
            if(count>0){badge.textContent=count;badge.classList.remove('hidden')}
            else badge.classList.add('hidden');
        }
    }

    /* 2. Render de la franja inline */
    const c=$('opsFiltros');if(!c)return;
    c.classList.toggle('open',isOpen);
    const chip=(id,val,l,cur,cls)=>`<button class="ops-fchip${cur===val?' active'+(cls?' '+cls:''):''}" data-action="ops-filter" data-filter="${id}" data-val="${val}">${l}</button>`;
    const sep='<div class="ops-filtros-sep"></div>';
    let h=`<div class="ops-filtros-chips">`;
    h+=chip('tipo','compra','Compras',f.tipo,'compra');
    h+=chip('tipo','venta','Ventas',f.tipo,'venta');
    const bancos=_bancosEnOperaciones().filter(b=>AppState.datos.bancos[b]?.activo);
    if(bancos.length){h+=sep;bancos.forEach(b=>{h+=chip('banco',b,b,f.banco)})}
    h+=sep;
    h+=chip('resultado','ganancia','+ Ganancia',f.resultado,'ganancia');
    h+=chip('resultado','sin-gan','0 Neutro',f.resultado,'neutro');
    h+=chip('resultado','perdida','- Pérdida',f.resultado,'perdida');
    h+=sep;
    h+=chip('fecha','hoy','Hoy',f.fecha);
    h+=chip('fecha','ayer','Ayer',f.fecha);
    h+=chip('fecha','7dias','7 días',f.fecha);
    h+=chip('fecha','mes','Mes',f.fecha);
    if(count>0){h+=sep;h+=`<button class="ops-fchip-clear" data-action="ops-filter-clear">Limpiar</button>`}
    h+=`</div>`;
    c.innerHTML=h;
}
function _countActiveFilters(){
    _initOpsFilters();
    const f=AppState.ui.opsFilters;
    let n=0;
    if(f.tipo!=='all')n++;
    if(f.banco!=='all')n++;
    if(f.resultado!=='all')n++;
    if(f.fecha!=='mes')n++;
    return n;
}
function toggleOpsFilters(){
    AppState.ui._filtersOpen=!AppState.ui._filtersOpen;
    /* Si la sección estaba colapsada, abrirla para que la franja sea visible */
    if(AppState.ui._filtersOpen)$('seccionOperaciones')?.classList.add('open');
    renderOpsFilters();
}
function setOpsFilter(filter,val){
    _initOpsFilters();
    if(AppState.ui.opsFilters[filter]===val)AppState.ui.opsFilters[filter]='all';
    else AppState.ui.opsFilters[filter]=val;
    AppState.ui.paginaOp=1;
    renderOpsFilters();
    pagOp.render();
}
function clearOpsFilters(){
    AppState.ui.opsFilters={tipo:'all',banco:'all',resultado:'all',fecha:'mes'};
    AppState.ui.paginaOp=1;
    renderOpsFilters();
    pagOp.render();
}
function movsMes(){return filtrarMes(AppState.datos.movimientos)}
function transMes(){return filtrarMes(AppState.datos.transferencias)}
function convMes(){return filtrarMes(AppState.datos.conversiones||[])}

/* ═══════════════════════════════════════
   §MF — FILTROS RÁPIDOS AJUSTES (MOVIMIENTOS)
   ═══════════════════════════════════════ */
/* Estado de filtros para movs persistido en AppState.ui.movsFilters.
   Filtros disponibles: tipo (ingreso/egreso), cuenta (banco/usdt), tag, fecha. */
function _initMovsFilters(){
    if(!AppState.ui.movsFilters)AppState.ui.movsFilters={tipo:'all',cuenta:'all',tag:'all',fecha:'mes'};
}
function _movsFiltersActive(){
    _initMovsFilters();
    const f=AppState.ui.movsFilters;
    return f.tipo!=='all'||f.cuenta!=='all'||f.tag!=='all'||f.fecha!=='mes';
}
function aplicarMovsFilters(movs){
    _initMovsFilters();
    const f=AppState.ui.movsFilters;
    if(f.tipo==='all'&&f.cuenta==='all'&&f.tag==='all'&&f.fecha==='mes')return movs;
    let src=(f.fecha==='mes')?movs:AppState.datos.movimientos;
    const fmtUY=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const hoyUY=getUDate();
    const hoyStr=fmtUY(hoyUY);
    const ayerStr=fmtUY(new Date(hoyUY.getTime()-86400000));
    const hace7Str=fmtUY(new Date(hoyUY.getTime()-6*86400000));
    return src.filter(m=>{
        if(f.tipo!=='all'&&m.tipoMovimiento!==f.tipo)return false;
        if(f.cuenta!=='all'){
            if(f.cuenta==='__usdt'){if(m.tipoCuenta!=='usdt')return false}
            else{if(m.banco!==f.cuenta)return false}
        }
        if(f.tag!=='all'){
            const tagAct=tagKey(m.descripcion||'');
            if(tagAct!==tagKey(f.tag))return false;
        }
        if(f.fecha==='hoy'&&m.fecha!==hoyStr)return false;
        if(f.fecha==='ayer'&&m.fecha!==ayerStr)return false;
        if(f.fecha==='7dias'&&(m.fecha<hace7Str||m.fecha>hoyStr))return false;
        return true;
    });
}
function _bancosEnMovs(){
    const set=new Set();
    AppState.datos.movimientos.forEach(m=>{if(m.banco)set.add(m.banco)});
    return Array.from(set);
}
function _tagsEnMovs(){
    const set=new Set();
    AppState.datos.movimientos.forEach(m=>{if(m.descripcion)set.add(m.descripcion.split(' / ')[0]||m.descripcion)});
    return Array.from(set).slice(0,8); /* cap visual a 8 tags más comunes */
}
function _countActiveMovsFilters(){
    _initMovsFilters();
    const f=AppState.ui.movsFilters;
    let n=0;
    if(f.tipo!=='all')n++;
    if(f.cuenta!=='all')n++;
    if(f.tag!=='all')n++;
    if(f.fecha!=='mes')n++;
    return n;
}
function renderMovsFilters(){
    _initMovsFilters();
    const f=AppState.ui.movsFilters;
    const isOpen=AppState.ui._movFiltersOpen||false;
    const count=_countActiveMovsFilters();
    const trig=$('movFiltrosTrigger');
    if(trig){
        trig.classList.toggle('open',isOpen);
        trig.classList.toggle('has-active',count>0);
        const label=trig.querySelector('.ops-filtros-trigger-label');
        const badge=$('movFiltrosBadge');
        if(label)label.textContent=count>0?`${count} activo${count>1?'s':''}`:'Filtros';
        if(badge){
            if(count>0){badge.textContent=count;badge.classList.remove('hidden')}
            else badge.classList.add('hidden');
        }
    }
    const c=$('movFiltrosDrawer');if(!c)return;
    c.style.display=isOpen?'block':'none';
    if(!isOpen)return;
    const chip=(id,val,l,cur,cls)=>`<button class="ops-fchip${cur===val?' active'+(cls?' '+cls:''):''}" data-action="movs-filter" data-filter="${id}" data-val="${val}">${l}</button>`;
    const sep='<div class="ops-filtros-sep"></div>';
    let h=`<div class="ops-filtros-chips">`;
    h+=chip('tipo','ingreso','Ingresos',f.tipo,'compra');
    h+=chip('tipo','egreso','Egresos',f.tipo,'venta');
    const cuentas=_bancosEnMovs().filter(b=>AppState.datos.bancos[b]?.activo);
    if(cuentas.length){h+=sep;cuentas.forEach(b=>{h+=chip('cuenta',b,b,f.cuenta)});h+=chip('cuenta','__usdt','USDT',f.cuenta)}
    const tags=_tagsEnMovs();
    if(tags.length){h+=sep;tags.forEach(t=>{h+=chip('tag',t,'🏷️ '+t,f.tag)})}
    h+=sep;
    h+=chip('fecha','hoy','Hoy',f.fecha);
    h+=chip('fecha','ayer','Ayer',f.fecha);
    h+=chip('fecha','7dias','7 días',f.fecha);
    h+=chip('fecha','mes','Mes',f.fecha);
    if(count>0){h+=sep;h+=`<button class="ops-fchip-clear" data-action="movs-filter-clear">Limpiar</button>`}
    h+=`</div>`;
    c.innerHTML=h;
}
function toggleMovsFilters(){
    AppState.ui._movFiltersOpen=!AppState.ui._movFiltersOpen;
    if(AppState.ui._movFiltersOpen)$('seccionMovimientos')?.classList.add('open');
    renderMovsFilters();
}
function setMovsFilter(filter,val){
    _initMovsFilters();
    if(AppState.ui.movsFilters[filter]===val)AppState.ui.movsFilters[filter]='all';
    else AppState.ui.movsFilters[filter]=val;
    AppState.ui.paginaMov=1;
    _invalidateListCache('pagMov');
    renderMovsFilters();
    pagMov.render();
}
function clearMovsFilters(){
    AppState.ui.movsFilters={tipo:'all',cuenta:'all',tag:'all',fecha:'mes'};
    AppState.ui.paginaMov=1;
    _invalidateListCache('pagMov');
    renderMovsFilters();
    pagMov.render();
}

/* ═══════════════════════════════════════
   §TF — FILTROS RÁPIDOS TRANSFERENCIAS
   ═══════════════════════════════════════ */
function _initTransFilters(){
    if(!AppState.ui.transFilters)AppState.ui.transFilters={origen:'all',destino:'all',fecha:'mes'};
}
function _transFiltersActive(){
    _initTransFilters();
    const f=AppState.ui.transFilters;
    return f.origen!=='all'||f.destino!=='all'||f.fecha!=='mes';
}
function aplicarTransFilters(trans){
    _initTransFilters();
    const f=AppState.ui.transFilters;
    if(f.origen==='all'&&f.destino==='all'&&f.fecha==='mes')return trans;
    let src=(f.fecha==='mes')?trans:AppState.datos.transferencias;
    const fmtUY=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const hoyUY=getUDate();
    const hoyStr=fmtUY(hoyUY);
    const ayerStr=fmtUY(new Date(hoyUY.getTime()-86400000));
    const hace7Str=fmtUY(new Date(hoyUY.getTime()-6*86400000));
    return src.filter(t=>{
        if(f.origen!=='all'&&t.origen!==f.origen)return false;
        if(f.destino!=='all'&&t.destino!==f.destino)return false;
        if(f.fecha==='hoy'&&t.fecha!==hoyStr)return false;
        if(f.fecha==='ayer'&&t.fecha!==ayerStr)return false;
        if(f.fecha==='7dias'&&(t.fecha<hace7Str||t.fecha>hoyStr))return false;
        return true;
    });
}
function _bancosEnTrans(){
    const set=new Set();
    AppState.datos.transferencias.forEach(t=>{if(t.origen)set.add(t.origen);if(t.destino)set.add(t.destino)});
    return Array.from(set);
}
function _countActiveTransFilters(){
    _initTransFilters();
    const f=AppState.ui.transFilters;
    let n=0;
    if(f.origen!=='all')n++;
    if(f.destino!=='all')n++;
    if(f.fecha!=='mes')n++;
    return n;
}
function renderTransFilters(){
    _initTransFilters();
    const f=AppState.ui.transFilters;
    const isOpen=AppState.ui._transFiltersOpen||false;
    const count=_countActiveTransFilters();
    const trig=$('transFiltrosTrigger');
    if(trig){
        trig.classList.toggle('open',isOpen);
        trig.classList.toggle('has-active',count>0);
        const label=trig.querySelector('.ops-filtros-trigger-label');
        const badge=$('transFiltrosBadge');
        if(label)label.textContent=count>0?`${count} activo${count>1?'s':''}`:'Filtros';
        if(badge){
            if(count>0){badge.textContent=count;badge.classList.remove('hidden')}
            else badge.classList.add('hidden');
        }
    }
    const c=$('transFiltrosDrawer');if(!c)return;
    c.style.display=isOpen?'block':'none';
    if(!isOpen)return;
    const chip=(id,val,l,cur)=>`<button class="ops-fchip${cur===val?' active':''}" data-action="trans-filter" data-filter="${id}" data-val="${val}">${l}</button>`;
    const sep='<div class="ops-filtros-sep"></div>';
    let h=`<div class="ops-filtros-chips">`;
    const cuentas=_bancosEnTrans().filter(b=>AppState.datos.bancos[b]?.activo);
    if(cuentas.length){
        h+=`<div class="ops-fgroup-label">Origen</div>`;
        cuentas.forEach(b=>{h+=chip('origen',b,b,f.origen)});
        h+=sep;
        h+=`<div class="ops-fgroup-label">Destino</div>`;
        cuentas.forEach(b=>{h+=chip('destino',b,b,f.destino)});
        h+=sep;
    }
    h+=chip('fecha','hoy','Hoy',f.fecha);
    h+=chip('fecha','ayer','Ayer',f.fecha);
    h+=chip('fecha','7dias','7 días',f.fecha);
    h+=chip('fecha','mes','Mes',f.fecha);
    if(count>0){h+=sep;h+=`<button class="ops-fchip-clear" data-action="trans-filter-clear">Limpiar</button>`}
    h+=`</div>`;
    c.innerHTML=h;
}
function toggleTransFilters(){
    AppState.ui._transFiltersOpen=!AppState.ui._transFiltersOpen;
    if(AppState.ui._transFiltersOpen)$('seccionTransferencias')?.classList.add('open');
    renderTransFilters();
}
function setTransFilter(filter,val){
    _initTransFilters();
    if(AppState.ui.transFilters[filter]===val)AppState.ui.transFilters[filter]='all';
    else AppState.ui.transFilters[filter]=val;
    AppState.ui.paginaTrans=1;
    _invalidateListCache('pagTrans');
    renderTransFilters();
    pagTrans.render();
}
function clearTransFilters(){
    AppState.ui.transFilters={origen:'all',destino:'all',fecha:'mes'};
    AppState.ui.paginaTrans=1;
    _invalidateListCache('pagTrans');
    renderTransFilters();
    pagTrans.render();
}
function getUTimeStr(){const d=getUDate();return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
function fmtFechaCorta(f){if(!f)return'-';const p=f.split('-');return p.length===3?`${p[2]}/${p[1]}`:f}
/* Fecha + hora para listas: "13/04 · 21:10". Fallback: extraer hora de timestamp ISO si hora falta. */
function fmtFechaHora(fecha,hora,timestamp){
    const fc=fmtFechaCorta(fecha);
    let h=hora;
    if(!h&&timestamp){
        /* Old records without explicit hora — derive from ISO timestamp.
           Note: timestamp is UTC, fecha is Uruguay-local. Apply UY offset (-3). */
        try{
            const d=new Date(timestamp);
            if(!isNaN(d.getTime())){
                const uyMs=d.getTime()-3*3600000+d.getTimezoneOffset()*60000;
                const uy=new Date(uyMs);
                h=`${String(uy.getHours()).padStart(2,'0')}:${String(uy.getMinutes()).padStart(2,'0')}`;
            }
        }catch(_){}
    }
    return h?`${fc} · ${h}`:fc;
}
function getBancoInfo(n){return CONFIG.BANCOS.find(b=>b.nombre===n)}
function getBancoColor(n){const b=getBancoInfo(n);return b?.color||'#1e293b'}
function escHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function colorBanco(n){return`<span style="color:${getBancoColor(n)};font-weight:600">${n}</span>`}
function getSym(mon){return mon==='USD'?'US$':'$'}
function sincronizarSaldoUsdt(){AppState.datos.saldoUsdt=roundMoney(AppState.datos.lotes.reduce((s,l)=>roundMoney(s+l.disponible),0))}
