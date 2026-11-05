import fs from 'node:fs';
import { parsePackage } from '../src/adapter.js';
import { newExam, addQuestion, equalSplit } from '../src/exam.js';
import { buildExamDocument, toBuffer } from '../src/docx-export.js';

const pk = {}; const media = new Map(); const qs = new Map(); const cs = new Map();
for (const f of fs.readdirSync('samples').filter(f => f.endsWith('.zip'))) {
  const r = await parsePackage(fs.readFileSync('samples/' + f), f);
  for (const q of r.questions) qs.set(q.uid, q);
  for (const c of r.cases) cs.set(c.uid, c);
  for (const [k, v] of r.media) media.set(k, v);
}
const id25 = n => `bagrut-802381-2025-summer-q${n}`;
const id19 = n => `bagrut-802381-2019-summer-q${n}`;
const picks = (process.argv[2] || '9,17,18,19,28').split(',').map(n => id25(n))
  .concat([id19(4), id19(15), id19(16), id19(22)])
  .concat([...qs.keys()].filter(k => k.startsWith('teacher-cardiology')).slice(0, 2));
const exam = newExam();
exam.title = 'מבחן לדוגמה – מדעי הבריאות'; exam.school = 'בית ספר לדוגמה'; exam.teacher = 'אורי'; exam.date = '05.11.2026';
exam.instructions = 'ענו על כל השאלות. כתבו בכתב קריא.\nאין להשתמש בחומר עזר.';
for (const id of picks) { const q = qs.get(id); if (!q) { console.log('missing', id); continue; } addQuestion(exam, q, cs.get(q.caseStudyId)); }
equalSplit(exam);
exam.items.forEach((it, i) => { if (!it.snap.blocks.some(b => b.type === 'choice')) it.answerLines = 3; if (i === 4) it.pageBreak = true; });
const opts = { getMedia: k => media.get(k) };
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/student.docx', await toBuffer(buildExamDocument(exam, opts, 'student')));
fs.writeFileSync('out/teacher.docx', await toBuffer(buildExamDocument(exam, opts, 'teacher')));
console.log('items', exam.items.length, 'pts', exam.items.map(i => i.points).join(','));
