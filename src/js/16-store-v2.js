'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   §16 — ALMACENAMIENTO v2: UN DOCUMENTO POR EVENTO  (v5.0.0)
   ════════════════════════════════════════════════════════════════════════════
   POR QUÉ EXISTE
   El modelo v1 guarda TODO el estado en un único documento `users/{uid}`. Cada
   operación que cargás reescribe el documento entero y el listener lo baja de
   vuelta: medido hoy, 104 KB × 2 = ~208 KB de tráfico por operación, siempre
   sobre el mismo documento. Firestore además penaliza con latencia las
   escrituras frecuentes a un mismo documento. Archivar alivia, pero el costo
   por operación sigue siendo proporcional a la historia que quede: es un
   parche recurrente, no una solución.

   MODELO v2 — el costo de escribir deja de depender de la historia:

     users/{uid}                    ← documento de ESTADO (chico y acotado)
         bancos, tags, tasasRecientes, comisiones, lotesManuales,
         _archivoSeeds, _archivoIndex, ultimoMesProcesado, _version, _schema:2

     users/{uid}/eventos/{docId}    ← UN documento por evento
         k: 'op'|'mv'|'tr'|'cv'   (operación / ajuste / transferencia / conversión)
         f: 'YYYY-MM-DD'          (fecha — permite archivar y filtrar por mes)
         d: payload               (las operaciones viajan comprimidas wire)

     users/{uid}/archivo/{YYYY-MM}      ← sin cambios (frío)
     users/{uid}/monthly_summaries      ← sin cambios

   Agregar una operación pasa a escribir SU documento (~0,2 KB) más el
   documento de estado (los saldos de banco cambian). Constante: da igual si
   tenés 300 operaciones o 30.000.

   POR QUÉ ES UN CAMBIO TRACTABLE
   La app ya rastrea cada mutación individual en _syncQueue como
   {type, entity, id} — exactamente la entrada que necesita un escritor
   incremental. No hay que inventar detección de cambios: ya existe.

   VENTAJA COLATERAL: la reconciliación multi-dispositivo se vuelve por
   documento (Firestore resuelve por doc, el listener entrega solo lo que
   cambió). Desaparecen el ping-pong de _version, el estado stale-version y
   el payload guard, que fueron fuente de la mayoría de los incidentes.

   ESTE MÓDULO ES INERTE hasta que el documento de estado tenga _schema:2.
   Mientras tanto la app funciona exactamente como hoy.
   ════════════════════════════════════════════════════════════════════════════ */

const V2_SCHEMA=2;
const V2_BATCH_MAX=400;            /* límite duro de Firestore: 500 por batch */
const V2_WRITE_TIMEOUT=45000;
const V2_EPSILON=0.005;

/* Entidad de la app ⇄ discriminador corto del documento */
const V2_PREFIJO={operaciones:'op',movimientos:'mv',transferencias:'tr',conversiones:'cv'};
const V2_ENTIDAD={op:'operaciones',mv:'movimientos',tr:'transferencias',cv:'conversiones'};
/* Entidades que viven en el documento de ESTADO (no generan doc por evento) */
const V2_ENTIDADES_ESTADO=new Set(['bancos','config','tags','settings','lotes']);

let _v2Migrando=false;

/* ─── Códec evento ⇄ documento ─────────────────────────────────────────────
   El id del documento se deriva del id del evento, saneado para Firestore
   (sin / \ . ni espacios). El id verdadero viaja SIEMPRE dentro del payload,
   así que el saneo nunca puede perder información. */
function v2DocId(entidad,id){
    const p=V2_PREFIJO[entidad];
    if(!p)return null;
    return p+'_'+String(id).replace(/[^A-Za-z0-9_-]/g,'-').slice(0,120);
}
function v2ToDoc(entidad,item){
    const k=V2_PREFIJO[entidad];
    if(!k||!item)return null;
    /* Nunca persistir el hint local del punto amarillo */
    const{_syncState,...limpio}=item;
    let d=limpio;
    if(entidad==='operaciones'){
        /* Las operaciones reusan la compresión wire ya probada. consumedLots y
           ganancia son derivables (recalcularLotesYGanancias los reconstruye),
           así que no se persisten — igual que en v1. */
        const{consumedLots,ganancia,comisionPlataforma,...op}=limpio;
        if(!window._wireCompressionBroken&&typeof _compressOpForWire==='function'){
            try{d=_compressOpForWire(op)}catch(_){d=op}
        }else d=op;
    }
    return{k,f:String(item.fecha||''),d,w:(entidad==='operaciones'&&d!==limpio)?WIRE_FORMAT_VERSION:null};
}
function v2FromDoc(data){
    if(!data||!data.k)return null;
    const entidad=V2_ENTIDAD[data.k];
    if(!entidad)return null;
    let item=data.d||{};
    if(entidad==='operaciones'&&data.w&&typeof _decompressOpFromWire==='function'){
        try{item=_decompressOpFromWire(item)}catch(_){}
    }
    return{entidad,item};
}

/* ─── Documento de ESTADO: todo lo que no es un evento ─────────────────────
   Espeja el payload de v1 menos los cuatro arrays de eventos. Los lotes
   MANUALES (incluidos los carryover del archivado) no son derivables, así que
   siguen viajando acá, igual que en v1. */
function v2ExtraerEstado(datos,version){
    const d=datos||{};
    const{operaciones,movimientos,transferencias,conversiones,lotes,saldoUsdt,...resto}=d;
    const estado={...resto};
    /* v5.0.1 — sin los de arrastre: su declaración va en _archivoCarryover, que
       viaja intacta dentro de `resto` */
    estado.lotesManuales=(d.lotes||[]).filter(l=>l&&l.manual&&!l.carryover).map(l=>{const{_syncState,...r}=l;return r});
    estado._schema=V2_SCHEMA;
    if(version!==undefined)estado._version=version;
    delete estado._syncState;
    return estado;
}

/* ─── Ensamblador: documento de estado + docs de eventos → AppState.datos ─── */
function v2EnsamblarDatos(estado,eventosDocs){
    const base=(typeof crearDatosVacios==='function')?crearDatosVacios():{operaciones:[],movimientos:[],transferencias:[],conversiones:[],bancos:{},lotes:[],tags:[]};
    const datos={...base,...(estado||{})};
    datos.operaciones=[];datos.movimientos=[];datos.transferencias=[];datos.conversiones=[];
    (eventosDocs||[]).forEach(raw=>{
        const r=v2FromDoc(raw);
        if(r&&Array.isArray(datos[r.entidad]))datos[r.entidad].push(r.item);
    });
    /* Orden cronológico estable: el motor FIFO reproduce por fecha+hora, pero
       las listas de la UI y los tests esperan un orden determinístico. */
    const clave=x=>String(x.fecha||'')+String(x.hora||'00:00')+String(x.id||'');
    ['operaciones','movimientos','transferencias','conversiones'].forEach(e=>{
        datos[e].sort((a,b)=>{const ka=clave(a),kb=clave(b);return ka<kb?-1:ka>kb?1:0});
    });
    datos.lotes=Array.isArray(estado&&estado.lotesManuales)?estado.lotesManuales.map(l=>({...l})):[];
    delete datos.lotesManuales;
    return datos;
}

/* ─── Planificador de escritura incremental ────────────────────────────────
   Traduce la cola de mutaciones a operaciones de documento. Devuelve
   {sets, deletes, tocaEstado} — nada de esto se ejecuta acá: la función es
   pura y testeable. Un mismo id mutado varias veces colapsa en UNA escritura. */
function v2PlanDelta(cola,datos){
    const sets=new Map(),deletes=new Map();
    let tocaEstado=false;
    (cola||[]).forEach(a=>{
        if(!a||!a.entity)return;
        if(V2_ENTIDADES_ESTADO.has(a.entity)){tocaEstado=true;return}
        const entidad=a.entity;
        if(!V2_PREFIJO[entidad]){tocaEstado=true;return}   /* 'state','pending', etc. */
        const docId=v2DocId(entidad,a.id);
        if(!docId)return;
        if(a.type==='delete'){deletes.set(docId,true);sets.delete(docId);return}
        const arr=(datos&&datos[entidad])||[];
        const item=arr.find(x=>String(x.id)===String(a.id));
        /* Si el item ya no está en memoria, fue borrado después de encolarse:
           el delete correspondiente ya está (o llegará) en la cola. */
        if(!item)return;
        if(deletes.has(docId))return;
        sets.set(docId,v2ToDoc(entidad,item));
    });
    /* Cualquier alta/baja de evento cambia saldos de banco → el estado va igual */
    if(sets.size||deletes.size)tocaEstado=true;
    return{sets:[...sets.entries()].map(([id,data])=>({id,data})),
           deletes:[...deletes.keys()],
           tocaEstado};
}

/* ─── Verificación de equivalencia v1 ⇄ v2 ────────────────────────────────
   Mismo criterio que el archivado: no alcanza con que "parezca igual", tienen
   que coincidir el saldo USDT, el disponible por moneda y la ganancia de CADA
   operación tras el replay completo. */
function v2VerificarEquivalencia(datosV1,datosV2){
    const diffs=[];
    const replay=d=>{
        const original=AppState.datos;
        AppState.datos=JSON.parse(JSON.stringify(d));
        try{
            recalcularLotesYGanancias();
            return{saldoUsdt:AppState.datos.saldoUsdt,
                   lotes:AppState.datos.lotes.map(l=>({...l})),
                   ops:new Map(AppState.datos.operaciones.map(o=>[String(o.id),o]))};
        }finally{AppState.datos=original}
    };
    const a=replay(datosV1),b=replay(datosV2);
    ['operaciones','movimientos','transferencias','conversiones'].forEach(e=>{
        const na=(datosV1[e]||[]).length,nb=(datosV2[e]||[]).length;
        if(na!==nb)diffs.push(e+': '+na+' → '+nb);
    });
    if(Math.abs((a.saldoUsdt||0)-(b.saldoUsdt||0))>V2_EPSILON)
        diffs.push('saldoUsdt: '+a.saldoUsdt+' → '+b.saldoUsdt);
    const disp=lotes=>{const r={};lotes.forEach(l=>{if(l.disponible>V2_EPSILON){const m=l.moneda||'UYU';r[m]=roundMoney((r[m]||0)+l.disponible)}});return r};
    const da=disp(a.lotes),db=disp(b.lotes);
    Object.keys({...da,...db}).forEach(m=>{
        if(Math.abs((da[m]||0)-(db[m]||0))>V2_EPSILON)diffs.push('disponible '+m+': '+(da[m]||0)+' → '+(db[m]||0));
    });
    for(const[id,oa]of a.ops){
        const ob=b.ops.get(id);
        if(!ob){diffs.push('operación ausente: '+id);break}
        if(Math.abs((oa.ganancia||0)-(ob.ganancia||0))>V2_EPSILON){
            diffs.push('ganancia op '+id+' ('+oa.fecha+'): '+oa.ganancia+' → '+ob.ganancia);
            if(diffs.length>6)break;
        }
    }
    /* Saldos de banco: se copian tal cual, pero si algo los tocara lo queremos saber */
    Object.keys(datosV1.bancos||{}).forEach(n=>{
        const sa=(datosV1.bancos[n]||{}).saldo||0,sb=((datosV2.bancos||{})[n]||{}).saldo||0;
        if(Math.abs(sa-sb)>V2_EPSILON)diffs.push('saldo '+n+': '+sa+' → '+sb);
    });
    return diffs;
}

/* ─── MIGRACIÓN v1 → v2 ────────────────────────────────────────────────────
   Orden pensado para que ningún fallo intermedio pueda perder datos:
     1. Backup JSON automático.
     2. Escribir TODOS los docs de evento (en lotes, con timeout y reintentos).
        El documento de estado sigue intacto con sus arrays v1 → si algo falla
        acá, la app sigue funcionando en v1 y los docs escritos son inofensivos
        (se sobrescriben al reintentar: mismo id, idempotente).
     3. Releer los eventos DESDE EL SERVIDOR, reensamblar y verificar
        equivalencia total contra el estado actual.
     4. Recién ahí, un único set() del documento de estado con _schema:2 y sin
        los arrays. Ese write es el punto de conmutación, y es atómico.
   ════════════════════════════════════════════════════════════════════════ */
async function migrarAV2(opts){
    opts=opts||{};
    const ui=window._recoveryUI||{};
    const setPhase=ui.setPhase||function(){};
    const setMeta=ui.setMeta||function(){};
    if(_v2Migrando)return{ok:false,motivo:'ya-corriendo'};
    if(!AppState.currentUser||!AppState.db){alert('Sin sesión activa.');return{ok:false,motivo:'sin-sesion'}}
    if(!navigator.onLine){alert('Necesitás conexión para migrar.');return{ok:false,motivo:'offline'}}
    if(AppState._schema===V2_SCHEMA)return{ok:false,motivo:'ya-migrado'};
    /* ═══ CERROJO DE FASE ═══
       Migrar sin el camino de lectura/escritura v2 conectado dejaría el documento
       de estado SIN los arrays, y el código v1 lo interpretaría como "datos
       vacíos": se dispararía la protección anti-borrado y volvería a subir el
       formato viejo, deshaciendo la migración. El cableado (listener de la
       subcolección + escritura incremental) declara window._v2WiringReady=true.
       Hasta entonces, esto no corre ni desde la consola. */
    if(!window._v2WiringReady){
        const msj='La migración todavía no está habilitada: falta conectar el camino de lectura y escritura del nuevo formato (fase 2).\n\nEsta versión solo incluye el motor de migración y sus verificaciones, sin activarlo. La app sigue funcionando igual que hasta ahora.';
        console.warn('[P2P][v2] '+msj);
        alert(msj);
        return{ok:false,motivo:'wiring-pendiente'};
    }
    if(!opts.sinConfirmar){
        const n=(AppState.datos.operaciones||[]).length+(AppState.datos.movimientos||[]).length+
                (AppState.datos.transferencias||[]).length+(AppState.datos.conversiones||[]).length;
        if(!confirm('Migrar al formato rápido\n\n'+
            'Se van a crear '+n+' documentos individuales (uno por operación, ajuste y transferencia).\n\n'+
            'A partir de ahí, cargar una operación escribe solo su documento en vez del archivo completo.\n\n'+
            'IMPORTANTE: todos tus dispositivos tienen que estar en esta versión ANTES de migrar.\n\n'+
            '¿Continuar?'))return{ok:false,motivo:'cancelado'};
    }
    _v2Migrando=true;
    try{
        if(ui.ensure)ui.ensure();
        AppState._recoveryActive=true;             /* congela listener y saves */

        setPhase('Exportando backup de seguridad…');
        try{if(typeof exportarDatos==='function')exportarDatos()}catch(_){}
        await new Promise(r=>setTimeout(r,50));

        const datosV1=JSON.parse(JSON.stringify(AppState.datos));
        const userRef=AppState.db.collection('users').doc(AppState.currentUser.uid);
        const evRef=userRef.collection('eventos');

        /* ── 1. Armar todos los documentos ── */
        setPhase('Preparando documentos…');
        const pendientes=[];
        ['operaciones','movimientos','transferencias','conversiones'].forEach(entidad=>{
            (datosV1[entidad]||[]).forEach(item=>{
                const id=v2DocId(entidad,item.id);
                const data=v2ToDoc(entidad,item);
                if(id&&data)pendientes.push({id,data});
            });
        });
        if(!pendientes.length){
            AppState._recoveryActive=false;_v2Migrando=false;
            if(ui.hide)ui.hide();
            alert('No hay eventos para migrar.');
            return{ok:false,motivo:'sin-eventos'};
        }

        /* ── 2. Escribir en lotes, con timeout y reintentos ── */
        const conTimeout=(p,ms,tag)=>new Promise((res,rej)=>{
            let fin=false;const h=setTimeout(()=>{if(!fin){fin=true;rej(new Error(tag+' superó '+Math.round(ms/1000)+'s'))}},ms);
            p.then(v=>{if(!fin){fin=true;clearTimeout(h);res(v)}},e=>{if(!fin){fin=true;clearTimeout(h);rej(e)}});
        });
        const totalLotes=Math.ceil(pendientes.length/V2_BATCH_MAX);
        for(let i=0;i<totalLotes;i++){
            const trozo=pendientes.slice(i*V2_BATCH_MAX,(i+1)*V2_BATCH_MAX);
            let ok=false,ultErr=null;
            for(let intento=1;intento<=3&&!ok;intento++){
                setPhase('Migrando '+(i*V2_BATCH_MAX+trozo.length)+'/'+pendientes.length+' documentos…');
                setMeta('Lote '+(i+1)+'/'+totalLotes+' · intento '+intento+'/3');
                try{
                    const batch=AppState.db.batch();
                    trozo.forEach(x=>batch.set(evRef.doc(x.id),x.data));
                    await conTimeout(batch.commit(),V2_WRITE_TIMEOUT,'lote '+(i+1));
                    ok=true;
                }catch(e){
                    ultErr=e;
                    if(/permission|insufficient/i.test(String(e&&e.message||e)))
                        throw new Error('Las reglas de Firestore no permiten escribir en users/{uid}/eventos. Agregá esa subcolección a las reglas (la misma regla que ya tenés para archivo).');
                    if(intento<3){setMeta('Reintentando en 3s…');await new Promise(r=>setTimeout(r,3000))}
                }
            }
            if(!ok)throw new Error('Lote '+(i+1)+' falló tras 3 intentos: '+(ultErr&&ultErr.message||ultErr));
        }

        /* ── 3. Releer del servidor y verificar equivalencia ── */
        setPhase('Verificando desde el servidor…');
        const snap=await conTimeout(evRef.get({source:'server'}),V2_WRITE_TIMEOUT,'lectura de verificación');
        const leidos=[];snap.forEach(d=>leidos.push(d.data()));
        if(leidos.length!==pendientes.length)
            throw new Error('Verificación: se escribieron '+pendientes.length+' documentos pero el servidor devuelve '+leidos.length+'.');
        const datosV2=v2EnsamblarDatos(v2ExtraerEstado(datosV1,datosV1._version||0),leidos);
        const diffs=v2VerificarEquivalencia(datosV1,datosV2);
        if(diffs.length)
            throw new Error('La verificación encontró diferencias — no se cambió el formato:\n• '+diffs.join('\n• '));

        /* ── 4. Conmutación atómica: estado con _schema:2 y sin arrays ── */
        setPhase('Activando formato rápido…');
        const nuevaVersion=(AppState._localVersion||datosV1._version||0)+1;
        const estado=v2ExtraerEstado(datosV1,nuevaVersion);
        estado.ultimaActualizacion=firebase.firestore.FieldValue.serverTimestamp();
        /* Borrar explícitamente los arrays v1 del documento remoto */
        ['operaciones','movimientos','transferencias','conversiones','lotes','saldoUsdt'].forEach(c=>{
            estado[c]=firebase.firestore.FieldValue.delete();
        });
        await conTimeout(userRef.set(estado,{merge:true}),V2_WRITE_TIMEOUT,'documento de estado');

        AppState._schema=V2_SCHEMA;
        AppState._localVersion=nuevaVersion;
        AppState.datos._version=nuevaVersion;
        try{localStorage.setItem('p2p_schema_'+AppState.currentUser.uid,String(V2_SCHEMA))}catch(_){}
        try{localStorage.setItem('p2p_v2count_'+AppState.currentUser.uid,String(pendientes.length))}catch(_){}
        AppState._recoveryActive=false;
        _v2Migrando=false;

        const kb=Math.round(JSON.stringify(v2ExtraerEstado(AppState.datos,nuevaVersion)).length/1024);
        console.log('[P2P][v2] Migración OK —',pendientes.length,'eventos · estado ~'+kb+' KB');
        setTimeout(()=>{
            alert('✅ Formato rápido activado.\n\n'+
                  'Eventos migrados: '+pendientes.length+'\n'+
                  'Documento de estado: ~'+kb+' KB\n\n'+
                  'A partir de ahora, cargar una operación escribe solo su documento.\n'+
                  'Actualizá tus otros dispositivos y recargá la app en cada uno.');
            if(typeof actualizarVista==='function')actualizarVista();
        },400);
        return{ok:true,eventos:pendientes.length,estadoKB:kb};
    }catch(e){
        console.error('[P2P][v2] Migración:',e);
        AppState._recoveryActive=false;
        _v2Migrando=false;
        const msg='Migración interrumpida: '+(e&&e.message||e)+
            '\n\nNo se perdió nada: el documento principal sigue en el formato anterior y la app funciona normalmente. Los documentos ya escritos se reutilizan al reintentar.';
        if(window._recoveryUI&&window._recoveryUI.error){
            window._recoveryUI.error('Migración interrumpida',msg,[
                {label:'🔄 Reintentar migración',color:'#3b82f6',onClick:()=>{window._recoveryUI.hide&&window._recoveryUI.hide();setTimeout(()=>migrarAV2(opts),300)}},
                {label:'Cerrar',color:'#64748b',onClick:()=>{window._recoveryUI.hide&&window._recoveryUI.hide()}}
            ]);
        }else alert(msg);
        return{ok:false,error:e};
    }
}

/* ─── Reversión al documento único: RETIRADA en v5.2.0 ────────────────────
   revertirAV1() reescribía el documento con los arrays y _schema:1. Sin camino
   de lectura v1 en la app, ese documento ya no se podría abrir, así que la
   función pasó a ser una trampa en vez de una salida. La marcha atrás real es
   revertir en git a la v5.1.0 (que conserva ambos caminos y la función) y
   ejecutarla desde ahí. */

/* ─── Diagnóstico comparativo ─────────────────────────────────────────────── */
function v2Diagnostico(){
    const d=AppState.datos||{};
    const kbEstado=Math.round(JSON.stringify(v2ExtraerEstado(d,1)).length/1024*10)/10;
    const nEv=(d.operaciones||[]).length+(d.movimientos||[]).length+(d.transferencias||[]).length+(d.conversiones||[]).length;
    /* v1 real = lo que guardarDatos sube hoy: derivables stripeados + wire */
    let kbV1=0;
    try{
        const strip=a=>(a||[]).map(x=>{const{_syncState,consumedLots,ganancia,comisionPlataforma,...r}=x;return r});
        const sim={...d,operaciones:strip(d.operaciones)};
        delete sim.lotes;delete sim.saldoUsdt;
        if(!window._wireCompressionBroken&&typeof _compressOpsArrayForWire==='function')
            sim.operaciones=_compressOpsArrayForWire(sim.operaciones);
        kbV1=Math.round(JSON.stringify(sim).length/1024);
    }catch(_){}
    const muestra=(d.operaciones||[])[0];
    const kbEvento=muestra?Math.round(JSON.stringify(v2ToDoc('operaciones',muestra)).length/1024*100)/100:0;
    const r={
        esquemaActual:AppState._schema===V2_SCHEMA?'v2 (rápido)':'v1 (documento único)',
        eventos:nEv,
        v1_porOperacionKB:kbV1,
        v2_porOperacionKB:Math.round((kbEstado+kbEvento)*10)/10,
        v2_documentoEstadoKB:kbEstado,
        v2_documentoEventoKB:kbEvento,
        mejora:kbV1>0?Math.round(kbV1/Math.max(0.1,kbEstado+kbEvento))+'× menos por operación':'—'
    };
    console.log(r);return r;
}

/* ════════════════════════════════════════════════════════════════════════════
   FASE 2 — CABLEADO DE LECTURA Y ESCRITURA
   ════════════════════════════════════════════════════════════════════════════
   Todo el camino v1 queda intacto: 08 solo delega acá cuando el documento de
   estado declara _schema:2. Si algún día se revierte, la app vuelve sola al
   camino viejo sin tocar una línea.

   LECTURA — dos escuchas:
     · documento de estado  → bancos, tags, tasas, lotes manuales, config
     · subcolección eventos → altas/bajas/cambios documento por documento
   Firestore entrega SOLO lo que cambió, así que traer una operación nueva de
   otro dispositivo cuesta un documento, no el archivo entero. El re-render se
   agrupa: una ráfaga de cambios produce un solo recálculo.

   ESCRITURA — la cola de mutaciones se traduce a un batch:
   los documentos de los eventos tocados + el documento de estado. Todo en una
   escritura atómica de Firestore.
   ════════════════════════════════════════════════════════════════════════════ */

let _v2EventosUnsub=null,_v2EstadoOk=false,_v2EventosOk=false,_v2RenderTimer=null,_v2Guardando=false,_v2FromCache=false,_v2EsperandoServidor=false;

function _v2UserRef(){return AppState.db.collection('users').doc(AppState.currentUser.uid)}
function _v2EvRef(){return _v2UserRef().collection('eventos')}
function _v2ConTimeout(p,ms,tag){
    return new Promise((res,rej)=>{
        let fin=false;const h=setTimeout(()=>{if(!fin){fin=true;rej(new Error(tag+' superó '+Math.round(ms/1000)+'s'))}},ms);
        p.then(v=>{if(!fin){fin=true;clearTimeout(h);res(v)}},e=>{if(!fin){fin=true;clearTimeout(h);rej(e)}});
    });
}

/* Re-render agrupado: varias llegadas seguidas → un solo recálculo FIFO */
function _v2Programar(){
    if(!_v2EstadoOk||!_v2EventosOk)return;
    clearTimeout(_v2RenderTimer);
    _v2RenderTimer=setTimeout(()=>{
        _v2RenderTimer=null;
        try{
            if(typeof inicializarBancos==='function')inicializarBancos();
            if(typeof verificarResetLimites==='function')verificarResetLimites();
            recalcularLotesYGanancias();
            if(typeof _invalidateListCache==='function')_invalidateListCache();
            if(typeof actualizarVista==='function')actualizarVista();
            if(typeof backupToLocal==='function')backupToLocal();
            if(typeof mostrarBotonArchivo==='function')mostrarBotonArchivo();
            /* v5.2.0 — Remate de UI que antes hacía el handler de snapshot v1.
               Sin esto, al retirar ese camino se perdían el resumen mensual, el
               centro de novedades y el ocultado del cargador. */
            try{
                const ci=$('comisionPlataforma');
                if(ci&&document.activeElement!==ci&&typeof getMonedaBanco==='function'){
                    const mon=getMonedaBanco();
                    const cv=mon==='USD'?AppState.datos.comisionUSD:AppState.datos.comisionPlataforma;
                    ci.value=fmtNum(cv);setText('comisionPctLabel',fmtNum(cv));
                }
            }catch(_){}
            if(typeof actualizarFormulario==='function')actualizarFormulario();
            if(typeof actualizarColorSelect==='function')actualizarColorSelect();
            if(typeof ocultarLoading==='function')ocultarLoading();
            if(typeof actualizarBadgeNoticias==='function')actualizarBadgeNoticias();
            if(AppState.ui&&!AppState.ui._noticiasInicializadas){
                AppState.ui._noticiasInicializadas=true;
                if(typeof chequearWhatsNewAlInicio==='function')chequearWhatsNewAlInicio();
            }
            if(!_v2FromCache&&typeof verificarCambioMes==='function')verificarCambioMes();
            if(!_v2FromCache&&AppState._uiHydratedFromCache)AppState._uiHydratedFromCache=false;
            if(_syncQueue.length===0&&!_guardando)setSyncStatus(_v2FromCache?'syncing':'online',_v2FromCache?'Caché local':undefined);
        }catch(e){console.error('[P2P][v2] render:',e)}
    },80);
}

/* ─── Snapshot del documento de ESTADO ───────────────────────────────────── */
function v2OnEstadoSnapshot(doc){
    const d=doc.data()||{};
    AppState._schema=V2_SCHEMA;
    try{localStorage.setItem('p2p_schema_'+AppState.currentUser.uid,String(V2_SCHEMA))}catch(_){}
    _v2FromCache=!!doc.metadata.fromCache;
    if(!_v2FromCache)AppState._snapshotServidorOk=true;
    const serverV=d._version||0;
    /* Protección de cambios locales sin subir: si hay mutaciones de estado en la
       cola (saldos, tags, config), lo local manda hasta que se confirme el push.
       Mismo criterio que usaba mergeRemoteState en v1. */
    const pendienteEstado=_syncQueue.some(a=>a&&(V2_ENTIDADES_ESTADO.has(a.entity)||!V2_PREFIJO[a.entity]));
    if(!AppState.datos)AppState.datos=(typeof crearDatosVacios==='function')?crearDatosVacios():{};
    if(serverV>=(AppState._localVersion||0)&&!doc.metadata.hasPendingWrites&&!pendienteEstado){
        Object.keys(d).forEach(k=>{
            if(k==='lotesManuales'||k==='ultimaActualizacion')return;
            AppState.datos[k]=d[k];
        });
        /* Los lotes manuales/carryover no son derivables: vienen del estado.
           Los automáticos los regenera recalcularLotesYGanancias(). */
        if(Array.isArray(d.lotesManuales)){
            const noManual=(AppState.datos.lotes||[]).filter(l=>l&&!l.manual);
            AppState.datos.lotes=[...d.lotesManuales.map(l=>({...l})),...noManual];
        }
        AppState._localVersion=serverV;
        AppState.datos._version=serverV;
    }
    AppState._datosStale=false;
    _v2EstadoOk=true;
    v2AttachEventos();
    _v2Programar();
}

/* ─── Escucha de la subcolección de EVENTOS ──────────────────────────────── */
/* Cantidad de eventos confirmada por el SERVIDOR. Es la referencia del
   anti-borrado: una caché parcial no puede hacernos creer que se borró todo. */
function _v2CountGet(){try{return parseInt(localStorage.getItem('p2p_v2count_'+AppState.currentUser.uid)||'0',10)||0}catch(_){return 0}}
function _v2CountSet(n){try{localStorage.setItem('p2p_v2count_'+AppState.currentUser.uid,String(n))}catch(_){}}

function v2AttachEventos(){
    if(_v2EventosUnsub)return;
    /* includeMetadataChanges: necesario para enterarnos cuando la MISMA data pasa
       de caché a servidor. Sin esto, si el contenido no cambia, nunca sabríamos
       que ya estamos sincronizados de verdad. */
    _v2EventosUnsub=_v2EvRef().onSnapshot({includeMetadataChanges:true},snap=>{
        /* ═══ v5.2.1 — Reconstrucción completa en vez de diffs ═══
           Antes se aplicaban los docChanges() incrementalmente, lo que obliga a
           que TODOS los snapshots se apliquen en orden: si uno se descartaba (por
           ejemplo, por sospechoso), los siguientes diffs quedaban desfasados y la
           lista incompleta. Reconstruir desde el snapshot completo elimina esa
           clase entera de errores y cuesta un par de milisegundos. */
        const desdeCache=snap.metadata.fromCache;
        const total=snap.size;
        const esperado=_v2CountGet();
        /* ═══ ANTI-BORRADO ═══
           Una caché local parcial (dispositivo que no se abría hace días, o
           IndexedDB a medio poblar) puede entregar 0 eventos. Sin esta guarda, la
           app mostraba 0 operaciones y un saldo USDT que salía solo de los lotes
           de arrastre. No se aplica ni se dibuja hasta que hable el servidor. */
        const sospechoso=desdeCache&&esperado>0&&total<Math.max(1,Math.floor(esperado*0.9));
        if(sospechoso){
            console.warn('[P2P][v2] Caché parcial ('+total+' de ~'+esperado+' eventos) — esperando al servidor');
            setSyncStatus('syncing','Cargando desde el servidor…');
            _v2EsperandoServidor=true;
            return;
        }
        _v2EsperandoServidor=false;
        const nuevos={operaciones:[],movimientos:[],transferencias:[],conversiones:[]};
        snap.forEach(d=>{
            const r=v2FromDoc(d.data());
            if(r&&nuevos[r.entidad])nuevos[r.entidad].push(r.item);
        });
        const clave=x=>String(x.fecha||'')+String(x.hora||'00:00')+String(x.id||'');
        Object.keys(nuevos).forEach(e=>{
            nuevos[e].sort((a,b)=>{const ka=clave(a),kb=clave(b);return ka<kb?-1:ka>kb?1:0});
            AppState.datos[e]=nuevos[e];
        });
        /* Reponer el indicador de "sin subir" de lo que sigue en la cola */
        _syncQueue.forEach(a=>{
            const arr=AppState.datos[a&&a.entity];
            if(Array.isArray(arr)){const it=arr.find(x=>String(x.id)===String(a.id));if(it)it._syncState='pending'}
        });
        if(!desdeCache)_v2CountSet(total);
        _v2EventosOk=true;
        _v2Programar();
    },err=>{
        console.error('[P2P][v2] listener eventos:',err);
        const permiso=/permission|insufficient/i.test(String(err&&err.message||err));
        setSyncStatus('offline',permiso?'Sin permiso sobre eventos':'Error de conexión');
        if(permiso)console.error('[P2P][v2] Las reglas de Firestore no permiten leer users/{uid}/eventos.');
    });
}
function v2DetachEventos(){
    if(_v2EventosUnsub){try{_v2EventosUnsub()}catch(_){}_v2EventosUnsub=null}
    _v2EstadoOk=false;_v2EventosOk=false;_v2EsperandoServidor=false;
}

/* ─── ESCRITURA incremental ──────────────────────────────────────────────── */
async function v2Guardar(forzar){
    if(!AppState.currentUser||!AppState.db)return;
    if(_v2Guardando){_guardarPendiente=true;return}
    /* v5.2.1 — Con los eventos a medio cargar, la pantalla muestra un estado
       incompleto: no escribimos nada hasta tener la foto confirmada. */
    if(!_v2EventosOk||_v2EsperandoServidor){
        _guardarPendiente=true;
        setSyncStatus('syncing','Esperando datos del servidor…');
        return;
    }
    const plan=v2PlanDelta(_syncQueue,AppState.datos);
    if(!plan.sets.length&&!plan.deletes.length&&!plan.tocaEstado&&!forzar){
        /* Nada que escribir. Si quedaron entradas en la cola, son de ítems que ya
           no existen (se crearon y borraron sin llegar a subirse): drenarlas, o el
           badge quedaría en "N pendientes" para siempre y los puntos amarillos
           nunca se apagarían. */
        if(_syncQueue.length){
            _syncQueue.length=0;_localDirty=0;
            if(typeof repairOrphanPendingStates==='function')try{repairOrphanPendingStates()}catch(_){}
        }
        setSyncStatus('online');updateSyncBadge();return;
    }
    _v2Guardando=true;_guardando=true;_syncPending++;updateSyncBadge();
    const idsSnapshot=_syncQueue.map(a=>({entity:a.entity,id:a.id,type:a.type}));
    const indicador=setTimeout(()=>{if(_v2Guardando)setSyncStatus('syncing','Sincronizando…')},800);
    try{
        if(!navigator.onLine){setSyncStatus('offline','Sin conexión');throw{code:'offline-deferred'}}
        try{if(typeof backupToLocal==='function')backupToLocal()}catch(_){}
        const nueva=(AppState._localVersion||0)+1;
        const evRef=_v2EvRef(),batch=AppState.db.batch();
        plan.sets.forEach(x=>batch.set(evRef.doc(x.id),x.data));
        plan.deletes.forEach(id=>batch.delete(evRef.doc(id)));
        const estado=v2ExtraerEstado(AppState.datos,nueva);
        estado.ultimaActualizacion=firebase.firestore.FieldValue.serverTimestamp();
        batch.set(_v2UserRef(),estado,{merge:true});
        _syncLog&&_syncLog('v2:write-start',{docs:plan.sets.length,del:plan.deletes.length,v:nueva});
        const t0=performance.now();
        await _v2ConTimeout(batch.commit(),30000,'escritura');
        AppState._localVersion=nueva;AppState.datos._version=nueva;
        _syncLog&&_syncLog('v2:write-end',{ms:Math.round(performance.now()-t0)});
        /* Drenar exactamente lo confirmado */
        const conf=new Set(idsSnapshot.map(x=>String(x.id)));
        for(let i=_syncQueue.length-1;i>=0;i--)if(conf.has(String(_syncQueue[i].id)))_syncQueue.splice(i,1);
        idsSnapshot.forEach(x=>{
            const arr=AppState.datos[x.entity];
            if(Array.isArray(arr)){const it=arr.find(y=>String(y.id)===String(x.id));if(it)delete it._syncState}
        });
        _syncPending=Math.max(0,_syncPending-1);_syncErrors=0;_localDirty=0;
        if(_syncQueue.length===0)setSyncStatus('online');
        updateSyncBadge();
    }catch(e){
        _syncPending=Math.max(0,_syncPending-1);
        if(e&&e.code==='offline-deferred'){_syncLog&&_syncLog('v2:offline-deferred',{})}
        else{
            _syncErrors++;
            console.error('[P2P][v2] guardar:',e);
            setSyncStatus('offline',_syncErrors>=3?'⚠ Sync bloqueado — abrí Diagnóstico':'Reintentando…');
            if(_syncErrors<3){clearTimeout(_retryTimer);_retryTimer=setTimeout(()=>{_syncErrors=0;updateSyncBadge();v2Guardar(true)},Math.min(_retryDelay,30000));_retryDelay=Math.min(_retryDelay*1.5,30000)}
        }
        updateSyncBadge();
    }finally{
        clearTimeout(indicador);
        _v2Guardando=false;_guardando=false;
        if(_guardarPendiente){_guardarPendiente=false;setTimeout(()=>v2Guardar(),0)}
    }
}

/* ─── SUBIDA TOTAL (restauraciones e importaciones) ────────────────────────
   Un guardado normal en v2 escribe solo lo que cambió, y eso se apoya en la cola
   de mutaciones. Pero al restaurar un respaldo o importar un archivo, la memoria
   se reemplaza ENTERA sin pasar por la cola: un guardado normal escribiría solo
   el documento de estado y los eventos quedarían como estaban en Firestore.
   Esta función hace que la subcolección coincida exactamente con la memoria:
   escribe todos los eventos y BORRA los que ya no existen (si el respaldo es
   anterior, las operaciones posteriores tienen que desaparecer del servidor). */
async function v2SubirTodo(opts){
    opts=opts||{};
    const ui=window._recoveryUI||{};
    const setPhase=ui.setPhase||function(){};
    const setMeta=ui.setMeta||function(){};
    if(!AppState.currentUser||!AppState.db)throw new Error('Sin sesión activa.');
    if(!navigator.onLine)throw new Error('Sin conexión: la subida quedó pendiente.');
    const previo=!!AppState._recoveryActive;
    try{
        if(ui.ensure)ui.ensure();
        AppState._recoveryActive=true;
        const evRef=_v2EvRef();
        setPhase('Comparando con el servidor…');
        const snap=await _v2ConTimeout(evRef.get({source:'server'}),45000,'lectura de eventos');
        const remotos=new Set();snap.forEach(d=>remotos.add(d.id));
        const enMemoria=[];
        ['operaciones','movimientos','transferencias','conversiones'].forEach(ent=>{
            (AppState.datos[ent]||[]).forEach(it=>{
                const id=v2DocId(ent,it.id),data=v2ToDoc(ent,it);
                if(id&&data)enMemoria.push({id,data});
            });
        });
        const idsMem=new Set(enMemoria.map(x=>x.id));
        const aBorrar=[...remotos].filter(id=>!idsMem.has(id));
        const commitLote=async(fn,etiqueta)=>{
            let ok=false,ultErr=null;
            for(let intento=1;intento<=3&&!ok;intento++){
                setMeta('Intento '+intento+'/3');
                try{const b=AppState.db.batch();fn(b);await _v2ConTimeout(b.commit(),V2_WRITE_TIMEOUT,etiqueta);ok=true}
                catch(e){ultErr=e;if(intento<3)await new Promise(r=>setTimeout(r,3000))}
            }
            if(!ok)throw new Error(etiqueta+' falló tras 3 intentos: '+(ultErr&&ultErr.message||ultErr));
        };
        for(let i=0;i<enMemoria.length;i+=V2_BATCH_MAX){
            const trozo=enMemoria.slice(i,i+V2_BATCH_MAX);
            setPhase('Subiendo '+(i+trozo.length)+'/'+enMemoria.length+' eventos…');
            await commitLote(b=>trozo.forEach(x=>b.set(evRef.doc(x.id),x.data)),'subida de eventos');
        }
        for(let i=0;i<aBorrar.length;i+=V2_BATCH_MAX){
            const trozo=aBorrar.slice(i,i+V2_BATCH_MAX);
            setPhase('Retirando '+(i+trozo.length)+'/'+aBorrar.length+' eventos que ya no existen…');
            await commitLote(b=>trozo.forEach(id=>b.delete(evRef.doc(id))),'borrado de eventos');
        }
        setPhase('Guardando estado…');
        const nueva=(AppState._localVersion||0)+1;
        const estado=v2ExtraerEstado(AppState.datos,nueva);
        estado.ultimaActualizacion=firebase.firestore.FieldValue.serverTimestamp();
        await _v2ConTimeout(_v2UserRef().set(estado,{merge:true}),V2_WRITE_TIMEOUT,'documento de estado');
        AppState._localVersion=nueva;AppState.datos._version=nueva;
        _syncQueue.length=0;_localDirty=0;_syncErrors=0;
        setSyncStatus('online');updateSyncBadge();
        _v2CountSet(enMemoria.length);
        console.log('[P2P][v2] subida total:',enMemoria.length,'eventos ·',aBorrar.length,'retirados');
        if(ui.hide)ui.hide();
        return{ok:true,subidos:enMemoria.length,borrados:aBorrar.length};
    }catch(e){
        console.error('[P2P][v2] subida total:',e);
        if(ui.hide)ui.hide();
        throw e;
    }finally{
        AppState._recoveryActive=previo;
    }
}

/* ─── Borrado de eventos archivados (lo usa el archivado en v2) ──────────── */
async function v2BorrarEventosArchivados(cutoffMes){
    const snap=await _v2ConTimeout(_v2EvRef().get({source:'server'}),45000,'lectura de eventos');
    const aBorrar=[];
    snap.forEach(doc=>{const f=doc.data().f||'';if(f&&f.slice(0,7)<cutoffMes)aBorrar.push(doc.id)});
    for(let i=0;i<aBorrar.length;i+=V2_BATCH_MAX){
        const b=AppState.db.batch();
        aBorrar.slice(i,i+V2_BATCH_MAX).forEach(id=>b.delete(_v2EvRef().doc(id)));
        await _v2ConTimeout(b.commit(),V2_WRITE_TIMEOUT,'borrado de eventos archivados');
    }
    return aBorrar.length;
}

window._v2sync={
    onEstado:v2OnEstadoSnapshot,
    guardar:v2Guardar,
    detach:v2DetachEventos,
    borrarEventosArchivados:v2BorrarEventosArchivados,
    subirTodo:v2SubirTodo,
    esV2:()=>AppState._schema===V2_SCHEMA
};
/* Señal para el cerrojo de la migración: el camino v2 está conectado */
window._v2WiringReady=true;

window.migrarAV2=migrarAV2;
window.v2Diagnostico=v2Diagnostico;
window._v2={docId:v2DocId,toDoc:v2ToDoc,fromDoc:v2FromDoc,extraerEstado:v2ExtraerEstado,
            ensamblar:v2EnsamblarDatos,planDelta:v2PlanDelta,verificar:v2VerificarEquivalencia,SCHEMA:V2_SCHEMA};
