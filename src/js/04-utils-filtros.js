function actualizarVistaDebounced(){if(_vistaRAF)return;_vistaRAF=requestAnimationFrame(()=>{_vistaRAF=0;actualizarVista()})}

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
/* ═══ safeIdTail — corte defensivo de la cola de un ID ═══
   uid() devuelve un Number, pero hay paths donde IDs viejos pueden ser string,
   null, o incluso objetos legacy. Cualquier .slice(-N) directo sobre un ID 
   numérico tira "TypeError: ... .slice is not a function" y rompe el panel
   de diagnóstico. Esta utility convierte a string SIEMPRE y devuelve los 
   últimos N caracteres, o '?' si el input es nulo. */
function safeIdTail(id,n){
    if(id===null||id===undefined)return '?';
    const s=String(id);
    return s.length<=n?s:s.slice(-n);
}
function truncar(n,d=2){if(isNaN(n)||!isFinite(n))return 0;const f=Number(n+'e'+d);return Number(Math.floor(f)+'e-'+d)}
function roundMoney(n,d=2){if(isNaN(n)||!isFinite(n))return 0;const r=Number(Math.round(parseFloat(n+'e'+d))+'e-'+d);return Object.is(r,-0)?0:r}
/* truncUsdt: truncar a 2dp — uso conservador para FIFO, lotes, saldos internos */
function truncUsdt(n){return truncar(n,2)}

/* ═══ v7.2.0 — Quién pagó cuánto en una operación ═══
   Una compra puede pagarse desde una sola cuenta o repartida entre varias. Esa
   pregunta se respondía en diez lugares distintos, cada uno con su propia
   versión de `si tiene aportes... si no...`, y de ahí salieron cuatro fallas en
   una sola semana: el saldo se descontaba a una cuenta que no pagó, el cupo se
   cargaba entero a la principal, la validación pedía el total a una sola y el
   resumen mostraba un saldo negativo imposible.

   Ahora la respuesta es una sola. Devuelve siempre una lista de {banco, monto},
   tenga la operación pago dividido o no, así quien la use no necesita saber la
   diferencia. La comisión bancaria no entra acá: la cobra siempre la cuenta
   principal, y eso lo resuelve quien corresponda. */
function aportesDe(op){
    if(!op)return[];
    if(Array.isArray(op.aportes)&&op.aportes.length){
        return op.aportes
            .filter(a=>a&&a.banco)
            .map(a=>({banco:a.banco,monto:Number(a.monto)||0}));
    }
    return op.banco?[{banco:op.banco,monto:Number(op.monto)||0}]:[];
}

/* Verdadero si el pago se repartió entre varias cuentas */
function esPagoDividido(op){
    return !!(op&&Array.isArray(op.aportes)&&op.aportes.length);
}

/* ═══ v6.9.0 — La comisión configurada, respetando el cero ═══
   Se leía con `comisionPlataforma||0.14`. Ese operador toma el cero como si
   fuera un valor vacío, así que quien tuviera la comisión en 0% veía cómo se le
   reemplazaba por 0,14% cada vez que se guardaba o recalculaba una operación.
   Cero es un porcentaje perfectamente válido: solo se recurre al valor por
   defecto cuando el campo realmente no está definido. */
function comisionConfigurada(moneda){
    const d=(typeof AppState!=='undefined'&&AppState.datos)||{};
    const v=(moneda==='USD')?d.comisionUSD:d.comisionPlataforma;
    return (v===undefined||v===null||!isFinite(v))?0.14:Number(v);
}
/* Binance-matching: compra=round, venta=truncar para la base USDT (monto/tasa) */
function usdtBase(n,tipo){return tipo==='compra'?roundMoney(n,2):truncar(n,2)}
/* v7.3.0 — La suma de la venta se redondea a centésimos. Base y comisión ya
   vienen en centésimos exactos, pero la suma de dos decimales en coma flotante
   a veces da 398,58999…: truncar eso perdía un centavo que nunca existió. */
function usdtNeto(base,com,tipo){return tipo==='compra'?roundMoney(base-com,2):roundMoney(base+com,2)}
/* v5.3.1 — Se convierte a número ANTES de validar. isFinite(null) devuelve
   verdadero en JavaScript (porque null equivale a 0), así que un null se colaba
   por el guardián y hacía fallar el formateo con una excepción; una cadena vacía
   devolvía vacío en vez de cero. Ahora cualquier valor raro se muestra como 0. */
/* v8.0.0 — Un formateador por cantidad de decimales, creado una sola vez.
   toLocaleString arma uno nuevo en cada llamada y la pantalla formatea miles
   de importes: con historial grande eso solo tardaba más que todo el resto. */
const _formateadores={};
function formateador(min,max){
    const k=min+'|'+max;
    return _formateadores[k]||(_formateadores[k]=new Intl.NumberFormat('es-UY',{minimumFractionDigits:min,maximumFractionDigits:max}));
}
function fmtNum(n,d=2){n=Number(n);if(!isFinite(n))n=0;return formateador(d,d).format(n)}
/* Formatear con truncado (conservador) — para mostrar USDT de inventario/lotes */
function fmtTrunc(n,d=2){n=Number(n);if(!isFinite(n))n=0;return formateador(d,d).format(truncar(n,d))}
function fmtTasa(n,mon){
    n=Number(n);if(!isFinite(n))return'0';
    if(mon==='USD'){const s=n.toString(),dec=s.includes('.')?s.split('.')[1].length:0;const d=dec>2?3:2;return formateador(d,d).format(n)}
    return formateador(2,2).format(n);
}
function parsearTasa(v){if(!v)return null;const l=v.toString().replace(',','.').trim();if(!/^\d+(\.\d{1,3})?$/.test(l))return null;const n=parseFloat(l);return isNaN(n)||n<=0?null:n}
function parsearComisionPct(v){if(!v&&v!==0)return null;const l=v.toString().replace(',','.').trim();if(!l||l==='.')return null;if(!/^\d*\.?\d*$/.test(l))return null;const n=parseFloat(l);return isNaN(n)||n<0||n>10?null:n}
/* Leer valor numérico de cualquier input (formato es-UY).
   Reglas: coma presente → dots=miles, comma=decimal.
   Sin coma: dot+3dígitos al final (50.000) → miles; dot+1-2dígitos (42.50) → decimal. */
function pv(id){
    const el=$(id);if(!el)return 0;
    return parseMonto(el.value);
}
/* Mismo criterio aplicado a un texto (lo usa también el pago dividido) */
function parseMonto(texto){
    const v=String(texto??'').trim();if(!v)return 0;
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

function getUTimeStr(){const d=getUDate();return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
function fmtFechaCorta(f){if(!f)return'-';const p=f.split('-');return p.length===3?`${p[2]}/${p[1]}`:f}
/* ═══ v8.1.0 — Varias cuentas por banco, en pesos o en dólares ═══
   Las cuentas de siempre se identifican con el nombre del banco ("Itau") y son
   las de CONFIG.BANCOS. Las que agrega la persona ("Itaú empresa", "Itaú
   dólares") tienen una clave que dice de qué banco son y en qué moneda:
   "Itau_USD_mh3k2a1b". Así, aunque se perdiera su ficha, cada registro que la
   usa sigue sabiendo su banco y su moneda. El nombre que se ve vive en la ficha
   (bancos[clave].nombre); las de siempre también pueden tener uno ("Itaú
   personal"). */
const _BANCO_FIJO=(()=>{const m={};CONFIG.BANCOS.forEach(b=>{m[b.nombre]=b});return m})();
/* 'Itau_USD_mh3k2a1b' → {banco:'Itau',moneda:'USD'}; null si no es una cuenta agregada */
function parteDeClave(n){
    if(typeof n!=='string'||n.indexOf('_')<0)return null;
    const p=n.split('_');
    if(p.length<3)return null;
    const id=p.pop(),moneda=p.pop(),banco=p.join('_');
    if(!id||!_BANCO_FIJO[banco]||(moneda!=='UYU'&&moneda!=='USD'))return null;
    return{banco,moneda};
}
function esCuentaAgregada(n){return!!parteDeClave(n)}
function _bancosGuardados(){return(typeof AppState!=='undefined'&&AppState.datos&&AppState.datos.bancos)||null}
/* El nombre que se pone solo, si la cuenta todavía no tiene uno */
function nombrePorDefecto(banco,moneda){
    const b=_BANCO_FIJO[banco];if(!b)return String(banco||'');
    const n=b.etiqueta||b.nombre;
    return moneda==='USD'&&b.moneda!=='USD'?n+' dólares':n+' 2';
}
const _infoCuentas={};
function getBancoInfo(n){
    const fija=_BANCO_FIJO[n],bs=_bancosGuardados(),bk=bs?bs[n]:null;
    if(fija){
        if(!bk||!bk.nombre)return fija;
        const c=_infoCuentas[n];
        if(c&&c.etiqueta===bk.nombre&&c._de===fija)return c;
        return(_infoCuentas[n]={...fija,etiqueta:bk.nombre,_de:fija});
    }
    const p=parteDeClave(n);
    if(!p)return undefined;
    const base=_BANCO_FIJO[p.banco];
    const etiqueta=(bk&&bk.nombre)||nombrePorDefecto(p.banco,p.moneda);
    const c=_infoCuentas[n];
    if(c&&c.etiqueta===etiqueta)return c;
    return(_infoCuentas[n]={...base,nombre:n,etiqueta,moneda:p.moneda,base:p.banco,agregada:true,_de:base});
}
/* Nombre para mostrar: "Itaú" aunque internamente se guarde "Itau" */
function nombreCuenta(n){if(n==='USDT')return'USDT';const b=getBancoInfo(n);return(b&&(b.etiqueta||b.nombre))||String(n||'')}
/* El banco al que pertenece una cuenta ("Itau" también para "Itau_USD_…") */
function bancoDeCuenta(n){const p=parteDeClave(n);return p?p.banco:n}
/* Todas las cuentas de banco: las de siempre, cada una seguida de las que se
   le agregaron, en el orden en que se crearon. */
function todasLasCuentas(){
    const bs=_bancosGuardados()||{},agregadas={};
    Object.keys(bs).forEach(k=>{const p=parteDeClave(k);if(p)(agregadas[p.banco]=agregadas[p.banco]||[]).push(k)});
    const out=[];
    CONFIG.BANCOS.forEach(b=>{
        out.push(getBancoInfo(b.nombre));
        (agregadas[b.nombre]||[]).sort((x,y)=>{const a=x.split('_').pop(),c=y.split('_').pop();return a.length-c.length||(a<c?-1:a>c?1:0)})
            .forEach(k=>out.push(getBancoInfo(k)));
    });
    return out;
}
/* ¿Este banco tiene más de una cuenta? Entonces en las listas hace falta decir cuál es */
function bancoConVariasCuentas(banco){
    const bs=_bancosGuardados();if(!bs)return false;
    return Object.keys(bs).some(k=>{const p=parteDeClave(k);return p&&p.banco===banco});
}
/* Nombre corto para las listas: "Itaú empresa" → "Empresa"; si no empieza con
   el nombre del banco, el nombre entero */
function nombreCortoCuenta(n){
    const nom=nombreCuenta(n),b=_BANCO_FIJO[bancoDeCuenta(n)];
    const pre=b?(b.etiqueta||b.nombre):'';
    const sin=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
    if(pre&&nom.length>pre.length+1&&sin(nom).startsWith(sin(pre)+' ')){
        const r=nom.slice(pre.length+1).trim();
        return r.charAt(0).toUpperCase()+r.slice(1);
    }
    return nom;
}
/* v4.8.2 FIX SEGURIDAD: la versión anterior (div.textContent → innerHTML) NO escapaba
   comillas. Como escHtml se usa dentro de atributos (data-tag="...", data-banco="..."),
   un texto con `"` rompía el atributo y permitía inyectar atributos/handlers (self-XSS
   con tags o descripciones). Esta versión escapa & < > " ' — segura en texto Y en
   atributos con comillas dobles o simples. Bonus: sin crear un <div> por llamada
   (escHtml corre dentro de loops de render — menos GC en móviles de gama baja). */
const _ESC_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function escHtml(s){return String(s??'').replace(/[&<>"']/g,c=>_ESC_MAP[c])}
function getSym(mon){return mon==='USD'?'US$':'$'}

/* ═══════════════════════════════════════════════════════════════════════════
   FORMATO DE IMPORTES — punto único de verdad (v5.3.1)
   ═══════════════════════════════════════════════════════════════════════════
   Antes cada pantalla resolvía por su cuenta el símbolo de la moneda (8 lugares
   distintos), cuántos decimales lleva una tasa (5 lugares) y cómo se escribe una
   ganancia (7 lugares). Con el tiempo esas copias se separaron: el historial
   archivado terminó mostrando importes sin decimales mientras la lista principal
   los mostraba con dos, y la misma operación se veía distinta según dónde se
   mirara. Estas funciones son ahora el único lugar donde se decide, así que no
   pueden volver a divergir.

   Producen exactamente el mismo texto que producían los cálculos que reemplazan:
   son una unificación, no un cambio de aspecto.                              */

/* Importe con su símbolo: $1.500,00 · US$800,00 */
function fmtMonto(n,moneda){return getSym(moneda)+fmtNum(n)}

/* Tasa PARA MOSTRAR: dos decimales en pesos, tres en dólares.
   Distinta a fmtTasa(), que es para los campos EDITABLES: ahí los decimales se
   adaptan al valor para no escribir "40,500" cuando el usuario tipeó 40,5.     */
function fmtTasaMon(n,moneda){return getSym(moneda)+fmtNum(n,moneda==='USD'?3:2)}


