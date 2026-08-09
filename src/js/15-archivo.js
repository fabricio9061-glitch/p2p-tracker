'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   §15 — ARCHIVADO HISTÓRICO (v4.9.0)
   ════════════════════════════════════════════════════════════════════════════
   PROBLEMA QUE RESUELVE (definitivamente): toda la app vive en UN documento de
   Firestore, y Firestore tiene un límite duro de 1 MiB por documento. La
   compresión wire (v4.7.63) ya está aplicada — cuando el doc comprimido llegó
   a 851 KB, el payload guard bloqueó writes y recoveryWrite no puede ayudar
   (recovery = re-comprimir, y ya está comprimido: reescribe ~lo mismo y la
   verificación post-write <800 KB falla → "Recovery falló").

   SOLUCIÓN: mover los meses viejos (operaciones, movimientos, transferencias,
   conversiones) a documentos separados: users/{uid}/archivo/{YYYY-MM}.
   El doc principal queda solo con los meses recientes → chico para siempre.

   POR QUÉ ES SEGURO PARA EL FIFO: recalcularLotesYGanancias() reconstruye
   lotes y ganancias re-reproduciendo TODO el historial. Si sacamos ops viejas,
   el replay quedaría incompleto. Para que siga siendo EXACTO:
     1) LOTES DE ARRASTRE (carryover): se reproduce SOLO el período archivado
        con el motor real (sandbox sobre AppState.datos) y los lotes que quedan
        abiertos al corte se convierten en lotes manuales {carryover:true} con
        su id/fecha/hora/precio originales y cantidad = disponible al corte.
        El replay reciente los siembra como eventos 'lm' (ya existente) → el
        orden FIFO y los consumedLots de las ventas recientes no cambian.
     2) SEEDS DE TASAS: los trackers (ultimaTasaCompra/Venta UYU y USD) al
        corte se guardan en datos._archivoSeeds y recalcular() arranca desde
        ahí (cambio v4.9.0 en 06) — sin esto, la ganancia de una compra USD
        reciente cambiaría al perder la última venta USD archivada.
     3) VERIFICACIÓN DE EQUIVALENCIA: antes de tocar nada, se simula el estado
        post-archivo y se compara contra el actual: saldoUsdt, disponible por
        moneda, ganancia de CADA op reciente y tasas. Si algo difiere en más
        de medio centésimo, se aborta sin efectos.

   Los docs de archivo guardan las ops CON su ganancia congelada (no es
   derivable sin el historial previo). Las estadísticas mensuales agregadas ya
   viven en users/{uid}/monthly_summaries (v4.7.x) — el Resumen no se afecta.
   ════════════════════════════════════════════════════════════════════════════ */

const ICONO_ARCHIVO='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5"/></svg>';
const ARCHIVO_FORMAT=1;
const ARCHIVO_MESES_MANTENER_DEFAULT=2;   /* mes actual + 1 anterior */
/* v4.9.6 — Umbral de RENDIMIENTO (no de límite). Cada operación reescribe el
   documento entero y el listener lo baja de vuelta: a 105 KB son ~210 KB de
   tráfico por operación sobre un mismo doc, y Firestore penaliza con latencia
   las escrituras frecuentes al mismo documento. Por encima de esto conviene
   archivar aunque falte muchísimo para el límite de 1 MB. */
const ARCHIVO_KB_RENDIMIENTO=220;
const ARCHIVO_EPSILON=0.005;              /* misma tolerancia que el split */
/* v5.0.1 — Las sumas sobre lotes (saldo USDT y disponible por moneda) pueden
   diferir en polvo de redondeo cuando el agrupamiento de lotes cambia: el
   historial completo fusiona compras del mismo precio, y post-archivo un lote
   de arrastre ya no puede recibir fusiones (hacerlo corrompía el saldo). Ese
   desvío es de centésimos y es inherente. La ganancia por operación y las
   tasas siguen con tolerancia estricta. */
const ARCHIVO_EPSILON_LOTES=0.02;

let _archivoRunning=false;

/* ─── Helpers de fecha ─────────────────────────────────────────────────────── */
function _archivoMesDeFecha(f){return (typeof f==='string'&&f.length>=7)?f.slice(0,7):''}
function _archivoCutoffMes(mesesAMantener){
    /* Primer mes que SE MANTIENE. Todo lo anterior se archiva. */
    const hoy=getUDateStr();               /* YYYY-MM-DD en hora Uruguay */
    const y=parseInt(hoy.slice(0,4),10),m=parseInt(hoy.slice(5,7),10);
    const idx=y*12+(m-1)-(Math.max(1,mesesAMantener)-1);
    const cy=Math.floor(idx/12),cm=(idx%12)+1;
    return cy+'-'+String(cm).padStart(2,'0');
}

/* ─── Breakdown del payload: qué está ocupando espacio ─────────────────────
   Refleja el payload REAL: stripDerived + compresión wire en operaciones
   (igual que guardarDatos). Devuelve [{seccion,kb,items}] ordenado desc. */
function calcularBreakdownPayload(){
    const d=AppState.datos||{};
    const kb=x=>{try{return Math.round(JSON.stringify(x).length/102.4)/10}catch(_){return 0}};
    const stripDeriv=arr=>(arr||[]).map(x=>{const{_syncState,consumedLots,ganancia,comisionPlataforma,...r}=x;return r});
    let opsWire=stripDeriv(d.operaciones);
    if(!window._wireCompressionBroken&&typeof _compressOpsArrayForWire==='function'){
        try{opsWire=_compressOpsArrayForWire(opsWire)}catch(_){}
    }
    const lotesMan=(d.lotes||[]).filter(l=>l.manual);
    const secciones=[
        {seccion:'operaciones (wire)',kb:kb(opsWire),items:(d.operaciones||[]).length},
        {seccion:'movimientos',kb:kb(d.movimientos||[]),items:(d.movimientos||[]).length},
        {seccion:'transferencias',kb:kb(d.transferencias||[]),items:(d.transferencias||[]).length},
        {seccion:'conversiones',kb:kb(d.conversiones||[]),items:(d.conversiones||[]).length},
        {seccion:'bancos',kb:kb(d.bancos||{}),items:Object.keys(d.bancos||{}).length},
        {seccion:'lotes manuales',kb:kb(lotesMan),items:lotesMan.length},
        {seccion:'tasas recientes + tags + resto',kb:kb({t:d.tasasRecientes,g:d.tags,a:d._archivoIndex,s:d._archivoSeeds}),items:(d.tasasRecientes||[]).length}
    ].sort((a,b)=>b.kb-a.kb);
    const total=Math.round(secciones.reduce((s,x)=>s+x.kb,0));
    return{secciones,totalKB:total};
}

/* ─── Replay con el MOTOR REAL sobre un sandbox ────────────────────────────
   Cero duplicación de lógica FIFO: se intercambia AppState.datos por un clon
   con el subconjunto de eventos deseado, se llama recalcularLotesYGanancias()
   (sync, sin DOM), se capturan lotes+tasas+ops mutadas, y se restaura.
   try/finally garantiza la restauración incluso ante excepción. */
function _replayEnSandbox(sandboxDatos){
    const original=AppState.datos;
    AppState.datos=sandboxDatos;
    try{
        recalcularLotesYGanancias();
        return{
            lotes:sandboxDatos.lotes.map(l=>({...l})),
            operaciones:sandboxDatos.operaciones,      /* con ganancia/usdt/comisión recalculadas */
            movimientos:sandboxDatos.movimientos,      /* con valorUYU/consumedLots recalculados  */
            saldoUsdt:sandboxDatos.saldoUsdt,
            utcL:sandboxDatos.ultimaTasaCompra,
            utcUL:sandboxDatos.ultimaTasaCompraUSD,
            utvL:sandboxDatos.ultimaTasaVenta,
            utvU:sandboxDatos.ultimaTasaVentaUSD
        };
    }finally{
        AppState.datos=original;
    }
}
function _cloneJson(x){return JSON.parse(JSON.stringify(x))}

/* ─── Lotes de arrastre a partir de un replay ──────────────────────────────
   Toma los lotes que quedaron ABIERTOS al corte y los convierte en la
   declaración que se guarda. El punto fino, que ya causó un falso positivo:
   `cantidad` se toma de `disponible`, NO de `cantidad`. En un lote normal,
   `cantidad` es lo que se compró originalmente y `disponible` lo que queda sin
   vender; para el arrastre solo interesa lo que queda, y al re-sembrarlo el
   replay hace disponible=cantidad. Sumar el campo equivocado da un número mucho
   mayor (el tamaño original de las compras) y parece un descuadre enorme.

   Esta función es el ÚNICO lugar donde se construye el arrastre: la usan el
   archivado, la reparación y la verificación de integridad. */
function _archivoCarryDesdeLotes(lotes){
    return (lotes||[]).filter(l=>l&&l.disponible>ARCHIVO_EPSILON).map(l=>({
        id:l.id,fecha:l.fecha,hora:l.hora||'00:00',
        precioCompra:l.precioCompra,
        cantidad:l.disponible,
        disponible:l.disponible,
        moneda:l.moneda||'UYU',
        manual:true,carryover:true
    }));
}
/* Suma de un conjunto de lotes de arrastre, para comparaciones */
function _archivoCarrySuma(arr){return (arr||[]).reduce((s,l)=>roundMoney(s+(l.cantidad||0)),0)}

/* ─── PLAN DE ARCHIVADO (función pura sobre `datos`) ───────────────────────
   No toca AppState ni Firestore. Devuelve todo lo necesario para ejecutar,
   o {ok:false,motivo|diffs} si no hay nada que archivar o la equivalencia
   falla. Testeable en Node con el motor real cargado. */
function _calcularPlanArchivo(datos,mesesAMantener){
    const cutoffMes=_archivoCutoffMes(mesesAMantener||ARCHIVO_MESES_MANTENER_DEFAULT);
    const esViejo=x=>{const mm=_archivoMesDeFecha(x&&x.fecha);return mm&&mm<cutoffMes};
    const partir=arr=>{
        const viejo=[],reciente=[];
        (arr||[]).forEach(x=>{(esViejo(x)?viejo:reciente).push(x)});
        return{viejo,reciente};
    };
    const ops=partir(datos.operaciones),movs=partir(datos.movimientos),
          transfs=partir(datos.transferencias),convs=partir(datos.conversiones||[]);
    const totalViejo=ops.viejo.length+movs.viejo.length+transfs.viejo.length+convs.viejo.length;
    if(totalViejo===0)return{ok:false,motivo:'sin-datos-viejos',cutoffMes};

    /* Lotes manuales existentes: los anteriores al corte entran al replay
       archivado (pueden quedar total/parcialmente consumidos → su remanente
       pasa al carryover). Los del período reciente se mantienen tal cual. */
    /* v5.0.1 — Los de arrastre NO se toman del array: su declaración vive en
       datos._archivoCarryover y el replay del sandbox la lee de ahí. */
    const lotesManTodos=(datos.lotes||[]).filter(l=>l&&l.manual&&!l.carryover);
    const lotesManViejos=lotesManTodos.filter(l=>{const mm=_archivoMesDeFecha(l.fecha);return mm&&mm<cutoffMes});
    const lotesManRecientes=lotesManTodos.filter(l=>!(lotesManViejos.includes(l)));

    /* ── Estado de referencia: replay COMPLETO actual (con seeds actuales) ── */
    const refFull=_replayEnSandbox(_cloneJson({...datos,lotes:lotesManTodos.map(l=>({...l}))}));

    /* ── Replay SOLO del período archivado → lotes al corte + seeds nuevos ── */
    const sandboxViejo=_cloneJson({
        ...datos,
        operaciones:ops.viejo,
        movimientos:movs.viejo,
        transferencias:[],conversiones:[],
        lotes:lotesManViejos.map(l=>({...l}))
        /* _archivoSeeds existentes (de un archivado previo) viajan en ...datos
           → el replay del tramo viejo arranca desde ellos: encadenable. */
    });
    const corte=_replayEnSandbox(sandboxViejo);
    const carryover=_archivoCarryDesdeLotes(corte.lotes);
    const seedsNuevos={
        utcL:corte.utcL||0,utcUL:corte.utcUL||0,
        utvL:corte.utvL||0,utvU:corte.utvU||0,
        corte:cutoffMes+'-01'
    };

    /* ── Docs de archivo por mes (ops con ganancia CONGELADA del replay ref) ──
       Usamos las ops del replay completo de referencia (refFull) para que
       ganancia/usdt/comisionPlataforma/valorUYU queden con los valores exactos
       vigentes hoy. consumedLots se omite (volumen alto, valor histórico bajo). */
    const congelarOp=x=>{const{_syncState,consumedLots,...r}=x;return r};
    const refOpsById=new Map(refFull.operaciones.map(o=>[o.id,o]));
    const refMovsById=new Map(refFull.movimientos.map(m=>[m.id,m]));
    const porMes={};
    const push=(mes,campo,item)=>{
        if(!porMes[mes])porMes[mes]={mes,operaciones:[],movimientos:[],transferencias:[],conversiones:[]};
        porMes[mes][campo].push(item);
    };
    ops.viejo.forEach(o=>push(_archivoMesDeFecha(o.fecha),'operaciones',congelarOp(refOpsById.get(o.id)||o)));
    movs.viejo.forEach(m=>push(_archivoMesDeFecha(m.fecha),'movimientos',congelarOp(refMovsById.get(m.id)||m)));
    transfs.viejo.forEach(t=>push(_archivoMesDeFecha(t.fecha),'transferencias',congelarOp(t)));
    convs.viejo.forEach(c=>push(_archivoMesDeFecha(c.fecha),'conversiones',congelarOp(c)));
    const meses=Object.keys(porMes).sort();
    meses.forEach(mes=>{
        const p=porMes[mes];
        let mc=0,mv=0,g=0;
        p.operaciones.forEach(o=>{if(o.tipo==='compra')mc=roundMoney(mc+(o.monto||0));else mv=roundMoney(mv+(o.monto||0));g=roundMoney(g+(o.ganancia||0))});
        p.stats={ops:p.operaciones.length,movs:p.movimientos.length,
                 transfs:p.transferencias.length,convs:p.conversiones.length,
                 montoCompras:mc,montoVentas:mv,ganancia:g};
    });

    /* ── Datos post-archivo propuestos ── */
    const indexPrev=(datos._archivoIndex&&datos._archivoIndex.meses)||{};
    const indexMeses={...indexPrev};
    meses.forEach(mes=>{indexMeses[mes]={...(indexMeses[mes]||{}),...porMes[mes].stats}});
    const datosNuevo=_cloneJson({
        ...datos,
        operaciones:ops.reciente,
        movimientos:movs.reciente,
        transferencias:transfs.reciente,
        conversiones:convs.reciente,
        lotes:lotesManRecientes.map(l=>({...l})),
        _archivoCarryover:carryover,
        _archivoSeeds:seedsNuevos,
        _archivoIndex:{meses:indexMeses,actualizado:getUDateStr()}
    });

    /* ── VERIFICACIÓN DE EQUIVALENCIA ── */
    const post=_replayEnSandbox(_cloneJson(datosNuevo));
    const diffs=[];
    if(Math.abs(post.saldoUsdt-refFull.saldoUsdt)>ARCHIVO_EPSILON_LOTES)
        diffs.push('saldoUsdt: '+refFull.saldoUsdt+' → '+post.saldoUsdt);
    const dispPorMon=lotes=>{const r={};lotes.forEach(l=>{if(l.disponible>ARCHIVO_EPSILON){const m=l.moneda||'UYU';r[m]=roundMoney((r[m]||0)+l.disponible)}});return r};
    const dA=dispPorMon(refFull.lotes),dB=dispPorMon(post.lotes);
    Object.keys({...dA,...dB}).forEach(m=>{
        if(Math.abs((dA[m]||0)-(dB[m]||0))>ARCHIVO_EPSILON_LOTES)diffs.push('disponible '+m+': '+(dA[m]||0)+' → '+(dB[m]||0));
    });
    ['utcL','utcUL','utvL','utvU'].forEach(k=>{
        if(Math.abs((refFull[k]||0)-(post[k]||0))>0.0005)diffs.push('tasa '+k+': '+refFull[k]+' → '+post[k]);
    });
    const postOpsById=new Map(post.operaciones.map(o=>[o.id,o]));
    for(const o of ops.reciente){
        const a=refOpsById.get(o.id),b=postOpsById.get(o.id);
        if(!b){diffs.push('op reciente perdida: '+o.id);break}
        if(Math.abs((a.ganancia||0)-(b.ganancia||0))>ARCHIVO_EPSILON){
            diffs.push('ganancia op '+o.id+' ('+o.fecha+'): '+a.ganancia+' → '+b.ganancia);
            if(diffs.length>6)break;
        }
    }
    if(diffs.length)return{ok:false,motivo:'equivalencia',diffs,cutoffMes};

    return{ok:true,cutoffMes,meses,porMes,carryover,seedsNuevos,datosNuevo,
           resumen:{ops:ops.viejo.length,movs:movs.viejo.length,
                    transfs:transfs.viejo.length,convs:convs.viejo.length,
                    lotesCarryover:carryover.length},
           refFull};
}

/* ─── Formato del doc de archivo ──────────────────────────────────────────
   Por defecto EXPANDIDO: autocontenido, legible, y la ganancia (congelada,
   no derivable acá) viaja dentro de cada op. Si un mes fuera tan grande que
   el doc expandido se acercara al límite de 1 MiB (>maxKB, def. 900), se
   comprime con el wire existente y la ganancia va en un sidecar
   gananciasPorId [[id,gan],...] que el visor y la verificación reaplican.
   Round-trip verificado antes de elegir la rama comprimida. */
function _archivoAplicarGanancias(ops,ganMap){
    const m=new Map((ganMap||[]).map(p=>[String(p[0]),p[1]]));
    return ops.map(o=>m.has(String(o.id))?{...o,ganancia:m.get(String(o.id))}:o);
}
function _archivoComprimirOps(opsArr,maxKB){
    maxKB=maxKB||900;
    let kb=0;try{kb=JSON.stringify(opsArr).length/1024}catch(_){return{ops:opsArr,wire:false}}
    if(kb<=maxKB)return{ops:opsArr,wire:false};
    if(window._wireCompressionBroken||typeof _compressOpsArrayForWire!=='function')return{ops:opsArr,wire:false};
    try{
        const ganMap=opsArr.map(o=>[o.id,roundMoney(o.ganancia||0)]);
        const compr=_compressOpsArrayForWire(opsArr);
        const rt=_archivoAplicarGanancias(_decompressOpsArrayFromWire(compr),ganMap);
        if(rt.length!==opsArr.length)return{ops:opsArr,wire:false};
        let sA=0,sB=0,gA=0,gB=0;
        opsArr.forEach(o=>{sA=roundMoney(sA+(o.monto||0));gA=roundMoney(gA+(o.ganancia||0))});
        rt.forEach(o=>{sB=roundMoney(sB+(o.monto||0));gB=roundMoney(gB+(o.ganancia||0))});
        if(Math.abs(sA-sB)>ARCHIVO_EPSILON||Math.abs(gA-gB)>ARCHIVO_EPSILON)return{ops:opsArr,wire:false};
        return{ops:compr,wire:true,ganMap};
    }catch(_){return{ops:opsArr,wire:false}}
}

/* ─── ORQUESTACIÓN: archivarHistorial ──────────────────────────────────────
   1. Backup JSON automático (exportarDatos)
   2. Plan + verificación de equivalencia (aborta si difiere)
   3. Escritura de cada doc mensual con verificación read-back
   4. Aplicar estado nuevo en memoria + recalcular + re-verificar en vivo
   5. Limpiar flags del guard y persistir el doc principal chico vía
      recoveryWrite (write verificado + resync del listener)
   Cualquier fallo antes del paso 4 → cero efectos locales. */
async function archivarHistorial(opts){
    opts=opts||{};
    const ui=window._recoveryUI||{};
    const setPhase=ui.setPhase||function(){};
    if(_archivoRunning)return{ok:false,motivo:'ya-corriendo'};
    if(!AppState.currentUser||!AppState.db){alert('Sin sesión activa.');return{ok:false,motivo:'sin-sesion'}}
    if(!navigator.onLine){alert('Necesitás conexión para archivar (se escriben documentos nuevos en Firestore).');return{ok:false,motivo:'offline'}}
    _archivoRunning=true;
    const mesesAMantener=opts.mesesAMantener||ARCHIVO_MESES_MANTENER_DEFAULT;
    try{
        if(ui.ensure)ui.ensure();
        AppState._recoveryActive=true;   /* freeze de listener + saves durante el proceso */

        /* 1 ── backup automático */
        setPhase('Exportando backup de seguridad…');
        try{if(typeof exportarDatos==='function')exportarDatos()}catch(_){}

        /* 2 ── plan */
        setPhase('Calculando plan de archivado…');
        await new Promise(r=>setTimeout(r,50));
        const plan=_calcularPlanArchivo(AppState.datos,mesesAMantener);
        if(!plan.ok){
            AppState._recoveryActive=false;
            if(plan.motivo==='sin-datos-viejos'){
                if(ui.hide)ui.hide();
                alert('No hay meses anteriores a '+plan.cutoffMes+' para archivar.\n\nSi el documento sigue grande, revisá el desglose en consola (calcularBreakdownPayload()).');
            }else{
                if(ui.error)ui.error('Archivado abortado','La verificación de equivalencia detectó diferencias — no se modificó nada:\n• '+plan.diffs.join('\n• '),[{label:'Cerrar',color:'#64748b',onClick:()=>{if(ui.hide)ui.hide()}}]);
                else alert('Archivado abortado (equivalencia):\n'+plan.diffs.join('\n'));
            }
            _archivoRunning=false;
            return{ok:false,...plan};
        }

        /* 3 ── escribir docs mensuales con verificación ─────────────────────
           v4.9.2 — Con timeout + reintentos. El SDK de Firestore no tiene
           timeout propio: en conexión inestable, ref.set() puede quedar
           esperando el ACK PARA SIEMPRE (cuelgue real reportado: 7+ min en
           "Intento 1"). Mismo patrón que guardarDatos (30s) y recovery (90s). */
        const _conTimeout=(promesa,ms,tag)=>new Promise((res,rej)=>{
            let fin=false;
            const h=setTimeout(()=>{if(!fin){fin=true;rej(new Error(tag+' superó '+Math.round(ms/1000)+'s (timeout)'))}},ms);
            promesa.then(v=>{if(!fin){fin=true;clearTimeout(h);res(v)}},e=>{if(!fin){fin=true;clearTimeout(h);rej(e)}});
        });
        const setMeta=(window._recoveryUI&&window._recoveryUI.setMeta)||function(){};
        const userRef=AppState.db.collection('users').doc(AppState.currentUser.uid);
        /* Ping pre-vuelo: verifica en 1 write chico que (a) hay conexión real y
           (b) las Security Rules PERMITEN escribir en la subcolección 'archivo'.
           Si las reglas la bloquean, acá falla en segundos con mensaje claro,
           en vez de un cuelgue ambiguo con el doc grande. */
        setPhase('Verificando permisos y conexión…');
        const _pingRef=userRef.collection('archivo').doc('_ping');
        const _hacerPing=ms=>_conTimeout(_pingRef.set({t:Date.now()}),ms,'ping de conexión');
        let _pingOk=false,_pingErr=null;
        try{await _hacerPing(15000);_pingOk=true}catch(e){_pingErr=e}
        if(!_pingOk&&!/permission|insufficient/i.test(String(_pingErr&&_pingErr.message||''))){
            /* v4.9.3 — Doctor de conexión. Con enablePersistence, la cola de
               escrituras del SDK vive en IndexedDB y SOBREVIVE al cierre de la
               app: un write grande colgado de un intento anterior bloquea todo
               lo que venga detrás (Firestore despacha EN ORDEN). Paso 1: kick
               suave del canal (disable/enable network) y reintento. */
            setPhase('Conexión trabada — reiniciando canal…');
            try{await _conTimeout(AppState.db.disableNetwork(),8000,'disableNetwork')}catch(_){}
            try{await _conTimeout(AppState.db.enableNetwork(),8000,'enableNetwork')}catch(_){}
            try{await _hacerPing(12000);_pingOk=true}catch(e){_pingErr=e}
        }
        if(!_pingOk){
            const perm=/permission|insufficient/i.test(String(_pingErr&&_pingErr.message||''));
            if(perm)throw new Error('Las reglas de seguridad de Firestore no permiten escribir en la subcolección "archivo". En Firebase Console → Firestore → Reglas, agregá para users/{uid}/archivo la misma regla que ya tenés para monthly_summaries.');
            /* Diagnóstico: ¿hay escrituras del SDK atascadas de una sesión previa? */
            let colaAtascada=false;
            try{await _conTimeout(AppState.db.waitForPendingWrites(),5000,'pendientes')}catch(_){colaAtascada=true}
            AppState._recoveryActive=false;
            _archivoRunning=false;
            const uiE=window._recoveryUI;
            const msg=colaAtascada
                ?'La cola interna de Firestore tiene escrituras atascadas de un intento anterior (probablemente el write grande que quedó colgado). Como la app usa persistencia, esa cola sobrevive al cerrar la app y bloquea todo lo nuevo.\n\n"Reiniciar conexión" limpia SOLO esa cola interna y recarga. Tus operaciones NO se tocan: viven en el respaldo local y se restauran al volver.'
                :'No hay canal estable con Firestore ('+(_pingErr&&_pingErr.message||_pingErr)+'). Probá con WiFi estable o reiniciá la conexión.';
            if(uiE&&uiE.error){
                uiE.error('Sin conexión con Firestore',msg,[
                    {label:'🔁 Reintentar archivado',color:'#3b82f6',onClick:()=>{uiE.hide&&uiE.hide();setTimeout(()=>archivarHistorial(opts),300)}},
                    {label:'🧹 Reiniciar conexión y recargar',color:'#d97706',onClick:()=>{_archivoResetConexion()}},
                    {label:'Cerrar',color:'#64748b',onClick:()=>{uiE.hide&&uiE.hide()}}
                ]);
            }else alert(msg);
            return{ok:false,motivo:'sin-conexion',colaAtascada};
        }
        const total=plan.meses.length;
        const ARCHIVO_WRITE_TIMEOUT=45000,ARCHIVO_GET_TIMEOUT=15000,ARCHIVO_BACKOFF=[3000,8000];
        for(let i=0;i<total;i++){
            const mes=plan.meses[i],p=plan.porMes[mes];
            const compr=_archivoComprimirOps(p.operaciones);
            const docPayload={
                mes,_archivoFormat:ARCHIVO_FORMAT,
                _wireFormat:compr.wire?WIRE_FORMAT_VERSION:null,
                operaciones:compr.ops,
                movimientos:p.movimientos,
                transferencias:p.transferencias,
                conversiones:p.conversiones,
                stats:p.stats,
                appVersion:CONFIG.APP_VERSION,
                creadoEn:firebase.firestore.FieldValue.serverTimestamp()
            };
            if(compr.ganMap)docPayload.gananciasPorId=compr.ganMap;
            const ref=userRef.collection('archivo').doc(mes);
            let escrito=false,ultimoErr=null;
            for(let intento=1;intento<=3&&!escrito;intento++){
                setPhase('Archivando '+mes+' ('+(i+1)+'/'+total+') — '+p.stats.ops+' ops…');
                setMeta('Intento '+intento+'/3 · enviando');
                try{
                    await _conTimeout(ref.set(docPayload),ARCHIVO_WRITE_TIMEOUT,'escritura de '+mes);
                    setMeta('Intento '+intento+'/3 · confirmando');
                    /* read-back: counts + suma de montos deben coincidir */
                    const back=await _conTimeout(ref.get({source:'server'}),ARCHIVO_GET_TIMEOUT,'lectura de verificación de '+mes);
                    if(!back.exists)throw new Error('doc '+mes+' no existe post-write');
                    const bd=back.data();
                    let bops=bd._wireFormat?_decompressOpsArrayFromWire(bd.operaciones):(bd.operaciones||[]);
                    if(bd.gananciasPorId)bops=_archivoAplicarGanancias(bops,bd.gananciasPorId);
                    let sumBack=0,ganBack=0;bops.forEach(o=>{sumBack=roundMoney(sumBack+(o.monto||0));ganBack=roundMoney(ganBack+(o.ganancia||0))});
                    let sumLocal=0,ganLocal=0;p.operaciones.forEach(o=>{sumLocal=roundMoney(sumLocal+(o.monto||0));ganLocal=roundMoney(ganLocal+(o.ganancia||0))});
                    if(bops.length!==p.stats.ops||(bd.movimientos||[]).length!==p.stats.movs||
                       (bd.transferencias||[]).length!==p.stats.transfs||
                       Math.abs(sumBack-sumLocal)>ARCHIVO_EPSILON||Math.abs(ganBack-ganLocal)>ARCHIVO_EPSILON){
                        throw new Error('verificación de '+mes+': counts/sumas no coinciden');
                    }
                    escrito=true;
                }catch(e){
                    ultimoErr=e;
                    if(intento<3){
                        const espera=ARCHIVO_BACKOFF[intento-1];
                        setPhase('⚠ '+(e&&e.message||e));
                        setMeta('Reintentando en '+(espera/1000)+'s…');
                        await new Promise(r=>setTimeout(r,espera));
                    }
                }
            }
            if(!escrito)throw new Error('No se pudo escribir '+mes+' tras 3 intentos. Último error: '+(ultimoErr&&ultimoErr.message||ultimoErr));
        }

        try{await userRef.collection('archivo').doc('_ping').delete()}catch(_){}
        /* 4 ── aplicar en memoria + re-verificar EN VIVO */
        setPhase('Aplicando estado nuevo…');
        const saldoAntes=AppState.datos.saldoUsdt;
        const respaldo=AppState.datos;              /* rollback en memoria si algo sale mal */
        AppState.datos=plan.datosNuevo;
        recalcularLotesYGanancias();
        if(Math.abs(AppState.datos.saldoUsdt-saldoAntes)>ARCHIVO_EPSILON){
            AppState.datos=respaldo;recalcularLotesYGanancias();
            throw new Error('re-verificación en vivo falló (saldoUsdt '+saldoAntes+' → distinto). Rollback aplicado.');
        }
        try{if(typeof backupToLocal==='function'){backupToLocal._lastSig=null;backupToLocal()}}catch(_){}

        /* 5 ── limpiar guard + persistir doc principal chico (write verificado) */
        AppState._recoveryActive=false;
        setPhase('Guardando documento principal…');
        let res={ok:true};
        if(AppState._schema===2&&window._v2sync){
            /* v5.0 — En el modelo v2 los eventos son documentos: archivar implica
               BORRAR los de los meses archivados. Sin esto, la escucha de la
               subcolección los volvería a agregar y el archivado se desharía. */
            setPhase('Retirando eventos archivados…');
            const n=await window._v2sync.borrarEventosArchivados(plan.cutoffMes);
            console.log('[P2P][v2] eventos archivados retirados:',n);
            await window._v2sync.guardar(true);
        }else{
            /* v5.2.5 — El modelo v1 y recoveryWrite se retiraron; este camino solo
               se alcanzaría si el módulo de almacenamiento no cargó. */
            await guardarDatos(true);
        }
        _archivoRunning=false;
        if(res&&res.ok!==false){
            const bd=calcularBreakdownPayload();
            console.log('[P2P][ARCHIVO] OK —',plan.resumen,'· payload ahora ~'+bd.totalKB+' KB');
            setTimeout(()=>{
                alert('✅ Archivado completado.\n\n'+
                      'Meses archivados: '+plan.meses.join(', ')+'\n'+
                      'Operaciones: '+plan.resumen.ops+' · Ajustes: '+plan.resumen.movs+' · Transf.: '+plan.resumen.transfs+'\n'+
                      'Lotes de arrastre creados: '+plan.resumen.lotesCarryover+'\n\n'+
                      'Documento principal ahora ~'+bd.totalKB+' KB. Todo verificado (saldos, lotes y ganancias idénticos).\n'+
                      'El detalle viejo quedó en el botón 📦 Archivo.');
                if(typeof actualizarVista==='function')actualizarVista();
                mostrarBotonArchivo();
            },400);
        }
        return{ok:true,plan};
    }catch(e){
        console.error('[P2P][ARCHIVO] Error:',e);
        AppState._recoveryActive=false;
        _archivoRunning=false;
        const msg='Archivado interrumpido: '+(e&&e.message||e)+
            '\n\nNo se perdió nada: el doc principal NO se modificó y los docs de archivo ya escritos son inofensivos (se reutilizan al reintentar).';
        if(window._recoveryUI&&window._recoveryUI.error){
            window._recoveryUI.error('Archivado interrumpido',msg,[
                {label:'🔄 Reintentar archivado',color:'#3b82f6',onClick:()=>{if(window._recoveryUI.hide)window._recoveryUI.hide();setTimeout(()=>archivarHistorial(opts),300)}},
                {label:'🧹 Reiniciar conexión y recargar',color:'#d97706',onClick:()=>{_archivoResetConexion()}},
                {label:'Cerrar',color:'#64748b',onClick:()=>{if(window._recoveryUI.hide)window._recoveryUI.hide()}}
            ]);
        }else alert(msg);
        return{ok:false,error:e};
    }
}

/* ─── REPARACIÓN DE LOTES DE ARRASTRE (v5.0.1) ─────────────────────────────
   Entre 4.9.0 y 5.0.0, agregarLote permitía fusionar una compra nueva dentro de
   un lote de arrastre. Como los lotes de arrastre llevan manual:true, se
   PERSISTEN y se vuelven a sembrar en cada recálculo con disponible=cantidad:
   la compra quedaba sumada dentro de `cantidad` y además se replayaba como
   operación, así que el saldo USDT crecía en cada ciclo, de forma acumulativa.

   Esta función recalcula los lotes de arrastre correctos releyendo los
   documentos de archivo (que NO fueron afectados) y reproduciéndolos con el
   motor real. No aplica nada sin mostrarte antes el saldo actual, el corregido
   y la diferencia. */
async function repararCarryover(){
    if(!AppState.currentUser||!AppState.db){alert('Sin sesión activa.');return{ok:false}}
    if(!navigator.onLine){alert('Necesitás conexión para leer el archivo histórico.');return{ok:false}}
    const ui=window._recoveryUI||{};
    const setPhase=ui.setPhase||function(){};
    try{
        if(ui.ensure)ui.ensure();
        setPhase('Leyendo historial archivado…');
        const idx=(AppState.datos._archivoIndex&&AppState.datos._archivoIndex.meses)||{};
        const meses=Object.keys(idx).sort();
        const carryActuales=(AppState.datos.lotes||[]).filter(l=>l&&l.manual&&l.carryover);
        if(!meses.length){
            if(ui.hide)ui.hide();
            alert(carryActuales.length
                ? 'Hay lotes de arrastre pero no se encontró historial archivado, así que no se pueden recalcular automáticamente. Escribime antes de tocar nada.'
                : 'No hay historial archivado ni lotes de arrastre: no hay nada que reparar.');
            return{ok:false,motivo:'sin-archivo'};
        }
        /* 1 ── Juntar todo lo archivado */
        const userRef=AppState.db.collection('users').doc(AppState.currentUser.uid);
        const ops=[],movs=[];
        for(let i=0;i<meses.length;i++){
            setPhase('Leyendo '+meses[i]+' ('+(i+1)+'/'+meses.length+')…');
            const snap=await userRef.collection('archivo').doc(meses[i]).get();
            if(!snap.exists)throw new Error('Falta el documento de archivo '+meses[i]+'.');
            const d=snap.data();
            let o=d._wireFormat?_decompressOpsArrayFromWire(d.operaciones):(d.operaciones||[]);
            if(d.gananciasPorId&&typeof _archivoAplicarGanancias==='function')o=_archivoAplicarGanancias(o,d.gananciasPorId);
            o.forEach(x=>ops.push(x));
            (d.movimientos||[]).forEach(m=>movs.push(m));
        }
        /* 2 ── Reproducir TODO lo archivado desde cero: el resultado son los
               lotes abiertos al corte, es decir el arrastre correcto. */
        setPhase('Recalculando lotes de arrastre…');
        await new Promise(r=>setTimeout(r,50));
        const manualesGenuinos=(AppState.datos.lotes||[]).filter(l=>l&&l.manual&&!l.carryover);
        const corte=(AppState.datos._archivoSeeds&&AppState.datos._archivoSeeds.corte)||'';
        const manualesViejos=manualesGenuinos.filter(l=>corte&&String(l.fecha||'')<corte);
        const sandbox=_cloneJson({...AppState.datos,operaciones:ops,movimientos:movs,
            transferencias:[],conversiones:[],lotes:manualesViejos.map(l=>({...l})),
            _archivoSeeds:null,_archivoCarryover:null});
        const corteCalc=_replayEnSandbox(sandbox);
        const carryCorrecto=_archivoCarryDesdeLotes(corteCalc.lotes);
        /* 3 ── Estado corregido, sin aplicar todavía */
        const saldoAntes=AppState.datos.saldoUsdt;
        const propuesta=_cloneJson({...AppState.datos,
            _archivoCarryover:carryCorrecto,
            lotes:manualesGenuinos.filter(l=>!manualesViejos.includes(l)).map(l=>({...l}))});
        const post=_replayEnSandbox(propuesta);
        const saldoDespues=post.saldoUsdt;
        const sumar=_archivoCarrySuma;
        if(ui.hide)ui.hide();
        const detalle=
            'Saldo USDT actual (inflado): '+fmtNum(saldoAntes,2)+'\n'+
            'Saldo USDT corregido:        '+fmtNum(saldoDespues,2)+'\n'+
            'Diferencia a descontar:      '+fmtNum(roundMoney(saldoAntes-saldoDespues),2)+'\n\n'+
            'Lotes de arrastre: '+carryActuales.length+' (suma '+fmtNum(sumar(carryActuales),2)+')'+
            '  →  '+carryCorrecto.length+' (suma '+fmtNum(sumar(carryCorrecto),2)+')\n'+
            'Recalculados reproduciendo '+ops.length+' operaciones archivadas de '+meses.length+' meses.\n\n'+
            '¿Aplicar la corrección?';
        if(!confirm('Reparar lotes de arrastre\n\n'+detalle))return{ok:false,motivo:'cancelado'};
        /* 4 ── Aplicar y persistir */
        AppState.datos._archivoCarryover=carryCorrecto;
        AppState.datos.lotes=manualesGenuinos.filter(l=>!manualesViejos.includes(l)).map(l=>({...l}));
        recalcularLotesYGanancias();
        try{if(typeof backupToLocal==='function'){backupToLocal._lastSig=null;backupToLocal()}}catch(_){}
        if(typeof guardaOptimista==='function')guardaOptimista('update','lotes','carryover-fix');
        else if(typeof guardarDatos==='function')await guardarDatos(true);
        if(typeof actualizarVista==='function')actualizarVista();
        console.log('[P2P][reparación] saldoUsdt',saldoAntes,'→',AppState.datos.saldoUsdt);
        alert('✅ Lotes de arrastre corregidos.\n\nSaldo USDT: '+fmtNum(AppState.datos.saldoUsdt,2)+
              '\n\nVerificá que coincida con tu saldo real en Binance. Si no coincide, avisame antes de seguir operando.');
        return{ok:true,saldoAntes,saldoDespues:AppState.datos.saldoUsdt};
    }catch(e){
        console.error('[P2P][reparación]',e);
        if(ui.hide)ui.hide();
        alert('No se pudo reparar: '+(e&&e.message||e)+'\n\nNo se modificó nada.');
        return{ok:false,error:e};
    }
}
window.repararCarryover=repararCarryover;
window._archivoCarryDesdeLotes=_archivoCarryDesdeLotes;
window._archivoCarrySuma=_archivoCarrySuma;

/* ─── Reset de conexión: limpia la cola interna persistida del SDK ─────────
   Seguro para los datos del usuario: las operaciones pendientes de la app NO
   están en esta cola (el modo seguro las frena ANTES de llegar al SDK); viven
   en memoria + respaldo localStorage y se restauran al recargar por puntaje.
   Lo único que se descarta son writes internos colgados (archivo/_ping/recovery),
   todos idempotentes y regenerables. */
async function _archivoResetConexion(){
    if(!confirm('Reiniciar la conexión con Firestore:\n\n• Limpia la cola interna atascada del SDK\n• Recarga la app\n• Tus operaciones quedan intactas (respaldo local)\n\n¿Continuar?'))return;
    try{if(AppState.unsubscribe){AppState.unsubscribe();AppState.unsubscribe=null}}catch(_){}
    try{await AppState.db.terminate()}catch(e){console.warn('[P2P] terminate:',e&&e.message||e)}
    let limpio=false;
    try{await AppState.db.clearPersistence();limpio=true}
    catch(e){
        console.warn('[P2P] clearPersistence:',e&&e.code||'',e&&e.message||e);
        /* v4.9.4 — failed-precondition = otra pestaña tiene la base abierta.
           Recargar sin limpiar dejaría la cola envenenada igual: avisar primero. */
        if(e&&e.code==='failed-precondition'){
            alert('No se pudo limpiar la cola: hay OTRA pestaña de la app abierta (Safari u otra ventana).\n\n1. Cerrá todas las pestañas del sitio en Safari\n2. Volvé a tocar "Reiniciar conexión"\n\nSi aun así no se puede: exportá backup primero y luego borrá los datos del sitio en Ajustes → Safari → Avanzado → Datos de sitios web.');
            location.reload();return;
        }
    }
    if(limpio){try{sessionStorage.setItem('p2p_conn_reset','1')}catch(_){}}
    location.reload();
}
window._archivoResetConexion=_archivoResetConexion;

/* ─── VISOR read-only del archivo ──────────────────────────────────────────── */
function mostrarBotonArchivo(){
    const btn=$('btnVerArchivo');if(!btn)return;
    const idx=AppState.datos&&AppState.datos._archivoIndex;
    const hay=idx&&idx.meses&&Object.keys(idx.meses).length>0;
    btn.classList.toggle('hidden',!hay);
}
function _archivoEnsureModal(){
    let m=$('archivoModal');
    if(m)return m;
    /* v5.3.0 — Usa el sistema de modales de la app (.modal/.modal-content/
       .modal-header) en vez de estilos propios. Con eso hereda el respeto por el
       área segura del teléfono (antes el título quedaba tapado por la barra de
       estado en iPhone), el comportamiento a pantalla completa en móvil, la
       flecha de volver y el mismo aspecto que el resto de las ventanas. */
    m=document.createElement('div');
    m.id='archivoModal';
    m.className='modal';
    m.innerHTML='<div class="modal-content" style="max-width:620px">'+
        '<div class="modal-header" data-action="archivo-cerrar">'+ICONO_ARCHIVO+' Historial archivado</div>'+
        '<div id="archivoBody"></div></div>';
    document.body.appendChild(m);
    return m;
}

/* v5.3.1 — Usa las funciones centrales de formato (§04), las mismas que la
   lista principal: así el archivo no puede volver a mostrar cifras distintas. */
function _archMonto(o){return fmtMonto(o.monto||0,o&&o.moneda)}
function _archTasa(o){return fmtTasaMon(o.tasa||0,o&&o.moneda)}

function verArchivo(){
    const m=_archivoEnsureModal();
    const idx=(AppState.datos&&AppState.datos._archivoIndex&&AppState.datos._archivoIndex.meses)||{};
    const meses=Object.keys(idx).sort().reverse();
    const body=$('archivoBody');
    if(!meses.length){
        body.innerHTML='<div class="empty-state">'+
            '<div class="empty-state-icon">'+ICONO_ARCHIVO+'</div>'+
            '<div class="empty-state-title">Todavía no archivaste nada</div>'+
            '<div class="empty-state-sub">Cuando muevas meses viejos al archivo, vas a poder consultarlos y descargarlos desde acá.</div></div>';
    }else{
        /* Totales de todo lo archivado: permiten cruzar de un vistazo que la suma
           de los meses coincide con lo que muestra cada uno al abrirlo. */
        let tOps=0,tMovs=0,tGan=0,tC=0,tV=0;
        meses.forEach(k=>{const s=idx[k]||{};tOps+=s.ops||0;tMovs+=s.movs||0;
            tGan=roundMoney(tGan+(s.ganancia||0));tC=roundMoney(tC+(s.montoCompras||0));tV=roundMoney(tV+(s.montoVentas||0))});
        const filaMes=k=>{
            const s=idx[k]||{};
            const [a,mm]=k.split('-');
            const nombre=['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][parseInt(mm,10)]||k;
            return '<button data-action="archivo-mes" data-mes="'+escHtml(k)+'" class="archivo-mes-row">'+
                '<div class="archivo-mes-top">'+
                    '<span class="archivo-mes-nombre">'+escHtml(nombre)+' '+escHtml(a)+'</span>'+
                    '<span class="archivo-mes-gan" style="color:'+colorGan(s.ganancia)+'">'+fmtGan(s.ganancia)+'</span>'+
                '</div>'+
                '<div class="archivo-mes-bot">'+
                    '<span>'+(s.ops||0)+' ops · '+(s.movs||0)+' aj.'+((s.transfs||0)?' · '+s.transfs+' transf.':'')+'</span>'+
                    '<span>compras $'+fmtNum(s.montoCompras||0,0)+' · ventas $'+fmtNum(s.montoVentas||0,0)+'</span>'+
                '</div></button>';
        };
        body.innerHTML=
            '<div class="archivo-total">'+
                '<div class="archivo-total-row"><span>'+meses.length+' meses archivados</span>'+
                '<b style="color:'+colorGan(tGan)+'">'+fmtGan(tGan)+'</b></div>'+
                '<div class="archivo-total-sub">'+tOps+' operaciones · '+tMovs+' ajustes · compras $'+fmtNum(tC,0)+' · ventas $'+fmtNum(tV,0)+'</div>'+
            '</div>'+
            '<div class="archivo-lista">'+meses.map(filaMes).join('')+'</div>'+
            '<div class="archivo-nota">Solo lectura. Tocá un mes para ver el detalle o descargarlo en JSON.</div>';
    }
    abrirModal('archivoModal');
}

async function _archivoVerMes(mes){
    const body=$('archivoBody');
    body.innerHTML='<div class="archivo-nota" style="padding:18px 4px">Cargando '+escHtml(mes)+'…</div>';
    try{
        const snap=await AppState.db.collection('users').doc(AppState.currentUser.uid)
            .collection('archivo').doc(mes).get();
        if(!snap.exists){body.innerHTML='<div class="archivo-error">No se encontró el documento de '+escHtml(mes)+'.</div>';return}
        const d=snap.data();
        let ops=d._wireFormat?_decompressOpsArrayFromWire(d.operaciones):(d.operaciones||[]);
        if(d.gananciasPorId)ops=_archivoAplicarGanancias(ops,d.gananciasPorId);
        window._archivoMesCache={mes,data:{...d,operaciones:ops}};
        const s=d.stats||{};

        /* ═══ Los montos tienen que cuadrar ═══
           Se recalculan los totales sumando el detalle que se está mostrando y se
           comparan contra las cifras guardadas al archivar. Si no coinciden, se
           avisa en pantalla en vez de mostrar dos números distintos sin explicar. */
        let rC=0,rV=0,rG=0,nC=0,nV=0;
        ops.forEach(o=>{
            if(o.tipo==='compra'){nC++;rC=roundMoney(rC+(o.monto||0))}
            else{nV++;rV=roundMoney(rV+(o.monto||0))}
            rG=roundMoney(rG+(o.ganancia||0));
        });
        const difG=Math.abs(rG-(s.ganancia||0)),difC=Math.abs(rC-(s.montoCompras||0)),difV=Math.abs(rV-(s.montoVentas||0));
        const cuadra=difG<=0.02&&difC<=0.02&&difV<=0.02&&(!s.ops||s.ops===ops.length);

        /* Orden: más reciente primero, igual que la lista principal */
        const clave=x=>String(x.fecha||'')+String(x.hora||'00:00')+String(x.id||'');
        const vista=ops.slice().sort((a,b)=>{const ka=clave(a),kb=clave(b);return ka>kb?-1:ka<kb?1:0});
        const TOPE=300;
        const filas=vista.slice(0,TOPE).map(o=>{
            const isC=o.tipo==='compra';
            const un=(typeof usdtNeto==='function'&&o.usdt!==undefined)
                ? usdtNeto(o.usdt,o.comisionPlataforma,o.tipo) : (o.usdt||0);
            const cPct=o.comisionPct!==undefined?o.comisionPct:0.14;
            return '<div class="archivo-op '+(isC?'compra':'venta')+'">'+
                '<div class="archivo-op-l">'+
                    '<div class="archivo-op-monto">'+_archMonto(o)+'</div>'+
                    '<div class="archivo-op-meta">'+_archTasa(o)+' · '+fmtTrunc(un,2)+' USDT · '+fmtNum(cPct,2)+'%'+
                        (o.banco?' · <span class="archivo-op-banco">'+escHtml(o.banco)+'</span>':'')+'</div>'+
                '</div>'+
                '<div class="archivo-op-r">'+
                    '<div class="archivo-op-gan" style="color:'+colorGan(o.ganancia)+'">'+fmtGan(o.ganancia)+'</div>'+
                    '<div class="archivo-op-fecha">'+escHtml(String(o.fecha||'').slice(8)+'/'+String(o.fecha||'').slice(5,7))+(o.hora?' · '+escHtml(o.hora):'')+'</div>'+
                '</div></div>';
        }).join('');

        body.innerHTML=
            '<div class="archivo-detalle-top">'+
                '<button data-action="archivo-volver" class="archivo-btn">← Meses</button>'+
                '<b>'+escHtml(mes)+'</b>'+
                '<button data-action="archivo-descargar" class="archivo-btn verde">⬇ JSON</button>'+
            '</div>'+
            '<div class="archivo-stats">'+
                '<div><span>Compras</span><b>'+nC+'</b><i>$'+fmtNum(rC,0)+'</i></div>'+
                '<div><span>Ventas</span><b>'+nV+'</b><i>$'+fmtNum(rV,0)+'</i></div>'+
                '<div><span>Ganancia</span><b style="color:'+colorGan(rG)+'">'+fmtGan(rG)+'</b><i>'+ops.length+' ops</i></div>'+
            '</div>'+
            (cuadra?'':'<div class="archivo-error"><svg class="ico ico-alerta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z"/></svg> Los totales guardados al archivar no coinciden con el detalle '+
                '(guardado: ganancia $'+fmtNum(s.ganancia||0,2)+' · '+(s.ops||0)+' ops). '+
                'Se muestran los recalculados. Revisalo con verificarIntegridad().</div>')+
            '<div class="archivo-ops">'+filas+'</div>'+
            (vista.length>TOPE?'<div class="archivo-nota">Mostrando '+TOPE+' de '+vista.length+' — descargá el JSON para el detalle completo.</div>':'')+
            ((d.movimientos||[]).length||(d.transferencias||[]).length
                ? '<div class="archivo-nota">También archivados: '+(d.movimientos||[]).length+' ajustes y '+(d.transferencias||[]).length+' transferencias (incluidos en el JSON).</div>'
                : '');
    }catch(e){
        body.innerHTML='<div class="archivo-error">Error cargando: '+escHtml(e&&e.message||String(e))+'</div>';
    }
}
function _archivoDescargarMes(){
    const c=window._archivoMesCache;if(!c)return;
    try{
        const blob=new Blob([JSON.stringify(c.data,null,1)],{type:'application/json'});
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download='p2p-archivo-'+c.mes+'.json';
        document.body.appendChild(a);a.click();
        setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},800);
    }catch(e){alert('Error descargando: '+(e&&e.message||e))}
}
/* Delegación de eventos propia del módulo (no toca el dispatcher de 14) */
document.addEventListener('click',e=>{
    const t=e.target.closest('[data-action="ver-archivo"],[data-action="archivo-cerrar"],[data-action="archivo-mes"],[data-action="archivo-volver"],[data-action="archivo-descargar"]');
    if(!t)return;
    const a=t.dataset.action;
    if(a==='ver-archivo')verArchivo();
    else if(a==='archivo-cerrar')cerrarModal('archivoModal');
    else if(a==='archivo-mes')_archivoVerMes(t.dataset.mes);
    else if(a==='archivo-volver')verArchivo();
    else if(a==='archivo-descargar')_archivoDescargarMes();
});
/* ─── Auto-sugerencia: si el doc supera 800 KB al cargar, ofrecer archivar ──
   El payload guard solo salta al intentar GUARDAR; tras recargar la app no hay
   forma obvia de relanzar el archivado. Esto la da: chequeo único post-boot. */
let _archivoSugerido=false;
function _archivoAutoSugerir(){
    if(_archivoSugerido)return;
    try{
        if(!AppState.currentUser||!AppState.datos)return;
        if(AppState._recoveryActive||_archivoRunning)return;
        /* Sin al menos un snapshot de servidor en la sesión no sabemos el tamaño real
           (la memoria puede ser de un dispositivo desactualizado). */
        if(!AppState._snapshotServidorOk)return;
        /* v5.0.1 — "Más tarde" ahora se respeta por 24 h. Antes reaparecía en cada
           apertura de la app, que con una PWA es a cada rato. */
        try{
            const sn=parseInt(localStorage.getItem('p2p_archivo_snooze_'+AppState.currentUser.uid)||'0',10);
            if(sn&&Date.now()-sn<86400000)return;
        }catch(_){}
        /* v5.0 — En el modelo v2 el costo de guardar ya no depende de la historia:
           archivar deja de ser necesario para la velocidad (solo acota la carga
           inicial). No molestamos con la sugerencia. */
        if(AppState._schema===2)return;
        /* v4.9.6 FIX — Antes se descartaba la sugerencia si el uid YA había archivado
           alguna vez (marker o _archivoIndex presente). Eso la desactivaba PARA SIEMPRE
           tras el primer archivado: el documento volvía a crecer mes a mes sin que la
           app avisara nunca más. Ahora la única condición es el tamaño real. */
        const bd=calcularBreakdownPayload();
        if(bd.totalKB<=ARCHIVO_KB_RENDIMIENTO)return;
        _archivoSugerido=true;
        const ui=window._recoveryUI;if(!ui||!ui.error)return;
        const critico=bd.totalKB>700;
        ui.ensure&&ui.ensure();
        ui.error(critico?('Documento grande ('+bd.totalKB+' KB)'):('Sincronización lenta ('+bd.totalKB+' KB)'),
            critico
                ?'El documento principal se acerca al límite de Firestore (1 MB). Conviene archivar los meses viejos ahora, antes de que se bloqueen los writes.'
                :'Cada operación que cargás reescribe el documento entero ('+bd.totalKB+' KB) y lo vuelve a bajar por el listener. Archivar los meses viejos deja solo los recientes y la sincronización pasa a ser casi instantánea. El detalle archivado sigue disponible en 📦 Archivo.',
            [
                {label:'⚡ Optimizar ahora',color:'#059669',onClick:()=>{ui.hide&&ui.hide();setTimeout(()=>archivarHistorial({trigger:'auto-sugerencia'}),200)}},
                {label:'Más tarde',color:'#64748b',onClick:()=>{
                    try{localStorage.setItem('p2p_archivo_snooze_'+AppState.currentUser.uid,String(Date.now()))}catch(_){}
                    ui.hide&&ui.hide();
                }}
            ]);
    }catch(_){}
}
document.addEventListener('DOMContentLoaded',()=>{setTimeout(_archivoAutoSugerir,6000)});

/* ─── Watchdog de conexión (v4.9.4) ───────────────────────────────────────
   "Que la aplicación siempre trate de estar en línea": si a los 12s de boot no
   llegó NINGÚN snapshot de servidor teniendo internet, kick suave del canal;
   si a los 25s sigue muda, mostrar el doctor con el botón de reinicio. Cubre
   la cola envenenada y los canales WebChannel rotos sin esperar a que el
   usuario intente archivar. */
let _connWatchdogDone=false;
async function _connWatchdog(){
    if(_connWatchdogDone)return;_connWatchdogDone=true;
    const activo=()=>AppState.currentUser&&navigator.onLine&&!AppState._snapshotServidorOk&&!AppState._recoveryActive&&!_archivoRunning;
    await new Promise(r=>setTimeout(r,12000));
    if(!activo())return;
    /* v4.9.6 — Nunca patear el canal con una escritura EN VUELO: disableNetwork()
       aborta la conexión del write en curso y lo obliga a reintentar desde cero,
       empeorando justo el caso que queríamos arreglar (conexión lenta pero viva). */
    if(typeof _guardando!=='undefined'&&_guardando){
        console.warn('[P2P][WATCHDOG] Write en vuelo — no se patea el canal');
    }else{
        console.warn('[P2P][WATCHDOG] Sin snapshot de servidor a los 12s — kick del canal');
        try{await AppState.db.disableNetwork()}catch(_){}
        try{await AppState.db.enableNetwork()}catch(_){}
    }
    await new Promise(r=>setTimeout(r,13000));
    if(!activo())return;
    console.warn('[P2P][WATCHDOG] Canal muerto a los 25s — mostrando doctor');
    let colaAtascada=false;
    try{await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('t')),5000);AppState.db.waitForPendingWrites().then(()=>{clearTimeout(t);res()},()=>{clearTimeout(t);res()})})}catch(_){colaAtascada=true}
    const ui=window._recoveryUI;if(!ui||!ui.error)return;
    ui.ensure&&ui.ensure();
    /* v5.2.1 — Si el documento remoto está en formato anterior, el canal puede
       estar sano: ese caso lo diagnostica y lo explica el handler de estado, y
       este cartel solo agregaba ruido y una causa equivocada. */
    const _t=document.getElementById('syncText');
    if(_t&&String(_t.textContent||'').indexOf('Formato anterior')>=0)return;
    ui.error('Sin conexión con Firestore',
        colaAtascada
            ?'La app no logra hablar con Firestore y hay escrituras internas atascadas de una sesión anterior (la cola persistida bloquea todo lo nuevo). "Reiniciar conexión" limpia SOLO esa cola interna y recarga. Tus operaciones no se tocan: viven en el respaldo local.'
            :'La app no logra establecer el canal con Firestore en esta red. Probá reiniciar la conexión o cambiar de red.',
        [
            {label:'🧹 Reiniciar conexión y recargar',color:'#d97706',onClick:()=>{_archivoResetConexion()}},
            {label:'Seguir en modo local',color:'#64748b',onClick:()=>{ui.hide&&ui.hide()}}
        ]);
}
document.addEventListener('DOMContentLoaded',()=>{_connWatchdog()});

/* Mostrar el botón 📦 cuando el índice esté hidratado */
document.addEventListener('DOMContentLoaded',()=>{setTimeout(mostrarBotonArchivo,3500);setTimeout(mostrarBotonArchivo,8000)});

/* v4.9.6 — Diagnóstico de velocidad de sincronización, a demanda desde consola:
   diagnosticoSync() → cuánto pesa el documento, qué lo ocupa y cuánto tarda un save. */
function diagnosticoSync(){
    const bd=calcularBreakdownPayload();
    const meses=(AppState.datos&&AppState.datos._archivoIndex&&AppState.datos._archivoIndex.meses)||{};
    const est=kb=>({'4G lento (0,5 Mb/s)':(kb*8/512).toFixed(1)+'s','4G (1 Mb/s)':(kb*8/1024).toFixed(1)+'s','WiFi (5 Mb/s)':(kb*8/5120).toFixed(1)+'s'});
    const r={
        documentoKB:bd.totalKB,
        traficoPorOperacionKB:bd.totalKB*2,   /* sube el doc + el listener lo baja */
        subidaEstimada:est(bd.totalKB),
        porSeccion:bd.secciones,
        operaciones:(AppState.datos.operaciones||[]).length,
        mesesArchivados:Object.keys(meses).sort(),
        recomendacion:bd.totalKB>ARCHIVO_KB_RENDIMIENTO
            ?'Archivá meses viejos: window.archivarHistorial({mesesAMantener:1})'
            :'Tamaño saludable — la sincronización debería ser casi instantánea.'
    };
    console.table(bd.secciones);console.log(r);
    return r;
}
window.diagnosticoSync=diagnosticoSync;
window.archivarHistorial=archivarHistorial;
window.calcularBreakdownPayload=calcularBreakdownPayload;
window.verArchivo=verArchivo;
window.mostrarBotonArchivo=mostrarBotonArchivo;
window._calcularPlanArchivo=_calcularPlanArchivo;
