// מסנני ניהול שאלות (לוגיקה טהורה, נבדקת ב-scripts/test-admin-filters.mjs).
// כל הערכים נגזרים מהנתונים המובנים של השאלה, לא משם קובץ ולא מניחוש לפי כותרת.
export const EMPTY_FILTERS = () => ({ text: '', status: 'all', kind: '', year: '', session: '', domain: '', type: '', teacher: '', pkg: '' });

export const isPub = q => q.published !== false;
export const NO_YEAR = 'none', NO_SESSION = 'none', UNKNOWN_AUTHOR = '?', UNKNOWN_KIND = 'unknown';

// שנת בחינה: רק מספר תקין משדה year המובנה. אחרת null (שאלות מורים לא משויכות בטעות לשנה).
export function yearOf(q) { const y = Number(q.year); return Number.isInteger(y) && y > 1900 && y < 2200 ? y : null; }
// סוג מקור אמיתי: bagrut / teacher. כל ערך אחר (חסר, לא מוכר) הוא unknown ומטופל במפורש.
export const kindOf = q => (q.kind === 'bagrut' || q.kind === 'teacher' ? q.kind : UNKNOWN_KIND);
// מחבר: שיוך ידני של מנהל > מחבר מחבילת ZIP > קרדיט שאושר להצעה. חסר = null (לא ממציאים שם).
export const authorOf = q => (q.authorAdmin || q.author || (typeof q.credit === 'string' && q.credit) || '').trim() || null;
// המורה שהגיש דרך האתר (שונה מהמחבר ומהמנהל שביצע ייבוא טכני).
export const submitterOf = q => (q.submitterUid ? { uid: q.submitterUid, name: (q.submitterName || '').trim() } : null);
export const submitterLabel = s => s.name || 'מורה ' + String(s.uid).slice(-4);

// ערך מסנן מורה: a:<שם מחבר> | s:<uid מגיש> | ? (מחבר לא ידוע, שאלות שאינן בגרות)
export function teacherMatches(q, v) {
  if (!v) return true;
  if (v === UNKNOWN_AUTHOR) return kindOf(q) !== 'bagrut' && !authorOf(q);
  if (v.startsWith('a:')) return authorOf(q) === v.slice(2);
  if (v.startsWith('s:')) return submitterOf(q)?.uid === v.slice(2);
  return true;
}

const norm = s => String(s || '').toLowerCase();
export function applyFilters(qs, f, ix = new Map()) {
  const words = norm(f.text).trim().split(/\s+/).filter(Boolean);
  return qs.filter(q => {
    if (f.status === 'published' && !isPub(q)) return false;
    if (f.status === 'hidden' && isPub(q)) return false;
    if (f.status === 'flag' && !q.reviewFlag) return false;
    if (f.status === 'edited' && !q.adminEdited) return false;
    if (f.kind && kindOf(q) !== f.kind) return false;
    if (f.year) { const y = yearOf(q); if (f.year === NO_YEAR ? y !== null : String(y) !== f.year) return false; }
    if (f.session) { const s = q.session || null; if (f.session === NO_SESSION ? s !== null : s !== f.session) return false; }
    if (f.domain && q.domainId !== f.domain) return false;
    if (f.type && q.typeId !== f.type) return false;
    if (f.pkg && q.pkgId !== f.pkg) return false;
    if (!teacherMatches(q, f.teacher)) return false;
    if (words.length) {
      let e = ix.get(q.uid); if (!e || e.raw !== q.searchText) { e = { raw: q.searchText, low: norm(q.searchText) }; ix.set(q.uid, e); }
      for (const w of words) if (!e.low.includes(w)) return false;
    }
    return true;
  });
}

// ערכים קיימים בפועל במאגר (לבחירה ללא הקלדה).
export function facets(qs) {
  const years = new Map(), sessions = new Map(), authors = new Map(), subs = new Map(); const kinds = new Set(); let noYear = 0, unknownAuthor = 0;
  for (const q of qs) {
    kinds.add(kindOf(q));
    const y = yearOf(q); if (y === null) noYear++; else years.set(y, (years.get(y) || 0) + 1);
    const a = authorOf(q); if (a) authors.set(a, (authors.get(a) || 0) + 1); else if (kindOf(q) !== 'bagrut') unknownAuthor++;
    const s = submitterOf(q); if (s) { const e = subs.get(s.uid) || { ...s, n: 0 }; e.n++; if (!e.name && s.name) e.name = s.name; subs.set(s.uid, e); }
  }
  return {
    years: [...years].sort((a, b) => b[0] - a[0]), noYear, kinds, unknownAuthor,
    authors: [...authors].sort((a, b) => a[0].localeCompare(b[0], 'he')),
    submitters: [...subs.values()].sort((a, b) => submitterLabel(a).localeCompare(submitterLabel(b), 'he')),
  };
}
// מועדים בתוך קבוצת שאלות (מוצג רק כשיש יותר ממועד אחד באותה שנה).
export function sessionsOf(qs) { const m = new Map(); for (const q of qs) { const s = q.session || NO_SESSION; m.set(s, (m.get(s) || 0) + 1); } return [...m]; }

export function activeCount(f) { const d = EMPTY_FILTERS(); return Object.keys(d).filter(k => f[k] !== d[k]).length; }

// תוויות חבילה לבחירה: שם קובץ/כותרת, שנה. חבילות "approved" (הצעות שאושרו) מוצגות בנפרד.
export function packageOptions(packages, qs) {
  const count = new Map(); for (const q of qs) count.set(q.pkgId, (count.get(q.pkgId) || 0) + 1);
  const out = packages.filter(p => count.has(p.id)).map(p => ({ id: p.id, label: [p.title || p.fileName || p.id, p.year, p.session].filter(Boolean).join(' · '), n: count.get(p.id) }));
  for (const [id, n] of count) if (!out.some(o => o.id === id)) out.push({ id, label: id === 'approved' ? 'הצעות מורים שאושרו' : id, n });
  return out.sort((a, b) => a.label.localeCompare(b.label, 'he'));
}

// סוג המחוון: text / image / both / none (לפי תוכן התשובה בפועל)
export function rubricKind(q) {
  const a = q.rubric?.answer || [];
  const txt = a.some(b => (b.text && String(b.text).trim()) || b.rows), img = a.some(b => b.mediaKey);
  return txt && img ? 'both' : img ? 'image' : txt ? 'text' : (q.rubric?.notes ? 'text' : 'none');
}
export const RUBRIC_LABEL = { text: 'מחוון: טקסט', image: 'מחוון: תמונה סרוקה', both: 'מחוון: טקסט + תמונה', none: 'ללא מחוון' };
