// מימוש ענן של חוזה store.js.
//   אישי (מבחנים, שאלות אישיות, תמונות של מורה) -> Google Drive appData של המורה (עם תור שמירה ממתין, ראו outbox.js)
//   מרכזי (שאלות, מקרים, חבילות, מילונים, איורים) -> Firestore: bank/meta, bank/q-NNN, bank/c-NNN, bankMedia/*
//   הצעות -> Firestore: suggestions/*, suggestionMedia/*;  יומן פעולות מנהל -> audit/*
// למה JSON בתוך שדה טקסט: Firestore אוסר מערכים מקוננים (טבלאות בשאלות הן מערך של מערכים).
// הרשאות נאכפות רק בכללי Firestore (firestore.rules); בדיקות isAdmin כאן הן נוחות לממשק ולא אבטחה.
const enc = new TextEncoder();
const strip = o => JSON.parse(JSON.stringify(o));
const sizeOf = o => enc.encode(JSON.stringify(o)).length;
const MAX_CHUNK_BYTES = 600_000, MAX_CHUNK_COUNT = 60, PART_BYTES = 700_000, MAX_JSON = 900_000;
const BATCH_OPS = 100, BATCH_BYTES = 5_000_000;

export async function hashKey(key) {
  const d = await crypto.subtle.digest('SHA-1', enc.encode(key));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
const mediaName = key => 'img-' + key.replace(/[^\w.-]/g, '_');
const tmpl = (code, msg) => Object.assign(new Error(msg), { code });
const isUser = key => String(key).startsWith('user/');

// מפתחות מדיה של משתמש בתוך שאלה (בלוקים ומחוון)
export function userMediaKeys(q) {
  const keys = new Set();
  for (const b of q.blocks || []) if (b.mediaKey && isUser(b.mediaKey)) keys.add(b.mediaKey);
  for (const b of q.rubric?.answer || []) if (b.mediaKey && isUser(b.mediaKey)) keys.add(b.mediaKey);
  for (const im of q.images || []) if (im.key && isUser(im.key)) keys.add(im.key);
  return [...keys];
}

// מבנה מסמך הצעה (משותף ללקוח ולבדיקות הכללים)
export function suggestionDoc(q, { uid, credit = false, authorName = '', tag, now = Date.now() }) {
  const json = JSON.stringify(q);
  if (enc.encode(json).length > MAX_JSON) throw tmpl('too-large', 'השאלה גדולה מדי לשליחה');
  return { id: 'sg-' + q.uid, status: 'pending', authorUid: uid, credit: !!credit, authorName: credit ? String(authorName).slice(0, 100) : '', submittedAt: now, questionJson: json, imageKeys: userMediaKeys(q), mediaTag: tag };
}
const fromSuggestionDoc = d => { const { questionJson, ...rest } = d; return { ...rest, question: JSON.parse(questionJson) }; };
const toSuggestionDoc = s => { const { question, ...rest } = s; return strip({ ...rest, questionJson: JSON.stringify(question) }); };

export function createCloudStore({ drive, firestore, uid, isAdmin = false, local, outbox, mediaCache, driveEnabled = true, onSyncError = () => {} }) {
  let st = null; // מצב המאגר המרכזי כפי שנקרא: { meta, q: Map<chunkId, items[]>, c: Map<chunkId, items[]>, qIdx, cIdx, media: Map<key, {id,parts,size}> }
  const needAdmin = () => { if (!isAdmin) throw tmpl('not-admin', 'פעולה זו מותרת למנהל בלבד'); };

  // ---------------- Firestore: עזרים ----------------
  async function commit(ops) {
    const { fs, db } = await firestore();
    let batch = fs.writeBatch(db), n = 0, bytes = 0;
    const flush = async () => { if (n) { await batch.commit(); batch = fs.writeBatch(db); n = 0; bytes = 0; } };
    for (const o of ops) {
      const ref = fs.doc(db, o.col, o.id);
      if (n >= BATCH_OPS || bytes + (o.bytes || 1000) > BATCH_BYTES) await flush();
      if (o.type === 'set') batch.set(ref, o.data); else if (o.type === 'update') batch.update(ref, o.data); else batch.delete(ref);
      n++; bytes += o.bytes || 1000;
    }
    await flush();
  }
  async function audit(action, target, detail = '') {
    try {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(fs.collection(db, 'audit')), { by: uid, at: Date.now(), action, target: String(target || ''), detail: String(detail).slice(0, 500) });
    } catch (e) { onSyncError({ where: 'audit', error: e }); }
  }

  // ---------------- המאגר המרכזי: קריאה ----------------
  // הפרדת הרשאות (אבטחה אמיתית, לא סינון בממשק):
  //   תוכן מפורסם  -> bank/{q-NNN,c-NNN,meta} ו-bankMedia עם pub=true  (קריאה לכל מורה מחובר)
  //   תוכן מוסתר   -> bankPrivate/{qh-NNN,ch-NNN,meta} ו-bankMedia עם pub=false  (מנהל בלבד, נאכף בכללים)
  // שאלה מוסתרת היא כל שאלה עם published===false. סיפור מקרה/איור ציבוריים רק אם שאלה מפורסמת משתמשת בהם (reconcile).
  const isPubQ = q => q.published !== false;
  const privChunk = id => id[1] === 'h';
  const colOf = id => (privChunk(id) ? 'bankPrivate' : 'bank');
  // שדות ניהול פנימיים: לא נכתבים לעותק הציבורי של שאלה. נשמרים ב-bankPrivate/adm (מנהל בלבד) וממוזגים בקריאה של מנהל.
  const ADM_FIELDS = ['reviewFlag', 'conflictNote', 'adminEdited', 'fromSuggestion', 'approvedAt', 'author', 'authorAdmin', 'submitterUid', 'submitterName', 'sourceHistory'];
  const pubView = it => { const o = { ...it }; for (const f of ADM_FIELDS) delete o[f]; return o; };
  const dirty = new Set();                                  // חבילות ששונו ממתינות לכתיבה
  const mkSt = (meta, q, c, privMedia = []) => {
    const idx = m => { const r = new Map(); for (const [id, items] of m) for (const it of items) r.set(it.uid, id); return r; };
    const media = new Map(); for (const m of meta.media) media.set(m.key, { ...m, pub: true }); for (const m of privMedia) media.set(m.key, { ...m, pub: false });
    return { meta, q, c, qIdx: idx(q), cIdx: idx(c), media };
  };
  async function readCentral() {
    const { fs, db } = await firestore();
    const meta = { rev: 0, packages: [], taxonomy: { domains: {}, types: {} }, media: [] };
    const q = new Map(), c = new Map(); let privMedia = []; const admBase = new Map(), adm = {}; const raw = new Map(); let metaRev = 0;
    const take = (snap, isPriv) => {
      for (const d of snap.docs) {
        const v = d.data();
        if (d.id === 'meta') { if (isPriv) privMedia = JSON.parse(v.json).media || []; else { Object.assign(meta, JSON.parse(v.json)); metaRev = meta.rev || 0; } }
        else if (isPriv && (d.id === 'adm' || d.id.startsWith('adm-'))) { admBase.set(d.id, v.json); }   // 'adm' = פורמט ישן (מסמך אחד), 'adm-<chunk>' = לפי חבילת שאלות
        else if (d.id.startsWith('q')) { q.set(d.id, JSON.parse(v.json)); raw.set(d.id, v.json); }
        else if (d.id.startsWith('c')) { c.set(d.id, JSON.parse(v.json)); raw.set(d.id, v.json); }
      }
    };
    take(await fs.getDocs(fs.collection(db, 'bank')), false);
    if (isAdmin) take(await fs.getDocs(fs.collection(db, 'bankPrivate')), true);   // מורה לא מנסה לקרוא (ייחסם בכללים)
    dirty.clear();
    for (const id of [...admBase.keys()].sort((a, b) => (a === 'adm' ? -1 : b === 'adm' ? 1 : a < b ? -1 : 1))) Object.assign(adm, JSON.parse(admBase.get(id)));   // הישן קודם; פורמט חדש גובר
    for (const [id, items] of q) if (!privChunk(id)) for (const it of items) if (adm[it.uid]) Object.assign(it, adm[it.uid]);
    st = mkSt(meta, q, c, privMedia); st.admBase = admBase; st.raw = raw; st.metaRev = metaRev;
    return st;
  }
  const ensure = async () => st || readCentral();

  // meta ציבורי: רשימת איורים ציבוריים בלבד. meta פרטי: איורים מוסתרים.
  const metaOps = () => {
    st.meta.rev = (st.meta.rev || 0) + 1;
    const all = [...st.media.values()].map(({ pub, ...m }) => ({ m, pub }));
    st.meta.media = all.filter(x => x.pub).map(x => x.m);
    const json = JSON.stringify(st.meta), pj = JSON.stringify({ media: all.filter(x => !x.pub).map(x => x.m) });
    if (enc.encode(json).length > MAX_JSON || enc.encode(pj).length > MAX_JSON) throw tmpl('too-large', 'מסמך ה-meta של המאגר גדול מדי');
    return [
      { type: 'set', col: 'bank', id: 'meta', data: { kind: 'meta', rev: st.meta.rev, json }, bytes: json.length },
      { type: 'set', col: 'bankPrivate', id: 'meta', data: { kind: 'meta', json: pj }, bytes: pj.length },
    ];
  };
  const chunkOp = id => {
    const prefix = id[0], items = (prefix === 'q' ? st.q : st.c).get(id);
    if (!items || !items.length) return { type: 'delete', col: colOf(id), id };
    const json = JSON.stringify(prefix === 'q' && !privChunk(id) ? items.map(pubView) : items);
    if (enc.encode(json).length > MAX_JSON) throw tmpl('too-large', 'חבילת שאלות גדולה מדי');
    return { type: 'set', col: colOf(id), id, data: { kind: prefix === 'q' ? 'questions' : 'cases', n: items.length, json }, bytes: json.length };
  };
  // שדות הניהול של שאלות ציבוריות: מסמך לכל חבילת שאלות (bankPrivate/adm-q-NNN), כדי שלא יגדלו מעבר למגבלת המסמך.
  // פורמט ישן: מסמך יחיד 'adm'. נקרא כרגיל, ובכתיבה הראשונה מועבר לפורמט החדש והישן נמחק (באותה כתיבה).
  const admOp = () => {
    const want = new Map();
    for (const [id, items] of st.q) if (!privChunk(id)) {
      const m = {};
      for (const it of items) { const f = {}; for (const k of ADM_FIELDS) if (it[k] !== undefined) f[k] = it[k]; if (Object.keys(f).length) m[it.uid] = f; }
      if (Object.keys(m).length) { const json = JSON.stringify(m); if (enc.encode(json).length > MAX_JSON) throw tmpl('too-large', 'שדות הניהול של חבילת שאלות גדולים מדי'); want.set('adm-' + id, json); }
    }
    const ops = [];
    for (const [id, json] of want) if (st.admBase.get(id) !== json) ops.push({ type: 'set', col: 'bankPrivate', id, data: { kind: 'adm', json }, bytes: json.length });
    for (const id of st.admBase.keys()) if (!want.has(id)) ops.push({ type: 'delete', col: 'bankPrivate', id });
    return ops;
  };
  const peekOps = () => [...dirty].map(chunkOp);   // בדיקת עדכניות לפני כתיבת איורים (מונע איורים יתומים בקונפליקט)
  const dirtyOps = () => { const ops = [...dirty].map(chunkOp); dirty.clear(); return ops; };
  // מציב פריט בחבילה של הקבוצה המתאימה (priv=true -> bankPrivate). קיים באותה קבוצה -> מוחלף במקומו; עבר קבוצה -> מוסר מהישנה.
  function place(prefix, item, priv = false) {
    const chunks = prefix === 'q' ? st.q : st.c, idx = prefix === 'q' ? st.qIdx : st.cIdx;
    const have = idx.get(item.uid);
    if (have && privChunk(have) === priv) { const arr = chunks.get(have); arr[arr.findIndex(x => x.uid === item.uid)] = item; dirty.add(have); return have; }
    if (have) unplace(prefix, item.uid);
    const group = prefix + (priv ? 'h-' : '-');
    const ids = [...chunks.keys()].filter(i => i.startsWith(group)).sort();
    let target = ids[ids.length - 1];
    if (!target || chunks.get(target).length >= MAX_CHUNK_COUNT || sizeOf(chunks.get(target)) + sizeOf(item) > MAX_CHUNK_BYTES) {
      target = group + String(ids.length ? Math.max(...ids.map(i => Number(i.slice(group.length)))) + 1 : 0).padStart(3, '0');
      chunks.set(target, []);
    }
    chunks.get(target).push(item); idx.set(item.uid, target); dirty.add(target);
    return target;
  }
  function unplace(prefix, uidv) {
    const chunks = prefix === 'q' ? st.q : st.c, idx = prefix === 'q' ? st.qIdx : st.cIdx;
    const id = idx.get(uidv); if (!id) return null;
    chunks.set(id, chunks.get(id).filter(x => x.uid !== uidv)); idx.delete(uidv); dirty.add(id);
    return id;
  }
  const dropEmpty = prefix => { const m = prefix === 'q' ? st.q : st.c; for (const [id, a] of m) if (!a.length) m.delete(id); };
  // מיישב נראות: סיפורי מקרה ואיורים ציבוריים רק אם שאלה מפורסמת משתמשת בהם. מחזיר פעולות עדכון לדגל pub של האיורים.
  function reconcile() {
    const pubQ = [...st.q.values()].flat().filter(isPubQ);
    const keysOf = bl => (bl || []).map(b => b.mediaKey).filter(Boolean);
    const pubCases = new Set(pubQ.map(q => q.caseStudyId).filter(Boolean));
    const pubMedia = new Set(pubQ.flatMap(q => [...keysOf(q.blocks), ...keysOf(q.rubric?.answer)]));
    for (const c of [...st.c.values()].flat()) {
      const pubC = pubCases.has(c.uid);
      if (pubC) keysOf(c.blocks).forEach(k => pubMedia.add(k));
      if (privChunk(st.cIdx.get(c.uid)) === pubC) place('c', c, !pubC);
    }
    const ops = []; let media = false;
    for (const m of st.media.values()) {
      const want = pubMedia.has(m.key);
      if (!!m.pub !== want) { m.pub = want; media = true; for (let p = 0; p < m.parts; p++) ops.push({ type: 'update', col: 'bankMedia', id: `${m.id}-${p}`, data: { pub: want }, bytes: 100 }); }
    }
    return { ops, media };
  }
  // כתיבת כל השינויים הממתינים: חבילות ששונו + דגלי איורים (+ meta אם נראות איור השתנתה או נדרש במפורש)
  // הגנה מפני דריסה: אם מישהו אחר (לשונית אחרת / מנהל אחר) שינה חבילה או meta מאז שנטענו, לא כותבים מעל. זורקים 'conflict' וצריך לטעון מחדש.
  // לא אטומי לחלוטין (חלון של מילישניות בין הבדיקה לכתיבה), אבל מצמצם את הסיכון מ"כל משך ההפעלה" לרגע הכתיבה.
  async function guard(ops) {
    if (st.force) return;
    const { fs, db } = await firestore(); const stale = [];
    for (const o of ops) {
      if (o.type === 'set' && o.col === 'bankMedia') continue;
      const isChunk = /^(q|c)h?-/.test(o.id) && (o.col === 'bank' || o.col === 'bankPrivate');
      const isAdm = o.col === 'bankPrivate' && (o.id === 'adm' || o.id.startsWith('adm-')), isMeta = o.col === 'bank' && o.id === 'meta';
      if (!isChunk && !isAdm && !isMeta) continue;
      const s = await fs.getDoc(fs.doc(db, o.col, o.id)); const cur = s.exists() ? s.data() : null;
      if (isMeta) { if ((cur ? cur.rev || 0 : 0) !== (st.metaRev || 0)) stale.push('meta'); }
      else if (isAdm) { if ((cur ? cur.json : null) !== (st.admBase.get(o.id) ?? null)) stale.push(o.id); }
      else if ((cur ? cur.json : null) !== (st.raw.get(o.id) ?? null)) stale.push(o.id);
    }
    if (stale.length) { st = null; throw tmpl('conflict', 'המאגר המרכזי שונה בינתיים במקום אחר (לשונית או מנהל אחר). לא נשמר דבר כדי לא לדרוס שינויים. טען מחדש ונסה שוב.'); }
  }
  const noteWritten = ops => { for (const o of ops) { if (o.col === 'bankMedia') continue; if (o.id === 'adm' || o.id.startsWith('adm-')) { if (o.type === 'set') st.admBase.set(o.id, o.data.json); else st.admBase.delete(o.id); } else if (o.id === 'meta' && o.col === 'bank') st.metaRev = o.data.rev; else if (/^(q|c)h?-/.test(o.id)) { if (o.type === 'set') st.raw.set(o.id, o.data.json); else st.raw.delete(o.id); } } };
  async function persist({ withMeta = false } = {}) {
    const r = reconcile(); const ops = [...dirtyOps(), ...r.ops, ...admOp()];
    await guard(ops); await commit(ops); noteWritten(ops); dropEmpty('q'); dropEmpty('c');
    if (withMeta || r.media) { const m = metaOps(); await guard(m); await commit(m); noteWritten(m); }
  }

  // ---------------- איורי המאגר המרכזי ----------------
  async function mediaOps(key, data) {
    const h = await hashKey(key); const parts = Math.max(1, Math.ceil(data.length / PART_BYTES));
    const { fs } = await firestore(); const ops = [];
    for (let i = 0; i < parts; i++) {
      const slice = data.subarray(i * PART_BYTES, (i + 1) * PART_BYTES);
      ops.push({ type: 'set', col: 'bankMedia', id: `${h}-${i}`, data: { key, part: i, parts, size: data.length, pub: false, data: fs.Bytes.fromUint8Array(slice) }, bytes: slice.length + 200 });
    }
    st.media.set(key, { key, id: h, parts, size: data.length, pub: false });   // פרטי כברירת מחדל; reconcile מפרסם רק איור שמשתמשת בו שאלה מפורסמת
    return ops;
  }
  const mediaDeleteOps = key => {
    const m = st.media.get(key); if (!m) return [];
    st.media.delete(key);
    return Array.from({ length: m.parts }, (_, i) => ({ type: 'delete', col: 'bankMedia', id: `${m.id}-${i}` }));
  };

  async function fetchParts(col, ids) {
    const { fs, db } = await firestore();
    const out = [];
    for (const id of ids) {
      const s = await fs.getDoc(fs.doc(db, col, id));
      if (!s.exists()) return null;
      out.push(s.data().data.toUint8Array());
    }
    const total = out.reduce((a, b) => a + b.length, 0), r = new Uint8Array(total); let o = 0;
    for (const p of out) { r.set(p, o); o += p.length; }
    return r;
  }

  // ---------------- תור שמירה ממתין (Drive אישי) ----------------
  const OB = { exam: id => 'exam:' + id, pq: u => 'pq:' + u, media: k => 'media:' + k, delExam: id => 'del-exam:' + id, delPq: u => 'del-pq:' + u };
  async function runOutboxEntry(key, val) {
    if (key.startsWith('exam:')) {
      // לא דורסים גרסה חדשה יותר שנשמרה בינתיים (למשל ממחשב אחר)
      const cur = await drive.getJson(`exam-${val.id}.json`);
      if (!cur || (cur.updatedAt || 0) <= (val.updatedAt || 0)) await drive.putJson(`exam-${val.id}.json`, val);
    }
    else if (key.startsWith('pq:')) await drive.putJson(`pq-${val.uid}.json`, val);
    else if (key.startsWith('media:')) await drive.putBytes(mediaName(key.slice(6)), val, val[0] === 0x89 ? 'image/png' : 'image/jpeg');
    else if (key.startsWith('del-exam:')) await drive.remove(`exam-${key.slice(9)}.json`);
    else if (key.startsWith('del-pq:')) await drive.remove(`pq-${key.slice(7)}.json`);
  }
  async function flush() {
    const keys = await outbox.keys(); let failed = 0;
    for (const k of keys) {
      const val = await outbox.get(k);
      try { await runOutboxEntry(k, val); await outbox.del(k); } catch (e) { failed++; if (e.status === 401 || e.status === 403) break; }
    }
    return { pending: (await outbox.keys()).length, failed };
  }
  // כתיבה בטוחה: קודם נרשם בתור (במחשב), אחר כך נשלח ל-Drive, ורק בהצלחה נמחק מהתור
  async function safe(key, val) {
    await outbox.put(key, val);
    try { await runOutboxEntry(key, val); await outbox.del(key); }
    catch (e) { throw Object.assign(tmpl('sync-pending', 'השמירה בענן נכשלה. הנתונים נשמרו במחשב וימתינו לסנכרון.'), { cause: e }); }
  }

  // קריאת קובצי Drive: קובץ פגום/לא תקין מדולג ומדווח (ואינו נמחק), ואינו מפיל את שאר המבחנים. שגיאות רשת/הרשאה ממשיכות להיזרק.
  async function readFiles(prefix, valid) {
    const files = await drive.list(prefix); const out = [];
    await Promise.all(files.map(async f => {
      try { const v = await drive.getJson(f.name); if (v == null) return; if (!valid(v)) throw new SyntaxError('מבנה קובץ לא תקין: ' + f.name); out.push(v); }
      catch (e) { if (e instanceof SyntaxError) onSyncError({ where: 'drive-corrupt', error: e, file: f.name }); else throw e; }
    }));
    return out;
  }
  const validExam = v => v && typeof v === 'object' && typeof v.id === 'string' && Array.isArray(v.items);
  const validPq = v => v && typeof v === 'object' && typeof v.uid === 'string';
  const personal = {
    async loadExams() {
      await flush().catch(() => {});
      let remote = [], listErr = null;
      try { remote = await readFiles('exam-', validExam); } catch (e) { listErr = e; }
      const map = new Map(remote.map(e => [e.id, e]));
      for (const k of await outbox.keys('exam:')) { const v = await outbox.get(k); const cur = map.get(v.id); if (!cur || (v.updatedAt || 0) >= (cur.updatedAt || 0)) map.set(v.id, v); }
      for (const k of await outbox.keys('del-exam:')) map.delete(k.slice(9));
      if (listErr && !map.size) throw listErr;
      if (listErr) onSyncError({ where: 'drive-list', error: listErr });
      return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    saveExam: exam => safe(OB.exam(exam.id), strip(exam)),
    async deleteExam(id) { await outbox.del(OB.exam(id)); return safe(OB.delExam(id), 1); },
    async loadPersonal() {
      await flush().catch(() => {});
      let remote = [], listErr = null;
      try { remote = await readFiles('pq-', validPq); } catch (e) { listErr = e; }
      const map = new Map(remote.map(q => [q.uid, q]));
      for (const k of await outbox.keys('pq:')) { const v = await outbox.get(k); map.set(v.uid, v); }
      for (const k of await outbox.keys('del-pq:')) map.delete(k.slice(7));
      if (listErr && !map.size) throw listErr;
      if (listErr) onSyncError({ where: 'drive-list', error: listErr });
      return [...map.values()];
    },
    savePersonalQuestion: q => safe(OB.pq(q.uid), strip(q)),
    async deletePersonalQuestion(u) { await outbox.del(OB.pq(u)); return safe(OB.delPq(u), 1); },
    async putUserMedia(key, data) { return safe(OB.media(key), data); },
    async getUserMedia(key) { const pend = await outbox.get(OB.media(key)); return pend || drive.getBytes(mediaName(key)); },
  };
  // חשבון בלי הרשאת Drive: הנתונים האישיים נשארים מקומיים (בלי לטשטש זאת – הממשק מציג אזהרה)
  const personalImpl = driveEnabled ? personal : {
    loadExams: () => local.loadExams(), saveExam: e => local.saveExam(e), deleteExam: id => local.deleteExam(id),
    loadPersonal: () => local.loadPersonal(), savePersonalQuestion: q => local.savePersonalQuestion(q), deletePersonalQuestion: u => local.deletePersonalQuestion(u),
    putUserMedia: (k, d) => local.putMedia(k, d), getUserMedia: k => local.getMedia(k),
  };

  return {
    ...local,
    kind: driveEnabled ? 'cloud-drive-firestore' : 'cloud-bank-local-personal',
    isAdmin,
    flush: () => (driveEnabled ? flush() : Promise.resolve({ pending: 0, failed: 0 })),
    pendingCount: async () => (driveEnabled ? (await outbox.keys()).length : 0),

    // ----- אישי -----
    loadExams: personalImpl.loadExams, saveExam: personalImpl.saveExam, deleteExam: personalImpl.deleteExam,
    loadPersonal: personalImpl.loadPersonal, savePersonalQuestion: personalImpl.savePersonalQuestion, deletePersonalQuestion: personalImpl.deletePersonalQuestion,

    // ----- מדיה -----
    async putMedia(key, data) {
      if (isUser(key)) return personalImpl.putUserMedia(key, data);
      needAdmin(); await ensure();
      const ops = await mediaOps(key, data); await commit(ops); const m = metaOps(); await guard(m); await commit(m); noteWritten(m);
    },
    async getMedia(key) {
      if (isUser(key)) return personalImpl.getUserMedia(key);
      await ensure();
      const m = st.media.get(key); if (!m) return null;
      const rev = `${m.parts}:${m.size}`;
      const cached = mediaCache && await mediaCache.get(key);
      if (cached?.rev === rev) return cached.data;
      const data = await fetchParts('bankMedia', Array.from({ length: m.parts }, (_, i) => `${m.id}-${i}`));
      if (data && mediaCache) await mediaCache.put(key, { rev, data });
      return data;
    },

    // ----- מאגר מרכזי: קריאה (כל מורה מחובר) -----
    async loadBank() {
      try {
        const s = await readCentral();
        return { packages: s.meta.packages, questions: [...s.q.values()].flat(), cases: [...s.c.values()].flat(), media: new Map(), central: true };
      } catch (e) {
        // רשת/הרשאות: חוזרים למאגר המקומי, אבל מדווחים (לא מטשטשים)
        const base = await local.loadBank();
        return { ...base, warning: 'המאגר המרכזי אינו זמין כרגע. מוצג המאגר המקומי; המבחנים והשאלות האישיות שלך נשמרים כרגיל.', warningDetail: `central-bank: ${e.code || ''} ${e.message || e}`.trim() };
      }
    },
    async loadTaxonomy() { await ensure(); return strip(st.meta.taxonomy); },
    // כל מפתחות איורי המאגר המרכזי (כולל מוסתרים; מנהל). משמש לגיבוי שלם.
    async listMediaKeys() { await ensure(); return [...st.media.keys()]; },

    // ----- מאגר מרכזי: כתיבה (מנהל בלבד; נאכף בכללי Firestore) -----
    async saveBankQuestion(q) {
      needAdmin(); await ensure();
      place('q', strip(q), !isPubQ(q)); await persist(); await audit('save-question', q.uid, q.published === false ? 'hidden' : 'published');
    },
    async deleteBankQuestion(u) {
      needAdmin(); await ensure();
      if (!unplace('q', u)) return;
      await persist(); await audit('delete-question', u);
    },
    async saveTaxonomy(value) {
      needAdmin(); await ensure(); st.meta.taxonomy = strip(value); const m = metaOps(); await guard(m); await commit(m); noteWritten(m); await audit('save-taxonomy', '', Object.keys(value.domains || {}).length + ' domains');
    },
    async importPackage(parsed, opts) {
      needAdmin(); await ensure();
      const { pkg, questions, cases, media } = parsed; const publish = opts ? opts.publish !== false : true;
      const res = { added: 0, skipped: 0, conflicts: 0, mediaAdded: 0, casesAdded: 0 };
      const ops = [];
      const sig = q => JSON.stringify([q.blocks, q.rubric]);
      if (!opts) { // החלפת חבילה קיימת
        for (const [u] of [...st.qIdx]) { const ex = [...st.q.values()].flat().find(x => x.uid === u); if (ex?.pkgId === pkg.id) unplace('q', u); }
        for (const [u] of [...st.cIdx]) { const ex = [...st.c.values()].flat().find(x => x.uid === u); if (ex?.pkgId === pkg.id) unplace('c', u); }
        for (const k of [...st.media.keys()]) if (k.startsWith(pkg.id + '/')) ops.push(...mediaDeleteOps(k));
      }
      const existing = new Map([...st.q.values()].flat().map(x => [x.uid, x]));
      for (const q0 of questions) {
        const q = strip(q0); const ex = existing.get(q.uid);
        if (!ex) { place('q', { ...q, published: publish }, !publish); res.added++; }
        else {
          if (sig(ex) === sig(q)) res.skipped++;
          else { ex.reviewFlag = true; ex.conflictNote = 'הגיעה גרסה שונה בייבוא חוזר'; place('q', ex, !isPubQ(ex)); res.conflicts++; }
        }
      }
      const existingC = new Set([...st.c.values()].flat().map(x => x.uid));
      for (const c of cases) if (!existingC.has(c.uid)) { place('c', strip(c), true); res.casesAdded++; }   // פרטי עד ש-reconcile מוצא שאלה מפורסמת שמשתמשת בו
      for (const [key, data] of media) if (!st.media.has(key) || !opts) { ops.push(...await mediaOps(key, data)); res.mediaAdded++; }
      st.meta.packages = [...st.meta.packages.filter(p => p.id !== pkg.id), strip(pkg)];
      await guard(peekOps());
      await commit(ops);                                  // קודם איורים (פרטיים)
      await persist({ withMeta: true });                  // חבילות שאלות/מקרים + דגלי איורים; meta אחרון: מצביע על מה שכבר נכתב
      await audit('import-package', pkg.id, JSON.stringify(res));
      return res;
    },
    async removePackage(id) {
      needAdmin(); await ensure();
      const ops = [];
      for (const x of [...st.q.values()].flat()) if (x.pkgId === id) unplace('q', x.uid);
      for (const x of [...st.c.values()].flat()) if (x.pkgId === id) unplace('c', x.uid);
      for (const k of [...st.media.keys()]) if (k.startsWith(id + '/')) ops.push(...mediaDeleteOps(k));
      st.meta.packages = st.meta.packages.filter(p => p.id !== id);
      await guard(peekOps()); await commit(ops); await persist({ withMeta: true }); await audit('remove-package', id);
    },
    // שחזור מגיבוי: כותב את המצב החדש ואז מוחק שאריות. לא אטומי – לכן ממשק המנהל מוריד גיבוי בטיחות לפני כן.
    async replaceCentral({ packages, questions, cases, media, taxonomy, keepMediaKeys = [] }) {
      needAdmin(); const old = await readCentral();
      const oldQ = [...old.q.keys()], oldC = [...old.c.keys()], oldMedia = [...old.media.keys()];
      dirty.clear();
      st = mkSt({ rev: old.meta.rev, packages: strip(packages), taxonomy: strip(taxonomy || { domains: {}, types: {} }), media: [] }, new Map(), new Map());
      st.admBase = old.admBase; st.raw = new Map(); st.metaRev = old.metaRev; st.force = true;
      for (const q of questions) place('q', strip(q), !isPubQ(q));
      for (const c of cases) place('c', strip(c), true);                       // reconcile מפרסם רק מקרים שנדרשים לשאלה מפורסמת
      const ops = [];
      for (const [key, data] of media) if (!isUser(key)) ops.push(...await mediaOps(key, data));
      // שחזור חלקי מגיבוי ישן בלי תמונות: תמונות שכבר קיימות בענן ושהתוכן מפנה אליהן נשמרות (לא נמחקות)
      for (const k of keepMediaKeys) if (!media.has(k) && old.media.has(k)) st.media.set(k, { ...old.media.get(k) });
      await commit(ops);
      try { await persist({ withMeta: true }); } finally { st.force = false; }
      const del = [];
      for (const i of oldQ) if (!st.q.has(i)) del.push({ type: 'delete', col: colOf(i), id: i });
      for (const i of oldC) if (!st.c.has(i)) del.push({ type: 'delete', col: colOf(i), id: i });
      for (const k of oldMedia) if (!st.media.has(k)) { const m = old.media.get(k); for (let p = 0; p < m.parts; p++) del.push({ type: 'delete', col: 'bankMedia', id: `${m.id}-${p}` }); }
      await commit(del); await audit('replace-central', '', `${questions.length} questions`);
    },

    // ----- הצעות -----
    async submitSuggestion(q, { credit = false, authorName = '', getMedia } = {}) {
      const { fs, db } = await firestore();
      const tag = Math.random().toString(36).slice(2, 8);
      const doc = suggestionDoc(q, { uid, credit, authorName, tag });
      const ops = [];
      for (const key of doc.imageKeys) {
        const data = (getMedia && getMedia(key)) || await personalImpl.getUserMedia(key);
        if (!data) throw tmpl('missing-media', 'חסרה תמונה בשאלה – לא ניתן לשלוח');
        const h = await hashKey(key); const parts = Math.max(1, Math.ceil(data.length / PART_BYTES));
        for (let i = 0; i < parts; i++) {
          const slice = data.subarray(i * PART_BYTES, (i + 1) * PART_BYTES);
          ops.push({ type: 'set', col: 'suggestionMedia', id: `${doc.id}-${tag}-${h}-${i}`, data: { sgId: doc.id, authorUid: uid, key, part: i, parts, data: fs.Bytes.fromUint8Array(slice), tag }, bytes: slice.length + 200 });
        }
      }
      await commit(ops);                                          // קודם התמונות, כדי שהמנהל לא יראה הצעה בלי תמונה
      await fs.setDoc(fs.doc(db, 'suggestions', doc.id), doc);   // ורק אז ההצעה עצמה (pending)
      return fromSuggestionDoc(doc);
    },
    async loadSuggestions() {
      // כללי Firestore עשויים לחסום: ההצעות הן תוספת, אסור שיכשילו כניסה ושימוש ב-Drive (מדווח, לא מוסתר)
      try {
        const { fs, db } = await firestore();
        const q = isAdmin ? fs.collection(db, 'suggestions') : fs.query(fs.collection(db, 'suggestions'), fs.where('authorUid', '==', uid));
        return (await fs.getDocs(q)).docs.map(d => fromSuggestionDoc(d.data()));
      } catch (err) { onSyncError({ where: 'suggestions', error: err }); return []; }
    },
    // מנהל: אישור/דחייה/סימון טיוטה. כתיבה למסמך הקיים (עדכון) – מותר רק למנהל.
    async saveSuggestion(s) {
      needAdmin(); const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, 'suggestions', s.id), toSuggestionDoc(s));
      await audit('suggestion-' + s.status, s.id, s.draftUid || '');
    },
    // מנהל: מחיקה לצמיתות של הצעה ממתינה/שנדחתה + כל חלקי המדיה שלה (sgId זהה בלבד). שאלה שפורסמה במאגר לא נוגעים בה.
    // סדר: קודם המדיה, ורק אם הכול נמחק – ההצעה עצמה. כישלון חלקי: ההצעה נשארת ברשימה ואפשר לנסות שוב (בלי הצלחה כוזבת).
    async deleteSuggestion(s) {
      needAdmin();
      if (s.status === 'approved' || s.status === 'in-review' || s.draftUid) throw tmpl('suggestion-approved', 'הצעה שאושרה אינה נמחקת מכאן. השאלה שפורסמה במאגר המרכזי נשארת כפי שהיא.');
      const { fs, db } = await firestore();
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'suggestionMedia'), fs.where('sgId', '==', s.id)));
      let deleted = 0; const failed = [];
      for (const d of snap.docs) { try { await fs.deleteDoc(d.ref); deleted++; } catch (e) { failed.push(d.id + ':' + (e.code || e.message)); } }
      if (failed.length) {
        await audit('delete-suggestion-partial', s.id, `media ${deleted}/${snap.docs.length}`);
        throw tmpl('partial-delete', `המחיקה לא הושלמה: נמחקו ${deleted} מתוך ${snap.docs.length} חלקי תמונה. ההצעה עדיין קיימת, אפשר לנסות שוב.`, { remaining: failed });
      }
      await fs.deleteDoc(fs.doc(db, 'suggestions', s.id));
      await audit('delete-suggestion', s.id, `media ${deleted}; status ${s.status}`);
      return { mediaDeleted: deleted };
    },
    // מנהל: טוען את תמונות ההצעה (נשלחו על ידי המורה) -> Map<key, bytes>
    async getSuggestionMedia(s) {
      needAdmin(); const { fs, db } = await firestore(); const out = new Map();
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'suggestionMedia'), fs.where('sgId', '==', s.id)));
      const byKey = new Map();
      for (const d of snap.docs) { const v = d.data(); if (s.mediaTag && v.tag !== s.mediaTag) continue; (byKey.get(v.key) || byKey.set(v.key, []).get(v.key)).push(v); }
      for (const [key, parts] of byKey) {
        parts.sort((a, b) => a.part - b.part);
        if (parts.length !== parts[0].parts) continue; // חלקים חסרים – לא מחזירים תמונה שבורה
        const arr = parts.map(p => p.data.toUint8Array()); const r = new Uint8Array(arr.reduce((a, b) => a + b.length, 0)); let o = 0;
        for (const p of arr) { r.set(p, o); o += p.length; }
        out.set(key, r);
      }
      return out;
    },
  };
}
