// בדיקת מאגר אישי: טיוטה -> שאלה -> מבחן -> Word (תלמיד/מורה), כולל תמונה, סעיפים ואפשרויות
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { emptyDraft, draftToQuestion, validateDraft } from '../src/personal.js';
import { newExam, addQuestion } from '../src/exam.js';
import { buildExamDocument, toBuffer } from '../src/docx-export.js';

const d = emptyDraft();
assert.equal(validateDraft(d), 'חסר תוכן לשאלה');
d.body = 'מהו תפקיד הלב?';
assert.equal(validateDraft(d), 'חסר נושא ראשי');
d.domainId = 'cardiology'; d.sections = ['סעיף ראשון', 'סעיף שני']; d.choices = ['אפשרות א', 'אפשרות ב']; d.answer = 'תשובה לדוגמה';
assert.equal(validateDraft(d), '');
d.images = [{ key: 'user/t', name: 't.png' }];
const q = draftToQuestion(d);
assert.equal(q.kind, 'personal');
assert.deepEqual(q.blocks.map(b => b.type), ['text', 'image', 'section', 'section', 'choice', 'choice']);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const exam = newExam(); addQuestion(exam, q, null);
const media = new Map([['user/t', png]]);
for (const mode of ['student', 'teacher']) {
  const buf = await toBuffer(buildExamDocument(exam, { getMedia: k => media.get(k) }, mode));
  assert.ok(buf.length > 5000);
  fs.mkdirSync('out', { recursive: true }); fs.writeFileSync(`out/personal-${mode}.docx`, buf);
}
console.log('personal bank: OK');
