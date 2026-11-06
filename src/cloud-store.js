// מימוש ענן של חוזה store.js: נתונים אישיים ב-Drive appData של המורה; הצעות ומאגר מרכזי (קריאה) ב-Firestore.
// פעולות ניהול המאגר המרכזי (כתיבה) לא ממומשות כאן בכוונה – הן נשארות מקומיות עד אישור פרסום כללי Firestore.
// local = localStore (משמש ל-fallback של המאגר כשהמאגר המרכזי בענן ריק, ולפעולות ניהול).
const strip = o => JSON.parse(JSON.stringify(o));
const mediaName = key => 'img-' + key.replace(/[^\w.-]/g, '_');

export function createCloudStore({ drive, firestore, uid, local }) {
  const mediaIndex = new Map(); // key -> שם קובץ (לטעינה מהירה של תמונות משתמש)
  return {
    ...local,
    kind: 'cloud-drive-firestore',

    async loadBank() {
      const base = await local.loadBank();
      try {
        const { fs, db } = await firestore();
        const snap = await fs.getDocs(fs.collection(db, 'bank'));
        const docs = snap.docs.map(d => d.data()).filter(d => d.kind === 'questions');
        if (!docs.length) return base; // המאגר המרכזי עדיין ריק
        const questions = docs.flatMap(d => d.items);
        return { ...base, questions };
      } catch { return base; }
    },

    async loadExams() {
      const files = await drive.list('exam-');
      const exams = (await Promise.all(files.map(f => drive.getJson(f.name)))).filter(Boolean);
      return exams.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    saveExam: exam => drive.putJson(`exam-${exam.id}.json`, strip(exam)),
    deleteExam: id => drive.remove(`exam-${id}.json`),

    async loadPersonal() {
      const files = await drive.list('pq-');
      return (await Promise.all(files.map(f => drive.getJson(f.name)))).filter(Boolean);
    },
    savePersonalQuestion: q => drive.putJson(`pq-${q.uid}.json`, strip(q)),
    deletePersonalQuestion: u => drive.remove(`pq-${u}.json`),

    async putMedia(key, data) { await drive.putBytes(mediaName(key), data, data[0] === 0x89 ? 'image/png' : 'image/jpeg'); mediaIndex.set(key, true); },
    async getMedia(key) { return drive.getBytes(mediaName(key)); },

    async submitSuggestion(q, { credit = false, authorName = '' } = {}) {
      const { fs, db } = await firestore();
      const rec = { id: 'sg-' + q.uid, status: 'pending', authorUid: uid, credit: !!credit, authorName: credit ? authorName : '', submittedAt: Date.now(), question: strip(q) };
      await fs.setDoc(fs.doc(db, 'suggestions', rec.id), rec);
      return rec;
    },
    async loadSuggestions() {
      const { fs, db } = await firestore();
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'suggestions'), fs.where('authorUid', '==', uid)));
      return snap.docs.map(d => d.data());
    },
  };
}
