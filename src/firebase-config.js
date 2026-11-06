// הגדרות Firebase הציבוריות של האתר (web app config). הערכים האלה גלויים בכל אתר Firebase ואינם סוד;
// האבטחה נשענת על כללי Firestore (firestore.rules) ולא על הסתרת המפתח.
// אם apiKey ריק האתר רץ במצב מקומי בלבד (IndexedDB), בלי חיבור לענן.
export const firebaseConfig = {
  apiKey: 'AIzaSyClcmN30cUYb0lyhnkSADQ9w0OCywpqo7w',
  authDomain: 'urony-exam-builder.firebaseapp.com',
  projectId: 'urony-exam-builder',
  appId: '1:362378664413:web:4980e4475c6883549fbe34',
};

export const cloudConfigured = () => !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
