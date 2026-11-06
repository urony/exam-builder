// מפיק מסמכי Word לבדיקה חזותית (שתי תבניות, פרקים, תמונות מוזזות). דורש samples/. פלט: out/vis-*.docx
import fs from 'node:fs';
import { parsePackage } from '../src/adapter.js';
import { newExam, addQuestion, addChapter, addFree } from '../src/exam.js';
import { buildExamDocument, toBuffer } from '../src/docx-export.js';
const r = await parsePackage(fs.readFileSync('samples/exam-802381-2025-summer.zip'), 'x');
const media = r.media; const cs = new Map(r.cases.map(c => [c.uid, c]));
const imgKey = [...media.keys()].find(k => /png|jpg|jpeg/i.test(k));
const picks = [r.questions.find(q => q.blocks.some(b => b.type === 'choice')), r.questions.find(q => q.blocks.some(b => b.type === 'table')), r.questions.find(q => q.blocks.some(b => b.type === 'image' && !b.reference)), ...r.questions.slice(0, 3)].filter(Boolean);
const mk = template => {
  const e = newExam(); e.title = 'בדיקת תבנית – מערכת העצבים (Nervous system) ו־ATP'; e.school = 'בית ספר לדוגמה'; e.teacher = 'אורי'; e.date = '06.11.2026'; e.template = template;
  e.instructions = 'ענו על כל השאלות. ריכוז גלוקוז תקין: 70–100 mg/dL (בערך 5.0 mmol/L). שימו לב ל־pH (7.4) ולטמפרטורה 37°C.';
  addChapter(e, 1, 'פרק ראשון – מבוא'); addFree(e, 'הנחיה: בכל שאלה (או סעיף) יש לנמק; דוגמה: DNA → RNA → חלבון.');
  picks.slice(0, 2).forEach(q => addQuestion(e, q, cs.get(q.caseStudyId)));
  addChapter(e, 2, 'תת־פרק א׳ – תמונות');
  const q3 = addQuestion(e, picks[2], cs.get(picks[2].caseStudyId));
  const k = 'user/t1'; media.set(k, media.get(imgKey));
  q3.images.push({ id: 'i1', key: k, name: 'a', widthCm: 8, position: 'below', dx: 3, dy: 0.5 });
  q3.images.push({ id: 'i2', key: k, name: 'b', widthCm: 6, position: 'above', dx: -3.5, dy: 0 });
  const q4 = addQuestion(e, picks[3], null); q4.images.push({ id: 'i3', key: k, name: 'c', widthCm: 5, position: 'side', dx: 0.25, dy: 1 });
  addChapter(e, 1, 'פרק שני'); addQuestion(e, picks[4], null);
  e.items.forEach(it => { if (it.snap) { it.points = 10; if (!it.snap.blocks.some(b => b.type === 'choice')) it.answerLines = 2; } });
  return e;
};
fs.mkdirSync('out', { recursive: true });
for (const t of ['modern', 'bagrut']) for (const mode of ['student', 'teacher']) {
  fs.writeFileSync(`out/vis-${t}-${mode}.docx`, await toBuffer(buildExamDocument(mk(t), { getMedia: k => media.get(k) }, mode)));
}
console.log('ok', imgKey);
