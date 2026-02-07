/**
 * dashboard.js
 * Tarjetas de resumen, estadísticas del dashboard principal.
 */

import AppState from './state.js';
import { BANCOS_DISPONIBLES } from './config.js';
import { $, setText } from './ui.js';
import { formatearNumero, getUruguayDate, getUruguayDateString } from './utils.js';
import { actualizarBancosGrid, actualizarSelectBancos } from './banks.js';
import { actualizarTablaOperaciones } from './operations.js';
import { actualizarTablaMovimientos } from './movements.js';
import { actualizarTablaTransferencias } from './transfers.js';
import { calcularGananciaDiaria } from './calendar.js';

// ─── Resumen de datos ───

function calcularGananciaHoy() {
    const hoy = getUruguayDateString();
    const g = calcularGananciaDiaria();
    return g[hoy] || 0;
}

function calcularResumen() {
    const hoy = getUruguayDate();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const opsMes = AppState.datos.operaciones.filter(op => op.fecha && op.fecha.startsWith(mesActual));

    let tp = 0, tr = 0, stc = 0, stv = 0, cc = 0, cv = 0;

    opsMes.forEach(op => {
        if (op.tipo === 'compra') {
            tp += op.monto + (op.comisionBanco || 0);
            stc += op.tasa;
            cc++;
        } else {
            tr += op.monto;
            stv += op.tasa;
            cv++;
        }
    });

    const tpc = cc ? stc / cc : 0;
    const tpv = cv ? stv / cv : 0;
    const sp = tpv - tpc;

    let tb = 0;
    BANCOS_DISPONIBLES.forEach(b => {
        if (AppState.datos.bancos[b.nombre]?.activo && b.moneda === 'UYU') {
            tb += AppState.datos.bancos[b.nombre].saldo;
        }
    });

    const hoyStr = getUruguayDateString();
    const opsHoy = AppState.datos.operaciones.filter(o => o.fecha === hoyStr).length;

    return {
        totalPagado: tp, totalRecibido: tr,
        tasaPromC: tpc, tasaPromV: tpv,
        spread: sp, pctSpread: tpc ? (sp / tpc) * 100 : 0,
        totalBancosUYU: tb, opsHoy, mesActual
    };
}

// ─── Actualizar vista completa ───

export function actualizarVista() {
    const r = calcularResumen();

    // Ganancia hoy
    const gananciaHoy = calcularGananciaHoy();
    const ghEl = $('gananciaHoy');
    const cardHoy = $('cardGananciaHoy');

    if (gananciaHoy >= 0) {
        ghEl.textContent = '+$' + formatearNumero(gananciaHoy);
        ghEl.className = 'card-value positive';
        cardHoy.className = 'card main-card';
    } else {
        ghEl.textContent = '-$' + formatearNumero(Math.abs(gananciaHoy));
        ghEl.className = 'card-value negative';
        cardHoy.className = 'card main-card negative';
    }

    // Fecha
    const uruguayDate = getUruguayDate();
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    setText('fechaHoy', diasSemana[uruguayDate.getDay()] + ' ' + uruguayDate.getDate() + '/' + (uruguayDate.getMonth() + 1));
    setText('opsHoy', r.opsHoy + ' ops hoy');

    // USDT y bancos
    setText('usdtEnTenencia', formatearNumero(Math.max(0, AppState.datos.saldoUsdt), 2));
    setText('totalBancos', '$' + formatearNumero(r.totalBancosUYU, 0));

    // Compras
    setText('totalPagado', '$' + formatearNumero(r.totalPagado, 0));
    setText('tasaPromCompra', 'Prom: $' + formatearNumero(r.tasaPromC));

    // Mes actual en tarjetas
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const mesNum = parseInt(r.mesActual.split('-')[1]) - 1;
    setText('mesCompras', '(' + meses[mesNum] + ')');
    setText('mesVentas', '(' + meses[mesNum] + ')');

    // Lotes info
    const lotesActivos = AppState.datos.lotes.filter(l => l.disponible > 0);
    if (lotesActivos.length > 0) {
        const loteMasBarato = lotesActivos.reduce(
            (min, l) => l.precioCompra < min.precioCompra ? l : min, lotesActivos[0]
        );
        setText('loteMasBarato', 'Min: $' + formatearNumero(loteMasBarato.precioCompra));
        setText('lotesDisponibles', lotesActivos.length + ' lotes');
    } else {
        setText('loteMasBarato', 'Sin stock');
        setText('lotesDisponibles', '0 lotes');
    }

    // Ventas
    setText('totalRecibido', '$' + formatearNumero(r.totalRecibido, 0));
    setText('tasaPromVenta', 'Prom: $' + formatearNumero(r.tasaPromV));

    // Spread
    setText('spreadPromedio', '$' + formatearNumero(r.spread));
    setText('porcentajeSpread', formatearNumero(r.pctSpread, 1) + '%');

    // Sub-componentes
    actualizarBancosGrid();
    actualizarSelectBancos();
    actualizarTablaOperaciones();
    actualizarTablaMovimientos();
    actualizarTablaTransferencias();
}
