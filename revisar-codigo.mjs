#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
   REVISIÓN DE CÓDIGO — Registro P2P
   ════════════════════════════════════════════════════════════════════════════
   Uso:   node revisar-codigo.mjs
   Antes: npm install --save-dev eslint     (una sola vez)

   Qué hace, y por qué así:
   Los archivos de la app no son módulos: el navegador los carga como scripts
   sueltos que COMPARTEN un mismo ámbito global, así que una función definida en
   06 es visible desde 15. Revisar archivo por archivo daría cientos de falsos
   "no está definido". Por eso este script arma el mismo bundle que ve el
   navegador —leyendo el orden real desde index.html, así nunca queda desfasado—,
   lo analiza completo, y después traduce cada hallazgo a su archivo y línea
   verdaderos.

   Detecta, entre otras cosas: identificadores usados sin declarar (la clase de
   error que aparece al BORRAR código y que no es error de sintaxis, así que no
   lo ve `node --check`), código inalcanzable, claves repetidas en un objeto,
   asignaciones de una variable a sí misma, comparaciones que siempre dan lo
   mismo, y typeof mal escritos.
   ════════════════════════════════════════════════════════════════════════════ */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ESLint} from 'eslint';

const raiz = dirname(fileURLToPath(import.meta.url));

/* ─── 1. Orden de carga real, tomado de index.html ─── */
const html = readFileSync(join(raiz, 'index.html'), 'utf8');
const archivos = [...html.matchAll(/src="(src\/js\/[^"?]+\.js)/g)].map(m => m[1]);
if (!archivos.length) {
    console.error('No se encontraron scripts en index.html. ¿Estás corriendo esto desde la raíz del proyecto?');
    process.exit(1);
}

/* ─── 2. Bundle + tabla de posiciones para traducir líneas ─── */
let bundle = '', mapa = [], acumulado = 0;
for (const rel of archivos) {
    let texto;
    try { texto = readFileSync(join(raiz, rel), 'utf8'); }
    catch { console.error(`FALTA el archivo ${rel} que index.html declara.`); process.exit(1); }
    const lineas = texto.split('\n').length;
    mapa.push({desde: acumulado + 1, hasta: acumulado + lineas, archivo: rel.replace('src/js/', '')});
    bundle += texto + '\n';
    acumulado += lineas + 1;
}
const ubicar = n => {
    const e = mapa.find(x => n >= x.desde && n <= x.hasta);
    return e ? `${e.archivo}:${n - e.desde + 1}` : `?:${n}`;
};

/* ─── 3. Reglas ─── */
const config = {
    files: ['**/*.js'],
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'script',
        globals: Object.fromEntries([
            'window','document','navigator','localStorage','sessionStorage','console',
            'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame',
            'cancelAnimationFrame','requestIdleCallback','alert','confirm','prompt','fetch',
            'Blob','URL','FileReader','Intl','performance','firebase','getComputedStyle',
            'matchMedia','Event','CustomEvent','MutationObserver','IntersectionObserver',
            'screen','history','btoa','atob','Image'
        ].map(g => [g, 'readonly']).concat([['location', 'writable']]))
    },
    rules: {
        'no-undef': 'error',                       /* lo que se usa sin declarar */
        'no-self-assign': 'error',                 /* x = x, que no hace nada */
        'no-unreachable': 'error',                 /* código después de un return */
        'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-duplicate-case': 'error',
        'no-const-assign': 'error', 'no-func-assign': 'error', 'no-obj-calls': 'error',
        'use-isnan': 'error', 'valid-typeof': 'error', 'no-self-compare': 'error',
        'no-unsafe-negation': 'error', 'no-unsafe-optional-chaining': 'error',
        'no-cond-assign': 'error', 'no-fallthrough': 'error',
        'no-constant-condition': ['error', {checkLoops: false}],
        'no-async-promise-executor': 'error', 'no-sparse-arrays': 'error',
        'no-empty': 'off', 'no-unused-vars': 'off'  /* apagadas: hay descartes a propósito */
    }
};

/* ─── 4. Correr y reportar ─── */
const eslint = new ESLint({overrideConfigFile: true, overrideConfig: [config]});
const [res] = await eslint.lintText(bundle, {filePath: join(raiz, 'bundle-virtual.js')});
const hallazgos = (res?.messages || []).filter(m => m.severity === 2);

console.log(`\nRevisados ${archivos.length} archivos (${acumulado} líneas) en el orden real de carga.\n`);
if (!hallazgos.length) {
    console.log('✅ Sin errores.\n');
    process.exit(0);
}
console.log(`❌ ${hallazgos.length} error(es):\n`);
for (const m of hallazgos) console.log(`  ${ubicar(m.line).padEnd(34)} ${m.ruleId}\n      ${m.message}\n`);
process.exit(1);
