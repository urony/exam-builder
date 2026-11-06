// בדיקות בלי רשת: (1) לקוח Drive מול Drive מזויף בזיכרון, (2) בדיקה סטטית של firestore.rules.
// לא מחליף בדיקת כללים באמולטור Firestore (דורש Java) ולא בדיקה מול Drive אמיתי.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createDrive } from '../src/drive.js';

// ---- Drive מזויף ----
const files = new Map(); let n = 0; const calls = [];
function parseMultipart(buf) {
  const s = Buffer.from(buf).toString('latin1');
  const parts = s.split(/--b[a-z0-9]+/).filter(p => p.includes('Content-Type'));
  const body = p => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
  return { meta: JSON.parse(body(parts[0])), data: Buffer.from(body(parts[1]), 'latin1') };
}
const fakeFetch = async (url, opt = {}) => {
  calls.push({ url, method: opt.method || 'GET', auth: opt.headers?.Authorization });
  const u = new URL(url); const method = opt.method || 'GET';
  const json = o => ({ ok: true, status: 200, json: async () => o });
  if (u.pathname === '/drive/v3/files' && method === 'GET') return json({ files: [...files.entries()].map(([id, f]) => ({ id, name: f.name, modifiedTime: 't' })) });
  if (u.pathname.startsWith('/upload/')) {
    const { meta, data } = parseMultipart(opt.body);
    if (method === 'POST') { assert.deepEqual(meta.parents, ['appDataFolder']); files.set('f' + ++n, { name: meta.name, data }); }
    else files.get(u.pathname.split('/').pop()).data = data;
    return json({});
  }
  const id = u.pathname.split('/').pop();
  if (method === 'DELETE') { files.delete(id); return { ok: true, status: 204 }; }
  if (u.searchParams.get('alt') === 'media') return { ok: true, status: 200, arrayBuffer: async () => { const d = files.get(id).data; return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength); } };
  return { ok: false, status: 404 };
};

const drive = createDrive({ getToken: () => 'tok', fetchImpl: fakeFetch });
await drive.putJson('exam-1.json', { title: 'מבחן בעברית ✓', items: [1, 2] });
await drive.putJson('exam-1.json', { title: 'עודכן' });        // עדכון, לא קובץ חדש
await drive.putJson('pq-9.json', { x: 1 });
assert.equal(files.size, 2, 'עדכון לא יוצר כפילות');
assert.deepEqual(await drive.getJson('exam-1.json'), { title: 'עודכן' });
assert.equal(await drive.getJson('nope.json'), null);
assert.deepEqual((await drive.list('exam-')).map(f => f.name), ['exam-1.json']);
const png = new Uint8Array([137, 80, 78, 71, 0, 255, 128, 13, 10]);
await drive.putBytes('img-a', png, 'image/png');
assert.deepEqual([...await drive.getBytes('img-a')], [...png], 'בייטים בינאריים נשמרים כמות שהם');
await drive.remove('pq-9.json');
assert.equal(files.size, 2);
assert.ok(calls.every(c => c.auth === 'Bearer tok'));
await assert.rejects(createDrive({ getToken: () => null, fetchImpl: fakeFetch }).list(), /התחברות/);

// ---- cloud-store מעל Drive מזויף + Firestore מזויף ----
const { createCloudStore } = await import('../src/cloud-store.js');
files.clear();
const sugg = new Map();
const fsFake = {
  collection: (_, n) => ({ n }), doc: (_, c, id) => ({ c, id }), where: () => null, query: c => c,
  setDoc: async (r, v) => { sugg.set(r.id, v); },
  getDocs: async c => ({ docs: c.n === 'bank' ? [] : [...sugg.values()].map(v => ({ data: () => v })) }),
};
const localStub = { async loadBank() { return { packages: [], questions: ['local'], cases: [], media: new Map() }; }, async loadTaxonomy() { return {}; } };
const cs = createCloudStore({ drive, firestore: async () => ({ fs: fsFake, db: {} }), uid: 'u1', local: localStub });
await cs.saveExam({ id: 'e1', title: 'א', updatedAt: 1, items: [] });
await cs.saveExam({ id: 'e2', title: 'ב', updatedAt: 2, items: [] });
assert.deepEqual((await cs.loadExams()).map(e => e.id), ['e2', 'e1']);
await cs.deleteExam('e1');
assert.equal((await cs.loadExams()).length, 1);
await cs.savePersonalQuestion({ uid: 'p1', body: 'x' });
assert.equal((await cs.loadPersonal())[0].uid, 'p1');
await cs.putMedia('user/abc', new Uint8Array([0x89, 1, 2]));
assert.deepEqual([...await cs.getMedia('user/abc')], [0x89, 1, 2]);
const rec = await cs.submitSuggestion({ uid: 'p1', body: 'x' }, { credit: false, authorName: 'שם' });
assert.equal(rec.authorUid, 'u1'); assert.equal(rec.status, 'pending'); assert.equal(rec.authorName, '');
assert.equal((await cs.loadSuggestions()).length, 1);
assert.deepEqual((await cs.loadBank()).questions, ['local'], 'מאגר מרכזי ריק -> נשאר המאגר המקומי');

// Firestore חוסם הכול (כללים נעולים): התחברות, מבחנים ו-Drive חייבים להמשיך לעבוד
const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const fsDenied = { collection: () => ({}), query: () => ({}), where: () => null, doc: () => ({}), getDocs: async () => { throw denied; }, setDoc: async () => { throw denied; } };
const cs2 = createCloudStore({ drive, firestore: async () => ({ fs: fsDenied, db: {} }), uid: 'u1', local: localStub });
assert.deepEqual(await cs2.loadSuggestions(), [], 'הצעות: שגיאת הרשאה לא נזרקת');
assert.deepEqual((await cs2.loadBank()).questions, ['local'], 'מאגר: שגיאת הרשאה -> fallback מקומי');
assert.equal((await cs2.loadExams()).length, 1, 'Drive ממשיך לעבוד');
await assert.rejects(cs2.submitSuggestion({ uid: 'z' }), /permissions/, 'שליחת הצעה כן מדווחת שגיאה (המשתמש צריך לדעת)');

// ---- כללי Firestore: בדיקה סטטית ----
const rules = fs.readFileSync('firestore.rules', 'utf8');
assert.ok(!/allow[^;]*:\s*if\s+true/.test(rules), 'אסור allow ... if true');
assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/, 'חייב כלל סגירה כללי');
assert.match(rules, /match \/bank\/\{docId\}[\s\S]*allow write: if isAdmin\(\)/, 'כתיבה למאגר רק למנהל');
assert.match(rules, /match \/admins\/\{uid\}[\s\S]*allow list, write: if false/, 'אין כתיבה/רשימה למסמכי מנהל');
assert.match(rules, /authorUid == request\.auth\.uid/, 'הצעה רק על שם המחובר');
assert.match(rules, /allow update, delete: if isAdmin\(\)/, 'עדכון הצעות רק למנהל');
console.log('test-cloud: OK (Drive מזויף + בדיקה סטטית של כללים; לא אמולטור)');
