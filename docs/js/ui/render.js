import { state } from '../core/state.js';
import { fmt } from '../core/money.js';
import { computeSummary } from '../business/balances.js';

const $ = id => document.getElementById(id);

export function setStatus(text) { const el = $('syncStatus'); if (el) el.textContent = text; }

export function render() {
  const summary = computeSummary(state.datos);
  $('saldoUsdt').textContent = fmt(summary.saldoUsdt, 2);
  $('gananciaTotal').textContent = `$${fmt(summary.gananciaTotal, 2)}`;
  $('opsCount').textContent = `${state.datos.operaciones.length} ops`;

  const ops = [...state.datos.operaciones].sort((a,b)=>`${b.fecha||''} ${b.hora||''}`.localeCompare(`${a.fecha||''} ${a.hora||''}`)).slice(0, 250);
  $('opsList').innerHTML = ops.map(op => {
    const gain = Number(op.ganancia || 0);
    return `<div class="op-row">
      <div><div class="op-title">${escapeHtml(op.tipo || '')} · ${escapeHtml(op.banco || '')}</div>
      <div class="op-sub">${escapeHtml(op.fecha || '')} ${escapeHtml(op.hora || '')} · ${escapeHtml(op.moneda || 'UYU')} ${fmt(op.monto || 0, 2)} · ${fmt(op.usdt || 0, 2)} USDT</div></div>
      <div class="gain ${gain >= 0 ? 'pos' : 'neg'}">$${fmt(gain, 2)}</div>
    </div>`;
  }).join('') || '<p class="hint">Sin operaciones.</p>';
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
