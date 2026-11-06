// שכבת נתונים אחת לכל האפליקציה. הממשק למעלה (main.js) מדבר רק עם `store`;
// החלפת תשתית (IndexedDB מקומי -> Firebase/Firestore) = מימוש חדש של אותן פעולות, בלי לגעת בממשק.
//
// חוזה (כל הפעולות אסינכרוניות):
//   loadBank()            -> { packages, questions, cases, media: Map<key, Uint8Array> }
//   loadExams()           -> exam[] (של המשתמש המחובר בלבד)
//   saveExam(exam) / deleteExam(id)
//   putMedia(key, bytes)  -> שמירת תמונה של משתמש (קבועה, נגישה גם ממחשב אחר בתשתית הענן)
//   importPackage(parsed) / removePackage(id)   (ממשק מנהל; בענן – רק מנהל)
//   loadPersonal() / savePersonalQuestion(q) / deletePersonalQuestion(uid)   (מאגר אישי; בענן: Google Drive של המורה)
//   submitSuggestion(q, {credit, authorName}) / loadSuggestions()            (הצעה למאגר המרכזי; בענן: Firestore, כתיבה בלבד למורה)
//
// יעד ענן (ממתין לאישור): נתונים אישיים (מבחנים, שאלות אישיות, תמונות) -> Drive appDataFolder של המורה;
// מאגר מרכזי + הצעות + הרשאות מנהל -> Firestore (Spark).
import * as db from './db.js';

export const localStore = {
  kind: 'local-indexeddb',
  async loadBank() {
    const [packages, questions, cases, media] = await Promise.all([db.getAll('packages'), db.getAll('questions'), db.getAll('cases'), db.getAll('media')]);
    return { packages, questions, cases, media: new Map(media.map(m => [m.key, m.data])) };
  },
  async loadExams() { return (await db.getAll('exams')).sort((a, b) => b.updatedAt - a.updatedAt); },
  saveExam: exam => db.put('exams', JSON.parse(JSON.stringify(exam))),
  deleteExam: id => db.del('exams', id),
  putMedia: (key, data) => db.put('media', { key, data }),
  loadPersonal: () => db.getAll('personal'),
  savePersonalQuestion: q => db.put('personal', JSON.parse(JSON.stringify(q))),
  deletePersonalQuestion: uid => db.del('personal', uid),
  async submitSuggestion(q, { credit = false, authorName = '' } = {}) {
    const rec = { id: 'sg-' + q.uid, status: 'pending', credit: !!credit, authorName: credit ? authorName : '', submittedAt: Date.now(), question: JSON.parse(JSON.stringify(q)) };
    await db.put('suggestions', rec); return rec;
  },
  loadSuggestions: () => db.getAll('suggestions'),
  importPackage: (parsed, opts) => (opts ? db.mergePackage(parsed, opts) : db.savePackage(parsed)),
  // ניהול המאגר המרכזי (בענן: Firestore, כתיבה למנהל בלבד)
  saveBankQuestion: q => db.put('questions', JSON.parse(JSON.stringify(q))),
  deleteBankQuestion: uid => db.del('questions', uid),
  saveSuggestion: s => db.put('suggestions', JSON.parse(JSON.stringify(s))),
  async loadTaxonomy() { return (await db.getOne('meta', 'taxonomy'))?.value || { domains: {}, types: {} }; },
  saveTaxonomy: value => db.put('meta', { key: 'taxonomy', value }),
  replaceCentral: data => db.replaceCentral(data),
  removePackage: id => db.removePackage(id),
};

// store = מעטפת שמעבירה לגב-קצה הנוכחי (מקומי, או ענן אחרי התחברות). הממשק למעלה לא משתנה.
let backend = localStore;
export const setBackend = b => { backend = b || localStore; };
export const store = new Proxy({}, { get: (_, k) => backend[k] });
