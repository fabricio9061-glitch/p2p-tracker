/**
 * app.js
 * Punto de entrada principal.
 * Inicializa la aplicación, configura event listeners (sin eventos inline),
 * y coordina la comunicación entre módulos.
 */

import AppState from './state.js';
import { DEFAULT_COMISION } from './config.js';
import { $, ocultarLoading, setSyncStatus, toggleMenu, cerrarMenu, toggleSeccion, setupGlobalListeners, abrirModal, cerrarModal } from './ui.js';
import { inicializarFirebase, suscribirDatos, guardarDatos } from './firebase-service.js';
import { switchAuthTab, handleLogin, handleRegister, cerrarSesion, showApp, showAuth } from './auth.js';
import { inicializarBancos, verificarResetLimites, actualizarSelectBancos, mostrarSaldoBanco, getMonedaBancoSeleccionado, actualizarBancosGrid, renderizarListaBancos, toggleBanco, abrirEditarSaldo, cerrarEditarSaldo, guardarNuevoSaldo, mostrarSaldoOrigen } from './banks.js';
import { recalcularLotesYGanancias, renderizarInventario, abrirEditarLote, guardarLote, eliminarLoteActual, forzarRecalculo } from './inventory.js';
import { actualizarFormulario, actualizarColorSelect, calcularPreview, guardarComisionYCalcular, agregarOperacion, eliminarOperacion, paginacionOp } from './operations.js';
import { abrirModalMovimiento, cerrarModalMovimiento, setTipoMovimiento, actualizarCuentasMovimiento, guardarMovimiento, eliminarMovimiento, paginacionMov } from './movements.js';
import { abrirModalTransferencia, cerrarModalTransferencia, realizarTransferencia, eliminarTransferencia, paginacionTrans } from './transfers.js';
import { abrirCalendario, cerrarCalendario, cambiarMes } from './calendar.js';
import { actualizarVista } from './dashboard.js';

// ─── Carga de datos del usuario ───

function cargarDatosUsuario() {
    suscribirDatos(
        (data) => {
            // Preservar comisión si está siendo editada
            const comInput = $('comisionPlataforma');
            const comFocused = document.activeElement === comInput;
            const localComUYU = AppState.datos.comisionPlataforma;
            const localComUSD = AppState.datos.comisionUSD;

            if (data) {
                AppState.cargarDatos(data);
            } else {
                AppState.resetDatos();
            }

            if (comFocused) {
                AppState.datos.comisionPlataforma = localComUYU;
                AppState.datos.comisionUSD = localComUSD;
            }

            inicializarBancos();
            verificarResetLimites();

            const necesitaRecalculo = AppState.datos.operaciones.some(op => op.ganancia === undefined);
            if (necesitaRecalculo) {
                recalcularLotesYGanancias();
                guardarDatos();
            }

            AppState.resetPaginacion();

            if (!comFocused) {
                const moneda = getMonedaBancoSeleccionado();
                const comVal = moneda === 'USD' ? AppState.datos.comisionUSD : AppState.datos.comisionPlataforma;
                if (comInput) comInput.value = comVal.toFixed(2);
                $('comisionPctLabel') && ($('comisionPctLabel').textContent = comVal.toFixed(2));
            }

            actualizarVista();
            actualizarFormulario();
            actualizarColorSelect();
            ocultarLoading();
            setSyncStatus('online', '✓');
        },
        () => {
            setSyncStatus('offline', '✗');
            ocultarLoading();
        }
    );
}

// ─── Borrar todo ───

async function borrarTodo() {
    if (confirm('⚠️ ¿Borrar TODO?') && confirm('No se puede deshacer. ¿Continuar?')) {
        AppState.resetDatos();
        inicializarBancos();
        AppState.resetPaginacion();
        $('comisionPlataforma').value = '0.14';
        $('comisionPctLabel').textContent = '0.14';
        await guardarDatos();
        actualizarVista();
    }
}

// ─── Configuración de event listeners ───

function setupEventListeners() {
    setupGlobalListeners();

    // ── Auth ──
    $('tabLogin')?.addEventListener('click', () => switchAuthTab('login'));
    $('tabRegister')?.addEventListener('click', () => switchAuthTab('register'));
    $('loginForm')?.addEventListener('submit', handleLogin);
    $('registerForm')?.addEventListener('submit', handleRegister);

    // ── Menú ──
    $('menuBtn')?.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });

    // ── Menú ítems (usando delegación en el dropdown) ──
    $('menuDropdown')?.addEventListener('click', (e) => {
        const item = e.target.closest('.menu-item');
        if (!item) return;

        cerrarMenu();
        const text = item.textContent.trim();

        if (text.includes('Calendario')) abrirCalendario();
        else if (text.includes('Inventario')) { renderizarInventario(); abrirModal('modalInventario'); }
        else if (text.includes('Movimiento')) abrirModalMovimiento();
        else if (text.includes('Gestionar Bancos')) { renderizarListaBancos(); abrirModal('modalBancos'); }
        else if (text.includes('Transferencia')) abrirModalTransferencia();
        else if (text.includes('Borrar Todo')) borrarTodo();
        else if (text.includes('Cerrar Sesión')) cerrarSesion();
    });

    // ── Formulario principal ──
    $('tipo')?.addEventListener('change', () => { actualizarFormulario(); actualizarColorSelect(); });
    $('monto')?.addEventListener('input', calcularPreview);
    $('tasa')?.addEventListener('input', calcularPreview);
    $('banco')?.addEventListener('change', () => { mostrarSaldoBanco(); actualizarFormulario(); });
    $('comisionPlataforma')?.addEventListener('input', guardarComisionYCalcular);
    $('btnAgregarOp')?.addEventListener('click', () => agregarOperacion(actualizarVista));

    // ── Secciones colapsables ──
    document.querySelectorAll('.toggle-header').forEach(header => {
        header.addEventListener('click', () => {
            const section = header.closest('.toggle-section');
            if (section) section.classList.toggle('open');
        });
    });

    // ── Paginación ──
    $('btnPrevOp')?.addEventListener('click', () => paginacionOp.cambiarPagina(-1));
    $('btnNextOp')?.addEventListener('click', () => paginacionOp.cambiarPagina(1));
    $('btnPrevMov')?.addEventListener('click', () => paginacionMov.cambiarPagina(-1));
    $('btnNextMov')?.addEventListener('click', () => paginacionMov.cambiarPagina(1));
    $('btnPrevTrans')?.addEventListener('click', () => paginacionTrans.cambiarPagina(-1));
    $('btnNextTrans')?.addEventListener('click', () => paginacionTrans.cambiarPagina(1));

    // ── Modales: Movimiento ──
    $('tabIngreso')?.addEventListener('click', () => setTipoMovimiento('ingreso'));
    $('tabEgreso')?.addEventListener('click', () => setTipoMovimiento('egreso'));
    $('movTipoCuenta')?.addEventListener('change', actualizarCuentasMovimiento);
    $('btnGuardarMov')?.addEventListener('click', () => guardarMovimiento(actualizarVista));
    document.querySelector('#modalMovimiento .btn-cancel')?.addEventListener('click', cerrarModalMovimiento);

    // ── Modal: Bancos ──
    document.querySelector('#modalBancos .btn')?.addEventListener('click', () => {
        cerrarModal('modalBancos');
        guardarDatos();
        actualizarVista();
    });

    // ── Modal: Transferencia ──
    $('bancoOrigen')?.addEventListener('change', mostrarSaldoOrigen);
    $('btnTransferir')?.addEventListener('click', () => realizarTransferencia(actualizarVista));
    document.querySelector('#modalTransferencia .btn-cancel')?.addEventListener('click', cerrarModalTransferencia);

    // ── Modal: Editar saldo ──
    document.querySelector('#modalEditarSaldo .btn-cancel')?.addEventListener('click', cerrarEditarSaldo);
    document.querySelector('#modalEditarSaldo .btn:not(.btn-cancel)')?.addEventListener('click', async () => {
        await guardarNuevoSaldo();
        actualizarVista();
        renderizarListaBancos();
    });

    // ── Modal: Inventario ──
    $('modalInventario')?.querySelector('.btn[style*="16a34a"]')?.addEventListener('click', () => abrirEditarLote(null));
    $('modalInventario')?.querySelector('.btn-cancel')?.addEventListener('click', () => { forzarRecalculo().then(() => actualizarVista()); });
    $('modalInventario')?.querySelector('.btn:last-child')?.addEventListener('click', () => cerrarModal('modalInventario'));

    // ── Modal: Editar lote ──
    document.querySelector('#modalEditarLote .btn-cancel')?.addEventListener('click', () => { cerrarModal('modalEditarLote'); AppState.ui.loteEditandoId = null; });
    $('btnEliminarLote')?.addEventListener('click', () => eliminarLoteActual().then(() => actualizarVista()));
    document.querySelector('#modalEditarLote .btn:last-child')?.addEventListener('click', () => guardarLote().then(() => actualizarVista()));

    // ── Modal: Calendario ──
    $('modalCalendario')?.querySelector('.btn')?.addEventListener('click', cerrarCalendario);

    // Botones de navegación del calendario
    const calHeader = $('modalCalendario')?.querySelector('.calendar-header');
    if (calHeader) {
        const buttons = calHeader.querySelectorAll('button');
        buttons[0]?.addEventListener('click', () => cambiarMes(-1));
        buttons[1]?.addEventListener('click', () => cambiarMes(1));
    }

    // ── Delegación de eventos para contenido dinámico ──
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const id = parseInt(target.dataset.id);
        const banco = target.dataset.banco;
        const loteId = parseInt(target.dataset.loteId);

        switch (action) {
            case 'eliminar-operacion':
                eliminarOperacion(id, actualizarVista);
                break;
            case 'eliminar-movimiento':
                eliminarMovimiento(id, actualizarVista);
                break;
            case 'eliminar-transferencia':
                eliminarTransferencia(id, actualizarVista);
                break;
            case 'editar-saldo':
                if (banco === 'USDT') { renderizarInventario(); abrirModal('modalInventario'); }
                else abrirEditarSaldo(banco);
                break;
            case 'toggle-banco':
                toggleBanco(banco);
                break;
            case 'inventario':
                renderizarInventario();
                abrirModal('modalInventario');
                break;
            case 'editar-lote':
                abrirEditarLote(loteId);
                break;
        }
    });

    // ── Grid de bancos: delegación ──
    $('bancosGrid')?.addEventListener('click', (e) => {
        const card = e.target.closest('[data-action]');
        if (!card) return;

        if (card.dataset.action === 'inventario') {
            renderizarInventario();
            abrirModal('modalInventario');
        } else if (card.dataset.action === 'editar-saldo') {
            abrirEditarSaldo(card.dataset.banco);
        }
    });
}

// ─── Inicialización ───

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    actualizarFormulario();
    actualizarColorSelect();

    inicializarFirebase(
        (user) => {
            showApp(user);
            cargarDatosUsuario();
        },
        () => {
            showAuth();
        }
    );

    // Refrescar periódicamente
    setInterval(() => {
        verificarResetLimites();
        actualizarVista();
    }, 60000);
});
