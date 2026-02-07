/**
 * calendar.js
 * Vista de calendario con ganancia/pérdida diaria y resumen mensual.
 */

import AppState from './state.js';
import { $, setHtml, abrirModal, cerrarModal } from './ui.js';
import { formatearNumero } from './utils.js';

// ─── Cálculos de ganancia ───

/**
 * Calcula la ganancia por día (objeto { 'YYYY-MM-DD': valor }).
 */
export function calcularGananciaDiaria() {
    const g = {};

    AppState.datos.operaciones.forEach(op => {
        if (!g[op.fecha]) g[op.fecha] = 0;
        if (op.ganancia !== undefined) g[op.fecha] += op.ganancia;
    });

    AppState.datos.movimientos.forEach(mov => {
        if (mov.tipoMovimiento === 'egreso') {
            if (!g[mov.fecha]) g[mov.fecha] = 0;
            if (mov.tipoCuenta === 'usdt') {
                const valorUYU = mov.valorUYU || (mov.monto * (AppState.datos.ultimaTasaCompra || 1));
                g[mov.fecha] -= valorUYU;
            } else {
                g[mov.fecha] -= mov.monto;
            }
        }
    });

    return g;
}

/**
 * Calcula la ganancia total acumulada.
 */
export function calcularGananciaTotal() {
    let ganancia = 0;

    AppState.datos.operaciones.forEach(op => {
        if (op.ganancia !== undefined) ganancia += op.ganancia;
    });

    AppState.datos.movimientos.forEach(mov => {
        if (mov.tipoMovimiento === 'egreso') {
            if (mov.tipoCuenta === 'usdt') {
                ganancia -= mov.valorUYU || (mov.monto * (AppState.datos.ultimaTasaCompra || 1));
            } else {
                ganancia -= mov.monto;
            }
        }
    });

    return ganancia;
}

// ─── Renderizado del calendario ───

export function renderizarCalendario() {
    const y = AppState.ui.calendarDate.getFullYear();
    const mo = AppState.ui.calendarDate.getMonth();
    $('calendarMonth').textContent = `${y}-${String(mo + 1).padStart(2, '0')}`;

    const fd = new Date(y, mo, 1).getDay();
    const dm = new Date(y, mo + 1, 0).getDate();
    const hoy = new Date();
    const g = calcularGananciaDiaria();
    let h = '';
    let tg = 0, tp = 0;

    for (let i = 0; i < fd; i++) h += '<div class="calendar-day empty"></div>';

    for (let d = 1; d <= dm; d++) {
        const ds = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const val = g[ds] || 0;
        const isHoy = hoy.getFullYear() === y && hoy.getMonth() === mo && hoy.getDate() === d;

        let cls = 'calendar-day';
        if (val > 0) { cls += ' positive'; tg += val; }
        else if (val < 0) { cls += ' negative'; tp += Math.abs(val); }
        if (isHoy) cls += ' today';

        const vs = val !== 0 ? (val > 0 ? '+' : '') + formatearNumero(val, 0) : '0';
        const vc = val > 0 ? 'pos' : val < 0 ? 'neg' : '';

        h += `<div class="${cls}">
            <div class="calendar-day-number">${d}</div>
            <div class="calendar-day-value ${vc}">${vs}</div>
        </div>`;
    }

    setHtml('calendarDays', h);

    // Resumen
    const gananciaTotal = calcularGananciaTotal();
    const gtEl = $('calGananciaTotal');
    gtEl.textContent = (gananciaTotal >= 0 ? '+' : '-') + '$' + formatearNumero(Math.abs(gananciaTotal), 0);
    gtEl.className = 'calendar-stat-value ' + (gananciaTotal >= 0 ? 'positive' : 'negative');

    $('calGanancias').textContent = '+$' + formatearNumero(tg, 0);
    $('calPerdidas').textContent = '-$' + formatearNumero(tp, 0);
}

// ─── Controles ───

export function abrirCalendario() {
    AppState.ui.calendarDate = new Date();
    renderizarCalendario();
    abrirModal('modalCalendario');
}

export function cerrarCalendario() {
    cerrarModal('modalCalendario');
}

export function cambiarMes(dir) {
    AppState.ui.calendarDate.setMonth(AppState.ui.calendarDate.getMonth() + dir);
    renderizarCalendario();
}
