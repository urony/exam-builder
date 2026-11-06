// מודל המבחן: עותקים עצמאיים של שאלות (העריכה לא נוגעת במאגר).
const clone = o => JSON.parse(JSON.stringify(o));
export const uid = () => 'x' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newExam() {
  return {
    id: uid(), title: 'מבחן חדש', school: '', teacher: '', date: '',
    instructions: '', targetPoints: 100, showPoints: true,
    items: [], cases: {}, updatedAt: Date.now(),
  };
}

// פריטי מבחן: שאלה (ברירת מחדל), כותרת פרק/תת-פרק {type:'chapter', level:1|2, title}, או טקסט חופשי {type:'free', text}
export const isQ = it => !it.type || it.type === 'question';
export const questionsOf = exam => exam.items.filter(isQ);
export const qNumber = (exam, id) => { let n = 0; for (const it of exam.items) { if (isQ(it)) n++; if (it.id === id) return n; } return 0; };

export function addChapter(exam, level = 1, title = '') {
  const it = { id: uid(), type: 'chapter', level: level === 2 ? 2 : 1, title, pageBreak: false };
  exam.items.push(it); exam.updatedAt = Date.now(); return it;
}
export function addFree(exam, text = '') {
  const it = { id: uid(), type: 'free', text };
  exam.items.push(it); exam.updatedAt = Date.now(); return it;
}

// קטע שנעים יחד: כותרת פרק + כל מה שאחריה עד פרק באותה רמה או גבוהה יותר; פריט אחר = הוא לבדו
export function sectionRange(exam, id) {
  const i = exam.items.findIndex(x => x.id === id); if (i < 0) return null;
  const it = exam.items[i]; let j = i + 1;
  if (it.type === 'chapter') while (j < exam.items.length && !(exam.items[j].type === 'chapter' && exam.items[j].level <= it.level)) j++;
  return [i, j];
}
// העברת קטע לפני/אחרי פריט יעד (גרירה). פרק נגרר יחד עם תוכנו. יעד בתוך הקטע = ללא שינוי.
export function moveTo(exam, id, targetId, after = false) {
  const r = sectionRange(exam, id); const t = exam.items.findIndex(x => x.id === targetId);
  if (!r || t < 0 || (t >= r[0] && t < r[1])) return false;
  const block = exam.items.splice(r[0], r[1] - r[0]);
  let at = exam.items.findIndex(x => x.id === targetId); if (at < 0) { exam.items.splice(r[0], 0, ...block); return false; }
  // אחרי כותרת פרק: שאלה/טקסט נכנסים לתוך הפרק (מיד אחרי הכותרת); פרק נגרר ממוקם אחרי הפרק היעד כולו
  if (after) { const tgt = exam.items[at]; if (tgt.type === 'chapter' && block[0].type === 'chapter') { const tr = sectionRange(exam, targetId); at = tr[1]; } else at += 1; }
  exam.items.splice(at, 0, ...block); exam.updatedAt = Date.now(); return true;
}

export const isChoiceQuestion = blocks => blocks.some(b => b.type === 'choice');

export function itemFromQuestion(q) {
  return {
    id: uid(),
    snap: {
      uid: q.uid, kind: q.kind, year: q.year, examCode: q.examCode, session: q.session,
      originalNumber: q.originalNumber, typeId: q.typeId, domainId: q.domainId,
      originalPoints: q.points, caseStudyId: q.caseStudyId,
      blocks: clone(q.blocks), rubric: q.rubric ? clone(q.rubric) : null,
    },
    edited: false,
    points: q.points ?? null,
    answerLines: 0,
    pageBreak: false,
    images: [], // תמונות שהמורה הוסיף: {id,key,name,widthCm,position:'above'|'below'|'side'}
  };
}

// הוספת שאלה למבחן + הצעת סיפור המקרה (פעם אחת בלבד)
export function addQuestion(exam, q, caseStudy) {
  const item = itemFromQuestion(q);
  if (!isChoiceQuestion(item.snap.blocks)) item.answerLines = 0;
  exam.items.push(item);
  if (q.caseStudyId && caseStudy && !exam.cases[q.caseStudyId]) {
    exam.cases[q.caseStudyId] = { include: true, blocks: clone(caseStudy.blocks), edited: false };
  }
  exam.updatedAt = Date.now();
  return item;
}

export function totalPoints(exam) {
  return questionsOf(exam).reduce((a, it) => a + (Number(it.points) || 0), 0);
}

export function removeItem(exam, id) {
  exam.items = exam.items.filter(i => i.id !== id);
  // סיפור מקרה שאין עוד שאלה שמשתמשת בו -> מוסר
  for (const cid of Object.keys(exam.cases)) {
    if (!exam.items.some(i => i.snap?.caseStudyId === cid)) delete exam.cases[cid];
  }
  exam.updatedAt = Date.now();
}

export function moveItem(exam, id, delta) {
  const i = exam.items.findIndex(x => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= exam.items.length) return;
  [exam.items[i], exam.items[j]] = [exam.items[j], exam.items[i]];
  exam.updatedAt = Date.now();
}

export function equalSplit(exam) {
  const qs = questionsOf(exam), n = qs.length;
  if (!n) return;
  const base = Math.floor(exam.targetPoints / n);
  let rest = exam.targetPoints - base * n;
  qs.forEach((it, idx) => { it.points = base + (idx >= n - rest ? 1 : 0); });
  exam.updatedAt = Date.now();
}

// סדר הצגת סיפורי מקרה: לפני השאלה הראשונה שמשתמשת בסיפור
export function caseFirstUse(exam) {
  const seen = new Set(); const map = new Map();
  for (const it of exam.items) {
    const c = it.snap?.caseStudyId;
    if (c && !seen.has(c) && exam.cases[c]?.include) { seen.add(c); map.set(it.id, c); }
  }
  return map;
}
