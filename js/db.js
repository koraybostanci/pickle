// Local data layer: everything lives in IndexedDB on this device.
const NAME = 'kantar';
const VER = 1;
let dbp;

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
      res(db);
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
