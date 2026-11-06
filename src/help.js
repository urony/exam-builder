// עזרה בממשק: סימני שאלה קטנים (לחיצה / מיקוד / ריחוף) וקישור למדריך המלא.
import { esc } from './util.js';
import { ICON } from './icons.js';

export const GUIDE_URL = './guide.html';

export const HELP = {
  used: { t: 'סינון שאלות שכבר השתמשתי בהן', p: 'שאלה נחשבת "משומשת" כשהיא מופיעה במבחן שמור שלך, או כשסימנת אותה ידנית. הסינון "לא השתמשתי" מסתיר אותן, והוא אישי: מורים אחרים לא מושפעים. אפשר לבטל סימון בכל שאלה.', a: 'search-used' },
  case: { t: 'שאלות מסיפור מקרה', p: 'כמה שאלות נשענות על אותו סיפור מקרה. בלחיצה על "הוסף" נכנסות כל השאלות, והסיפור מופיע במבחן פעם אחת, לפני השאלה הראשונה. אפשר גם לפתוח את הקבוצה ולבחור שאלות בודדות.', a: 'cases' },
  anatomy: { t: 'תמונה מכלי האיורים האנטומיים', p: 'הכלי נפתח בלשונית חדשה. שומרים את האיור במחשב, חוזרים לכאן ומעלים אותו דרך "תמונה מהמחשב".', a: 'images' },
  teacher: { t: 'גרסת מורה', p: 'מסמך שבו מופיעים גם התשובות והמחוונים (כולל מחוון סרוק כנספח). מסמך התלמיד אינו כולל אותם. את ההפקה עושים בכפתורי "הפק Word".', a: 'export' },
  cloud: { t: 'שמירה בענן', p: 'כשמחוברים עם Google, המבחנים נשמרים ב־Google Drive שלך, ורק את/ה רואה אותם. בלי התחברות הם נשמרים בדפדפן הזה בלבד. "נשמר ✓" מופיע רק אחרי שהשמירה באמת הושלמה.', a: 'saving' },
  suggest: { t: 'הצעת שאלה למאגר הכללי', p: 'שאלה אישית נשארת פרטית עד שמציעים אותה. אחרי ההצעה היא ממתינה לבדיקת מנהל, ורק אם תאושר תופיע לכל המורים. יש מגבלה על כמות ההצעות הממתינות והתמונות.', a: 'personal' },
};

export const helpBtn = key => {
  const h = HELP[key]; if (!h) return '';
  return `<button type="button" class="helpbtn" data-help="${key}" aria-label="עזרה: ${esc(h.t)}" aria-expanded="false">${ICON.help}</button>`;
};
export const helpLink = (text = 'עזרה', anchor = '') => `<a class="helplink" href="${GUIDE_URL}${anchor ? '#' + anchor : ''}" target="_blank" rel="noopener">${esc(text)}</a>`;

let pop = null, popFor = null, pinned = false;
export function closeHelp() {
  if (!pop) return; pop.remove(); pop = null; pinned = false;
  if (popFor) { popFor.setAttribute('aria-expanded', 'false'); popFor = null; }
}
function openHelp(btn, key) {
  const h = HELP[key]; if (!h) return;
  closeHelp();
  pop = document.createElement('div'); pop.className = 'helppop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', h.t); pop.tabIndex = -1;
  pop.innerHTML = `<b>${esc(h.t)}</b><p>${esc(h.p)}</p><a href="${GUIDE_URL}#${h.a}" target="_blank" rel="noopener">למדריך המלא ↗</a>`;
  document.body.appendChild(pop); popFor = btn; btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect(), w = Math.min(320, innerWidth - 16); pop.style.width = w + 'px';
  let left = r.left + r.width / 2 - w / 2; left = Math.max(8, Math.min(innerWidth - w - 8, left));
  pop.style.left = left + 'px';
  const ph = pop.offsetHeight; pop.style.top = (r.bottom + 8 + ph > innerHeight && r.top - ph - 8 > 0 ? r.top - ph - 8 : r.bottom + 8) + 'px';
}
// מאזינים גלובליים (פעם אחת)
export function initHelp() {
  document.addEventListener('click', e => {
    const b = e.target.closest?.('.helpbtn');
    if (b) { e.preventDefault(); e.stopPropagation(); if (popFor === b && pinned) return closeHelp(); openHelp(b, b.dataset.help); pinned = true; return; }
    if (pop && !pop.contains(e.target)) closeHelp();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) { const f = popFor; closeHelp(); f?.focus(); } });
  document.addEventListener('mouseover', e => { const b = e.target.closest?.('.helpbtn'); if (b && popFor !== b && matchMedia('(hover: hover)').matches) openHelp(b, b.dataset.help); });
  document.addEventListener('mouseout', e => { const b = e.target.closest?.('.helpbtn'); if (b && popFor === b && !pinned) closeHelp(); });
}
