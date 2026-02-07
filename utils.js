/**
 * utils.js
 * Funciones utilitarias puras: formato, fechas, matemáticas.
 * Sin dependencias de DOM ni estado.
 */

// ─── Matemáticas ───

/**
 * Corrige -0 y redondea a 2 decimales.
 */
export function fixNegativeZero(n) {
    return Object.is(n, -0) ? 0 : Math.round(n * 100) / 100;
}

/**
 * Trunca un número a N decimales (sin redondeo).
 */
export function truncar(n, d = 2) {
    const factor = Math.pow(10, d);
    return Math.floor(n * factor) / factor;
}

// ─── Formateo de números ───

/**
 * Formatea un número con locale es-UY.
 */
export function formatearNumero(n, d = 2) {
    return n.toLocaleString('es-UY', {
        minimumFractionDigits: d,
        maximumFractionDigits: d
    });
}

/**
 * Formatea una tasa según la moneda.
 * USD: hasta 3 decimales si los tiene.
 * UYU: siempre 2 decimales.
 */
export function formatearTasa(num, moneda) {
    if (moneda === 'USD') {
        const s = num.toString();
        const dec = s.includes('.') ? s.split('.')[1].length : 0;
        return dec > 2 ? num.toFixed(3) : num.toFixed(2);
    }
    return num.toFixed(2);
}

// ─── Parseo ───

/**
 * Parsea una tasa (acepta coma como decimal).
 * Retorna null si es inválida.
 */
export function parsearTasa(valor) {
    if (!valor) return null;
    const limpio = valor.toString().replace(',', '.').trim();
    if (!/^\d+(\.\d{1,3})?$/.test(limpio)) return null;
    const num = parseFloat(limpio);
    return isNaN(num) || num <= 0 ? null : num;
}

/**
 * Parsea un valor de comisión (0-10%).
 * Retorna null si es inválido.
 */
export function parsearComision(valor) {
    if (!valor && valor !== 0) return null;
    const limpio = valor.toString().replace(',', '.').trim();
    if (!limpio || limpio === '.') return null;
    if (!/^\d*\.?\d*$/.test(limpio)) return null;
    const num = parseFloat(limpio);
    return isNaN(num) || num < 0 || num > 10 ? null : num;
}

// ─── Fechas (zona horaria Uruguay UTC-3) ───

/**
 * Retorna un Date ajustado a la hora de Uruguay.
 */
export function getUruguayDate() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utc - 3 * 3600000);
}

/**
 * Retorna la fecha de Uruguay como string YYYY-MM-DD.
 */
export function getUruguayDateString() {
    const d = getUruguayDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Retorna la hora de Uruguay como string HH:MM.
 */
export function getUruguayTimeString() {
    const d = getUruguayDate();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Formatea fecha YYYY-MM-DD a DD/MM corto.
 */
export function formatearFechaCorta(fecha) {
    if (!fecha) return '-';
    const partes = fecha.split('-');
    if (partes.length === 3) return `${partes[2]}/${partes[1]}`;
    return fecha;
}

/**
 * Genera HTML para fecha + hora en tabla.
 */
export function fechaHoraHtml(fecha, hora) {
    return `<div class="fecha-hora">
        <span class="fecha">${formatearFechaCorta(fecha)}</span>
        <span class="hora">${hora || '--:--'}</span>
    </div>`;
}
