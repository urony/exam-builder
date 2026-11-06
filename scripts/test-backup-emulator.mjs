// שחזור מלא מגיבוי עצמאי מול אמולטור Firestore (נתונים סינתטיים בלבד, לא נוגע בענן האמיתי).
// התרחיש: בונים מאגר עשיר -> גיבוי -> מוחקים את כל Firestore -> משחזרים רק מקובץ הגיבוי -> משווים הכול.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { initializeApp } from 'firebase/app';
import * as F from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createCloudStore } from '../src/cloud-store.js';
import { createMemStore } from '../src/outbox.js';
import { buildBackup, parseBackup, sha256, referencedMedia } from '../src/backup.js';
import { planBulk, runBulk } from '../src/admin-bulk.js';
import { memDrive, localStub, syntheticPackage } from './helpers.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('test-backup-emulator: דילוג – אין אמולטור Firestore (לא נבדק)'); process.exit(0); }
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-exam', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } });
const resetCloud = async () => { await env.clearFirestore(); await env.withSecurityRulesDisabled(c => c.firestore().doc('admins/ADMIN').set({ note: 'manual' })); };
await resetCloud();

function fsFor(uid) {
  const app = initializeApp({ projectId: 'demo-exam', ['api' + 'Key']: 'demo' }, 'bk-' + uid + Math.random());
  const db = F.getFirestore(app);
  F.connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: uid, firebase: { sign_in_provider: 'google.com' } } });
  return { fs: F, db };
}
// חנות חדשה בכל קריאה = בלי מטמון ובלי מצב בזיכרון (מוכיח שאין תלות בהפעלה הנוכחית של הדפדפן)
const mk = (uid, isAdmin = false) => { const f = fsFor(uid); return createCloudStore({ drive: memDrive(), firestore: async () => ({ fs: F, db: f.db }), uid, isAdmin, local: localStub(), outbox: createMemStore() }); };
let n = 0; const t = (ok, msg) => { assert.ok(ok, msg); n++; };
const hashBytes = async m => Object.fromEntries((await Promise.all([...m].map(async ([k, v]) => [k, await sha256(v)]))).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
const rawCount = async col => { const { fs: f, db } = fsFor('ADMIN'); return (await f.getDocs(f.collection(db, col))).docs.length; };

// ---------- בניית מאגר עשיר ----------
const admin = mk('ADMIN', true);
const big = syntheticPackage(70, { pkgId: 'pkg-a', imageBytes: 1_700_000 });          // תמונה גדולה = כמה חלקים
big.pkg.taxonomy = { types: { open: 'פתוחה' }, domains: { cardiology: 'קרדיולוגיה' } };
// מחוון סרוק + תמונה בסיפור מקרה
big.questions[1].rubric = { answer: [{ type: 'image', mediaKey: 'pkg-a/rub2.png' }, { type: 'text', text: 'תשובה' }] };
big.questions[1].caseStudyId = 'pkg-a:c1';
big.cases[0].blocks.push({ type: 'image', mediaKey: 'pkg-a/case1.png' });
big.media.set('pkg-a/rub2.png', Uint8Array.from({ length: 900_000 }, (_, i) => (i * 11 + 5) & 255));
big.media.set('pkg-a/case1.png', Uint8Array.from({ length: 150_000 }, (_, i) => (i * 13 + 7) & 255));
const hid = syntheticPackage(4, { pkgId: 'pkg-hid', imageBytes: 400_000 });             // חבילה מוסתרת (לא מפורסמת)
await admin.importPackage(big, { publish: true });
await admin.importPackage(hid, { publish: false });
await admin.saveTaxonomy({ domains: { cardiology: 'קרדיולוגיה (מותאם)' }, types: { open: 'פתוחה' } });
// הסתרת שאלה, שדות ניהול, עריכה קבוצתית עם היסטוריה
let bank = await admin.loadBank();
const q3 = bank.questions.find(q => q.uid === 'pkg-a:q3'); await admin.saveBankQuestion({ ...q3, published: false, reviewFlag: true, conflictNote: 'הערה' });
bank = await admin.loadBank();
const sel = ['pkg-a:q1', 'pkg-a:q2'].map(u => ({ ...bank.questions.find(q => q.uid === u), kind: 'bagrut' }));
const plan = planBulk(sel, { year: 2020, session: 'קיץ' });
const bres = await runBulk(plan, q => admin.saveBankQuestion(q), '2026-11-06T00:00:00Z');
t(bres.ok.length === 2, 'הכנה: עריכה קבוצתית עם היסטוריה נשמרה');
const hq = (await admin.loadBank()).questions.find(q => q.uid === 'pkg-a:q1'); await admin.saveBankQuestion({ ...hq, authorAdmin: 'גב׳ בדיקה', submitterUid: 'u-1', submitterName: 'מורה' });

// ---------- צילום מצב לפני (מבט מנהל ומבט מורה + בתים של כל תמונה) ----------
const snap = async () => {
  const a = mk('ADMIN', true), tch = mk('teacherX');
  const ab = await a.loadBank(), tb = await tch.loadBank();
  const keys = new Set(await a.listMediaKeys());
  const media = new Map(); for (const k of keys) media.set(k, await a.getMedia(k));
  const tmedia = new Map(); for (const k of referencedMedia(tb)) { const d = await tch.getMedia(k); if (d) tmedia.set(k, d); }
  const sort = arr => [...arr].sort((x, y) => (x.uid < y.uid ? -1 : 1));
  return { adminQ: sort(ab.questions), adminC: sort(ab.cases), pk: ab.packages, tax: await a.loadTaxonomy(), teachQ: sort(tb.questions), teachC: sort(tb.cases), media: await hashBytes(media), tmedia: await hashBytes(tmedia) };
};
const before = await snap();
t(before.adminQ.length === 74 && before.teachQ.length === 69, `לפני: ${before.adminQ.length} שאלות למנהל, ${before.teachQ.length} למורה (הסתרה)`);
t(Object.keys(before.media).length === 4, 'לפני: 4 תמונות במאגר (' + Object.keys(before.media).length + ')');

// ---------- גיבוי עצמאי (חנות חדשה = בלי זיכרון) ----------
const bk = mk('ADMIN', true); const cur = await bk.loadBank();
const built = await buildBackup({ JSZip, central: { packages: cur.packages, questions: cur.questions, cases: cur.cases, taxonomy: await bk.loadTaxonomy() }, listKeys: () => bk.listMediaKeys(), getMedia: k => bk.getMedia(k) });
t(built.central.counts.media === 4 && built.central.counts.questions === 74, 'הגיבוי כולל את כל 4 התמונות ו-74 השאלות (' + JSON.stringify(built.central.counts) + ')');
const zipBytes = built.data;

// ---------- מוחקים את כל הענן ----------
await resetCloud();
t((await rawCount('bank')) === 0 && (await rawCount('bankMedia')) === 0 && (await rawCount('bankPrivate')) === 0, 'כל נתוני המאגר נמחקו מ-Firestore');
t((await mk('ADMIN', true).loadBank()).questions.length === 0, 'המאגר ריק לחלוטין');

// ---------- שחזור רק מהקובץ ----------
const parsed = await parseBackup({ JSZip, data: zipBytes });
t(parsed.missingMedia.length === 0 && !parsed.legacy, 'הקובץ נקרא: אין תמונות חסרות');
const rst = mk('ADMIN', true);
await rst.replaceCentral({ packages: parsed.central.packages, questions: parsed.central.questions, cases: parsed.central.cases, media: parsed.media, taxonomy: parsed.central.taxonomy, keepMediaKeys: parsed.missingMedia });
const after = await snap();
const same = (a, b, msg) => t(JSON.stringify(a) === JSON.stringify(b), msg);
same(after.adminQ.map(q => q.uid), before.adminQ.map(q => q.uid), 'אותם מזהי שאלות (74), ללא כפילויות');
same(after.adminQ, before.adminQ, 'תוכן כל השאלות זהה בבייט (מבט מנהל: כולל מחבר, מגיש, היסטוריה, דגלים, מצב פרסום)');
same(after.adminC, before.adminC, 'סיפורי מקרה זהים');
same(after.pk, before.pk, 'חבילות זהות');
same(after.tax, before.tax, 'מילוני סיווג זהים (כולל שינוי שם מותאם)');
same(after.teachQ, before.teachQ, 'מבט מורה זהה: שאלות מוסתרות לא נחשפו, אין שדות ניהול');
same(after.teachC, before.teachC, 'סיפורי מקרה למורה זהים');
same(after.media, before.media, 'כל 4 התמונות זהות בבייט (hash) לפני ואחרי');
same(after.tmedia, before.tmedia, 'התמונות שהמורה רואה זהות; תמונות מוסתרות לא נחשפו למורה');
t(!after.teachQ.some(q => ['pkg-a:q3', 'pkg-hid:q1'].includes(q.uid)) && !JSON.stringify(after.teachQ).includes('sourceHistory'), 'מוסתר נשאר מוסתר; sourceHistory לא אצל מורה');
const q1 = after.adminQ.find(q => q.uid === 'pkg-a:q1');
t(q1.year === 2020 && q1.sourceHistory.length === 2 && q1.authorAdmin === 'גב׳ בדיקה' && q1.submitterUid === 'u-1', 'היסטוריית עריכה קבוצתית ושדות מחבר/מגיש שוחזרו');
const allRefs = referencedMedia({ questions: after.adminQ, cases: after.adminC });
t(allRefs.size === 4 && [...allRefs].every(k => k in after.media), 'כל תמונה שמופנית (בלוקים, מחוון סרוק, סיפור מקרה) קיימת אחרי שחזור');
t(after.adminQ.find(q => q.uid === 'pkg-a:q2').caseStudyId === 'pkg-a:c1' && after.adminC.some(c => c.uid === 'pkg-a:c1'), 'שיוך שאלה לסיפור מקרה נשמר');

// ---------- שחזור כפול: אידמפוטנטי, בלי כפילויות ובלי שאריות ----------
const counts = async () => [await rawCount('bank'), await rawCount('bankPrivate'), await rawCount('bankMedia')];
const c1 = await counts();
await mk('ADMIN', true).replaceCentral({ packages: parsed.central.packages, questions: parsed.central.questions, cases: parsed.central.cases, media: parsed.media, taxonomy: parsed.central.taxonomy });
t(JSON.stringify(await counts()) === JSON.stringify(c1), 'שחזור שני: מספר המסמכים זהה (אין כפילויות/שאריות) ' + c1);
same((await snap()).adminQ, before.adminQ, 'אחרי שחזור שני התוכן עדיין זהה');

// ---------- שחזור על מאגר "מלוכלך" (נתונים אחרים שנשארו) מוחק שאריות ----------
await mk('ADMIN', true).importPackage(syntheticPackage(3, { pkgId: 'junk', imageBytes: 100_000 }), { publish: true });
await mk('ADMIN', true).replaceCentral({ packages: parsed.central.packages, questions: parsed.central.questions, cases: parsed.central.cases, media: parsed.media, taxonomy: parsed.central.taxonomy });
const s3 = await snap();
t(!s3.adminQ.some(q => q.pkgId === 'junk') && !('junk/q1.png' in s3.media) && JSON.stringify(await counts()) === JSON.stringify(c1), 'שאריות ממאגר קודם נוקו; המבנה זהה לגיבוי');

// ---------- גיבוי ישן (v1) ----------
const v1c = { version: 1, createdAt: '2026-11-05T00:00:00Z', packages: built.central.packages, questions: built.central.questions, cases: built.central.cases, taxonomy: { domains: {}, types: {} } };
const mkV1 = async withMedia => { const z = new JSZip(); z.file('central.json', JSON.stringify(v1c)); if (withMedia) for (const [k, v] of parsed.media) z.file('media/' + encodeURIComponent(k), v); return z.generateAsync({ type: 'uint8array' }); };
// v1 עם תמונות: שחזור מלא על ענן ריק
await resetCloud();
const pv1 = await parseBackup({ JSZip, data: await mkV1(true) });
await mk('ADMIN', true).replaceCentral({ packages: pv1.central.packages, questions: pv1.central.questions, cases: pv1.central.cases, media: pv1.media, taxonomy: pv1.central.taxonomy, keepMediaKeys: pv1.missingMedia });
const sv1 = await snap();
same(sv1.adminQ, before.adminQ.map(q => q), 'v1 עם תמונות: שאלות זהות');
same(sv1.media, before.media, 'v1 עם תמונות: כל התמונות זהות');
// v1 בלי תמונות (הגיבוי שהמשתמש הוריד): על ענן שעדיין מכיל את התמונות -> התמונות נשמרות
const pv1b = await parseBackup({ JSZip, data: await mkV1(false) });
t(pv1b.legacy && pv1b.missingMedia.length === 4, 'v1 בלי תמונות: זוהו 4 תמונות חסרות');
await mk('ADMIN', true).replaceCentral({ packages: pv1b.central.packages, questions: pv1b.central.questions, cases: pv1b.central.cases, media: pv1b.media, taxonomy: pv1b.central.taxonomy, keepMediaKeys: pv1b.missingMedia });
const sv1b = await snap();
same(sv1b.media, before.media, 'v1 בלי תמונות על ענן שבו התמונות קיימות: התמונות נשמרו, לא נמחקו');
same(sv1b.adminQ.map(q => q.uid), before.adminQ.map(q => q.uid), 'v1 בלי תמונות: כל השאלות שוחזרו');
// v1 בלי תמונות על ענן ריק: השאלות חוזרות, התמונות לא (ולכן מדווח במפורש; אי אפשר לשחזר תמונות שאין)
await resetCloud();
await mk('ADMIN', true).replaceCentral({ packages: pv1b.central.packages, questions: pv1b.central.questions, cases: pv1b.central.cases, media: pv1b.media, taxonomy: pv1b.central.taxonomy, keepMediaKeys: pv1b.missingMedia });
const sv1c = await snap();
t(sv1c.adminQ.length === 74 && Object.keys(sv1c.media).length === 0, 'v1 בלי תמונות על ענן ריק: 74 שאלות חזרו אך 0 תמונות (מוכח: גיבוי כזה אינו עצמאי)');

// ---------- הרשאות: מורה/מזייף לא משחזר ----------
const forged = mk('teacherX', true);
try { await forged.replaceCentral({ packages: [], questions: [], cases: [], media: new Map() }); assert.fail('היה אמור להיכשל'); } catch (e) { t(e.code === 'permission-denied' || /permission/.test(e.message), 'מורה מזייף דגל מנהל: שחזור נחסם בכללים'); }
t((await mk('ADMIN', true).loadBank()).questions.length === 74, 'ניסיון השחזור המזויף לא שינה דבר');

// ---------- פעולות מקבילות: שתי לשוניות/מנהלים לא דורסים זה את זה בשקט ----------
{
  await resetCloud();
  const base = mk('ADMIN', true); await base.importPackage(syntheticPackage(10, { pkgId: 'cc', imageBytes: 50_000 }), { publish: true });
  const tabA = mk('ADMIN', true), tabB = mk('ADMIN', true);
  const la = await tabA.loadBank(), lb = await tabB.loadBank();              // שתיהן טוענות אותו מצב
  const qa = la.questions.find(q => q.uid === 'cc:q1'), qb = lb.questions.find(q => q.uid === 'cc:q2');   // שאלות שונות באותה חבילה
  await tabA.saveBankQuestion({ ...qa, title: 'נערך בלשונית א' });
  let err = null; try { await tabB.saveBankQuestion({ ...qb, title: 'נערך בלשונית ב (מיושנת)' }); } catch (e) { err = e; }
  t(err && err.code === 'conflict', 'לשונית מיושנת נחסמת עם conflict ולא דורסת (' + (err && err.code) + ')');
  let cur = (await mk('ADMIN', true).loadBank()).questions;
  t(cur.find(q => q.uid === 'cc:q1').title === 'נערך בלשונית א' && cur.find(q => q.uid === 'cc:q2').title !== 'נערך בלשונית ב (מיושנת)' && cur.length === 10, 'השינוי של לשונית א נשמר, אף שאלה לא אבדה');
  // אחרי conflict: טעינה מחדש ושמירה מצליחה, ושני השינויים קיימים
  const lb2 = await tabB.loadBank(); await tabB.saveBankQuestion({ ...lb2.questions.find(q => q.uid === 'cc:q2'), title: 'נערך בלשונית ב (אחרי טעינה)' });
  cur = (await mk('ADMIN', true).loadBank()).questions;
  t(cur.find(q => q.uid === 'cc:q1').title === 'נערך בלשונית א' && cur.find(q => q.uid === 'cc:q2').title === 'נערך בלשונית ב (אחרי טעינה)', 'אחרי טעינה מחדש שני השינויים קיימים');
  // שמירה רצופה באותה לשונית (ללא טעינה מחדש) ממשיכה לעבוד
  const lc = await tabA.loadBank(); await tabA.saveBankQuestion({ ...lc.questions.find(q => q.uid === 'cc:q3'), title: 'ג1' }); await tabA.saveBankQuestion({ ...lc.questions.find(q => q.uid === 'cc:q4'), title: 'ד1' });
  t((await mk('ADMIN', true).loadBank()).questions.filter(q => ['ג1', 'ד1'].includes(q.title)).length === 2, 'שמירות רצופות באותה לשונית עובדות');
  // ייבוא ממלאכה מיושנת לא משאיר איורים יתומים ולא דורס
  const stale = mk('ADMIN', true); await stale.loadBank();
  await mk('ADMIN', true).saveBankQuestion({ ...(await mk('ADMIN', true).loadBank()).questions.find(q => q.uid === 'cc:q5'), title: 'שינוי מקביל' });
  const mediaBefore = await rawCount('bankMedia');
  let e2 = null; try { await stale.importPackage(syntheticPackage(3, { pkgId: 'late', imageBytes: 100_000 }), { publish: true }); } catch (e) { e2 = e; }
  t(e2 && e2.code === 'conflict' && await rawCount('bankMedia') === mediaBefore, 'ייבוא ממצב מיושן נחסם לפני כתיבת איורים (אין איורים יתומים)');
  t((await mk('ADMIN', true).loadBank()).questions.find(q => q.uid === 'cc:q5').title === 'שינוי מקביל', 'שינוי מקביל לא נדרס');
  // taxonomy/meta מיושנים
  const m1 = mk('ADMIN', true), m2 = mk('ADMIN', true); await m1.loadTaxonomy(); await m2.loadTaxonomy();
  await m1.saveTaxonomy({ domains: { cardiology: 'א' }, types: {} });
  let e3 = null; try { await m2.saveTaxonomy({ domains: { cardiology: 'ב' }, types: {} }); } catch (e) { e3 = e; }
  t(e3 && e3.code === 'conflict' && (await mk('ADMIN', true).loadTaxonomy()).domains.cardiology === 'א', 'meta מיושן נחסם ולא דורס');
}

// ---------- שדות ניהול: פורמט ישן (מסמך יחיד) -> חדש (לכל חבילה), וגדילה לאלפי שאלות ----------
{
  await resetCloud();
  const a0 = mk('ADMIN', true); await a0.importPackage(syntheticPackage(8, { pkgId: 'mg' }), { publish: true });
  // מדמים מצב ישן בענן: שדות הניהול במסמך יחיד bankPrivate/adm
  await env.withSecurityRulesDisabled(c => c.firestore().doc('bankPrivate/adm').set({ kind: 'adm', json: JSON.stringify({ 'mg:q2': { authorAdmin: 'מהישן', reviewFlag: true } }) }));
  const legacy = await mk('ADMIN', true).loadBank();
  t(legacy.questions.find(q => q.uid === 'mg:q2').authorAdmin === 'מהישן', 'פורמט ישן (adm) עדיין נקרא');
  const am = mk('ADMIN', true); const lm = await am.loadBank();
  await am.saveBankQuestion({ ...lm.questions.find(q => q.uid === 'mg:q3'), authorAdmin: 'חדש' });
  const ids = async () => { const { fs: f, db } = fsFor('ADMIN'); return (await f.getDocs(f.collection(db, 'bankPrivate'))).docs.map(d => d.id).sort(); };
  const after = await mk('ADMIN', true).loadBank();
  t(!(await ids()).includes('adm') && (await ids()).some(i => i.startsWith('adm-q-')), 'כתיבה ראשונה העבירה לפורמט חדש ומחקה את הישן: ' + (await ids()).join(','));
  t(after.questions.find(q => q.uid === 'mg:q2').authorAdmin === 'מהישן' && after.questions.find(q => q.uid === 'mg:q3').authorAdmin === 'חדש' && after.questions.find(q => q.uid === 'mg:q2').reviewFlag === true, 'שדות הניהול שרדו את ההעברה');
  t(!JSON.stringify((await mk('teacherX').loadBank()).questions).includes('מהישן'), 'מורה לא רואה שדות ניהול (פורמט חדש)');
  // גדילה: 4000 שאלות עם היסטוריה ומחבר. במסמך יחיד זה חורג ממגבלת ~900KB.
  await resetCloud();
  const big = syntheticPackage(4000, { pkgId: 'scale' });
  for (const q of big.questions) { q.authorAdmin = 'מחבר ' + q.uid; q.sourceHistory = [1, 2, 3].map(i => ({ at: '2026-11-06T00:00:00.000Z', field: 'year', from: 2000 + i, to: 2001 + i })); }
  const t0 = Date.now(); await mk('ADMIN', true).importPackage(big, { publish: true });
  const { fs: f, db } = fsFor('ADMIN'); const priv = (await f.getDocs(f.collection(db, 'bankPrivate'))).docs.filter(d => d.id.startsWith('adm-'));
  const total = priv.reduce((a, d) => a + d.data().json.length, 0), maxDoc = Math.max(...priv.map(d => d.data().json.length));
  t(total > 900_000 && maxDoc < 900_000 && priv.length > 1, 'שדות ניהול של 4000 שאלות: ' + total + ' בתים בסך הכול (מעל מגבלת מסמך יחיד), מקסימום מסמך ' + maxDoc + ', ' + priv.length + ' מסמכים');
  const back = await mk('ADMIN', true).loadBank();
  t(back.questions.length === 4000 && back.questions.every(q => q.authorAdmin === 'מחבר ' + q.uid && q.sourceHistory.length === 3), 'כל 4000 השאלות חוזרות למנהל עם מחבר והיסטוריה (' + (Date.now() - t0) + 'ms כולל ייבוא)');
  const tq = (await mk('teacherX').loadBank()).questions;
  t(tq.length === 4000 && !JSON.stringify(tq).includes('sourceHistory') && !JSON.stringify(tq).includes('מחבר '), 'מורה רואה 4000 שאלות ללא שדות ניהול');
  const one = mk('ADMIN', true); const l1 = await one.loadBank(); await one.saveBankQuestion({ ...l1.questions[1234], authorAdmin: 'עודכן' });
  t((await mk('ADMIN', true).loadBank()).questions.find(q => q.uid === l1.questions[1234].uid).authorAdmin === 'עודכן', 'עריכת שאלה אחת במאגר גדול עובדת');
}

console.log(`test-backup-emulator: OK (${n} בדיקות שחזור מלא מול אמולטור)`);
process.exit(0);
