/**
 * config.js
 * Configuración centralizada de la aplicación.
 * Firebase, constantes de negocio y bancos disponibles.
 */

export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCL2uxQMNIxC0oo35uN-lYQXaOWLxXNg7k",
    authDomain: "p2p-tracker-dc9cc.firebaseapp.com",
    projectId: "p2p-tracker-dc9cc",
    storageBucket: "p2p-tracker-dc9cc.firebasestorage.app",
    messagingSenderId: "670856094446",
    appId: "1:670856094446:web:390946887212a97e36c9ff"
};

export const POR_PAGINA = 10;
export const EMAIL_DOMAIN = '@p2p-tracker.app';
export const COOLDOWN_MS = 1000;
export const DEFAULT_COMISION = 0.14;

export const BANCOS_DISPONIBLES = [
    { nombre: 'Santander', moneda: 'UYU' },
    { nombre: 'BBVA', moneda: 'UYU' },
    { nombre: 'Itau', moneda: 'UYU', especial: 'itau' },
    { nombre: 'Scotiabank', moneda: 'UYU' },
    { nombre: 'BROU', moneda: 'UYU' },
    { nombre: 'Prex', moneda: 'UYU' },
    { nombre: 'OCA', moneda: 'UYU' },
    { nombre: 'Mercado Pago', moneda: 'UYU' },
    { nombre: 'Midinero', moneda: 'UYU' },
    { nombre: 'Zelle', moneda: 'USD' },
    { nombre: 'Zinli', moneda: 'USD' },
    { nombre: 'Skrill', moneda: 'USD' }
];

/**
 * Busca la info de un banco por nombre.
 * @param {string} nombre
 * @returns {object|undefined}
 */
export function getBancoInfo(nombre) {
    return BANCOS_DISPONIBLES.find(b => b.nombre === nombre);
}

/**
 * Devuelve el símbolo monetario según la moneda.
 */
export function getSimboloMoneda(moneda) {
    return moneda === 'USD' ? 'US$' : '$';
}
