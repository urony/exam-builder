// בדיקות כללי Firestore באמולטור אמיתי: מורה א׳, מורה ב׳, מנהל, משתמש לא מחובר, ספק התחברות לא תקין.
// הרצה: firebase emulators:exec --only firestore --project demo-exam "node scripts/test-rules.mjs"
// בלי אמולטור (FIRESTORE_EMULATOR_HOST חסר) הבדיקה מדלגת ומדווחת זאת במפורש.
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('test-rules: דילוג – אין אמולטור Firestore (לא נבדק)'); process.exit(0); }
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-exam', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } });
const NON_GOOGLE = 'email-' + 'provider'; // ספק שאינו Google
const G = { firebase: { sign_in_provider: 'google.com' } };
const ctxOf = (uid, extra = {}) => env.authenticatedContext(uid, { ...G, ...extra }).firestore();
const A = ctxOf('teacherA'), B = ctxOf('teacherB'), ADM = ctxOf('adminX');
const ANON = env.unauthenticatedContext().firestore();
const PWD = env.authenticatedContext('teacherA', { firebase: { sign_in_provider: NON_GOOGLE } }).firestore();
const FAKECLAIM = ctxOf('teacherA', { admin: true, isAdmin: true });
const bytes = n => firebase.firestore.Blob.fromUint8Array(new Uint8Array(n));

await env.clearFirestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await db.doc('admins/adminX').set({ note: 'created manually in console' });
  await db.doc('audit/seeded').set({ by: 'adminX', action: 'seed', at: 1 });
  await db.doc('bank/meta').set({ kind: 'meta' });
  await db.doc('bank/q-000').set({ kind: 'questions', items: [] });
  await db.doc('bankMedia/m1').set({ key: 'k', data: bytes(10) });
  await db.doc('suggestions/sg-existing').set({ id: 'sg-existing', status: 'pending', authorUid: 'teacherA', credit: false, authorName: '', submittedAt: 1, questionJson: '{"uid":"p"}' });
  await db.doc('suggestions/sg-b').set({ id: 'sg-b', status: 'pending', authorUid: 'teacherB', credit: false, authorName: '', submittedAt: 1, questionJson: '{"uid":"p"}' });
  await db.doc('suggestionMedia/sm-b').set({ sgId: 'sg-b', authorUid: 'teacherB', key: 'user/x', part: 0, parts: 1, data: bytes(5) });
});

let n = 0;
const ok = async (name, p) => { await assertSucceeds(p); n++; };
const no = async (name, p) => { await assertFails(p); n++; };
const sg = (id, over = {}) => ({ id, status: 'pending', authorUid: 'teacherA', credit: false, authorName: '', submittedAt: 5, questionJson: '{"uid":"p"}', ...over });

// --- מורה א׳: מאגר מרכזי ---
await ok('A reads bank', A.doc('bank/meta').get());
await ok('A reads bank list', A.collection('bank').get());
await ok('A reads bankMedia', A.doc('bankMedia/m1').get());
await no('A writes bank', A.doc('bank/q-000').set({ kind: 'questions', items: [{ uid: 'evil' }] }));
await no('A creates bank doc', A.doc('bank/new').set({ x: 1 }));
await no('A deletes bank', A.doc('bank/q-000').delete());
await no('A writes bankMedia', A.doc('bankMedia/m2').set({ key: 'k', data: bytes(3) }));
await no('A writes audit', A.collection('audit').add({ by: 'teacherA', action: 'x' }));
await no('A reads audit', A.collection('audit').get());

// --- הרשאת מנהל: אי אפשר להעניק לעצמך ---
await no('A self-grants admin', A.doc('admins/teacherA').set({ x: 1 }));
await no('A grants B admin', A.doc('admins/teacherB').set({ x: 1 }));
await no('A reads others admin doc', A.doc('admins/adminX').get());
await no('A lists admins', A.collection('admins').get());
await ok('A reads own admin doc (not admin)', A.doc('admins/teacherA').get());
await no('A with fake admin claim writes bank', FAKECLAIM.doc('bank/q-000').set({ x: 1 }));
await no('admin cannot edit admins doc via client', ADM.doc('admins/other').set({ x: 1 }));

// --- הצעות ---
await ok('A creates own suggestion', A.doc('suggestions/sg-new').set(sg('sg-new')));
await ok('A creates suggestion with credit', A.doc('suggestions/sg-new2').set(sg('sg-new2', { credit: true, authorName: 'מורה', imageKeys: ['user/x'] })));
await no('A suggestion in B name', A.doc('suggestions/sg-x1').set(sg('sg-x1', { authorUid: 'teacherB' })));
await no('A suggestion pre-approved', A.doc('suggestions/sg-x2').set(sg('sg-x2', { status: 'approved' })));
await no('A suggestion extra field', A.doc('suggestions/sg-x3').set(sg('sg-x3', { published: true })));
await no('A suggestion id mismatch', A.doc('suggestions/sg-x4').set(sg('sg-other')));
await no('A suggestion long name', A.doc('suggestions/sg-x5').set(sg('sg-x5', { authorName: 'x'.repeat(101) })));
await no('A suggestion missing question', A.doc('suggestions/sg-x6').set({ id: 'sg-x6', status: 'pending', authorUid: 'teacherA', credit: false, authorName: '', submittedAt: 1 }));
await no('A overwrites own existing suggestion', A.doc('suggestions/sg-existing').set(sg('sg-existing')));
await no('A approves own suggestion', A.doc('suggestions/sg-existing').update({ status: 'approved' }));
await no('A deletes own suggestion', A.doc('suggestions/sg-existing').delete());
await ok('A reads own suggestion', A.doc('suggestions/sg-existing').get());
await ok('A lists own suggestions', A.collection('suggestions').where('authorUid', '==', 'teacherA').get());
await no('A reads B suggestion', A.doc('suggestions/sg-b').get());
await no('A lists B suggestions', A.collection('suggestions').where('authorUid', '==', 'teacherB').get());
await no('A lists all suggestions', A.collection('suggestions').get());
await no('A publishes suggestion into bank', A.doc('bank/q-001').set({ kind: 'questions', items: [{ uid: 'p' }] }));

// --- תמונות הצעה ---
const sm = (over = {}) => ({ sgId: 'sg-new', authorUid: 'teacherA', key: 'user/a', part: 0, parts: 1, data: bytes(100), ...over });
await ok('A uploads own suggestion media', A.doc('suggestionMedia/sm-a1').set(sm()));
await no('A media in B name', A.doc('suggestionMedia/sm-a2').set(sm({ authorUid: 'teacherB' })));
await no('A media too big', A.doc('suggestionMedia/sm-a3').set(sm({ data: bytes(900001) })));
await no('A media extra field', A.doc('suggestionMedia/sm-a4').set(sm({ extra: 1 })));
await no('A media not bytes', A.doc('suggestionMedia/sm-a5').set(sm({ data: 'text' })));
await no('A media parts absurd', A.doc('suggestionMedia/sm-a6').set(sm({ parts: 999 })));
await no('A media part not int', A.doc('suggestionMedia/sm-a7').set(sm({ part: 'x' })));
await no('A reads B media', A.doc('suggestionMedia/sm-b').get());
await ok('A reads own media', A.doc('suggestionMedia/sm-a1').get());
await no('A deletes own media', A.doc('suggestionMedia/sm-a1').delete());

// --- מורה ב׳ ---
await no('B reads A suggestion', B.doc('suggestions/sg-existing').get());
await no('B reads A media', B.doc('suggestionMedia/sm-a1').get());
await ok('B reads own', B.doc('suggestions/sg-b').get());
await no('B writes bank', B.doc('bank/meta').set({ kind: 'meta', hacked: true }));

// --- מנהל ---
await ok('admin writes bank', ADM.doc('bank/q-001').set({ kind: 'questions', items: [] }));
await ok('admin writes bankMedia', ADM.doc('bankMedia/m3').set({ key: 'k3', data: bytes(10) }));
await ok('admin deletes bank doc', ADM.doc('bank/q-001').delete());
await ok('admin lists all suggestions', ADM.collection('suggestions').get());
await ok('admin reads A suggestion', ADM.doc('suggestions/sg-existing').get());
await ok('admin reads A media', ADM.doc('suggestionMedia/sm-a1').get());
await ok('admin approves suggestion', ADM.doc('suggestions/sg-existing').update({ status: 'approved' }));
await ok('admin rejects suggestion', ADM.doc('suggestions/sg-b').update({ status: 'rejected' }));
await ok('admin writes audit', ADM.collection('audit').add({ by: 'adminX', action: 'save-question', at: 1 }));
await no('admin audit with forged identity', ADM.collection('audit').add({ by: 'someoneElse', action: 'x' }));
await no('admin edits existing audit entry', ADM.doc('audit/seeded').update({ action: 'tampered' }));
await no('admin overwrites existing audit entry', ADM.doc('audit/seeded').set({ by: 'adminX', action: 'tampered' }));
await no('admin deletes audit entry', ADM.doc('audit/seeded').delete());
await ok('admin reads audit', ADM.collection('audit').get());
await no('admin writes unknown collection', ADM.doc('internal/s1').set({ x: 1 }));

// --- לא מחובר / ספק לא תקין ---
await no('anon reads bank', ANON.doc('bank/meta').get());
await no('anon writes suggestion', ANON.doc('suggestions/sg-anon').set(sg('sg-anon')));
await no('non-google-provider reads bank', PWD.doc('bank/meta').get());
await no('non-google-provider creates suggestion', PWD.doc('suggestions/sg-pwd').set(sg('sg-pwd')));

await env.cleanup();
console.log(`test-rules: OK (${n} בדיקות באמולטור Firestore)`);
