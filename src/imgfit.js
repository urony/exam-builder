// כוונון עדין של תמונות שהמורה הוסיף: הזזה אופקית (ס"מ) ומרווח אנכי (ס"מ), בצעדים קבועים.
// שיטה יציבה גם ב-Word: אופקית = הזחה של הפסקה (התמונה נשארת בתוך העמוד), אנכית = מרווח לפני התמונה.
// אין מיקום צף, ולכן תמונה לא יכולה לכסות טקסט או לצאת מגבולות העמוד.
export const STEP_CM = 0.25;
export const DY_MIN = -0.25, DY_MAX = 3;   // מרווח נוסף מעל התמונה (שלילי = פחות מהרגיל, עד קצת)
export const BASE_BEFORE_CM = 0.15;         // כמו ברירת המחדל הקיימת (80 twips)
const r2 = n => Math.round(n * 4) / 4;

export const maxShiftCm = (imgCm, availCm = 17) => Math.max(0, r2(Math.floor(((availCm - imgCm) / 2) * 4) / 4));
export function normOffsets(im, availCm = 17) {
  const m = maxShiftCm(Number(im.widthCm) || 10, availCm);
  const dx = Math.min(m, Math.max(-m, r2(Number(im.dx) || 0)));
  const dy = Math.min(DY_MAX, Math.max(DY_MIN, r2(Number(im.dy) || 0)));
  return { dx, dy };
}
// dir: l | r | u | d | reset. dx חיובי = ימינה (פיזית), dy חיובי = למטה.
export function nudge(im, dir, availCm = 17) {
  if (dir === 'reset') { im.dx = 0; im.dy = 0; return im; }
  const o = normOffsets(im, availCm);
  if (dir === 'r') o.dx += STEP_CM; if (dir === 'l') o.dx -= STEP_CM;
  if (dir === 'd') o.dy += STEP_CM; if (dir === 'u') o.dy -= STEP_CM;
  const n = normOffsets({ ...im, dx: o.dx, dy: o.dy }, availCm);
  im.dx = n.dx; im.dy = n.dy; return im;
}
// תצוגה מקדימה: אחוזים מרוחב התוכן (17 ס"מ), כך שהיחס זהה לכל רוחב מסך
export function previewStyle(im, availCm = 17) {
  const { dx, dy } = normOffsets(im, availCm);
  return `margin-top:${(Math.max(0, BASE_BEFORE_CM + dy) / 17 * 100).toFixed(2)}%;transform:translateX(${(dx / availCm * 100).toFixed(2)}%)`;
}
// Word: twips. הזחה לצד ההפוך מכפילה את ההזזה כי התמונה ממורכזת.
export function wordSpacing(im, availCm = 17) {
  const { dx, dy } = normOffsets(im, availCm);
  const tw = cm => Math.round(cm * 567);
  return { before: Math.max(0, tw(BASE_BEFORE_CM + dy)), left: dx > 0 ? tw(2 * dx) : 0, right: dx < 0 ? tw(-2 * dx) : 0 };
}
