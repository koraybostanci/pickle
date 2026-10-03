// Local data layer: everything lives in IndexedDB on this device.
const NAME = 'denge';
const OLD_NAME = 'kantar'; // the app's first name: that database moves over once (moveFromOldName)
const VER = 1;
const STORES = ['entries', 'photos', 'days', 'kv'];
let dbp;

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// Copies everything from the database of the app's first name into this one, one record at a time (photos can be
// large, so they are never all held in memory), and deletes the old database only when every record has arrived.
// A record already here is not overwritten. If anything fails, the old database stays and the move runs again on the
// next launch.
async function moveFromOldName(db) {
  if (!indexedDB.databases) return;
  const list = await indexedDB.databases();
  if (!list.some((d) => d.name === OLD_NAME)) return;
  const old = await req(indexedDB.open(OLD_NAME));
  try {
    for (const store of STORES) {
      if (!old.objectStoreNames.contains(store)) continue;
      const keys = await req(old.transaction(store).objectStore(store).getAllKeys());
      for (const key of keys) {
        const here = await req(db.transaction(store).objectStore(store).get(key));
        if (here !== undefined) continue;
        const value = await req(old.transaction(store).objectStore(store).get(key));
        if (value === undefined) continue;
        await new Promise((res, rej) => {
          const t = db.transaction(store, 'readwrite');
          t.objectStore(store).put(value);
          t.oncomplete = res;
          t.onerror = () => rej(t.error);
          t.onabort = () => rej(t.error);
        });
      }
    }
  } finally {
    old.close();
  }
  await new Promise((res) => { const d = indexedDB.deleteDatabase(OLD_NAME); d.onsuccess = d.onerror = d.onblocked = res; });
}

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open(NAME, VER);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('day', 'day');
      }
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('days')) db.createObjectStore('days', { keyPath: 'day' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
    };
    rq.onsuccess = () => {
      const db = rq.result;
      // The browser may close the connection (iOS does after a long time in the background): open a new one next time
      db.onclose = () => { dbp = null; };
      db.onversionchange = () => { db.close(); dbp = null; };
      moveFromOldName(db).catch(() => { /* the old database stays; the move runs again next time */ }).then(() => res(db));
    };
    rq.onerror = () => { dbp = null; rej(rq.error); };
  });
  return dbp;
}

async function tx(store, mode, fn, again = true) {
  const db = await open();
  return new Promise((res, rej) => {
    let t;
    try {
      t = db.transaction(store, mode);
    } catch (err) {
      if (again && err && err.name === 'InvalidStateError') { dbp = null; res(tx(store, mode, fn, false)); } else rej(err);
      return;
    }
    const s = t.objectStore(store);
    let out;
    try {
      Promise.resolve(fn(s)).then((v) => { out = v; }, rej);
    } catch (err) {
      t.abort(); // nothing of a half-built batch is kept
      rej(err);
      return;
    }
    t.oncomplete = () => res(out);
    t.onerror = (ev) => rej((ev.target && ev.target.error) || t.error);
    t.onabort = () => rej(t.error);
  });
}
const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const all = (store) => tx(store, 'readonly', (s) => rq(s.getAll()));
export const keys = (store) => tx(store, 'readonly', (s) => rq(s.getAllKeys()));
export const get = (store, key) => tx(store, 'readonly', (s) => rq(s.get(key)));
export const put = (store, val) => tx(store, 'readwrite', (s) => rq(s.put(val)));
export const del = (store, key) => tx(store, 'readwrite', (s) => rq(s.delete(key)));
export const clear = (store) => tx(store, 'readwrite', (s) => rq(s.clear()));
export const putMany = (store, vals) => tx(store, 'readwrite', (s) => { vals.forEach((v) => s.put(v)); });

export async function kvGet(k, def) {
  const r = await get('kv', k);
  return r ? r.v : def;
}
export const kvSet = (k, v) => put('kv', { k, v });

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
