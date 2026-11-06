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
// יצירה תקפה = אצווה אחת: חלקי תמונה + עדכון מונה מכסה + ההצעה (מכסות ופרטי מדיה נבדקים לעומק ב-test-quota-rules.mjs)
const quotaOf = async (c, u) => (await c.doc('suggestionQuota/' + u).get()).data() || { pending: 0, images: 0 };
async function submit(ctx, uid, id, { imageKeys, parts = [1], quota, sgOver = {}, mediaOver = {}, tag = 'abc123' } = {}) {
  const cur = await quotaOf(ctx, uid), keys = imageKeys || [], b = ctx.batch();
  keys.forEach((key, idx) => { for (let p = 0; p < parts[idx]; p++) b.set(ctx.doc('suggestionMedia/' + id + '-' + tag + '-' + idx + '-' + p), { sgId: id, authorUid: uid, key, idx, part: p, parts: parts[idx], tag, data: bytes(p < parts[idx] - 1 ? 700000 : 100), ...mediaOver }); });
  if (quota !== false) b.set(ctx.doc('suggestionQuota/' + uid), quota || { pending: cur.pending + 1, images: cur.images + keys.length, sg: id });
  b.set(ctx.doc('suggestions/' + id), sg(id, { authorUid: uid, mediaTag: tag, ...(keys.length ? { imageKeys: keys } : {}), ...sgOver }));
  return b.commit();
}
await ok('A creates own suggestion (with image)', submit(A, 'teacherA', 'sg-new', { imageKeys: ['user/a'] }));
await ok('A creates suggestion with credit', submit(A, 'teacherA', 'sg-new2', { sgOver: { credit: true, authorName: 'מורה' } }));
await no('A suggestion without quota update', submit(A, 'teacherA', 'sg-nq', { quota: false }));
await no('A suggestion in B name', submit(A, 'teacherA', 'sg-x1', { sgOver: { authorUid: 'teacherB' } }));
await no('A suggestion pre-approved', submit(A, 'teacherA', 'sg-x2', { sgOver: { status: 'approved' } }));
await no('A suggestion extra field', submit(A, 'teacherA', 'sg-x3', { sgOver: { published: true } }));
await no('A suggestion id mismatch', submit(A, 'teacherA', 'sg-x4', { sgOver: { id: 'sg-other' } }));
await no('A suggestion long name', submit(A, 'teacherA', 'sg-x5', { sgOver: { authorName: 'x'.repeat(101) } }));
await no('A suggestion missing question', (() => { const b = A.batch(); b.set(A.doc('suggestionQuota/teacherA'), { pending: 3, images: 1, sg: 'sg-x6' }); b.set(A.doc('suggestions/sg-x6'), { id: 'sg-x6', status: 'pending', authorUid: 'teacherA', credit: false, authorName: '', submittedAt: 1 }); return b.commit(); })());
await no('A overwrites own existing suggestion', submit(A, 'teacherA', 'sg-existing'));
await no('A approves own suggestion', A.doc('suggestions/sg-existing').update({ status: 'approved' }));
await no('A deletes own suggestion', A.doc('suggestions/sg-existing').delete());
await ok('A reads own suggestion', A.doc('suggestions/sg-existing').get());
await ok('A lists own suggestions', A.collection('suggestions').where('authorUid', '==', 'teacherA').get());
await no('A reads B suggestion', A.doc('suggestions/sg-b').get());
await no('A lists B suggestions', A.collection('suggestions').where('authorUid', '==', 'teacherB').get());
await no('A lists all suggestions', A.collection('suggestions').get());
await no('A publishes suggestion into bank', A.doc('bank/q-001').set({ kind: 'questions', items: [{ uid: 'p' }] }));
await no('A overwrites own media', A.doc('suggestionMedia/sg-new-abc123-0-0').set({ sgId: 'sg-new', authorUid: 'teacherA', key: 'user/a', idx: 0, part: 0, parts: 1, tag: 'abc123', data: bytes(5) }));

await no('A reads B media', A.doc('suggestionMedia/sm-b').get());
await ok('A reads own media', A.doc('suggestionMedia/sg-new-abc123-0-0').get());
await no('A deletes own media', A.doc('suggestionMedia/sg-new-abc123-0-0').delete());
await no('A updates own media', A.doc('suggestionMedia/sg-new-abc123-0-0').update({ data: bytes(3) }));
await no('A lists all suggestionMedia', A.collection('suggestionMedia').get());
await ok('A lists own suggestionMedia', A.collection('suggestionMedia').where('authorUid', '==', 'teacherA').get());

// --- מורה ב׳ ---
await no('B reads A suggestion', B.doc('suggestions/sg-existing').get());
await no('B reads A media', B.doc('suggestionMedia/sg-new-abc123-0-0').get());
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
await ok('admin reads A media', ADM.doc('suggestionMedia/sg-new-abc123-0-0').get());
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
