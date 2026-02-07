/**
 * state.js
 * Estado centralizado de la aplicación.
 * Encapsula los datos y expone métodos para modificarlos de forma controlada.
 */

import { DEFAULT_COMISION } from './config.js';
import { fixNegativeZero } from './utils.js';

// ─── Estado por defecto ───

function crearDatosVacios() {
    return {
        operaciones: [],
        movimientos: [],
        transferencias: [],
        bancos: {},
        lotes: [],
        saldoUsdt: 0,
        ultimaTasaCompra: 0,
        ultimaTasaVenta: 0,
        comisionPlataforma: DEFAULT_COMISION,
        ultimaTasaCompraUSD: 0,
        ultimaTasaVentaUSD: 0,
        comisionUSD: DEFAULT_COMISION
    };
}

// ─── Singleton de estado ───

const AppState = {
    /** Datos principales de la app (operaciones, bancos, lotes, etc.) */
    datos: crearDatosVacios(),

    /** Estado de autenticación */
    currentUser: null,

    /** Estado de UI */
    ui: {
        bancoEditando: null,
        tipoMovimiento: 'ingreso',
        calendarDate: new Date(),
        loteEditandoId: null,
        paginaOp: 1,
        paginaMov: 1,
        paginaTrans: 1,
        guardandoMovimiento: false,
        enCooldown: false,
        comisionDebounce: null
    },

    /** Firebase refs */
    firebase: {
        db: null,
        auth: null,
        unsubscribe: null
    },

    // ─── Métodos de estado ───

    /**
     * Resetea los datos a valores vacíos.
     */
    resetDatos() {
        this.datos = crearDatosVacios();
    },

    /**
     * Carga datos desde un objeto (snapshot de Firestore).
     */
    cargarDatos(d) {
        this.datos = {
            operaciones: d.operaciones || [],
            movimientos: d.movimientos || [],
            transferencias: d.transferencias || [],
            bancos: d.bancos || {},
            lotes: d.lotes || [],
            saldoUsdt: d.saldoUsdt || 0,
            ultimaTasaCompra: d.ultimaTasaCompra || 0,
            ultimaTasaVenta: d.ultimaTasaVenta || 0,
            comisionPlataforma: d.comisionPlataforma !== undefined ? d.comisionPlataforma : DEFAULT_COMISION,
            ultimaTasaCompraUSD: d.ultimaTasaCompraUSD || 0,
            ultimaTasaVentaUSD: d.ultimaTasaVentaUSD || 0,
            comisionUSD: d.comisionUSD !== undefined ? d.comisionUSD : DEFAULT_COMISION
        };
    },

    /**
     * Sincroniza el saldo USDT desde los lotes activos.
     */
    sincronizarSaldoUsdt() {
        this.datos.saldoUsdt = fixNegativeZero(
            this.datos.lotes.reduce((sum, l) => sum + l.disponible, 0)
        );
    },

    /**
     * Obtiene los lotes activos ordenados por FIFO.
     */
    getLotesActivosFIFO() {
        return this.datos.lotes
            .filter(l => l.disponible > 0)
            .sort((a, b) => {
                const fa = a.fecha + (a.hora || '00:00');
                const fb = b.fecha + (b.hora || '00:00');
                return fa.localeCompare(fb);
            });
    },

    /**
     * Resetea todas las páginas de paginación.
     */
    resetPaginacion() {
        this.ui.paginaOp = 1;
        this.ui.paginaMov = 1;
        this.ui.paginaTrans = 1;
    }
};

export default AppState;
