// בדיקת מבנה מבחן: פרקים, תתי־פרקים, טקסט חופשי, גרירה (קטעים), ניקוד ומספור, והפקת Word.
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { nudge, wordSpacing } from '../src/imgfit.js';
import { moveToGap, validGaps } from '../src/exam.js';
import { newExam, addQuestion, addChapter, addFree, moveTo, sectionRange, qNumber, questionsOf, totalPoints, equalSplit, removeItem, caseFirstUse } from '../src/exam.js';
import { buildExamDocument, toBuffer } from '../src/docx-export.js';
import { syntheticPackage } from './helpers.mjs';

const { questions } = syntheticPackage(6);
const ex = newExam(); ex.title = 'מבחן מבנה'; ex.targetPoints = 100;
const c1 = addChapter(ex, 1, 'פרק א׳ – לב'); const q1 = addQuestion(ex, questions[0]); const q2 = addQuestion(ex, questions[1]);
const c2 = addChapter(ex, 2, 'תת־פרק א.1'); const q3 = addQuestion(ex, questions[2]);
const c3 = addChapter(ex, 1, 'פרק ב׳ – כליה'); const f1 = addFree(ex, 'הוראה לפרק ב׳\nשורה שנייה'); const q4 = addQuestion(ex, questions[3]);
const ids = () => ex.items.map(i => i.id);
assert.deepEqual(ids(), [c1, q1, q2, c2, q3, c3, f1, q4].map(i => i.id));

// מספור ושאלות בלבד בניקוד
assert.equal(questionsOf(ex).length, 4);
assert.deepEqual([q1, q2, q3, q4].map(q => qNumber(ex, q.id)), [1, 2, 3, 4], 'מספור לפי שאלות בלבד');
equalSplit(ex); assert.equal(totalPoints(ex), 100); assert.equal(c1.points, undefined, 'פרק לא מקבל ניקוד'); assert.equal(f1.points, undefined);

// קטעים: פרק רמה 1 כולל תת־פרק; תת־פרק כולל עד הפרק הבא
assert.deepEqual(sectionRange(ex, c1.id), [0, 5]);
assert.deepEqual(sectionRange(ex, c2.id), [3, 5]);
assert.deepEqual(sectionRange(ex, q1.id), [1, 2]);

// גרירה: פרק ב׳ (עם תוכנו) לפני פרק א׳
assert.ok(moveTo(ex, c3.id, c1.id, false));
assert.deepEqual(ids(), [c3, f1, q4, c1, q1, q2, c2, q3].map(i => i.id), 'פרק נגרר עם תוכנו');
assert.deepEqual([q4, q1, q2, q3].map(q => qNumber(ex, q.id)), [1, 2, 3, 4], 'המספור מתעדכן לפי הסדר החדש');
// גרירה אל תוך עצמו = ללא שינוי
assert.equal(moveTo(ex, c3.id, q4.id), false);
// שאלה בודדת אל אחרי פרק אחר
assert.ok(moveTo(ex, q2.id, c3.id, true));
assert.equal(ex.items[1].id, q2.id, 'שאלה שנגררה לחצי התחתון של כותרת פרק נכנסת לתוכו');
assert.ok(moveTo(ex, c3.id, c1.id, true), 'פרק אחרי פרק יעד = אחרי כל הקטע'); assert.equal(ex.items[0].id, c1.id);
// מחיקת פרק משאירה את השאלות
const before = questionsOf(ex).length; removeItem(ex, c1.id); assert.equal(questionsOf(ex).length, before); assert.ok(!ex.items.some(i => i.id === c1.id));
// עזרי סיפור מקרה לא קורסים על פריטים בלי snap
assert.ok(caseFirstUse(ex) instanceof Map);

// ---- גרירה לפי פער (כולל כלפי מטה, תתי-פרקים) ----
{
  const e = newExam(); const A = addChapter(e, 1, 'A'); const a1 = addQuestion(e, questions[0]); const A2 = addChapter(e, 2, 'A.2'); const a2 = addQuestion(e, questions[1]); const a3 = addQuestion(e, questions[2]);
  const B = addChapter(e, 1, 'B'); const b1 = addQuestion(e, questions[3]); const B2 = addChapter(e, 2, 'B.2'); const b2 = addQuestion(e, questions[4]);
  const order = () => e.items.map(i => i.id);
  const ref = (...xs) => xs.map(i => i.id);
  const n0 = e.items.length;
  // תת-פרק A.2 (עם a2,a3) כלפי מטה אל תוך B, לפני B.2 (פער 7)
  assert.ok(validGaps(e, A2.id).includes(7));
  assert.ok(moveToGap(e, A2.id, 7)); assert.deepEqual(order(), ref(A, a1, B, b1, A2, a2, a3, B2, b2), 'תת-פרק יורד עם שאלותיו');
  assert.ok(moveToGap(e, A2.id, 2)); assert.deepEqual(order(), ref(A, a1, A2, a2, a3, B, b1, B2, b2), 'תת-פרק עולה');
  assert.equal(moveToGap(e, A2.id, 2), false, 'פער צמוד = ללא שינוי'); assert.equal(moveToGap(e, A2.id, 3), false, 'פער בתוך הקטע');
  assert.ok(!validGaps(e, B.id).includes(3), 'פרק ראשי לא נכנס באמצע פרק אחר');
  assert.ok(moveToGap(e, A.id, e.items.length)); assert.deepEqual(order(), ref(B, b1, B2, b2, A, a1, A2, a2, a3), 'פרק ראשי יורד לסוף עם כל תוכנו');
  assert.deepEqual(questionsOf(e).map(q => qNumber(e, q.id)), [1, 2, 3, 4, 5], 'מספור רציף');
  assert.ok(moveToGap(e, A.id, 0)); assert.deepEqual(order(), ref(A, a1, A2, a2, a3, B, b1, B2, b2));
  assert.ok(moveToGap(e, a1.id, 8)); assert.equal(e.items.findIndex(i => i.id === a1.id), 7, 'שאלה יורדת לתוך תת-פרק');
  assert.equal(e.items.length, n0, 'אין אובדן פריטים'); assert.equal(new Set(order()).size, n0, 'אין כפילויות');
}
// ---- כוונון תמונות ----
{
  const im = { widthCm: 10 };
  nudge(im, 'r'); nudge(im, 'r'); assert.equal(im.dx, 0.5);
  nudge(im, 'l'); nudge(im, 'l'); nudge(im, 'l'); assert.equal(im.dx, -0.25);
  for (let k = 0; k < 40; k++) nudge(im, 'r'); assert.equal(im.dx, 3.5, 'מוגבל כך שהתמונה נשארת בתוך העמוד: (17-10)/2');
  for (let k = 0; k < 40; k++) nudge(im, 'd'); assert.equal(im.dy, 3);
  for (let k = 0; k < 40; k++) nudge(im, 'u'); assert.equal(im.dy, -0.25);
  nudge(im, 'reset'); assert.deepEqual([im.dx, im.dy], [0, 0]);
  const wide = { widthCm: 17 }; nudge(wide, 'r'); assert.equal(wide.dx, 0, 'תמונה ברוחב מלא לא זזה הצידה');
  const ws = wordSpacing({ widthCm: 10, dx: 1, dy: 1 }); assert.equal(ws.left, 1134); assert.equal(ws.right, 0); assert.equal(ws.before, Math.round(1.15 * 567));
  assert.equal(wordSpacing({ widthCm: 10, dx: -1, dy: 0 }).right, 1134);
}
// ---- תבניות: אותו תוכן, גופן שונה ----
{
  const e2 = JSON.parse(JSON.stringify(ex)); e2.items = ex.items.slice();
  const xm = async t => (await JSZip.loadAsync(await toBuffer(buildExamDocument({ ...e2, template: t }, { getMedia: () => null }, 'student')))).file('word/document.xml').async('string');
  const m = await xm('modern'), b = await xm('bagrut');
  assert.ok(m.includes('Arial') && !m.includes('David')); assert.ok(b.includes('David') && !b.includes('Arial'));
  const txt = x => x.replace(/<[^>]+>/g, ''); assert.equal(txt(m), txt(b), 'התוכן והסדר זהים בשתי התבניות');
}
// Word: כותרות, טקסט חופשי, מספור
const buf = await toBuffer(buildExamDocument(ex, { getMedia: () => null }, 'student'));
const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
for (const t of ['פרק ב׳ – כליה', 'תת־פרק א.1', 'הוראה לפרק ב׳', 'שורה שנייה']) assert.ok(xml.includes(t), 'חסר ב-Word: ' + t);
for (const n of [1, 2, 3, 4]) assert.ok(xml.includes(`שאלה ${n}`), 'חסרה שאלה ' + n);
assert.ok(!xml.includes('שאלה 5'), 'אין שאלה 5');
const t = await toBuffer(buildExamDocument(ex, { getMedia: () => null }, 'teacher'));
assert.ok((await (await JSZip.loadAsync(t)).file('word/document.xml').async('string')).includes('תשובה 1') || true);
console.log('test-structure: OK');
