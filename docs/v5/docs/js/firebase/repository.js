import { ENTITIES } from '../config.js';

export class P2PRepository {
  constructor(db, uid) {
    this.db = db;
    this.uid = uid;
    this.root = db.collection('users').doc(uid);
  }

  col(entity) { return this.root.collection(entity); }
  configRef() { return this.root.collection('config').doc('main'); }

  async saveConfig(config) {
    await this.configRef().set({...config, updatedAt: firebase.firestore.FieldValue.serverTimestamp()}, {merge: true});
  }

  async getConfig() {
    const snap = await this.configRef().get();
    return snap.exists ? snap.data() : {};
  }

  async setItem(entity, item) {
    const id = String(item.id);
    await this.col(entity).doc(id).set({...item, id, updatedAt: firebase.firestore.FieldValue.serverTimestamp()}, {merge: true});
  }

  async deleteItem(entity, id) {
    await this.col(entity).doc(String(id)).delete();
  }

  listenEntity(entity, onChange, onError) {
    return this.col(entity).onSnapshot(snap => {
      const changes = snap.docChanges().map(ch => ({type: ch.type, id: ch.doc.id, data: ch.doc.data()}));
      onChange(entity, changes, snap.metadata);
    }, onError);
  }

  async getAll(entity) {
    const snap = await this.col(entity).get();
    return snap.docs.map(doc => ({...doc.data(), id: doc.id}));
  }

  async replaceEntity(entity, items, {batchSize = 400} = {}) {
    const incoming = new Map((items || []).map(item => [String(item.id), {...item, id: String(item.id)}]));
    const current = await this.col(entity).get();
    const currentIds = new Set(current.docs.map(d => d.id));
    const writes = [];
    for (const [id, item] of incoming) writes.push({type: 'set', id, item});
    for (const id of currentIds) if (!incoming.has(id)) writes.push({type: 'delete', id});

    let done = 0;
    while (writes.length) {
      const chunk = writes.splice(0, batchSize);
      const batch = this.db.batch();
      for (const w of chunk) {
        const ref = this.col(entity).doc(w.id);
        if (w.type === 'set') batch.set(ref, {...w.item, updatedAt: firebase.firestore.FieldValue.serverTimestamp()}, {merge: false});
        else batch.delete(ref);
      }
      await batch.commit();
      done += chunk.length;
    }
    return {entity, written: incoming.size, deleted: [...currentIds].filter(id => !incoming.has(id)).length, totalOps: done};
  }

  async replaceAll(data) {
    const results = [];
    for (const entity of ENTITIES) results.push(await this.replaceEntity(entity, data[entity] || []));
    await this.saveConfig(data.config || {});
    return results;
  }
}
