import { state } from '../core/state.js';
import { fmt } from '../core/money.js';
import { computeSummary } from '../business/balances.js';

const $ = id => document.getElementById(id);
let currentFilter = 'all';

export function setStatus(text) {
  const el = $('syncStatus');
  if (el) el.textContent = text;
}

export function setOperationFilter(filter) {
  currentFilter = filter || 'all';
  for (const [id, value] of [['filterAll','all'],['filterCompra','compra'],['filterVenta','venta']]) {
    const el = $(id);
    if (el) el.classList.toggle('active', currentFilter === value);
  }
  render();
}

export function render() {
  const summary = computeSummary(state.datos);
  renderHero(summary);
  renderActivity();
  renderBanks(summary.balances);
  renderOperations();
}

function renderHero(summary) {
  setText('saldoUsdt', fmt(summary.saldoUsdt, 2));
  const totalBancos = Object.values(summary.balances || {}).reduce((s, b) => s + Number(b.saldo || 0), 0);
  setText('totalBancos', `$${fmt(totalBancos, 2)}`);
  setText('lotesCount', `${(state.datos.lotes || []).filter(l => Number(l.disponible || 0) > 0).length} lotes`);
  setText('gananciaTotal', `$${fmt(summary.gananciaTotal, 2)}`);
}

function renderActivity() {
  const month = new Date().toISOString().slice(0, 7);
  const ops = (state.datos.operaciones || []).filter(op => String(op.fecha || '').startsWith(month));
  const compras = ops.filter(op => op.tipo === 'compra');
  const ventas = ops.filter(op => op.tipo === 'venta');
  const sum = arr => arr.reduce((s, op) => s + Number(op.monto || 0), 0);
  const usdt = arr => arr.reduce((s, op) => s + Number(op.usdt || 0), 0);
  setText('comprasMonto', `$${fmt(sum(compras), 2)}`);
  setText('ventasMonto', `$${fmt(sum(ventas), 2)}`);
  setText('comprasMeta', `${compras.length} ops · ${fmt(usdt(compras), 2)} USDT`);
  setText('ventasMeta', `${ventas.length} ops · ${fmt(usdt(ventas), 2)} USDT`);
  setText('opsCount', `${state.datos.operaciones.length} ops`);
}

function renderBanks(balances) {
  const el = $('banksGrid');
  if (!el) return;
  const entries = Object.entries(balances || {}).sort((a,b) => Math.abs(b[1].saldo || 0) - Math.abs(a[1].saldo || 0));
  if (!entries.length) {
    el.innerHTML = '<div class="bank-card"><div class="bank-name">Sin bancos</div><div class="bank-sub">Creá una operación para ver saldos.</div></div>';
    return;
  }
  el.innerHTML = entries.slice(0, 8).map(([name, b], idx) => {
    const color = bankColor(idx, name);
    return `<article class="bank-card" style="--bank-color:${color}">
      <div class="bank-name">${escapeHtml(name)}</div>
      <div class="bank-money">${b.moneda === 'USD' ? 'US$' : '$'}${fmt(b.saldo || 0, 2)}</div>
      <div class="bank-sub">${escapeHtml(b.moneda || 'UYU')}</div>
    </article>`;
  }).join('');
}

function renderOperations() {
  const all = [...(state.datos.operaciones || [])].sort((a,b)=> dateKey(b).localeCompare(dateKey(a)) || String(b.id).localeCompare(String(a.id)));
  const filtered = currentFilter === 'all' ? all : all.filter(op => op.tipo === currentFilter);
  const ops = filtered.slice(0, 250);
  const el = $('opsList');
  if (!el) return;
  el.innerHTML = ops.map(op => row(op)).join('') || '<p class="hint">Sin operaciones.</p>';
}

function row(op) {
  const gain = Number(op.ganancia || 0);
  const tipo = String(op.tipo || '').toLowerCase();
  const sign = tipo === 'venta' ? '+' : '-';
  return `<div class="op-row ${tipo}">
    <div>
      <div class="op-title">${sign}$${fmt(op.monto || 0, 2)}</div>
      <div class="op-sub">$${fmt(op.tasa || 0, 2)} · ${fmt(op.usdt || 0, 2)} USDT · ${escapeHtml(op.banco || '-')} · ${fmtFechaHora(op)}</div>
    </div>
    <div class="gain ${gain >= 0 ? 'pos' : 'neg'}">${gain >= 0 ? '+' : ''}$${fmt(gain, 2)}</div>
  </div>`;
}

function fmtFechaHora(op) {
  const f = op.fecha ? String(op.fecha).split('-').reverse().slice(0,2).join('/') : '-';
  return op.hora ? `${f} · ${op.hora}` : f;
}

function dateKey(op) { return `${op.fecha || '0000-00-00'} ${op.hora || '00:00'} ${String(op.id || '')}`; }
function setText(id, value) { const el = $(id); if (el) el.textContent = value; }
function escapeHtml(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function bankColor(idx, name) {
  const map = {Itau:'#ef4444','Itaú':'#ef4444','Mercado Pago':'#3b82f6','BROU':'#2563eb','Santander':'#dc2626','Prex':'#7c3aed','OCA Blue':'#0ea5e9'};
  return map[name] || ['#2563eb','#16a34a','#f59e0b','#7c3aed','#0f766e','#dc2626'][idx % 6];
}
