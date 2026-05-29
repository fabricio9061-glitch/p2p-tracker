import { firebaseConfig } from '../config.js';

export function initFirebase() {
  if (!window.firebase) throw new Error('Firebase SDK no cargó');
  const app = firebase.apps?.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth(app);
  const db = firebase.firestore(app);
  db.enablePersistence({synchronizeTabs: true}).catch(() => {});
  return {app, auth, db};
}
