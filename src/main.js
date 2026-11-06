import { parsePackage, KIND_LABEL } from './adapter.js';
import { cellLines } from './clean.js';
import { store, localStore, setBackend } from './store.js';
import { cloudConfigured } from './firebase-config.js';
import { newExam, uid, addQuestion, totalPoints, removeItem, moveItem, equalSplit, isChoiceQuestion, caseFirstUse } from './exam.js';
import { buildExamDocument, toBlob } from './docx-export.js';
import { prepareImage } from './images.js';
import { createAdmin } from './admin.js';
import { LETTERS, SOURCE_OPTIONS, emptyDraft, draftToQuestion, validateDraft, questionToDraft, itemToDraft } from './personal.js';

const ANATOMY_TOOL_URL = 'https://urony.github.io/Anatomic-Pictures-Finder-tool/';

// ---------- מצב ----------
const S = {
  tab: 'work', mode: localStorage.getItem('mode') || 'split', pv: 'edit', pvTeacher: false, modal: null,
  packages: [], questions: [], cases: new Map(), media: new Map(), urls: new Map(),
  tax: { types: {}, domains: {} },
  f: { text: '', domains: new Set(), types: new Set(), kinds: new Set(), years: new Set(), codes: new Set() },
  sort: 'year-desc',
  sel: null, checked: new Set(),
  exam: null, exams: [], editing: new Set(),
  importReports: [], personal: [], suggestions: [], pq: null,
  user: null, // { uid, name } אחרי התחברות Google; null = מצב מקומי
};
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2800); }

// ---------- טעינה ----------
async function loadAll() {
  const bank = await store.loadBank();
  S.packages = bank.packages; S.questions = bank.questions; S.media = bank.media;
  S.cases = new Map(bank.cases.map(c => [c.uid, c]));
  S.exams = await store.loadExams();
  S.personal = await store.loadPersonal(); S.suggestions = await store.loadSuggestions();
  S.questions = bank.questions.concat(S.personal);
  S.tax = { types: {}, domains: {} };
  for (const p of S.packages) { Object.assign(S.tax.types, p.taxonomy.types); Object.assign(S.tax.domains, p.taxonomy.domains); }
  const meta = await store.loadTaxonomy(); Object.assign(S.tax.domains, meta.domains || {}); Object.assign(S.tax.types, meta.types || {});
  if (!S.exam) S.exam = S.exams[0] || newExam();
  // בענן תמונות משתמש נמצאות ב-Drive: טוענים את אלה שהמבחנים והשאלות האישיות מפנים אליהן
  if (store.getMedia) {
    const keys = new Set([...S.exams.flatMap(x => x.items.flatMap(i => (i.images || []).map(m => m.key))), ...S.personal.flatMap(q => (q.images || []).map(m => m.key))]);
    for (const k of keys) if (k && !S.media.has(k)) { try { const b = await store.getMedia(k); if (b) S.media.set(k, b); } catch { /* תמונה חסרה */ } }
  }
}

async function signInFlow() {
  try {
    const cloud = await import('./cloud.js');
    const u = await cloud.signIn();
    const { createDrive } = await import('./drive.js');
    const { createCloudStore } = await import('./cloud-store.js');
    setBackend(createCloudStore({ drive: createDrive({ getToken: cloud.getDriveToken }), firestore: cloud.firestore, uid: u.uid, local: localStore }));
    S.user = { uid: u.uid, name: u.name, hasDrive: u.hasDrive };
    if (!u.hasDrive) toast('לא ניתנה הרשאת Drive – הנתונים האישיים לא יישמרו בענן');
    S.exam = null; await loadAll(); render(); toast('מחובר: ' + (u.name || 'משתמש'));
  } catch (err) { console.error(err); toast('ההתחברות נכשלה: ' + (err.code || err.message)); }
}
async function signOutFlow() {
  try { await (await import('./cloud.js')).signOut(); } catch { /* ignore */ }
  setBackend(localStore); S.user = null; S.exam = null; await loadAll(); render();
}
const qByUid = uid => S.questions.find(q => q.uid === uid);
const vis = () => S.questions.filter(q => q.published !== false); // שאלות מוסתרות לא מוצגות למורים
const label = (map, k) => S.tax[map][k] || k || '—';
const mediaUrl = key => {
  if (!S.urls.has(key)) { const u8 = S.media.get(key); if (!u8) return ''; S.urls.set(key, URL.createObjectURL(new Blob([u8], { type: u8[0] === 0x89 ? 'image/png' : 'image/jpeg' }))); }
  return S.urls.get(key);
};

let saveTimer;
function saveExamSoon() {
  S.exam.updatedAt = Date.now();
  clearTimeout(saveTimer);
  const ind = document.getElementById('saveind'); if (ind) ind.textContent = 'שומר…';
  saveTimer = setTimeout(async () => {
    await store.saveExam(S.exam);
    S.exams = await store.loadExams();
    const i2 = document.getElementById('saveind'); if (i2) i2.textContent = 'נשמר ✓';
  }, 350);
}

// ---------- חיפוש ----------
function srcLabel(q) { if (q.kind === 'personal') return 'שאלה אישית'; return q.kind === 'bagrut' ? `בגרות ${q.year ?? ''}${q.examCode ? ' · ' + q.examCode : ''}` : 'שאלה ממורה'; }
function filtered() {
  const f = S.f; const words = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let r = vis().filter(q => {
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
function render() {
  const e = S.exam;
  const modes = [['search', 'חיפוש'], ['split', 'משולב'], ['exam', 'מבחן']];
  $app.innerHTML = `
  <header class="top">
    <h1>בונה מבחנים <small>מדעי הבריאות</small></h1>
    <nav class="tabs">
      <button data-tab="work" class="${S.tab === 'work' ? 'on' : ''}">בניית מבחן</button>
      <button data-tab="personal" class="${S.tab === 'personal' ? 'on' : ''}">המאגר האישי</button>
      <button data-tab="admin" class="${S.tab === 'admin' ? 'on' : ''}">ניהול (מקומי)</button>
    </nav>
    ${S.tab === 'work' ? `<div class="seg" role="group" aria-label="מצב תצוגה">${modes.map(([k, t]) => `<button data-mode="${k}" class="${S.mode === k ? 'on' : ''}">${t}</button>`).join('')}</div>` : ''}
    <span class="spacer"></span>
    ${cloudConfigured() ? (S.user ? `<span class="pill">${esc(S.user.name || 'מחובר')}</span><button class="btn sm" id="signout">התנתק</button>` : '<button class="btn sm" id="signin">התחברות עם Google</button>') : ''}
    <span class="pill" id="pill">${e.items.length} שאלות במבחן · ${totalPoints(e)} נק׳</span>
  </header>
  <main class="${S.tab === 'work' ? 'm-' + S.mode : ''}">${S.tab === 'work' ? workView() : S.tab === 'personal' ? personalView() : adminView()}</main>
  ${S.modal && qByUid(S.modal) ? `<div class="modal" data-closemodal><div class="modalbox card"><button class="btn sm" data-closemodal style="float:inline-end">סגור ✕</button>${detailHtml(qByUid(S.modal))}</div></div>` : ''}`;
  requestAnimationFrame(() => {
    const p = document.getElementById('paper'); if (!p) return;
    const ph = p.offsetWidth * 29.7 / 21; p.style.setProperty('--ph', ph + 'px');
    const est = document.getElementById('pgest'); if (est) est.textContent = '≈ ' + Math.max(1, Math.ceil(p.scrollHeight / ph)) + ' עמודים (הערכה)';
  });
}
function adminView() { return admin.view(); }

function workView() {
  if (S.mode === 'search') return bankView();
  if (S.mode === 'exam') return `<div class="examwrap">${examPanel(false)}</div>`;
  return `<div class="split"><section class="splitL">${bankCompact()}</section><section class="splitR">${examPanel(true)}</section></div>`;
}

function bankCompact() {
  if (!S.questions.length) return '<div class="card empty">המאגר ריק. הוסיפו חבילות בלשונית "ניהול".</div>';
  const list = filtered();
  return `<div class="card compact">
    <input type="search" id="q" placeholder="חיפוש חופשי בטקסט…" value="${esc(S.f.text)}">
    <details class="fdet"><summary>מסננים${Object.values(S.f).some(v => v instanceof Set && v.size) ? ' (פעילים)' : ''}</summary><div class="filters">
      ${filterGroup('נושא (תחום ראשי)', 'domains', uniq(vis().map(q => q.domainId)).map(d => [d, label('domains', d)]))}
      ${filterGroup('סוג שאלה', 'types', uniq(vis().map(q => q.typeId)).map(t => [t, label('types', t)]))}
      ${filterGroup('מקור השאלות', 'kinds', uniq(vis().map(q => q.kind)).map(k => [k, KIND_LABEL[k]]))}
      ${filterGroup('שנת בחינה', 'years', uniq(vis().map(q => q.year)).sort((a, b) => b - a).map(y => [y, y]))}
      <p><button class="btn sm" id="reset">איפוס מסננים</button></p></div></details>
    <div class="listhead"><b>${list.length} שאלות</b>
      <select id="sort"><option value="year-desc" ${S.sort === 'year-desc' ? 'selected' : ''}>חדש לישן</option><option value="year-asc" ${S.sort === 'year-asc' ? 'selected' : ''}>ישן לחדש</option><option value="domain" ${S.sort === 'domain' ? 'selected' : ''}>לפי נושא</option></select>
      <span class="spacer"></span><button class="btn sm" id="selall">בחר הכול</button>
      <button class="btn primary sm" id="addchecked" ${S.checked.size ? '' : 'disabled'}>הוסף ${S.checked.size || ''} נבחרות</button></div>
    <div class="clist">${list.slice(0, 300).map(q => `<div class="qrow" data-uid="${esc(q.uid)}"><input type="checkbox" data-chk="${esc(q.uid)}" ${S.checked.has(q.uid) ? 'checked' : ''}>
      <div class="grow"><div class="t">${esc(q.title || q.blocks.find(b => b.text)?.text.slice(0, 80) || '(ללא כותרת)')}</div><div class="s">${esc(srcLabel(q))}${q.kind === 'bagrut' ? ' · שאלה ' + esc(q.originalNumber) : ''}</div><div>${badgesOf(q)}</div></div>
      <button class="btn sm" data-add="${esc(q.uid)}" title="הוסף למבחן">+</button></div>`).join('') || '<div class="empty">אין תוצאות</div>'}</div></div>`;
}

function examPanel(compact) {
  const pvModes = compact ? [['edit', 'עריכה'], ['preview', 'תצוגה מקדימה']] : [['edit', 'עריכה'], ['both', 'עריכה + תצוגה'], ['preview', 'תצוגה מקדימה']];
  if (compact && S.pv === 'both') S.pv = 'edit';
  if (!compact && S.pv === 'edit' && !S._pvTouched) S.pv = 'both';
  const bar = `<div class="pvbar"><div class="seg sm">${pvModes.map(([k, t]) => `<button data-pv="${k}" class="${S.pv === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    ${S.pv !== 'edit' ? `<label class="chk"><input type="checkbox" data-pvt ${S.pvTeacher ? 'checked' : ''}> גרסת מורה (עם תשובות)</label>` : ''}
    <span class="spacer"></span><span id="saveind" class="badge"></span></div>`;
  if (S.pv === 'preview') return bar + paper();
  if (S.pv === 'both' && !compact) return bar + `<div class="two"><div>${editHtml(false)}</div><div>${paper()}</div></div>`;
  return bar + editHtml(compact);
}

function rubricOpen(r) {
  const hasKey = r.answer.some(b => b.isKey);
  const body = r.answer.map(b => b.isKey ? `<p><b>תשובה נכונה:</b> ${esc(b.text)}</p>` : (b.type === 'image' && hasKey ? '' : (b.type === 'image' && b.scanned ? '<p><i>המחוון הרשמי סרוק – יצורף כנספח במסמך.</i></p>' : blocksHtml([b])))).join('');
  return `<div class="p-rub"><b>${r.officialKind === 'official' ? 'מחוון רשמי' : 'תשובה (לפי מחבר השאלה)'}</b>${body}${r.notes ? `<p><b>הנחיות בדיקה:</b> ${esc(r.notes)}</p>` : ''}${r.allocation.length ? `<p><b>חלוקת ניקוד:</b> ${r.allocation.map(a => esc(a.component) + ' – ' + (a.percent != null ? a.percent + '%' : esc(a.points ?? ''))).join('; ')}</p>` : ''}</div>`;
}
function paper() {
  const e = S.exam, teacher = S.pvTeacher, first = caseFirstUse(e), tot = totalPoints(e);
  const pic = im => `<img src="${mediaUrl(im.key)}" alt="" style="width:${Math.min(100, im.widthCm / 17 * 100)}%">`;
  let h = `<div class="paperwrap"><div class="pvnote">תצוגה משוערת של המסמך. מעברי עמוד ופריסה ב־Word עשויים להיות שונים מעט. <b id="pgest"></b></div><div class="paper" id="paper">`;
  if (e.school) h += `<div class="p-school">${esc(e.school)}</div>`;
  h += `<h2 class="p-title">${esc(e.title || 'מבחן')}</h2>`;
  if (teacher) h += '<div class="p-teacher">גרסת מורה – כולל תשובות ומחוונים</div>';
  const meta = [e.teacher && 'מורה: ' + e.teacher, e.date && 'תאריך: ' + e.date, e.showPoints && tot ? `סה״כ ${tot} נקודות` : null].filter(Boolean);
  if (meta.length) h += `<div class="p-meta">${meta.map(esc).join(' &nbsp;|&nbsp; ')}</div>`;
  if (!teacher) h += '<div class="p-name">שם התלמיד/ה: ____________________ &nbsp; כיתה: ________</div>';
  if (e.instructions) h += `<div class="p-instr"><b>הוראות</b>${e.instructions.split(/\n+/).map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
  h += '<hr>';
  if (!e.items.length) h += '<div class="empty">המבחן ריק. הוסיפו שאלות מהמאגר.</div>';
  e.items.forEach((it, i) => {
    const cid = first.get(it.id); if (cid) h += `<div class="p-case"><b>סיפור מקרה</b>${blocksHtml(e.cases[cid].blocks)}</div>`;
    if (it.pageBreak) h += '<div class="p-break">— התחלת עמוד חדש —</div>';
    const secs = it.snap.blocks.filter(b => b.type === 'section' && b.points != null);
    const secPts = e.showPoints && secs.length && secs.reduce((a, b) => a + b.points, 0) === Number(it.points);
    const imgs = it.images || [];
    const body = `<div class="qbody">${blocksHtml(it.snap.blocks, { pts: secPts })}</div>`;
    const side = imgs.filter(x => x.position === 'side').map(pic).join('');
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

function filterGroup(title, key, entries) {
  if (!entries.length) return '';
  return `<h3>${title}</h3>` + entries.map(([v, l]) => `<label><input type="checkbox" data-f="${key}" value="${esc(v)}" ${S.f[key].has(String(v)) ? 'checked' : ''}> ${esc(l)}</label>`).join('');
}
function bankView() {
  if (!S.questions.length) return `<div class="card empty">המאגר ריק. עברו ללשונית "ייבוא חבילות" וטענו קובצי ZIP.</div>`;
  const list = filtered();
  const cur = S.sel && qByUid(S.sel);
  return `<div class="bank">
    <aside class="card filters">
      <input type="search" id="q" placeholder="חיפוש חופשי בטקסט…" value="${esc(S.f.text)}">
      ${filterGroup('נושא (תחום ראשי)', 'domains', uniq(vis().map(q => q.domainId)).map(d => [d, label('domains', d)]))}
      ${filterGroup('סוג שאלה', 'types', uniq(vis().map(q => q.typeId)).map(t => [t, label('types', t)]))}
      ${filterGroup('מקור השאלות', 'kinds', uniq(vis().map(q => q.kind)).map(k => [k, KIND_LABEL[k]]))}
      ${filterGroup('שנת בחינה', 'years', uniq(vis().map(q => q.year)).sort((a, b) => b - a).map(y => [y, y]))}
      ${filterGroup('סמל שאלון', 'codes', uniq(vis().map(q => q.examCode)).map(c => [c, c]))}
      <p><button class="btn sm" id="reset">איפוס מסננים</button></p>
    </aside>
    <section class="card list">
      <div class="listhead">
        <b>${list.length} שאלות</b>
        <select id="sort"><option value="year-desc" ${S.sort === 'year-desc' ? 'selected' : ''}>שנה: מהחדשה לישנה</option><option value="year-asc" ${S.sort === 'year-asc' ? 'selected' : ''}>שנה: מהישנה לחדשה</option><option value="domain" ${S.sort === 'domain' ? 'selected' : ''}>לפי נושא</option></select>
        <span class="spacer"></span>
        <button class="btn sm" id="selall">בחר הכול</button>
        <button class="btn primary sm" id="addchecked" ${S.checked.size ? '' : 'disabled'}>הוסף ${S.checked.size || ''} נבחרות למבחן</button>
      </div>
      ${list.slice(0, 400).map(q => `<div class="qrow ${S.sel === q.uid ? 'sel' : ''}" data-uid="${esc(q.uid)}">
        <input type="checkbox" data-chk="${esc(q.uid)}" ${S.checked.has(q.uid) ? 'checked' : ''}>
        <div><div class="t">${esc(q.title || q.blocks.find(b => b.text)?.text.slice(0, 80) || '(ללא כותרת)')}</div>
        <div class="s">${esc(srcLabel(q))}${q.kind === 'bagrut' ? ' · שאלה ' + esc(q.originalNumber) : ''}</div><div>${badgesOf(q)}</div></div></div>`).join('') || '<div class="empty">אין תוצאות</div>'}
    </section>
    <section class="card detail">${cur ? detailHtml(cur) : '<div class="empty">בחרו שאלה מהרשימה להצגה מלאה</div>'}</section>
  </div>`;
}
function detailHtml(q) {
  const cs = q.caseStudyId && S.cases.get(q.caseStudyId);
  const inExam = S.exam.items.filter(i => i.snap.uid === q.uid).length;
  return `<div><button class="btn primary" data-add="${esc(q.uid)}">הוסף למבחן</button> ${inExam ? `<span class="badge ok">כבר במבחן ×${inExam}</span>` : ''}</div>
    <div style="margin:8px 0">${badgesOf(q)}${q.points != null ? `<span class="badge">${q.points} נק׳ במקור</span>` : ''}</div>
    ${cs ? `<div class="casebox"><h4>סיפור מקרה (משותף ל-${cs.questionIds.length} שאלות)</h4>${blocksHtml(cs.blocks)}</div>` : ''}
    <div class="qbody">${blocksHtml(q.blocks)}</div>
    ${rubricHtml(q.rubric)}`;
}

function editHtml(compact) {
  const e = S.exam; const tot = totalPoints(e); const diff = tot - e.targetPoints; const first = caseFirstUse(e);
  return `<div class="card">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <select id="examsel">${S.exams.some(x => x.id === e.id) ? '' : `<option value="${e.id}">${esc(e.title)} (לא נשמר)</option>`}${S.exams.map(x => `<option value="${x.id}" ${x.id === e.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>
      <button class="btn sm" id="newexam">מבחן חדש</button><button class="btn sm" id="dupexam">שכפל</button><button class="btn sm danger" id="delexam">מחק מבחן</button>
    </div>
    ${compact ? '<details><summary>פרטי המבחן והגדרות</summary>' : ''}<div class="exam-meta">
      <label>כותרת המבחן<input data-m="title" value="${esc(e.title)}"></label>
      <label>בית ספר<input data-m="school" value="${esc(e.school)}"></label>
      <label>שם המורה<input data-m="teacher" value="${esc(e.teacher)}"></label>
      <label>תאריך<input data-m="date" value="${esc(e.date)}" placeholder="למשל 05.11.2026"></label>
      <label>סך נקודות רצוי<input type="number" data-m="targetPoints" value="${e.targetPoints}"></label>
      <label style="flex-direction:row;align-items:center;gap:6px;margin-top:18px"><input type="checkbox" data-m="showPoints" ${e.showPoints ? 'checked' : ''}> הצג ניקוד במסמך התלמיד</label>
    </div>
    <label class="exam-meta" style="display:block;margin-top:10px"><label>הוראות כלליות (אופציונלי)<textarea data-m="instructions" rows="2" style="width:100%">${esc(e.instructions)}</textarea></label></label>
  ${compact ? '</details>' : ''}</div>
  <div class="totalbar ${diff ? 'warn' : ''}" id="totalbar">${totalHtml(tot, e.targetPoints)}
    <span class="spacer"></span>
    <button class="btn sm" id="newq">+ שאלה חדשה במבחן</button>
    <button class="btn sm" id="eqsplit">הצע חלוקה שווה</button>
    <button class="btn primary" id="exp-s" ${e.items.length ? '' : 'disabled'}>הפק Word לתלמיד</button>
    <button class="btn primary" id="exp-t" ${e.items.length ? '' : 'disabled'}>הפק Word למורה</button>
  </div>
  ${e.items.length ? e.items.map((it, i) => itemHtml(it, i, first)).join('') : '<div class="card empty">המבחן ריק. הוסיפו שאלות מהמאגר.</div>'}`;
}
function totalHtml(tot, target) {
  const d = tot - target;
  return `<b>סה״כ ${tot} נקודות</b> (יעד ${target})${d ? ` · <b>אזהרה: ${d > 0 ? 'עודף' : 'חסר'} ${Math.abs(d)} נקודות</b> (ההפקה אינה חסומה)` : ' ✓'}`;
}
function itemHtml(it, i, first) {
  const cid = first.get(it.id); const editing = S.editing.has(it.id);
  const isMC = isChoiceQuestion(it.snap.blocks);
  return `${cid ? `<div class="card casebox"><h4>סיפור מקרה – מוצג פעם אחת לפני שאלה ${i + 1} <label style="float:inline-end"><input type="checkbox" data-casein="${esc(cid)}" checked> כלול</label></h4>${editing ? '' : ''}${blocksHtml(S.exam.cases[cid].blocks)}</div>` : ''}
  <div class="card item" data-id="${it.id}">
    <div class="hd"><span class="num">שאלה ${i + 1}</span><span>${badgesOf({ ...it.snap, rubric: it.snap.rubric, title: '' , blocks: it.snap.blocks, caseStudyId: it.snap.caseStudyId, typeId: null })}</span>
      <span class="ctrl">
        <label>נק׳ <input type="number" min="0" data-pts="${it.id}" value="${it.points ?? ''}"></label>
        ${isMC ? '' : `<label>שורות לתשובה <input type="number" min="0" max="20" data-lines="${it.id}" value="${it.answerLines}"></label>`}
        <label><input type="checkbox" data-pb="${it.id}" ${it.pageBreak ? 'checked' : ''}> עמוד חדש</label>
        <button class="btn sm" data-mv="up:${it.id}" ${i === 0 ? 'disabled' : ''} title="הזז למעלה">▲</button>
        <button class="btn sm" data-mv="down:${it.id}" ${i === S.exam.items.length - 1 ? 'disabled' : ''} title="הזז למטה">▼</button>
        <button class="btn sm" data-edit="${it.id}">${editing ? 'סיום עריכה' : 'ערוך עותק'}</button>
        ${it.snap.kind === 'draft' ? `<button class="btn sm" data-savepq="${it.id}">שמור במאגר האישי</button>` : ''}
        <button class="btn sm danger" data-rm="${it.id}">מחק</button>
      </span></div>
    ${imagesPanelHtml(it)}
    ${it.edited ? '<div class="editnote">השאלה נערכה. מומלץ לבדוק אם יש צורך לעדכן את הניקוד</div>' : ''}
    ${editing ? editorHtml(it) : previewHtml(it)}
  </div>`;
}
function previewHtml(it) {
  const imgs = it.images || [];
  const pic = im => `<img src="${mediaUrl(im.key)}" alt="${esc(im.name)}" style="width:${Math.min(100, im.widthCm / 17 * 100)}%">`;
  const above = imgs.filter(i => i.position === 'above').map(pic).join('');
  const below = imgs.filter(i => i.position === 'below').map(pic).join('');
  const side = imgs.filter(i => i.position === 'side').map(i => `<img src="${mediaUrl(i.key)}" alt="${esc(i.name)}">`).join('');
  const body = `<div class="qbody">${blocksHtml(it.snap.blocks)}</div>`;
  return side ? `${above}<div class="sidewrap">${body}<div class="sideimg">${side}</div></div>${below}` : `${above}${body}${below}`;
}
function imagesPanelHtml(it) {
  const imgs = it.images || [];
  return `<div class="imgpanel">
    <label class="btn sm">+ הוסף תמונה מהמחשב<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upimg="${it.id}" hidden></label>
    <a class="btn sm" href="${ANATOMY_TOOL_URL}" target="_blank" rel="noopener">פתח את כלי האיורים האנטומיים ↗</a>
    <span class="hint">שמרו את האיור במחשב וחזרו להעלות אותו כאן</span>
    ${imgs.map(im => `<div class="uimg"><img src="${mediaUrl(im.key)}" alt="${esc(im.name)}">
      <div><div class="s">${esc(im.name)}</div>
      <label>רוחב (ס״מ) <input type="number" min="2" max="17" step="0.5" data-imgw="${it.id}:${im.id}" value="${im.widthCm}"></label>
      <label>מיקום <select data-imgpos="${it.id}:${im.id}"><option value="above" ${im.position === 'above' ? 'selected' : ''}>מעל השאלה</option><option value="below" ${im.position === 'below' ? 'selected' : ''}>מתחת לשאלה</option><option value="side" ${im.position === 'side' ? 'selected' : ''}>לצד השאלה</option></select></label>
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
  return `<div class="card"><div style="display:flex;gap:8px;align-items:center"><b>המאגר האישי שלי (${S.personal.length})</b><span class="spacer"></span><button class="btn primary" data-pqnew>+ שאלה חדשה</button></div>
    <p class="hint" style="color:var(--muted)">שאלות אישיות גלויות רק לך. שאלה שתציע למאגר הכללי תופיע שם רק אחרי אישור המנהל.</p></div>
    ${S.personal.map(q => { const sg = sugOf(q.uid); return `<div class="card item"><div class="hd"><b>${esc(q.title || q.blocks.find(b => b.text)?.text.slice(0, 70) || '(ללא כותרת)')}</b><span>${badgesOf(q)}</span>
      <span class="ctrl">${sg ? `<span class="badge">${sg.status === 'pending' ? 'ממתינה לאישור' : sg.status === 'approved' ? 'אושרה' : 'נדחתה'}</span>` : `<label><input type="checkbox" data-sgcredit="${esc(q.uid)}"> הוסף קרדיט בשמי</label><button class="btn sm" data-suggest="${esc(q.uid)}">הצע למאגר הכללי</button>`}
      <button class="btn sm" data-addp="${esc(q.uid)}">הוסף למבחן</button><button class="btn sm" data-pqedit="${esc(q.uid)}">ערוך</button><button class="btn sm danger" data-pqdel="${esc(q.uid)}">מחק</button></span></div>
      <div class="qbody">${blocksHtml(q.blocks)}</div></div>`; }).join('') || '<div class="card empty">אין עדיין שאלות אישיות.</div>'}`;
}
function pqForm() {
  const p = S.pq; const ta = (k, v, rows = 3) => `<textarea rows="${rows}" data-pq="${k}" style="width:100%">${esc(v)}</textarea>`;
  const list = (k, arr) => arr.map((v, i) => `<div class="blkedit"><div><b>${LETTERS[i] || i + 1}.</b><textarea data-pql="${k}:${i}" rows="2">${esc(v)}</textarea></div><button class="btn sm danger" data-pqrm="${k}:${i}">✕</button></div>`).join('');
  return `<div class="card item"><b>${p.uid ? 'עריכת שאלה אישית' : 'שאלה חדשה'}</b>
    ${p.error ? `<div class="editnote">${esc(p.error)}</div>` : ''}
    <div class="exam-meta" style="margin:10px 0">
      <label>מקור (חובה)<select data-pq="sourceKind">${Object.entries(SOURCE_OPTIONS).map(([k, l]) => `<option value="${k}" ${p.sourceKind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>פירוט מקור (אופציונלי)<input data-pq="sourceText" value="${esc(p.sourceText)}"></label>
      <label>נושא ראשי (חובה)<select data-pq="domainId"><option value="">בחרו…</option>${Object.entries(S.tax.domains).map(([k, l]) => `<option value="${k}" ${p.domainId === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label>סוג שאלה (אופציונלי)<select data-pq="typeId"><option value="">—</option>${Object.entries(S.tax.types).map(([k, l]) => `<option value="${k}" ${p.typeId === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label>כותרת לחיפוש (אופציונלי)<input data-pq="title" value="${esc(p.title)}"></label></div>
    <label class="exam-meta" style="display:block">גוף השאלה (חובה, אלא אם יש סעיפים/אפשרויות)${ta('body', p.body, 4)}</label>
    <div class="imgpanel"><label class="btn sm">+ הוסף תמונה<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-pqimg hidden></label>
      <a class="btn sm" href="${ANATOMY_TOOL_URL}" target="_blank" rel="noopener">כלי האיורים האנטומיים ↗</a>
      ${p.images.map((im, i) => `<span class="uimg" style="width:auto"><img src="${mediaUrl(im.key)}" alt=""> <button class="btn sm danger" data-pqrm="images:${i}">הסר</button></span>`).join('')}</div>
    <b>סעיפים</b>${list('sections', p.sections)}<button class="btn sm" data-pqadd="sections">+ סעיף</button>
    <div style="margin-top:8px"><b>אפשרויות תשובה (רב־ברירה)</b></div>${list('choices', p.choices)}<button class="btn sm" data-pqadd="choices">+ אפשרות</button>
    <label class="exam-meta" style="display:block;margin-top:10px">תשובה / מחוון (אופציונלי)${ta('answer', p.answer, 3)}</label>
    <p><button class="btn primary" data-pqsave>שמור במאגר האישי</button> <button class="btn" data-pqcancel>ביטול</button></p></div>`;
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
  const t = e.target.closest('button, .qrow'); if (!t) return;
  const d = t.dataset;
  if (e.target.closest('[data-admchk]')) return;
  if (d.adm !== undefined && await admin.click(t, d)) return;
  if (d.mode) { S.mode = d.mode; localStorage.setItem('mode', d.mode); if (d.mode !== 'exam' && S.pv === 'both') S.pv = 'edit'; S._pvTouched = false; return render(); }
  if (d.pv) { S.pv = d.pv; S._pvTouched = true; return render(); }
  if (d.tab) { S.tab = d.tab; return render(); }
  if (t.id === 'signin') return signInFlow();
  if (t.id === 'signout') return signOutFlow();
  if (t.id === 'reset') { S.f = { text: '', domains: new Set(), types: new Set(), kinds: new Set(), years: new Set(), codes: new Set() }; return render(); }
  if (t.id === 'selall') { filtered().forEach(q => S.checked.add(q.uid)); return render(); }
  if (t.id === 'addchecked') { const n = S.checked.size; for (const q of S.questions.filter(q => S.checked.has(q.uid))) addQuestion(S.exam, q, S.cases.get(q.caseStudyId)); S.checked.clear(); saveExamSoon(); toast(`${n} שאלות נוספו למבחן`); return render(); }
  if (d.add) { const q = qByUid(d.add); addQuestion(S.exam, q, S.cases.get(q.caseStudyId)); saveExamSoon(); toast(q.caseStudyId ? 'השאלה נוספה, וסיפור המקרה צורף פעם אחת (אפשר להסיר במבחן)' : 'השאלה נוספה למבחן'); return render(); }
  if (d.uid && !e.target.matches('input')) { S.sel = d.uid; if (S.mode === 'split') S.modal = d.uid; return render(); }
  if (d.rmimg) { const [a, b] = d.rmimg.split(':'); const it = S.exam.items.find(i => i.id === a); it.images = it.images.filter(i => i.id !== b); saveExamSoon(); return render(); }
  if (d.mv) { const [dir, id] = d.mv.split(':'); moveItem(S.exam, id, dir === 'up' ? -1 : 1); saveExamSoon(); return render(); }
  if (d.rm) { removeItem(S.exam, d.rm); saveExamSoon(); return render(); }
  if (d.edit) { S.editing.has(d.edit) ? S.editing.delete(d.edit) : S.editing.add(d.edit); return render(); }
  if (d.delblk) { const [id, bi] = d.delblk.split(':'); const it = S.exam.items.find(i => i.id === id); it.snap.blocks.splice(+bi, 1); it.edited = true; saveExamSoon(); return render(); }
  if (d.addblk) { const it = S.exam.items.find(i => i.id === d.addblk); it.snap.blocks.push({ type: 'text', text: '' }); it.edited = true; saveExamSoon(); return render(); }
  if (t.id === 'newq') { const it = { id: uid(), snap: { uid: 'draft-' + uid(), kind: 'draft', year: null, examCode: null, originalNumber: null, typeId: null, domainId: null, originalPoints: null, caseStudyId: null, blocks: [{ type: 'text', text: '' }], rubric: null }, edited: false, points: null, answerLines: 3, pageBreak: false, images: [] }; S.exam.items.push(it); S.editing.add(it.id); saveExamSoon(); return render(); }
  if (d.savepq) { S.pq = itemToDraft(S.exam.items.find(i => i.id === d.savepq)); S.tab = 'personal'; return render(); }
  if (d.pqnew !== undefined) { S.pq = emptyDraft(); return render(); }
  if (d.pqedit) { S.pq = questionToDraft(S.personal.find(q => q.uid === d.pqedit)); return render(); }
  if (d.pqcancel !== undefined) { S.pq = null; return render(); }
  if (d.pqadd) { S.pq[d.pqadd].push(''); return render(); }
  if (d.pqrm) { const [k, i] = d.pqrm.split(':'); S.pq[k].splice(+i, 1); return render(); }
  if (d.pqsave !== undefined) {
    const err = validateDraft(S.pq); if (err) { S.pq.error = err; return render(); }
    const q = draftToQuestion(S.pq); await store.savePersonalQuestion(q); S.personal = await store.loadPersonal(); S.questions = S.questions.filter(x => x.kind !== 'personal').concat(S.personal);
    S.pq = null; toast('השאלה נשמרה במאגר האישי'); return render();
  }
  if (d.pqdel) { if (!confirm('למחוק את השאלה האישית? מבחנים שכבר כוללים אותה לא ישתנו.')) return; await store.deletePersonalQuestion(d.pqdel); S.personal = await store.loadPersonal(); S.questions = S.questions.filter(x => x.kind !== 'personal').concat(S.personal); return render(); }
  if (d.addp) { const q = qByUid(d.addp); addQuestion(S.exam, q, null); saveExamSoon(); toast('השאלה נוספה למבחן'); return render(); }
  if (d.suggest) {
    const q = S.personal.find(x => x.uid === d.suggest); const credit = document.querySelector('[data-sgcredit="' + CSS.escape(d.suggest) + '"]')?.checked;
    const name = credit ? (prompt('השם שיוצג כקרדיט:', S.exam.teacher || '') || '') : '';
    if (credit && !name) return;
    await store.submitSuggestion(q, { credit, authorName: name }); S.suggestions = await store.loadSuggestions(); toast('השאלה נשלחה לבדיקה'); return render();
  }
  if (t.id === 'eqsplit') { equalSplit(S.exam); saveExamSoon(); return render(); }
  if (t.id === 'newexam') { S.exam = newExam(); S.editing.clear(); saveExamSoon(); return render(); }
  if (t.id === 'dupexam') { const c = JSON.parse(JSON.stringify(S.exam)); c.id = newExam().id; c.title += ' (עותק)'; S.exam = c; saveExamSoon(); return render(); }
  if (t.id === 'delexam') { if (!confirm('למחוק את המבחן? השאלות במאגר לא יימחקו.')) return; await store.deleteExam(S.exam.id); S.exams = S.exams.filter(x => x.id !== S.exam.id); S.exam = S.exams[0] || newExam(); return render(); }
  if (t.id === 'exp-s' || t.id === 'exp-t') return exportDoc(t.id === 'exp-t' ? 'teacher' : 'student');
  if (d.rmpkg) { if (!confirm('להסיר את החבילה מהמאגר המקומי? מבחנים קיימים שומרים עותקים של השאלות.')) return; await store.removePackage(d.rmpkg); await loadAll(); return render(); }
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
  if (t.id === 'sort') { S.sort = t.value; return render(); }
  if (t.id === 'examsel') { S.exam = S.exams.find(x => x.id === t.value); S.editing.clear(); return render(); }
  if (d.f) { t.checked ? S.f[d.f].add(t.value) : S.f[d.f].delete(t.value); return render(); }
  if (d.chk) { t.checked ? S.checked.add(d.chk) : S.checked.delete(d.chk); return render(); }
  if (d.m) {
    S.exam[d.m] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    saveExamSoon(); if (['targetPoints', 'showPoints'].includes(d.m)) return render(); return;
  }
  if (d.pts) { const it = S.exam.items.find(i => i.id === d.pts); it.points = t.value === '' ? null : Number(t.value); saveExamSoon(); return render(); }
  if (d.lines) { S.exam.items.find(i => i.id === d.lines).answerLines = Number(t.value) || 0; saveExamSoon(); return; }
  if (d.pb) { S.exam.items.find(i => i.id === d.pb).pageBreak = t.checked; saveExamSoon(); return; }
  if (d.pq) { S.pq[d.pq] = t.value; return; }
  if (t.dataset.pqimg !== undefined) {
    const f = t.files[0]; if (!f) return;
    try { const { data, name } = await prepareImage(f); const id = uid(); const key = 'user/' + id; S.media.set(key, data); await store.putMedia(key, data); S.pq.images.push({ key, name }); return render(); }
    catch (err) { return toast('העלאת התמונה נכשלה: ' + err.message); }
  }
  if (d.upimg) {
    const it = S.exam.items.find(i => i.id === d.upimg); const f = t.files[0]; if (!f) return;
    try {
      const { data, name } = await prepareImage(f); const id = uid();
      const key = 'user/' + id; S.media.set(key, data); await store.putMedia(key, data);
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
  if (d.m && t.type !== 'checkbox') { S.exam[d.m] = t.type === 'number' ? Number(t.value) : t.value; saveExamSoon(); }
});
const input = {};
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
    const blob = await toBlob(buildExamDocument(e, { getMedia: k => S.media.get(k) }, mode));
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${(e.title || 'מבחן').replace(/[\\/:*?"<>|]/g, '')} - ${mode === 'teacher' ? 'מורה' : 'תלמיד'}.docx`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('קובץ Word הופק');
  } catch (err) { console.error(err); toast('ההפקה נכשלה: ' + err.message); }
}

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
    if (files.length) { await importFiles(files, { publish: true }); S.tab = 'work'; render(); toast(`נטענו ${S.questions.length} שאלות מחבילות הדוגמה`); }
  } catch { /* אין samples */ }
}
window.__app = { S, importFiles, render };
