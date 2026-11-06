// תור שמירה ממתין: כל כתיבה לענן נרשמת קודם כאן (במחשב), ורק אחרי הצלחה היא נמחקת.
// כך נתוני מורה לא אובדים בתקלת רשת, בסגירת לשונית באמצע שמירה או בהרשאה שפגה.
export function createMemStore() {
  const m = new Map();
  return {
    async get(k) { return m.get(k); },
    async put(k, v) { m.set(k, v); },
    async del(k) { m.delete(k); },
    async keys(prefix = '') { return [...m.keys()].filter(k => k.startsWith(prefix)); },
  };
}

// מעל מחסן 'meta' של IndexedDB (key/value). `db` = src/db.js
export function createIdbStore(db, ns) {
  const full = k => ns + k;
  return {
    async get(k) { return (await db.getOne('meta', full(k)))?.value; },
    put: (k, v) => db.put('meta', { key: full(k), value: v }),
    del: k => db.del('meta', full(k)),
    async keys(prefix = '') { return (await db.getAll('meta')).map(r => r.key).filter(k => k.startsWith(ns + prefix)).map(k => k.slice(ns.length)); },
  };
}
