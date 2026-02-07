/**
 * transfers.js
 * Transferencias entre bancos.
 */

import AppState from './state.js';
import { BANCOS_DISPONIBLES, POR_PAGINA, getBancoInfo, getSimboloMoneda } from './config.js';
import { $, setText, setVisible, abrirModal, cerrarModal, activarCooldown, crearPaginacion } from './ui.js';
import { fixNegativeZero, formatearNumero, getUruguayDateString, getUruguayTimeString, fechaHoraHtml } from './utils.js';
import { guardarDatos } from './firebase-service.js';
import { getBancosActivos, mostrarSaldoOrigen } from './banks.js';

// ─── Paginación ───

export const paginacionTrans = crearPaginacion({
    getTotal: () => AppState.datos.transferencias.length,
    getPagina: () => AppState.ui.paginaTrans,
    setPagina: (p) => { AppState.ui.paginaTrans = p; },
    porPagina: POR_PAGINA,
    paginationId: 'paginationTrans',
    infoId: 'paginaInfoTrans',
    prevBtnId: 'btnPrevTrans',
    nextBtnId: 'btnNextTrans',
    onRender: renderizarTablaTransferencias
});

// ─── Modal transferencia ───

export function abrirModalTransferencia() {
    $('montoTransferencia').value = '';
    $('comisionTransferencia').value = '0';

    const opts = '<option value="">Seleccionar</option>' +
        getBancosActivos().map(b => `<option value="${b.nombre}">${b.nombre}</option>`).join('');

    $('bancoOrigen').innerHTML = opts;
    $('bancoDestino').innerHTML = opts;
    $('saldoOrigenInfo').textContent = '';
    $('btnTransferir').disabled = false;
    abrirModal('modalTransferencia');
}

export function cerrarModalTransferencia() {
    cerrarModal('modalTransferencia');
}

// ─── Realizar transferencia ───

export async function realizarTransferencia(actualizarVista) {
    if (AppState.ui.enCooldown) return;
    const btn = $('btnTransferir');
    if (!btn || btn.disabled) return;

    const o = $('bancoOrigen').value;
    const d = $('bancoDestino').value;
    const m = parseFloat($('montoTransferencia').value);
    const c = parseFloat($('comisionTransferencia').value) || 0;
    const f = getUruguayDateString();

    if (!o || !d || o === d) return alert('Seleccioná bancos diferentes');
    if (!m || m <= 0) return alert('Monto inválido');

    // Validar límite diario del origen
    if (AppState.datos.bancos[o].limiteDiarioUSD > 0) {
        const bancoOrigenInfo = getBancoInfo(o);
        let montoUSD = 0;
        if (bancoOrigenInfo?.moneda === 'USD') montoUSD = m + c;
        else if (AppState.datos.ultimaTasaCompra > 0) montoUSD = (m + c) / AppState.datos.ultimaTasaCompra;

        const disponibleUSD = AppState.datos.bancos[o].limiteDiarioUSD - (AppState.datos.bancos[o].limiteUsadoUSD || 0);
        if (montoUSD > disponibleUSD) {
            alert(`Excede el límite diario de ${o}. Disponible: US$${formatearNumero(disponibleUSD, 0)} (necesitás US$${formatearNumero(montoUSD, 0)})`);
            return;
        }
    }

    btn.disabled = true;
    btn.textContent = 'Transfiriendo...';

    try {
        AppState.datos.transferencias.unshift({
            id: Date.now(), origen: o, destino: d, monto: m, comision: c,
            fecha: f, hora: getUruguayTimeString(),
            timestamp: new Date().toISOString()
        });

        AppState.datos.bancos[o].saldo = fixNegativeZero(AppState.datos.bancos[o].saldo - (m + c));
        AppState.datos.bancos[d].saldo = fixNegativeZero(AppState.datos.bancos[d].saldo + m);

        // Descontar del límite diario del origen
        if (AppState.datos.bancos[o].limiteDiarioUSD > 0) {
            const bancoOrigenInfo = getBancoInfo(o);
            let montoUSD = 0;
            if (bancoOrigenInfo?.moneda === 'USD') montoUSD = m + c;
            else if (AppState.datos.ultimaTasaCompra > 0) montoUSD = (m + c) / AppState.datos.ultimaTasaCompra;

            if (montoUSD > 0) {
                AppState.datos.bancos[o].limiteUsadoUSD = Math.min(
                    AppState.datos.bancos[o].limiteDiarioUSD,
                    (AppState.datos.bancos[o].limiteUsadoUSD || 0) + montoUSD
                );
            }
        }

        await guardarDatos();
        actualizarVista();
        cerrarModalTransferencia();
        activarCooldown();
    } finally {
        btn.disabled = false;
        btn.textContent = 'Transferir';
    }
}

// ─── Eliminar transferencia ───

export async function eliminarTransferencia(id, actualizarVista) {
    if (!confirm('¿Eliminar?')) return;

    const t = AppState.datos.transferencias.find(x => x.id === id);
    if (t) {
        AppState.datos.bancos[t.origen].saldo = fixNegativeZero(
            AppState.datos.bancos[t.origen].saldo + (t.monto + t.comision)
        );
        AppState.datos.bancos[t.destino].saldo = fixNegativeZero(
            AppState.datos.bancos[t.destino].saldo - t.monto
        );

        // Revertir límite diario
        if (AppState.datos.bancos[t.origen].limiteDiarioUSD > 0) {
            const bancoOrigenInfo = getBancoInfo(t.origen);
            let montoUSD = 0;
            if (bancoOrigenInfo?.moneda === 'USD') montoUSD = t.monto + t.comision;
            else if (AppState.datos.ultimaTasaCompra > 0) montoUSD = (t.monto + t.comision) / AppState.datos.ultimaTasaCompra;

            if (montoUSD > 0) {
                AppState.datos.bancos[t.origen].limiteUsadoUSD = Math.max(
                    0, (AppState.datos.bancos[t.origen].limiteUsadoUSD || 0) - montoUSD
                );
            }
        }
    }

    AppState.datos.transferencias = AppState.datos.transferencias.filter(x => x.id !== id);
    await guardarDatos();
    actualizarVista();
}

// ─── Renderizado de tabla ───

function renderizarTablaTransferencias(inicio, fin) {
    const total = AppState.datos.transferencias.length;
    setText('totalTransferencias', total);

    const sec = $('seccionTransferencias');
    if (!total) { if (sec) sec.style.display = 'none'; return; }
    if (sec) sec.style.display = 'block';

    const trans = AppState.datos.transferencias.slice(inicio, fin);
    let h = '<table><thead><tr><th>Origen</th><th>Destino</th><th>Monto</th><th>Com</th><th>Fecha</th><th></th></tr></thead><tbody>';

    trans.forEach(tr => {
        const origenInfo = getBancoInfo(tr.origen);
        const sym = getSimboloMoneda(origenInfo?.moneda);

        h += `<tr>
            <td style="color:#dc2626">${tr.origen}</td>
            <td style="color:#16a34a">${tr.destino}</td>
            <td><b>${sym}${formatearNumero(tr.monto)}</b></td>
            <td style="color:#ea580c">${tr.comision > 0 ? sym + formatearNumero(tr.comision) : '-'}</td>
            <td>${fechaHoraHtml(tr.fecha, tr.hora)}</td>
            <td><button class="btn-delete" data-action="eliminar-transferencia" data-id="${tr.id}">×</button></td>
        </tr>`;
    });

    $('transferenciasContent').innerHTML = h + '</tbody></table>';
}

export function actualizarTablaTransferencias() {
    paginacionTrans.render();
}
