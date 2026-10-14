/* ═══════════════════════════════════════
   §3 — NOVEDADES
   ═══════════════════════════════════════
   Qué versiones nuevas no vio todavía la persona. La pantalla de novedades
   está en 23-ui-herramientas.js; acá solo la cuenta y lo que se guarda. */
const TYPE_LABELS={feature:'Nuevo',improve:'Mejora',fix:'Arreglo',perf:'Más rápido'};

/* Comparar versiones semver: devuelve >0 si a>b, <0 si a<b, 0 si iguales */
function cmpVersion(a,b){
    if(!a)return -1;if(!b)return 1;
    const pa=a.split('.').map(n=>parseInt(n)||0),pb=b.split('.').map(n=>parseInt(n)||0);
    for(let i=0;i<Math.max(pa.length,pb.length);i++){
        const da=pa[i]||0,db=pb[i]||0;
        if(da!==db)return da-db;
    }
    return 0;
}
/* Versiones nuevas que no se vieron ni se descartaron, de los últimos 30 días */
function getNoticiasNoVistas(){
    const last=AppState.datos?.lastSeenVersion||'';
    const dismissed=new Set(AppState.datos?.dismissedVersions||[]);
    const now=Date.now();
    return normalizarChangelog().filter(e=>{
        if(cmpVersion(e.version,last)<=0)return false;
        if(dismissed.has(e.version))return false;
        if(!e.date)return true;
        const d=new Date(e.date+'T00:00:00');
        if(isNaN(d.getTime()))return true;
        return(now-d.getTime())/86400000<=30;
    });
}
function actualizarBadgeNoticias(){
    const badge=$('newsBellBadge');if(!badge)return;
    badge.classList.toggle('hidden',getNoticiasNoVistas().length===0);
}
function marcarVersionVista(){
    const log=normalizarChangelog();
    if(!log.length)return;
    const latest=log[0].version;
    const cur=AppState.datos?.lastSeenVersion||'';
    if(cmpVersion(latest,cur)>0){
        AppState.datos.lastSeenVersion=latest;
        AppState.ui.hayNovedad=false;
        actualizarBadgeNoticias();
        guardaOptimista('update','config','lastSeenVersion');
    }
}
/* Al entrar: si hay una versión que no se vio, el inicio muestra un aviso
   para abrir las novedades. La primera vez en la app no se avisa nada. */
function chequearWhatsNewAlInicio(){
    const log=normalizarChangelog();
    if(!log.length)return;
    const latest=log[0];
    const cur=AppState.datos?.lastSeenVersion||'';
    if(cur&&cmpVersion(latest.version,cur)>0){
        AppState.ui.hayNovedad=true;
    }else if(!cur){
        AppState.datos.lastSeenVersion=latest.version;
    }
    actualizarBadgeNoticias();
}

function ocultarLoading() { $('loadingOverlay')?.classList.add('hidden'); }


/* actualizarVistaDebounced (04) agrupa varias llamadas en un solo cuadro */
let _vistaRAF=0;
