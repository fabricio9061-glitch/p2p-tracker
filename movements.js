/**
 * movements.js
 * Movimientos externos: ingreso/egreso a bancos o USDT.
 */

import AppState from './state.js';
import { BANCOS_DISPONIBLES, POR_PAGINA } from './config.js';
import { $, setText, setVisible, abrirModal, cerrarModal, activarCooldown, crearPaginacion } from './ui.js';
import { fixNegativeZero, formatearNumero, getUruguayDateString, getUruguayTimeString, fechaHoraHtml } from './utils.js';
import { guardarDatos } from './firebase-service.js';
import { getBancosActivos } from './banks.js';
import { agregarLote, consumirLotesFIFO, recalcularLotesYGanancias } from './inventory.js';

// ─── Paginación ───

export const paginacionMov = crearPaginacion({
    getTotal: () => AppState.datos.movimientos.length,
    getPagina: () => AppState.ui.paginaMov,
    setPagina: (p) => { AppState.ui.paginaMov = p; },
    porPagina: POR_PAGINA,
    paginationId: 'paginationMov',
    infoId: 'paginaInfoMov',
    prevBtnId: 'btnPrevMov',
    nextBtnId: 'btnNextMov',
    onRender: renderizarTablaMovimientos
});

// ─── UI del modal ───

export function abrirModalMovimiento() {
    AppState.ui.guardandoMovimiento = false;
    AppState.ui.tipoMovimiento = 'ingreso';
    $('tabIngreso').className = 'tab tab-ingreso active';
    $('tabEgreso').className = 'tab tab-egreso';
    $('movTipoCuenta').value = 'banco';
    $('movMonto').value = '';
    $('movTasaRef').value = '';
    $('movDescripcion').value = '';
    $('btnGuardarMov').disabled = false;
    $('btnGuardarMov').textContent = 'Guardar';
    actualizarCuentasMovimiento();
    abrirModal('modalMovimiento');
}

export function cerrarModalMovimiento() {
    cerrarModal('modalMovimiento');
}

export function setTipoMovimiento(t) {
    AppState.ui.tipoMovimiento = t;
    $('tabIngreso').className = 'tab tab-ingreso' + (t === 'ingreso' ? ' active' : '');
    $('tabEgreso').className = 'tab tab-egreso' + (t === 'egreso' ? ' active' : '');
    actualizarCuentasMovimiento();
}

export function actualizarCuentasMovimiento() {
    const tc = $('movTipoCuenta')?.value;
    setVisible('movBancoGroup', tc !== 'usdt');
    setText('movMontoLabel', tc === 'usdt' ? 'Monto (USDT)' : 'Monto');

    const showTasa = tc === 'usdt';
    setVisible('movTasaRefGroup', showTasa);

    if (showTasa) {
        $('movTasaRef').value = AppState.datos.ultimaTasaCompra || '';
        setText('movTasaRefLabel',
            AppState.ui.tipoMovimiento === 'ingreso'
                ? 'Tasa referencia (precio de compra)'
                : 'Tasa referencia (para cálculo UYU)');
    }

    if (tc !== 'usdt') {
        const s = $('movBanco');
        if (s) {
            s.innerHTML = '<option value="">Seleccionar banco</option>';
            getBancosActivos().forEach(b => {
                s.innerHTML += `<option value="${b.nombre}">${b.nombre}</option>`;
            });
        }
    }
}

// ─── Guardar movimiento ───

export async function guardarMovimiento(actualizarVista) {
    if (AppState.ui.guardandoMovimiento || AppState.ui.enCooldown) return;

    const btn = $('btnGuardarMov');
    const tc = $('movTipoCuenta').value;
    const b = $('movBanco').value;
    const m = parseFloat($('movMonto').value);
    const desc = $('movDescripcion').value;
    const f = getUruguayDateString();
    const tasaRef = tc === 'usdt' ? parseFloat($('movTasaRef').value) || 0 : 0;

    // Validaciones
    if (!m || m <= 0) return alert('Monto inválido');
    if (tc === 'banco' && !b) return alert('Seleccioná un banco');
    if (tc === 'usdt' && AppState.ui.tipoMovimiento === 'ingreso' && (!tasaRef || tasaRef <= 0)) {
        return alert('Ingresá una tasa de referencia válida');
    }

    AppState.ui.guardandoMovimiento = true;
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        const movId = Date.now();
        let valorUYU = m;
        if (tc === 'usdt') {
            valorUYU = m * (tasaRef || AppState.datos.ultimaTasaCompra || 1);
        }

        const movData = {
            id: movId,
            tipoMovimiento: AppState.ui.tipoMovimiento,
            tipoCuenta: tc,
            banco: tc === 'banco' ? b : null,
            monto: m,
            valorUYU: AppState.ui.tipoMovimiento === 'egreso' ? valorUYU : 0,
            tasaRef: tc === 'usdt' ? tasaRef : 0,
            descripcion: desc,
            fecha: f,
            hora: getUruguayTimeString(),
            timestamp: new Date().toISOString()
        };

        if (tc === 'usdt') {
            if (AppState.ui.tipoMovimiento === 'ingreso') {
                agregarLote(movId, f, getUruguayTimeString(), tasaRef, m);
            } else {
                if (AppState.datos.saldoUsdt < m && !confirm(`Solo tenés ${formatearNumero(AppState.datos.saldoUsdt, 2)} USDT en inventario. ¿Continuar?`)) {
                    AppState.ui.guardandoMovimiento = false;
                    btn.disabled = false;
                    btn.textContent = 'Guardar';
                    return;
                }
                consumirLotesFIFO(m);
            }
            AppState.sincronizarSaldoUsdt();
        } else {
            AppState.datos.bancos[b].saldo = fixNegativeZero(
                AppState.datos.bancos[b].saldo + (AppState.ui.tipoMovimiento === 'ingreso' ? m : -m)
            );
        }

        AppState.datos.movimientos.unshift(movData);
        await guardarDatos();
        actualizarVista();
        cerrarModalMovimiento();
        activarCooldown();
    } finally {
        AppState.ui.guardandoMovimiento = false;
        btn.disabled = false;
        btn.textContent = 'Guardar';
    }
}

// ─── Eliminar movimiento ───

export async function eliminarMovimiento(id, actualizarVista) {
    if (!confirm('¿Eliminar?')) return;

    const mov = AppState.datos.movimientos.find(m => m.id === id);
    if (mov) {
        if (mov.tipoCuenta === 'usdt') {
            AppState.datos.movimientos = AppState.datos.movimientos.filter(m => m.id !== id);
            recalcularLotesYGanancias();
        } else {
            if (mov.banco && AppState.datos.bancos[mov.banco]) {
                AppState.datos.bancos[mov.banco].saldo = fixNegativeZero(
                    AppState.datos.bancos[mov.banco].saldo + (mov.tipoMovimiento === 'ingreso' ? -mov.monto : mov.monto)
                );
            }
            AppState.datos.movimientos = AppState.datos.movimientos.filter(m => m.id !== id);
        }
    } else {
        AppState.datos.movimientos = AppState.datos.movimientos.filter(m => m.id !== id);
    }

    await guardarDatos();
    actualizarVista();
}

// ─── Renderizado de tabla ───

function renderizarTablaMovimientos(inicio, fin) {
    const total = AppState.datos.movimientos.length;
    setText('totalMovimientos', total);

    const sec = $('seccionMovimientos');
    if (!total) { if (sec) sec.style.display = 'none'; return; }
    if (sec) sec.style.display = 'block';

    const movs = AppState.datos.movimientos.slice(inicio, fin);
    let h = '<table><thead><tr><th>Tipo</th><th>Cuenta</th><th>Monto</th><th>Desc</th><th>Fecha</th><th></th></tr></thead><tbody>';

    movs.forEach(m => {
        const badge = m.tipoMovimiento === 'ingreso'
            ? '<span class="badge badge-ingreso"><b>Ingreso</b></span>'
            : '<span class="badge badge-egreso"><b>Egreso</b></span>';
        const montoStr = m.tipoCuenta === 'usdt'
            ? formatearNumero(m.monto) + ' USDT'
            : '$' + formatearNumero(m.monto);

        h += `<tr>
            <td>${badge}</td>
            <td>${m.tipoCuenta === 'usdt' ? '🪙 USDT' : m.banco}</td>
            <td><b>${montoStr}</b></td>
            <td style="color:#64748b;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.descripcion || '-'}</td>
            <td>${fechaHoraHtml(m.fecha, m.hora)}</td>
            <td><button class="btn-delete" data-action="eliminar-movimiento" data-id="${m.id}">×</button></td>
        </tr>`;
    });

    $('movimientosContent').innerHTML = h + '</tbody></table>';
}

export function actualizarTablaMovimientos() {
    paginacionMov.render();
}
