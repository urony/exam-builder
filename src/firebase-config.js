// הגדרות Firebase הציבוריות של האתר (web app config). הערכים האלה גלויים בכל אתר Firebase ואינם סוד;
// האבטחה נשענת על כללי Firestore (firestore.rules) ולא על הסתרת המפתח.
// עד שהערכים יוזנו (apiKey ריק) האתר רץ במצב מקומי בלבד (IndexedDB), בלי חיבור לענן.
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};

export const cloudConfigured = () => !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
