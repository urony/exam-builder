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
const q1b = (await A.loadBank()).questions.find(q => q.uid === 'synthetic-pkg:q1');
t(q1b.reviewFlag === true && q1b.blocks[0].text === 'שאלה סינתטית מספר 1', 'שאלה שונה סומנה לבדיקה ולא נדרסה');

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
t((await B.getMedia(`central/${nid}/img1`)).length === 1_000_000, 'תמונת השאלה המאושרת נגישה למורה ב׳');
t((await A.loadSuggestions())[0].status === 'approved', 'מורה א׳ רואה שההצעה אושרה');
t(finalBank.questions.find(q => q.uid === 'personal-1') === undefined, 'השאלה האישית המקורית לא נחשפה');

// 5. מנהל: עריכה, הסתרה, מחיקה, הסרת חבילה, שחזור, ויומן ביקורת
const edit = { ...finalBank.questions.find(q => q.uid === 'synthetic-pkg:q3'), published: false, adminEdited: true };
await ADMIN.saveBankQuestion(edit);
t((await A.loadBank()).questions.find(q => q.uid === 'synthetic-pkg:q3').published === false, 'הסתרה נשמרה');
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
const restored = await B.loadBank();
t(restored.questions.length === snapshot.questions.length && (await B.getMedia('synthetic-pkg/q1.png')).length === 1_600_000, 'שחזור הוחזר במלואו');
await rejectsCode(FORGED.replaceCentral({ packages: [], questions: [], cases: [], media: new Map() }), 'permission-denied');
t((await B.loadBank()).questions.length === snapshot.questions.length, 'ניסיון replace ע״י מורה לא מחק דבר');

// 6. תקלות רשת/הרשאה בקריאה: חוזרים למאגר המקומי ומדווחים (לא מוסתר)
const flaky = mk('teacherA', { wrap: real => ({ ...real, getDocs: async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); } }) });
const fb = await flaky.loadBank();
t(fb.questions[0].uid === 'local-q' && /אינו זמין/.test(fb.warning), 'רשת נפלה: מאגר מקומי + אזהרה גלויה');
t((await flaky.loadSuggestions()).length === 0 && flaky.errors.some(e => e.where === 'suggestions'), 'רשת נפלה: הצעות ריקות + שגיאה מדווחת');

await env.cleanup();
console.log(`test-cloud-emulator: OK (${n} בדיקות מול אמולטור Firestore עם הכללים האמיתיים)`);
process.exit(0);
