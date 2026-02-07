/**
 * inventory.js
 * Gestión de inventario USDT con sistema FIFO.
 * Lotes, recálculo de ganancias, renderizado.
 */

import AppState from './state.js';
import { $, setHtml, abrirModal, cerrarModal } from './ui.js';
import { fixNegativeZero, truncar, formatearNumero, getUruguayDateString, getUruguayTimeString } from './utils.js';
import { guardarDatos } from './firebase-service.js';

// ─── Consumo FIFO ───

/**
 * Consume USDT de los lotes usando FIFO.
 * Retorna la ganancia acumulada por la diferencia de precio.
 */
export function consumirLotesFIFO(cantidad, precioVenta) {
    let restante = cantidad;
    let ganancia = 0;
    const lotesOrdenados = AppState.getLotesActivosFIFO();

    for (const lote of lotesOrdenados) {
        if (restante <= 0) break;
        const consumido = Math.min(lote.disponible, restante);
        if (precioVenta !== undefined) {
            ganancia += consumido * (precioVenta - lote.precioCompra);
        }
        lote.disponible = fixNegativeZero(lote.disponible - consumido);
        restante = fixNegativeZero(restante - consumido);
    }

    return ganancia;
}

/**
 * Agrega o acumula un lote en el inventario.
 */
export function agregarLote(id, fecha, hora, precioCompra, cantidad) {
    const existente = AppState.datos.lotes.find(
        l => l.precioCompra === precioCompra && l.disponible > 0
    );

    if (existente) {
        existente.cantidad += cantidad;
        existente.disponible += cantidad;
    } else {
        AppState.datos.lotes.push({
            id, fecha, hora, precioCompra,
            cantidad, disponible: cantidad
        });
    }
}

// ─── Recálculo completo ───

/**
 * Recalcula todos los lotes y ganancias desde cero
 * a partir de operaciones y movimientos.
 */
export function recalcularLotesYGanancias() {
    AppState.datos.lotes = [];

    // Construir timeline de eventos
    const eventos = [];

    AppState.datos.operaciones.forEach(op => {
        eventos.push({ tipo: 'operacion', fecha: op.fecha, hora: op.hora || '00:00', data: op });
    });

    AppState.datos.movimientos.filter(m => m.tipoCuenta === 'usdt').forEach(m => {
        eventos.push({
            tipo: m.tipoMovimiento === 'ingreso' ? 'movimiento_ingreso' : 'movimiento_egreso',
            fecha: m.fecha, hora: m.hora || '00:00', data: m
        });
    });

    eventos.sort((a, b) => {
        const fa = a.fecha + (a.hora || '00:00');
        const fb = b.fecha + (b.hora || '00:00');
        return fa.localeCompare(fb);
    });

    let ultimaTasaCompraLocal = AppState.datos.ultimaTasaCompra || 0;
    let ultimaTasaCompraUSDLocal = AppState.datos.ultimaTasaCompraUSD || 0;

    eventos.forEach(ev => {
        if (ev.tipo === 'operacion') {
            const op = ev.data;
            const comisionPct = (op.comisionPct || 0.14) / 100;
            const cp = truncar(op.usdt * comisionPct, 2);
            const isUSD = op.moneda === 'USD';

            if (op.tipo === 'compra') {
                const usdtNetos = op.usdt - cp;
                if (isUSD) ultimaTasaCompraUSDLocal = op.tasa;
                else ultimaTasaCompraLocal = op.tasa;
                agregarLote(op.id, op.fecha, op.hora || '00:00', op.tasa, usdtNetos);
                op.ganancia = -(op.comisionBanco || 0);
            } else {
                const usdtAVender = op.usdt + cp;
                op.ganancia = consumirLotesFIFO(usdtAVender, op.tasa);
                if (isUSD) AppState.datos.ultimaTasaVentaUSD = op.tasa;
                else AppState.datos.ultimaTasaVenta = op.tasa;
            }
        } else if (ev.tipo === 'movimiento_ingreso') {
            const m = ev.data;
            const precio = m.tasaRef || ultimaTasaCompraLocal || 1;
            agregarLote(m.id, m.fecha, m.hora || '00:00', precio, m.monto);
        } else if (ev.tipo === 'movimiento_egreso') {
            consumirLotesFIFO(ev.data.monto);
        }
    });

    AppState.datos.ultimaTasaCompra = ultimaTasaCompraLocal;
    AppState.datos.ultimaTasaCompraUSD = ultimaTasaCompraUSDLocal;
    AppState.sincronizarSaldoUsdt();
}

// ─── UI del inventario ───

export function renderizarInventario() {
    const lotesActivos = AppState.getLotesActivosFIFO();

    if (lotesActivos.length === 0) {
        setHtml('inventarioContent', `<div style="text-align:center;padding:30px;color:#94a3b8">
            <div style="font-size:2em;margin-bottom:8px">📭</div>
            <div>Sin USDT en inventario</div>
        </div>`);
        return;
    }

    let totalUsdt = 0;
    let h = '<table style="min-width:auto"><thead><tr><th>#</th><th>Precio</th><th>Disponible</th><th>Valor</th><th></th></tr></thead><tbody>';

    lotesActivos.forEach((lote, i) => {
        totalUsdt += lote.disponible;
        const valor = lote.disponible * lote.precioCompra;
        h += `<tr>
            <td style="color:#64748b">${i + 1}</td>
            <td><b>$${formatearNumero(lote.precioCompra)}</b></td>
            <td style="color:#2563eb"><b>${formatearNumero(lote.disponible, 2)}</b></td>
            <td style="color:#64748b">$${formatearNumero(valor, 0)}</td>
            <td><button class="btn-edit-small" data-action="editar-lote" data-lote-id="${lote.id}">✏️</button></td>
        </tr>`;
    });

    h += '</tbody></table>';
    h += `<div style="margin-top:12px;padding:10px;background:#eff6ff;border-radius:8px;display:flex;justify-content:space-between">
        <span style="color:#64748b">Total en inventario:</span>
        <span style="color:#2563eb;font-weight:bold">${formatearNumero(totalUsdt, 2)} USDT</span>
    </div>`;

    setHtml('inventarioContent', h);
}

// ─── Modal editar lote ───

export function abrirEditarLote(id) {
    AppState.ui.loteEditandoId = id;
    const lote = id ? AppState.datos.lotes.find(l => l.id === id) : null;

    if (lote) {
        $('editarLoteHeader').textContent = '✏️ Editar Lote';
        $('lotePrecio').value = lote.precioCompra;
        $('loteDisponible').value = lote.disponible;
        $('loteFecha').value = lote.fecha || '';
        $('btnEliminarLote').style.display = 'inline-block';
    } else {
        $('editarLoteHeader').textContent = '➕ Agregar Lote';
        $('lotePrecio').value = AppState.datos.ultimaTasaCompra || '';
        $('loteDisponible').value = '';
        $('loteFecha').value = getUruguayDateString();
        $('btnEliminarLote').style.display = 'none';
    }

    abrirModal('modalEditarLote');
}

export async function guardarLote() {
    const precio = parseFloat($('lotePrecio')?.value);
    const disponible = parseFloat($('loteDisponible')?.value);
    const fecha = $('loteFecha')?.value || getUruguayDateString();

    if (!precio || precio <= 0) { alert('Ingresá un precio válido'); return; }
    if (disponible === undefined || disponible < 0 || isNaN(disponible)) { alert('Ingresá una cantidad válida'); return; }

    if (AppState.ui.loteEditandoId) {
        const lote = AppState.datos.lotes.find(l => l.id === AppState.ui.loteEditandoId);
        if (lote) {
            lote.precioCompra = precio;
            lote.disponible = disponible;
            lote.cantidad = Math.max(lote.cantidad, disponible);
            lote.fecha = fecha;
        }
    } else {
        AppState.datos.lotes.push({
            id: Date.now(),
            fecha, hora: getUruguayTimeString(),
            precioCompra: precio,
            cantidad: disponible,
            disponible
        });
    }

    AppState.sincronizarSaldoUsdt();
    await guardarDatos();
    renderizarInventario();
    cerrarModal('modalEditarLote');
    AppState.ui.loteEditandoId = null;
}

export async function eliminarLoteActual() {
    if (!AppState.ui.loteEditandoId) return;
    if (!confirm('¿Eliminar este lote del inventario?')) return;

    AppState.datos.lotes = AppState.datos.lotes.filter(l => l.id !== AppState.ui.loteEditandoId);
    AppState.sincronizarSaldoUsdt();
    await guardarDatos();
    renderizarInventario();
    cerrarModal('modalEditarLote');
    AppState.ui.loteEditandoId = null;
}

export async function forzarRecalculo() {
    if (!confirm('¿Recalcular todos los lotes y ganancias desde las operaciones y movimientos?')) return;
    recalcularLotesYGanancias();
    await guardarDatos();
    renderizarInventario();
    alert('✅ Lotes, saldo USDT y ganancias recalculados');
}
