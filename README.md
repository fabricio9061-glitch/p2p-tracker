# P2P Tracker

App web para registrar operaciones P2P (compras/ventas USDT), ajustes, transferencias y cálculo de ganancias FIFO con Firebase.

**Versión actual:** 4.7.31

---

## Estructura del proyecto

```
p2p-tracker/
├── README.md                  ← este archivo
├── package.json               ← scripts npm
├── .gitignore
├── firebase.json              ← config para Firebase Hosting
├── .firebaserc                ← target del proyecto
│
├── index.original.html        ← respaldo intacto del HTML monolítico anterior (NO editar)
│
├── src/                       ← código fuente (acá editás)
│   ├── index.template.html    ← shell HTML con marcadores {{INJECT_CSS}} y {{INJECT_JS}}
│   ├── css/
│   │   ├── 01-base.css        ← reset, layout, header, menú, novedades
│   │   ├── 02-components.css  ← cards, modales, formularios, filtros
│   │   └── 03-features.css    ← calendario, métricas, novedades, desktop
│   └── js/
│       ├── 01-config.js       ← CONFIG, CHANGELOG, AppState
│       ├── 02-helpers.js      ← DOM, conectividad, summary mensual, novedades
│       ├── 03-utils-filters.js← utilidades puras + filtros (ops/movs/trans)
│       ├── 04-integrity.js    ← validarDeltas, aplicarDeltas, tags, swipe
│       ├── 05-bancos-fifo.js  ← paginación genérica, bancos, FIFO
│       ├── 06-firebase.js     ← Firebase, auth, save/load, backup, recovery
│       ├── 07-operations.js   ← formulario op, split pago, movs, transferencias
│       ├── 08-calendar-dashboard.js ← calendario, dashboard, spread
│       └── 09-ui-glue.js      ← lotes modal, reset, restore, listeners
│
├── build/
│   └── build.js               ← script que concatena src/ → dist/index.html
│
└── dist/
    └── index.html             ← OUTPUT FINAL para deploy (no editar a mano)
```

---

## Workflow de desarrollo

### Editás el código

1. Abrir `src/css/*.css` o `src/js/*.js` con tu editor
2. Hacer los cambios

### Generar el build

```powershell
npm run build
```

Esto regenera `dist/index.html` concatenando todos los `src/css/*.css` (en orden alfabético) y `src/js/*.js` (en orden alfabético).

### Probar localmente

Podés abrir `dist/index.html` directamente en el navegador (file://) — funciona porque es un único archivo sin imports en runtime.

O servir con un servidor local:

```powershell
# Si tenés Python instalado:
cd dist
python -m http.server 8000
# Abrí http://localhost:8000

# Si tenés Node:
npx serve dist
```

---

## Subir a GitHub desde PowerShell

### Primera vez (carpeta nueva, sin repo previo)

```powershell
# Posicionarte en la carpeta del proyecto
cd C:\ruta\a\p2p-tracker

# Inicializar git
git init
git add .
git commit -m "Initial commit: split monolithic HTML into modular structure"

# Conectar al repo nuevo en GitHub (creá el repo primero en github.com)
git remote add origin https://github.com/TU-USUARIO/TU-REPO-NUEVO.git
git branch -M main
git push -u origin main
```

### Actualizaciones siguientes

```powershell
git add .
git commit -m "Descripción del cambio"
git push
```

### Si ya tenés un repo viejo abierto y querés migrar

NO borrar todavía el repo viejo. Mientras testeás:

```powershell
# Crear un repo nuevo en GitHub con otro nombre, ej: p2p-tracker-v2
# Después conectar este local al nuevo:
cd C:\ruta\a\p2p-tracker
git init
git add .
git commit -m "Migración a estructura modular"
git remote add origin https://github.com/TU-USUARIO/p2p-tracker-v2.git
git push -u origin main
```

Cuando confirmes que todo funciona, podés borrar el repo viejo y renombrar este.

---

## Deploy a Firebase Hosting

### Primera vez

1. Instalar Firebase CLI (una sola vez en tu PC):
   ```powershell
   npm install -g firebase-tools
   ```

2. Login:
   ```powershell
   firebase login
   ```

3. Editar `.firebaserc` y poner el ID de tu proyecto Firebase:
   ```json
   {
     "projects": {
       "default": "TU-PROJECT-ID"
     }
   }
   ```

4. Build + deploy:
   ```powershell
   npm run build
   firebase deploy --only hosting
   ```

### Actualizaciones siguientes

```powershell
npm run build
firebase deploy --only hosting
```

---

## Workflow combinado (lo más común)

```powershell
# 1. Editás algo en src/
# 2. Build
npm run build

# 3. Testear local (opcional)
# abrí dist/index.html en el browser

# 4. Push a GitHub
git add .
git commit -m "Mensaje del cambio"
git push

# 5. Deploy
firebase deploy --only hosting
```

---

## Reglas de oro

- **NUNCA editar `dist/index.html` a mano.** El build lo va a sobrescribir y perdés cambios.
- **NO borres `index.original.html`** hasta confirmar que todo funciona en producción. Es tu safety net.
- **Editar siempre en `src/`**. Si el cambio es CSS, editá `src/css/`. Si es JS, editá `src/js/`. Si es HTML estructural, editá `src/index.template.html`.
- **El orden importa**: los archivos se concatenan en orden alfabético. Por eso usan prefijos numéricos `01-`, `02-`, etc. Si necesitás insertar un archivo nuevo entre dos existentes, numerálo intermedio (ej. `02b-helper-extra.js` va entre 02 y 03).
- **El sistema de novedades sigue funcionando igual.** El CHANGELOG vive en `src/js/01-config.js`. Mantené el cap de 5 entradas.

---

## Troubleshooting

**El build no genera el archivo.**
- Verificar que tengás Node ≥ 14 instalado: `node --version`
- Verificar que estés en el directorio correcto: el `package.json` debe estar visible
- Probar `node build/build.js` directamente

**El build genera un archivo pero la app no funciona.**
- Comparar tamaño con `index.original.html` — si difiere mucho, algo se rompió
- Abrir DevTools (F12) y mirar errores en la consola
- Verificar que el orden alfabético de los archivos en `src/js/` no esté desordenado

**Los cambios en CSS/JS no se reflejan.**
- ¿Corriste `npm run build` después de editar?
- Hard refresh en el browser: Ctrl+Shift+R (Windows) / Cmd+Shift+R (Mac)
- Verificar que estés mirando `dist/index.html` y no `index.original.html`

**Firebase deploy falla con "Authorization failed".**
- Re-login: `firebase logout` luego `firebase login`
- Verificar que `.firebaserc` tenga el project ID correcto

---

## Notas técnicas

### Por qué no ES Modules

Considerado y rechazado. Razones:
- ES Modules requieren servir desde HTTP (no funcionan en `file://`)
- CORS issues con algunos hostings
- Más complejidad de configuración sin beneficio real para este tamaño

El build concat → single file da mantenibilidad sin comprometer simplicidad de deploy.

### Por qué orden alfabético en concat

Determinístico, predecible, no requiere config. Cada archivo declara su orden con su prefijo numérico (`01-`, `02-`, ...). Insertar uno nuevo entre dos existentes es trivial.

### Por qué el placeholder usa `() =>` en build.js

`String.prototype.replace` con un string interpreta `$&`, `$1`, `$\``, etc como referencias. El JS de la app tiene cientos de template literals con `${...}` que se rompían. La forma de función evita eso.
