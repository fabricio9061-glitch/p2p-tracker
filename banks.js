/**
 * banks.js
 * Gestión de bancos: inicialización, límites diarios, renderizado.
 */

import { BANCOS_DISPONIBLES, getBancoInfo, getSimboloMoneda } from './config.js';
import AppState from './state.js';
import { $, setHtml, abrirModal, cerrarModal } from './ui.js';
import { formatearNumero, getUruguayDate, getUruguayDateString } from './utils.js';
import { guardarDatos } from './firebase-service.js';

// ─── Inicialización ───

/**
 * Asegura que todos los bancos disponibles tengan entrada en datos.bancos.
 */
export function inicializarBancos() {
    BANCOS_DISPONIBLES.forEach(b => {
        if (!AppState.datos.bancos[b.nombre]) {
            AppState.datos.bancos[b.nombre] = {
                activo: false,
                saldo: 0,
                limiteDiarioUSD: 0,
                limiteUsadoUSD: 0,
                ultimoResetLimite: null
            };
        } else {
            const banco = AppState.datos.bancos[b.nombre];
            if (banco.limiteDiarioUSD === undefined) banco.limiteDiarioUSD = banco.limiteDiario || 0;
            if (banco.limiteUsadoUSD === undefined) banco.limiteUsadoUSD = banco.limiteUsado || 0;
            if (banco.ultimoResetLimite === undefined) banco.ultimoResetLimite = null;
        }
    });
}

// ─── Reset de límites diarios ───

/**
 * Verifica y resetea los límites diarios de cada banco según la hora de Uruguay.
 * Itaú tiene lógica especial: sáb-lun cuentan como 1 día.
 */
export function verificarResetLimites() {
    const ahora = getUruguayDate();
    const horaReset = 0.5; // 00:30
    const horaActual = ahora.getHours() + ahora.getMinutes() / 60;
    const hoy = getUruguayDateString();

    BANCOS_DISPONIBLES.forEach(b => {
        const banco = AppState.datos.bancos[b.nombre];
        if (!banco) return;

        if (!banco.ultimoResetLimite) banco.ultimoResetLimite = null;
        const ultimoReset = banco.ultimoResetLimite;

        if (b.especial === 'itau') {
            const diaSemana = ahora.getDay();
            if (diaSemana === 2 && horaActual >= horaReset) {
                if (ultimoReset !== hoy) { banco.limiteUsadoUSD = 0; banco.ultimoResetLimite = hoy; }
            } else if (diaSemana > 2 && diaSemana < 6 && horaActual >= horaReset) {
                if (ultimoReset !== hoy) { banco.limiteUsadoUSD = 0; banco.ultimoResetLimite = hoy; }
            }
        } else {
            if (horaActual >= horaReset && ultimoReset !== hoy) {
                banco.limiteUsadoUSD = 0;
                banco.ultimoResetLimite = hoy;
            }
        }
    });
}

// ─── Helpers ───

/**
 * Obtiene la moneda del banco seleccionado en el formulario principal.
 */
export function getMonedaBancoSeleccionado() {
    const b = $('banco')?.value;
    if (!b) return 'UYU';
    const info = getBancoInfo(b);
    return info?.moneda || 'UYU';
}

/**
 * Obtiene la comisión actual según la moneda del banco seleccionado.
 */
export function getComisionActual() {
    return getMonedaBancoSeleccionado() === 'USD'
        ? AppState.datos.comisionUSD
        : AppState.datos.comisionPlataforma;
}

export function getComisionDecimal() {
    return (getComisionActual() || 0.14) / 100;
}

/**
 * Obtiene los bancos activos.
 */
export function getBancosActivos() {
    return BANCOS_DISPONIBLES.filter(b => AppState.datos.bancos[b.nombre]?.activo);
}

// ─── Select de bancos ───

/**
 * Actualiza el <select> de bancos en el formulario principal.
 */
export function actualizarSelectBancos() {
    const s = $('banco');
    if (!s) return;
    const v = s.value;
    s.innerHTML = '<option value="">-- Seleccionar --</option>';
    getBancosActivos().forEach(b => {
        s.innerHTML += `<option value="${b.nombre}">${b.nombre}</option>`;
    });
    s.value = v;
}

/**
 * Muestra el saldo del banco seleccionado.
 */
export function mostrarSaldoBanco() {
    const b = $('banco')?.value;
    const info = $('saldoBancoInfo');
    const help = $('bancoHelp');

    if (help) { help.textContent = ''; help.className = ''; }

    if (b && AppState.datos.bancos[b]) {
        const bi = getBancoInfo(b);
        const sym = getSimboloMoneda(bi?.moneda);
        if (info) info.textContent = ' | ' + b + ': ' + sym + formatearNumero(AppState.datos.bancos[b].saldo);
    } else {
        if (info) info.textContent = '';
    }
}

// ─── Grid de bancos (dashboard) ───

/**
 * Renderiza la grilla de bancos en el dashboard.
 */
export function actualizarBancosGrid() {
    const lotesActivos = AppState.datos.lotes.filter(l => l.disponible > 0).length;
    let h = `<div class="banco-mini-card usdt-card" data-action="inventario">
        <div class="banco-nombre">🪙 <b style="color:#1e293b">USDT</b></div>
        <div class="banco-saldo">${formatearNumero(Math.max(0, AppState.datos.saldoUsdt), 2)}</div>
        <div class="banco-moneda">Tether · ${lotesActivos} lotes</div>
    </div>`;

    BANCOS_DISPONIBLES.forEach(b => {
        if (!AppState.datos.bancos[b.nombre]?.activo) return;

        const s = AppState.datos.bancos[b.nombre].saldo;
        const lim = AppState.datos.bancos[b.nombre].limiteDiarioUSD || 0;
        const usado = AppState.datos.bancos[b.nombre].limiteUsadoUSD || 0;
        let limiteHtml = '';

        if (lim > 0) {
            const disponible = Math.max(0, lim - usado);
            const pct = Math.min(100, (usado / lim) * 100);
            let fillClass = '';
            if (pct >= 90) fillClass = 'danger';
            else if (pct >= 70) fillClass = 'warning';
            limiteHtml = `<div class="banco-limite">US$${formatearNumero(disponible, 0)}/${formatearNumero(lim, 0)}</div>
                <div class="banco-limite-bar"><div class="banco-limite-fill ${fillClass}" style="width:${pct}%"></div></div>`;
        }

        h += `<div class="banco-mini-card" data-action="editar-saldo" data-banco="${b.nombre}">
            <div class="banco-nombre">${b.nombre}</div>
            <div class="banco-saldo" style="color:${s >= 0 ? '#16a34a' : '#dc2626'}">${getSimboloMoneda(b.moneda)}${formatearNumero(s)}</div>
            <div class="banco-moneda">${b.moneda}</div>
            ${limiteHtml}
        </div>`;
    });

    setHtml('bancosGrid', h);
}

// ─── Modal gestionar bancos ───

export function renderizarListaBancos() {
    let h = '';
    BANCOS_DISPONIBLES.forEach(b => {
        const a = AppState.datos.bancos[b.nombre]?.activo || false;
        const s = AppState.datos.bancos[b.nombre]?.saldo || 0;
        const lim = AppState.datos.bancos[b.nombre]?.limiteDiarioUSD || 0;
        let limInfo = lim > 0 ? ` | Límite: US$${formatearNumero(lim, 0)}/día` : '';
        if (b.especial === 'itau') limInfo += ' (sáb-lun=1día)';

        h += `<div class="banco-list-item">
            <div>
                <div style="font-weight:600;font-size:0.9em">${b.nombre} <span style="color:#94a3b8">(${b.moneda})</span></div>
                <div style="color:#64748b;font-size:0.8em">${getSimboloMoneda(b.moneda)}${formatearNumero(s)}${limInfo}</div>
            </div>
            <div class="banco-list-actions">
                <button class="btn-edit-small" data-action="editar-saldo" data-banco="${b.nombre}">Editar</button>
                <label class="toggle-switch">
                    <input type="checkbox" ${a ? 'checked' : ''} data-action="toggle-banco" data-banco="${b.nombre}">
                    <span class="toggle-slider"></span>
                </label>
            </div>
        </div>`;
    });
    setHtml('listaBancos', h);
}

export function toggleBanco(nombre) {
    if (!AppState.datos.bancos[nombre]) {
        AppState.datos.bancos[nombre] = { activo: false, saldo: 0, limiteDiarioUSD: 0, limiteUsadoUSD: 0 };
    }
    AppState.datos.bancos[nombre].activo = !AppState.datos.bancos[nombre].activo;
    guardarDatos();
    renderizarListaBancos();
}

// ─── Modal editar saldo ───

export function abrirEditarSaldo(nombre) {
    AppState.ui.bancoEditando = nombre;
    $('editarSaldoHeader').textContent = 'Editar ' + nombre;
    $('nuevoSaldoBanco').value = AppState.datos.bancos[nombre]?.saldo || 0;
    $('limiteDiarioGroup').style.display = 'block';
    $('limiteDiarioBanco').value = AppState.datos.bancos[nombre]?.limiteDiarioUSD || 0;
    abrirModal('modalEditarSaldo');
}

export function cerrarEditarSaldo() {
    cerrarModal('modalEditarSaldo');
    AppState.ui.bancoEditando = null;
}

export async function guardarNuevoSaldo() {
    const ns = parseFloat($('nuevoSaldoBanco')?.value) || 0;
    const nombre = AppState.ui.bancoEditando;

    if (nombre && AppState.datos.bancos[nombre]) {
        const { fixNegativeZero } = await import('./utils.js');
        AppState.datos.bancos[nombre].saldo = fixNegativeZero(ns);
        const lim = parseFloat($('limiteDiarioBanco')?.value) || 0;
        AppState.datos.bancos[nombre].limiteDiarioUSD = lim;
    }

    await guardarDatos();
    cerrarEditarSaldo();
}

// ─── Saldo de origen (para transferencias) ───

export function mostrarSaldoOrigen() {
    const b = $('bancoOrigen')?.value;
    if (b && AppState.datos.bancos[b]) {
        const bi = getBancoInfo(b);
        const sym = getSimboloMoneda(bi?.moneda);
        let info = 'Disponible: ' + sym + formatearNumero(AppState.datos.bancos[b].saldo);
        if (AppState.datos.bancos[b].limiteDiarioUSD > 0) {
            const usado = AppState.datos.bancos[b].limiteUsadoUSD || 0;
            const disponible = Math.max(0, AppState.datos.bancos[b].limiteDiarioUSD - usado);
            info += ` | Límite: US$${formatearNumero(disponible, 0)}/${formatearNumero(AppState.datos.bancos[b].limiteDiarioUSD, 0)}`;
        }
        $('saldoOrigenInfo').textContent = info;
    } else {
        $('saldoOrigenInfo').textContent = '';
    }
}
