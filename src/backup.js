// גיבוי ושחזור של המאגר המרכזי (לוגיקה טהורה, נבדקת ב-scripts/test-backup.mjs).
//
// למה קובץ זה קיים: בענן, loadBank() לא טוען תמונות (הן נטענות לפי צורך בלבד). גיבוי שנבנה מהזיכרון של
// הדפדפן כלל רק תמונות שהמנהל הציג באותה הפעלה, ולכן היה חסר. כאן הגיבוי מושך במפורש כל תמונה שהתוכן מפנה אליה
// (ותמונות יתומות שקיימות במאגר), ונכשל בקול רם אם אי אפשר להשיג תמונה. גיבוי לא שלם לעולם לא נוצר בשקט.
//
// פורמט (גרסה 2):  central.json + media/<encodeURIComponent(key)>
//   central.json: { version: 2, createdAt, app, counts, packages, questions, cases, taxonomy, media: [{key, size, sha256}] }
// גרסה 1 (ישנה): אותו מבנה בלי הרשימה media ובלי counts. עדיין נקראת (parseBackup) ומדווחת כ-legacy.
// הגיבוי אינו כולל מבחנים אישיים, שאלות אישיות, תמונות משתמש (user/...), אסימונים או פרטי התחברות.
// שדות הניהול (מחבר, מגיש, היסטוריית מקור, דגלי סקירה) כלולים, ולכן קובץ הגיבוי רגיש: למנהל בלבד.
export const BACKUP_VERSION = 2;

const isUser = k => String(k).startsWith('user/');

// כל מפתחות המדיה שהתוכן מפנה אליהם: שאלות (בלוקים, מחוון, images) וסיפורי מקרה.
export function referencedMedia({ questions = [], cases = [] }) {
  const keys = new Set();
  const add = k => { if (k && !isUser(k)) keys.add(k); };
  for (const q of questions) {
    for (const b of q.blocks || []) add(b.mediaKey);
    for (const b of q.rubric?.answer || []) add(b.mediaKey);
    for (const im of q.images || []) add(im.key);
  }
  for (const c of cases) for (const b of c.blocks || []) add(b.mediaKey);
  return keys;
}

const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256(bytes) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))); }

async function pool(items, n, fn) {
  let i = 0; const res = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); } }));
  return res;
}

// בונה גיבוי שלם. central = { packages, questions, cases, taxonomy }. listKeys() -> כל מפתחות המדיה הקיימים. getMedia(key) -> Uint8Array|null.
// זורק שגיאה עם code='backup-incomplete' ו-missing/corrupt אם משהו שהתוכן מפנה אליו לא התקבל.
export async function buildBackup({ JSZip, central, listKeys, getMedia, now = new Date(), onProgress = () => {}, concurrency = 6 }) {
  const questions = central.questions.filter(q => q.kind !== 'personal');
  const cases = central.cases;
  const need = referencedMedia({ questions, cases });
  const all = new Set(need);
  if (listKeys) for (const k of await listKeys()) if (!isUser(k)) all.add(k);
  const keys = [...all].sort();
  const files = new Map(), index = []; const missing = [], orphanFailed = []; let done = 0;
  await pool(keys, concurrency, async key => {
    let data = null;
    try { data = await getMedia(key); } catch { data = null; }
    if (data && data.length) { files.set(key, data); index.push({ key, size: data.length, sha256: await sha256(data) }); }
    else if (need.has(key)) missing.push(key); else orphanFailed.push(key);
    onProgress(++done, keys.length);
  });
  if (missing.length) throw Object.assign(new Error(`הגיבוי לא נוצר: ${missing.length} תמונות שהשאלות מפנות אליהן לא התקבלו (${missing.slice(0, 3).join(', ')})`), { code: 'backup-incomplete', missing });
  index.sort((a, b) => (a.key < b.key ? -1 : 1));
  const meta = {
    version: BACKUP_VERSION, createdAt: now.toISOString(), app: 'health-exam-builder',
    counts: { packages: central.packages.length, questions: questions.length, cases: cases.length, media: index.length },
    packages: central.packages, questions, cases, taxonomy: central.taxonomy || { domains: {}, types: {} }, media: index,
  };
  const z = new JSZip();
  z.file('central.json', JSON.stringify(meta));
  for (const [k, v] of files) z.file('media/' + encodeURIComponent(k), v);
  const data = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { data, central: meta, orphanFailed };
}

// קורא ומאמת גיבוי. מחזיר { central, media, legacy, missingMedia, problems }.
// problems = שגיאות שמונעות שחזור בטוח (נזרקות כ-Error). missingMedia = תמונות שהתוכן מפנה אליהן וחסרות בקובץ (החלטת הקורא).
export async function parseBackup({ JSZip, data }) {
  const z = await JSZip.loadAsync(data);
  const cf = z.file('central.json'); if (!cf) throw new Error('חסר central.json – לא קובץ גיבוי של המערכת');
  let c; try { c = JSON.parse(await cf.async('string')); } catch { throw new Error('central.json פגום (לא JSON תקין)'); }
  if (!c || (c.version !== 1 && c.version !== 2)) throw new Error('גרסת גיבוי לא נתמכת: ' + c?.version);
  if (![c.questions, c.packages, c.cases].every(Array.isArray)) throw new Error('מבנה גיבוי לא תקין');
  const bad = [];
  const seenQ = new Set(), dupQ = new Set();
  for (const q of c.questions) {
    if (!q || typeof q.uid !== 'string' || !q.uid || !q.domainId || !Array.isArray(q.blocks)) { bad.push(q?.uid || '?'); continue; }
    if (q.kind === 'personal') bad.push(q.uid + ' (שאלה אישית בגיבוי מרכזי)');
    if (seenQ.has(q.uid)) dupQ.add(q.uid); seenQ.add(q.uid);
  }
  if (bad.length) throw new Error('שאלות לא תקינות בגיבוי: ' + bad.slice(0, 3).join(', '));
  if (dupQ.size) throw new Error('מזהי שאלות כפולים בגיבוי: ' + [...dupQ].slice(0, 3).join(', '));
  const caseIds = new Set(); for (const k of c.cases) { if (!k?.uid) throw new Error('סיפור מקרה ללא מזהה בגיבוי'); if (caseIds.has(k.uid)) throw new Error('מזהה סיפור מקרה כפול: ' + k.uid); caseIds.add(k.uid); }
  const danglingCase = c.questions.filter(q => q.caseStudyId && !caseIds.has(q.caseStudyId)).map(q => q.uid);
  if (danglingCase.length) throw new Error('שאלות מפנות לסיפור מקרה שחסר בגיבוי: ' + danglingCase.slice(0, 3).join(', '));

  const media = new Map(), corrupt = [];
  const expected = new Map((c.media || []).map(m => [m.key, m]));
  for (const name of Object.keys(z.files).filter(n => n.startsWith('media/') && !z.files[n].dir)) {
    let key; try { key = decodeURIComponent(name.slice(6)); } catch { corrupt.push(name); continue; }
    if (isUser(key)) continue;                                   // תמונות משתמש לעולם לא משוחזרות למאגר המרכזי
    const bytes = await z.file(name).async('uint8array');
    const m = expected.get(key);
    if (m && (m.size !== bytes.length || m.sha256 !== await sha256(bytes))) { corrupt.push(key); continue; }
    media.set(key, bytes);
  }
  if (corrupt.length) throw new Error(`קובצי מדיה פגומים בגיבוי (${corrupt.length}): ${corrupt.slice(0, 3).join(', ')}`);
  const missingMedia = [...referencedMedia(c)].filter(k => !media.has(k));
  const declaredMissing = [...expected.keys()].filter(k => !media.has(k));
  return { central: c, media, legacy: c.version === 1, missingMedia, declaredMissing };
}
