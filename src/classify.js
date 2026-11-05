// סיווג מתוקן: "זיהוי מבנים בתרשימים" (diagram_identification).
// הקריטריון: המשימה המרכזית היא זיהוי רכיבים/חלקים שמסומנים או ממוספרים בתרשים
// (למשל "שישה מהחלקים של המערכות האלה מסומנים בספרות 1–6"). קיום תמונה בלבד אינו מספיק.
export const DIAGRAM_TYPE = 'diagram_identification';
export const DIAGRAM_TYPE_LABEL = 'זיהוי מבנים בתרשימים';

const COUNT_PARTS = /(שישה|חמישה|ארבעה|שלושה|שניים)\s+(מבין\s+)?\S{0,4}(מרכיבי|חלקי|חלקים|חלקי|רכיבי|איברי)/;
const MARKED = /(מסומנ|ממוספר)/;

export function isDiagramIdentification(q) {
  const t = q.blocks.map(b => b.text || '').join(' ').replace(/\s+/g, ' ');
  return MARKED.test(t) && COUNT_PARTS.test(t);
}

// מחזיר רשומה מעודכנת (או אותה רשומה אם אין שינוי). תחומי הידע נשמרים כפי שהם.
export function refineQuestionType(q) {
  if (q.typeId === DIAGRAM_TYPE) return q;
  if (!isDiagramIdentification(q)) return q;
  q.originalTypeId = q.originalTypeId ?? q.typeId;
  q.typeId = DIAGRAM_TYPE;
  return q;
}
