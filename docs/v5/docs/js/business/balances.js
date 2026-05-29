import { roundMoney } from '../core/money.js';

export function computeBankBalances(datos) {
  const balances = {};
  for (const [name, cfg] of Object.entries(datos.bancos || {})) {
    balances[name] = {saldo: Number(cfg.saldo || 0), moneda: cfg.moneda || 'UYU'};
  }
  for (const op of datos.operaciones || []) {
    const banco = op.banco || op.bank;
    if (!banco) continue;
    balances[banco] ||= {saldo: 0, moneda: op.moneda || 'UYU'};
    const monto = Number(op.monto || 0);
    if (op.tipo === 'compra') balances[banco].saldo = roundMoney(balances[banco].saldo - monto, 2);
    if (op.tipo === 'venta') balances[banco].saldo = roundMoney(balances[banco].saldo + monto, 2);
  }
  for (const mov of datos.movimientos || []) {
    const banco = mov.banco;
    if (!banco) continue;
    balances[banco] ||= {saldo: 0, moneda: mov.moneda || 'UYU'};
    const monto = Number(mov.monto || mov.amount || 0);
    if ((mov.tipo || '').toLowerCase() === 'ingreso') balances[banco].saldo = roundMoney(balances[banco].saldo + monto, 2);
    if ((mov.tipo || '').toLowerCase() === 'egreso') balances[banco].saldo = roundMoney(balances[banco].saldo - monto, 2);
  }
  return balances;
}

export function computeSummary(datos) {
  const gananciaTotal = (datos.operaciones || []).reduce((s, op) => roundMoney(s + Number(op.ganancia || 0), 2), 0);
  return {gananciaTotal, saldoUsdt: datos.saldoUsdt || 0, balances: computeBankBalances(datos)};
}
