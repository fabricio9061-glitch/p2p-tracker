import { initFirebase } from './firebase/init.js';
import { P2PRepository } from './firebase/repository.js';
import { state, resetState, setEntity, upsertEntityItem, removeEntityItem } from './core/state.js';
import { uid, today, timeNow, roundMoney, truncMoney } from './core/money.js';
import { rebuildFifo } from './business/fifo.js';
import { render, setStatus } from './ui/render.js';
import { downloadJson } from './import_export/export.js';
import { importFile } from './import_export/import.js';

let auth, db, repo;
const $ = id => document.getElementById(id);

bootstrap();

function bootstrap() {
  const fb = initFirebase();
  auth = fb.auth;
  db = fb.db;
  bindAuthUi();
  bindAppUi();
  auth.onAuthStateChanged(async user => {
    resetState();
    state.user = user;
    if (!user) return showAuth();
    repo = new P2PRepository(db, user.uid);
    state.db = db;
    showApp();
    await loadConfig();
    setupListeners();
  });
}

function bindAuthUi() {
  $('btnLogin').onclick = async () => authAction('login');
  $('btnRegister').onclick = async () => authAction('register');
}

async function authAction(mode) {
  $('authMsg').textContent = '';
  const email = $('authEmail').value.trim();
  const pass = $('authPassword').value;
  try {
    if (mode === 'register') await auth.createUserWithEmailAndPassword(email, pass);
    else await auth.signInWithEmailAndPassword(email, pass);
  } catch (e) { $('authMsg').textContent = e.message || String(e); }
}

function bindAppUi() {
  $('btnLogout').onclick = () => auth.signOut();
  $('btnExport').onclick = () => downloadJson(`p2p-backup-v5-${today()}.json`);
  $('fileImport').onchange = async ev => {
    const file = ev.target.files?.[0];
    if (!file || !repo) return;
    setStatus('Importando…');
    try {
      const result = await importFile(file, repo);
      if (!result.cancelled) {
        setStatus('Importado');
        alert('Importación completa. Firestore quedó reemplazado por el JSON.');
      }
    } catch (e) {
      setStatus('Error import');
      alert('Error importando: ' + (e.message || e));
    } finally { ev.target.value = ''; }
  };
  $('opFecha').value = today();
  $('opForm').onsubmit = createOperation;
}

async function loadConfig() {
  try {
    const cfg = await repo.getConfig();
    state.datos.bancos = cfg.bancos || {};
    state.datos.tags = cfg.tags || [];
    state.datos.tasasRecientes = cfg.tasasRecientes || [];
  } catch (e) { console.warn('config load failed', e); }
}

function setupListeners() {
  setStatus('Sincronizando…');
  for (const entity of ['operaciones', 'movimientos', 'transferencias']) {
    const unsub = repo.listenEntity(entity, applyChanges, err => {
      console.error('listener error', entity, err);
      setStatus('Error sync');
    });
    state.unsubscribers.push(unsub);
  }
}

function applyChanges(entity, changes, metadata) {
  for (const ch of changes) {
    if (ch.type === 'removed') removeEntityItem(entity, ch.id);
    else upsertEntityItem(entity, {...ch.data, id: ch.id});
  }
  recalcAndRender();
  setStatus(metadata.fromCache ? 'Cache local' : 'En línea');
}

function recalcAndRender() {
  const manualLots = (state.datos.lotes || []).filter(l => l.manual);
  const rebuilt = rebuildFifo(state.datos.operaciones, manualLots);
  state.datos.operaciones = rebuilt.operaciones;
  state.datos.lotes = rebuilt.lotes;
  state.datos.saldoUsdt = rebuilt.saldoUsdt;
  render();
}

async function createOperation(ev) {
  ev.preventDefault();
  if (!repo) return;
  const monto = Number($('opMonto').value || 0);
  const tasa = Number($('opTasa').value || 0);
  if (!(monto > 0) || !(tasa > 0)) return alert('Monto y tasa deben ser mayores a 0.');
  const op = {
    id: uid(),
    tipo: $('opTipo').value,
    moneda: $('opMoneda').value,
    banco: $('opBanco').value.trim(),
    fecha: $('opFecha').value || today(),
    hora: timeNow(),
    monto: roundMoney(monto, 2),
    tasa: roundMoney(tasa, 3),
    usdt: truncMoney(monto / tasa, 2),
    comisionPct: Number($('opComision').value || 0),
    createdAtLocal: new Date().toISOString()
  };
  upsertEntityItem('operaciones', op);
  recalcAndRender();
  setStatus('Guardando…');
  try {
    await repo.setItem('operaciones', op);
    setStatus('En línea');
    $('opMonto').value = '';
    $('opTasa').value = '';
  } catch (e) {
    console.error(e);
    setStatus('Pendiente local');
    alert('No se pudo guardar en Firestore. Exportá backup antes de cerrar.');
  }
}

function showAuth() {
  $('authView').classList.remove('hidden');
  $('appView').classList.add('hidden');
}

function showApp() {
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  setStatus('Conectando…');
}
