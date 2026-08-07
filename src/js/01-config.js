/* ╔═══════════════════════════════════════════════════════════╗
   ║  REGISTRO P2P — Código refactorizado                     ║
   ║  • Estado centralizado (AppState)                        ║
   ║  • Sin eventos inline (event delegation)                 ║
   ║  • Funciones de DOM centralizadas                        ║
   ║  • Paginación genérica reutilizable                      ║
   ║  • FIFO encapsulado                                      ║
   ╚═══════════════════════════════════════════════════════════╝ */
'use strict';

/* ═══════════════════════════════════════
   §1 — CONFIGURACIÓN
   ═══════════════════════════════════════ */
/* ═══ Logos embebidos (base64) v4.7.51 — sin dependencia externa ═══
   Optimizados a 96px. Reemplazan emojis/texto plano en tarjetas de saldo.
   Robustez: no dependen de Wikimedia ni de ninguna CDN. */
const LOGO_USDT='data:image/png;base64,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';
const LOGO_ITAU='data:image/png;base64,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';
const LOGO_MP='data:image/png;base64,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';
const _BANK_LOGOS={'Itau':LOGO_ITAU,'Itaú':LOGO_ITAU,'Mercado Pago':LOGO_MP,'MercadoPago':LOGO_MP};
function _bancoLogoImg(nombre,size){
    const src=_BANK_LOGOS[nombre];
    if(!src)return '';
    return `<img src="${src}" alt="" class="banco-logo-img" style="width:${size||20}px;height:${size||20}px;object-fit:contain;border-radius:5px;vertical-align:middle;flex:0 0 auto" loading="lazy" onerror="this.style.display='none'">`;
}

const CONFIG = {
    firebase: {apiKey:"AIzaSyC5GPlXKziT4XdGpcdUR_gtnQE5RIrricw",authDomain:"binancp2p-f831f.firebaseapp.com",projectId:"binancp2p-f831f",storageBucket:"binancp2p-f831f.firebasestorage.app",messagingSenderId:"118313786206",appId:"1:118313786206:web:a964400f85dac298a78dcf"},
    /* ═══════════════════════════════════════════════════════════════════════
     * 📌 VERSION BUMP POLICY — REGLA OBLIGATORIA
     * ═══════════════════════════════════════════════════════════════════════
     * Toda modificación visible, funcional o estructural DEBE incrementar
     * APP_VERSION siguiendo semantic versioning (MAJOR.MINOR.PATCH):
     *
     *   PATCH (x.x.+1) → fixes de bugs, micro-ajustes de UI, tweaks de texto,
     *                    ajustes de espaciado, correcciones de cálculo aisladas.
     *   MINOR (x.+1.0) → features nuevas, nuevos módulos o pantallas,
     *                    rediseños de UI sustanciales, nuevos flujos.
     *   MAJOR (+1.0.0) → cambios que rompen datos/estructura en Firebase,
     *                    migraciones no retrocompatibles, redesign integral.
     *
     * ⚠️ ANTES DE CADA COMMIT: bumpear APP_VERSION y agregar entrada en CHANGELOG.
     * ⚠️ NO DEJAR la versión desactualizada — la ve el usuario en "Configuración".
     * ═══════════════════════════════════════════════════════════════════════ */
    APP_VERSION: '5.3.3',
    POR_PAGINA: 10,
    EMAIL_DOMAIN: '@p2p-tracker.app',
    COOLDOWN_MS: 300,
    BANCOS: [
        {nombre:'Santander',moneda:'UYU',color:'#ec0000'},
        {nombre:'BBVA',moneda:'UYU',color:'#004481'},
        {nombre:'Itau',moneda:'UYU',especial:'itau',color:'#ef6c00'},
        {nombre:'Scotiabank',moneda:'UYU',color:'#ec111a'},
        {nombre:'BROU',moneda:'UYU',color:'#003087'},
        {nombre:'Prex',moneda:'UYU',color:'#6d28d9'},
        {nombre:'OCA',moneda:'UYU',color:'#005baa'},
        {nombre:'Mercado Pago',moneda:'UYU',color:'#009ee3'},
        {nombre:'Midinero',moneda:'UYU',color:'#00b460'},
        {nombre:'Zelle',moneda:'USD',color:'#6c1cd3'},
        {nombre:'Zinli',moneda:'USD',color:'#00c28e'},
        {nombre:'Skrill',moneda:'USD',color:'#862165'}
    ]
};

/* ════════════════════════════════════════════════════════════════════════════
   §WIRE-COMPRESSION v4.7.63 — compresión de payload para Firestore
   ════════════════════════════════════════════════════════════════════════════
   PROBLEMA: el doc remoto llegó a 951 KB (límite duro de Firestore es 1 MB).
   Síntomas reales en producción: resource-exhausted, write stream exhausted,
   Firebase client terminated, retries acumulados, rollback de versión.
   
   SOLUCIÓN: codificar campos repetitivos en el WIRE (lo que viaja a/desde
   Firestore). EN MEMORIA la app sigue trabajando con el formato expandido —
   render, FIFO, splits, validaciones, todo intacto. SOLO cambia lo que se
   persiste remotamente.
   
   AHORROS MEDIDOS sobre data real del usuario (3564 ops, backup verificado):
     • tipo (compra/venta)     → t (0/1)       ahorro ~32 KB
     • banco (string)          → bk (int)      ahorro ~52 KB  
     • moneda (UYU/USD)        → m (0/1)       ahorro ~46 KB
     • timestamp (regenerable) → eliminar      ahorro ~136 KB
     • comisionPct condicional → solo si ≠def  ahorro ~63 KB
     TOTAL proyectado: ~329 KB → 951 → ~622 KB (35% reducción)
   
   ARQUITECTURA:
     • Doc remoto tiene flag `_wireFormat: 'v1'` cuando está comprimido
     • Al recibir snapshot: si wireFormat==='v1' → decodificar a memoria
     • Al guardar: comprimir copia de memoria → escribir
     • MEMORIA siempre tiene formato expandido (UI, lógica intacta)
     • Compatible con docs viejos: si no hay `_wireFormat`, leer como legacy
   ════════════════════════════════════════════════════════════════════════════ */

/* ─── Mapas de codificación ─────────────────────────────────────────────────
   Decisión: los IDs son ESTABLES y nunca se reordenan. Agregar nuevo banco al
   final con nuevo ID. NUNCA cambiar el ID de uno existente o se rompe la
   decodificación de data histórica.
   Los nombres provienen de CONFIG.BANCOS (los 12 oficiales) + "Mercado Pago"
   como caso especial. Si un banco no está en el mapa, fallback: guardar string
   literal con prefijo "$" para distinguirlo. */
const WIRE_TIPO_TO_INT={'compra':0,'venta':1};
const WIRE_TIPO_FROM_INT={0:'compra',1:'venta'};

const WIRE_MONEDA_TO_INT={'UYU':0,'USD':1};
const WIRE_MONEDA_FROM_INT={0:'UYU',1:'USD'};

/* Banco map: derivado de CONFIG.BANCOS en orden fijo. Si en el futuro se
   agregan bancos, van al final manteniendo IDs estables de los anteriores. */
const WIRE_BANCO_TO_INT=(()=>{
    const m={};
    CONFIG.BANCOS.forEach((b,i)=>{m[b.nombre]=i});
    return m;
})();
const WIRE_BANCO_FROM_INT=(()=>{
    const m={};
    CONFIG.BANCOS.forEach((b,i)=>{m[i]=b.nombre});
    return m;
})();

/* Comisión por defecto: el 95.51% de las ops tienen exactamente 0.14. Para
   esas ops, omitimos el campo del payload remoto (se asume default al leer).
   Solo se persiste cuando difiere. Ahorro real: ~63 KB. */
const WIRE_DEFAULT_COMISION_PCT=0.14;
/* Tolerancia para comparación de comisionPct (los floats no siempre son
   exactamente 0.14 después de round-trip JSON). Si difiere por menos de esto,
   se considera "default" y se omite. */
const WIRE_COMISION_PCT_EPS=0.0001;

/* Identificador del formato. Cambiar este string solo si se rompe
   compatibilidad con docs ya migrados. */
const WIRE_FORMAT_VERSION='v1';

/* ─── Codificación de una operación (memoria → wire) ─────────────────────────
   Convierte una op del formato expandido (interno) al formato comprimido (wire).
   No muta el original — devuelve copia. */
function _compressOpForWire(op){
    if(!op||typeof op!=='object')return op;
    const out={};
    /* id: string, siempre */
    if(op.id!==undefined)out.id=op.id;
    /* fecha + hora: strings cortas, no se comprimen (ya son chicas) */
    if(op.fecha!==undefined)out.f=op.fecha;
    if(op.hora!==undefined)out.h=op.hora;
    /* tipo → t (enum int) */
    if(op.tipo!==undefined){
        const v=WIRE_TIPO_TO_INT[op.tipo];
        if(v!==undefined)out.t=v;
        else out.tipo=op.tipo; /* fallback: tipo desconocido — guardar literal */
    }
    /* banco → bk (enum int) o bkn (literal si no está en map) */
    if(op.banco!==undefined){
        const v=WIRE_BANCO_TO_INT[op.banco];
        if(v!==undefined)out.bk=v;
        else out.bkn=op.banco; /* fallback: banco custom no en CONFIG */
    }
    /* moneda → m (enum int) */
    if(op.moneda!==undefined){
        const v=WIRE_MONEDA_TO_INT[op.moneda];
        if(v!==undefined)out.m=v;
        else out.moneda=op.moneda;
    }
    /* monto, tasa, usdt: numbers, no se comprimen */
    if(op.monto!==undefined)out.mo=op.monto;
    if(op.tasa!==undefined)out.ta=op.tasa;
    if(op.usdt!==undefined)out.u=op.usdt;
    if(op.comisionBanco!==undefined&&op.comisionBanco!==0)out.cb=op.comisionBanco;
    /* comisionPct: solo si difiere del default. El receptor asume default si falta. */
    if(op.comisionPct!==undefined){
        const diff=Math.abs(op.comisionPct-WIRE_DEFAULT_COMISION_PCT);
        if(diff>WIRE_COMISION_PCT_EPS)out.cp=op.comisionPct;
        /* si es default, NO se incluye — ahorra ~14 bytes por op default */
    }
    /* aportes (split): mantener tal cual, los bancos internos se codifican
       igual que arriba pero como subobjetos. Es array chico (≤5 entradas
       típicamente), el ahorro de comprimirlos no compensa la complejidad. */
    if(Array.isArray(op.aportes))out.ap=op.aportes;
    /* timestamp: ELIMINADO del wire — se regenera al decodificar desde fecha+hora.
       Es campo derivable (no fuente de verdad). Ahorro ~136 KB. */
    /* Cualquier OTRO campo: copiar tal cual con prefijo "x_" para no chocar
       con los keys cortos del formato comprimido. Ej: notas, _editadoEn, etc.
       Defensivo: si en el futuro se agregan campos, se preservan. */
    Object.keys(op).forEach(k=>{
        if(['id','fecha','hora','tipo','banco','moneda','monto','tasa','usdt',
            'comisionBanco','comisionPct','aportes','timestamp',
            'consumedLots','ganancia','comisionPlataforma','_syncState'].includes(k))return;
        out['x_'+k]=op[k];
    });
    return out;
}

/* ─── Decodificación de una operación (wire → memoria) ───────────────────────
   Inversa de _compressOpForWire. Reconstruye el formato expandido para que la
   app trabaje en memoria como siempre.
   
   ROBUSTEZ: si recibe un objeto ya en formato viejo (sin las claves cortas),
   lo devuelve tal cual. Esto permite leer docs no migrados sin error. */
function _decompressOpFromWire(op){
    if(!op||typeof op!=='object')return op;
    /* Detección: si tiene `tipo` (string) o `banco` (string), es formato viejo.
       Si tiene `t` (number) o `bk` (number), es formato nuevo.
       Si tiene ambos (corrupción), gana el viejo (más conservador). */
    const esViejo=(typeof op.tipo==='string')||(typeof op.banco==='string');
    if(esViejo)return op; /* legacy: no tocar */
    const out={};
    if(op.id!==undefined)out.id=op.id;
    if(op.f!==undefined)out.fecha=op.f;
    if(op.h!==undefined)out.hora=op.h;
    if(op.t!==undefined){
        const v=WIRE_TIPO_FROM_INT[op.t];
        if(v!==undefined)out.tipo=v;
    }else if(op.tipo!==undefined)out.tipo=op.tipo;
    if(op.bk!==undefined){
        const v=WIRE_BANCO_FROM_INT[op.bk];
        if(v!==undefined)out.banco=v;
    }else if(op.bkn!==undefined)out.banco=op.bkn;
    else if(op.banco!==undefined)out.banco=op.banco;
    if(op.m!==undefined){
        const v=WIRE_MONEDA_FROM_INT[op.m];
        if(v!==undefined)out.moneda=v;
    }else if(op.moneda!==undefined)out.moneda=op.moneda;
    if(op.mo!==undefined)out.monto=op.mo;
    if(op.ta!==undefined)out.tasa=op.ta;
    if(op.u!==undefined)out.usdt=op.u;
    if(op.cb!==undefined)out.comisionBanco=op.cb;
    else out.comisionBanco=0;
    /* comisionPct: si falta, default. Si existe, usar el valor explícito. */
    if(op.cp!==undefined)out.comisionPct=op.cp;
    else out.comisionPct=WIRE_DEFAULT_COMISION_PCT;
    if(Array.isArray(op.ap))out.aportes=op.ap;
    /* Reconstrucción de timestamp desde fecha + hora.
       Formato target: "YYYY-MM-DDTHH:MM:SS" (sin TZ, igual al original).
       Si falta hora, usar "00:00:00". */
    if(out.fecha){
        const horaCompleta=out.hora?(out.hora.length===5?out.hora+':00':out.hora):'00:00:00';
        out.timestamp=out.fecha+'T'+horaCompleta;
    }
    /* Restaurar campos "x_" → su nombre original */
    Object.keys(op).forEach(k=>{
        if(k.startsWith('x_'))out[k.substring(2)]=op[k];
    });
    return out;
}

/* ─── Codificación de arrays completos ──────────────────────────────────────
   Aplicado a operaciones. movimientos/transferencias/lotes/conversiones se
   dejan SIN comprimir por ahora — su volumen acumulado es bajo y el riesgo
   de bug por tocar más campos no compensa el ahorro marginal. */
function _compressOpsArrayForWire(arr){
    if(!Array.isArray(arr))return arr;
    return arr.map(_compressOpForWire);
}
function _decompressOpsArrayFromWire(arr){
    if(!Array.isArray(arr))return arr;
    return arr.map(_decompressOpFromWire);
}

/* ─── Detección de formato del doc remoto ───────────────────────────────────
   El doc remoto lleva `_wireFormat: 'v1'` cuando está comprimido.
   Si no lo tiene (o es null/undefined), es formato legacy. */
function _isWireCompressed(remoteDoc){
    return remoteDoc&&remoteDoc._wireFormat===WIRE_FORMAT_VERSION;
}

/* ─── Verificación de integridad: comparar sumas antes/después de migración ──
   Pre-migración: snapshot de sumas críticas del estado actual.
   Post-migración: re-calcular y comparar. Si difieren, ABORTAR. */
function _capturarSnapshotIntegridad(datos){
    const snap={
        countOps:(datos.operaciones||[]).length,
        countMovs:(datos.movimientos||[]).length,
        countTransfs:(datos.transferencias||[]).length,
        countLotes:(datos.lotes||[]).length,
        sumMontoUYU:0,sumUsdt:0,sumComisionPct:0,
        sumMontoVentas:0,sumMontoCompras:0,
        primeraOpId:null,ultimaOpId:null,
        saldosBancos:{}
    };
    const ops=datos.operaciones||[];
    ops.forEach((op,i)=>{
        if(i===0)snap.primeraOpId=op.id;
        snap.ultimaOpId=op.id;
        if(op.moneda==='UYU'||!op.moneda)snap.sumMontoUYU+=(Number(op.monto)||0);
        snap.sumUsdt+=(Number(op.usdt)||0);
        snap.sumComisionPct+=(Number(op.comisionPct)||0);
        if(op.tipo==='venta')snap.sumMontoVentas+=(Number(op.monto)||0);
        else if(op.tipo==='compra')snap.sumMontoCompras+=(Number(op.monto)||0);
    });
    /* Saldos de bancos: copia directa */
    if(datos.bancos&&typeof datos.bancos==='object'){
        Object.entries(datos.bancos).forEach(([nombre,bk])=>{
            if(bk&&typeof bk.saldo==='number')snap.saldosBancos[nombre]=bk.saldo;
        });
    }
    return snap;
}

function _compararSnapshotsIntegridad(antes,despues){
    const diffs=[];
    /* Counts: deben ser exactos */
    if(antes.countOps!==despues.countOps)diffs.push(`countOps ${antes.countOps}→${despues.countOps}`);
    if(antes.countMovs!==despues.countMovs)diffs.push(`countMovs ${antes.countMovs}→${despues.countMovs}`);
    if(antes.countTransfs!==despues.countTransfs)diffs.push(`countTransfs ${antes.countTransfs}→${despues.countTransfs}`);
    if(antes.countLotes!==despues.countLotes)diffs.push(`countLotes ${antes.countLotes}→${despues.countLotes}`);
    /* Sumas: tolerancia de 0.01 por roundeos */
    const EPS=0.01;
    if(Math.abs(antes.sumMontoUYU-despues.sumMontoUYU)>EPS)diffs.push(`sumMontoUYU ${antes.sumMontoUYU.toFixed(2)}→${despues.sumMontoUYU.toFixed(2)}`);
    if(Math.abs(antes.sumUsdt-despues.sumUsdt)>EPS)diffs.push(`sumUsdt ${antes.sumUsdt.toFixed(2)}→${despues.sumUsdt.toFixed(2)}`);
    if(Math.abs(antes.sumMontoVentas-despues.sumMontoVentas)>EPS)diffs.push(`sumMontoVentas ${antes.sumMontoVentas.toFixed(2)}→${despues.sumMontoVentas.toFixed(2)}`);
    if(Math.abs(antes.sumMontoCompras-despues.sumMontoCompras)>EPS)diffs.push(`sumMontoCompras ${antes.sumMontoCompras.toFixed(2)}→${despues.sumMontoCompras.toFixed(2)}`);
    /* Comisión pct sum: tolerancia mayor (3564 ops × ~0.14 = ~499, con muchas
       ops que ahora omiten cp=0.14 y se rehidratan al default. La rehidratación
       debe dar exactamente el mismo número para ops con comisionPct=0.14 exacto,
       pero ops con 0.140000001 podrían diferir por el WIRE_COMISION_PCT_EPS.
       Tolerancia: 0.01 absoluto = 7 ops × 0.0001 diff cada una, holgado.) */
    if(Math.abs(antes.sumComisionPct-despues.sumComisionPct)>EPS)diffs.push(`sumComisionPct ${antes.sumComisionPct.toFixed(6)}→${despues.sumComisionPct.toFixed(6)}`);
    /* IDs primera y última: deben ser idénticas */
    if(antes.primeraOpId!==despues.primeraOpId)diffs.push(`primeraOpId ${antes.primeraOpId}→${despues.primeraOpId}`);
    if(antes.ultimaOpId!==despues.ultimaOpId)diffs.push(`ultimaOpId ${antes.ultimaOpId}→${despues.ultimaOpId}`);
    /* Saldos por banco: deben coincidir */
    Object.entries(antes.saldosBancos).forEach(([nombre,saldoAntes])=>{
        const saldoDespues=despues.saldosBancos[nombre];
        if(saldoDespues===undefined)diffs.push(`saldo ${nombre} desapareció`);
        else if(Math.abs(saldoAntes-saldoDespues)>EPS)diffs.push(`saldo ${nombre} ${saldoAntes.toFixed(2)}→${saldoDespues.toFixed(2)}`);
    });
    return{ok:diffs.length===0,diffs};
}

/* ─── Self-test del motor de compresión (corre al cargar) ────────────────────
   Comprime + descomprime una op de prueba y verifica que el round-trip sea
   exacto. Si falla, marcar un flag global para abortar el sync. */
function _selftestWireCompression(){
    const opPrueba={
        id:'test_99999',
        fecha:'2026-05-26',hora:'12:34',
        tipo:'venta',banco:'Mercado Pago',moneda:'UYU',
        monto:5000,tasa:42.50,usdt:117.32,
        comisionBanco:0,comisionPct:0.14,
        timestamp:'2026-05-26T12:34:00'
    };
    const comprimida=_compressOpForWire(opPrueba);
    const restaurada=_decompressOpFromWire(comprimida);
    const camposCriticos=['id','fecha','hora','tipo','banco','moneda','monto','tasa','usdt','comisionBanco','comisionPct'];
    const errores=[];
    camposCriticos.forEach(k=>{
        if(opPrueba[k]!==restaurada[k]){
            errores.push(`${k}: original=${opPrueba[k]} vs restaurado=${restaurada[k]}`);
        }
    });
    /* timestamp: se regenera, comparamos por separado */
    if(restaurada.timestamp!==opPrueba.timestamp){
        errores.push(`timestamp: original=${opPrueba.timestamp} vs regenerado=${restaurada.timestamp}`);
    }
    if(errores.length>0){
        console.error('[P2P] WIRE COMPRESSION SELF-TEST FALLÓ:',errores);
        window._wireCompressionBroken=true;
        return false;
    }
    return true;
}
/* Correr el self-test inmediatamente al cargar la app */
_selftestWireCompression();

/* ═══════════════════════════════════════════════════════════════════════
 * 📜 CHANGELOG — registro de cambios por versión
 * ═══════════════════════════════════════════════════════════════════════
 * Mantener esta lista en sync con CONFIG.APP_VERSION. Cada release
 * debe agregar una entrada al INICIO del array (más reciente primero).
 * Formato: { version, date (YYYY-MM-DD), changes: [array de strings] }
 * ═══════════════════════════════════════════════════════════════════════ */
/* CHANGELOG schema:
 * { version, date, headline (resumen corto p/ modal "qué hay nuevo"), changes: [{type,title,desc?}] }
 * type: 'feature' | 'improve' | 'fix' | 'perf'
 * Para entradas viejas legacy (changes: [string]) hay normalizador en normalizarChangelog().
 */
const CHANGELOG = [
    {version:'5.3.3', date:'2026-08-06', headline:'🪙 Las compras muestran cuánto USDT entró.', changes:[
        {type:'improve', title:'Se acabó el "+$0,00" en cada compra', desc:'Una compra no genera ganancia: con el método de costeo que usa la app, la ganancia se realiza recién al vender. Por eso todas las compras mostraban "+$0,00" en el lugar más visible de la fila, que es justamente donde debería estar el dato más útil. Ahora cada compra muestra cuánto USDT entró a tu cuenta, ya descontada la comisión de Binance, y las ventas siguen mostrando la ganancia en pesos. Así cada operación informa lo que realmente produjo: la compra te da USDT, la venta te da ganancia. El número va en el azul que la app ya usa para el saldo USDT, para que se distinga de la ganancia y quede claro que no suma al total de arriba.'},
        {type:'improve', title:'Sin datos repetidos en la fila', desc:'Como el USDT pasó a ocupar el lugar destacado, se quitó de la línea de detalle en las compras, donde quedaba escrito dos veces. En las ventas se mantiene igual que siempre.'}
    ]},
    {version:'5.3.2', date:'2026-07-30', headline:'✅ La verificación de integridad ya no avisa de un descuadre inexistente.', changes:[
        {type:'fix', title:'Falsa alarma sobre los lotes de arrastre', desc:'La verificación comparaba dos cosas distintas creyendo que eran la misma. Al reconstruir los lotes que quedaban abiertos al momento de archivar, sumaba el tamaño ORIGINAL de cada compra en vez de lo que quedaba sin vender, así que informaba un descuadre enorme aunque los datos estuvieran perfectos. Ahora usa la misma función que el archivado para armar esos lotes, así que ambos hablan del mismo número por construcción.'},
        {type:'improve', title:'Una sola función arma los lotes de arrastre', desc:'Esa misma lógica estaba escrita tres veces: en el archivado, en la reparación y en la verificación. Es la tercera vez que una copia se separa de las otras y produce un problema, así que ahora existe en un único lugar y los tres la usan.'}
    ]},
    {version:'5.3.1', date:'2026-07-30', headline:'🎯 Un solo lugar decide cómo se escribe cada importe.', changes:[
        {type:'improve', title:'Formato unificado en toda la app', desc:'Cada pantalla resolvía por su cuenta el símbolo de la moneda, cuántos decimales lleva una tasa y cómo se escribe una ganancia: había ocho copias de la primera decisión, cinco de la segunda y siete de la tercera. Con el tiempo se separaron, y de ahí salió el problema del historial archivado, que mostraba los importes sin decimales mientras la lista los mostraba con dos. Ahora esas decisiones viven en un único lugar y todas las pantallas lo usan, así que no pueden volver a divergir. Se verificó con ciento trece combinaciones de valor y moneda que el texto en pantalla queda idéntico al anterior: es una unificación, no un cambio de aspecto.'},
        {type:'fix', title:'Dos funciones distintas se llamaban igual', desc:'El panel de pago dividido tenía una función con el mismo nombre que la nueva función central. Como todos los archivos comparten el mismo espacio de nombres y ese carga después, la suya tapaba a la otra sin ningún aviso: los importes habrían quedado sin el símbolo de la moneda. Se renombró la del panel, que era de uso exclusivo suyo, y se agregó esta comprobación al revisor automático de código para que no pueda repetirse.'},
        {type:'fix', title:'Un valor nulo podía romper el formateo', desc:'La función que da formato a los números validaba si el valor era finito antes de convertirlo, y un nulo pasaba esa validación (en JavaScript equivale a cero) para después fallar con un error al formatearlo. Ahora cualquier valor inesperado se muestra como cero, que era la intención original.'}
    ]},
    {version:'5.3.0', date:'2026-07-30', headline:'📦 Historial archivado rehecho: mismos montos, mismo estilo.', changes:[
        {type:'fix', title:'Los montos del archivo no coincidían con los de la lista', desc:'El visor del historial mostraba los importes sin decimales y la tasa siempre con dos, así que una misma operación se veía con cifras distintas según dónde la miraras: en la lista $1.500,00 a $42,55 y en el archivo 1.500 a 42,55. Ahora usa exactamente el mismo formato que la lista principal — dos decimales, tres para las tasas en dólares, el símbolo correcto según la moneda y los mismos colores para ganancia y pérdida.'},
        {type:'fix', title:'La ventana quedaba tapada por la barra del teléfono', desc:'El visor se dibujaba con estilos propios en vez de usar el sistema de ventanas de la app, así que ignoraba el área reservada de la pantalla y el título quedaba debajo del reloj y la señal. Ahora usa el mismo sistema que el resto: pantalla completa en el teléfono, flecha para volver y encabezado siempre visible al desplazar.'},
        {type:'new', title:'Totales verificados en pantalla', desc:'Al abrir un mes, los totales se recalculan sumando el detalle que se está mostrando y se comparan con lo que se guardó al archivar. Si algo no cuadra, aparece un aviso con ambas cifras en vez de mostrar un número sin explicación. La lista de meses ahora encabeza con el total de todo lo archivado, y cada mes muestra su nombre, cuántas operaciones y ajustes tiene, y los montos de compras y ventas alineados en columna.'},
        {type:'improve', title:'Operaciones alineadas', desc:'El detalle dejó de ser una tabla apretada: cada operación se ve como en la lista principal, con el monto y sus datos a la izquierda, la ganancia y la fecha a la derecha, y una franja de color según sea compra o venta. Los números se alinean por columnas para poder compararlos de un vistazo, y el mes más reciente aparece primero.'}
    ]},
    {version:'5.2.7', date:'2026-07-27', headline:'👥 La app vuelve a funcionar para todas las cuentas.', changes:[
        {type:'fix', title:'Otras personas quedaban bloqueadas en "Formato anterior"', desc:'El cambio de formato de guardado se aplicó a mano en una sola cuenta. Desde la versión 5.2.0 la app se niega a leer documentos en el formato anterior —una protección correcta para no mezclar formatos— pero eso dejó fuera a cualquier otra persona: su cuenta nunca fue actualizada, así que quedaba con el aviso "Formato anterior" y sin poder usar nada. Ahora, cuando el servidor confirma un documento sin actualizar, la app lo actualiza sola. El proceso es el mismo de siempre y conserva todas sus verificaciones: respaldo, escritura por lotes, relectura desde el servidor y comprobación de que los números coinciden antes de aplicar el cambio. Si algo falla, el documento queda intacto y se reintenta al volver a abrir.'},
        {type:'fix', title:'Las cuentas sin datos no podían actualizarse', desc:'Si una cuenta no tenía ninguna operación, la actualización se interrumpía al no encontrar nada que mover y el documento se quedaba en el formato viejo para siempre. Ahora esas cuentas también quedan actualizadas, que es justamente el caso de quien recién empieza.'},
        {type:'improve', title:'Aviso más claro durante la actualización', desc:'El mensaje dejó de hablar de detalles internos. En cuentas chicas no aparece ningún diálogo: se actualiza en silencio, porque no hay nada que decidir.'}
    ]},
];
/* ═══ Regla fija: solo las últimas N versiones viven en el bundle ═══
   Si al bumpear se olvida retirar las viejas, el código las recorta automáticamente.
   Doble red de seguridad: advertencia en consola + slice defensivo. */
const CHANGELOG_MAX_ENTRIES=5;