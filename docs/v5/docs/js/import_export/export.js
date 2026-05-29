import { APP_VERSION } from '../config.js';
import { state } from '../core/state.js';

export function buildExport() {
  return {
    _meta: {
      app: 'P2P Tracker',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      schema: 'v5-subcollections'
    },
    operaciones: state.datos.operaciones || [],
    movimientos: state.datos.movimientos || [],
    transferencias: state.datos.transferencias || [],
    config: {
      bancos: state.datos.bancos || {},
      tags: state.datos.tags || [],
      tasasRecientes: state.datos.tasasRecientes || []
    }
  };
}

export function downloadJson(name = 'p2p-backup-v5.json') {
  const blob = new Blob([JSON.stringify(buildExport(), null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
