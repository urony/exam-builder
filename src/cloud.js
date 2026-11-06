// חיבור ל-Firebase (התחברות Google + Firestore). נטען עצלתית: במצב מקומי (בלי הגדרות) לא נטען דבר.
// ההתחברות מבקשת גם את ההרשאה drive.appdata (תיקיית אפליקציה מוסתרת ב-Drive של המורה, ללא גישה לשאר הקבצים).
import { firebaseConfig, cloudConfigured } from './firebase-config.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

let _fb = null;
async function fb() {
  if (!cloudConfigured()) throw new Error('Firebase לא מוגדר (src/firebase-config.js ריק)');
  if (_fb) return _fb;
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('firebase/firestore'),
  ]);
  const app = initializeApp(firebaseConfig);
  _fb = { app, auth, fs, a: auth.getAuth(app), db: fs.getFirestore(app) };
  return _fb;
}

let driveToken = null; // access token של Drive: בזיכרון בלבד, תקף כשעה

export async function signIn() {
  const { auth, a } = await fb();
  const provider = new auth.GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);
  const res = await auth.signInWithPopup(a, provider);
  driveToken = auth.GoogleAuthProvider.credentialFromResult(res)?.accessToken || null;
  return { uid: res.user.uid, name: res.user.displayName || '', hasDrive: !!driveToken };
}

export async function signOut() {
  const { auth, a } = await fb();
  driveToken = null;
  await auth.signOut(a);
}

export const getDriveToken = () => driveToken;

export async function isAdmin() {
  const { fs, db, a } = await fb();
  if (!a.currentUser) return false;
  try { return (await fs.getDoc(fs.doc(db, 'admins', a.currentUser.uid))).exists(); } catch { return false; }
}

export async function firestore() { const { fs, db } = await fb(); return { fs, db }; }
