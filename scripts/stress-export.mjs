// מפיק מבחן ענק מכל השאלות (כל החבילות) לבדיקת יציבות, ושומר ל-out/
import fs from 'node:fs';
import { parsePackage } from '../src/adapter.js';
import { newExam, addQuestion } from '../src/exam.js';
import { buildExamDocument, toBuffer } from '../src/docx-export.js';
const media = new Map(); const qs = []; const cs = new Map();
for (const f of fs.readdirSync('samples').filter(f => f.endsWith('.zip'))) {
  const r = await parsePackage(fs.readFileSync('samples/' + f), f);
  qs.push(...r.questions); r.cases.forEach(c => cs.set(c.uid, c)); r.media.forEach((v, k) => media.set(k, v));
}
for (const [name, filter] of [['all-bagrut', q => q.kind === 'bagrut'], ['all-teacher', q => q.kind === 'teacher']]) {
  const exam = newExam(); exam.title = name;
  for (const q of qs.filter(filter)) addQuestion(exam, q, cs.get(q.caseStudyId));
  exam.items.forEach(it => { if (!it.snap.blocks.some(b => b.type === 'choice')) it.answerLines = 2; it.points = it.snap.originalPoints ?? 5; });
  for (const mode of ['student', 'teacher']) {
    fs.writeFileSync(`out/${name}-${mode}.docx`, await toBuffer(buildExamDocument(exam, { getMedia: k => media.get(k) }, mode)));
  }
  console.log(name, exam.items.length, 'questions,', Object.keys(exam.cases).length, 'cases');
}
