// שכבת נתונים אחת לכל האפליקציה. הממשק למעלה (main.js) מדבר רק עם `store`;
// החלפת תשתית (IndexedDB מקומי -> Firebase/Firestore) = מימוש חדש של אותן פעולות, בלי לגעת בממשק.
//
// חוזה (כל הפעולות אסינכרוניות):
//   loadBank()            -> { packages, questions, cases, media: Map<key, Uint8Array> }
//   loadExams()           -> exam[] (של המשתמש המחובר בלבד)
//   saveExam(exam) / deleteExam(id)
//   putMedia(key, bytes)  -> שמירת תמונה של משתמש (קבועה, נגישה גם ממחשב אחר בתשתית הענן)
//   importPackage(parsed) / removePackage(id)   (ממשק מנהל; בענן – רק מנהל)
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
  importPackage: parsed => db.savePackage(parsed),
  removePackage: id => db.removePackage(id),
};

export const store = localStore;
