// סיפורי מקרה כקבוצה: הוספה בודדת/מלאה, הסרה, הזזה בין פרקים, Word לתלמיד ולמורה, טעינה מחדש. נתונים סינתטיים.
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { newExam, removeItem, moveItem, moveToGap, validGaps, addChapter, caseFirstUse, qNumber } from '../src/exam.js';
import { groupRows, caseMembers, addUnique } from '../src/case-groups.js';
import { buildExamDocument, toBuffer } from '../src/docx-export.js';

let n = 0; const t = (ok, msg) => { assert.ok(ok, msg); n++; };
const CASE_TXT = 'טקסט-מקרה-ייחודי-XYZ';
const mkq = (uid, num, cid, extra = {}) => ({ uid, kind: 'bagrut', pkgId: 'p', year: 2024, originalNumber: num, domainId: 'd', typeId: 'open', caseStudyId: cid || null, points: 10, title: '', blocks: [{ type: 'text', text: 'גוף-' + uid }], rubric: { answer: [{ type: 'text', text: 'מחוון-' + uid }], allocation: [], notes: null, officialKind: 'official' }, ...extra });
const cases = new Map([['c1', { uid: 'c1', blocks: [{ type: 'text', text: CASE_TXT }] }], ['c2', { uid: 'c2', blocks: [{ type: 'text', text: 'מקרה-שני' }] }]]);
const bank = [mkq('a', '1'), mkq('c1q10', '10', 'c1'), mkq('c1q2', '2', 'c1'), mkq('b', '3'), mkq('c1q3', '3', 'c1'), mkq('c2q1', '1', 'c2'), mkq('hid', '4', 'c1', { published: false })];
const getCase = id => cases.get(id);

// --- קיבוץ ברשימה ---
const rows = groupRows(bank.filter(q => q.published !== false), getCase);
t(rows.length === 4 && rows[1].kind === 'case' && rows[1].cid === 'c1' && rows[1].qs.map(q => q.uid).join() === 'c1q2,c1q3,c1q10', 'שאלות מקרה מקובצות במקום הראשון וממוינות לפי מספר מקורי (מספרי)');
t(groupRows([bank[1]], () => undefined)[0].kind === 'q', 'מקרה חסר/מוסתר: השאלה מוצגת כשאלה רגילה');
t(caseMembers(bank, 'c1').length === 3, 'חברי מקרה: שאלה מוסתרת לא נכללת');
const filtered = groupRows([bank[2]], getCase); t(filtered[0].qs.length === 1 && caseMembers(bank, 'c1').length === 3, 'סינון חלקי: קבוצה מציגה חלק, וההוספה המלאה מכירה את כל החברים');

const exam = newExam();
const docText = async mode => await (await JSZip.loadAsync(await toBuffer(buildExamDocument(exam, { getMedia: () => null }, mode)))).file('word/document.xml').async('string');
const count = (s, sub) => s.split(sub).length - 1;

// --- הוספת שאלה בודדת מתוך מקרה ---
let r = addUnique(exam, [bank[2]], getCase);
t(r.added.length === 1 && Object.keys(exam.cases).length === 1 && exam.cases.c1.blocks[0].text === CASE_TXT, 'שאלה בודדת: סיפור המקרה נוסף');
t(exam.cases.c1.blocks !== cases.get('c1').blocks, 'סיפור המקרה מועתק למבחן (עריכה במבחן לא משנה את המאגר) ואינו מצביע לאותו אובייקט');
// --- הוספת הקבוצה כולה: בלי כפילויות ---
r = addUnique(exam, caseMembers(bank, 'c1'), getCase);
t(r.added.length === 2 && r.skipped.length === 1 && Object.keys(exam.cases).length === 1, 'הוספת כל הקבוצה: שאלה קיימת דולגה, נוספו 2, רשומת המקרה אחת');
t(addUnique(exam, caseMembers(bank, 'c1'), getCase).added.length === 0, 'הוספה חוזרת: אין כפילויות');
t(exam.items.filter(i => i.snap.uid === 'c1q2').length === 1, 'אין שאלה כפולה במבחן');
// --- Word: הטקסט המשותף פעם אחת, לתלמיד ולמורה ---
for (const mode of ['student', 'teacher']) { const x = await docText(mode); t(count(x, CASE_TXT) === 1, mode + ': טקסט המקרה מופיע פעם אחת למרות 3 שאלות (' + count(x, CASE_TXT) + ')'); t(['c1q2', 'c1q3', 'c1q10'].every(u => x.includes('גוף-' + u)), mode + ': כל שאלות המקרה במסמך'); }
t((await docText('teacher')).includes('מחוון-c1q2') && !(await docText('student')).includes('מחוון-c1q2'), 'מחוון רק בגרסת המורה');
// --- שאלות נוספות עם מקרה שני ושאלה רגילה ---
addUnique(exam, [bank[0], bank[5]], getCase);
t(Object.keys(exam.cases).sort().join() === 'c1,c2', 'שני מקרים נפרדים');
// --- הסרת שאלה אחת מהמקרה: הסיפור נשאר; הסרת האחרונה: הסיפור יוצא ---
const idOf = u => exam.items.find(i => i.snap?.uid === u).id;
removeItem(exam, idOf('c1q2')); t(exam.cases.c1 && count(await docText('student'), CASE_TXT) === 1, 'הסרת שאלה אחת: סיפור המקרה נשאר פעם אחת');
removeItem(exam, idOf('c1q3')); t(exam.cases.c1, 'עדיין שאלה אחת מהמקרה');
removeItem(exam, idOf('c1q10')); t(!exam.cases.c1 && count(await docText('student'), CASE_TXT) === 0, 'הסרת השאלה האחרונה של המקרה: הסיפור יוצא מהמבחן ומהמסמך');
t(exam.cases.c2 && count(await docText('teacher'), 'מקרה-שני') === 1, 'מקרה אחר לא הושפע');
// --- הוספה מחדש, הזזה בין פרקים, ניקוד ---
addUnique(exam, caseMembers(bank, 'c1'), getCase);
const ch = addChapter(exam, 1, 'פרק ב');
const items = () => exam.items.map(i => i.type === 'chapter' ? 'CH' : i.snap.uid).join();
moveToGap(exam, idOf('c1q3'), exam.items.length);               // לסוף, אחרי הפרק
t(exam.items.at(-1).snap.uid === 'c1q3', 'שאלה מהמקרה הועברה לפרק אחר');
t(caseFirstUse(exam).get(exam.items.find(i => i.snap?.caseStudyId === 'c1').id) === 'c1', 'הסיפור מוצג לפני השאלה הראשונה של המקרה לפי הסדר החדש');
const x2 = await docText('student'); t(count(x2, CASE_TXT) === 1, 'אחרי הזזה בין פרקים: טקסט המקרה פעם אחת');
moveItem(exam, idOf('c1q10'), 1); t(count(await docText('teacher'), CASE_TXT) === 1, 'אחרי שינוי סדר: פעם אחת');
// --- טעינה מחדש (שמירה/קריאה כ-JSON) ---
const reloaded = JSON.parse(JSON.stringify(exam));
t(Object.keys(reloaded.cases).join() === Object.keys(exam.cases).join() && reloaded.items.length === exam.items.length, 'טעינה מחדש: מקרים ופריטים נשמרו');
Object.assign(exam, reloaded); t(count(await docText('student'), CASE_TXT) === 1, 'מבחן שנטען מחדש מופק עם הטקסט המשותף פעם אחת');
// --- מקרה לא זמין ---
const e2 = newExam(); const r2 = addUnique(e2, [bank[1]], () => undefined);
t(r2.added.length === 1 && r2.noCase.length === 1 && !Object.keys(e2.cases).length, 'סיפור מקרה לא זמין: השאלה נוספה, ומדווח במפורש');
// --- ביצועים: אלפי שאלות ---
const many = Array.from({ length: 6000 }, (_, i) => mkq('m' + i, String(i), i % 3 ? 'k' + (i % 200) : null)); const gc = new Map(Array.from({ length: 200 }, (_, i) => ['k' + i, { uid: 'k' + i, blocks: [] }]));
const t0 = performance.now(); const g = groupRows(many, id => gc.get(id)); const ms = performance.now() - t0;
t(g.reduce((a, r) => a + (r.kind === 'q' ? 1 : r.qs.length), 0) === 6000 && ms < 400, `קיבוץ 6,000 שאלות: ${ms.toFixed(0)}ms`);
console.log(`test-case-groups: OK (${n} בדיקות)`);
