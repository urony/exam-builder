// הפקת Word עמידה: תמונה פגומה/חסרה אינה מפילה את ההפקה ומסומנת גלויה במסמך (בלי הצלחה כוזבת).
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { newExam, addQuestion } from '../src/exam.js';
import { buildExamDocument, toBuffer } from '../src/docx-export.js';

const PNG1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const q = (uid, blocks, rubric) => ({ uid, kind: 'teacher', pkgId: 'p', domainId: 'd', typeId: 'open', title: uid, originalPoints: 5, blocks, rubric });
const media = new Map([['ok.png', PNG1], ['trunc.png', PNG1.slice(0, 10)], ['zero.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...new Array(12).fill(0), 0, 0, 0, 0, 0, 0, 0, 0])]]);   // כותרת PNG עם רוחב/גובה 0
const exam = newExam(); exam.title = 'בדיקת עמידות';
addQuestion(exam, q('good', [{ type: 'text', text: 'שאלה' }, { type: 'image', mediaKey: 'ok.png' }], { answer: [{ type: 'image', mediaKey: 'ok.png' }] }), null);
addQuestion(exam, q('trunc', [{ type: 'text', text: 'ב' }, { type: 'image', mediaKey: 'trunc.png' }], null), null);
addQuestion(exam, q('zero', [{ type: 'text', text: 'ג' }, { type: 'image', mediaKey: 'zero.png' }], null), null);
addQuestion(exam, q('missing', [{ type: 'text', text: 'ד' }, { type: 'image', mediaKey: 'gone.png' }], { answer: [{ type: 'image', mediaKey: 'gone.png' }, { type: 'text', text: 'תשובה' }] }), null);
let n = 0;
for (const mode of ['student', 'teacher']) {
  const buf = await toBuffer(buildExamDocument(exam, { getMedia: k => media.get(k) }, mode));   // לא זורק
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
  assert.ok(buf.length > 2000, 'מסמך הופק'); n++;
  assert.ok(xml.includes('תמונה פגומה'), mode + ': תמונה פגומה מסומנת'); n++;
  assert.ok(xml.includes('תמונה חסרה'), mode + ': תמונה חסרה מסומנת'); n++;
  assert.ok(xml.includes('שאלה') && xml.includes('תשובה') || mode === 'student', mode + ': טקסט נשמר'); n++;
}
const tx = await (await JSZip.loadAsync(await toBuffer(buildExamDocument(exam, { getMedia: k => media.get(k) }, 'teacher')))).file('word/document.xml').async('string');
assert.ok(tx.includes('חסר במחוון') || tx.includes('תמונה חסרה במחוון'), 'מחוון עם תמונה חסרה מסומן בגרסת המורה'); n++;
console.log(`test-export-safety: OK (${n} בדיקות)`);
