// עזרים לבדיקות: Drive בזיכרון (עם הזרקת תקלות), local מזויף, חבילה סינתטית (לא נתוני אמת).
export function memDrive() {
  const files = new Map(); const d = { files, fail: null, calls: 0 };
  const guard = () => { d.calls++; if (d.fail) { const e = new Error('Drive ' + (d.fail.status || 'network')); e.status = d.fail.status; throw e; } };
  Object.assign(d, {
    async list(prefix = '') { guard(); return [...files.keys()].filter(n => n.startsWith(prefix)).map(name => ({ id: name, name })); },
    async getJson(name) { guard(); return files.has(name) ? JSON.parse(files.get(name)) : null; },
    async putJson(name, obj) { guard(); files.set(name, JSON.stringify(obj)); },
    async putBytes(name, bytes) { guard(); files.set(name, new Uint8Array(bytes)); },
    async getBytes(name) { guard(); return files.get(name) || null; },
    async remove(name) { guard(); files.delete(name); },
  });
  return d;
}

export const localStub = () => ({
  exams: new Map(), pq: new Map(), media: new Map(),
  async loadBank() { return { packages: [], questions: [{ uid: 'local-q' }], cases: [], media: new Map() }; },
  async loadExams() { return [...this.exams.values()]; }, async saveExam(e) { this.exams.set(e.id, e); }, async deleteExam(id) { this.exams.delete(id); },
  async loadPersonal() { return [...this.pq.values()]; }, async savePersonalQuestion(q) { this.pq.set(q.uid, q); }, async deletePersonalQuestion(u) { this.pq.delete(u); },
  async putMedia(k, d) { this.media.set(k, d); }, async getMedia(k) { return this.media.get(k) || null; },
});

export function syntheticPackage(n = 5, { pkgId = 'synthetic-pkg', imageBytes = 0 } = {}) {
  const questions = [], media = new Map();
  for (let i = 1; i <= n; i++) {
    const blocks = [
      { type: 'text', text: 'שאלה סינתטית מספר ' + i },
      { type: 'table', rows: [[['תא א', 'שורה 2'], 'תא ב'], [null, 'תא ד']] },   // מערך מקונן: חייב לשרוד שמירה ב-Firestore
    ];
    if (imageBytes && i === 1) { blocks.push({ type: 'image', mediaKey: pkgId + '/q1.png', caption: 'איור' }); media.set(pkgId + '/q1.png', Uint8Array.from({ length: imageBytes }, (_, k) => (k * 7 + 3) & 255)); }
    questions.push({ uid: `${pkgId}:q${i}`, pkgId, kind: 'teacher', year: null, domainId: 'cardiology', typeId: 'open', title: 'ש' + i, points: 5, blocks, rubric: { answer: [{ type: 'text', text: 'תשובה ' + i }] }, searchText: 'שאלה ' + i, addDomainIds: [], issues: [], corrections: [], ...(i === 2 ? { caseStudyId: pkgId + ':c1' } : {}) });
  }
  const cases = [{ uid: pkgId + ':c1', pkgId, blocks: [{ type: 'text', text: 'סיפור מקרה' }] }];
  return { pkg: { id: pkgId, fileName: pkgId + '.zip', kind: 'teacher', questionCount: n, mediaCount: media.size, taxonomy: { types: { open: 'פתוחה' }, domains: { cardiology: 'קרדיולוגיה' } } }, questions, cases, media };
}
