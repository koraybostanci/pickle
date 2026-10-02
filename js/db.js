// Yerel veri katmanı: her şey bu cihazdaki IndexedDB'de durur.
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
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const all = (store) => tx(store, 'readonly', (s) => rq(s.getAll()));
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
