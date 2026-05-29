import { roundMoney, truncMoney } from '../core/money.js';

function opDateKey(item) {
  return `${item.fecha || '2000-01-01'} ${item.hora || '00:00'}`;
}

export function sortByDateAsc(items) {
  return [...(items || [])].sort((a, b) => opDateKey(a).localeCompare(opDateKey(b)) || String(a.id).localeCompare(String(b.id)));
}

export function rebuildFifo(operaciones = [], manualLots = []) {
  const lotes = (manualLots || []).map(l => ({...l, disponible: truncMoney(l.disponible ?? l.cantidad, 2), manual: true}));
  const ops = sortByDateAsc(operaciones).map(op => ({...op, consumedLots: [], ganancia: 0, comisionPlataforma: calcPlatformFee(op)}));

  for (const op of ops) {
    const tipo = String(op.tipo || '').toLowerCase();
    const monto = Number(op.monto || 0);
    const tasa = Number(op.tasa || 0);
    const usdt = Number(op.usdt || (tasa ? monto / tasa : 0));
    const moneda = op.moneda || 'UYU';

    if (tipo === 'compra') {
      const cantidad = truncMoney(usdt, 2);
      if (cantidad > 0) {
        lotes.push({
          id: String(op.id),
          fecha: op.fecha,
          hora: op.hora || '00:00',
          precioCompra: tasa,
          cantidad,
          disponible: cantidad,
          moneda,
          manual: false
        });
      }
      op.ganancia = 0;
      continue;
    }

    if (tipo === 'venta') {
      let rest = truncMoney(usdt, 2);
      let costo = 0;
      const consumidos = [];
      const eligible = lotes.filter(l => (l.disponible || 0) > 0 && (l.moneda || 'UYU') === moneda)
                             .sort((a,b)=>opDateKey(a).localeCompare(opDateKey(b)));
      for (const lote of eligible) {
        if (rest <= 0) break;
        const c = truncMoney(Math.min(lote.disponible, rest), 2);
        lote.disponible = truncMoney(lote.disponible - c, 2);
        rest = truncMoney(rest - c, 2);
        costo = roundMoney(costo + c * Number(lote.precioCompra || 0), 2);
        consumidos.push({loteId: lote.id, cantidad: c, precioCompra: lote.precioCompra});
      }
      const ingreso = roundMoney(monto, 2);
      const fee = calcPlatformFee(op);
      op.consumedLots = consumidos;
      op.ganancia = roundMoney(ingreso - costo - fee, 2);
    }
  }

  const saldoUsdt = truncMoney(lotes.reduce((s, l) => s + Number(l.disponible || 0), 0), 2);
  return {operaciones: ops, lotes, saldoUsdt};
}

export function calcPlatformFee(op) {
  const pct = Number(op.comisionPct ?? op.comisionPlataformaPct ?? 0);
  if (!pct) return 0;
  const usdt = Number(op.usdt || (Number(op.tasa) ? Number(op.monto || 0) / Number(op.tasa) : 0));
  return truncMoney(usdt * pct / 100, 2);
}
