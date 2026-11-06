// בדיקת אינטגרציה: הקוד האמיתי של cloud-store מול אמולטור Firestore עם כללי האבטחה האמיתיים.
// זהויות: מורה א׳, מורה ב׳, מנהל (admins/{uid}), ומורה שמזייף דגל isAdmin בלקוח (הכללים חייבים לחסום אותו).
// נתונים סינתטיים בלבד. בלי אמולטור (FIRESTORE_EMULATOR_HOST) הבדיקה מדלגת ומדווחת זאת.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase/app';
import * as F from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createCloudStore, hashKey } from '../src/cloud-store.js';
import { createMemStore } from '../src/outbox.js';
import { memDrive, localStub, syntheticPackage } from './helpers.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('test-cloud-emulator: דילוג – אין אמולטור Firestore (לא נבדק)'); process.exit(0); }
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-exam', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(c => c.firestore().doc('admins/ADMIN').set({ note: 'manual' }));

function fsFor(uid) {
  const app = initializeApp({ projectId: 'demo-exam', ['api' + 'Key']: 'demo' }, 'app-' + uid + Math.random());
  const db = F.getFirestore(app);
  F.connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: uid, firebase: { sign_in_provider: 'google.com' } } });
  return { fs: F, db };
}
function mk(uid, { isAdmin = false, wrap } = {}) {
  const f = fsFor(uid); const errors = [];
  const fsx = wrap ? wrap(F) : F;
  const store = createCloudStore({ drive: memDrive(), firestore: async () => ({ fs: fsx, db: f.db }), uid, isAdmin, local: localStub(), outbox: createMemStore(), mediaCache: (() => { const m = new Map(); return { get: async k => m.get(k), put: async (k, v) => { m.set(k, v); }, m }; })(), onSyncError: e => errors.push(e) });
  store.errors = errors; return store;
}
const rejectsCode = async (p, code) => { try { await p; } catch (e) { assert.ok(!code || e.code === code || String(e.message).includes(code), 'קוד שגיאה צפוי ' + code + ' קיבלנו ' + e.code + ' / ' + e.message); return; } assert.fail('היה אמור להיכשל'); };
async function rawTeacherEarly(cols) { const { fs: tf, db: tdb } = fsFor('teacherA'); const out = []; for (const c of cols) { try { for (const d of (await tf.getDocs(tf.collection(tdb, c))).docs) out.push(JSON.stringify(d.data()) + d.id); } catch (e) { out.push('DENIED:' + c); } } return out; }
let n = 0; const t = (ok, msg) => { assert.ok(ok, msg); n++; };

const ADMIN = mk('ADMIN', { isAdmin: true }), A = mk('teacherA'), B = mk('teacherB');
const FORGED = mk('teacherA', { isAdmin: true }); // מורה שמזייף דגל מנהל – הכללים חייבים לחסום

// 1. מנהל מייבא חבילה סינתטית: 130 שאלות (כמה חבילות), טבלה מקוננת, איור 1.6MB (3 חלקים)
const pkg = syntheticPackage(130, { imageBytes: 1_600_000 });
const res = await ADMIN.importPackage(pkg, { publish: true });
t(res.added === 130 && res.casesAdded === 1 && res.mediaAdded === 1, 'ייבוא: ' + JSON.stringify(res));
const bankA = await A.loadBank();
t(bankA.central && bankA.questions.length === 130 && bankA.cases.length === 1, 'מורה א׳ טוען 130 שאלות מהענן');
t(bankA.packages[0].id === 'synthetic-pkg', 'חבילה ב-meta');
const q1 = bankA.questions.find(q => q.uid === 'synthetic-pkg:q1');
t(JSON.stringify(q1.blocks[1].rows) === JSON.stringify([[['תא א', 'שורה 2'], 'תא ב'], [null, 'תא ד']]), 'טבלה מקוננת שרדה (כולל null ומערך בתא)');
t(q1.rubric.answer[0].text === 'תשובה 1', 'מחוון שרד');
const { fs: ffs, db: adb } = fsFor('ADMIN');
const chunkDocs = (await ffs.getDocs(ffs.collection(adb, 'bank'))).docs.map(d => d.id).sort();
t(chunkDocs.filter(i => i.startsWith('q-')).length >= 3, 'השאלות נארזו בכמה חבילות: ' + chunkDocs.join(','));
const img = await A.getMedia('synthetic-pkg/q1.png');
t(img && img.length === 1_600_000 && img[1000] === pkg.media.get('synthetic-pkg/q1.png')[1000] && img[1_599_999] === pkg.media.get('synthetic-pkg/q1.png')[1_599_999], 'איור רב-חלקים שוחזר בייט-בייט');
t((await A.getMedia('synthetic-pkg/q1.png')).length === 1_600_000, 'קריאה חוזרת (מהמטמון)');
t((await A.loadTaxonomy()).domains.cardiology === undefined, 'מילון מרכזי ריק עד שמנהל שומר');
await ADMIN.saveTaxonomy({ domains: { cardiology: 'קרדיולוגיה' }, types: { open: 'פתוחה' } });
t((await B.loadBank()) && (await B.loadTaxonomy()).domains.cardiology === 'קרדיולוגיה', 'מילון מרכזי נקרא ע״י מורה ב׳');

// ייבוא חוזר: זהה מדולג, שונה מסומן ולא נדרס
const again = await ADMIN.importPackage({ ...pkg, questions: pkg.questions.map((q, i) => i === 0 ? { ...q, blocks: [{ type: 'text', text: 'שונה' }] } : q) }, { publish: true });
t(again.added === 0 && again.skipped === 129 && again.conflicts === 1, 'ייבוא חוזר: ' + JSON.stringify(again));
const q1b = (await ADMIN.loadBank()).questions.find(q => q.uid === 'synthetic-pkg:q1');
t(q1b.reviewFlag === true && q1b.conflictNote && q1b.blocks[0].text === 'שאלה סינתטית מספר 1', 'שאלה שונה סומנה לבדיקה ולא נדרסה (המנהל רואה את הסימון)');
{ const q1t = (await A.loadBank()).questions.find(q => q.uid === 'synthetic-pkg:q1');
  t(q1t && q1t.reviewFlag === undefined && q1t.conflictNote === undefined && q1t.blocks[0].text === 'שאלה סינתטית מספר 1', 'מורה מקבל את השאלה בלי שדות ניהול');
  const raw = (await rawTeacherEarly(['bank', 'bankPrivate'])).join('|');
  t(!raw.includes('reviewFlag') && !raw.includes('conflictNote') && !raw.includes('הגיעה גרסה שונה'), 'קריאה ישירה: אין שדות ניהול בעותק הציבורי');
  t(raw.includes('DENIED:bankPrivate'), 'bankPrivate חסום למורה'); }
{ // פרטי מחבר/מגיש הם שדות ניהול: מנהל רואה, מורה לא (גם בקריאה ישירה)
  await ADMIN.saveBankQuestion({ ...q1b, authorAdmin: 'AUTHOR_MARK_X', author: 'PKGAUTHOR_MARK', submitterUid: 'uid-mark-9', submitterName: 'SUBMITTER_MARK' });
  const qa = (await ADMIN.loadBank()).questions.find(q => q.uid === 'synthetic-pkg:q1');
  t(qa.authorAdmin === 'AUTHOR_MARK_X' && qa.author === 'PKGAUTHOR_MARK' && qa.submitterUid === 'uid-mark-9' && qa.submitterName === 'SUBMITTER_MARK' && qa.reviewFlag === true, 'מנהל רואה מחבר ומגיש (ושדה הסימון נשמר)');
  const qt = (await A.loadBank()).questions.find(q => q.uid === 'synthetic-pkg:q1');
  t(qt.authorAdmin === undefined && qt.author === undefined && qt.submitterUid === undefined && qt.submitterName === undefined, 'מורה לא מקבל מחבר/מגיש');
  const raw2 = (await rawTeacherEarly(['bank', 'bankPrivate', 'suggestions'])).join('|');
  t(!/_MARK/.test(raw2) && !raw2.includes('uid-mark-9'), 'קריאה ישירה של מורה: אין פרטי מחבר/מגיש');
}

// 2. מורה לא יכול לכתוב למאגר (גם כשהוא מזייף דגל מנהל בלקוח)
await rejectsCode(A.saveBankQuestion({ ...q1, title: 'האקר' }), 'not-admin');
await rejectsCode(FORGED.saveBankQuestion({ ...q1, title: 'האקר' }), 'permission-denied');
await rejectsCode(FORGED.deleteBankQuestion('synthetic-pkg:q2'), 'permission-denied');
await rejectsCode(FORGED.importPackage(syntheticPackage(1, { pkgId: 'evil' }), { publish: true }), 'permission-denied');
await rejectsCode(FORGED.putMedia('central/evil/x.png', new Uint8Array([1, 2, 3])), 'permission-denied');
await rejectsCode(FORGED.saveTaxonomy({ domains: { evil: 'x' }, types: {} }), 'permission-denied');
const after = await B.loadBank();
t(after.questions.length === 130 && !after.questions.some(q => q.title === 'האקר') && after.packages.length === 1, 'המאגר לא שונה ע״י מורה');

// 3. הצעות: מורה א׳ שולח עם תמונה; ב׳ לא רואה; מנהל רואה; לא הופך לשאלה ציבורית
const mine = { uid: 'personal-1', kind: 'personal', domainId: 'cardiology', typeId: 'open', title: 'שאלה אישית', blocks: [{ type: 'text', text: 'מה תפקיד הלב?' }, { type: 'table', rows: [['א', ['ב', 'ג']]] }, { type: 'image', mediaKey: 'user/img1' }], rubric: null, searchText: 'x' };
const photo = Uint8Array.from({ length: 1_000_000 }, (_, i) => (i * 13 + 1) & 255);
const sent = await A.submitSuggestion(mine, { credit: true, authorName: 'מורה א', getMedia: k => (k === 'user/img1' ? photo : null) });
t(sent.status === 'pending' && sent.authorName === 'מורה א', 'הצעה נשלחה pending');
t((await A.loadSuggestions()).length === 1, 'מורה א׳ רואה את שלו');
t((await B.loadSuggestions()).length === 0, 'מורה ב׳ לא רואה הצעות של א׳');
const adminSugs = await ADMIN.loadSuggestions();
t(adminSugs.length === 1 && adminSugs[0].question.blocks[1].rows[0][1][1] === 'ג', 'מנהל רואה את ההצעה (טבלה מקוננת שרדה)');
const smedia = await ADMIN.getSuggestionMedia(adminSugs[0]);
t(smedia.get('user/img1')?.length === 1_000_000 && smedia.get('user/img1')[777777] === photo[777777], 'מנהל מקבל את תמונת ההצעה');
t(!(await B.loadBank()).questions.some(q => q.uid === 'personal-1') && !(await A.loadBank()).questions.some(q => q.uid === 'personal-1'), 'הצעה ממתינה אינה בשאלות הציבוריות');
await rejectsCode(A.submitSuggestion(mine, { getMedia: k => photo }), 'permission-denied');          // שליחה חוזרת = דריסה, אסור
await rejectsCode(FORGED.saveSuggestion({ ...adminSugs[0], status: 'approved' }), 'permission-denied'); // מורה לא מאשר לעצמו
await rejectsCode(B.getSuggestionMedia(adminSugs[0]), 'not-admin');
t((await ADMIN.loadSuggestions())[0].status === 'pending', 'ההצעה נשארה pending אחרי ניסיונות עקיפה');

// 4. אישור ע״י מנהל (אותו תהליך כמו admin.approve): מדיה מרכזית + שאלה עצמאית + סטטוס
const sug = adminSugs[0]; const nid = 'approved-' + sug.id; const approvedQ = JSON.parse(JSON.stringify(sug.question));
await ADMIN.putMedia(`central/${nid}/img1`, smedia.get('user/img1'));
approvedQ.blocks[2].mediaKey = `central/${nid}/img1`;
await ADMIN.saveBankQuestion({ ...approvedQ, uid: nid, pkgId: 'approved', kind: 'teacher', published: true, credit: 'מורה א', fromSuggestion: sug.id });
await ADMIN.saveSuggestion({ ...sug, status: 'approved', draftUid: nid });
const finalBank = await B.loadBank();
t(finalBank.questions.some(q => q.uid === nid && q.published === true), 'אחרי אישור: השאלה במאגר המרכזי');
t(finalBank.questions.find(q => q.uid === nid).fromSuggestion === undefined && (await ADMIN.loadBank()).questions.find(q => q.uid === nid).fromSuggestion === sug.id, 'fromSuggestion נשמר למנהל בלבד');
t((await B.getMedia(`central/${nid}/img1`)).length === 1_000_000, 'תמונת השאלה המאושרת נגישה למורה ב׳');
t((await A.loadSuggestions())[0].status === 'approved', 'מורה א׳ רואה שההצעה אושרה');
t(finalBank.questions.find(q => q.uid === 'personal-1') === undefined, 'השאלה האישית המקורית לא נחשפה');

// 5. מנהל: עריכה, הסתרה, מחיקה, הסרת חבילה, שחזור, ויומן ביקורת
const edit = { ...finalBank.questions.find(q => q.uid === 'synthetic-pkg:q3'), published: false, adminEdited: true };
await ADMIN.saveBankQuestion(edit);
t(!(await A.loadBank()).questions.some(q => q.uid === 'synthetic-pkg:q3'), 'שאלה שהוסתרה אינה מגיעה למורה');
t((await ADMIN.loadBank()).questions.find(q => q.uid === 'synthetic-pkg:q3')?.published === false, 'המנהל עדיין רואה את השאלה המוסתרת');
await ADMIN.saveBankQuestion({ ...edit, published: true });
t((await A.loadBank()).questions.some(q => q.uid === 'synthetic-pkg:q3' && q.published !== false), 'פרסום מחדש: השאלה חוזרת למורה');
await ADMIN.saveBankQuestion(edit);
await ADMIN.deleteBankQuestion('synthetic-pkg:q4');

// 5ב. אבטחת תוכן מוסתר: מורה לא מקבל שאלות/מקרים/איורים לא מפורסמים, גם בפנייה ישירה ל-Firestore
const HIDDEN_MARK = 'סוד-שלא-לפרסם';
const hid = syntheticPackage(3, { pkgId: 'hid', imageBytes: 300_000 });
hid.questions[0].blocks[0].text = HIDDEN_MARK + ' שאלה 1'; hid.questions[1].blocks[0].text = HIDDEN_MARK + ' שאלה 2'; hid.cases[0].blocks[0].text = HIDDEN_MARK + ' מקרה';
const hres = await ADMIN.importPackage(hid, { publish: false });
t(hres.added === 3 && hres.casesAdded === 1 && hres.mediaAdded === 1, 'ייבוא כמוסתר: ' + JSON.stringify(hres));
const rawTeacher = async (uidv, cols) => { const { fs: tf, db: tdb } = fsFor(uidv); const out = []; for (const c of cols) { try { for (const d of (await tf.getDocs(tf.collection(tdb, c))).docs) out.push(JSON.stringify(d.data()) + d.id); } catch (e) { out.push('DENIED:' + c + ':' + e.code); } } return out; };
const leaks = async uidv => (await rawTeacher(uidv, ['bank', 'bankPrivate', 'suggestions', 'suggestionMedia'])).filter(s => !s.startsWith('DENIED') && (s.includes(HIDDEN_MARK) || s.includes('hid:q') || s.includes('hid:c1') || s.includes('hid/q1.png')));
t((await leaks('teacherA')).length === 0, 'קריאה ישירה של כל bank: אין שאלה/מקרה/מפתח איור מוסתר');
t((await rawTeacher('teacherA', ['bankPrivate']))[0].startsWith('DENIED:bankPrivate:permission-denied'), 'קריאת bankPrivate ע״י מורה נחסמת');
const hmId = (await hashKey('hid/q1.png')) + '-0';
{ const { fs: tf, db: tdb } = fsFor('teacherA');
  await rejectsCode(tf.getDoc(tf.doc(tdb, 'bankMedia', hmId)), 'permission-denied');
  await rejectsCode(tf.getDocs(tf.collection(tdb, 'bankMedia')), 'permission-denied');
  await rejectsCode(tf.getDocs(tf.query(tf.collection(tdb, 'bankMedia'), tf.where('pub', '==', false))), 'permission-denied');
  await rejectsCode(tf.updateDoc(tf.doc(tdb, 'bankMedia', hmId), { pub: true }), 'permission-denied'); }
const hbank = await mk('teacherA').loadBank();
t(!hbank.questions.some(q => q.pkgId === 'hid') && !hbank.cases.some(c => c.pkgId === 'hid'), 'מורה לא מקבל שאלות/מקרה מוסתרים');
t(await mk('teacherA').getMedia('hid/q1.png') === null, 'מורה לא מקבל איור של שאלה מוסתרת');
const hadm = await ADMIN.loadBank();
t(hadm.questions.filter(q => q.pkgId === 'hid').length === 3 && hadm.cases.some(c => c.pkgId === 'hid') && (await mk('ADMIN', { isAdmin: true }).getMedia('hid/q1.png')).length === 300_000, 'המנהל רואה ומקבל הכול (שאלות, מקרה, איור)');
// פרסום שאלה 2 (משתמשת בסיפור המקרה) -> מופיעה עם המקרה; שאלה 1 (עם האיור) עדיין מוסתרת -> האיור פרטי
const h2 = hadm.questions.find(q => q.uid === 'hid:q2'), h1 = hadm.questions.find(q => q.uid === 'hid:q1');
await ADMIN.saveBankQuestion({ ...h2, published: true });
const b2 = await mk('teacherA').loadBank();
t(b2.questions.some(q => q.uid === 'hid:q2') && !b2.questions.some(q => q.uid === 'hid:q1' || q.uid === 'hid:q3') && b2.cases.some(c => c.uid === 'hid:c1'), 'פרסום שאלה בודדת: רק היא והמקרה שלה נחשפים');
t(await mk('teacherA').getMedia('hid/q1.png') === null, 'האיור נשאר פרטי כל עוד שאלה 1 מוסתרת');
await ADMIN.saveBankQuestion({ ...h1, published: true });
t((await mk('teacherA').getMedia('hid/q1.png'))?.length === 300_000, 'פרסום שאלה 1: האיור נגיש למורה');
await ADMIN.saveBankQuestion({ ...h1, published: false });
t(await mk('teacherA').getMedia('hid/q1.png') === null && !(await mk('teacherA').loadBank()).questions.some(q => q.uid === 'hid:q1'), 'הסתרה חוזרת: שאלה ואיור נעלמים מהמורה');
{ const { fs: tf, db: tdb } = fsFor('teacherB'); await rejectsCode(tf.getDoc(tf.doc(tdb, 'bankMedia', hmId)), 'permission-denied'); }
t((await leaks('teacherB')).filter(s => s.includes('hid:q1') || s.includes('hid:q3') || s.includes('hid/q1.png')).length === 0, 'אחרי הסתרה חוזרת: אין זליגה למורה ב׳');
await ADMIN.removePackage('hid');
t(!(await mk('ADMIN', { isAdmin: true }).loadBank()).questions.some(q => q.pkgId === 'hid'), 'הסרת חבילה מוסתרת מנקה גם את bankPrivate');
// ייבוא מוסתר לא משנה את מה שמורה כבר רואה
t((await A.loadBank()).questions.filter(q => q.pkgId === 'synthetic-pkg').length >= 127, 'מורה ממשיך לראות את המאגר המפורסם');
// מורה מזייף דגל מנהל וכותב לשטח הפרטי
await rejectsCode(FORGED.saveBankQuestion({ uid: 'evil-hidden', published: false, blocks: [] }), 'permission-denied');
await ADMIN.deleteBankQuestion('synthetic-pkg:q4');
t(!(await A.loadBank()).questions.some(q => q.uid === 'synthetic-pkg:q4'), 'מחיקה');
const audit = (await ffs.getDocs(ffs.collection(adb, 'audit'))).docs.map(d => d.data());
t(['import-package', 'save-question', 'delete-question', 'save-taxonomy', 'suggestion-approved'].every(a => audit.some(x => x.action === a && x.by === 'ADMIN')), 'יומן ביקורת: ' + [...new Set(audit.map(x => x.action))].join(','));
await rejectsCode((async () => { const { fs: a, db: ad } = fsFor('teacherA'); return a.getDocs(a.collection(ad, 'audit')); })(), 'permission-denied');
const snapshot = await ADMIN.loadBank();
await ADMIN.removePackage('synthetic-pkg');
const pk = await A.loadBank();
t(!pk.questions.some(q => q.pkgId === 'synthetic-pkg') && pk.questions.some(q => q.uid === nid), 'הסרת חבילה משאירה שאלה מאושרת');
t(await A.getMedia('synthetic-pkg/q1.png') === null, 'איור החבילה הוסר');
const mediaLeft = (await ffs.getDocs(ffs.collection(adb, 'bankMedia'))).docs.filter(d => d.data().key.startsWith('synthetic-pkg/')).length;
t(mediaLeft === 0, 'אין שאריות איור ב-Firestore');
await ADMIN.replaceCentral({ packages: snapshot.packages, questions: snapshot.questions, cases: snapshot.cases, media: new Map([['synthetic-pkg/q1.png', pkg.media.get('synthetic-pkg/q1.png')]]), taxonomy: { domains: { cardiology: 'קרדיולוגיה' }, types: {} } });
const restored = await ADMIN.loadBank();
t(restored.questions.length === snapshot.questions.length && (await mk('teacherB').getMedia('synthetic-pkg/q1.png')).length === 1_600_000, 'שחזור הוחזר במלואו (כולל שאלה מוסתרת אצל המנהל)');
t(restored.questions.find(q => q.uid === 'synthetic-pkg:q1')?.reviewFlag === true && (await B.loadBank()).questions.find(q => q.uid === 'synthetic-pkg:q1').reviewFlag === undefined, 'שחזור שומר שדות ניהול למנהל בלבד');
t(!(await B.loadBank()).questions.some(q => q.uid === 'synthetic-pkg:q3') && restored.questions.some(q => q.uid === 'synthetic-pkg:q3' && q.published === false), 'שחזור שומר הסתרה: מורה לא רואה, מנהל רואה');
await rejectsCode(FORGED.replaceCentral({ packages: [], questions: [], cases: [], media: new Map() }), 'permission-denied');
t((await ADMIN.loadBank()).questions.length === snapshot.questions.length, 'ניסיון replace ע״י מורה לא מחק דבר');

// 6. תקלות רשת/הרשאה בקריאה: חוזרים למאגר המקומי ומדווחים (לא מוסתר)
const flaky = mk('teacherA', { wrap: real => ({ ...real, getDocs: async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); } }) });
const fb = await flaky.loadBank();
t(fb.questions[0].uid === 'local-q' && /אינו זמין/.test(fb.warning), 'רשת נפלה: מאגר מקומי + אזהרה גלויה');
t((await flaky.loadSuggestions()).length === 0 && flaky.errors.some(e => e.where === 'suggestions'), 'רשת נפלה: הצעות ריקות + שגיאה מדווחת');

await env.cleanup();
console.log(`test-cloud-emulator: OK (${n} בדיקות מול אמולטור Firestore עם הכללים האמיתיים)`);
process.exit(0);
