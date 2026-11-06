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
      if (o.type === 'set') batch.set(ref, o.data); else batch.delete(ref);
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
  async function readCentral() {
    const { fs, db } = await firestore();
    const snap = await fs.getDocs(fs.collection(db, 'bank'));
    const meta = { rev: 0, packages: [], taxonomy: { domains: {}, types: {} }, media: [] };
    const q = new Map(), c = new Map();
    for (const d of snap.docs) {
      const v = d.data();
      if (d.id === 'meta') Object.assign(meta, JSON.parse(v.json));
      else if (d.id.startsWith('q-')) q.set(d.id, JSON.parse(v.json));
      else if (d.id.startsWith('c-')) c.set(d.id, JSON.parse(v.json));
    }
    const idx = m => { const r = new Map(); for (const [id, items] of m) for (const it of items) r.set(it.uid, id); return r; };
    st = { meta, q, c, qIdx: idx(q), cIdx: idx(c), media: new Map(meta.media.map(m => [m.key, m])) };
    return st;
  }
  const ensure = async () => st || readCentral();

  const metaOp = () => {
    st.meta.rev = (st.meta.rev || 0) + 1; st.meta.media = [...st.media.values()];
    const json = JSON.stringify(st.meta);
    if (enc.encode(json).length > MAX_JSON) throw tmpl('too-large', 'מסמך ה-meta של המאגר גדול מדי');
    return { type: 'set', col: 'bank', id: 'meta', data: { kind: 'meta', rev: st.meta.rev, json }, bytes: json.length };
  };
  const chunkOp = (prefix, id) => {
    const items = (prefix === 'q' ? st.q : st.c).get(id);
    if (!items || !items.length) return { type: 'delete', col: 'bank', id };
    const json = JSON.stringify(items);
    if (enc.encode(json).length > MAX_JSON) throw tmpl('too-large', 'חבילת שאלות גדולה מדי');
    return { type: 'set', col: 'bank', id, data: { kind: prefix === 'q' ? 'questions' : 'cases', n: items.length, json }, bytes: json.length };
  };
  // מציב פריט בחבילה: קיים -> מוחלף במקומו; חדש -> לחבילה האחרונה אם יש מקום, אחרת חבילה חדשה. מחזיר את מזהה החבילה שהשתנתה.
  function place(prefix, item) {
    const chunks = prefix === 'q' ? st.q : st.c, idx = prefix === 'q' ? st.qIdx : st.cIdx;
    const have = idx.get(item.uid);
    if (have) { const arr = chunks.get(have); arr[arr.findIndex(x => x.uid === item.uid)] = item; return have; }
    const ids = [...chunks.keys()].sort();
    let target = ids[ids.length - 1];
    if (!target || chunks.get(target).length >= MAX_CHUNK_COUNT || sizeOf(chunks.get(target)) + sizeOf(item) > MAX_CHUNK_BYTES) {
      target = prefix + '-' + String((ids.length ? Math.max(...ids.map(i => Number(i.slice(2)))) + 1 : 0)).padStart(3, '0');
      chunks.set(target, []);
    }
    chunks.get(target).push(item); idx.set(item.uid, target);
    return target;
  }
  function unplace(prefix, uidv) {
    const chunks = prefix === 'q' ? st.q : st.c, idx = prefix === 'q' ? st.qIdx : st.cIdx;
    const id = idx.get(uidv); if (!id) return null;
    chunks.set(id, chunks.get(id).filter(x => x.uid !== uidv)); idx.delete(uidv);
    return id;
  }
  const dropEmpty = prefix => { const m = prefix === 'q' ? st.q : st.c; for (const [id, a] of m) if (!a.length) m.delete(id); };

  // ---------------- איורי המאגר המרכזי ----------------
  async function mediaOps(key, data) {
    const h = await hashKey(key); const parts = Math.max(1, Math.ceil(data.length / PART_BYTES));
    const { fs } = await firestore(); const ops = [];
    for (let i = 0; i < parts; i++) {
      const slice = data.subarray(i * PART_BYTES, (i + 1) * PART_BYTES);
      ops.push({ type: 'set', col: 'bankMedia', id: `${h}-${i}`, data: { key, part: i, parts, size: data.length, data: fs.Bytes.fromUint8Array(slice) }, bytes: slice.length + 200 });
    }
    st.media.set(key, { key, id: h, parts, size: data.length });
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

  const personal = {
    async loadExams() {
      await flush().catch(() => {});
      let remote = [], listErr = null;
      try { const files = await drive.list('exam-'); remote = (await Promise.all(files.map(f => drive.getJson(f.name)))).filter(Boolean); } catch (e) { listErr = e; }
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
      try { const files = await drive.list('pq-'); remote = (await Promise.all(files.map(f => drive.getJson(f.name)))).filter(Boolean); } catch (e) { listErr = e; }
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
      const ops = await mediaOps(key, data); await commit(ops); await commit([metaOp()]);
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

    // ----- מאגר מרכזי: כתיבה (מנהל בלבד; נאכף בכללי Firestore) -----
    async saveBankQuestion(q) {
      needAdmin(); await ensure();
      const id = place('q', strip(q)); await commit([chunkOp('q', id)]); await audit('save-question', q.uid, q.published === false ? 'hidden' : 'published');
    },
    async deleteBankQuestion(u) {
      needAdmin(); await ensure();
      const id = unplace('q', u); if (!id) return;
      await commit([chunkOp('q', id)]); dropEmpty('q'); await audit('delete-question', u);
    },
    async saveTaxonomy(value) {
      needAdmin(); await ensure(); st.meta.taxonomy = strip(value); await commit([metaOp()]); await audit('save-taxonomy', '', Object.keys(value.domains || {}).length + ' domains');
    },
    async importPackage(parsed, opts) {
      needAdmin(); await ensure();
      const { pkg, questions, cases, media } = parsed; const publish = opts ? opts.publish !== false : true;
      const res = { added: 0, skipped: 0, conflicts: 0, mediaAdded: 0, casesAdded: 0 };
      const touchedQ = new Set(), touchedC = new Set(), ops = [];
      const sig = q => JSON.stringify([q.blocks, q.rubric]);
      if (!opts) { // החלפת חבילה קיימת
        for (const [u] of [...st.qIdx]) { const ex = [...st.q.values()].flat().find(x => x.uid === u); if (ex?.pkgId === pkg.id) touchedQ.add(unplace('q', u)); }
        for (const [u] of [...st.cIdx]) { const ex = [...st.c.values()].flat().find(x => x.uid === u); if (ex?.pkgId === pkg.id) touchedC.add(unplace('c', u)); }
        for (const k of [...st.media.keys()]) if (k.startsWith(pkg.id + '/')) ops.push(...mediaDeleteOps(k));
      }
      const existing = new Map([...st.q.values()].flat().map(x => [x.uid, x]));
      for (const q0 of questions) {
        const q = strip(q0); const ex = existing.get(q.uid);
        if (!ex) { touchedQ.add(place('q', { ...q, published: publish })); res.added++; }
        else {
          if (sig(ex) === sig(q)) res.skipped++;
          else { ex.reviewFlag = true; ex.conflictNote = 'הגיעה גרסה שונה בייבוא חוזר'; touchedQ.add(place('q', ex)); res.conflicts++; }
        }
      }
      const existingC = new Set([...st.c.values()].flat().map(x => x.uid));
      for (const c of cases) if (!existingC.has(c.uid)) { touchedC.add(place('c', strip(c))); res.casesAdded++; }
      for (const [key, data] of media) if (!st.media.has(key) || !opts) { ops.push(...await mediaOps(key, data)); res.mediaAdded++; }
      st.meta.packages = [...st.meta.packages.filter(p => p.id !== pkg.id), strip(pkg)];
      await commit(ops);                                  // קודם איורים
      await commit([...touchedQ].filter(Boolean).map(i => chunkOp('q', i)).concat([...touchedC].filter(Boolean).map(i => chunkOp('c', i))));
      dropEmpty('q'); dropEmpty('c');
      await commit([metaOp()]);                           // meta אחרון: מצביע על מה שכבר נכתב
      await audit('import-package', pkg.id, JSON.stringify(res));
      return res;
    },
    async removePackage(id) {
      needAdmin(); await ensure();
      const touchedQ = new Set(), touchedC = new Set(), ops = [];
      for (const x of [...st.q.values()].flat()) if (x.pkgId === id) touchedQ.add(unplace('q', x.uid));
      for (const x of [...st.c.values()].flat()) if (x.pkgId === id) touchedC.add(unplace('c', x.uid));
      for (const k of [...st.media.keys()]) if (k.startsWith(id + '/')) ops.push(...mediaDeleteOps(k));
      st.meta.packages = st.meta.packages.filter(p => p.id !== id);
      await commit([...touchedQ].map(i => chunkOp('q', i)).concat([...touchedC].map(i => chunkOp('c', i))).concat(ops));
      dropEmpty('q'); dropEmpty('c'); await commit([metaOp()]); await audit('remove-package', id);
    },
    // שחזור מגיבוי: כותב את המצב החדש ואז מוחק שאריות. לא אטומי – לכן ממשק המנהל מוריד גיבוי בטיחות לפני כן.
    async replaceCentral({ packages, questions, cases, media, taxonomy }) {
      needAdmin(); const old = await readCentral();
      const oldQ = [...old.q.keys()], oldC = [...old.c.keys()], oldMedia = [...old.media.keys()];
      st = { meta: { rev: old.meta.rev, packages: strip(packages), taxonomy: strip(taxonomy || { domains: {}, types: {} }), media: [] }, q: new Map(), c: new Map(), qIdx: new Map(), cIdx: new Map(), media: new Map() };
      for (const q of questions) place('q', strip(q));
      for (const c of cases) place('c', strip(c));
      const ops = [];
      for (const [key, data] of media) if (!isUser(key)) ops.push(...await mediaOps(key, data));
      await commit(ops);
      await commit([...st.q.keys()].map(i => chunkOp('q', i)).concat([...st.c.keys()].map(i => chunkOp('c', i))));
      await commit([metaOp()]);
      const del = [];
      for (const i of oldQ) if (!st.q.has(i)) del.push({ type: 'delete', col: 'bank', id: i });
      for (const i of oldC) if (!st.c.has(i)) del.push({ type: 'delete', col: 'bank', id: i });
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
