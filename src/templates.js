// תבניות עיצוב למבחן. נשמרות עם המבחן (exam.template). לא משנות תוכן, סדר, ניקוד או מבנה.
// sizes בחצאי נקודות (24 = 12pt).
export const TEMPLATES = {
  modern: {
    id: 'modern', label: 'מודרני (ברירת מחדל)', font: 'Arial',
    body: 24, qhead: 26, chap1: 32, chap2: 27, title: 40, qheadBold: true,
    chapColor1: '1F2A5A', chapColor2: '333333', chapRule: true,
  },
  bagrut: {
    id: 'bagrut', label: 'בסגנון בגרות (David)', font: 'David',
    body: 24, qhead: 26, chap1: 30, chap2: 26, title: 32, qheadBold: true,
    chapColor1: '000000', chapColor2: '000000', chapRule: false,
  },
};
export const templateOf = exam => TEMPLATES[exam?.template] || TEMPLATES.modern;
