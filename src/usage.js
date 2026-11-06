// סימון שאלות ש"כבר השתמשתי בהן" (אישי לכל מורה; נשמר ב-Drive האישי, לא במאגר המרכזי).
//
// מודל: נגזר ממבחנים שמורים + רשימת חריגים ידנית.
//   מבחנים שמורים -> כל שאלה שמופיעה בהם נחשבת "בשימוש" אוטומטית (לפי מזהה השאלה המקורי snap.uid, לא לפי טקסט).
//   usage.m = { [uid]: [flag, at] }  flag 1 = המורה סימן ידנית "השתמשתי"; flag 0 = המורה ביטל סימון ידנית; flag 2 = ללא עקיפה (חריג 0 שנוקה).
//   שימוש בפועל: flag 1  או  (אין flag 0 ושאלה נמצאת במבחן שמור).
// מחיקת מבחן: שאלה שאינה באף מבחן שמור חוזרת אוטומטית ל"לא השתמשתי", אלא אם סומנה ידנית.
// חריג 0 נשמר רק כל עוד השאלה במבחן שמור (reconcile) – אחרת מבחן חדש שיכלול אותה לא היה מסומן לעולם.
// מיזוג בין מחשבים/חלונות: לכל שאלה נבחר הרישום עם הזמן המאוחר יותר (כך סימונים שונים משני חלונות לא דורסים זה את זה).
export const emptyUsage = () => ({ v: 1, m: {} });

const isDraft = u => !u || String(u).startsWith('draft-');

// קבוצת מזהי שאלות שמופיעות במבחנים שמורים
export function savedUids(exams) {
  const s = new Set();
  for (const ex of exams || []) for (const it of ex.items || []) { const u = it.snap?.uid; if (!isDraft(u)) s.add(u); }
  return s;
}

export function normalizeUsage(u) {
  const out = emptyUsage();
  if (u && typeof u === 'object' && u.m && typeof u.m === 'object') {
    for (const [k, v] of Object.entries(u.m)) if (Array.isArray(v) && (v[0] === 0 || v[0] === 1 || v[0] === 2) && Number.isFinite(v[1])) out.m[k] = [v[0], v[1]];
  }
  return out;
}

export function mergeUsage(a, b) {
  const x = normalizeUsage(a), y = normalizeUsage(b), out = emptyUsage();
  for (const k of new Set([...Object.keys(x.m), ...Object.keys(y.m)])) {
    const p = x.m[k], q = y.m[k];
    out.m[k] = !p ? q : !q ? p : (q[1] > p[1] ? q : p);
  }
  return out;
}

// 'used' = שימוש שנשמר (מבחן שמור או סימון ידני);  'unused' = אחרת
export function isUsed(usage, saved, uid) {
  const f = usage?.m?.[uid];
  if (f && f[0] === 1) return true;
  if (f && f[0] === 0) return false;
  return saved.has(uid);
}
// מקור הסימון, להצגה: 'manual' | 'exam' | null
export function usedSource(usage, saved, uid) {
  const f = usage?.m?.[uid];
  if (f && f[0] === 1) return 'manual';
  if (f && f[0] === 0) return null;
  return saved.has(uid) ? 'exam' : null;
}

// קביעה ידנית. מחזיר usage חדש (לא משנה את המקור). now ניתן להזרקה לבדיקות.
export function setManual(usage, saved, uid, used, now = Date.now()) {
  const u = normalizeUsage(usage);
  // ביטול סימון נרשם תמיד כ-0 עם זמן (כדי שיעבור מיזוג בין מחשבים); reconcile מנקה אותו כשהשאלה אינה במבחן שמור
  u.m[uid] = [used ? 1 : 0, now];
  return u;
}

// ניקוי חריגי 0 של שאלות שכבר אינן באף מבחן שמור. מחזיר { usage, changed }.
export function reconcile(usage, saved, now = Date.now()) {
  const u = normalizeUsage(usage); let changed = false;
  // לא מוחקים (מחיקה לא עוברת מיזוג בין מחשבים) אלא רושמים 2 עם זמן חדש
  for (const [k, f] of Object.entries(u.m)) if (f[0] === 0 && !saved.has(k)) { u.m[k] = [2, now]; changed = true; }
  return { usage: u, changed };
}
