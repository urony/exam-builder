// מסכי דף הבית ו"המבחנים שלי" (HTML בלבד; הלוגיקה והאירועים ב-main.js).
import { esc } from './util.js';
import { ICON } from './icons.js';
import { questionsOf, totalPoints } from './exam.js';

const fmtDate = ts => { try { return new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };

// מצב שמירה אמיתי של המבחן האחרון (לא מבטיחים שנשמר כשהשמירה ממתינה או נכשלה)
export function saveNote(S) {
  if (S.saveState === 'failed') return { cls: 'bad', text: 'השמירה האחרונה נכשלה. השינויים האחרונים עלולים לא להיות שמורים.' };
  if (S.saveState === 'local' || (S.sync && S.sync.msg)) return { cls: 'warn', text: 'חלק מהשינויים נשמרו במחשב הזה וממתינים לסנכרון עם Google Drive.' };
  if (S.saveState === 'saving') return { cls: 'warn', text: 'שומר…' };
  return null;
}

export function homeHtml(S, { showAdmin, cloud }) {
  const last = S.exams[0];
  const where = !S.user && cloud ? 'נשמר בדפדפן הזה בלבד' : '';
  const note = last ? saveNote(S) : null;
  const card = (act, icon, title, sub, cls = '') => `<button class="hcard ${cls}" data-home="${act}"><span class="hico">${icon}</span><span class="htxt"><b>${title}</b><span>${sub}</span></span></button>`;
  return `<section class="home" aria-labelledby="hometitle">
    <div class="hero"><h2 id="hometitle">בונה מבחנים במדעי הבריאות</h2>
      <p>בונים מבחן ממאגר שאלות מסודר, מתאימים אותו לכיתה ומפיקים קובץ Word מוכן להדפסה.</p></div>
    <div class="homegrid">
      ${card('new', ICON.plus, 'בניית מבחן חדש', 'מתחילים ממבחן ריק ובוחרים שאלות מהמאגר', 'main')}
      ${last ? card('continue', ICON.resume, 'המשך עבודה על המבחן האחרון',
        `${esc(last.title || 'מבחן ללא שם')} · ${questionsOf(last).length} שאלות · עודכן ${esc(fmtDate(last.updatedAt))}${where ? ' · ' + where : ''}`, 'main2') : ''}
      ${card('exams', ICON.folder, 'המבחנים שלי', S.exams.length ? `${S.exams.length} מבחנים שמורים` : 'עדיין אין מבחנים שמורים')}
      ${card('search', ICON.search, 'חיפוש במאגר השאלות', 'חיפוש וסינון לפי נושא, סוג, שנה ושימוש קודם')}
      ${card('personal', ICON.user, 'המאגר האישי שלי', S.personal.length ? `${S.personal.length} שאלות אישיות` : 'שאלות שכתבתי בעצמי')}
      ${showAdmin ? card('admin', ICON.shield, 'ניהול המאגר', 'ייבוא, עריכה, הצעות ממורים וגיבוי', 'admin') : ''}
    </div>
    ${note ? `<div class="homenote ${note.cls}" role="status">${esc(note.text)}</div>` : ''}
  </section>`;
}

export function examsHtml(S) {
  if (!S.exams.length) return `<section class="card empty"><p>עדיין אין מבחנים שמורים.</p><button class="btn primary" data-home="new">בניית מבחן חדש</button></section>`;
  const list = [...S.exams].sort(S.exSort === 'name' ? (a, b) => (a.title || '').localeCompare(b.title || '', 'he') : (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return `<section aria-labelledby="exlist"><div class="pagehead"><h2 id="exlist">המבחנים שלי</h2><span class="spacer"></span>
    <label class="sortlbl">מיון <select id="exsort" aria-label="מיון המבחנים"><option value="updated" ${S.exSort !== 'name' ? 'selected' : ''}>עודכן לאחרונה</option><option value="name" ${S.exSort === 'name' ? 'selected' : ''}>לפי שם</option></select></label>
    <button class="btn primary" data-home="new">+ מבחן חדש</button></div>
    <p class="hint">לחיצה על כרטיס פותחת את המבחן.</p>
    <div class="exgrid">${list.map(e => `<article class="card excard ${e.id === S.exam?.id ? 'cur' : ''}" data-openexam="${esc(e.id)}">
      <h3>${esc(e.title || 'מבחן ללא שם')}</h3>
      <div class="exmeta">${questionsOf(e).length} שאלות · ${totalPoints(e)} נקודות${e.school ? ' · ' + esc(e.school) : ''}</div>
      <div class="exmeta">עודכן ${esc(fmtDate(e.updatedAt))}</div>
      <div class="exbtns"><button class="btn primary sm" data-openexam="${esc(e.id)}">פתיחה</button><button class="btn sm" data-renex="${esc(e.id)}">שינוי שם</button><button class="btn sm" data-dupex="${esc(e.id)}">שכפול</button><button class="btn sm danger" data-delex="${esc(e.id)}">מחיקה</button></div>
    </article>`).join('')}</div></section>`;
}
