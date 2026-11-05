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
  return exam.items.reduce((a, it) => a + (Number(it.points) || 0), 0);
}

export function removeItem(exam, id) {
  exam.items = exam.items.filter(i => i.id !== id);
  // סיפור מקרה שאין עוד שאלה שמשתמשת בו -> מוסר
  for (const cid of Object.keys(exam.cases)) {
    if (!exam.items.some(i => i.snap.caseStudyId === cid)) delete exam.cases[cid];
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
  const n = exam.items.length;
  if (!n) return;
  const base = Math.floor(exam.targetPoints / n);
  let rest = exam.targetPoints - base * n;
  exam.items.forEach((it, idx) => { it.points = base + (idx >= n - rest ? 1 : 0); });
  exam.updatedAt = Date.now();
}

// סדר הצגת סיפורי מקרה: לפני השאלה הראשונה שמשתמשת בסיפור
export function caseFirstUse(exam) {
  const seen = new Set(); const map = new Map();
  for (const it of exam.items) {
    const c = it.snap.caseStudyId;
    if (c && !seen.has(c) && exam.cases[c]?.include) { seen.add(c); map.set(it.id, c); }
  }
  return map;
}
