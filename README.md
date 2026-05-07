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
├── firebase.json              ← config para Firebase Hosting (apunta a docs/)
├── .firebaserc                ← target del proyecto Firebase
│
├── index.original.html        ← respaldo intacto del HTML monolítico anterior (NO editar)
│
├── src/                       ← código fuente (acá editás)
│   ├── index.template.html    ← shell HTML con marcadores {{INJECT_CSS}} y {{INJECT_JS}}
│   ├── css/
│   │   ├── 01-base.css
│   │   ├── 02-components.css
│   │   └── 03-features.css
│   └── js/
│       ├── 01-config.js
│       ├── 02-helpers.js
│       ├── 03-utils-filters.js
│       ├── 04-integrity.js
│       ├── 05-bancos-fifo.js
│       ├── 06-firebase.js
│       ├── 07-operations.js
│       ├── 08-calendar-dashboard.js
│       └── 09-ui-glue.js
│
├── build/
│   └── build.js               ← script que concatena src/ → docs/index.html
│
└── docs/                      ← OUTPUT FINAL — GitHub Pages y Firebase Hosting
    ├── .nojekyll              ← le dice a GitHub Pages que no procese con Jekyll
    └── index.html             ← el archivo que se sirve (no editar a mano)
```

**¿Por qué `docs/` y no `dist/`?**
GitHub Pages solo permite servir desde `/` (raíz) o `/docs`, no desde `/dist`. Usar `docs/` permite servir el sitio sin mover archivos. Firebase Hosting funciona igual, leyendo `firebase.json`.

---

## Workflow de desarrollo

### Editás el código

1. Abrir `src/css/*.css` o `src/js/*.js` con tu editor
2. Hacer los cambios

### Generar el build

```powershell
npm run build
```

Esto regenera `docs/index.html` concatenando todos los `src/css/*.css` (orden alfabético) y `src/js/*.js` (orden alfabético).

### Probar localmente

Podés abrir `docs/index.html` directamente en el navegador (file://) — funciona porque es un único archivo sin imports en runtime.

O servir con un servidor local:

```powershell
# Si tenés Python:
cd docs
python -m http.server 8000
# Abrí http://localhost:8000

# Si tenés Node:
npx serve docs
```

---

## Setup inicial (PowerShell)

### 1. Descomprimir el zip

Descomprimí `p2p-tracker.zip` en `C:\Users\TuUsuario\proyectos\p2p-tracker` (o donde prefieras).

### 2. Editar `.firebaserc`

Abrí `.firebaserc` y reemplazá `REPLACE-WITH-YOUR-FIREBASE-PROJECT-ID` con el ID de tu proyecto Firebase.

### 3. Verificar que el build funciona

```powershell
cd C:\Users\TuUsuario\proyectos\p2p-tracker
npm run build
```

Deberías ver:
```
✓ Built docs/index.html
  CSS files: 3 → 76758 chars
  JS files:  9 → 328594 chars
  Output:    430.8 KB
```

---

## Subir a GitHub desde PowerShell

### Primera vez (carpeta nueva, sin repo previo)

```powershell
cd C:\Users\TuUsuario\proyectos\p2p-tracker

git init
git add .
git commit -m "Initial commit: estructura modular con build a docs/"

# Crear primero el repo en github.com (sin README, sin .gitignore — el zip ya los trae)
git remote add origin https://github.com/TU-USUARIO/p2p-tracker.git
git branch -M main
git push -u origin main
```

### Configurar GitHub Pages

1. En tu repo en GitHub: **Settings → Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `main` / **`/docs`** ← importante
4. **Save**
5. Esperá 1-2 minutos
6. Tu sitio queda en `https://TU-USUARIO.github.io/p2p-tracker/`

### Actualizaciones siguientes

```powershell
# 1. Editás algo en src/
# 2. Build
npm run build

# 3. Commit + push
git add .
git commit -m "Descripción del cambio"
git push
```

GitHub Pages se actualiza automáticamente en 1-2 minutos.

---

## Deploy a Firebase Hosting

### Primera vez

```powershell
# Instalar Firebase CLI (una sola vez en tu PC)
npm install -g firebase-tools

# Login
firebase login

# Build + deploy
npm run build
firebase deploy --only hosting
```

### Actualizaciones siguientes

```powershell
npm run build
firebase deploy --only hosting
```

---

## Reglas de oro

- **NUNCA edites `docs/index.html` a mano.** El build lo va a sobrescribir.
- **NO borres `index.original.html`** hasta confirmar que todo funciona en producción.
- **Editá siempre en `src/`**.
- **El orden importa**: archivos se concatenan alfabéticamente. Por eso usan prefijos `01-`, `02-`, etc.
- **Después de cada cambio, corré `npm run build`** antes de commitear.

---

## Troubleshooting

**El build falla.**
- Verificar que tengás Node ≥ 14: `node --version`
- Verificar que estés en el directorio del proyecto

**GitHub Pages muestra el README en vez de la app.**
- Verificar que **Settings → Pages** apunte a `main` / `/docs` (no `/root`)
- Esperar 2 minutos después del push, hard refresh con Ctrl + F5

**El build de GitHub Pages falla con error de Jekyll.**
- El archivo `docs/.nojekyll` debe existir. El build lo crea automáticamente.
- Si por algún motivo se borró, corré `npm run build` y commiteá.

**Los cambios en CSS/JS no se reflejan.**
- ¿Corriste `npm run build` después de editar?
- Hard refresh: Ctrl + Shift + R
- Verificar que estés mirando `docs/index.html` (el output) y no `index.original.html`

**Firebase deploy falla con "Authorization failed".**
- Re-login: `firebase logout` luego `firebase login`
- Verificar que `.firebaserc` tenga el project ID correcto
