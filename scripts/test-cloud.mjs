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

// ---- כללי Firestore: בדיקה סטטית ----
const rules = fs.readFileSync('firestore.rules', 'utf8');
assert.ok(!/allow[^;]*:\s*if\s+true/.test(rules), 'אסור allow ... if true');
assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/, 'חייב כלל סגירה כללי');
assert.match(rules, /match \/bank\/\{docId\}[\s\S]*allow write: if isAdmin\(\)/, 'כתיבה למאגר רק למנהל');
assert.match(rules, /match \/admins\/\{uid\}[\s\S]*allow list, write: if false/, 'אין כתיבה/רשימה למסמכי מנהל');
assert.match(rules, /authorUid == request\.auth\.uid/, 'הצעה רק על שם המחובר');
assert.match(rules, /allow update, delete: if isAdmin\(\)/, 'עדכון הצעות רק למנהל');
console.log('test-cloud: OK (Drive מזויף + בדיקה סטטית של כללים; לא אמולטור)');
