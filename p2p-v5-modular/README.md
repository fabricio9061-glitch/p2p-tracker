# P2P Tracker v5 modular — alpha 1

Esta es una base nueva, modular y limpia. No es un parche sobre v4.8.x.

## Objetivo

- Subcollections como única arquitectura.
- Sin single-doc legacy.
- Sin recovery.
- Sin wire-compress.
- Sin root-clean.
- Sin migraciones automáticas.
- Sin reset SDK.

## Estructura

```txt
docs/
  index.html
  css/app.css
  js/app.js
  js/config.js
  js/core/state.js
  js/core/money.js
  js/firebase/init.js
  js/firebase/repository.js
  js/business/fifo.js
  js/business/balances.js
  js/import_export/export.js
  js/import_export/import.js
  js/ui/render.js
```

## Firestore usado

```txt
users/{uid}/config/main
users/{uid}/operaciones/{id}
users/{uid}/movimientos/{id}
users/{uid}/transferencias/{id}
```

## Estado actual

Alpha inicial. Incluye:

- Login/registro Firebase Auth.
- Lectura por listeners de subcollections.
- Crear operación por write directo.
- Rebuild FIFO básico.
- Resumen USDT / ganancia.
- Export JSON.
- Import JSON con reemplazo completo de colecciones.

## No subir directo a producción

Primero probar en Firebase staging o usuario de prueba. Esta versión todavía no replica toda la UI ni todas las reglas de v4.

## Validaciones antes de reemplazar v4

1. Importar backup real.
2. Verificar conteos:
   - operaciones
   - movimientos
   - transferencias
3. Comparar:
   - saldo USDT
   - lotes FIFO
   - ganancias totales
   - ganancias mensuales
   - saldos bancos
4. Crear operación nueva y confirmar un solo write pequeño.
5. Cerrar/reabrir y confirmar persistencia.
