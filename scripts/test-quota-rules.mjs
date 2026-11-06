// בדיקות אכיפת מכסות ההגשה בכללי Firestore (אמולטור אמיתי, נתונים סינתטיים).
// מוכיח שהמכסות נאכפות בשרת ולא רק בדפדפן: עקיפה בקריאה ישירה, הגשות מקבילות, זיוף מונה, תמונות גדולות, ומנהל פטור.
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('test-quota-rules: דילוג – אין אמולטור Firestore (לא נבדק)'); process.exit(0); }
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-exam', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } });
const G = { firebase: { sign_in_provider: 'google.com' } };
const ctx = uid => env.authenticatedContext(uid, G).firestore();
const bytes = n => firebase.firestore.Blob.fromUint8Array(new Uint8Array(n));
let n = 0; const where = () => (new Error().stack.split(String.fromCharCode(10))[3] || '').trim();
const ok = async p => { try { await assertSucceeds(p); } catch (e) { console.log('FAIL ok #' + (n + 1) + ' ' + where() + ' ' + String(e.message).slice(0, 900)); throw e; } n++; };
const no = async p => { try { await assertFails(p); } catch (e) { console.log('FAIL no #' + (n + 1) + ' ' + where()); throw e; } n++; };

await env.clearFirestore();
await env.withSecurityRulesDisabled(c => c.firestore().doc('admins/ADM').set({ note: 'manual' }));
const ADM = ctx('ADM');

const sgDoc = (id, uid, over = {}) => ({ id, status: 'pending', authorUid: uid, credit: false, authorName: '', submittedAt: 5, questionJson: '{"uid":"p"}', mediaTag: 'tg1', ...over });
const quotaOf = async (c, u) => (await c.doc('suggestionQuota/' + u).get()).data() || { pending: 0, images: 0 };
// אצווה כמו הלקוח האמיתי. opts.sizes = גודל כל חלק; opts.quota = עקיפה של ערכי המונה
async function submit(c, uid, id, { keys = [], sizes, quota, noQuota, sg = {}, med = {}, tag = 'tg1', cur } = {}) {
  cur ||= await quotaOf(c, uid); const b = c.batch();
  keys.forEach((key, idx) => {
    const parts = (sizes?.[idx] || [100]);
    parts.forEach((sz, p) => b.set(c.doc(`suggestionMedia/${id}-${tag}-${idx}-${p}`), { sgId: id, authorUid: uid, key, idx, part: p, parts: parts.length, tag, data: bytes(sz), ...med }));
  });
  if (!noQuota) b.set(c.doc('suggestionQuota/' + uid), quota || { pending: (cur.pending || 0) + 1, images: (cur.images || 0) + keys.length, sg: id });
  b.set(c.doc('suggestions/' + id), sgDoc(id, uid, { ...(keys.length ? { imageKeys: keys } : {}), ...sg }));
  return b.commit();
}
const seedQuota = (uid, v) => env.withSecurityRulesDisabled(c => c.firestore().doc('suggestionQuota/' + uid).set({ ...v, sg: '' }));

// --- הגשה תקינה ---
const T1 = ctx('t1');
await ok(submit(T1, 't1', 'sg-a1'));
await ok(submit(T1, 't1', 'sg-a2', { keys: ['user/p1'], sizes: [[100]] }));
await ok(submit(T1, 't1', 'sg-a3', { keys: ['user/p2', 'user/p3', 'user/p4'] }));              // 3 תמונות בהצעה
await ok(submit(T1, 't1', 'sg-a4', { keys: ['user/q1'], sizes: [[700000, 700000, 697152]] })); // בדיוק 2MB (3 חלקים) – מותר
await ok(submit(T1, 't1', 'sg-a5', { keys: ['user/r1', 'user/r2', 'user/r3'], sizes: [[700000, 700000, 697152], [700000, 700000, 697152], [700000, 700000, 697152]] })); // 3 תמונות x 2MB = 9 מסמכי מדיה באצווה אחת (מגבלת קריאות הכללים)
if ((await quotaOf(T1, 't1')).pending !== 5 || (await quotaOf(T1, 't1')).images !== 8) throw new Error('מונה לא תקין: ' + JSON.stringify(await quotaOf(T1, 't1')));
n++;

// --- גודל ומבנה תמונות ---
await no(submit(T1, 't1', 'sg-b1', { keys: ['user/a', 'user/b', 'user/c', 'user/d'] }));                // 4 תמונות
await no(submit(T1, 't1', 'sg-b2', { keys: ['user/a'], sizes: [[700000, 700000, 697153]] }));       // 2MB + בית אחד
await no(submit(T1, 't1', 'sg-b3', { keys: ['user/a'], sizes: [[700000, 700000, 700000, 100]] })); // 4 חלקים
await no(submit(T1, 't1', 'sg-b4', { keys: ['user/a'], sizes: [[600000, 100]] }));                  // חלק לא אחרון קטן מ-700000 (ניפוח מספר מסמכים)
await no(submit(T1, 't1', 'sg-b5', { keys: ['user/a'], sizes: [[700001]] }));                       // חלק גדול מדי
await no(submit(T1, 't1', 'sg-b6', { keys: ['user/a'], med: { key: 'user/other' } }));              // מפתח לא תואם imageKeys
await no(submit(T1, 't1', 'sg-b7', { keys: ['user/a'], med: { idx: 1 } }));                         // אינדקס לא תואם
await no(submit(T1, 't1', 'sg-b8', { keys: ['user/a'], med: { tag: 'zzz' } }));                     // תג שונה מ-mediaTag
await no(submit(T1, 't1', 'sg-b9', { keys: ['user/a'], med: { extra: 1 } }));                       // שדה מיותר
// מדיה "יתומה": בלי הצעה באותה אצווה, או להצעה קיימת של אחר, או חלק נוסף בהצעה קיימת
await no(T1.doc('suggestionMedia/sg-loose-tg1-0-0').set({ sgId: 'sg-loose', authorUid: 't1', key: 'user/a', idx: 0, part: 0, parts: 1, tag: 'tg1', data: bytes(10) }));
await no(T1.doc('suggestionMedia/sg-a2-tg1-0-1').set({ sgId: 'sg-a2', authorUid: 't1', key: 'user/p1', idx: 0, part: 1, parts: 2, tag: 'tg1', data: bytes(700000) })); // תוספת להצעה קיימת (חלק לא קיים בה)
await no(ctx('t2').doc('suggestionMedia/sg-a2-tg1-0-5').set({ sgId: 'sg-a2', authorUid: 't2', key: 'user/p1', idx: 0, part: 0, parts: 1, tag: 'tg1', data: bytes(10) }));
n += 0;

// --- זיוף/עקיפת המונה ---
const T2 = ctx('t2');
await no(submit(T2, 't2', 'sg-c1', { noQuota: true }));                                           // בלי עדכון מונה
await no(submit(T2, 't2', 'sg-c2', { quota: { pending: 0, images: 0, sg: 'sg-c2' } }));            // מונה לא גדל
await no(submit(T2, 't2', 'sg-c3', { quota: { pending: 2, images: 0, sg: 'sg-c3' } }));            // קפיצה ב-2
await no(submit(T2, 't2', 'sg-c4', { keys: ['user/a'], quota: { pending: 1, images: 0, sg: 'sg-c4' } })); // מספר תמונות לא תואם
await no(submit(T2, 't2', 'sg-c5', { quota: { pending: 1, images: 0, sg: 'sg-other' } }));         // מונה מצביע על הצעה אחרת
await no(submit(T2, 't2', 'sg-c6', { quota: { pending: 1, images: 0, sg: 'sg-c6', extra: 1 } }));
await no(submit(T2, 't2', 'sg-c7', { quota: { pending: -1, images: 0, sg: 'sg-c7' } }));
await no(submit(ctx('t3'), 't3', 'sg-c8', { quota: { pending: 1, images: 0, sg: 'sg-c8' }, cur: { pending: 0, images: 0 }, sg: { authorUid: 't2' } })); // הצעה על שם אחר
await no(T2.doc('suggestionQuota/t2').set({ pending: 0, images: 0, sg: 'sg-a1' }));                // כתיבת מונה לבד
await no(T2.doc('suggestionQuota/t1').set({ pending: 0, images: 0, sg: 'sg-a1' }));                // מונה של מורה אחר
await no(T1.doc('suggestionQuota/t1').set({ pending: 0, images: 0, sg: 'sg-a1' }));                // הורדת מונה (איפוס עצמי) – הצעה כבר קיימת
await no(T1.doc('suggestionQuota/t1').delete());
await no(T1.doc('suggestionQuota/t1').update({ pending: 0 }));
await ok(T1.doc('suggestionQuota/t1').get());
await no(T2.doc('suggestionQuota/t1').get());
await no(T1.collection('suggestionQuota').get());
{ const c = ctx('t2'); const b = c.batch(); b.set(c.doc('suggestionQuota/t2'), { pending: 1, images: 0, sg: 'sg-existing-x' }); await no(b.commit()); }
// הגשה חוקית של משתמש אחר אינה מושפעת
await ok(submit(T2, 't2', 'sg-d1'));

// --- מכסת הצעות ממתינות: 50 ---
await seedQuota('t4', { pending: 49, images: 0 });
const T4 = ctx('t4');
await ok(submit(T4, 't4', 'sg-e50'));                       // ה-50
await no(submit(T4, 't4', 'sg-e51'));                       // ה-51 נדחית
await no(submit(T4, 't4', 'sg-e51b', { quota: { pending: 51, images: 0, sg: 'sg-e51b' } }));
await seedQuota('t5', { pending: 60, images: 0 });          // כבר מעל (נתונים ישנים): לא ניתן להוסיף
await no(submit(ctx('t5'), 't5', 'sg-e60'));

// --- מכסת תמונות בסך הכול: 30 ---
await seedQuota('t6', { pending: 5, images: 27 });
const T6 = ctx('t6');
await ok(submit(T6, 't6', 'sg-f1', { keys: ['user/a', 'user/b', 'user/c'] }));                 // 27+3 = 30
await no(submit(T6, 't6', 'sg-f2', { keys: ['user/a'] }));                                      // 31
await ok(submit(T6, 't6', 'sg-f3'));                                                            // הצעה בלי תמונות עדיין מותרת
await seedQuota('t7', { pending: 5, images: 29 });
await no(submit(ctx('t7'), 't7', 'sg-f4', { keys: ['user/a', 'user/b'] }));

// --- הגשות מקבילות (כמה לשוניות): שתיהן מחשבות מאותו מצב; רק אחת עוברת ---
await seedQuota('t8', { pending: 49, images: 0 });
const T8a = ctx('t8'), T8b = ctx('t8');
const base = { pending: 49, images: 0 };
const res = await Promise.allSettled([submit(T8a, 't8', 'sg-g1', { cur: base }), submit(T8b, 't8', 'sg-g2', { cur: base })]);
if (res.filter(r => r.status === 'fulfilled').length !== 1) throw new Error('הגשות מקבילות: צפויה הצלחה אחת בדיוק, התקבל ' + JSON.stringify(res.map(r => r.status)));
n++;
if ((await quotaOf(T8a, 't8')).pending !== 50) throw new Error('מונה אחרי מרוץ'); n++;
// מנסה לעקוף: שתי הצעות באותה אצווה עם מונה אחד
{ await seedQuota('t9', { pending: 10, images: 0 }); const c = ctx('t9'), b = c.batch();
  b.set(c.doc('suggestionQuota/t9'), { pending: 11, images: 0, sg: 'sg-h1' }); b.set(c.doc('suggestions/sg-h1'), sgDoc('sg-h1', 't9')); b.set(c.doc('suggestions/sg-h2'), sgDoc('sg-h2', 't9'));
  await no(b.commit()); }

// --- מנהל: פטור ממכסות, כותב מונים, סוגר הצעות ---
await ok(submit(ADM, 'ADM', 'sg-adm1', { noQuota: true }));
await ok(submit(ADM, 'ADM', 'sg-adm2', { noQuota: true, keys: ['user/a', 'user/b', 'user/c'] }));
await ok(ADM.doc('suggestionQuota/t4').set({ pending: 0, images: 0, sg: '' }));
await ok(submit(T4, 't4', 'sg-after-admin'));               // אחרי שהמנהל סגר/איפס, המורה יכול שוב
await ok(ADM.doc('suggestionQuota/t4').get()); await ok(ADM.collection('suggestionQuota').get());
await ok(ADM.doc('suggestions/sg-e50').update({ status: 'rejected' }));
await no(T4.doc('suggestions/sg-e50').update({ status: 'pending' }));                                 // מורה לא מחזיר/משנה

await env.cleanup();
console.log(`test-quota-rules: OK (${n} בדיקות באמולטור Firestore)`);
