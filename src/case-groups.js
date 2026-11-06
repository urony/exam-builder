// סיפורי מקרה במאגר: קיבוץ שאלות של אותו מקרה כיחידה אחת (הרשומה המשותפת אינה משוכפלת), והוספה בטוחה למבחן.
import { addQuestion } from './exam.js';

const numKey = q => String(q.originalNumber ?? '');
export const byOriginalNumber = (a, b) => numKey(a).localeCompare(numKey(b), 'he', { numeric: true });

// list = שאלות אחרי סינון/מיון. getCase(cid) -> רשומת המקרה או undefined (מקרה חסר/מוסתר = שאלה רגילה, ללא קבוצה).
// קבוצה ממוקמת במקום השאלה הראשונה שלה ברשימה. מחזיר שורות: {kind:'q', q} | {kind:'case', cid, qs}
export function groupRows(list, getCase) {
  const idx = new Map(), rows = [];
  for (const q of list) {
    const cid = q.caseStudyId;
    if (!cid || !getCase(cid)) { rows.push({ kind: 'q', q }); continue; }
    let g = idx.get(cid);
    if (!g) { g = { kind: 'case', cid, qs: [] }; idx.set(cid, g); rows.push(g); }
    g.qs.push(q);
  }
  for (const g of rows) if (g.kind === 'case') g.qs.sort(byOriginalNumber);
  return rows;
}
// כל שאלות המקרה שגלויות למורה (לא מוסתרות), לפי מספר מקורי
export const caseMembers = (questions, cid) => questions.filter(q => q.caseStudyId === cid && q.published !== false).sort(byOriginalNumber);

// הוספה למבחן בלי כפילויות. מחזיר { added: item[], skipped: q[], noCase: q[] }. סיפור המקרה נכנס פעם אחת (addQuestion).
export function addUnique(exam, qs, getCase) {
  const have = new Set(exam.items.map(i => i.snap?.uid)); const added = [], skipped = [], noCase = [];
  for (const q of qs) {
    if (have.has(q.uid)) { skipped.push(q); continue; }
    if (q.caseStudyId && !getCase(q.caseStudyId)) noCase.push(q);        // סיפור המקרה אינו זמין: השאלה נוספת, והמורה מקבל התראה
    added.push(addQuestion(exam, q, q.caseStudyId ? getCase(q.caseStudyId) : null)); have.add(q.uid);
  }
  return { added, skipped, noCase };
}
