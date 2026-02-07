/**
 * auth.js
 * Lógica de UI para autenticación (login, registro, switch tabs).
 */

import AppState from './state.js';
import { $ } from './ui.js';
import { showAuthError, hideAuthError, ocultarLoading } from './ui.js';
import { emailToUser, registrarse, iniciarSesion, cerrarSesion as fbCerrarSesion } from './firebase-service.js';

export function switchAuthTab(tab) {
    $('tabLogin')?.classList.toggle('active', tab === 'login');
    $('tabRegister')?.classList.toggle('active', tab === 'register');
    $('loginForm').style.display = tab === 'login' ? 'block' : 'none';
    $('registerForm').style.display = tab === 'register' ? 'block' : 'none';
    hideAuthError();
}

export async function handleRegister(e) {
    e.preventDefault();
    hideAuthError();

    const u = $('regUser').value.trim();
    const p = $('regPass').value;
    const p2 = $('regPassConfirm').value;

    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(u)) return showAuthError('Usuario inválido');
    if (p.length < 6) return showAuthError('Mínimo 6 caracteres');
    if (p !== p2) return showAuthError('No coinciden');

    const btn = $('registerBtn');
    btn.disabled = true;
    btn.textContent = 'Creando...';

    try {
        await registrarse(u, p);
    } catch (err) {
        showAuthError(err.code === 'auth/email-already-in-use' ? 'Usuario ya existe' : 'Error');
        btn.disabled = false;
        btn.textContent = 'Crear Cuenta';
    }
}

export async function handleLogin(e) {
    e.preventDefault();
    hideAuthError();

    const u = $('loginUser').value.trim();
    const p = $('loginPass').value;
    const btn = $('loginBtn');
    btn.disabled = true;
    btn.textContent = 'Entrando...';

    try {
        await iniciarSesion(u, p);
    } catch (err) {
        showAuthError('Usuario o contraseña incorrectos');
        btn.disabled = false;
        btn.textContent = 'Iniciar Sesión';
    }
}

export async function cerrarSesion() {
    if (confirm('¿Cerrar sesión?')) {
        await fbCerrarSesion();
    }
}

export function showApp(user) {
    AppState.currentUser = user;
    $('menuUserName').textContent = emailToUser(user.email);
    $('menuUserEmail').textContent = user.email;
    $('authContainer').classList.add('hidden');
    $('appContainer').classList.add('active');
}

export function showAuth() {
    AppState.currentUser = null;
    $('authContainer').classList.remove('hidden');
    $('appContainer').classList.remove('active');

    ['loginBtn', 'registerBtn'].forEach(id => {
        const b = $(id);
        if (b) {
            b.disabled = false;
            b.textContent = id === 'loginBtn' ? 'Iniciar Sesión' : 'Crear Cuenta';
        }
    });

    ['loginUser', 'loginPass', 'regUser', 'regPass', 'regPassConfirm'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });

    ocultarLoading();
}
