/**
 * firebase-service.js
 * Inicialización de Firebase, autenticación y persistencia de datos.
 */

import { FIREBASE_CONFIG, EMAIL_DOMAIN } from './config.js';
import AppState from './state.js';
import { setSyncStatus, ocultarLoading } from './ui.js';

// ─── Helpers de usuario ───

export function userToEmail(username) {
    return username.toLowerCase().trim() + EMAIL_DOMAIN;
}

export function emailToUser(email) {
    return email.replace(EMAIL_DOMAIN, '');
}

// ─── Inicialización ───

/**
 * Inicializa Firebase y configura el listener de autenticación.
 * @param {function} onLogin - Callback cuando el usuario inicia sesión
 * @param {function} onLogout - Callback cuando el usuario cierra sesión
 */
export function inicializarFirebase(onLogin, onLogout) {
    if (typeof firebase === 'undefined') {
        ocultarLoading();
        return;
    }

    firebase.initializeApp(FIREBASE_CONFIG);
    AppState.firebase.auth = firebase.auth();
    AppState.firebase.db = firebase.firestore();
    AppState.firebase.db.enablePersistence().catch(() => {});

    AppState.firebase.auth.onAuthStateChanged(user => {
        if (user) {
            AppState.currentUser = user;
            onLogin(user);
        } else {
            onLogout();
        }
    });
}

// ─── Autenticación ───

export async function registrarse(username, password) {
    const { auth } = AppState.firebase;
    return auth.createUserWithEmailAndPassword(userToEmail(username), password);
}

export async function iniciarSesion(username, password) {
    const { auth } = AppState.firebase;
    return auth.signInWithEmailAndPassword(userToEmail(username), password);
}

export async function cerrarSesion() {
    if (AppState.firebase.unsubscribe) {
        AppState.firebase.unsubscribe();
        AppState.firebase.unsubscribe = null;
    }
    await AppState.firebase.auth.signOut();
}

// ─── Persistencia ───

/**
 * Guarda los datos del usuario actual en Firestore.
 */
export async function guardarDatos() {
    if (!AppState.currentUser) return;
    setSyncStatus('syncing', '...');
    try {
        const { db } = AppState.firebase;
        await db.collection('users').doc(AppState.currentUser.uid).set({
            ...AppState.datos,
            ultimaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
        });
        setSyncStatus('online', '✓');
    } catch (e) {
        setSyncStatus('offline', '✗');
    }
}

/**
 * Suscribe un listener en tiempo real al documento del usuario.
 * @param {function} onData - Callback con los datos cargados
 * @param {function} onError - Callback en caso de error
 */
export function suscribirDatos(onData, onError) {
    if (!AppState.currentUser) return;
    if (AppState.firebase.unsubscribe) {
        AppState.firebase.unsubscribe();
    }

    const { db } = AppState.firebase;
    AppState.firebase.unsubscribe = db
        .collection('users')
        .doc(AppState.currentUser.uid)
        .onSnapshot(
            (doc) => {
                if (doc.exists) {
                    onData(doc.data());
                } else {
                    onData(null);
                }
            },
            () => {
                onError();
            }
        );
}
