// בדיקות גיבוי (לוגיקה טהורה, נתונים סינתטיים): שלמות, כישלון קולני, אימות, תאימות לגיבוי ישן.
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildBackup, parseBackup, referencedMedia, sha256 } from '../src/backup.js';

let n = 0; const t = (ok, msg) => { assert.ok(ok, msg); n++; };
const rej = async (p, re, msg) => { try { await p; } catch (e) { assert.match(String(e.message) + (e.code || ''), re, msg); n++; return e; } assert.fail('צפוי כישלון: ' + msg); };
const img = (len, seed) => Uint8Array.from({ length: len }, (_, i) => (i * seed + 1) & 255);

const questions = [
  { uid: 'p:q1', pkgId: 'p', kind: 'bagrut', year: 2019, domainId: 'cardiology', typeId: 'open', blocks: [{ type: 'text', text: 'א' }, { type: 'image', mediaKey: 'p/a.png' }, { type: 'table', rows: [[['x', 'y'], 'z']] }], rubric: { answer: [{ type: 'image', mediaKey: 'p/rub.png' }] }, caseStudyId: 'p:c1', sourceHistory: [{ at: 'x', field: 'year', from: null, to: 2019 }], authorAdmin: 'דנה' },
  { uid: 'p:q2', pkgId: 'p', kind: 'teacher', domainId: 'cardiology', typeId: 'open', blocks: [{ type: 'text', text: 'ב' }], rubric: null, published: false, reviewFlag: true },
  { uid: 'personal-1', kind: 'personal', domainId: 'cardiology', typeId: 'open', blocks: [{ type: 'image', mediaKey: 'user/private.png' }] },
];
const cases = [{ uid: 'p:c1', pkgId: 'p', blocks: [{ type: 'image', mediaKey: 'p/case.png' }] }];
const store = new Map([['p/a.png', img(5000, 3)], ['p/rub.png', img(3000, 5)], ['p/case.png', img(2000, 7)], ['p/orphan.png', img(100, 9)], ['user/private.png', img(10, 1)]]);
const central = { packages: [{ id: 'p', title: 'חבילה' }], questions, cases, taxonomy: { domains: { cardiology: 'לב' }, types: {} } };
const base = { JSZip, central, listKeys: async () => [...store.keys()], getMedia: async k => store.get(k) || null };

// referencedMedia: בלוקים, מחוון, מקרה; לא user/
const refs = referencedMedia(central);
t(refs.size === 3 && refs.has('p/rub.png') && refs.has('p/case.png') && !refs.has('user/private.png'), 'מפתחות מדיה מופנים: בלוקים, מחוון וסיפור מקרה, ללא תמונות משתמש');

// גיבוי שלם: כל תמונה (כולל יתומה), ללא שאלה אישית וללא תמונת משתמש
const r = await buildBackup({ ...base, now: new Date('2026-11-06T00:00:00Z') });
t(r.central.version === 2 && r.central.counts.questions === 2 && r.central.counts.media === 4, 'גיבוי v2: ספירות נכונות (' + JSON.stringify(r.central.counts) + ')');
const p = await parseBackup({ JSZip, data: r.data });
t(p.media.size === 4 && p.missingMedia.length === 0 && !p.legacy, 'הגיבוי נקרא: כל התמונות קיימות');
t([...p.media].every(([k, v]) => Buffer.compare(Buffer.from(v), Buffer.from(store.get(k))) === 0), 'בתים זהים לתמונות המקור');
t(p.central.questions.find(q => q.uid === 'p:q2').published === false && p.central.questions[0].sourceHistory.length === 1 && p.central.questions[0].authorAdmin === 'דנה', 'מצב פרסום, היסטוריה ושדות ניהול נשמרו');
t(!p.central.questions.some(q => q.kind === 'personal') && ![...p.media.keys()].some(k => k.startsWith('user/')), 'שאלות אישיות ותמונות משתמש לא בגיבוי');
const txt = JSON.stringify(p.central);
t(!/access_token|refresh_token|ya29\.|AIza|Bearer |password|private_key/i.test(txt), 'אין אסימונים או סודות בגיבוי');

// כישלון קולני: תמונה שמופנית ולא התקבלה / ריקה / זורקת
for (const [name, getMedia] of [['חסרה', async k => (k === 'p/rub.png' ? null : store.get(k))], ['ריקה', async k => (k === 'p/rub.png' ? new Uint8Array(0) : store.get(k))], ['זורקת', async k => { if (k === 'p/case.png') throw new Error('net'); return store.get(k); }]]) {
  const e = await rej(buildBackup({ ...base, getMedia }), /backup-incomplete/, 'תמונה מופנית ' + name + ' → גיבוי נכשל');
  t(e.missing.length === 1, 'מדווח בדיוק איזו תמונה חסרה');
}
// תמונה יתומה שנכשלה לא מכשילה (לא מופנית)
const ok2 = await buildBackup({ ...base, getMedia: async k => (k === 'p/orphan.png' ? null : store.get(k)) });
t(ok2.orphanFailed.length === 1 && ok2.central.counts.media === 3, 'יתומה שנכשלה: גיבוי נוצר ומדווחת');

// ללא listKeys (מגבה רק את המופנות)
t((await buildBackup({ ...base, listKeys: null })).central.counts.media === 3, 'בלי listKeys: רק מופנות');

// אימות: גיבוי פגום
const mutate = async fn => { const z = await JSZip.loadAsync(r.data); await fn(z); return z.generateAsync({ type: 'uint8array' }); };
await rej(parseBackup({ JSZip, data: await mutate(async z => { z.file('media/' + encodeURIComponent('p/a.png'), img(5000, 4)); }) }), /פגומים/, 'תמונה ששונתה (hash)');
await rej(parseBackup({ JSZip, data: await mutate(async z => { z.file('media/' + encodeURIComponent('p/a.png'), img(10, 4)); }) }), /פגומים/, 'תמונה קטועה (גודל)');
await rej(parseBackup({ JSZip, data: await mutate(async z => { z.remove('central.json'); }) }), /central\.json/, 'חסר central.json');
await rej(parseBackup({ JSZip, data: await mutate(async z => { z.file('central.json', '{bad'); }) }), /פגום/, 'JSON שבור');
await rej(parseBackup({ JSZip, data: await mutate(async z => { z.file('central.json', JSON.stringify({ ...p.central, version: 9 })); }) }), /גרסת/, "גרסה לא נתמכת");
await rej(parseBackup({ JSZip, data: await mutate(async z => { z.file('central.json', JSON.stringify({ ...p.central, questions: [...p.central.questions, p.central.questions[0]] })); }) }), /כפולים/, 'מזהה שאלה כפול');
await rej(parseBackup({ JSZip, data: await mutate(async z => { z.file('central.json', JSON.stringify({ ...p.central, cases: [] })); }) }), /סיפור מקרה/, 'שאלה מפנה לסיפור מקרה שחסר');
await rej(parseBackup({ JSZip, data: await mutate(async z => { z.file('central.json', JSON.stringify({ ...p.central, questions: [...p.central.questions, { uid: 'x', blocks: [] }] })); }) }), /לא תקינות/, 'שאלה ללא תחום');
await rej(parseBackup({ JSZip, data: new Uint8Array([1, 2, 3]) }), /./, 'קובץ שאינו ZIP');
// תמונת משתמש בתוך ZIP לא משוחזרת
const withUser = await parseBackup({ JSZip, data: await mutate(async z => { z.file('media/' + encodeURIComponent('user/evil.png'), img(10, 2)); }) });
t(!withUser.media.has('user/evil.png'), 'תמונת user/ בקובץ מתעלמים ממנה');

// תאימות לאחור: v1 (בלי רשימת media) עם תמונות → נקרא במלואו; v1 בלי תמונות → missingMedia מדווח במדויק
const v1 = { version: 1, createdAt: '2026-11-05T00:00:00Z', packages: central.packages, questions: [questions[0], questions[1]], cases, taxonomy: { domains: {}, types: {} } };
const mk1 = async withMedia => { const z = new JSZip(); z.file('central.json', JSON.stringify(v1)); if (withMedia) for (const k of ['p/a.png', 'p/rub.png', 'p/case.png']) z.file('media/' + encodeURIComponent(k), store.get(k)); return z.generateAsync({ type: 'uint8array' }); };
const l1 = await parseBackup({ JSZip, data: await mk1(true) });
t(l1.legacy && l1.missingMedia.length === 0 && l1.media.size === 3, 'גיבוי v1 עם תמונות נקרא במלואו');
const l2 = await parseBackup({ JSZip, data: await mk1(false) });
t(l2.legacy && l2.missingMedia.length === 3 && l2.central.questions.length === 2, 'גיבוי v1 בלי תמונות (כמו שהורד בפועל): נקרא, וחסרות בדיוק 3 תמונות');
t(await sha256(new Uint8Array([1])) === '4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a', 'sha256 תקין');

console.log(`test-backup: OK (${n} בדיקות)`);
