// עריכה קבוצתית של פרטי מקור וסיווג (לוגיקה טהורה; נבדקת ב-scripts/test-admin-bulk.mjs).
// עקרונות: משנים רק שדות שנבחרו במפורש; ערכים קודמים נשמרים ב-sourceHistory (שדה ניהול, לא ציבורי);
// שנה/מועד רק לשאלות בגרות; מחבר רק לשאלות שאינן בגרות; חבילת מקור (pkgId) אינה ניתנת לשינוי כאן.
import { kindOf } from './admin-filters.js';

export const EMPTY_BULK = () => ({ domain: '', type: '', year: '', clearYear: false, session: '', clearSession: false, author: '', clearAuthor: false, authorAdmin: '', clearAuthorAdmin: false });
export const BULK_FIELDS = { domain: 'תחום ראשי', type: 'סוג שאלה', year: 'שנת בחינה', session: 'מועד בחינה', author: 'מחבר השאלה', authorAdmin: 'שיוך מחבר ניהולי' };
const SOURCE = new Set(['year', 'session', 'author', 'authorAdmin']);

// ממיר את טופס העריכה לרשימת שינויים: { field: newValue|null }. ערך לא נבחר לא מופיע.
export function chosen(b) {
  const c = {}, errors = [];
  if (b.domain) c.domain = b.domain;
  if (b.type) c.type = b.type;
  if (b.clearYear) c.year = null; else if (String(b.year).trim() !== '') { const y = Number(b.year); if (Number.isInteger(y) && y >= 1990 && y <= 2100) c.year = y; else errors.push('שנת בחינה לא תקינה (1990–2100)'); }
  if (b.clearSession) c.session = null; else if (String(b.session).trim()) c.session = String(b.session).trim().slice(0, 100);
  if (b.clearAuthor) c.author = null; else if (String(b.author).trim()) c.author = String(b.author).trim().slice(0, 100);
  if (b.clearAuthorAdmin) c.authorAdmin = null; else if (String(b.authorAdmin).trim()) c.authorAdmin = String(b.authorAdmin).trim().slice(0, 100);
  return { changes: c, errors };
}

const cur = (q, f) => (f === 'domain' ? q.domainId : f === 'type' ? q.typeId : q[f]) ?? null;
// מי מהשדות מתאים לשאלה: מונע שיוך שגוי (שנת בגרות לשאלת מורה, מחבר לשאלת בגרות)
function applicable(q, f) {
  const k = kindOf(q);
  if (f === 'year' || f === 'session') return k === 'bagrut' ? '' : 'שנה/מועד בחינה מיועדים לשאלות בגרות בלבד';
  if (f === 'author' || f === 'authorAdmin') return k === 'teacher' ? '' : 'מחבר מיועד לשאלות מורים בלבד';
  return '';
}

// תכנון: אילו שאלות ישתנו ואילו ידולגו ולמה. לא משנה את הקלט.
export function planBulk(qs, changes, taxonomy = {}) {
  const fields = Object.keys(changes);
  const updates = [], skipped = [], noop = [];
  for (const q of qs) {
    const patch = {}, why = [];
    for (const f of fields) {
      const r = applicable(q, f); if (r) { why.push(r); continue; }
      if (f === 'domain' && taxonomy.domains && !taxonomy.domains[changes[f]]) { why.push('תחום לא קיים במילון'); continue; }
      if (cur(q, f) === changes[f]) continue;
      patch[f] = changes[f];
    }
    if (Object.keys(patch).length) updates.push({ q, patch });
    else if (why.length) skipped.push({ q, reason: [...new Set(why)].join('; ') });
    else noop.push(q);
  }
  const kinds = new Set(qs.map(kindOf));
  const warnings = [];
  if (kinds.size > 1 && fields.some(f => SOURCE.has(f))) warnings.push('נבחרו שאלות ממקורות שונים. שנה/מועד יחולו רק על שאלות בגרות, ומחבר רק על שאלות מורים; השאר ידולגו.');
  return { updates, skipped, noop, warnings, fields };
}

// מחיל תיקון על עותק של שאלה (לא משנה את המקור). שדות מקור מתועדים בהיסטוריה עם הערך הקודם.
export function applyPatch(q, patch, now = new Date().toISOString()) {
  const o = JSON.parse(JSON.stringify(q)); const hist = [];
  for (const [f, v] of Object.entries(patch)) {
    const from = cur(q, f);
    if (f === 'domain') { o.adminOrig ||= snapshot(q); o.domainId = v; o.addDomainIds = (o.addDomainIds || []).filter(x => x !== v); o.adminEdited = true; }
    else if (f === 'type') { o.adminOrig ||= snapshot(q); o.typeId = v; o.adminEdited = true; }
    else { if (v === null) delete o[f]; else o[f] = v; }
    hist.push({ at: now, field: f, from, to: v });
  }
  if (hist.length) o.sourceHistory = [...(q.sourceHistory || []), ...hist];
  return o;
}
const snapshot = q => ({ domainId: q.domainId, typeId: q.typeId, addDomainIds: q.addDomainIds, blocks: q.blocks, rubric: q.rubric, title: q.title, points: q.points });

// תיאור קריא של השינויים המתוכננים
export function describe(changes, labels = {}) {
  return Object.entries(changes).map(([f, v]) => `${BULK_FIELDS[f]}: ${v === null ? 'ניקוי הערך' : (labels[f]?.[v] ?? v)}`);
}

// ביצוע עמיד לתקלות: שומר שאלה אחר שאלה; שגיאה בשאלה אחת לא עוצרת את השאר. save מקבל עותק חדש.
export async function runBulk(plan, save, now) {
  const ok = [], failed = [];
  for (const { q, patch } of plan.updates) {
    const next = applyPatch(q, patch, now);
    try { await save(next); ok.push(next); } catch (e) { failed.push({ q, error: e.code || e.message }); }
  }
  return { ok, failed };
}
