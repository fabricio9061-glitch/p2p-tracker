export const state = {
  user: null,
  db: null,
  unsubscribers: [],
  sync: 'idle',
  datos: {
    operaciones: [],
    movimientos: [],
    transferencias: [],
    bancos: {},
    tags: [],
    tasasRecientes: [],
    config: {},
    lotes: [],
    saldoUsdt: 0
  }
};

export function resetState() {
  state.unsubscribers.forEach(fn => { try { fn(); } catch {} });
  state.unsubscribers = [];
  state.sync = 'idle';
  state.datos.operaciones = [];
  state.datos.movimientos = [];
  state.datos.transferencias = [];
  state.datos.lotes = [];
  state.datos.saldoUsdt = 0;
}

export function setEntity(entity, items) {
  state.datos[entity] = Array.isArray(items) ? items : [];
}

export function upsertEntityItem(entity, item) {
  const id = String(item.id);
  const arr = state.datos[entity] || (state.datos[entity] = []);
  const idx = arr.findIndex(x => String(x.id) === id);
  if (idx >= 0) arr[idx] = {...arr[idx], ...item, id};
  else arr.push({...item, id});
}

export function removeEntityItem(entity, id) {
  state.datos[entity] = (state.datos[entity] || []).filter(x => String(x.id) !== String(id));
}
