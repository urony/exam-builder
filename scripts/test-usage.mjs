// בדיקות סימון "כבר השתמשתי" (לוגיקה טהורה + שמירה בשכבת הענן עם Drive מדומה, נתונים סינתטיים).
import assert from 'node:assert/strict';
import { savedUids, isUsed, usedSource, setManual, reconcile, mergeUsage, emptyUsage, normalizeUsage } from '../src/usage.js';
import { createCloudStore } from '../src/cloud-store.js';
import { createMemStore } from '../src/outbox.js';
import { LIMITS, checkQuota, quotaUsage, ADMIN_CONTACT, QUOTA_NOTE } from '../src/quota.js';
import { memDrive, localStub } from './helpers.mjs';

let n = 0; const t = (ok, msg) => { assert.ok(ok, msg); n++; };
const ex = (id, ...uids) => ({ id, items: uids.map(u => ({ id: 'i' + u, snap: { uid: u } })).concat([{ id: 'c', type: 'chapter' }, { id: 'd', snap: { uid: 'draft-1' } }]) });

// --- חישוב ממבחנים שמורים (לפי מזהה, לא טקסט) ---
const e1 = ex('e1', 'p:q1', 'p:q2'), e2 = ex('e2', 'p:q2', 'personal-9');
let saved = savedUids([e1, e2]);
t(saved.size === 3 && saved.has('p:q1') && saved.has('personal-9') && !saved.has('draft-1'), 'נגזר ממבחנים שמורים: כפילויות לא נספרות, טיוטות וכותרות לא');
let u = emptyUsage();
t(isUsed(u, saved, 'p:q1') && !isUsed(u, saved, 'p:q3') && usedSource(u, saved, 'p:q1') === 'exam', 'שאלה במבחן שמור = בשימוש אוטומטית');
// --- סימון ידני ---
u = setManual(u, saved, 'p:q3', true, 100);
t(isUsed(u, saved, 'p:q3') && usedSource(u, saved, 'p:q3') === 'manual', 'סימון ידני');
u = setManual(u, saved, 'p:q3', false, 200);
t(!isUsed(u, saved, 'p:q3'), 'ביטול סימון ידני');
u = setManual(u, saved, 'p:q1', false, 300);
t(!isUsed(u, saved, 'p:q1') && isUsed(u, saved, 'p:q2'), 'ביטול ידני גובר גם כשהשאלה עדיין במבחן שמור; שאלות אחרות לא מושפעות');
// --- מחיקת מבחן ---
let saved2 = savedUids([e2]);                                           // e1 נמחק
t(isUsed(u, saved2, 'p:q2') && !isUsed(u, saved2, 'p:q1'), 'מחיקת מבחן: שאלה שנשארה במבחן אחר עדיין בשימוש; השאר חוזרות ל"לא השתמשתי"');
t(!savedUids([]).has('p:q2') && !isUsed(emptyUsage(), savedUids([]), 'p:q2'), 'אין מבחנים = אין שימוש אוטומטי');
let um = setManual(emptyUsage(), saved, 'p:q8', true, 1);
t(isUsed(um, savedUids([]), 'p:q8'), 'סימון ידני נשמר גם בלי מבחנים');
// --- ניקוי חריג 0 כשהשאלה כבר לא במבחן שמור (כדי שמבחן חדש יסמן אותה) ---
const r = reconcile(u, saved2, 400);
t(r.changed && !isUsed(r.usage, saved2, 'p:q1') && isUsed(r.usage, savedUids([ex('e3', 'p:q1')]), 'p:q1'), 'אחרי ניקוי: מבחן חדש עם השאלה מסמן אותה שוב');
t(!reconcile(r.usage, saved2, 500).changed, 'ניקוי חוזר = ללא שינוי');
// --- מיזוג בין חלונות/מחשבים ---
const w1 = setManual(emptyUsage(), saved, 'a', true, 10), w2 = setManual(emptyUsage(), saved, 'b', true, 20);
const m = mergeUsage(w1, w2); t(isUsed(m, new Set(), 'a') && isUsed(m, new Set(), 'b'), 'סימונים שונים משני חלונות נשמרים שניהם');
const w3 = setManual(w1, saved, 'a', false, 30);
t(!isUsed(mergeUsage(w1, w3), new Set(['a']), 'a') && !isUsed(mergeUsage(w3, w1), new Set(['a']), 'a'), 'במיזוג הרישום המאוחר מנצח (בלי תלות בסדר)');
t(Object.keys(normalizeUsage({ m: { x: [9, 1], y: 'bad', z: [1, 'x'], ok: [1, 5] }, junk: 1 }).m).join() === 'ok', 'קובץ פגום/לא תקין מנוקה בבטחה');
t(Object.keys(normalizeUsage(null).m).length === 0 && Object.keys(normalizeUsage('abc').m).length === 0, 'קלט ריק/לא אובייקט');

// --- שמירה בענן (Drive מדומה): חשבונות נפרדים, כניסה חוזרת, כשל רשת ---
const mkCloud = (drive, uid, outbox = createMemStore()) => createCloudStore({ drive, firestore: async () => { throw new Error('no fs'); }, uid, local: localStub(), outbox, mediaCache: null });
const dA = memDrive(), dB = memDrive();
const A1 = mkCloud(dA, 'A'), B1 = mkCloud(dB, 'B');
await A1.saveUsage(setManual(emptyUsage(), new Set(), 'p:q1', true, 1000));
t(JSON.stringify(Object.keys((await A1.loadUsage()).m)) === '["p:q1"]', 'נשמר ונקרא מ-Drive');
t(Object.keys((await B1.loadUsage()).m).length === 0, 'חשבון אחר לא רואה את הסימון (Drive נפרד)');
const A2 = mkCloud(dA, 'A');                                              // כניסה חוזרת / מחשב אחר: אותו Drive
t(isUsed(await A2.loadUsage(), new Set(), 'p:q1'), 'כניסה חוזרת: הסימון נשמר');
await A2.saveUsage(setManual(await A2.loadUsage(), new Set(), 'p:q2', true, 2000));
await A1.saveUsage(setManual(emptyUsage(), new Set(), 'p:q3', true, 3000));  // חלון ישן שלא ראה את q2: לא דורס
const fin = await A1.loadUsage();
t(['p:q1', 'p:q2', 'p:q3'].every(k => isUsed(fin, new Set(), k)), 'שני חלונות כתבו במקביל: שום סימון לא אבד');
dA.fail = { status: 500 };
let err; try { await A1.saveUsage(setManual(fin, new Set(), 'p:q4', true, 4000)); } catch (e) { err = e; }
t(err?.code === 'sync-pending', 'כשל ב-Drive: נשמר בתור ומדווח (לא הצלחה כוזבת)');
dA.fail = null;
t(isUsed(await A1.loadUsage(), new Set(), 'p:q4'), 'אחרי שהחיבור חזר: הסימון שהמתין נשלח');
dA.files.set('usage.json', '{bad json');
const A3 = createCloudStore({ drive: dA, firestore: async () => { throw 1; }, uid: 'A', local: localStub(), outbox: createMemStore(), mediaCache: null, onSyncError: e => (err = e) });
err = null; t(Object.keys((await A3.loadUsage()).m).length === 0 && err?.where === 'drive-corrupt', 'קובץ שימוש פגום: לא מפיל את הטעינה, מדווח');

// --- בדיקה מקדימה של מכסות בדפדפן (האכיפה האמיתית נבדקת בכללי Firestore) ---
const pend = (k, img = 0) => Array.from({ length: k }, () => ({ status: 'pending', imageKeys: img ? ['a'] : [] }));
t(checkQuota([], { imageKeys: ['a', 'b', 'c'] }) === null, 'עד 3 תמונות: מותר');
t(checkQuota([], { imageKeys: ['a', 'b', 'c', 'd'] })?.code === 'quota-images-per', 'יותר מ-3 תמונות בהצעה: נחסם עם הסבר');
t(checkQuota(pend(50), {})?.code === 'quota-pending' && checkQuota(pend(49), {}) === null, 'מכסת 50 הצעות ממתינות');
t(checkQuota([...pend(10), { status: 'approved', imageKeys: ['x', 'y'] }, { status: 'rejected' }], {}) === null && quotaUsage([...pend(10), { status: 'approved', imageKeys: ['x'] }]).pending === 10, 'הצעות שאושרו או נדחו אינן נספרות');
t(checkQuota(pend(29, 1), { imageKeys: ['a', 'b'] })?.code === 'quota-images' && checkQuota(pend(27, 1), { imageKeys: ['a', 'b', 'c'] }) === null, 'מכסת 30 תמונות בהצעות ממתינות');
t(checkQuota([], { imageKeys: ['a'], imageSizes: [LIMITS.imageBytes + 1] })?.code === 'quota-image-size' && checkQuota([], { imageKeys: ['a'], imageSizes: [LIMITS.imageBytes] }) === null, 'תמונה מעל 2MB נחסמת, בדיוק 2MB מותרת');
t(ADMIN_CONTACT === 'urony@hotmail.com' && QUOTA_NOTE.includes('50'), 'נוסח המכסה וכתובת המנהל');
// --- ביצועים: אלפי שאלות ---
const big = Array.from({ length: 40 }, (_, i) => ex('b' + i, ...Array.from({ length: 150 }, (_, k) => 'p:q' + (i * 100 + k))));
const t0 = performance.now(); const sv = savedUids(big); let c = 0; for (let i = 0; i < 20000; i++) if (isUsed(um, sv, 'p:q' + i)) c++;
t(performance.now() - t0 < 300 && c > 0, `20,000 בדיקות על 6,000 פריטי מבחן: ${(performance.now() - t0).toFixed(0)}ms`);
console.log(`test-usage: OK (${n} בדיקות)`);
