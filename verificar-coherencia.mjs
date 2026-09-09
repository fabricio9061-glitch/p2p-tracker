/* ═══════════════════════════════════════════════════════════════════════════
   VERIFICADOR DE COHERENCIA
   ═══════════════════════════════════════════════════════════════════════════
   Casi todas las fallas de esta aplicación tuvieron la misma forma: algo
   escrito a mano en dos lugares que tenían que coincidir, y uno quedó
   desactualizado. Un botón sin nadie que responda. Un campo que el programa
   busca y no existe. Una lista de tipos a la que se le agregó uno nuevo en un
   archivo y no en los otros tres.

   Ninguna de esas cosas rompe la sintaxis, así que ni el navegador ni el
   revisor de código las detectan: la aplicación arranca bien y simplemente no
   hace lo que debería, en silencio.

   Uso:  node verificar-coherencia.mjs
   Correlo desde la raíz del proyecto, antes de cada publicación.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';

const RAIZ = process.cwd();
const DIR_JS = path.join(RAIZ, 'src', 'js');
const HTML = path.join(RAIZ, 'index.html');

if (!fs.existsSync(HTML) || !fs.existsSync(DIR_JS)) {
    console.error('No encuentro index.html o src/js/. Corré esto desde la raíz del proyecto.');
    process.exit(1);
}

const html = fs.readFileSync(HTML, 'utf8');
const archivos = fs.readdirSync(DIR_JS).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
const js = Object.fromEntries(archivos.map(f => [f, fs.readFileSync(path.join(DIR_JS, f), 'utf8')]));

/* Los comentarios no son código: se quitan para no producir falsos avisos */
const limpio = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');
const todoJS = archivos.map(f => limpio(js[f])).join('\n');

const hallazgos = [];
const rep = (sev, cat, det) => hallazgos.push({ sev, cat, det });

/* ── 1 · Botones que no hacen nada ──
   Un elemento con data-action que ningún manejador atiende: al tocarlo no
   ocurre absolutamente nada y no hay ningún aviso. */
const accHtml = new Set([...html.matchAll(/data-action="([^"$]+)"/g)].map(m => m[1]));
[...todoJS.matchAll(/data-action="([a-z-]+)"/g)].forEach(m => accHtml.add(m[1]));
const accJs = new Set([...todoJS.matchAll(/a===['"]([^'"]+)['"]/g)].map(m => m[1]));
[...accHtml].forEach(a => {
    if (!accJs.has(a)) rep('ALTA', 'Botón sin manejador',
        `data-action="${a}" está en la pantalla pero ningún código responde`);
});

/* ── 2 · Campos que el programa busca y no existen ──
   Se descartan los que la propia aplicación crea al vuelo. */
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const creados = new Set([...todoJS.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)].map(m => m[1]));
[...todoJS.matchAll(/id="([\w-]+)"/g)].forEach(m => creados.add(m[1]));
const usados = new Set([...todoJS.matchAll(/\$\(['"]([A-Za-z][\w-]*)['"]\)/g)].map(m => m[1]));
[...usados].forEach(i => {
    if (!ids.has(i) && !creados.has(i)) rep('ALTA', 'Campo inexistente',
        `$('${i}') se usa pero no existe ningún elemento con ese identificador`);
});

/* ── 3 · Listas de tipos de registro incompletas ──
   Cada vez que se agrega un tipo hay que recorrer todas estas listas. Olvidar
   una hace que ese tipo se pierda en silencio en ese camino puntual. */
const ENTIDADES = ['operaciones', 'movimientos', 'transferencias', 'conversiones', 'ajustesSaldo'];
archivos.forEach(f => {
    /* Se usa el texto ORIGINAL, no el limpio: la marca de excepción vive en un
       comentario y el limpiado la borraría junto con el resto. */
    const s = js[f];
    [...s.matchAll(/\[((?:'[a-zA-Z]+',){2,}'[a-zA-Z]+')\]/g)].forEach(m => {
        const lista = m[1].replace(/'/g, '').split(',');
        if (lista.filter(x => ENTIDADES.includes(x)).length >= 3) {
            const faltan = ENTIDADES.filter(e => !lista.includes(e));
            const linea = s.slice(m.index, s.indexOf('\n', m.index));
            if (faltan.length && !/coherencia:ok/.test(linea))
                rep('ALTA', 'Lista de tipos incompleta',
                    `${f}: [${lista.join(', ')}] omite ${faltan.join(', ')}`);
        }
    });
});

/* ── 4 · Valores que descartan el cero ──
   El operador || trata el cero como vacío. En porcentajes y comisiones eso
   reemplaza silenciosamente un valor legítimo por el predeterminado.

   No se marca cuando el valor se usa como divisor: ahí el || es una protección
   contra dividir por cero, no un valor por defecto. Tampoco cuando la línea
   lleva la marca `coherencia:ok`, que sirve para declarar una excepción a
   propósito y dejar constancia de por qué. */
const campos = 'comision|porcentaje|monto|limite|saldo';
[...todoJS.matchAll(new RegExp(`(\\w*(?:${campos})\\w*)\\s*\\|\\|\\s*(\\d+\\.?\\d*)`, 'gi'))]
    .forEach(m => {
        if (m[2] === '0') return;                       /* || 0 es inofensivo */
        const linea = todoJS.slice(m.index, todoJS.indexOf('\n', m.index));
        if (/coherencia:ok/.test(linea)) return;        /* excepción declarada */
        if (/\)\s*[\/*]/.test(linea.slice(0, 40))) return;  /* se usa como divisor */
        rep('ALTA', 'El cero se descarta',
            `${m[1]}||${m[2]} — si el valor es 0 se reemplaza por ${m[2]}`);
    });

/* ── 5 · Dependencias que rompen el orden de carga ──
   Los archivos se leen en el orden que declara index.html, uno tras otro. Si al
   cargarse uno se ejecuta algo que necesita una función definida más adelante,
   salta un error que corta su ejecución a la mitad: todo lo que venía después
   nunca llega a definirse. La aplicación arranca igual, pero incompleta, y los
   síntomas aparecen lejos de la causa.

   No alcanza con mirar la llamada directa: si el archivo ejecuta al cargarse una
   función propia, y esa a su vez llama a otra de un archivo posterior, el error
   ocurre igual. Se sigue esa cadena. */
const cuerpoDe = (src, nombre) => {
    const i = src.search(new RegExp(`function\\s+${nombre}\\s*\\(`));
    if (i < 0) return '';
    let j = src.indexOf('{', i), d = 0, k = j;
    do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
    return src.slice(i, k);
};
const dueñoDe = nombre => archivos.findIndex(f =>
    new RegExp(`function\\s+${nombre}\\s*\\(`).test(limpio(js[f])));

archivos.forEach((f, i) => {
    const s = limpio(js[f]);
    /* Llamadas que ocurren al cargarse: están fuera de toda función */
    const inmediatas = [];
    let prof = 0;
    s.split('\n').forEach(l => {
        if (prof === 0) {
            const m = l.trim().match(/^(\w+)\s*\(/);
            if (m && !/^(if|for|while|switch|catch|function|return|typeof|else)$/.test(m[1]))
                inmediatas.push(m[1]);
        }
        prof += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
    });

    /* Se sigue la cadena de llamadas desde cada una, dentro del mismo archivo */
    const vistas = new Set();
    const revisar = (nombre, camino) => {
        if (vistas.has(nombre) || camino.length > 6) return;
        vistas.add(nombre);
        const cuerpo = cuerpoDe(s, nombre);
        if (!cuerpo) return;
        [...cuerpo.matchAll(/\b(\w+)\s*\(/g)].forEach(m => {
            const llamada = m[1];
            if (/^(if|for|while|switch|catch|function|return|typeof|new|else)$/.test(llamada)) return;
            const d = dueñoDe(llamada);
            if (d > i) {
                rep('ALTA', 'Dependencia de orden de carga',
                    `${f} ejecuta ${camino.join(' → ')} al cargarse, y ${llamada}() se define en ${archivos[d]}, que carga después`);
            } else if (d === i) {
                revisar(llamada, [...camino, llamada]);
            }
        });
    };
    inmediatas.forEach(n => revisar(n, [n]));
});

/* ── 6 · Funciones publicadas al navegador que no existen ── */
[...todoJS.matchAll(/window\.(\w+)\s*=\s*(\w+)\s*;/g)].forEach(m => {
    if (m[1] === m[2]
        && !new RegExp(`function\\s+${m[2]}\\s*\\(`).test(todoJS)
        && !new RegExp(`(const|let|var)\\s+${m[2]}\\b`).test(todoJS))
        rep('ALTA', 'Función publicada inexistente',
            `window.${m[1]} apunta a algo que no está definido`);
});

/* ── 6 · Reglas repetidas en demasiados lugares ──
   No es un error por sí mismo, pero es el terreno donde nacen: cuantos más
   lugares tengan que coincidir, más fácil es que uno quede atrás. */
/* Se cuentan MODIFICACIONES, no lecturas. Leer un valor en muchos lugares es
   normal; el riesgo está en que muchos lugares lo escriban, porque ahí es donde
   uno puede quedar desalineado de los otros. */
const reglas = {
    'escribir el saldo de un banco': /bancos\[[^\]]+\]\.saldo\s*=(?!=)/g,
    /* Se cuenta INTERPRETAR el dato (preguntar si hay pago dividido), no crearlo
       ni leerlo desde su función dueña. Esa pregunta repetida fue la que produjo
       cuatro fallas distintas en una sola semana. */
    'interpretar el pago dividido': /Array\.isArray\(\w*\.aportes\)/g,
    'escribir el cupo diario': /limiteUsadoUSD\s*=(?!=)/g,
};
Object.entries(reglas).forEach(([n, re]) => {
    const c = (todoJS.match(re) || []).length;
    if (c > 10) rep('MEDIA', 'Regla repetida en muchos lugares',
        `"${n}" aparece ${c} veces; conviene que tenga una sola función dueña`);
});

/* ── Informe ── */
const orden = { ALTA: 0, MEDIA: 1, BAJA: 2 };
hallazgos.sort((a, b) => orden[a.sev] - orden[b.sev] || a.cat.localeCompare(b.cat));
const cuenta = s => hallazgos.filter(h => h.sev === s).length;

console.log(`\nRevisados ${archivos.length} archivos y la pantalla.`);
console.log(`\n  ALTA: ${cuenta('ALTA')}    MEDIA: ${cuenta('MEDIA')}\n`);

let cat = '';
hallazgos.forEach(h => {
    if (h.cat !== cat) { cat = h.cat; console.log(`\n── ${cat} [${h.sev}] ──`); }
    console.log('   •', h.det);
});

if (!hallazgos.length) console.log('✅ Sin incoherencias.\n');
else console.log('');

process.exit(cuenta('ALTA') ? 1 : 0);
