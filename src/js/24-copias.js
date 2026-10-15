/* ═══════════════════════════════════════════════════════════════════════════
   §24 — COPIAS AUTOMÁTICAS (v8.0.1)
   ═══════════════════════════════════════════════════════════════════════════
   La app guarda en este teléfono una copia de todos tus movimientos y se
   quedan las 3 últimas, separadas por al menos 30 minutos. La más nueva se
   mantiene al día mientras usás la app; cada 30 minutos se empieza otra.
   También se hace una al abrir la app (antes de hablar con el servidor) y al
   dejarla en segundo plano.

   Recuperar AGREGA lo que falta: no borra ni cambia nada de lo que ya tenés.
   No cuenta como faltante lo que borraste vos (está en Eliminados) ni lo que
   pasó a un mes archivado.

   Además, cada copia nueva se compara con la anterior. Si desapareció algo
   que vos no borraste, esa copia anterior queda guardada 7 días (no la pisa
   ninguna otra) y el inicio avisa con un botón para recuperarlo.

   Las copias son de cada usuario: se guardan con su identificador y solo se
   ofrecen las de quien inició sesión. */

const COPIAS_MAX=3;
const COPIAS_ESPACIO_MS=30*60000;
const COPIAS_PROTEGIDA_MS=7*86400000;
/* Una transferencia que pasa a conversión cambia de lista pero es la misma */
const _GRUPO_COPIA={operaciones:'op',movimientos:'mv',transferencias:'tr',conversiones:'tr',ajustesSaldo:'aj',lotes:'lt'};

function _claveIndiceCopias(){return AppState.currentUser?'p2p_copias_'+AppState.currentUser.uid:null}
function _clavePayloadCopia(id){return'p2p_copia_'+AppState.currentUser.uid+'_'+id}
function listaCopias(){
    const k=_claveIndiceCopias();if(!k)return[];
    try{const l=JSON.parse(localStorage.getItem(k)||'[]');return Array.isArray(l)?l.filter(c=>c&&c.id):[]}catch(_){return[]}
}
function _guardarListaCopias(l){
    const k=_claveIndiceCopias();if(!k)return;
    try{localStorage.setItem(k,JSON.stringify(l))}catch(_){}
}
function borrarCopias(){
    if(!AppState.currentUser)return;
    listaCopias().forEach(c=>{try{localStorage.removeItem(_clavePayloadCopia(c.id))}catch(_){}});
    try{localStorage.removeItem(_claveIndiceCopias())}catch(_){}
    AppState.ui.faltanCopia=null;
}

/* ─── Qué guarda una copia: los registros, sin lo que se recalcula ───────── */
function _contenidoCopia(d){
    const limpio=r=>{const x=JSON.parse(JSON.stringify(r));delete x._syncState;delete x.consumedLots;delete x.costoUsdt;delete x.ganancia;return x};
    const c={v:1,ev:{}};
    ENTIDADES_REGISTRO.forEach(e=>{c.ev[e]=(d[e]||[]).filter(Boolean).map(limpio)});
    c.lotes=(d.lotes||[]).filter(l=>l&&l.manual&&!l.carryover).map(limpio);
    return c;
}
function _contarContenido(c){
    const n={total:0};
    ENTIDADES_REGISTRO.forEach(e=>{n[e]=((c.ev||{})[e]||[]).length;n.total+=n[e]});
    n.lotes=(c.lotes||[]).length;n.total+=n.lotes;
    return n;
}
/* Firma corta del contenido, para no guardar dos veces lo mismo */
function _firmaTexto(s){
    let h=0x811c9dc5;
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}
    return s.length.toString(36)+'.'+h.toString(36);
}

/* ─── Compresión (si el teléfono la tiene) ───────────────────────────────── */
function _aBase64(u8){let s='';const T=0x8000;for(let i=0;i<u8.length;i+=T)s+=String.fromCharCode.apply(null,u8.subarray(i,i+T));return btoa(s)}
function _deBase64(b){const s=atob(b);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u}
async function _comprimirCopia(txt){
    if(typeof CompressionStream==='undefined')return{z:'json',s:txt};
    try{
        const buf=await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        return{z:'gz',s:_aBase64(new Uint8Array(buf))};
    }catch(_){return{z:'json',s:txt}}
}
async function _descomprimirCopia(z,s){
    if(z!=='gz')return s;
    return await new Response(new Blob([_deBase64(s)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
async function leerCopia(meta){
    if(!meta||!AppState.currentUser)return null;
    const raw=localStorage.getItem(_clavePayloadCopia(meta.id));
    if(!raw)return null;
    return JSON.parse(await _descomprimirCopia(meta.z,raw));
}

/* ─── Lo que hay en una copia y falta en la app ──────────────────────────── */
function faltantesDe(contenido){
    const d=AppState.datos||{};
    const hay=new Set();
    ENTIDADES_REGISTRO.forEach(e=>(d[e]||[]).forEach(r=>{if(r)hay.add(_GRUPO_COPIA[e]+':'+r.id)}));
    (d.lotes||[]).forEach(l=>{if(l)hay.add('lt:'+l.id)});
    const borrados=new Set(eliminadosLista().filter(x=>x&&x.r).map(x=>(_GRUPO_COPIA[x.e]||x.e)+':'+x.r.id));
    const arch=ultimoMesArchivado();
    const out=[];
    ENTIDADES_REGISTRO.forEach(e=>(((contenido||{}).ev||{})[e]||[]).forEach(r=>{
        if(!r)return;
        const k=_GRUPO_COPIA[e]+':'+r.id;
        if(hay.has(k)||borrados.has(k))return;
        if(arch&&String(r.fecha||'').slice(0,7)<=arch)return;
        hay.add(k);out.push({ent:e,rec:r});
    }));
    ((contenido||{}).lotes||[]).forEach(l=>{
        if(!l)return;
        const k='lt:'+l.id;
        if(hay.has(k)||borrados.has(k))return;
        hay.add(k);out.push({ent:'lotes',rec:l});
    });
    return out;
}

/* ─── Hacer la copia ─────────────────────────────────────────────────────── */
/* Si no entra en el teléfono, se libera la copia más vieja (primero las no
   protegidas) y se vuelve a intentar. */
function _escribirPayloadCopia(id,s,lista){
    for(let intento=0;intento<COPIAS_MAX+1;intento++){
        try{localStorage.setItem(_clavePayloadCopia(id),s);return true}
        catch(e){
            const libres=lista.filter(c=>c.id!==id);
            const victima=[...libres].reverse().find(c=>!c.protegida)||libres[libres.length-1];
            if(!victima)return false;
            try{localStorage.removeItem(_clavePayloadCopia(victima.id))}catch(_){}
            lista.splice(lista.indexOf(victima),1);
        }
    }
    return false;
}
function _recortarCopias(lista){
    while(lista.length>COPIAS_MAX){
        const i=(()=>{for(let j=lista.length-1;j>0;j--)if(!lista[j].protegida)return j;return lista.length-1})();
        const [fuera]=lista.splice(i,1);
        try{localStorage.removeItem(_clavePayloadCopia(fuera.id))}catch(_){}
    }
    return lista;
}
let _copiaEnCurso=null;
function copiaAutomatica(motivo,o){
    if(_copiaEnCurso)return _copiaEnCurso;
    _copiaEnCurso=_hacerCopia(motivo,o||{}).finally(()=>{_copiaEnCurso=null});
    return _copiaEnCurso;
}
async function _hacerCopia(motivo,o){
    if(!AppState.currentUser||!AppState.datos||esDatosVacios(AppState.datos))return null;
    try{
        const lista=listaCopias();
        const ahora=Date.now();
        lista.forEach(c=>{if(c.protegida&&c.protegida<ahora){delete c.protegida;delete c.faltaron}});
        const contenido=_contenidoCopia(AppState.datos);
        const txt=JSON.stringify(contenido);
        const firma=_firmaTexto(txt);
        const ultima=lista[0];
        if(ultima&&ultima.firma===firma&&!o.nueva){_guardarListaCopias(lista);return null}
        /* ¿Desapareció algo de la última copia sin que lo borraras? */
        if(ultima&&!ultima.protegida){
            try{
                const prev=await leerCopia(ultima);
                const f=prev?faltantesDe(prev):[];
                if(f.length){
                    ultima.protegida=ahora+COPIAS_PROTEGIDA_MS;ultima.faltaron=f.length;
                    _avisarFaltantes(f.length,ultima);
                }
            }catch(_){}
        }
        const reemplazar=!!(ultima&&!ultima.protegida&&!o.nueva&&ahora-(ultima.creada||ultima.ts)<COPIAS_ESPACIO_MS);
        const {z,s}=await _comprimirCopia(txt);
        const meta={id:reemplazar?ultima.id:ahora.toString(36),creada:reemplazar?(ultima.creada||ultima.ts):ahora,ts:ahora,
                    firma,z,n:_contarContenido(contenido),motivo:motivo||''};
        if(!_escribirPayloadCopia(meta.id,s,lista))return null;
        if(reemplazar)lista[0]=meta;else lista.unshift(meta);
        _guardarListaCopias(_recortarCopias(lista));
        return meta;
    }catch(e){console.warn('[P2P] copia automática:',e&&e.message);return null}
}

/* ─── Revisión al abrir: lo que trajo el servidor contra la última copia ─── */
function _avisarFaltantes(n,meta){
    AppState.ui.faltanCopia={n,id:meta.id,ts:meta.ts};
    if(AppState.ui.tab==='inicio'&&typeof pintarTab==='function')pintarTab();
}
async function revisarContraCopias(){
    if(_copiaEnCurso){try{await _copiaEnCurso}catch(_){}}
    const lista=listaCopias();if(!lista.length)return;
    const ultima=lista[0];
    const prev=await leerCopia(ultima);if(!prev)return;
    let f=faltantesDe(prev);
    if(f.length){
        /* Un borrado hecho en otro dispositivo puede llegar un instante antes
           que su anotación en Eliminados: se mira de nuevo antes de avisar */
        await new Promise(r=>setTimeout(r,4000));
        f=faltantesDe(prev);
    }
    if(!f.length){
        if(AppState.ui.faltanCopia&&AppState.ui.faltanCopia.id===ultima.id){AppState.ui.faltanCopia=null;if(AppState.ui.tab==='inicio')pintarTab()}
        return;
    }
    ultima.protegida=Date.now()+COPIAS_PROTEGIDA_MS;ultima.faltaron=f.length;
    _guardarListaCopias(lista);
    _avisarFaltantes(f.length,ultima);
}

/* ─── Recuperar: se agrega lo que falta, sin tocar lo demás ──────────────── */
async function recuperarDeCopia(id){
    const meta=listaCopias().find(c=>c.id===id);
    if(!meta)return{ok:false,error:'Esa copia ya no está.'};
    let cont;
    try{cont=await leerCopia(meta)}catch(_){cont=null}
    if(!cont)return{ok:false,error:'No se pudo leer la copia.'};
    const f=faltantesDe(cont);
    if(!f.length){AppState.ui.faltanCopia=null;return{ok:true,n:0}}
    const t=new Date().toISOString();
    const cambios=[];
    f.forEach(({ent,rec})=>{
        const r=JSON.parse(JSON.stringify(rec));
        r.cambios=[{t,c:[{f:'copia',a:'',d:''}]},...normalizarCambios(r.cambios)].slice(0,CAMBIOS_MAX);
        if(ent==='lotes')AppState.datos.lotes.push({...r,manual:true,disponible:r.cantidad});
        else _ponerEnLista(ent,r);
        cambios.push({tipo:'create',entidad:ent,id:r.id});
    });
    confirmarCambios(cambios);
    AppState.ui.faltanCopia=null;
    return{ok:true,n:f.length};
}

/* ─── Cuándo se hacen ────────────────────────────────────────────────────── */
/* Solo con los datos completos: con la foto del servidor a medio cargar, la
   copia saldría con menos cosas. */
function _datosListosParaCopia(){
    return AppState.currentUser&&AppState.datos&&typeof _v2EventosOk!=='undefined'&&_v2EventosOk&&!_v2EsperandoServidor;
}
setInterval(()=>{
    if(document.visibilityState!=='visible'||!_datosListosParaCopia())return;
    copiaAutomatica('cada minuto');
},60000);
document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'&&_datosListosParaCopia())copiaAutomatica('segundo plano');
});
