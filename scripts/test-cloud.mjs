// בדיקות בלי רשת: (1) לקוח Drive REST מול Drive מזויף, (2) תור שמירה ממתין, חשבון בלי Drive ותקלות רשת.
// כללי Firestore נבדקים באמולטור אמיתי: test-rules.mjs, test-cloud-emulator.mjs. Drive אמיתי לא נבדק כאן.
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

// ---- תור שמירה ממתין, חשבון בלי Drive, תקלות רשת (בלי Firestore) ----
import { createCloudStore } from '../src/cloud-store.js';
import { createMemStore } from '../src/outbox.js';
import { memDrive, localStub } from './helpers.mjs';
const noFs = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
const mkStore = (o = {}) => { const d = memDrive(), ob = createMemStore(), errs = []; const s = createCloudStore({ drive: d, firestore: noFs, uid: 'u1', local: localStub(), outbox: ob, onSyncError: e => errs.push(e), ...o }); return { s, d, ob, errs }; };
const exam = (id, t, u) => ({ id, title: t, updatedAt: u, items: [] });

{ // רגיל: נשמר ב-Drive, התור ריק
  const { s, d, ob } = mkStore();
  await s.saveExam(exam('e1', 'א', 1)); await s.saveExam(exam('e2', 'ב', 2));
  assert.deepEqual((await s.loadExams()).map(e => e.id), ['e2', 'e1']);
  assert.equal((await ob.keys()).length, 0, 'התור ריק אחרי הצלחה');
  await s.deleteExam('e1'); assert.equal((await s.loadExams()).length, 1);
  await s.savePersonalQuestion({ uid: 'p1', body: 'x' }); assert.equal((await s.loadPersonal())[0].uid, 'p1');
  await s.putMedia('user/abc', new Uint8Array([0x89, 1, 2])); assert.deepEqual([...await s.getMedia('user/abc')], [0x89, 1, 2]);
  assert.ok(d.files.has('exam-e2.json') && !d.files.has('exam-e1.json'));
}
{ // נפילת רשת בשמירה: הנתונים לא אובדים, השגיאה גלויה, והסנכרון מושלם בהמשך
  const { s, d, ob } = mkStore();
  d.fail = {};  // רשת נפלה
  await assert.rejects(s.saveExam(exam('e9', 'חשוב', 5)), e => e.code === 'sync-pending');
  assert.equal((await ob.keys()).length, 1, 'המבחן נשמר בתור במחשב');
  assert.equal((await s.loadExams()).find(e => e.id === 'e9')?.title, 'חשוב', 'המבחן עדיין מוצג ונטען (מהתור), גם בלי רשת');
  await assert.rejects(s.savePersonalQuestion({ uid: 'p9', body: 'שאלה' }), e => e.code === 'sync-pending');
  await assert.rejects(s.putMedia('user/img9', new Uint8Array([0x89, 9])), e => e.code === 'sync-pending');
  assert.equal((await s.pendingCount()), 3);
  d.fail = null;  // הרשת חזרה
  const r = await s.flush(); assert.deepEqual(r, { pending: 0, failed: 0 });
  assert.ok(d.files.has('exam-e9.json') && d.files.has('pq-p9.json') && d.files.has(mediaKey('user/img9')), 'הכול הגיע ל-Drive');
}
function mediaKey(k) { return 'img-' + k.replace(/[^\w.-]/g, '_'); }
{ // אין גישת קריאה ל-Drive (נפל בטעינה) ויש מבחן בתור: לא מאבדים אותו
  const { s, d, ob } = mkStore();
  d.fail = { status: 503 };
  await assert.rejects(s.saveExam(exam('e5', 'בתור', 3)), e => e.code === 'sync-pending');
  const list = await s.loadExams();
  assert.equal(list.length, 1); assert.equal(list[0].id, 'e5');
}
{ // שגיאת קריאה מלאה ובלי תור: השגיאה מוצגת (לא מאגר ריק שקט)
  const { s, d } = mkStore(); d.fail = { status: 403 };
  await assert.rejects(s.loadExams(), /Drive 403/);
}
{ // מחיקה בזמן תקלה לא מחזירה את המבחן, ולא נשמרת מחיקה שקרית
  const { s, d } = mkStore();
  await s.saveExam(exam('e7', 'למחיקה', 1));
  d.fail = {}; await assert.rejects(s.deleteExam('e7'), e => e.code === 'sync-pending');
  await assert.rejects(s.loadExams(), /Drive/, 'בלי רשת ובלי תור: שגיאה גלויה, לא רשימה ריקה שקרית');
  d.fail = null; await s.flush(); assert.ok(!d.files.has('exam-e7.json'));
  assert.equal((await s.loadExams()).length, 0, 'אחרי חזרת הרשת המחיקה הושלמה');
}
{ // פעולה חלקית: שמירה שנכשלה באמצע לא דורסת גרסה חדשה יותר בענן
  const { s, d, ob } = mkStore();
  await s.saveExam(exam('e8', 'ישן', 10));
  await ob.put('exam:e8', exam('e8', 'ישן יותר ממתין', 5));        // שארית ישנה בתור
  const list = await s.loadExams();
  assert.equal(list.find(e => e.id === 'e8').title, 'ישן', 'גרסה ישנה מהתור לא דורסת גרסה חדשה יותר בענן');
  assert.equal(JSON.parse(d.files.get('exam-e8.json')).title, 'ישן');
  assert.equal((await ob.keys()).length, 0, 'התור התנקה');
}
{ // חשבון בלי הרשאת Drive: אישי נשאר מקומי (ולא נשלח לענן), מאגר/הצעות לא תלויים ב-Drive
  const { s, d } = mkStore({ driveEnabled: false });
  await s.saveExam(exam('l1', 'מקומי', 1)); await s.savePersonalQuestion({ uid: 'lp', body: 'x' }); await s.putMedia('user/z', new Uint8Array([1]));
  assert.equal(d.calls, 0, 'אין קריאות ל-Drive');
  assert.equal(s.kind, 'cloud-bank-local-personal');
  assert.equal((await s.loadExams())[0].id, 'l1'); assert.equal((await s.loadPersonal())[0].uid, 'lp');
  assert.deepEqual(await s.flush(), { pending: 0, failed: 0 });
}
{ // אסימון Drive פג (401): שמירה מדווחת וממתינה; לא נזרקת שגיאה גולמית ולא נמחק כלום
  const { s, d, ob } = mkStore(); d.fail = { status: 401 };
  await assert.rejects(s.saveExam(exam('e3', 'x', 1)), e => e.code === 'sync-pending' && e.cause.status === 401);
  assert.equal((await ob.keys()).length, 1);
}
{ // מנהל: פעולת מנהל בלי הרשאה נחסמת כבר בלקוח (נוחות; האכיפה האמיתית בכללי Firestore)
  const { s } = mkStore();
  await assert.rejects(s.saveBankQuestion({ uid: 'x' }), e => e.code === 'not-admin');
  await assert.rejects(s.importPackage({}, {}), e => e.code === 'not-admin');
}
{ // קריאת מאגר נכשלת: חוזרים למאגר המקומי עם אזהרה גלויה
  const { s } = mkStore(); const b = await s.loadBank();
  assert.equal(b.questions[0].uid, 'local-q'); assert.match(b.warning, /אינו זמין/);
  assert.deepEqual(await s.loadSuggestions(), []);
}

// ---- כללי Firestore: בדיקה סטטית (בנוסף לאמולטור) ----
const rules = fs.readFileSync('firestore.rules', 'utf8');
assert.ok(!/allow[^;]*:\s*if\s+true/.test(rules), 'אסור allow ... if true');
assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/, 'חייב כלל סגירה כללי');
console.log('test-cloud: OK');
