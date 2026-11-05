// שמירה מקומית בדפדפן (IndexedDB). בספרינט 2 תוחלף/תתווסף שמירה בענן.
const DB_NAME = 'health-exam-builder';
const STORES = { packages: 'id', questions: 'uid', cases: 'uid', media: 'key', exams: 'id' };
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        const s = db.createObjectStore(name, { keyPath });
        if (name === 'questions' || name === 'cases') s.createIndex('pkgId', 'pkgId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
const asPromise = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function getAll(store) {
  const db = await open();
  return asPromise(db.transaction(store).objectStore(store).getAll());
}
export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}
export async function del(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}

// שמירת חבילה כיחידה אחת (טרנזקציה אחת): כשל באמצע לא משאיר חבילה חלקית.
export async function savePackage({ pkg, questions, cases, media }) {
  const db = await open();
  const tx = db.transaction(['packages', 'questions', 'cases', 'media'], 'readwrite');
  const qs = tx.objectStore('questions'), cs = tx.objectStore('cases'), ms = tx.objectStore('media');
  // החלפה נקייה של גרסה קודמת של אותה חבילה (ייבוא חוזר לא יוצר כפילות)
  for (const [store, s] of [['questions', qs], ['cases', cs]]) {
    const req = s.index('pkgId').getAllKeys(pkg.id);
    await new Promise(r => { req.onsuccess = () => { req.result.forEach(k => s.delete(k)); r(); }; });
  }
  const mreq = ms.getAllKeys();
  await new Promise(r => { mreq.onsuccess = () => { mreq.result.filter(k => String(k).startsWith(pkg.id + '/')).forEach(k => ms.delete(k)); r(); }; });
  tx.objectStore('packages').put(pkg);
  questions.forEach(q => qs.put(q));
  cases.forEach(c => cs.put(c));
  for (const [key, data] of media) ms.put({ key, data });
  return done(tx);
}

export async function removePackage(pkgId) {
  const db = await open();
  const tx = db.transaction(['packages', 'questions', 'cases', 'media'], 'readwrite');
  tx.objectStore('packages').delete(pkgId);
  for (const name of ['questions', 'cases']) {
    const s = tx.objectStore(name);
    const req = s.index('pkgId').getAllKeys(pkgId);
    req.onsuccess = () => req.result.forEach(k => s.delete(k));
  }
  const ms = tx.objectStore('media');
  const mreq = ms.getAllKeys();
  mreq.onsuccess = () => mreq.result.filter(k => String(k).startsWith(pkgId + '/')).forEach(k => ms.delete(k));
  return done(tx);
}
