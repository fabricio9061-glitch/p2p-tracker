/**
 * ui.js
 * Capa centralizada de manipulación del DOM.
 * Modales, overlays, menú, paginación genérica, y helpers de DOM.
 */

import { COOLDOWN_MS } from './config.js';
import AppState from './state.js';

// ─── Helpers de DOM ───

/** Atajo para getElementById */
export const $ = (id) => document.getElementById(id);

/** Establece textContent de un elemento */
export function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
}

/** Establece innerHTML de un elemento */
export function setHtml(id, html) {
    const el = $(id);
    if (el) el.innerHTML = html;
}

/** Muestra/oculta un elemento */
export function setVisible(id, visible) {
    const el = $(id);
    if (el) el.style.display = visible ? '' : 'none';
}

// ─── Loading / Cooldown ───

export function ocultarLoading() {
    $('loadingOverlay')?.classList.add('hidden');
}

export function activarCooldown() {
    AppState.ui.enCooldown = true;
    $('cooldownOverlay')?.classList.remove('hidden');
    setTimeout(() => {
        AppState.ui.enCooldown = false;
        $('cooldownOverlay')?.classList.add('hidden');
    }, COOLDOWN_MS);
}

// ─── Sync status ───

export function setSyncStatus(status, text) {
    const el = $('syncStatus');
    if (el) el.className = 'sync-status ' + status;
    setText('syncText', text);
}

// ─── Modales ───

export function abrirModal(id) {
    $(id)?.classList.add('active');
}

export function cerrarModal(id) {
    $(id)?.classList.remove('active');
}

// ─── Menú hamburguesa ───

export function toggleMenu() {
    $('menuBtn')?.classList.toggle('active');
    $('menuDropdown')?.classList.toggle('active');
}

export function cerrarMenu() {
    $('menuBtn')?.classList.remove('active');
    $('menuDropdown')?.classList.remove('active');
}

// ─── Secciones colapsables ───

export function toggleSeccion(id) {
    $(id)?.classList.toggle('open');
}

// ─── Paginación genérica ───

/**
 * Crea un controlador de paginación reutilizable.
 * @param {object} opts - Configuración
 * @param {function} opts.getTotal - Función que retorna total de ítems
 * @param {function} opts.getPagina - Getter de la página actual
 * @param {function} opts.setPagina - Setter de la página actual
 * @param {number} opts.porPagina - Ítems por página
 * @param {string} opts.paginationId - ID del contenedor de paginación
 * @param {string} opts.infoId - ID del span de info "x / y"
 * @param {string} opts.prevBtnId - ID del botón anterior
 * @param {string} opts.nextBtnId - ID del botón siguiente
 * @param {function} opts.onRender - Callback para renderizar la página
 */
export function crearPaginacion(opts) {
    const { getTotal, getPagina, setPagina, porPagina, paginationId, infoId, prevBtnId, nextBtnId, onRender } = opts;

    function totalPaginas() {
        return Math.max(1, Math.ceil(getTotal() / porPagina));
    }

    function ajustarPagina() {
        const tp = totalPaginas();
        let pag = getPagina();
        if (pag > tp) { pag = tp; setPagina(pag); }
        if (pag < 1) { pag = 1; setPagina(pag); }
        return pag;
    }

    function render() {
        const total = getTotal();
        if (total === 0) {
            setVisible(paginationId, false);
            onRender([], 0);
            return;
        }

        const pag = ajustarPagina();
        const tp = totalPaginas();
        const inicio = (pag - 1) * porPagina;
        const fin = inicio + porPagina;

        onRender(inicio, fin);

        const showPag = tp > 1;
        setVisible(paginationId, showPag);
        if (showPag) {
            setText(infoId, `${pag} / ${tp}`);
            const prevBtn = $(prevBtnId);
            const nextBtn = $(nextBtnId);
            if (prevBtn) prevBtn.disabled = pag === 1;
            if (nextBtn) nextBtn.disabled = pag === tp;
        }
    }

    function cambiarPagina(dir) {
        const tp = totalPaginas();
        let pag = getPagina() + dir;
        if (pag < 1) pag = 1;
        if (pag > tp) pag = tp;
        setPagina(pag);
        render();
    }

    return { render, cambiarPagina };
}

// ─── Botón con estado loading ───

/**
 * Ejecuta una acción async deshabilitando el botón.
 */
export async function conBotonLoading(btnId, textoLoading, action) {
    const btn = $(btnId);
    if (!btn || btn.disabled) return;
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = textoLoading;
    try {
        await action();
    } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
    }
}

// ─── Auth UI ───

export function showAuthError(msg) {
    const el = $('authError');
    if (el) {
        el.textContent = msg;
        el.classList.add('show');
    }
}

export function hideAuthError() {
    $('authError')?.classList.remove('show');
}

// ─── Setup de listeners globales ───

export function setupGlobalListeners(handlers) {
    // Cerrar menú al hacer clic fuera
    document.addEventListener('click', (e) => {
        const m = document.querySelector('.menu-container');
        if (m && !m.contains(e.target)) cerrarMenu();
    });

    // Cerrar modales con Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                modal.classList.remove('active');
            });
            cerrarMenu();
        }
    });
}
