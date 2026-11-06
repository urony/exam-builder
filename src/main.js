import { parsePackage, KIND_LABEL } from './adapter.js';
import { cellLines } from './clean.js';
import { store, localStore, setBackend } from './store.js';
import { cloudConfigured } from './firebase-config.js';
import * as idb from './db.js';
import { createIdbStore } from './outbox.js';
import { newExam, uid, addQuestion, totalPoints, isQ, questionsOf, qNumber, addChapter, addFree, moveToGap, validGaps, sectionRange, removeItem, moveItem, equalSplit, isChoiceQuestion, caseFirstUse } from './exam.js';
import { buildExamDocument, toBlob } from './docx-export.js';
import { prepareImage } from './images.js';
import { nudge, previewStyle, normOffsets } from './imgfit.js';
import { TEMPLATES } from './templates.js';
import { createAdmin } from './admin.js';
import { LETTERS, SOURCE_OPTIONS, emptyDraft, draftToQuestion, validateDraft, questionToDraft, itemToDraft } from './personal.js';
import { esc } from './util.js';
import { ICON } from './icons.js';
import { emptyUsage, savedUids, usedSource, isUsed, setManual, reconcile } from './usage.js';
import { LIMITS, ADMIN_CONTACT, QUOTA_NOTE, QUOTA_MORE, quotaUsage, checkQuota } from './quota.js';
import { groupRows, caseMembers, addUnique } from './case-groups.js';
import { homeHtml, examsHtml } from './views.js';
import { helpBtn, helpLink, initHelp, closeHelp, GUIDE_URL } from './help.js';

const ANATOMY_TOOL_URL = 'https://urony.github.io/Anatomic-Pictures-Finder-tool/';
const clone = o => JSON.parse(JSON.stringify(o));
const emptyFilters = () => ({ text: '', domains: new Set(), types: new Set(), kinds: new Set(), years: new Set(), codes: new Set(), use: 'all' });

// ---------- מצב ----------
const SPLITS = { bank: ['מאגר רחב', '1.5fr 1fr'], even: ['מאוזן', '1fr 1fr'], exam: ['מבחן רחב', '1fr 1.5fr'] };
const S = {
  tab: 'home', mode: localStorage.getItem('mode') || 'split', split: SPLITS[localStorage.getItem('split')] ? localStorage.getItem('split') : 'even', pv: 'edit', pvTeacher: false, modal: null,
  packages: [], questions: [], cases: new Map(), media: new Map(), urls: new Map(),
  tax: { types: {}, domains: {} },
  f: emptyFilters(),
  sort: 'year-desc',
  sel: null, checked: new Set(), caseOpen: new Set(),
  exam: null, exams: [], editing: new Set(), collapsed: new Set(),
  importReports: [], personal: [], suggestions: [], pq: null,
  usage: emptyUsage(), saveState: null, exSort: localStorage.getItem('exSort') || 'updated',
  fopen: new Set(JSON.parse(localStorage.getItem('fopen') || '["domains"]')),
  user: null, // { uid, name } אחרי התחברות Google; null = מצב מקומי
  isAdmin: false, warn: '', sync: null, mediaMissing: new Set(),
};
const $app = document.getElementById('app');
// הודעה קצרה; עם action מוצג כפתור פעולה (למשל "עבור למבחן")
function toast(msg, action, ms) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.toggle('act', !!action);
  if (action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'toastbtn'; b.textContent = action.label; b.addEventListener('click', () => { t.classList.remove('on'); action.fn(); }); t.append(' ', b); }
  t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms || (action ? 6000 : 3200));
}
// חלון אישור/קלט מעוצב (במקום confirm/prompt של הדפדפן). מחזיר true/false, או מחרוזת כשיש input, או null בביטול.
function ask({ title, text = '', ok = 'אישור', cancel = 'ביטול', danger = false, input = null }) {
  return new Promise(res => {
    const w = document.createElement('div'); w.className = 'modal dlg'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-labelledby', 'dlgt');
    w.innerHTML = `<div class="modalbox card dlgbox"><h3 id="dlgt">${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${input ? `<label class="dlginput">${esc(input.label)}<input id="dlgin" value="${esc(input.value || '')}"></label>` : ''}<div class="dlgbtns"><button class="btn ${danger ? 'dangerfill' : 'primary'}" id="dlgok">${esc(ok)}</button><button class="btn" id="dlgcancel">${esc(cancel)}</button></div></div>`;
    const prev = document.activeElement;
    const done = v => { w.remove(); document.removeEventListener('keydown', key, true); prev?.focus?.(); res(v); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); done(input ? null : false); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); done(input ? w.querySelector('#dlgin').value : true); }
      else if (e.key === 'Tab') { const f = [...w.querySelectorAll('input, button')]; const i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
    };
    document.addEventListener('keydown', key, true);
    w.addEventListener('click', e => { if (e.target === w) done(input ? null : false); });
    w.querySelector('#dlgok').addEventListener('click', () => done(input ? w.querySelector('#dlgin').value : true));
    w.querySelector('#dlgcancel').addEventListener('click', () => done(input ? null : false));
    document.body.appendChild(w); (w.querySelector('#dlgin') || w.querySelector(danger ? '#dlgcancel' : '#dlgok')).focus();
  });
}

// ---------- טעינה ----------
async function loadAll() {
  const bank = await store.loadBank();
  S.warn = bank.warning || ''; S.warnDetail = bank.warningDetail || '';
  if (S.warnDetail) logErr('מאגר מרכזי', S.warnDetail);
  S.packages = bank.packages; S.questions = bank.questions; S.media = bank.media;
  S.cases = new Map(bank.cases.map(c => [c.uid, c]));
  S.exams = await store.loadExams();
  S.personal = await store.loadPersonal();
  S.suggestions = await store.loadSuggestions();
  if (S.isAdmin && store.reconcileQuotas) store.reconcileQuotas().catch(e => logErr('מכסות הגשה', `${e?.code || ''} ${e?.message || e}`));   // יישור מוני המכסות (מנהל בלבד)
  S.questions = bank.questions.concat(S.personal);
  S.tax = { types: {}, domains: {} };
  for (const p of S.packages) { Object.assign(S.tax.types, p.taxonomy?.types || {}); Object.assign(S.tax.domains, p.taxonomy?.domains || {}); }
  let meta = {}; try { meta = await store.loadTaxonomy(); } catch { /* מאגר מרכזי לא זמין: מילון מהחבילות בלבד */ }
  Object.assign(S.tax.domains, meta.domains || {}); Object.assign(S.tax.types, meta.types || {});
  try { S.usage = (await store.loadUsage?.()) || emptyUsage(); } catch (e) { S.usage = emptyUsage(); reportSync('שימוש בשאלות', e); }
  if (!S.exam) S.exam = S.exams[0] ? clone(S.exams[0]) : newExam();   // עותק: S.exams נשאר מצב השמירה האחרון (לחישוב שימוש)
  syncUsage();
  // תמונות משתמש (Drive) נטענות כאן; איורי המאגר המרכזי נטענים לפי צורך (ensureMedia)
  if (store.getMedia) await ensureMedia([...S.exams.flatMap(x => x.items.flatMap(i => (i.images || []).map(m => m.key))), ...S.personal.flatMap(q => (q.images || []).map(m => m.key))].filter(k => String(k).startsWith('user/')));
  // מנהל: תמונות של הצעות ממתינות (נשלחו עם ההצעה; אין למנהל גישה ל-Drive של המורה)
  if (S.isAdmin && store.getSuggestionMedia) {
    for (const s of S.suggestions.filter(x => x.status === 'pending' || x.status === 'in-review')) {
      if ((s.imageKeys || []).every(k => S.media.has(k))) continue;
      try { for (const [k, v] of await store.getSuggestionMedia(s)) S.media.set(k, v); } catch (e) { reportSync('הצעות', e); }
    }
  }
}

// ---------- מדיה לפי צורך ----------
async function ensureMedia(keys) {
  await Promise.all([...new Set(keys)].filter(k => k && !S.media.has(k) && !S.mediaMissing.has(k)).map(async k => {
    try { const b = await store.getMedia(k); if (b) S.media.set(k, b); else S.mediaMissing.add(k); } catch (e) { S.mediaMissing.add(k); reportSync('תמונה', e); }
  }));
}
const examMediaKeys = ex => ex.items.flatMap(i => [...(i.snap?.blocks || []).map(b => b.mediaKey), ...(i.snap?.rubric?.answer || []).map(b => b.mediaKey), ...(i.images || []).map(m => m.key)])
  .concat(Object.values(ex.cases || {}).flatMap(c => (c.blocks || []).map(b => b.mediaKey))).filter(Boolean);
const wantedMedia = new Set(); let mediaTimer;
function queueMedia(key) {
  if (!store.getMedia || wantedMedia.has(key) || S.mediaMissing.has(key)) return;
  wantedMedia.add(key); clearTimeout(mediaTimer);
  mediaTimer = setTimeout(async () => { const keys = [...wantedMedia]; wantedMedia.clear(); await ensureMedia(keys); if (keys.some(k => S.media.has(k))) render(); }, 60);
}
async function putUserMedia(key, data) {
  S.media.set(key, data);
  try { await store.putMedia(key, data); } catch (e) { if (e.code === 'sync-pending') reportSync('תמונה', e); else throw e; }
}

// ---------- סנכרון / אזהרות (לא מטשטשים שגיאות) ----------
// יומן שגיאות טכני (בזיכרון, לתצוגה ב"פרטים טכניים"); המורה רואה הודעה ידידותית בלבד
function logErr(what, detail) { (S.errlog ||= []).unshift(`${new Date().toLocaleTimeString('he-IL')} · ${what}: ${detail}`); S.errlog.length = Math.min(S.errlog.length, 30); console.warn('log:', what, detail); }
// כשל במאגר המרכזי (Firestore) נפרד מכשל סנכרון אישי (Drive): לא חוסם התחברות או שמירה אישית
function reportCentral(what, err) {
  logErr(what, `${err?.code || ''} ${err?.message || err}`.trim());
  if (!S.warn) S.warn = what === 'suggestions' ? 'ההצעות למאגר המרכזי אינן זמינות כרגע. כל שאר היכולות פועלות כרגיל.' : 'יומן הפעולות של המאגר המרכזי אינו זמין כרגע.';
  if (document.getElementById('syncbar')) document.getElementById('syncbar').outerHTML = syncBarHtml();
}
function reportSync(what, err) {
  console.warn('sync:', what, err); logErr(what, `${err?.code || ''} ${err?.message || err} ${err?.cause?.message || ''}`.trim());
  const st = err?.cause?.status ?? err?.status;
  S.sync = { msg: err?.code === 'sync-pending' ? 'השמירה ב־Google Drive נכשלה. המבחן נשמר במחשב הזה וימתין לסנכרון.' : 'לא הצלחנו להתחבר ל־Google Drive כרגע. העבודה שלך נשמרת במחשב הזה, ואפשר לנסות שוב.', relogin: st === 401 || st === 403 };
  if (document.getElementById('app')) { const b = document.getElementById('syncbar'); if (b) b.outerHTML = syncBarHtml(); else render(); }
}
const syncBarHtml = () => `<div id="syncbar">${S.sync ? `<div class="warnbar">${esc(S.sync.msg)} ${S.sync.relogin ? '<button class="btn sm" id="signin">התחבר מחדש</button>' : '<button class="btn sm" id="retrysync">נסה שוב</button>'}</div>` : ''}${S.warn ? `<div class="warnbar">${esc(S.warn)} <button class="btn sm" id="retrybank">נסה לטעון שוב</button></div>` : ''}${S.errlog?.length && (S.warn || S.sync) ? `<details class="techlog"><summary>פרטים טכניים</summary><pre>${esc(S.errlog.join(String.fromCharCode(10)))}</pre></details>` : ''}${S.user && !S.user.hasDrive ? '<div class="warnbar">לא ניתנה הרשאת Drive: מבחנים ושאלות אישיות נשמרים במחשב הזה בלבד ולא בענן.</div>' : ''}</div>`;
async function retrySync() {
  if (!store.flush) return;
  try { const r = await store.flush(); if (!r.pending) { S.sync = null; toast('הסנכרון הושלם'); } else toast(`${r.pending} פריטים עדיין ממתינים לסנכרון`); } catch (e) { reportSync('סנכרון', e); }
  render();
}

async function signInFlow() {
  try {
    const cloud = await import('./cloud.js');
    const u = await cloud.signIn();
    const { createDrive } = await import('./drive.js');
    const { createCloudStore } = await import('./cloud-store.js');
    const admin = await cloud.isAdmin();
    setBackend(createCloudStore({
      drive: createDrive({ getToken: cloud.getDriveToken }), firestore: cloud.firestore, uid: u.uid, isAdmin: admin, local: localStore,
      outbox: createIdbStore(idb, `ob:${u.uid}:`), mediaCache: createIdbStore(idb, 'mc:'), driveEnabled: u.hasDrive,
      onSyncError: e => e.where === 'drive-corrupt' ? (logErr('Drive', 'קובץ פגום: ' + e.file), S.sync = { msg: 'קובץ אחד ב־Google Drive (' + e.file + ') פגום ולא נטען. שאר הנתונים נטענו והקובץ לא נמחק.' }) : (e.where === 'suggestions' || e.where === 'audit') ? reportCentral(e.where, e.error) : reportSync(e.where, e.error),
    }));
    S.user = { uid: u.uid, name: u.name, hasDrive: u.hasDrive }; S.isAdmin = admin; S.sync = null; S.exam = null; S.mediaMissing.clear();
    try { await loadAll(); toast('מחובר: ' + (u.name || 'משתמש') + (admin ? ' (מנהל)' : '')); }
    catch (err) { console.error('loadAll after sign-in:', err); reportSync('טעינה', err); S.exam = newExam(); }
    render();
  } catch (err) { console.error('sign-in:', err); toast('ההתחברות נכשלה: ' + (err.code || err.message)); }
}
async function signOutFlow() {
  try { await (await import('./cloud.js')).signOut(); } catch { /* ignore */ }
  setBackend(localStore); S.user = null; S.isAdmin = false; S.sync = null; S.warn = ''; S.exam = null; S.media = new Map(); await loadAll(); render();
}

const qByUid = uid => S.questions.find(q => q.uid === uid);
const vis = () => S.questions.filter(q => q.published !== false); // שאלות מוסתרות לא מוצגות למורים
const label = (map, k) => S.tax[map][k] || k || '—';
const mediaUrl = key => {
  if (!S.urls.has(key)) { const u8 = S.media.get(key); if (!u8) { queueMedia(key); return ''; } S.urls.set(key, URL.createObjectURL(new Blob([u8], { type: u8[0] === 0x89 ? 'image/png' : 'image/jpeg' }))); }
  return S.urls.get(key);
};

// שמירת מבחן: השהיה קצרה (350ms) לכל מבחן בנפרד. מעבר בין מבחנים, יצירת מבחן חדש, הסתרת הלשונית או סגירתה
// מבצעים שמירה מיידית של כל מה שממתין (בעבר טיימר משותף אחד גרם לאובדן שקט של עריכה אחרונה).
// כל שינוי במבחן עובר כאן, ולכן כאן גם מתעדכנים מיד התצוגה המקדימה, הסיכום והמונה (בלי תלות בשמירה לענן).
const saveTimers = new Map();
function saveExamSoon() {
  const ex = S.exam; ex.updatedAt = Date.now(); S.saveState = 'saving';
  const cur = saveTimers.get(ex.id); if (cur) clearTimeout(cur.timer);
  const ind = document.getElementById('saveind'); if (ind) ind.textContent = 'שומר…';
  saveTimers.set(ex.id, { exam: ex, timer: setTimeout(() => runSave(ex.id), 350) });
  refreshLive();
}
async function runSave(id) {
  const p = saveTimers.get(id); if (!p) return;
  clearTimeout(p.timer); saveTimers.delete(id); const ex = p.exam;
  const i2 = () => (ex === S.exam ? document.getElementById('saveind') : null);
  try {
    await store.saveExam(ex);
    S.saveState = 'saved';
    if (i2()) i2().textContent = 'נשמר ✓';                       // רק אחרי שהכתיבה באמת הושלמה
    if (S.sync?.msg?.startsWith('השמירה בענן')) S.sync = null;
  } catch (e) {
    if (e.code === 'sync-pending') { S.saveState = 'local'; if (i2()) i2().textContent = 'נשמר במחשב בלבד – ממתין לענן'; reportSync('מבחן', e); }
    else { S.saveState = 'failed'; if (i2()) i2().textContent = 'השמירה נכשלה'; toast('השמירה נכשלה: ' + (e.code || e.message)); console.error(e); }
    return;
  }
  try { S.exams = await store.loadExams(); syncUsage(); refreshBank(); } catch (e) { reportSync('רענון רשימת מבחנים', e); }   // כשל ברענון הרשימה אינו כשל שמירה
}
// אחרי שמירה: סימוני "השתמשת" ו"טרם נשמר" מתעדכנים ברשימת המאגר (בלי רענון מלא, כדי לא לאבד מיקום או מיקוד)
function refreshBank() {
  if (S.tab !== 'work' || S.mode === 'exam') return;
  const box = document.querySelector('.clist') || document.querySelector('[data-keep="banklist"]'); if (!box) return;
  const list = filtered(); box.innerHTML = bankRows(list, S.mode === 'search' ? 400 : 300);
  const c = document.querySelector('.listhead b'); if (c) c.textContent = `${list.length} שאלות`;
}
const flushSaves = () => Promise.all([...saveTimers.keys()].map(runSave));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushSaves(); flushUsage(); } });
window.addEventListener('pagehide', () => { flushSaves(); flushUsage(); });
// כשל לא צפוי בפעולה אסינכרונית לעולם לא נבלע בשקט
window.addEventListener('unhandledrejection', ev => {
  const e = ev.reason; console.error('unhandled:', e);
  if (e?.code === 'sync-pending') { reportSync('שמירה', e); ev.preventDefault(); return; }
  toast('הפעולה נכשלה: ' + (e?.code || e?.message || e)); ev.preventDefault();
});

// ---------- שימוש קודם בשאלות (אישי; מחושב ממבחנים שמורים + חריגים ידניים; נשמר ב-Drive האישי) ----------
let _sv = { exams: null, set: null };
const savedSet = () => (_sv.exams === S.exams ? _sv.set : (_sv = { exams: S.exams, set: savedUids(S.exams) }).set);
const usedBy = q => usedSource(S.usage, savedSet(), q.uid);                 // 'manual' | 'exam' | null
let usageTimer = null;
async function saveUsageNow() {
  usageTimer = null;
  try { await store.saveUsage(S.usage); }
  catch (e) { if (e.code === 'sync-pending') reportSync('שימוש בשאלות', e); else { logErr('שימוש בשאלות', e.message); toast('שמירת סימון השימוש נכשלה'); } }
}
function persistUsage() { clearTimeout(usageTimer); usageTimer = setTimeout(saveUsageNow, 400); }
function flushUsage() { if (usageTimer) { clearTimeout(usageTimer); saveUsageNow(); } }
function syncUsage() {                                                       // מבחן נמחק/שונה: חריגים ישנים מתנקים (לא כשיש תקלת טעינה, כדי לא לאבד החלטות ידניות)
  if (S.sync) return;
  const r = reconcile(S.usage, savedSet()); if (r.changed) { S.usage = r.usage; persistUsage(); }
}
function setUsed(uid, used) { S.usage = setManual(S.usage, savedSet(), uid, used); persistUsage(); }

// ---------- עדכון חי של התצוגה (בלי רענון מלא, בלי לאבד מיקום גלילה או מיקוד) ----------
let liveRaf = 0;
function measurePaper() {
  const p = document.getElementById('paper'); if (!p) return;
  const ph = p.offsetWidth * 29.7 / 21; p.style.setProperty('--ph', ph + 'px');
  const est = document.getElementById('pgest'); if (est) est.textContent = '≈ ' + Math.max(1, Math.ceil(p.scrollHeight / ph)) + ' עמודים (הערכה)';
}
function refreshLive() {
  if (liveRaf) return;
  liveRaf = requestAnimationFrame(() => {
    liveRaf = 0; const e = S.exam; if (!e) return;
    const pill = document.getElementById('pill'); if (pill) pill.textContent = `${questionsOf(e).length} שאלות · ${totalPoints(e)} נק׳`;
    const tb = document.getElementById('totalbar'); if (tb) { tb.classList.toggle('warn', totalPoints(e) !== e.targetPoints); const tt = document.getElementById('totaltxt'); if (tt) tt.innerHTML = totalHtml(totalPoints(e), e.targetPoints); }
    const wrap = document.querySelector('.paperwrap'); if (wrap) { wrap.outerHTML = paper(); measurePaper(); }
    const ol = document.getElementById('outline'); if (ol) ol.innerHTML = outlineInner();
  });
}
// הדגשה עדינה של פריט במבחן + גלילה אליו (מרחיב פרק מכווץ אם צריך)
function expandFor(id) {
  const e = S.exam, i = e.items.findIndex(x => x.id === id);
  for (let k = i - 1; k >= 0; k--) { const c = e.items[k]; if (c.type === 'chapter' && S.collapsed.has(c.id) && i < sectionRange(e, c.id)[1]) S.collapsed.delete(c.id); }
}
function flashItem(id) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = $app.querySelector(`.item[data-id="${id}"], .chap[data-id="${id}"], .freeblk[data-id="${id}"]`); if (!el) return;
    const box = el.closest('[data-keep]');                       // גוללים רק את הפאנל, לא את הדף כולו
    if (box) { const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(); box.scrollTo({ top: box.scrollTop + (r.top - b.top) - Math.min(120, b.height / 4), behavior: 'smooth' }); }
    else el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2000);
  }));
}

// ---------- חיפוש ----------
function srcLabel(q) { if (q.kind === 'personal') return 'שאלה אישית'; return q.kind === 'bagrut' ? `בגרות ${q.year ?? ''}${q.examCode ? ' · ' + q.examCode : ''}` : 'שאלה ממורה'; }
function filtered() {
  const f = S.f; const words = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const sv = savedSet();
  let r = vis().filter(q => {
    if (f.use !== 'all' && (f.use === 'used') !== isUsed(S.usage, sv, q.uid)) return false;
    if (f.domains.size && !f.domains.has(q.domainId)) return false;
    if (f.types.size && !f.types.has(q.typeId)) return false;
    if (f.kinds.size && !f.kinds.has(q.kind)) return false;
    if (f.years.size && !f.years.has(String(q.year))) return false;
    if (f.codes.size && !f.codes.has(String(q.examCode))) return false;
    if (words.length) { const t = q.searchText.toLowerCase(); if (!words.every(w => t.includes(w))) return false; }
    return true;
  });
  const idx = new Map(S.questions.map((q, i) => [q.uid, i]));
  const yr = q => (q.year ?? -1);
  if (S.sort === 'year-desc') r.sort((a, b) => yr(b) - yr(a) || idx.get(a.uid) - idx.get(b.uid));
  else if (S.sort === 'year-asc') r.sort((a, b) => yr(a) - yr(b) || idx.get(a.uid) - idx.get(b.uid));
  else r.sort((a, b) => label('domains', a.domainId).localeCompare(label('domains', b.domainId), 'he') || idx.get(a.uid) - idx.get(b.uid));
  return r;
}
const uniq = (arr) => [...new Set(arr.filter(x => x != null))];

// ---------- תצוגת תוכן ----------
function cellHtml(c) { const l = cellLines(c); return l.length ? l.map(esc).join('<br>') : '&nbsp;'; }
function blocksHtml(blocks, opts = {}) {
  return blocks.map(b => {
    if (b.type === 'text') return `<p>${esc(b.text)}</p>`;
    if (b.type === 'caption') return `<p><i>${esc(b.text)}</i></p>`;
    if (b.type === 'section') return `<div class="sec"><b>${esc(b.label)}.</b> ${esc(b.text)}${b.points != null && opts.pts !== false ? ` <span class="badge">${b.points} נק׳</span>` : ''}</div>`;
    if (b.type === 'choice') return `<div class="ch"><b>${esc(b.label)}.</b> ${esc(b.text)}</div>`;
    if (b.type === 'table') return `<table>${b.rows.map(r => `<tr>${r.map(c => `<td>${cellHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    if (b.type === 'image') return b.reference ? '' : `<img src="${mediaUrl(b.mediaKey)}" alt="${esc(b.caption || 'איור')}"${b.widthCm ? ` style="width:${Math.min(100, b.widthCm / 17 * 100)}%"` : ''}>`;
    return '';
  }).join('');
}
function rubricHtml(r) {
  if (!r) return '';
  const hasKey = r.answer.some(b => b.isKey);
  const body = r.answer.map(b => {
    if (b.isKey) return `<p><b>תשובה נכונה:</b> ${esc(b.text)}</p>`;
    if (b.type === 'image' && hasKey) return '';
    return blocksHtml([b]);
  }).join('');
  const lab = r.officialKind === 'official' ? 'מחוון רשמי' : 'תשובה (לפי מחבר השאלה)';
  return `<details class="rub"><summary>${lab}</summary>${body}${r.notes ? `<p><b>הנחיות בדיקה:</b> ${esc(r.notes)}</p>` : ''}${r.allocation.length ? `<p><b>חלוקת ניקוד:</b> ${r.allocation.map(a => esc(a.component) + ' – ' + (a.percent != null ? a.percent + '%' : esc(a.points ?? ''))).join('; ')}</p>` : ''}</details>`;
}
const badgesOf = q => [
  `<span class="badge src">${esc(srcLabel(q))}</span>`,
  `<span class="badge">${esc(label('domains', q.domainId))}</span>`,
  q.typeId ? `<span class="badge">${esc(label('types', q.typeId))}</span>` : '',
  q.rubric ? '<span class="badge ok">מחוון</span>' : '',
  q.blocks.some(b => b.type === 'table') ? '<span class="badge">טבלה</span>' : '',
  q.blocks.some(b => b.type === 'image' && !b.reference) ? '<span class="badge">תמונה</span>' : '',
  q.caseStudyId ? '<span class="badge">סיפור מקרה</span>' : '',
].join('');

// ---------- מסכים ----------
const TABS = [['home', 'דף הבית'], ['work', 'בניית מבחן'], ['exams', 'המבחנים שלי'], ['personal', 'המאגר האישי']];
function render() {
  closeHelp();
  const showAdmin = S.isAdmin || (import.meta.env.DEV && !S.user);   // בגרסת הייצור אין ממשק ניהול מקומי למורים
  if (S.tab === 'admin' && !showAdmin) S.tab = 'home';
  const keep = new Map(); $app.querySelectorAll('[data-keep]').forEach(el => keep.set(el.dataset.keep, el.scrollTop));
  const wy = window.scrollY, sameTab = render.tab === S.tab; render.tab = S.tab;
  const e = S.exam;
  const tabs = TABS.concat(showAdmin ? [['admin', S.user ? 'ניהול' : 'ניהול (מקומי)']] : []);
  const main = S.tab === 'home' ? homeHtml(S, { showAdmin, cloud: cloudConfigured() }) : S.tab === 'exams' ? examsHtml(S) : S.tab === 'work' ? workView() : S.tab === 'personal' ? personalView() : adminView();
  $app.innerHTML = `
  <header class="top">
    <h1><button class="brand" data-tab="home" aria-label="בונה מבחנים במדעי הבריאות – לדף הבית">בונה מבחנים <small>מדעי הבריאות</small></button></h1>
    <nav class="tabs" aria-label="ניווט ראשי">${tabs.map(([k, t]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}" ${S.tab === k ? 'aria-current="page"' : ''}>${t}</button>`).join('')}</nav>
    <span class="spacer"></span>
    <a class="btn sm helpnav" href="${GUIDE_URL}" target="_blank" rel="noopener" title="מדריך שימוש למורים (נפתח בלשונית חדשה)">${ICON.help.replace('width="24" height="24"', 'width="16" height="16"')} עזרה / איך משתמשים?</a>
    ${cloudConfigured() ? (S.user ? `<span class="pill user">${esc(S.user.name || 'מחובר')}</span><button class="btn sm" id="signout">התנתק</button>` : '<button class="btn sm primary" id="signin">התחברות עם Google</button>') : ''}
  </header>
  ${syncBarHtml()}
  ${!S.user && cloudConfigured() ? '<div class="warnbar">מצב מקומי: המאגר והמבחנים נשמרים בדפדפן הזה בלבד. התחברו עם Google כדי לראות את המאגר המרכזי ולשמור ב-Drive.</div>' : ''}
  <main class="${S.tab === 'work' ? 'm-' + S.mode : ''}" id="main" tabindex="-1">${main}</main>
  <footer class="credit">פותח על ידי אורי העליון</footer>
  ${S.modal && qByUid(S.modal) ? `<div class="modal" data-closemodal><div class="modalbox card" role="dialog" aria-modal="true" aria-label="פרטי שאלה"><button class="btn sm" data-closemodal style="float:inline-end">סגור ✕</button>${detailHtml(qByUid(S.modal))}</div></div>` : ''}`;
  $app.querySelectorAll('[data-keep]').forEach(el => { const v = keep.get(el.dataset.keep); if (v) el.scrollTop = v; });
  if (sameTab) window.scrollTo(0, wy); else window.scrollTo(0, 0);
  requestAnimationFrame(() => { measurePaper(); measureLayout(); updateTop(); });
}
// גובה אזור העבודה: הפאנלים במצב משולב מותאמים לגובה המסך (גלילה אחת לכל פאנל)
function measureLayout() { const m = document.querySelector('.split, .bank, .examwrap') || document.getElementById('main'); if (m) document.documentElement.style.setProperty('--maintop', Math.round(m.getBoundingClientRect().top + window.scrollY) + 'px'); }
window.addEventListener('resize', measureLayout);
function adminView() { return admin.view(); }

function workTools() {
  const modes = [['search', 'חיפוש בלבד'], ['split', 'משולב'], ['exam', 'מבחן בלבד']];
  return `<div class="worktools"><div class="seg" role="group" aria-label="מצב תצוגה">${modes.map(([k, t]) => `<button data-mode="${k}" class="${S.mode === k ? 'on' : ''}" aria-pressed="${S.mode === k}">${t}</button>`).join('')}</div>
    ${S.mode === 'split' ? `<div class="seg sm" role="group" aria-label="יחס רוחב בין המאגר למבחן"><span class="seglbl">רוחב:</span>${Object.entries(SPLITS).map(([k, [t]]) => `<button data-split="${k}" class="${S.split === k ? 'on' : ''}" aria-pressed="${S.split === k}">${t}</button>`).join('')}</div>` : ''}</div>`;
}
function workView() {
  if (S.mode === 'search') return workTools() + bankView();
  if (S.mode === 'exam') return `${workTools()}<div class="examwrap">${examPanel(false)}</div>`;
  const [, cols] = SPLITS[S.split];
  return `${workTools()}<div class="split" style="--cols:${cols}"><section class="splitL panel" data-keep="bank" aria-labelledby="bankttl"><h2 class="panelttl" id="bankttl">מאגר השאלות</h2>${bankCompact()}</section>
    <section class="splitR panel" data-keep="exam" aria-labelledby="examttl"><h2 class="panelttl" id="examttl">המבחן שלי</h2>${examPanel(true)}</section></div>`;
}

// ----- מאגר: שורות, קבוצות מקרה, סינון שימוש -----
const examCounts = () => { const m = new Map(); for (const i of S.exam.items) { const u = i.snap?.uid; if (u) m.set(u, (m.get(u) || 0) + 1); } return m; };
const titleOf = q => { const t = q.title || q.blocks.find(b => b.text)?.text || '(ללא כותרת)'; return t.length > 130 ? t.slice(0, 130) + '…' : t; };
function useSeg() {
  const opts = [['all', 'כל השאלות'], ['unused', 'לא השתמשתי'], ['used', 'כבר השתמשתי']];
  return `<div class="useline"><div class="seg sm useseg" role="group" aria-label="סינון לפי שימוש קודם">${opts.map(([k, t]) => `<button data-use="${k}" class="${S.f.use === k ? 'on' : ''}" aria-pressed="${S.f.use === k}">${t}</button>`).join('')}</div>${helpBtn('used')}</div>`;
}
function stateBadges(q, ec) {
  const u = usedBy(q), inEx = ec.get(q.uid) || 0;
  return (inEx ? `<span class="badge inx">במבחן הנוכחי${!u && !savedSet().has(q.uid) ? ' · טרם נשמר' : ''}</span>` : '') + (u ? `<span class="badge used" title="${u === 'manual' ? 'סימנת ידנית' : 'מופיעה במבחן שמור'}">השתמשת בה${u === 'manual' ? ' (סימון ידני)' : ''}</span>` : '');
}
function qRow(q, ec, inCase = false) {
  const inEx = ec.get(q.uid) || 0, used = usedBy(q);
  const sec = [q.rubric ? 'מחוון' : '', q.blocks.some(b => b.type === 'table') ? 'טבלה' : '', q.blocks.some(b => b.type === 'image' && !b.reference) ? 'תמונה' : '', q.caseStudyId && !inCase ? 'סיפור מקרה' : ''].filter(Boolean);
  return `<div class="qrow ${S.sel === q.uid ? 'sel' : ''} ${inEx ? 'inexam' : ''} ${inCase ? 'incase' : ''}" data-uid="${esc(q.uid)}">
    <input type="checkbox" data-chk="${esc(q.uid)}" ${S.checked.has(q.uid) ? 'checked' : ''} aria-label="בחירת השאלה">
    <div class="grow"><div class="t"><button class="qopen" data-uid="${esc(q.uid)}" dir="auto" aria-label="פתיחת פרטי השאלה: ${esc(titleOf(q).slice(0, 60))}">${esc(titleOf(q))}</button></div>
      <div class="s">${esc(label('domains', q.domainId))}${q.typeId ? ' · ' + esc(label('types', q.typeId)) : ''} · ${esc(srcLabel(q))}${q.kind === 'bagrut' && q.originalNumber ? ' · שאלה ' + esc(q.originalNumber) : ''}</div>
      <div class="tags">${stateBadges(q, ec)}${sec.map(x => `<span class="tag">${x}</span>`).join('')}</div></div>
    <div class="acts"><button class="btn sm ${inEx ? '' : 'primary'}" data-add="${esc(q.uid)}" aria-label="${inEx ? 'השאלה כבר במבחן – הצג אותה' : 'הוספת השאלה למבחן'}">${inEx ? '✓ במבחן' : '+ הוסף'}</button>
      <button class="linkbtn" data-usetoggle="${esc(q.uid)}">${used ? 'בטל סימון שימוש' : 'סמן כמשומשת'}</button></div></div>`;
}
function caseGroupHtml(g, ec) {
  const cs = S.cases.get(g.cid); const all = caseMembers(S.questions, g.cid);
  const open = S.caseOpen.has(g.cid) || !!S.f.text.trim();
  const inEx = all.filter(q => ec.has(q.uid)).length;
  const txt = cs.blocks.filter(b => b.text).map(b => b.text).join(' ');
  const full = inEx === all.length;
  return `<div class="cgroup ${open ? 'open' : ''}" data-cg="${esc(g.cid)}">
    <div class="cghead"><button class="btn sm tog" data-cgtoggle="${esc(g.cid)}" aria-expanded="${open}" aria-label="${open ? 'סגירת' : 'פתיחת'} שאלות סיפור המקרה">${open ? '▼' : '◀'}</button>
      <div class="grow"><div class="cgt"><span class="badge casebadge">סיפור מקרה</span>${helpBtn('case')} <span dir="auto">${esc(txt.slice(0, 120))}${txt.length > 120 ? '…' : ''}</span></div>
        <div class="s">${all.length} שאלות במקרה${g.qs.length < all.length ? ` · ${g.qs.length} מתאימות לסינון` : ''}${inEx ? ` · ${inEx} כבר במבחן` : ''}</div></div>
      <button class="btn sm primary" data-cgadd="${esc(g.cid)}" ${full ? 'disabled' : ''}>${full ? 'כל המקרה במבחן ✓' : inEx ? `הוסף את ${all.length - inEx} הנותרות` : `הוסף את כל ${all.length} השאלות`}</button></div>
    ${open ? `<div class="cgbody"><div class="casebox">${blocksHtml(cs.blocks)}</div>${g.qs.map(q => qRow(q, ec, true)).join('')}</div>` : ''}</div>`;
}
function bankRows(list, cap) {
  const ec = examCounts(); const rows = groupRows(list, id => S.cases.get(id)); let n = 0, out = '';
  for (const r of rows) { if (n >= cap) break; out += r.kind === 'q' ? qRow(r.q, ec) : caseGroupHtml(r, ec); n += r.kind === 'q' ? 1 : r.qs.length; }
  return (out || '<div class="empty">אין תוצאות. נסו לשנות את החיפוש או לאפס את המסננים.</div>') + (list.length > n ? `<div class="empty small">מוצגות ${n} מתוך ${list.length}. צמצמו את החיפוש כדי לראות את השאר.</div>` : '');
}
const filtersActive = () => Object.entries(S.f).reduce((n, [k, v]) => n + (v instanceof Set ? v.size : k === 'use' && v !== 'all' ? 1 : 0), 0);
// קבוצות מסננים מתקפלות. הבחירות (S.f) לעולם לא נמחקות בקיפול; מצב הפתיחה נשמר ב-localStorage
const FGROUPS = [['domains', 'תחומי ידע'], ['types', 'סוגי שאלות'], ['kinds', 'מקור'], ['years', 'שנת בחינה'], ['codes', 'נוספים · סמל שאלון']];
const fEntries = {
  domains: () => uniq(vis().map(q => q.domainId)).map(d => [d, label('domains', d)]),
  types: () => uniq(vis().map(q => q.typeId)).map(t => [t, label('types', t)]),
  kinds: () => uniq(vis().map(q => q.kind)).map(k => [k, KIND_LABEL[k] || k]),
  years: () => uniq(vis().map(q => q.year)).sort((a, b) => b - a).map(y => [y, y]),
  codes: () => uniq(vis().map(q => q.examCode)).map(c => [c, c]),
};
function filterGroup(key, title) {
  const ents = fEntries[key](); if (!ents.length) return '';
  const n = S.f[key].size, open = S.fopen.has(key);
  return `<div class="fgrp ${open ? 'open' : ''}"><button type="button" class="fghead" data-fg="${key}" aria-expanded="${open}" aria-controls="fg-${key}"><span class="chv" aria-hidden="true">${open ? '▾' : '◂'}</span><span>${title}${n ? ` · <b>${n} נבחרו</b>` : ''}</span></button>
    <div class="fgbody" id="fg-${key}" ${open ? '' : 'hidden'}>${ents.map(([v, l]) => `<label><input type="checkbox" data-f="${key}" value="${esc(v)}" ${S.f[key].has(String(v)) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>`;
}
const filterBlocks = () => FGROUPS.map(([k, t]) => filterGroup(k, t)).join('');
// פס מסננים פעילים: ברור למה התוצאות מצומצמות, והסרה בלחיצה (לא משנה את מנגנון הסינון)
function chipsHtml() {
  const c = [], f = S.f, nm = { domains: v => label('domains', v), types: v => label('types', v), kinds: v => KIND_LABEL[v] || v, years: v => v, codes: v => 'סמל ' + v };
  if (f.text.trim()) c.push(['text', '', 'חיפוש: ' + f.text.trim().slice(0, 24)]);
  for (const [k] of FGROUPS) for (const v of f[k]) c.push([k, v, nm[k](v)]);
  if (f.use !== 'all') c.push(['use', '', f.use === 'used' ? 'כבר השתמשתי' : 'לא השתמשתי']);
  if (!c.length) return '';
  return `<div class="fchips" role="group" aria-label="מסננים פעילים">${c.map(([k, v, l]) => `<button type="button" class="fchip" data-unf="${k}" data-unv="${esc(v)}" aria-label="הסרת המסנן: ${esc(l)}">${esc(l)} <span aria-hidden="true">✕</span></button>`).join('')}<button type="button" class="linkbtn" id="reset">נקה הכול</button></div>`;
}
const sortSel = () => `<select id="sort" aria-label="מיון"><option value="year-desc" ${S.sort === 'year-desc' ? 'selected' : ''}>חדש לישן</option><option value="year-asc" ${S.sort === 'year-asc' ? 'selected' : ''}>ישן לחדש</option><option value="domain" ${S.sort === 'domain' ? 'selected' : ''}>לפי נושא</option></select>`;

function bankCompact() {
  if (!S.questions.length) return '<div class="card empty">המאגר ריק. הוסיפו חבילות בלשונית "ניהול".</div>';
  const list = filtered(); const fa = filtersActive();
  return `<div class="bankhead">
    <input type="search" id="q" aria-label="חיפוש חופשי בטקסט" placeholder="חיפוש חופשי בטקסט…" value="${esc(S.f.text)}">
    ${useSeg()}
    <div class="fpanel"><button type="button" class="fghead top" data-fg="_panel" aria-expanded="${S.fopen.has('_panel')}" aria-controls="fg-_panel"><span class="chv" aria-hidden="true">${S.fopen.has('_panel') ? '▾' : '◂'}</span><span>מסננים${fa ? ` · <b>${fa} פעילים</b>` : ''}</span></button>
      <div class="filters" id="fg-_panel" ${S.fopen.has('_panel') ? '' : 'hidden'}>${filterBlocks()}</div></div>
    ${chipsHtml()}
    <div class="listhead"><b>${list.length} שאלות</b>${sortSel()}<span class="spacer"></span><button class="btn sm" id="selall">בחר הכול</button>
      <button class="btn primary sm" id="addchecked" ${S.checked.size ? '' : 'disabled'}>הוסף ${S.checked.size || ''} נבחרות</button></div></div>
    <div class="clist">${bankRows(list, 300)}</div>`;
}

function examPanel(compact) {
  const pvModes = compact ? [['edit', 'עריכה'], ['preview', 'תצוגה מקדימה']] : [['edit', 'עריכה'], ['both', 'עריכה + תצוגה'], ['preview', 'תצוגה מקדימה']];
  if (compact && S.pv === 'both') S.pv = 'edit';
  if (!compact && S.pv === 'edit' && !S._pvTouched) S.pv = 'both';
  const saveText = { saving: 'שומר…', saved: 'נשמר ✓', local: 'נשמר במחשב בלבד – ממתין לענן', failed: 'השמירה נכשלה' }[S.saveState] || '';
  const bar = `<div class="pvbar"><div class="seg sm" role="group" aria-label="תצוגת המבחן">${pvModes.map(([k, t]) => `<button data-pv="${k}" class="${S.pv === k ? 'on' : ''}" aria-pressed="${S.pv === k}">${t}</button>`).join('')}</div>
    ${S.pv !== 'edit' ? `<label class="chk"><input type="checkbox" data-pvt ${S.pvTeacher ? 'checked' : ''}> גרסת מורה (עם תשובות)</label>${helpBtn('teacher')}` : ''}
    <span class="spacer"></span><span id="saveind" class="badge savebadge ${S.saveState || ''}" role="status">${saveText}</span>${helpBtn('cloud')}</div>`;
  if (S.pv === 'preview') return bar + paper();
  if (S.pv === 'both' && !compact) return bar + `<div class="two"><div>${editHtml(false)}</div><div data-keep="paper">${paper()}</div></div>`;
  return bar + editHtml(compact);
}

function rubricOpen(r) {
  const hasKey = r.answer.some(b => b.isKey);
  const body = r.answer.map(b => b.isKey ? `<p><b>תשובה נכונה:</b> ${esc(b.text)}</p>` : (b.type === 'image' && hasKey ? '' : (b.type === 'image' && b.scanned ? '<p><i>המחוון הרשמי סרוק – יצורף כנספח במסמך.</i></p>' : blocksHtml([b])))).join('');
  return `<div class="p-rub"><b>${r.officialKind === 'official' ? 'מחוון רשמי' : 'תשובה (לפי מחבר השאלה)'}</b>${body}${r.notes ? `<p><b>הנחיות בדיקה:</b> ${esc(r.notes)}</p>` : ''}${r.allocation.length ? `<p><b>חלוקת ניקוד:</b> ${r.allocation.map(a => esc(a.component) + ' – ' + (a.percent != null ? a.percent + '%' : esc(a.points ?? ''))).join('; ')}</p>` : ''}</div>`;
}
function paper() {
  const e = S.exam, teacher = S.pvTeacher, first = caseFirstUse(e), tot = totalPoints(e);
  const pic = im => `<div class="pimg" style="${previewStyle(im)}"><img src="${mediaUrl(im.key)}" alt="" style="width:${Math.min(100, im.widthCm / 17 * 100)}%"></div>`;
  const spic = im => `<div class="pimg" style="${previewStyle({ ...im, widthCm: Math.min(im.widthCm, 6.5) }, 5.8)}"><img src="${mediaUrl(im.key)}" alt=""></div>`;
  let h = `<div class="paperwrap"><div class="pvnote">תצוגה משוערת של המסמך. מעברי עמוד ופריסה ב־Word עשויים להיות שונים מעט. <b id="pgest"></b></div><div class="paper tpl-${e.template === 'bagrut' ? 'bagrut' : 'modern'}" id="paper">`;
  if (e.school) h += `<div class="p-school">${esc(e.school)}</div>`;
  h += `<h2 class="p-title">${esc(e.title || 'מבחן')}</h2>`;
  if (teacher) h += '<div class="p-teacher">גרסת מורה – כולל תשובות ומחוונים</div>';
  const meta = [e.teacher && 'מורה: ' + e.teacher, e.date && 'תאריך: ' + e.date, e.showPoints && tot ? `סה״כ ${tot} נקודות` : null].filter(Boolean);
  if (meta.length) h += `<div class="p-meta">${meta.map(esc).join(' &nbsp;|&nbsp; ')}</div>`;
  if (!teacher) h += '<div class="p-name">שם התלמיד/ה: ____________________ &nbsp; כיתה: ________</div>';
  if (e.instructions) h += `<div class="p-instr"><b>הוראות</b>${e.instructions.split(/\n+/).map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
  h += '<hr>';
  if (!e.items.length) h += '<div class="empty">המבחן ריק. הוסיפו שאלות מהמאגר.</div>';
  let qn = 0;
  e.items.forEach(it => {
    if (it.type === 'chapter') { h += `<div class="p-chap l${it.level}">${esc(it.title || (it.level === 2 ? 'תת־פרק' : 'פרק'))}</div>`; return; }
    if (it.type === 'free') { h += `<div class="p-free">${String(it.text || '').split(/\n+/).filter(t => t.trim()).map(t => `<p>${esc(t)}</p>`).join('')}</div>`; return; }
    qn++; const i = qn - 1;
    const cid = first.get(it.id); if (cid) h += `<div class="p-case"><b>סיפור מקרה</b>${blocksHtml(e.cases[cid].blocks)}</div>`;
    if (it.pageBreak) h += '<div class="p-break">— התחלת עמוד חדש —</div>';
    const secs = it.snap.blocks.filter(b => b.type === 'section' && b.points != null);
    const secPts = e.showPoints && secs.length && secs.reduce((a, b) => a + b.points, 0) === Number(it.points);
    const imgs = it.images || [];
    const body = `<div class="qbody">${blocksHtml(it.snap.blocks, { pts: secPts })}</div>`;
    const side = imgs.filter(x => x.position === 'side').map(spic).join('');
    h += `<div class="p-q"><div class="p-qh">שאלה ${i + 1}${e.showPoints && it.points ? ` <span>(${it.points} נקודות)</span>` : ''}</div>`;
    h += imgs.filter(x => x.position === 'above').map(pic).join('');
    h += side ? `<div class="sidewrap">${body}<div class="sideimg">${side}</div></div>` : body;
    h += imgs.filter(x => x.position === 'below').map(pic).join('');
    if (!teacher && !isChoiceQuestion(it.snap.blocks) && it.answerLines > 0) h += '<div class="p-lines">' + '<div class="p-line"></div>'.repeat(Math.min(20, it.answerLines)) + '</div>';
    if (teacher && it.snap.rubric) h += rubricOpen(it.snap.rubric);
    h += '</div>';
  });
  return h + '</div></div>';
}

function bankView() {
  if (!S.questions.length) return `<div class="card empty">המאגר ריק. עברו ללשונית "ייבוא חבילות" וטענו קובצי ZIP.</div>`;
  const list = filtered();
  const cur = S.sel && qByUid(S.sel); const ecF = examCounts();
  return `<div class="bank">
    <aside class="card filters">
      <input type="search" id="q" aria-label="חיפוש חופשי בטקסט" placeholder="חיפוש חופשי בטקסט…" value="${esc(S.f.text)}">
      ${useSeg()}
      ${chipsHtml()}
      ${filterBlocks()}
    </aside>
    <section class="card list" data-keep="list">
      <div class="listhead">
        <b>${list.length} שאלות</b>
        ${sortSel()}
        <span class="spacer"></span>
        <button class="btn sm" id="selall">בחר הכול</button>
        <button class="btn primary sm" id="addchecked" ${S.checked.size ? '' : 'disabled'}>הוסף ${S.checked.size || ''} נבחרות למבחן</button>
      </div>
      <div data-keep="banklist">${bankRows(list, 400)}</div>
    </section>
    <section class="card detail" data-keep="detail">${cur ? detailHtml(cur) : '<div class="empty">בחרו שאלה מהרשימה להצגה מלאה</div>'}</section>
  </div>`;
}
function detailHtml(q) {
  const cs = q.caseStudyId && S.cases.get(q.caseStudyId);
  const inExam = S.exam.items.filter(i => i.snap?.uid === q.uid).length;
  const used = usedBy(q);
  return `<div class="detailacts"><button class="btn primary" data-add="${esc(q.uid)}">${inExam ? '✓ במבחן – הצג' : 'הוסף למבחן'}</button> ${inExam ? '<span class="badge inx">במבחן הנוכחי</span>' : ''}
    ${used ? `<span class="badge used">השתמשת בה${used === 'manual' ? ' (סימון ידני)' : ' (מופיעה במבחן שמור)'}</span>` : ''}
    <button class="btn sm" data-usetoggle="${esc(q.uid)}">${used ? 'בטל סימון שימוש' : 'סמן כמשומשת'}</button></div>
    <div style="margin:8px 0">${badgesOf(q)}${q.points != null ? `<span class="badge">${q.points} נק׳ במקור</span>` : ''}</div>
    ${cs ? `<div class="casebox"><h4>סיפור מקרה (משותף ל-${cs.questionIds.length} שאלות)</h4>${blocksHtml(cs.blocks)}</div>` : ''}
    <div class="qbody">${blocksHtml(q.blocks)}</div>
    ${rubricHtml(q.rubric)}`;
}

function editHtml(compact) {
  const e = S.exam; const tot = totalPoints(e); const diff = tot - e.targetPoints; const first = caseFirstUse(e);
  return `<div class="card">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <select id="examsel" aria-label="בחירת מבחן">${S.exams.some(x => x.id === e.id) ? '' : `<option value="${e.id}">${esc(e.title)} (לא נשמר)</option>`}${S.exams.map(x => `<option value="${x.id}" ${x.id === e.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>
      <button class="btn sm" id="newexam">מבחן חדש</button><button class="btn sm" id="dupexam">שכפל</button><button class="btn sm danger" id="delexam">מחק מבחן</button>
    </div>
    ${compact ? '<details><summary>פרטי המבחן והגדרות</summary>' : ''}<div class="exam-meta">
      <label>כותרת המבחן<input data-m="title" value="${esc(e.title)}"></label>
      <label>בית ספר<input data-m="school" value="${esc(e.school)}"></label>
      <label>שם המורה<input data-m="teacher" value="${esc(e.teacher)}"></label>
      <label>תאריך<input data-m="date" value="${esc(e.date)}" placeholder="למשל 05.11.2026"></label>
      <label>סך נקודות רצוי<input type="number" data-m="targetPoints" value="${e.targetPoints}"></label>
      <label>תבנית עיצוב<select data-m="template">${Object.values(TEMPLATES).map(t => `<option value="${t.id}" ${(e.template || 'modern') === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
      <label style="flex-direction:row;align-items:center;gap:6px;margin-top:18px"><input type="checkbox" data-m="showPoints" ${e.showPoints ? 'checked' : ''}> הצג ניקוד במסמך התלמיד</label>
    </div>
    <label class="exam-meta" style="display:block;margin-top:10px"><label>הוראות כלליות (אופציונלי)<textarea data-m="instructions" rows="2" style="width:100%">${esc(e.instructions)}</textarea></label></label>
  ${compact ? '</details>' : ''}</div>
  <div class="totalbar ${diff ? 'warn' : ''}" id="totalbar"><span id="totaltxt">${totalHtml(tot, e.targetPoints)}</span>
    <span class="spacer"></span>
    <button class="btn primary" id="exp-s" ${questionsOf(e).length ? '' : 'disabled'}>הפק Word לתלמיד</button>
    <button class="btn primary" id="exp-t" ${questionsOf(e).length ? '' : 'disabled'}>הפק Word למורה</button>
  </div>
  <div class="addbar" role="group" aria-label="הוספת רכיבים למבחן">
    <button class="btn sm" id="newq">+ שאלה חדשה</button>
    <button class="btn sm" id="newchap">+ פרק</button><button class="btn sm" id="newchap2">+ תת־פרק</button><button class="btn sm" id="newfree">+ טקסט חופשי</button>
    <button class="btn sm" id="eqsplit">חלוקת ניקוד שווה</button>
  </div>
  ${outlineHtml()}
  ${e.items.length ? e.items.map((it, i) => hiddenByCollapse(e, i) ? '' : itemHtml(it, i, first)).join('') : '<div class="card empty">המבחן ריק. הוסיפו שאלות מהמאגר.</div>'}`;
}
// כותרת קצרה לשאלה בכרטיס המבחן (כדי להבדיל בין כותרת פרק, כותרת שאלה וגוף השאלה)
function snippet(it) { const t = (it.snap.blocks.find(b => b.text)?.text || '').replace(/\s+/g, ' ').trim(); return t.length > 70 ? t.slice(0, 70) + '…' : t; }
// ניווט קומפקטי במבחן ארוך: פרקים ושאלות; לחיצה מגלגלת ומדגישה
function outlineInner() {
  let n = 0;
  return S.exam.items.map(it => {
    if (it.type === 'chapter') return `<button class="olchap l${it.level}" data-goto="${it.id}">${esc(it.title || (it.level === 2 ? 'תת־פרק' : 'פרק'))}</button>`;
    if (it.type === 'free') return '';
    n++; return `<button class="olq" data-goto="${it.id}" title="${esc(snippet(it))}">${n}</button>`;
  }).join('');
}
function outlineHtml() {
  const e = S.exam; if (e.items.length < 6 && !e.items.some(i => i.type === 'chapter')) return '';
  return `<details class="outlinebox" open><summary>ניווט במבחן</summary><div id="outline" class="outline">${outlineInner()}</div></details>`;
}
function totalHtml(tot, target) {
  const d = tot - target;
  return `<b>סה״כ ${tot} נקודות</b> (יעד ${target})${d ? ` · <b>אזהרה: ${d > 0 ? 'עודף' : 'חסר'} ${Math.abs(d)} נקודות</b> (ההפקה אינה חסומה)` : ' ✓'}`;
}
// כיווץ פרקים: נוחות עריכה בלבד (לא נשמר, לא משפיע על התצוגה המקדימה או על Word)
function hiddenByCollapse(e, i) {
  for (let k = i - 1; k >= 0; k--) {
    const c = e.items[k];
    if (c.type === 'chapter' && S.collapsed.has(c.id)) { const r = sectionRange(e, c.id); if (i < r[1]) return true; }
  }
  return false;
}
function chapterHtml(it, i) {
  const n = S.exam.items.length, r = sectionRange(S.exam, it.id), cnt = S.exam.items.slice(r[0] + 1, r[1]).filter(isQ).length, col = S.collapsed.has(it.id);
  return `<div class="chap l${it.level}" data-id="${it.id}"><span class="drag" draggable="true" data-dragh="${it.id}" title="גרירה (פרק נגרר עם תוכנו)">⠿</span>
    <button class="btn sm tog" data-collapse="${it.id}" title="${col ? 'הרחב' : 'כווץ'}" aria-expanded="${!col}">${col ? '◀' : '▼'}</button><span class="badge cnt">${cnt} שאלות</span>
    <input data-chtitle="${it.id}" value="${esc(it.title)}" placeholder="${it.level === 2 ? 'כותרת תת־פרק' : 'כותרת פרק'}">
    <label class="chk"><input type="checkbox" data-pb="${it.id}" ${it.pageBreak ? 'checked' : ''}> עמוד חדש</label>
    <button class="btn sm" data-chlevel="${it.id}" title="החלפה בין פרק לתת־פרק">${it.level === 2 ? 'הפוך לפרק' : 'הפוך לתת־פרק'}</button>
    <button class="btn sm" data-mv="up:${it.id}" ${i === 0 ? 'disabled' : ''}>▲</button><button class="btn sm" data-mv="down:${it.id}" ${i === n - 1 ? 'disabled' : ''}>▼</button>
    <button class="btn sm danger" data-rm="${it.id}" title="מוחק רק את הכותרת; השאלות נשארות">מחק</button></div>`;
}
function freeHtml(it, i) {
  const n = S.exam.items.length;
  return `<div class="freeblk" data-id="${it.id}"><div style="display:flex;gap:6px;align-items:center"><span class="drag" draggable="true" data-dragh="${it.id}" title="גרירה">⠿</span><b>טקסט חופשי</b><span class="spacer"></span>
    <button class="btn sm" data-mv="up:${it.id}" ${i === 0 ? 'disabled' : ''}>▲</button><button class="btn sm" data-mv="down:${it.id}" ${i === n - 1 ? 'disabled' : ''}>▼</button><button class="btn sm danger" data-rm="${it.id}">מחק</button></div>
    <textarea data-freetext="${it.id}" placeholder="הוראות, הסבר או כל טקסט שיופיע במבחן בין השאלות">${esc(it.text)}</textarea></div>`;
}
const ic = (name, n = 16) => ICON[name].replace('width="24" height="24"', `width="${n}" height="${n}"`);
const srcShort = q => q.kind === 'personal' ? 'שאלה אישית' : q.kind === 'draft' ? 'שאלה חדשה' : q.kind === 'bagrut' ? 'בגרות' + (q.year ? ' ' + q.year : '') : 'שאלה ממורה';
const ibtn = (attrs, icon, lbl, cls = '') => `<button type="button" class="ibtn ${cls}" ${attrs} title="${lbl}" aria-label="${lbl}">${ic(icon)}</button>`;
// "הוסף תמונה": תפריט אחד (תמונה מהמחשב / עמוד מ-PDF / כלי האיורים). kind: item | pq; id: מזהה פריט
function addImageMenu(kind, id = '') {
  const a = kind === 'item' ? { up: `data-upimg="${id}"`, pdf: `data-uppdf="${id}"` } : { up: 'data-pqimg', pdf: 'data-pqpdf' };
  return `<span class="addimg"><button type="button" class="btn sm" data-imgmenu aria-haspopup="menu" aria-expanded="false">${ic('image')} הוסף תמונה <span aria-hidden="true">▾</span></button>
    <div class="menu" role="menu" aria-label="הוספת תמונה" hidden>
      <button type="button" role="menuitem" data-pick="up">${ic('image')} תמונה מהמחשב</button>
      <button type="button" role="menuitem" data-pick="pdf" title="בחירת עמוד אחד מקובץ PDF (ההמרה במחשב שלך, בלי העלאה לשרת)">${ic('pdf')} עמוד מתוך PDF</button>
      <a role="menuitem" class="mi" data-anatomy href="${ANATOMY_TOOL_URL}" target="_blank" rel="noopener">${ic('search')} כלי האיורים האנטומיים ↗</a></div>
    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" ${a.up} hidden tabindex="-1"><input type="file" accept="application/pdf,.pdf" ${a.pdf} hidden tabindex="-1"></span>`;
}
function itemHtml(it, i, first) {
  if (it.type === 'chapter') return chapterHtml(it, i);
  if (it.type === 'free') return freeHtml(it, i);
  const cid = first.get(it.id); const editing = S.editing.has(it.id);
  const isMC = isChoiceQuestion(it.snap.blocks), n = S.exam.items.length, sn = it.snap, dom = sn.domainId ? label('domains', sn.domainId) : '';
  return `${cid ? `<div class="card casebox"><h4>סיפור מקרה – מוצג פעם אחת לפני שאלה ${qNumber(S.exam, it.id)} <label style="float:inline-end"><input type="checkbox" data-casein="${esc(cid)}" checked> כלול</label></h4>${blocksHtml(S.exam.cases[cid].blocks)}</div>` : ''}
  <div class="card item cmp" data-id="${it.id}">
    <div class="ih1"><span class="drag" draggable="true" data-dragh="${it.id}" title="גרירה לשינוי סדר" aria-hidden="true">${ic('grip', 18)}</span><span class="num">שאלה ${qNumber(S.exam, it.id)}</span>
      <span class="mvs">${ibtn(`data-mv="up:${it.id}" ${i === 0 ? 'disabled' : ''}`, 'up', 'הזזת השאלה למעלה')}${ibtn(`data-mv="down:${it.id}" ${i === n - 1 ? 'disabled' : ''}`, 'down', 'הזזת השאלה למטה')}</span>
      <span class="ibadges"><span class="badge src">${esc(srcShort(sn))}</span>${dom ? `<span class="badge">${esc(dom)}</span>` : ''}${sn.rubric ? '<span class="badge ok">מחוון</span>' : ''}</span></div>
    <div class="ih2">
      <label class="fld">נק׳ <input class="n3" type="number" min="0" max="999" inputmode="numeric" data-pts="${it.id}" value="${it.points ?? ''}" aria-label="ניקוד השאלה"></label>
      ${isMC ? '' : `<label class="fld">שורות <input class="n2" type="number" min="0" max="20" inputmode="numeric" data-lines="${it.id}" value="${it.answerLines}" aria-label="מספר שורות לתשובה"></label>`}
      <label class="chk"><input type="checkbox" data-pb="${it.id}" ${it.pageBreak ? 'checked' : ''}> עמוד חדש</label>
      <button type="button" class="btn sm" data-chapbefore="${it.id}" title="הוספת כותרת פרק לפני השאלה הזאת">+ פרק כאן</button>
      <button type="button" class="btn sm" data-edit="${it.id}">${editing ? 'סיום עריכה' : 'ערוך עותק'}</button>
      ${addImageMenu('item', it.id)}
      ${sn.kind === 'draft' ? `<button type="button" class="btn sm" data-savepq="${it.id}">שמור במאגר האישי</button>` : ''}
      ${ibtn(`data-rm="${it.id}"`, 'trash', 'מחיקת השאלה מהמבחן', 'danger push')}</div>
    ${imagesPanelHtml(it)}
    ${it.edited ? '<div class="editnote">השאלה נערכה. מומלץ לבדוק אם יש צורך לעדכן את הניקוד</div>' : ''}
    ${editing ? editorHtml(it) : previewHtml(it)}
  </div>`;
}
function previewHtml(it) {
  const imgs = it.images || [];
  const pic = im => `<div class="pimg" style="${previewStyle(im)}"><img src="${mediaUrl(im.key)}" alt="${esc(im.name)}" style="width:${Math.min(100, im.widthCm / 17 * 100)}%"></div>`;
  const above = imgs.filter(i => i.position === 'above').map(pic).join('');
  const below = imgs.filter(i => i.position === 'below').map(pic).join('');
  const side = imgs.filter(i => i.position === 'side').map(i => `<div class="pimg" style="${previewStyle({ ...i, widthCm: Math.min(i.widthCm, 6.5) }, 5.8)}"><img src="${mediaUrl(i.key)}" alt="${esc(i.name)}"></div>`).join('');
  const body = `<div class="qbody">${blocksHtml(it.snap.blocks)}</div>`;
  return side ? `${above}<div class="sidewrap">${body}<div class="sideimg">${side}</div></div>${below}` : `${above}${body}${below}`;
}
function imagesPanelHtml(it) {
  const imgs = it.images || []; if (!imgs.length) return '';
  return `<div class="imgpanel">
    ${imgs.map(im => `<div class="uimg"><img src="${mediaUrl(im.key)}" alt="${esc(im.name)}">
      <div><div class="s">${esc(im.name)}</div>
      <label>רוחב (ס״מ) <input type="number" min="2" max="17" step="0.5" data-imgw="${it.id}:${im.id}" value="${im.widthCm}"></label>
      <label>מיקום <select data-imgpos="${it.id}:${im.id}"><option value="above" ${im.position === 'above' ? 'selected' : ''}>מעל השאלה</option><option value="below" ${im.position === 'below' ? 'selected' : ''}>מתחת לשאלה</option><option value="side" ${im.position === 'side' ? 'selected' : ''}>לצד השאלה</option></select></label>
      <div class="imgnudge" title="כוונון עדין (צעד 0.25 ס״מ). התמונה נשארת בתוך העמוד ולא מכסה טקסט"><span class="s">הזזה:</span>${['l:←:שמאלה', 'r:→:ימינה', 'u:↑:למעלה', 'd:↓:למטה'].map(x => { const [k, g, n] = x.split(':'); return `<button class="btn sm" data-nudge="${it.id}:${im.id}:${k}" title="${n}">${g}</button>`; }).join('')}<button class="btn sm" data-nudge="${it.id}:${im.id}:reset" title="חזרה למיקום המקורי" ${normOffsets(im).dx || normOffsets(im).dy ? '' : 'disabled'}>איפוס</button></div>
      <button class="btn sm danger" data-rmimg="${it.id}:${im.id}">הסר</button></div></div>`).join('')}
  </div>`;
}
function editorHtml(it) {
  return it.snap.blocks.map((b, bi) => {
    const del = `<button class="btn sm danger" data-delblk="${it.id}:${bi}" title="מחק רכיב">✕</button>`;
    if (b.type === 'text' || b.type === 'caption') return `<div class="blkedit"><textarea data-blk="${it.id}:${bi}">${esc(b.text)}</textarea>${del}</div>`;
    if (b.type === 'section' || b.type === 'choice') return `<div class="blkedit"><div><b>${esc(b.label)}.</b><textarea data-blk="${it.id}:${bi}">${esc(b.text)}</textarea></div>${del}</div>`;
    const size = b.type === 'image' && !b.reference ? `<label>רוחב במסמך (ס״מ) <input type="number" min="2" max="17" step="0.5" placeholder="אוטומטי" data-blkw="${it.id}:${bi}" value="${b.widthCm ?? ''}"></label>` : '';
    return `<div class="blkedit"><div class="qbody">${blocksHtml([b]) || '<i>(תמונת בקרה מוסתרת)</i>'}${size}</div>${del}</div>`;
  }).join('') + `<button class="btn sm" data-addblk="${it.id}">+ הוסף פסקה</button>`;
}

function sugOf(uid) { return S.suggestions.find(s => s.id === 'sg-' + uid); }
function personalView() {
  if (S.pq) return pqForm();
  const qu = quotaUsage(S.suggestions);
  return `<div class="card"><div style="display:flex;gap:8px;align-items:center"><b>המאגר האישי שלי (${S.personal.length})</b><span class="spacer"></span><button class="btn primary" data-pqnew>+ שאלה חדשה</button></div>
    <p class="hint" style="color:var(--muted)">שאלות אישיות גלויות רק לך. שאלה שתציע למאגר הכללי תופיע שם רק אחרי אישור המנהל. ${helpBtn('suggest')}</p>
    <div class="pnote" role="note"><span>השאלות שיצרת כאן זמינות גם בעת בניית מבחן. כדי למצוא אותן, עבור לחיפוש השאלות ובחר במקור ״המאגר האישי שלי״.</span> <button type="button" class="btn sm" data-pqsearch>חיפוש במאגר האישי שלי</button></div>
    ${S.user && !S.isAdmin ? `<p class="hint quotaline">הצעות שממתינות לבדיקה: <b>${qu.pending}</b> מתוך ${LIMITS.pending} · תמונות בהצעות ממתינות: <b>${qu.images}</b> מתוך ${LIMITS.imagesTotal} · עד ${LIMITS.imagesPerSuggestion} תמונות בהצעה, עד 2MB לתמונה.</p>` : ''}</div>
    ${S.personal.map(q => { const sg = sugOf(q.uid); return `<div class="card item"><div class="hd"><b>${esc(q.title || q.blocks.find(b => b.text)?.text.slice(0, 70) || '(ללא כותרת)')}</b><span>${badgesOf(q)}</span>
      <span class="ctrl">${sg ? `<span class="badge">${sg.status === 'pending' ? 'ממתינה לאישור' : sg.status === 'approved' ? 'אושרה' : 'נדחתה'}</span>` : `<label><input type="checkbox" data-sgcredit="${esc(q.uid)}"> הוסף קרדיט בשמי</label><button class="btn sm" data-suggest="${esc(q.uid)}">הצע למאגר הכללי</button>`}
      <button class="btn sm" data-addp="${esc(q.uid)}">הוסף למבחן</button><button class="btn sm" data-pqedit="${esc(q.uid)}">ערוך</button><button class="btn sm danger" data-pqdel="${esc(q.uid)}">מחק</button></span></div>
      <div class="qbody">${blocksHtml(q.blocks)}</div></div>`; }).join('') || '<div class="card empty">אין עדיין שאלות אישיות.</div>'}`;
}
function pqForm() {
  const p = S.pq; const miss = p.error ? { src: !p.sourceKind, dom: !p.domainId, body: p.error === 'חסר תוכן לשאלה' } : {};
  const req = '<span class="req" title="שדה חובה">חובה</span>';
  const list = (k, arr) => arr.map((v, i) => `<div class="blkedit"><div><b>${LETTERS[i] || i + 1}.</b><textarea data-pql="${k}:${i}" rows="2" aria-label="${k === 'sections' ? 'סעיף' : 'אפשרות'} ${LETTERS[i] || i + 1}">${esc(v)}</textarea></div><button class="btn sm danger" data-pqrm="${k}:${i}" aria-label="הסרה">✕</button></div>`).join('');
  return `<div class="card item pqform"><div class="pqhead"><b>${p.uid ? 'עריכת שאלה אישית' : 'שאלה חדשה'}</b></div>
    ${p.error ? `<div class="editnote" role="alert">${esc(p.error)}</div>` : ''}
    <div class="pqgrid">
      <fieldset class="pqmeta"><legend>פרטי השאלה</legend>
        <label class="${miss.src ? 'bad' : ''}">מקור ${req}<select data-pq="sourceKind">${Object.entries(SOURCE_OPTIONS).map(([k, l]) => `<option value="${k}" ${p.sourceKind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>פרטי מקור <small>(אופציונלי)</small><input data-pq="sourceText" value="${esc(p.sourceText)}"></label>
        <label class="${miss.dom ? 'bad' : ''}">תחום עיקרי ${req}<select data-pq="domainId"><option value="">בחרו…</option>${Object.entries(S.tax.domains).map(([k, l]) => `<option value="${k}" ${p.domainId === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label>סוג שאלה <small>(אופציונלי)</small><select data-pq="typeId"><option value="">—</option>${Object.entries(S.tax.types).map(([k, l]) => `<option value="${k}" ${p.typeId === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label>כותרת לחיפוש <small>(אופציונלי)</small><input data-pq="title" value="${esc(p.title)}"></label>
      </fieldset>
      <div class="pqwrite">
        <label class="${miss.body ? 'bad' : ''}"><span class="lbl">גוף השאלה ${req} <small>(אפשר להשאיר ריק אם יש סעיפים או אפשרויות)</small></span><textarea class="pqbody" rows="9" data-pq="body">${esc(p.body)}</textarea></label>
        <div class="imgpanel">${addImageMenu('pq')}${p.images.map((im, i) => `<span class="uimg" style="width:auto"><img src="${mediaUrl(im.key)}" alt=""> <button class="btn sm danger" data-pqrm="images:${i}">הסר</button></span>`).join('')}</div>
        <div class="pqsec"><b>סעיפים</b> <small>(אופציונלי)</small>${list('sections', p.sections)}<button class="btn sm" data-pqadd="sections">+ סעיף</button></div>
        <div class="pqsec"><b>אפשרויות תשובה</b> <small>(לשאלת רב־ברירה)</small>${list('choices', p.choices)}<button class="btn sm" data-pqadd="choices">+ אפשרות</button></div>
        <label class="pqans"><span class="lbl">תשובה / מחוון <small>(אופציונלי)</small></span><textarea rows="4" data-pq="answer">${esc(p.answer)}</textarea></label>
      </div>
    </div>
    <p class="pqbtns"><button class="btn primary" data-pqsave>שמור במאגר האישי</button> <button class="btn" data-pqcancel>ביטול</button></p></div>`;
}

function importView() {
  return `<div class="card">
    <div class="drop" id="drop">גררו לכאן קובצי ZIP של חבילות שאלות, או <input type="file" id="files" accept=".zip" multiple></div>
    ${import.meta.env.DEV ? '<p><button class="btn sm" id="devload">טען חבילות לדוגמה מתיקיית samples (פיתוח בלבד)</button></p>' : ''}
    ${S.importReports.map(r => `<div class="rep ${r.errors.length ? 'bad' : ''}"><b>${esc(r.fileName)}</b>: ${r.errors.length ? 'נכשל – ' + esc(r.errors.join('; ')) : `נקלטו ${r.summary}`}
      ${r.warnings.length ? `<br>אזהרות: ${esc(r.warnings.join('; '))}` : ''}${r.ignored.length ? `<br>קבצים שאינם חלק מהחבילה (התעלמות): ${esc(r.ignored.join(', '))}` : ''}${r.corrections ? `<br>תוקנו אוטומטית ${r.corrections} שיבושי חילוץ ברורים (הנוסח המקורי נשמר)` : ''}</div>`).join('')}
  </div>
  <div class="card" style="margin-top:12px"><b>חבילות במאגר</b>
    ${S.packages.length ? S.packages.map(p => `<div class="rep">${esc(p.fileName)} · ${KIND_LABEL[p.kind]} · ${p.questionCount} שאלות · ${p.mediaCount} תמונות · ${p.caseCount} סיפורי מקרה <button class="btn sm danger" data-rmpkg="${esc(p.id)}">הסר</button></div>`).join('') : '<div class="empty">אין חבילות</div>'}</div>`;
}

async function importFiles(fileList, opts = { publish: true }) {
  S.importReports = [];
  for (const f of fileList) {
    const r = await parsePackage(await f.arrayBuffer(), f.name);
    const rep = { ...r.report, summary: '' };
    if (!r.report.errors.length) {
      try {
        const res = await store.importPackage(r, { publish: opts.publish !== false });
        rep.summary = `${r.questions.length} שאלות בחבילה (${KIND_LABEL[r.pkg.kind]}): נוספו ${res.added}, דולגו כזהות ${res.skipped}, סומנו לבדיקה (גרסה שונה) ${res.conflicts}; ${res.mediaAdded} תמונות חדשות${opts.publish === false ? ' · יובאו כמוסתרות' : ''}`;
      } catch (e) { rep.errors.push('שמירה מקומית נכשלה: ' + e.message); }
    }
    S.importReports.push(rep);
  }
  await loadAll(); render();
}
async function devLoad() {
  const names = await (await fetch('/__samples/')).json(); const files = [];
  for (const n of names) files.push(new File([await (await fetch('/__samples/' + encodeURIComponent(n))).arrayBuffer()], n));
  return importFiles(files, { publish: true });
}

// ---------- אירועים ----------
$app.addEventListener('click', async e => {
  if (e.target.tagName === 'IMG' && e.target.closest('.qbody, .rub, .casebox, .uimg')) { return openLightbox(e.target.src); }
  if (e.target.closest('[data-closemodal]') && (e.target.matches('.modal') || e.target.closest('button[data-closemodal]'))) { S.modal = null; return render(); }
  const t = e.target.closest('button, .qrow, .excard'); if (!t) return;
  const d = t.dataset;
  if (e.target.closest('[data-admchk]')) return;
  if (d.adm !== undefined && await admin.click(t, d)) return;
  if (d.mode) { S.mode = d.mode; localStorage.setItem('mode', d.mode); if (d.mode !== 'exam' && S.pv === 'both') S.pv = 'edit'; S._pvTouched = false; return render(); }
  if (d.split) { S.split = d.split; localStorage.setItem('split', d.split); return render(); }
  if (d.use) { S.f.use = d.use; return render(); }
  if (d.pv) { S.pv = d.pv; S._pvTouched = true; return render(); }
  if (d.tab) { S.tab = d.tab; return render(); }
  if (d.home) return homeAction(d.home);
  if (d.openexam) { await flushSaves(); const x = S.exams.find(v => v.id === d.openexam); if (x) { S.exam = clone(x); S.editing.clear(); S.saveState = null; S.tab = 'work'; if (S.mode === 'search') S.mode = 'split'; } return render(); }
  if (d.dupex) { await flushSaves(); const x = S.exams.find(v => v.id === d.dupex); if (!x) return; const c = clone(x); c.id = newExam().id; c.title += ' (עותק)'; S.exam = c; S.editing.clear(); saveExamSoon(); toast('נוצר עותק של המבחן'); S.tab = 'work'; return render(); }
  if (d.delex) return deleteExamFlow(d.delex);
  if (d.renex) return renameExamFlow(d.renex);
  if (d.goto) { expandFor(d.goto); render(); return flashItem(d.goto); }
  if (d.usetoggle) { const q = qByUid(d.usetoggle); const was = !!usedBy(q); setUsed(q.uid, !was); toast(was ? 'הסימון בוטל – השאלה חזרה ל"לא השתמשתי"' : 'השאלה סומנה כמשומשת'); return render(); }
  if (d.cgtoggle) { S.caseOpen.has(d.cgtoggle) ? S.caseOpen.delete(d.cgtoggle) : S.caseOpen.add(d.cgtoggle); return render(); }
  if (d.cgadd) return addToExam(caseMembers(S.questions, d.cgadd));
  if (d.chapbefore) { const at = S.exam.items.findIndex(x => x.id === d.chapbefore); const c = { id: uid(), type: 'chapter', level: 1, title: '', pageBreak: false }; S.exam.items.splice(at, 0, c); saveExamSoon(); render(); setTimeout(() => document.querySelector(`[data-chtitle="${c.id}"]`)?.focus(), 30); return; }
  if (t.id === 'signin') return signInFlow();
  if (t.id === 'retrysync') return retrySync();
  if (t.id === 'retrybank') { try { await loadAll(); } catch (err) { logErr('טעינה', err.message); } return render(); }
  if (t.id === 'signout') return signOutFlow();
  if (t.id === 'reset') { S.f = emptyFilters(); return render(); }
  if (d.unf) { const k = d.unf; if (k === 'text') S.f.text = ''; else if (k === 'use') S.f.use = 'all'; else S.f[k].delete(d.unv); return render(); }
  if (d.fg) {                                                   // קיפול/פתיחה בלי רינדור מחדש (שומר מיקוד וגלילה)
    const open = !S.fopen.has(d.fg); open ? S.fopen.add(d.fg) : S.fopen.delete(d.fg); localStorage.setItem('fopen', JSON.stringify([...S.fopen]));
    t.setAttribute('aria-expanded', open); t.querySelector('.chv').textContent = open ? '▾' : '◂'; const body = document.getElementById('fg-' + d.fg); if (body) body.hidden = !open; t.closest('.fgrp')?.classList.toggle('open', open); return;
  }
  if (t.id === 'selall') { filtered().forEach(q => S.checked.add(q.uid)); return render(); }
  if (t.id === 'addchecked') { const qs = S.questions.filter(q => S.checked.has(q.uid)); S.checked.clear(); return addToExam(qs); }
  if (d.add) return addToExam([qByUid(d.add)]);
  if (d.uid && !e.target.matches('input')) { S.sel = d.uid; if (S.mode === 'split') S.modal = d.uid; return render(); }
  if (d.nudge) { const [a, b, k] = d.nudge.split(':'); const it = S.exam.items.find(i => i.id === a), im = it.images.find(i => i.id === b); const side = im.position === 'side', tmp = { ...im, widthCm: side ? Math.min(im.widthCm, 6.5) : im.widthCm }; nudge(tmp, k, side ? 5.8 : 17); im.dx = tmp.dx; im.dy = tmp.dy; saveExamSoon(); return render(); }
  if (d.rmimg) { const [a, b] = d.rmimg.split(':'); const it = S.exam.items.find(i => i.id === a); it.images = it.images.filter(i => i.id !== b); saveExamSoon(); return render(); }
  if (d.mv) { const [dir, id] = d.mv.split(':'); moveItem(S.exam, id, dir === 'up' ? -1 : 1); saveExamSoon(); return render(); }
  if (d.rm) { removeItem(S.exam, d.rm); saveExamSoon(); return render(); }
  if (d.edit) { S.editing.has(d.edit) ? S.editing.delete(d.edit) : S.editing.add(d.edit); return render(); }
  if (d.delblk) { const [id, bi] = d.delblk.split(':'); const it = S.exam.items.find(i => i.id === id); it.snap.blocks.splice(+bi, 1); it.edited = true; saveExamSoon(); return render(); }
  if (d.addblk) { const it = S.exam.items.find(i => i.id === d.addblk); it.snap.blocks.push({ type: 'text', text: '' }); it.edited = true; saveExamSoon(); return render(); }
  if (t.id === 'newchap' || t.id === 'newchap2') { const c = addChapter(S.exam, t.id === 'newchap2' ? 2 : 1, ''); saveExamSoon(); render(); setTimeout(() => document.querySelector(`[data-chtitle="${c.id}"]`)?.focus(), 30); return; }
  if (t.id === 'newfree') { const f = addFree(S.exam, ''); saveExamSoon(); render(); setTimeout(() => document.querySelector(`[data-freetext="${f.id}"]`)?.focus(), 30); return; }
  if (d.collapse) { S.collapsed.has(d.collapse) ? S.collapsed.delete(d.collapse) : S.collapsed.add(d.collapse); return render(); }
  if (d.chlevel) { const c = S.exam.items.find(x => x.id === d.chlevel); c.level = c.level === 2 ? 1 : 2; saveExamSoon(); return render(); }
  if (t.id === 'newq') { const it = { id: uid(), snap: { uid: 'draft-' + uid(), kind: 'draft', year: null, examCode: null, originalNumber: null, typeId: null, domainId: null, originalPoints: null, caseStudyId: null, blocks: [{ type: 'text', text: '' }], rubric: null }, edited: false, points: null, answerLines: 3, pageBreak: false, images: [] }; S.exam.items.push(it); S.editing.add(it.id); saveExamSoon(); return render(); }
  if (d.savepq) { S.pq = itemToDraft(S.exam.items.find(i => i.id === d.savepq)); S.tab = 'personal'; return render(); }
  if (d.pqsearch !== undefined) { S.f = emptyFilters(); S.f.kinds.add('personal'); S.tab = 'work'; S.mode = 'search'; localStorage.setItem('mode', 'search'); return render(); }
  if (d.pqnew !== undefined) { S.pq = emptyDraft(); return render(); }
  if (d.pqedit) { S.pq = questionToDraft(S.personal.find(q => q.uid === d.pqedit)); return render(); }
  if (d.pqcancel !== undefined) { S.pq = null; return render(); }
  if (d.pqadd) { S.pq[d.pqadd].push(''); return render(); }
  if (d.pqrm) { const [k, i] = d.pqrm.split(':'); S.pq[k].splice(+i, 1); return render(); }
  if (d.pqsave !== undefined) {
    const err = validateDraft(S.pq); if (err) { S.pq.error = err; return render(); }
    const q = draftToQuestion(S.pq);
    try { await store.savePersonalQuestion(q); } catch (e) { if (e.code === 'sync-pending') reportSync('שאלה אישית', e); else { S.pq.error = 'השמירה נכשלה: ' + (e.code || e.message); return render(); } }
    S.personal = await store.loadPersonal(); S.questions = S.questions.filter(x => x.kind !== 'personal').concat(S.personal);
    S.pq = null; toast('השאלה נשמרה במאגר האישי'); return render();
  }
  if (d.pqdel) { if (!await ask({ title: 'למחוק את השאלה האישית?', text: 'מבחנים שכבר כוללים אותה לא ישתנו.', ok: 'מחיקה', danger: true })) return; await store.deletePersonalQuestion(d.pqdel); S.personal = await store.loadPersonal(); S.questions = S.questions.filter(x => x.kind !== 'personal').concat(S.personal); return render(); }
  if (d.addp) return addToExam([qByUid(d.addp)]);
  if (d.suggest) return suggestFlow(d.suggest);
  if (t.id === 'eqsplit') { equalSplit(S.exam); saveExamSoon(); return render(); }
  if (t.id === 'newexam') { await newExamFlow(); return render(); }
  if (t.id === 'dupexam') { const c = clone(S.exam); c.id = newExam().id; c.title += ' (עותק)'; S.exam = c; saveExamSoon(); return render(); }
  if (t.id === 'delexam') return deleteExamFlow(S.exam.id);
  if (t.id === 'exp-s' || t.id === 'exp-t') return exportDoc(t.id === 'exp-t' ? 'teacher' : 'student');
  if (d.rmpkg) { if (!await ask({ title: 'להסיר את החבילה מהמאגר המקומי?', text: 'מבחנים קיימים שומרים עותקים של השאלות.', ok: 'הסרה', danger: true })) return; await store.removePackage(d.rmpkg); await loadAll(); return render(); }
  if (t.id === 'devload') {
    const names = await (await fetch('/__samples/')).json(); const files = [];
    for (const n of names) files.push(new File([await (await fetch('/__samples/' + encodeURIComponent(n))).arrayBuffer()], n));
    return importFiles(files);
  }
});
$app.addEventListener('change', async e => {
  const t = e.target; const d = t.dataset;
  if (await admin.change(t, d)) return;
  if (d.pvt !== undefined) { S.pvTeacher = t.checked; return render(); }
  if (t.id === 'files') return importFiles([...t.files], { publish: S.adm.publishOnImport });
  if (t.id === 'exsort') { S.exSort = t.value; localStorage.setItem('exSort', t.value); return render(); }
  if (t.id === 'sort') { S.sort = t.value; return render(); }
  if (t.id === 'examsel') { await flushSaves(); const x = S.exams.find(v => v.id === t.value); if (x) S.exam = clone(x); S.editing.clear(); S.saveState = null; return render(); }
  if (d.f) { t.checked ? S.f[d.f].add(t.value) : S.f[d.f].delete(t.value); render(); document.querySelector(`input[data-f="${d.f}"][value="${CSS.escape(t.value)}"]`)?.focus(); return; }
  if (d.chk) { t.checked ? S.checked.add(d.chk) : S.checked.delete(d.chk); return render(); }
  if (d.m) {
    S.exam[d.m] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    saveExamSoon(); if (['targetPoints', 'showPoints', 'template'].includes(d.m)) return render(); return;
  }
  if (d.pts) { const it = S.exam.items.find(i => i.id === d.pts); it.points = t.value === '' ? null : Math.min(999, Math.max(0, Math.round(Number(t.value) || 0))); if (it.points != null) t.value = it.points; saveExamSoon(); return; }
  if (d.lines) { const it = S.exam.items.find(i => i.id === d.lines); it.answerLines = Math.min(20, Math.max(0, Math.round(Number(t.value) || 0))); t.value = it.answerLines; saveExamSoon(); return; }
  if (d.pb) { S.exam.items.find(i => i.id === d.pb).pageBreak = t.checked; saveExamSoon(); return; }
  if (d.pq) { S.pq[d.pq] = t.value; return; }
  if (t.dataset.pqimg !== undefined) {
    const f = t.files[0]; if (!f) return;
    try { const { data, name } = await prepareImage(f); const id = uid(); const key = 'user/' + id; await putUserMedia(key, data); S.pq.images.push({ key, name }); return render(); }
    catch (err) { return toast('העלאת התמונה נכשלה: ' + err.message); }
  }
  if (t.dataset.pqpdf !== undefined) {
    const f = t.files[0]; t.value = ''; if (!f) return;
    const { pickPdfPage } = await import('./pdf-import.js');
    return pickPdfPage(f, { onError: m => toast(m), onPick: async img => { try { const key = 'user/' + uid(); await putUserMedia(key, img.data); S.pq.images.push({ key, name: img.name }); render(); } catch (err) { toast('הוספת התמונה נכשלה: ' + err.message); } } });
  }
  if (d.uppdf) {
    const f = t.files[0], itId = d.uppdf; t.value = ''; if (!f) return;
    const { pickPdfPage } = await import('./pdf-import.js');
    return pickPdfPage(f, {
      onError: m => toast(m),
      onPick: async img => {
        const it = S.exam.items.find(i => i.id === itId); if (!it) return;
        try { const id = uid(), key = 'user/' + id; await putUserMedia(key, img.data); (it.images ||= []).push({ id, key, name: img.name, widthCm: 14, position: 'below' }); saveExamSoon(); toast('העמוד נוסף כתמונה. אפשר לשנות גודל ומיקום'); render(); }
        catch (err) { toast('הוספת התמונה נכשלה: ' + err.message); }
      },
    });
  }
  if (d.upimg) {
    const it = S.exam.items.find(i => i.id === d.upimg); const f = t.files[0]; if (!f) return;
    try {
      const { data, name } = await prepareImage(f); const id = uid();
      const key = 'user/' + id; await putUserMedia(key, data);
      (it.images ||= []).push({ id, key, name, widthCm: 10, position: 'below' });
      saveExamSoon(); toast('התמונה נוספה ונשמרת יחד עם המבחן'); return render();
    } catch (err) { return toast('העלאת התמונה נכשלה: ' + err.message); }
  }
  if (d.imgw) { const [a, b] = d.imgw.split(':'); S.exam.items.find(i => i.id === a).images.find(i => i.id === b).widthCm = Math.min(17, Math.max(2, Number(t.value) || 10)); saveExamSoon(); return render(); }
  if (d.imgpos) { const [a, b] = d.imgpos.split(':'); S.exam.items.find(i => i.id === a).images.find(i => i.id === b).position = t.value; saveExamSoon(); return render(); }
  if (d.blkw) { const [a, bi] = d.blkw.split(':'); const blk = S.exam.items.find(i => i.id === a).snap.blocks[+bi]; blk.widthCm = t.value === '' ? undefined : Math.min(17, Math.max(2, Number(t.value))); saveExamSoon(); return; }
  if (d.casein) { S.exam.cases[d.casein].include = t.checked; saveExamSoon(); return render(); }
});
$app.addEventListener('input', e => {
  const t = e.target; const d = t.dataset;
  if (admin.input(t)) return;
  if (t.id === 'q') { S.f.text = t.value; clearTimeout(input.h); input.h = setTimeout(() => { render(); const q = document.getElementById('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); }
  if (d.pq) { S.pq[d.pq] = t.value; return; }
  if (d.pql) { const [k, i] = d.pql.split(':'); S.pq[k][+i] = t.value; return; }
  if (d.blk) { const [id, bi] = d.blk.split(':'); const it = S.exam.items.find(i => i.id === id); it.snap.blocks[+bi].text = t.value; if (!it.edited) { it.edited = true; } saveExamSoon(); }
  if (d.pts) { const it = S.exam.items.find(i => i.id === d.pts); const v = t.value.slice(0, 3); it.points = v === '' ? null : Math.min(999, Number(v) || 0); saveExamSoon(); return; }
  if (d.lines) { const it = S.exam.items.find(i => i.id === d.lines); it.answerLines = Math.min(20, Number(t.value.slice(0, 2)) || 0); saveExamSoon(); return; }
  if (d.chtitle) { S.exam.items.find(i => i.id === d.chtitle).title = t.value; saveExamSoon(); return; }
  if (d.freetext) { S.exam.items.find(i => i.id === d.freetext).text = t.value; saveExamSoon(); return; }
  if (d.m && t.type !== 'checkbox') { S.exam[d.m] = t.type === 'number' ? Number(t.value) : t.value; saveExamSoon(); }
});
const input = {};

// ---------- פעולות מורכבות ----------
async function newExamFlow() {
  await flushSaves(); S.exam = newExam(); S.editing.clear(); S.saveState = null;    // מבחן חדש נשמר רק אחרי שינוי ראשון (לא נוצרים מבחנים ריקים)
  S.tab = 'work'; S.mode = 'split'; localStorage.setItem('mode', 'split');         // מבחן חדש: תמיד במצב משולב (מאגר + מבחן)
}
async function homeAction(a) {
  if (a === 'new') { await newExamFlow(); return render(); }
  if (a === 'continue') { await flushSaves(); if (S.exams[0]) { S.exam = clone(S.exams[0]); S.editing.clear(); S.saveState = null; } S.tab = 'work'; if (S.mode === 'search') S.mode = 'split'; return render(); }
  if (a === 'search') { S.tab = 'work'; S.mode = 'search'; localStorage.setItem('mode', 'search'); return render(); }
  S.tab = a; return render();                                                       // exams | personal | admin
}
async function deleteExamFlow(id) {
  const ex = S.exams.find(x => x.id === id) || (S.exam.id === id ? S.exam : null); if (!ex) return;
  const ok = await ask({ title: `למחוק את "${ex.title || 'המבחן'}"?`, text: 'השאלות במאגר לא יימחקו. שאלות שמופיעות רק במבחן הזה יחזרו להיות "לא השתמשתי", אלא אם סימנת אותן ידנית כמשומשות.', ok: 'מחיקת המבחן', danger: true });
  if (!ok) return;
  const p = saveTimers.get(id); if (p) { clearTimeout(p.timer); saveTimers.delete(id); }
  const before = new Set(savedSet());
  try { await store.deleteExam(id); } catch (e) { if (e.code !== 'sync-pending') { toast('המחיקה נכשלה: ' + (e.code || e.message)); return; } reportSync('מחיקת מבחן', e); }
  S.exams = S.exams.filter(x => x.id !== id);
  if (S.exam.id === id) { S.exam = S.exams[0] ? clone(S.exams[0]) : newExam(); S.editing.clear(); }
  const freed = [...before].filter(u => isUsed(S.usage, before, u) && !isUsed(S.usage, savedSet(), u)).length;
  syncUsage(); toast(freed ? `המבחן נמחק. ${freed} שאלות חזרו ל"לא השתמשתי"` : 'המבחן נמחק');
  render();
}
// הוספה למבחן: בלי כפילויות, עם משוב ברור, הדגשה וגלילה למיקום (מיקום הגלילה והחיפוש במאגר נשמרים)
function addToExam(qs) {
  qs = qs.filter(Boolean); if (!qs.length) return;
  const r = addUnique(S.exam, qs, id => S.cases.get(id));
  if (!r.added.length) {
    const it = S.exam.items.find(i => i.snap?.uid === qs[0].uid);
    toast(qs.length === 1 ? 'השאלה כבר נמצאת במבחן' : 'כל השאלות האלה כבר נמצאות במבחן');
    if (it && S.mode !== 'search') { expandFor(it.id); render(); flashItem(it.id); }
    return;
  }
  saveExamSoon();
  const first = r.added[0], n = r.added.length;
  let msg = n === 1 ? `השאלה נוספה למבחן (שאלה ${qNumber(S.exam, first.id)})` : `${n} שאלות נוספו למבחן`;
  if (r.skipped.length) msg += ` · ${r.skipped.length} כבר היו במבחן`;
  if (r.noCase.length) msg += ' · סיפור המקרה אינו זמין ולא צורף';
  else if (r.added.some(i => i.snap.caseStudyId)) msg += ' · סיפור המקרה צורף פעם אחת';
  const toExam = S.mode === 'search' ? { label: 'עבור למבחן', fn: () => { S.mode = 'split'; localStorage.setItem('mode', 'split'); S.pv = 'edit'; render(); flashItem(first.id); } } : null;
  expandFor(first.id); render(); toast(msg, toExam);
  if (S.mode !== 'search' && S.pv !== 'preview') flashItem(first.id);
}
// הודעת מכסה ידידותית (לא שגיאה טכנית) עם קישור דוא"ל למנהל
function quotaNotice(detail) {
  const w = document.createElement('div'); w.className = 'modal dlg'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-labelledby', 'qnt');
  w.innerHTML = `<div class="modalbox card dlgbox"><h3 id="qnt">הגעת למכסת ההגשות</h3>${detail ? `<p>${esc(detail)}</p>` : ''}<p>${esc(QUOTA_NOTE)}</p>
    <p>${esc(QUOTA_MORE)}<br><a href="mailto:${ADMIN_CONTACT}">${ADMIN_CONTACT}</a></p><div class="dlgbtns"><button class="btn primary" id="qnok">הבנתי</button></div></div>`;
  const prev = document.activeElement; const close = () => { w.remove(); document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey, true); w.addEventListener('click', e => { if (e.target === w) close(); });
  w.querySelector('#qnok').addEventListener('click', close); document.body.appendChild(w); w.querySelector('#qnok').focus();
}
async function suggestFlow(quid) {
  const q = S.personal.find(x => x.uid === quid); if (!q) return;
  const credit = document.querySelector('[data-sgcredit="' + CSS.escape(quid) + '"]')?.checked;
  const keys = [...new Set([...q.blocks, ...(q.rubric?.answer || [])].map(b => b.mediaKey).filter(k => String(k || '').startsWith('user/')))];
  if (S.user && !S.isAdmin) {                                         // בדיקה מקדימה ידידותית (האכיפה האמיתית בכללי Firestore)
    const chk = checkQuota(S.suggestions, { imageKeys: keys, imageSizes: keys.map(k => S.media.get(k)?.length || 0) });
    if (chk) return quotaNotice(chk.text);
  }
  let name = '';
  if (credit) { name = await ask({ title: 'השם שיוצג כקרדיט', input: { label: 'שם', value: S.exam.teacher || '' }, ok: 'המשך' }); if (!name) return; }
  try { await store.submitSuggestion(q, { credit, authorName: name, getMedia: k => S.media.get(k) }); }
  catch (err) {
    console.error(err);
    if (String(err.code || '').startsWith('quota-')) return quotaNotice(err.code === 'quota-exceeded' ? '' : err.message);
    return toast(err.code === 'permission-denied' ? 'אין הרשאה לשלוח הצעה (בעיית הרשאות בענן, או שהשאלה כבר נשלחה)' : 'השליחה נכשלה: ' + (err.code || err.message));
  }
  S.suggestions = await store.loadSuggestions(); toast('השאלה נשלחה לבדיקה'); render();
}

// ---------- גרירה לשינוי סדר (שאלות, פרקים, טקסט חופשי; פרק נגרר עם תוכנו) ----------
// פער יעד (אינדקס הכנסה) נקבע לפי מיקום העכבר מול הפערים התקפים; קו מקווקו מראה את המקום המדויק.
let dragId = null, dropGap = null;
const ROWS = '.chap[data-id], .freeblk[data-id], .card.item[data-id]';
const dropLine = () => { let l = document.getElementById('dropline'); if (!l) { l = document.createElement('div'); l.id = 'dropline'; document.body.appendChild(l); } return l; };
function clearDnd() { document.getElementById('dropline')?.remove(); $app.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); dropGap = null; }
function gapAt(y) {
  const items = S.exam.items, rows = [...$app.querySelectorAll(ROWS)].filter(r => r.offsetParent);
  if (!rows.length) return null;
  const cand = rows.map(r => ({ g: items.findIndex(x => x.id === r.dataset.id), y: r.getBoundingClientRect().top - 5, r }));
  const last = rows[rows.length - 1].getBoundingClientRect(); cand.push({ g: items.length, y: last.bottom + 5, r: rows[rows.length - 1] });
  const ok = new Set(validGaps(S.exam, dragId));
  let best = null; for (const c of cand) if (ok.has(c.g) && (!best || Math.abs(c.y - y) < Math.abs(best.y - y))) best = c;
  return best;
}
$app.addEventListener('dragstart', e => {
  const h = e.target.closest?.('[data-dragh]'); if (!h) return;
  dragId = h.dataset.dragh; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
  const card = h.closest('[data-id]'); if (card) e.dataTransfer.setDragImage(card, 12, 12);
  const [a, b] = sectionRange(S.exam, dragId) || [0, 0], ids = new Set(S.exam.items.slice(a, b).map(x => x.id));
  setTimeout(() => $app.querySelectorAll(ROWS).forEach(r => ids.has(r.dataset.id) && r.classList.add('dragging')), 0);
});
$app.addEventListener('dragover', e => {
  if (!dragId) return;
  const c = gapAt(e.clientY); if (!c) { dropGap = null; document.getElementById('dropline')?.remove(); return; }
  e.preventDefault(); e.dataTransfer.dropEffect = 'move'; dropGap = c.g;
  const rr = c.r.getBoundingClientRect(), l = dropLine(); l.style.top = c.y + 'px'; l.style.left = (rr.left - 6) + 'px'; l.style.width = (rr.width + 12) + 'px';
});
$app.addEventListener('drop', e => {
  if (!dragId) return; e.preventDefault();
  const id = dragId, g = dropGap; dragId = null; clearDnd();
  if (g != null && moveToGap(S.exam, id, g)) { saveExamSoon(); render(); }
});
$app.addEventListener('dragend', () => { dragId = null; clearDnd(); });
$app.addEventListener('dragover', e => { if (e.target.closest('#drop')) { e.preventDefault(); e.target.closest('#drop').classList.add('over'); } });
$app.addEventListener('drop', e => { if (e.target.closest('#drop')) { e.preventDefault(); importFiles([...e.dataTransfer.files].filter(f => f.name.endsWith('.zip')), { publish: S.adm.publishOnImport }); } });

function openLightbox(src) {
  const lb = document.createElement('div'); lb.className = 'lightbox';
  lb.innerHTML = `<img src="${src}" alt="תצוגה מוגדלת"><span>לחצו לסגירה</span>`;
  lb.addEventListener('click', () => lb.remove()); document.body.appendChild(lb);
}

async function exportDoc(mode) {
  const e = S.exam;
  try {
    const need = [...new Set(examMediaKeys(e))]; need.forEach(k => S.mediaMissing.delete(k));   // ניסיון חוזר לתמונות שנכשלו קודם
    await ensureMedia(need);
    const absent = need.filter(k => !S.media.has(k));
    const blob = await toBlob(buildExamDocument(e, { getMedia: k => S.media.get(k) }, mode));
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${(e.title || 'מבחן').replace(/[\\/:*?"<>|]/g, '')} - ${mode === 'teacher' ? 'מורה' : 'תלמיד'}.docx`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(absent.length ? `קובץ Word הופק, אבל ${absent.length} תמונות לא נטענו ומסומנות במסמך כ״חסרות״. בדקו חיבור ונסו שוב.` : 'קובץ Word הופק');
  } catch (err) { console.error(err); toast('ההפקה נכשלה: ' + err.message); }
}

async function renameExamFlow(id) {
  const x = S.exam.id === id ? S.exam : S.exams.find(v => v.id === id); if (!x) return;
  const name = await ask({ title: 'שינוי שם המבחן', input: { label: 'שם המבחן', value: x.title || '' }, ok: 'שמירה' });
  if (name == null || !name.trim() || name.trim() === x.title) return;
  if (S.exam.id === id) { S.exam.title = name.trim(); saveExamSoon(); toast('שם המבחן עודכן'); return render(); }
  const c = clone(x); c.title = name.trim(); c.updatedAt = Date.now();
  try { await store.saveExam(c); } catch (e) { if (e.code === 'sync-pending') reportSync('מבחן', e); else return toast('שינוי השם נכשל: ' + (e.code || e.message)); }
  try { S.exams = await store.loadExams(); } catch (e) { reportSync('רענון רשימת מבחנים', e); }
  toast('שם המבחן עודכן'); render();
}

// ---------- "לראש המבחן": כפתור צף. במסך משולב גוללים רק את פאנל המבחן; אחרת הדף ----------
const topBtn = document.createElement('button');
topBtn.id = 'totop'; topBtn.type = 'button'; topBtn.hidden = true; topBtn.setAttribute('aria-label', 'חזרה לראש המבחן'); topBtn.innerHTML = ICON.top.replace('width="24" height="24"', 'width="18" height="18"') + '<span>לראש המבחן</span>';
document.body.appendChild(topBtn);
const examScroller = () => { const p = S.tab === 'work' && S.mode === 'split' ? document.querySelector('[data-keep="exam"]') : null; return p && getComputedStyle(p).overflowY === 'auto' && p.scrollHeight > p.clientHeight + 1 ? p : null; };
function updateTop() {
  const on = S.tab === 'work' && S.mode !== 'search', sc = examScroller();
  topBtn.hidden = !(on && ((sc ? sc.scrollTop : window.scrollY) > 600));
}
document.addEventListener('scroll', updateTop, true);
window.addEventListener('resize', updateTop);
topBtn.addEventListener('click', () => {
  const sc = examScroller(), behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  if (sc) sc.scrollTo({ top: 0, behavior }); else window.scrollTo({ top: 0, behavior });
  (document.getElementById('examttl') || document.querySelector('.pvbar'))?.focus({ preventScroll: true });
});

// ---------- תפריט "הוסף תמונה" (נגיש במקלדת: חיצים, Escape, Tab סוגר) ----------
function closeMenus(focusBtn) {
  document.querySelectorAll('.addimg .menu:not([hidden])').forEach(m => { m.hidden = true; const b = m.parentElement.querySelector('[data-imgmenu]'); b?.setAttribute('aria-expanded', 'false'); if (focusBtn) b?.focus(); });
}
function openMenu(btn) {
  const m = btn.parentElement.querySelector('.menu'); closeMenus(); m.hidden = false; btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w));            // מיושר לקצה הימני של הכפתור (RTL)
  m.style.left = left + 'px'; m.style.top = (r.bottom + 4 + h > innerHeight && r.top - h - 4 > 0 ? r.top - h - 4 : r.bottom + 4) + 'px';
  m.querySelector('[role=menuitem]').focus();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-imgmenu]');
  if (b) { e.preventDefault(); return b.getAttribute('aria-expanded') === 'true' ? closeMenus(true) : openMenu(b); }
  const p = e.target.closest('[data-pick]');
  if (p) { const box = p.closest('.addimg'); closeMenus(); box.querySelector(p.dataset.pick === 'pdf' ? '[data-uppdf],[data-pqpdf]' : '[data-upimg],[data-pqimg]').click(); return; }
  const an = e.target.closest('[data-anatomy]');
  if (an) { closeMenus(); toast('שמרו את האיור במחשב, חזרו לכאן והעלו אותו דרך "הוסף תמונה" ← "תמונה מהמחשב". האיור נשמר יחד עם המבחן.', null, 9000); return; }
  if (!e.target.closest('.menu')) closeMenus();
}, true);
document.addEventListener('keydown', e => {
  const m = document.querySelector('.addimg .menu:not([hidden])'); if (!m) return;
  const items = [...m.querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeMenus(true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  else if (e.key === 'Tab') closeMenus();
});
document.addEventListener('scroll', e => { if (!e.target.closest?.('.menu')) closeMenus(); }, true);
window.addEventListener('resize', () => closeMenus());
initHelp();

const admin = createAdmin({ S, store, esc, toast, render, label, srcLabel, blocksHtml, loadAll, devLoad });
await loadAll();
// גרסת כללי הייבוא/הסיווג: אם השתנתה, החבילות המקומיות נטענות מחדש (בפיתוח – מתיקיית samples)
const ADAPTER_VERSION = '2';
if (localStorage.getItem('adapterVersion') !== ADAPTER_VERSION) {
  for (const p of S.packages) await store.removePackage(p.id);
  await loadAll();
  localStorage.setItem('adapterVersion', ADAPTER_VERSION);
}
render();
// פיתוח בלבד: מאגר ריק -> טעינה אוטומטית של חבילות הדוגמה, כדי שהאתר ייפתח עם נתונים
if (import.meta.env.DEV && !S.packages.length) {
  try {
    const names = await (await fetch('/__samples/')).json(); const files = [];
    for (const n of names) files.push(new File([await (await fetch('/__samples/' + encodeURIComponent(n))).arrayBuffer()], n));
    if (files.length) { await importFiles(files, { publish: true }); render(); toast(`נטענו ${S.questions.length} שאלות מחבילות הדוגמה`); }
  } catch { /* אין samples */ }
}
window.__app = { S, importFiles, render };
