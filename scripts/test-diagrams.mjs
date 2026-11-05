// בדיקת איורים: שאלות זיהוי-מבנים משנים שונות + תמונות משתמש (מעל/מתחת/לצד) -> out/diagrams-*.docx
import fs from 'node:fs';
import path from 'node:path';
import { parsePackage } from '../src/adapter.js';
import { newExam, addQuestion } from '../src/exam.js';
import { buildExamDocument, toBuffer } from '../src/docx-export.js';

const dir = process.argv[2];
const files = ['exam-802381-2018-summer.zip', 'exam-802381-2022-summer.zip', 'exam-802381-2025-summer.zip', 'exam-802381-2019-summer.zip'];
const media = new Map(); const qs = []; const cs = new Map();
for (const f of files) {
  const r = await parsePackage(fs.readFileSync(path.join(dir, f)), f);
  qs.push(...r.questions); r.cases.forEach(c => cs.set(c.uid, c)); r.media.forEach((v, k) => media.set(k, v));
}
const exam = newExam(); exam.title = 'בדיקת איורים'; exam.showPoints = true;
const diag = qs.filter(q => q.typeId === 'diagram_identification');
console.log('diagram questions:', diag.map(q => q.pkgId.slice(-11, -7) + ' q' + q.originalNumber + ' visibleImgs=' + q.blocks.filter(b => b.type === 'image' && !b.reference).length).join(' | '));
for (const q of diag) addQuestion(exam, q, cs.get(q.caseStudyId));
// תמונות משתמש: מדמה העלאה
const pic = [...media.entries()].find(([k]) => k.includes('2019') && k.includes('q15'))[1];
media.set('user/a', pic);
const it = exam.items[0];
it.images = [{ id: 'a', key: 'user/a', name: 'above.png', widthCm: 6, position: 'above' }];
const it2 = exam.items[1]; it2.images = [{ id: 'b', key: 'user/a', name: 'side.png', widthCm: 6, position: 'side' }];
const it3 = exam.items[2]; it3.images = [{ id: 'c', key: 'user/a', name: 'below.png', widthCm: 8, position: 'below' }];
exam.items.forEach(i => { i.points = 5; i.answerLines = 2; });
fs.mkdirSync('out', { recursive: true });
for (const mode of ['student', 'teacher']) fs.writeFileSync(`out/diagrams-${mode}.docx`, await toBuffer(buildExamDocument(exam, { getMedia: k => media.get(k) }, mode)));
console.log('ok', exam.items.length);
