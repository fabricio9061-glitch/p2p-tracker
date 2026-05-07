#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   build.js — Concatenates src/css/*.css and src/js/*.js into a single
   dist/index.html for production deployment.

   Why this build instead of ES Modules at runtime?
     • Single-file deploy: upload one HTML, no bundler, no MIME issues.
     • Works on any static host (Firebase Hosting, GitHub Pages, etc).
     • No CORS issues with imports.
     • Same architecture that's been battle-tested in production.

   Usage: npm run build   (or)   node build/build.js
   ═══════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const CSS_DIR = path.join(SRC, 'css');
const JS_DIR = path.join(SRC, 'js');
const TEMPLATE = path.join(SRC, 'index.template.html');
const OUTPUT = path.join(DIST, 'index.html');

function readSorted(dir, ext) {
    return fs.readdirSync(dir)
        .filter(f => f.endsWith(ext))
        .sort()
        .map(f => ({
            name: f,
            content: fs.readFileSync(path.join(dir, f), 'utf8')
        }));
}

function build() {
    const t0 = Date.now();
    if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

    const cssFiles = readSorted(CSS_DIR, '.css');
    const jsFiles = readSorted(JS_DIR, '.js');

    const cssBundle = cssFiles
        .map(f => `\n/* ─── ${f.name} ─── */\n${f.content}`)
        .join('\n');

    const jsBundle = jsFiles
        .map(f => `\n/* ─── ${f.name} ─── */\n${f.content}`)
        .join('\n');

    let template = fs.readFileSync(TEMPLATE, 'utf8');
    /* CRÍTICO: usar la forma de función de String.replace para que los $ patterns
       en el contenido (template literals con ${...}, $&, $`, etc) NO se interpreten
       como referencias de regex/replacement. Sin esto, el output queda corrupto. */
    template = template.replace('/* {{INJECT_CSS}} */', () => cssBundle);
    template = template.replace('/* {{INJECT_JS}} */', () => jsBundle);

    fs.writeFileSync(OUTPUT, template, 'utf8');

    /* Sanity checks */
    const out = fs.readFileSync(OUTPUT, 'utf8');
    let depth = 0, inStr = null, inLineCom = false, inBlockCom = false, broken = false;
    /* (skipped exhaustive parser — relies on visual inspection + npm test if added) */

    const sizeKB = (out.length / 1024).toFixed(1);
    const sizeOriginal = fs.existsSync(path.join(ROOT, 'index.original.html'))
        ? (fs.statSync(path.join(ROOT, 'index.original.html')).size / 1024).toFixed(1)
        : 'N/A';
    const ms = Date.now() - t0;

    console.log(`✓ Built dist/index.html`);
    console.log(`  CSS files: ${cssFiles.length} → ${cssFiles.reduce((s, f) => s + f.content.length, 0)} chars`);
    console.log(`  JS files:  ${jsFiles.length} → ${jsFiles.reduce((s, f) => s + f.content.length, 0)} chars`);
    console.log(`  Output:    ${sizeKB} KB (original: ${sizeOriginal} KB)`);
    console.log(`  Time:      ${ms} ms`);
}

try { build(); } catch (e) {
    console.error('✗ Build failed:', e.message);
    process.exit(1);
}
