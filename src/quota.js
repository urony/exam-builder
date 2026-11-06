// מכסות הגשת הצעות למאגר המרכזי. האכיפה האמיתית בכללי Firestore (firestore.rules, מסמך suggestionQuota/{uid});
// כאן רק הקבועים, בדיקה מקדימה ידידותית בדפדפן והודעת המכסה. בדיקה בדפדפן לבדה אינה הגנה.
export const LIMITS = { pending: 50, imagesPerSuggestion: 3, imagesTotal: 30, imageBytes: 2 * 1024 * 1024 };
export const ADMIN_CONTACT = 'urony@hotmail.com';

// מצב נוכחי של המורה מתוך ההצעות שלו: רק הצעות ממתינות נספרות (מאושרות ונדחות לא).
export function quotaUsage(suggestions) {
  const pending = (suggestions || []).filter(s => s.status === 'pending');
  return { pending: pending.length, images: pending.reduce((a, s) => a + (s.imageKeys?.length || 0), 0) };
}

// בדיקה מקדימה לפני שליחה: מחזיר null אם אפשר, או { code, text } עם הסבר ידידותי.
export function checkQuota(suggestions, { imageKeys = [], imageSizes = [] } = {}) {
  const u = quotaUsage(suggestions);
  if (u.pending >= LIMITS.pending) return { code: 'quota-pending', text: `יש לך כבר ${u.pending} הצעות הממתינות לבדיקה (המכסה היא ${LIMITS.pending}).` };
  if (imageKeys.length > LIMITS.imagesPerSuggestion) return { code: 'quota-images-per', text: `אפשר לצרף עד ${LIMITS.imagesPerSuggestion} תמונות לכל הצעה (בשאלה הזאת יש ${imageKeys.length}).` };
  if (u.images + imageKeys.length > LIMITS.imagesTotal) return { code: 'quota-images', text: `בהצעות הממתינות שלך כבר יש ${u.images} תמונות (המכסה היא ${LIMITS.imagesTotal}).` };
  const big = imageSizes.findIndex(n => n > LIMITS.imageBytes);
  if (big >= 0) return { code: 'quota-image-size', text: `אחת התמונות גדולה מ־${LIMITS.imageBytes / 1024 / 1024}MB. אפשר להקטין אותה ולנסות שוב.` };
  return null;
}

// נוסח ההודעה למורה שהגיע למכסה (HTML בטוח: הטקסט הדינמי עובר escape ע"י הקורא)
export const QUOTA_NOTE = `ניתן להגיש עד ${LIMITS.pending} הצעות שאלות הממתינות לבדיקה, ולצרף תמונות בהתאם למגבלות ההעלאה. לאחר שההצעות ייבדקו, אפשר יהיה להגיש הצעות נוספות.`;
export const QUOTA_MORE = 'רוצה לשלוח כמות גדולה יותר של שאלות או תמונות? אפשר לפנות למנהל המאגר כדי לתאם העלאה מרוכזת.';
