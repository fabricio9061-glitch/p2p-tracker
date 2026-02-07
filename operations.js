/**
 * operations.js
 * Lógica de compra/venta de USDT.
 * Formulario, preview, agregar y eliminar operaciones.
 */

import AppState from './state.js';
import { BANCOS_DISPONIBLES, getBancoInfo } from './config.js';
import { $, setText, activarCooldown, crearPaginacion } from './ui.js';
import {
    fixNegativeZero, truncar, formatearNumero, formatearTasa,
    parsearTasa, parsearComision, getUruguayDateString, getUruguayTimeString, fechaHoraHtml
} from './utils.js';
import { guardarDatos } from './firebase-service.js';
import { getMonedaBancoSeleccionado, getComisionActual, getComisionDecimal, mostrarSaldoBanco } from './banks.js';
import { agregarLote, consumirLotesFIFO, recalcularLotesYGanancias } from './inventory.js';
import { POR_PAGINA } from './config.js';

// ─── Paginación ───

export const paginacionOp = crearPaginacion({
    getTotal: () => AppState.datos.operaciones.length,
    getPagina: () => AppState.ui.paginaOp,
    setPagina: (p) => { AppState.ui.paginaOp = p; },
    porPagina: POR_PAGINA,
    paginationId: 'paginationOp',
    infoId: 'paginaInfoOp',
    prevBtnId: 'btnPrevOp',
    nextBtnId: 'btnNextOp',
    onRender: renderizarTablaOperaciones
});

// ─── Formulario ───

export function actualizarColorSelect() {
    const sel = $('tipo');
    if (sel) sel.style.color = sel.value === 'compra' ? '#16a34a' : '#dc2626';
}

export function actualizarFormulario() {
    const t = $('tipo')?.value;
    const moneda = getMonedaBancoSeleccionado();
    const isUSD = moneda === 'USD';

    setText('montoLabel', t === 'compra' ? `Pagás (${moneda})` : `Recibís (${moneda})`);
    setText('bancoLabel', t === 'compra' ? 'Sale de *' : 'Entra a *');

    const comisionBancoGroup = $('comisionBancoGroup');
    if (comisionBancoGroup) comisionBancoGroup.style.display = t === 'compra' ? 'block' : 'none';
    if (t === 'venta') { const cb = $('comisionBanco'); if (cb) cb.value = '0'; }

    // Actualizar tasa si no está enfocado
    const tasaInput = $('tasa');
    if (tasaInput && document.activeElement !== tasaInput) {
        const tasa = t === 'compra'
            ? (isUSD ? AppState.datos.ultimaTasaCompraUSD : AppState.datos.ultimaTasaCompra)
            : (isUSD ? AppState.datos.ultimaTasaVentaUSD : AppState.datos.ultimaTasaVenta);
        tasaInput.value = tasa > 0 ? formatearTasa(tasa, moneda) : '';
    }

    setText('tasaHelp', isUSD ? 'Ej: 1.025' : 'Ej: 39.50');

    // Actualizar comisión si no está enfocado
    const comInput = $('comisionPlataforma');
    if (comInput && document.activeElement !== comInput) {
        const comVal = isUSD ? AppState.datos.comisionUSD : AppState.datos.comisionPlataforma;
        comInput.value = comVal.toFixed(2);
        setText('comisionPctLabel', comVal.toFixed(2));
    }

    calcularPreview();
}

export function calcularPreview() {
    const t = $('tipo')?.value;
    const m = parseFloat($('monto')?.value) || 0;
    const ta = parsearTasa($('tasa')?.value);
    const comisionPct = getComisionDecimal();
    const moneda = getMonedaBancoSeleccionado();
    const isUSD = moneda === 'USD';

    const tasaInput = $('tasa');
    if (tasaInput) tasaInput.classList.remove('error');
    const tasaHelp = $('tasaHelp');
    if (tasaHelp) {
        tasaHelp.className = '';
        tasaHelp.textContent = isUSD ? 'Ej: 1.025' : 'Ej: 39.50';
    }

    if (m > 0 && ta) {
        const u = m / ta;
        const c = truncar(u * comisionPct, 2);
        setText('comisionPlataformaInfo', formatearNumero(c, 2) + ' USDT');

        const previewText = $('previewText');
        if (previewText) {
            previewText.innerHTML = t === 'compra'
                ? `📥 Recibís <b>${formatearNumero(u - c, 2)} USDT</b>`
                : `📤 Entregás <b>${formatearNumero(u + c, 2)} USDT</b>`;
        }
        const previewBox = $('previewBox');
        if (previewBox) previewBox.style.display = 'block';
    } else {
        const previewBox = $('previewBox');
        if (previewBox) previewBox.style.display = 'none';
        setText('comisionPlataformaInfo', '0 USDT');
    }
}

export function guardarComisionYCalcular() {
    const input = $('comisionPlataforma');
    if (!input) return;
    const raw = input.value.replace(',', '.').trim();

    if (raw !== '' && raw !== '.') {
        const valor = parsearComision(raw);
        if (valor !== null) {
            const moneda = getMonedaBancoSeleccionado();
            if (moneda === 'USD') {
                AppState.datos.comisionUSD = valor;
            } else {
                AppState.datos.comisionPlataforma = valor;
            }
            setText('comisionPctLabel', valor.toFixed(2));

            clearTimeout(AppState.ui.comisionDebounce);
            AppState.ui.comisionDebounce = setTimeout(() => guardarDatos(), 1200);
        }
    }
    calcularPreview();
}

// ─── Agregar operación ───

export async function agregarOperacion(actualizarVista) {
    if (AppState.ui.enCooldown) return;
    const btn = $('btnAgregarOp');
    if (!btn || btn.disabled) return;

    const t = $('tipo').value;
    const m = parseFloat($('monto').value);
    const tasaInput = $('tasa');
    const ta = parsearTasa(tasaInput.value);
    const b = $('banco').value;
    const cb = parseFloat($('comisionBanco').value) || 0;
    const f = getUruguayDateString();
    const h = getUruguayTimeString();
    const moneda = getMonedaBancoSeleccionado();
    const isUSD = moneda === 'USD';
    const comisionPctVal = getComisionActual();
    const comisionPct = comisionPctVal / 100;

    // Validaciones
    if (!m) { alert('Ingresá el monto'); return; }
    if (!ta) {
        tasaInput.classList.add('error');
        const help = $('tasaHelp');
        if (help) { help.textContent = 'Formato inválido'; help.className = 'error-text'; }
        alert('Tasa inválida (ej: ' + (isUSD ? '1.025' : '39.50') + ')');
        return;
    }
    if (!b) {
        const bancoHelp = $('bancoHelp');
        if (bancoHelp) { bancoHelp.textContent = 'Seleccioná un banco'; bancoHelp.className = 'error-text'; }
        $('banco')?.classList.add('error');
        alert('Seleccioná un banco');
        return;
    }
    $('banco')?.classList.remove('error');

    const u = m / ta;
    const cp = truncar(u * comisionPct, 2);

    // Validaciones de saldo/límite
    if (t === 'compra') {
        const banco = AppState.datos.bancos[b];
        if (banco.limiteDiarioUSD > 0) {
            const montoUSD = isUSD ? m : m / ta;
            const disponibleUSD = banco.limiteDiarioUSD - (banco.limiteUsadoUSD || 0);
            if (montoUSD > disponibleUSD) {
                alert(`Excede el límite diario. Disponible: US$${formatearNumero(disponibleUSD, 0)} (${formatearNumero(montoUSD, 2)} USD requeridos)`);
                return;
            }
        }
        if (banco.saldo < m + cb && !confirm('Saldo insuficiente en ' + b + '. ¿Continuar?')) return;
    } else {
        const usdtNecesarios = u + cp;
        if (AppState.datos.saldoUsdt < usdtNecesarios && !confirm(`Solo tenés ${formatearNumero(AppState.datos.saldoUsdt, 2)} USDT. ¿Continuar?`)) return;
    }

    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        const opId = Date.now();
        let gananciaOp = 0;

        if (t === 'compra') {
            const usdtNetos = u - cp;
            agregarLote(opId, f, h, ta, usdtNetos);
            if (isUSD) AppState.datos.ultimaTasaCompraUSD = ta;
            else AppState.datos.ultimaTasaCompra = ta;
            AppState.datos.bancos[b].saldo = fixNegativeZero(AppState.datos.bancos[b].saldo - (m + cb));
            AppState.sincronizarSaldoUsdt();
            if (AppState.datos.bancos[b].limiteDiarioUSD > 0) {
                const montoUSD = isUSD ? m : m / ta;
                AppState.datos.bancos[b].limiteUsadoUSD = Math.min(
                    AppState.datos.bancos[b].limiteDiarioUSD,
                    (AppState.datos.bancos[b].limiteUsadoUSD || 0) + montoUSD
                );
            }
            gananciaOp = -cb;
        } else {
            const usdtAVender = u + cp;
            gananciaOp = consumirLotesFIFO(usdtAVender, ta);
            if (isUSD) AppState.datos.ultimaTasaVentaUSD = ta;
            else AppState.datos.ultimaTasaVenta = ta;
            AppState.datos.bancos[b].saldo = fixNegativeZero(AppState.datos.bancos[b].saldo + m);
            AppState.sincronizarSaldoUsdt();
        }

        AppState.datos.operaciones.unshift({
            id: opId, tipo: t, monto: m, tasa: ta, usdt: u,
            banco: b, moneda, comisionBanco: t === 'compra' ? cb : 0,
            comisionPlataforma: cp, comisionPct: comisionPctVal,
            fecha: f, hora: h, ganancia: gananciaOp,
            timestamp: new Date().toISOString()
        });

        $('monto').value = '';
        $('comisionBanco').value = '0';
        const previewBox = $('previewBox');
        if (previewBox) previewBox.style.display = 'none';
        AppState.ui.paginaOp = 1;

        await guardarDatos();
        actualizarVista();
        activarCooldown();
    } finally {
        btn.disabled = false;
        btn.textContent = 'Agregar Operación';
    }
}

// ─── Eliminar operación ───

export async function eliminarOperacion(id, actualizarVista) {
    if (!confirm('¿Eliminar operación? Se recalcularán los lotes y ganancias.')) return;

    const op = AppState.datos.operaciones.find(o => o.id === id);
    if (op) {
        if (op.tipo === 'compra') {
            if (op.banco && AppState.datos.bancos[op.banco]) {
                AppState.datos.bancos[op.banco].saldo = fixNegativeZero(
                    AppState.datos.bancos[op.banco].saldo + (op.monto + (op.comisionBanco || 0))
                );
                if (AppState.datos.bancos[op.banco].limiteDiarioUSD > 0) {
                    const montoUSD = op.monto / op.tasa;
                    AppState.datos.bancos[op.banco].limiteUsadoUSD = Math.max(
                        0, (AppState.datos.bancos[op.banco].limiteUsadoUSD || 0) - montoUSD
                    );
                }
            }
        } else {
            if (op.banco && AppState.datos.bancos[op.banco]) {
                AppState.datos.bancos[op.banco].saldo = fixNegativeZero(
                    AppState.datos.bancos[op.banco].saldo - op.monto
                );
            }
        }
    }

    AppState.datos.operaciones = AppState.datos.operaciones.filter(o => o.id !== id);
    recalcularLotesYGanancias();
    await guardarDatos();
    actualizarVista();
}

// ─── Renderizado de tabla ───

function renderizarTablaOperaciones(inicio, fin) {
    const container = $('tablaContent');
    if (!container) return;

    const total = AppState.datos.operaciones.length;
    setText('totalOperaciones', total);

    if (total === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div>Sin operaciones</div></div>';
        return;
    }

    const ops = AppState.datos.operaciones.slice(inicio, fin);
    let h = '<table><thead><tr><th>Tipo</th><th>Monto</th><th>Tasa</th><th>USDT</th><th>G/P</th><th>Fecha</th><th></th></tr></thead><tbody>';

    ops.forEach(op => {
        const un = op.tipo === 'compra' ? op.usdt - op.comisionPlataforma : op.usdt + op.comisionPlataforma;
        const badge = op.tipo === 'compra'
            ? '<span class="badge badge-compra"><b>Compra</b></span>'
            : '<span class="badge badge-venta"><b>Venta</b></span>';
        const gan = op.ganancia || 0;
        const ganColor = gan >= 0 ? '#16a34a' : '#dc2626';
        const ganText = gan >= 0 ? '+$' + formatearNumero(gan) : '-$' + formatearNumero(Math.abs(gan));
        const sym = op.moneda === 'USD' ? 'US$' : '$';
        const tasaDec = op.moneda === 'USD' ? 3 : 2;

        h += `<tr>
            <td>${badge}</td>
            <td><b>${sym}${formatearNumero(op.monto)}</b></td>
            <td>${sym}${formatearNumero(op.tasa, tasaDec)}</td>
            <td><b>${formatearNumero(un, 2)}</b></td>
            <td style="color:${ganColor};font-weight:600">${ganText}</td>
            <td>${fechaHoraHtml(op.fecha, op.hora)}</td>
            <td><button class="btn-delete" data-action="eliminar-operacion" data-id="${op.id}">×</button></td>
        </tr>`;
    });

    container.innerHTML = h + '</tbody></table>';
}

export function actualizarTablaOperaciones() {
    paginacionOp.render();
}
