function normalizeArray(x) { return Array.isArray(x) ? x : []; }

export function parseBackup(raw) {
  const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const data = {
    operaciones: normalizeArray(json.operaciones),
    movimientos: normalizeArray(json.movimientos),
    transferencias: normalizeArray(json.transferencias),
    config: json.config || {}
  };
  for (const entity of ['operaciones', 'movimientos', 'transferencias']) {
    data[entity] = data[entity].filter(x => x && x.id !== undefined && x.id !== null).map(x => ({...x, id: String(x.id)}));
  }
  return data;
}

export async function importFile(file, repository) {
  const raw = await file.text();
  const data = parseBackup(raw);
  const msg = `Esto reemplazará Firestore con el JSON:\n\nOperaciones: ${data.operaciones.length}\nMovimientos: ${data.movimientos.length}\nTransferencias: ${data.transferencias.length}\n\n¿Continuar?`;
  if (!confirm(msg)) return {cancelled: true};
  const results = await repository.replaceAll(data);
  return {cancelled: false, results, data};
}
