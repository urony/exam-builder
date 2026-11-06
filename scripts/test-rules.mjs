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
  await db.doc('bankMedia/m1').set({ key: 'k', pub: true, data: bytes(10) });
  await db.doc('bankMedia/m-hidden').set({ key: 'kh', pub: false, data: bytes(10) });
  await db.doc('bankMedia/m-legacy').set({ key: 'kl', data: bytes(10) });   // בלי דגל pub = פרטי
  await db.doc('bankPrivate/qh-000').set({ kind: 'questions', n: 1, json: '[{"uid":"hiddenq"}]' });
  await db.doc('bankPrivate/meta').set({ kind: 'meta', json: '{"media":[]}' });
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
// תוכן מוסתר: מורה לא יכול לקרוא בשום דרך (get / list / שאילתות / collectionGroup)
await no('A reads bankPrivate doc', A.doc('bankPrivate/qh-000').get());
await no('A reads bankPrivate meta', A.doc('bankPrivate/meta').get());
await no('A lists bankPrivate', A.collection('bankPrivate').get());
await no('A queries bankPrivate with filter', A.collection('bankPrivate').where('kind', '==', 'questions').get());
await no('A collectionGroup bankPrivate', A.collectionGroup('bankPrivate').get());
await no('A writes bankPrivate', A.doc('bankPrivate/qh-001').set({ kind: 'questions', json: '[]' }));
await no('A overwrites bankPrivate', A.doc('bankPrivate/qh-000').set({ kind: 'questions', json: '[]' }));
await no('A deletes bankPrivate', A.doc('bankPrivate/qh-000').delete());
await no('A reads hidden media', A.doc('bankMedia/m-hidden').get());
await no('A reads media without pub flag', A.doc('bankMedia/m-legacy').get());
await no('A lists all bankMedia (includes hidden)', A.collection('bankMedia').get());
await no('A lists bankMedia pub==false', A.collection('bankMedia').where('pub', '==', false).get());
await ok('A lists bankMedia pub==true only', A.collection('bankMedia').where('pub', '==', true).get());
await no('A flips hidden media to pub', A.doc('bankMedia/m-hidden').update({ pub: true }));
await no('A forges FAKECLAIM bankPrivate', FAKECLAIM.doc('bankPrivate/qh-000').get());
await no('anon reads bankPrivate', ANON.doc('bankPrivate/qh-000').get());
await no('anon reads public media', ANON.doc('bankMedia/m1').get());
// שדות ניהול מפוצלים (bankPrivate/adm-q-NNN) ופורמט ישן (bankPrivate/adm): מנהל בלבד
for (const id of ['adm-q-000', 'adm']) {
  await no('A reads ' + id, A.doc('bankPrivate/' + id).get());
  await no('A writes ' + id, A.doc('bankPrivate/' + id).set({ kind: 'adm', json: '{}' }));
  await no('A deletes ' + id, A.doc('bankPrivate/' + id).delete());
  await no('FAKECLAIM writes ' + id, FAKECLAIM.doc('bankPrivate/' + id).set({ kind: 'adm', json: '{}' }));
  await no('anon reads ' + id, ANON.doc('bankPrivate/' + id).get());
  await no('PWD-provider reads ' + id, PWD.doc('bankPrivate/' + id).get());
  await ok('admin writes ' + id, ADM.doc('bankPrivate/' + id).set({ kind: 'adm', json: '{}' }));
  await ok('admin reads ' + id, ADM.doc('bankPrivate/' + id).get());
}
await no('A lists bankPrivate', A.collection('bankPrivate').get());
await no('A lists bank sourceHistory query', A.collection('bankPrivate').where('kind', '==', 'adm').get());
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
// מזהה מסמך תקין: {sgId}-{tag}-{hash}-{part}
const sm = (over = {}) => ({ sgId: 'sg-new', authorUid: 'teacherA', key: 'user/a', part: 0, parts: 1, tag: 'abc123', data: bytes(100), ...over });
let smN = 100;   // מזהה ייחודי לכל ניסיון, כדי שכישלון יגיע מהכלל הנבדק ולא מכך שהמסמך כבר קיים
const smId = (d = {}) => `${d.sgId || 'sg-new'}-${d.tag || 'abc123'}-h${++smN}-${d.part ?? 0}`;
const put = (d, id) => A.doc('suggestionMedia/' + (id || smId(d))).set(d);
await ok('A uploads own suggestion media', put(sm(), 'sg-new-abc123-h1-0'));
await ok('A uploads part 1 of 3', put(sm({ part: 1, parts: 3, key: 'user/b' })));
await no('A media in B name', put(sm({ authorUid: 'teacherB' })));
await no('A media too big', put(sm({ data: bytes(900001), key: 'user/c' })));
await no('A media extra field', put(sm({ extra: 1, key: 'user/d' })));
await no('A media not bytes', put(sm({ data: 'text', key: 'user/e' })));
await no('A media parts absurd', put(sm({ parts: 999, key: 'user/f' })));
await no('A media parts 21', put(sm({ parts: 21, key: 'user/f2' })));
await ok('A media parts 20, last part 19', put(sm({ parts: 20, part: 19, key: 'user/f3' })));
await no('A media parts zero', put(sm({ parts: 0, part: 0, key: 'user/g' })));
await no('A media parts negative', put(sm({ parts: -1, part: 0, key: 'user/g2' })));
await no('A media part == parts', put(sm({ part: 1, parts: 1, key: 'user/h' })));
await no('A media part > parts', put(sm({ part: 5, parts: 2, key: 'user/h2' })));
await no('A media part negative', put(sm({ part: -1, key: 'user/h3' })));
await no('A media part not int', put(sm({ part: 'x', key: 'user/i' })));
await no('A media part float', put(sm({ part: 0.5, parts: 2, key: 'user/i2' }), 'sg-new-abc123-h1-0.5'));
await no('A media parts float', put(sm({ parts: 1.5, key: 'user/i3' })));
await no('A media missing tag', (() => { const d = sm({ key: 'user/j' }); delete d.tag; return put(d, 'sg-new-x-h1-0'); })());
await no('A media tag not string', put(sm({ tag: 7, key: 'user/j2' }), 'sg-new-7-h1-0'));
await no('A media tag with slash/regex chars', put(sm({ tag: 'a.*', key: 'user/j3' }), 'sg-new-a.*-h1-0'));
await no('A media empty key', put(sm({ key: '' })));
await no('A media key too long', put(sm({ key: 'k'.repeat(301) })));
await no('A media sgId not sg- prefixed', put(sm({ sgId: 'other-1', key: 'user/k' })));
await no('A media sgId not string', put(sm({ sgId: 5, key: 'user/k2' }), 'x-abc123-h1-0'));
await no('A media doc id not linked to sgId', put(sm({ key: 'user/l' }), 'sm-random'));
await no('A media doc id wrong tag', put(sm({ key: 'user/l2' }), 'sg-new-zzz999-h1-0'));
await no('A media doc id wrong part', put(sm({ key: 'user/l3' }), 'sg-new-abc123-h1-7'));
await no('A media doc id of another suggestion', put(sm({ key: 'user/l4' }), 'sg-b-abc123-h1-0'));
await no('A overwrites own media', put(sm({ key: 'user/m' }), 'sg-new-abc123-h1-0'));
await no('A media in bank namespace', A.doc('bankMedia/sg-new-abc123-h1-0').set(sm()));
await no('A reads B media', A.doc('suggestionMedia/sm-b').get());
await ok('A reads own media', A.doc('suggestionMedia/sg-new-abc123-h1-0').get());
await no('A deletes own media', A.doc('suggestionMedia/sg-new-abc123-h1-0').delete());
await no('A updates own media', A.doc('suggestionMedia/sg-new-abc123-h1-0').update({ data: bytes(3) }));
await no('A lists all suggestionMedia', A.collection('suggestionMedia').get());
await ok('A lists own suggestionMedia', A.collection('suggestionMedia').where('authorUid', '==', 'teacherA').get());

// --- מורה ב׳ ---
await no('B reads A suggestion', B.doc('suggestions/sg-existing').get());
await no('B reads A media', B.doc('suggestionMedia/sg-new-abc123-h1-0').get());
await no('B reads hidden bank content', B.doc('bankPrivate/qh-000').get());
await no('B reads hidden media', B.doc('bankMedia/m-hidden').get());
await ok('B reads own', B.doc('suggestions/sg-b').get());
await no('B writes bank', B.doc('bank/meta').set({ kind: 'meta', hacked: true }));

// --- מנהל ---
await ok('admin writes bank', ADM.doc('bank/q-001').set({ kind: 'questions', items: [] }));
await ok('admin writes bankMedia', ADM.doc('bankMedia/m3').set({ key: 'k3', data: bytes(10) }));
await ok('admin deletes bank doc', ADM.doc('bank/q-001').delete());
await ok('admin lists all suggestions', ADM.collection('suggestions').get());
await ok('admin reads A suggestion', ADM.doc('suggestions/sg-existing').get());
await ok('admin reads A media', ADM.doc('suggestionMedia/sg-new-abc123-h1-0').get());
await ok('admin reads bankPrivate', ADM.doc('bankPrivate/qh-000').get());
await ok('admin lists bankPrivate', ADM.collection('bankPrivate').get());
await ok('admin writes bankPrivate', ADM.doc('bankPrivate/qh-001').set({ kind: 'questions', json: '[]' }));
await ok('admin reads hidden media', ADM.doc('bankMedia/m-hidden').get());
await ok('admin publishes media (pub flag)', ADM.doc('bankMedia/m-hidden').update({ pub: true }));
await ok('A now reads published media', A.doc('bankMedia/m-hidden').get());
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
