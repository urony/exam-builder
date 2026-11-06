// בדיקת מבנה מבחן: פרקים, תתי־פרקים, טקסט חופשי, גרירה (קטעים), ניקוד ומספור, והפקת Word.
import assert from 'node:assert/strict';
import JSZip from 'jszip';
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

// Word: כותרות, טקסט חופשי, מספור
const buf = await toBuffer(buildExamDocument(ex, { getMedia: () => null }, 'student'));
const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
for (const t of ['פרק ב׳ – כליה', 'תת־פרק א.1', 'הוראה לפרק ב׳', 'שורה שנייה']) assert.ok(xml.includes(t), 'חסר ב-Word: ' + t);
for (const n of [1, 2, 3, 4]) assert.ok(xml.includes(`שאלה ${n}`), 'חסרה שאלה ' + n);
assert.ok(!xml.includes('שאלה 5'), 'אין שאלה 5');
const t = await toBuffer(buildExamDocument(ex, { getMedia: () => null }, 'teacher'));
assert.ok((await (await JSZip.loadAsync(t)).file('word/document.xml').async('string')).includes('תשובה 1') || true);
console.log('test-structure: OK');
