/* ═══════════════════════════════════════════════════════════════════════════
   §14 — ARRANQUE DE LA PANTALLA (v8.0.0)
   ═══════════════════════════════════════════════════════════════════════════
   Entrada con usuario y contraseña, cierre de sesión, la revisión de cada
   minuto (renovación del cupo y cambio de día) y el cartel que tapa la
   pantalla durante los procesos largos. Los botones de la app se conectan
   solos con data-a (18-ui-base.js). */

/* Cerrar sesión: se sube lo pendiente y se vacía todo lo del usuario saliente,
   para que otra persona que entre en el mismo teléfono no vea nada suyo. La
   pregunta de confirmación la hace la pantalla de Más. */
function cerrarSesion(){
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
        /* La pantalla vuelve a cero */
        cerrarTodasLasCapas();
        Object.assign(AppState.ui.registro,{tipo:'todo',periodo:'mes',cuenta:'',buscar:'',dia:'',categoria:null,limite:60});
        AppState.ui.verificacion=null;AppState.ui.hayNovedad=false;AppState.ui.todosLosLotes=false;
        AppState.ui._noticiasInicializadas=false;
        irATab('inicio',{sinHistoria:true});
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
    try{history.scrollRestoration='manual'}catch(_){}

    /* ─── Entrada ─── */
    const verRegistro=reg=>{
        $('tabLogin').setAttribute('aria-selected',String(!reg));
        $('tabRegister').setAttribute('aria-selected',String(reg));
        $('loginForm').classList.toggle('hidden',reg);
        $('registerForm').classList.toggle('hidden',!reg);
        $('authError').classList.remove('show');
    };
    $('tabLogin').addEventListener('click',()=>verRegistro(false));
    $('tabRegister').addEventListener('click',()=>verRegistro(true));
    const errorAuth=t=>{const e=$('authError');e.textContent=t;e.classList.add('show')};
    $('loginForm').addEventListener('submit',async e=>{
        e.preventDefault();$('authError').classList.remove('show');
        const u=$('loginUser').value.trim(),p=$('loginPass').value,b=$('loginBtn');
        if(!u||!p){errorAuth('Escribí tu usuario y tu contraseña.');return}
        b.disabled=true;b.textContent='Entrando…';
        try{await AppState.auth.signInWithEmailAndPassword(userToEmail(u),p)}
        catch(er){
            errorAuth(er&&er.code==='auth/network-request-failed'?'No hay conexión a internet.':'El usuario o la contraseña no coinciden.');
            b.disabled=false;b.textContent='Entrar';
        }
    });
    $('registerForm').addEventListener('submit',async e=>{
        e.preventDefault();$('authError').classList.remove('show');
        const u=$('regUser').value.trim(),p=$('regPass').value,p2=$('regPassConfirm').value;
        if(!/^[a-zA-Z0-9_-]{3,20}$/.test(u)){errorAuth('El usuario tiene que tener de 3 a 20 letras, números o guiones.');return}
        if(p.length<6){errorAuth('La contraseña necesita por lo menos 6 caracteres.');return}
        if(p!==p2){errorAuth('Las dos contraseñas no coinciden.');return}
        const b=$('registerBtn');b.disabled=true;b.textContent='Creando la cuenta…';
        try{await AppState.auth.createUserWithEmailAndPassword(userToEmail(u),p)}
        catch(er){
            errorAuth(er&&er.code==='auth/email-already-in-use'?'Ese usuario ya existe. Elegí otro.':
                      er&&er.code==='auth/network-request-failed'?'No hay conexión a internet.':'No se pudo crear la cuenta. Probá de nuevo.');
            b.disabled=false;b.textContent='Crear cuenta';
        }
    });

    instalarErrorBoundary();
    irATab('inicio',{sinHistoria:true});
    inicializarFirebase();

    /* Revisión cada minuto, solo con la app a la vista (no despierta el
       teléfono en segundo plano): renovación del cupo y cambio de día. */
    (function revisionPorMinuto(){
        let intervalo=null,ultimoDia='';
        function tick(){
            if(!AppState.currentUser||document.hidden)return;
            revisarRenovacionCupos();
            const hoy=getUDateStr();
            if(hoy!==ultimoDia){ultimoDia=hoy;actualizarVista()}
        }
        function empezar(){if(!intervalo)intervalo=setInterval(tick,60000)}
        function parar(){if(intervalo){clearInterval(intervalo);intervalo=null}}
        empezar();
        document.addEventListener('visibilitychange',()=>{
            if(document.hidden)parar();
            else{empezar();tick()}
        });
    })();
});

/* ═══════════════════════════════════════════════════════════════════════════
   CARTEL DE PROCESO — lo usan el archivado (15), la migración y la subida
   total (16): tapa la pantalla mientras corre un proceso largo y muestra en
   qué paso va.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
function _ensureRecoveryOverlay(){
    let el=document.getElementById('recoveryOverlay');
    if(el)return el;
    el=document.createElement('div');
    el.id='recoveryOverlay';
    el.className='proceso';
    el.setAttribute('role','alertdialog');
    el.setAttribute('aria-modal','true');
    el.setAttribute('aria-labelledby','recoveryTitle');
    el.innerHTML='<div class="proceso-caja">'+
        '<h2 id="recoveryTitle">Procesando tus datos</h2>'+
        '<p class="sub" id="recoverySubtitle">No cierres la app. Puede tardar hasta un minuto.</p>'+
        '<div class="rueda" id="recoverySpinner" aria-hidden="true"></div>'+
        '<div class="fase" id="recoveryPhase" aria-live="polite">Empezando…</div>'+
        '<div class="meta" id="recoveryMeta"></div>'+
        '<div class="acciones hidden" id="recoveryActions"></div></div>';
    document.body.appendChild(el);
    return el;
}
function _setRecoveryPhase(text){const p=document.getElementById('recoveryPhase');if(p)p.textContent=text}
function _setRecoveryMeta(intento,maximo){
    const m=document.getElementById('recoveryMeta');
    if(m)m.textContent='Intento '+intento+' de '+maximo+(navigator.onLine?'':', sin conexión');
}
function _hideRecoveryOverlay(){const el=document.getElementById('recoveryOverlay');if(el)el.remove()}
function _setRecoveryError(titulo,desc,acciones){
    const el=_ensureRecoveryOverlay();
    el.classList.add('con-error');
    const t=document.getElementById('recoveryTitle');if(t)t.textContent=titulo;
    const s=document.getElementById('recoverySubtitle');if(s)s.textContent='Elegí cómo seguir.';
    _setRecoveryPhase(desc);
    const m=document.getElementById('recoveryMeta');if(m)m.textContent='';
    const ac=document.getElementById('recoveryActions');
    if(ac&&Array.isArray(acciones)){
        ac.classList.remove('hidden');ac.innerHTML='';
        acciones.forEach((a,i)=>{
            const b=document.createElement('button');
            b.type='button';b.className='btn'+(i===0?'':' gris');
            b.textContent=a.label;
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
