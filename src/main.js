import { parsePackage, KIND_LABEL } from './adapter.js';
import { cellLines } from './clean.js';
import * as db from './db.js';
import { newExam, addQuestion, totalPoints, removeItem, moveItem, equalSplit, isChoiceQuestion, caseFirstUse } from './exam.js';
import { buildExamDocument, toBlob } from './docx-export.js';

// ---------- מצב ----------
const S = {
  tab: 'bank',
  packages: [], questions: [], cases: new Map(), media: new Map(), urls: new Map(),
  tax: { types: {}, domains: {} },
  f: { text: '', domains: new Set(), types: new Set(), kinds: new Set(), years: new Set(), codes: new Set() },
  sort: 'year-desc',
  sel: null, checked: new Set(),
  exam: null, exams: [], editing: new Set(),
  importReports: [],
};
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2800); }

// ---------- טעינה ----------
async function loadAll() {
  S.packages = await db.getAll('packages');
  S.questions = await db.getAll('questions');
  S.cases = new Map((await db.getAll('cases')).map(c => [c.uid, c]));
  S.media = new Map((await db.getAll('media')).map(m => [m.key, m.data]));
  S.exams = (await db.getAll('exams')).sort((a, b) => b.updatedAt - a.updatedAt);
  S.tax = { types: {}, domains: {} };
  for (const p of S.packages) { Object.assign(S.tax.types, p.taxonomy.types); Object.assign(S.tax.domains, p.taxonomy.domains); }
  if (!S.exam) S.exam = S.exams[0] || newExam();
}
const qByUid = uid => S.questions.find(q => q.uid === uid);
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
    await db.put('exams', JSON.parse(JSON.stringify(S.exam)));
    S.exams = (await db.getAll('exams')).sort((a, b) => b.updatedAt - a.updatedAt);
    const i2 = document.getElementById('saveind'); if (i2) i2.textContent = 'נשמר ✓';
  }, 350);
}

// ---------- חיפוש ----------
function srcLabel(q) { return q.kind === 'bagrut' ? `בגרות ${q.year ?? ''}${q.examCode ? ' · ' + q.examCode : ''}` : 'שאלה ממורה'; }
function filtered() {
  const f = S.f; const words = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let r = S.questions.filter(q => {
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
function blocksHtml(blocks) {
  return blocks.map(b => {
    if (b.type === 'text') return `<p>${esc(b.text)}</p>`;
    if (b.type === 'caption') return `<p><i>${esc(b.text)}</i></p>`;
    if (b.type === 'section') return `<div class="sec"><b>${esc(b.label)}.</b> ${esc(b.text)}${b.points != null ? ` <span class="badge">${b.points} נק׳</span>` : ''}</div>`;
    if (b.type === 'choice') return `<div class="ch"><b>${esc(b.label)}.</b> ${esc(b.text)}</div>`;
    if (b.type === 'table') return `<table>${b.rows.map(r => `<tr>${r.map(c => `<td>${cellHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    if (b.type === 'image') return b.reference ? '' : `<img src="${mediaUrl(b.mediaKey)}" alt="${esc(b.caption || 'איור')}">`;
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
  $app.innerHTML = `
  <header class="top">
    <h1>בונה מבחנים · מדעי הבריאות</h1>
    <nav class="tabs">
      ${[['bank', 'מאגר שאלות'], ['exam', 'המבחן שלי'], ['import', 'ייבוא חבילות']].map(([k, t]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${t}</button>`).join('')}
    </nav>
    <span class="spacer"></span>
    <span class="pill" id="pill">${e.items.length} שאלות במבחן · ${totalPoints(e)} נק׳</span>
  </header>
  <main>${S.tab === 'bank' ? bankView() : S.tab === 'exam' ? examView() : importView()}</main>`;
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
      ${filterGroup('נושא (תחום ראשי)', 'domains', uniq(S.questions.map(q => q.domainId)).map(d => [d, label('domains', d)]))}
      ${filterGroup('סוג שאלה', 'types', uniq(S.questions.map(q => q.typeId)).map(t => [t, label('types', t)]))}
      ${filterGroup('מקור השאלות', 'kinds', uniq(S.questions.map(q => q.kind)).map(k => [k, KIND_LABEL[k]]))}
      ${filterGroup('שנת בחינה', 'years', uniq(S.questions.map(q => q.year)).sort((a, b) => b - a).map(y => [y, y]))}
      ${filterGroup('סמל שאלון', 'codes', uniq(S.questions.map(q => q.examCode)).map(c => [c, c]))}
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
  const refs = q.blocks.filter(b => b.type === 'image' && b.reference);
  return `<div><button class="btn primary" data-add="${esc(q.uid)}">הוסף למבחן</button> ${inExam ? `<span class="badge ok">כבר במבחן ×${inExam}</span>` : ''}</div>
    <div style="margin:8px 0">${badgesOf(q)}${q.points != null ? `<span class="badge">${q.points} נק׳ במקור</span>` : ''}<span class="badge">${q.reviewStatus === 'approved' ? 'מאושר' : esc(q.reviewStatus || '')}</span></div>
    ${cs ? `<div class="casebox"><h4>סיפור מקרה (משותף ל-${cs.questionIds.length} שאלות)</h4>${blocksHtml(cs.blocks)}</div>` : ''}
    <div class="qbody">${blocksHtml(q.blocks)}</div>
    ${rubricHtml(q.rubric)}
    ${q.corrections.length ? `<details style="margin-top:10px"><summary>תוקנו ${q.corrections.length} שיבושי חילוץ (הנוסח המקורי נשמר)</summary>${q.corrections.map(c => `<div class="corr"><del>${esc(c.from)}</del><br><ins>${esc(c.to)}</ins></div>`).join('<hr>')}</details>` : ''}
    ${refs.length ? `<details><summary>תמונת מקור של הטבלה (לבקרה)</summary>${refs.map(b => `<img src="${mediaUrl(b.mediaKey)}" style="max-width:100%">`).join('')}</details>` : ''}`;
}

function examView() {
  const e = S.exam; const tot = totalPoints(e); const diff = tot - e.targetPoints; const first = caseFirstUse(e);
  return `<div class="card">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <select id="examsel">${S.exams.some(x => x.id === e.id) ? '' : `<option value="${e.id}">${esc(e.title)} (לא נשמר)</option>`}${S.exams.map(x => `<option value="${x.id}" ${x.id === e.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>
      <button class="btn sm" id="newexam">מבחן חדש</button><button class="btn sm" id="dupexam">שכפל</button><button class="btn sm danger" id="delexam">מחק מבחן</button>
      <span class="spacer"></span><span id="saveind" class="badge"></span>
    </div>
    <div class="exam-meta">
      <label>כותרת המבחן<input data-m="title" value="${esc(e.title)}"></label>
      <label>בית ספר<input data-m="school" value="${esc(e.school)}"></label>
      <label>שם המורה<input data-m="teacher" value="${esc(e.teacher)}"></label>
      <label>תאריך<input data-m="date" value="${esc(e.date)}" placeholder="למשל 05.11.2026"></label>
      <label>סך נקודות רצוי<input type="number" data-m="targetPoints" value="${e.targetPoints}"></label>
      <label style="flex-direction:row;align-items:center;gap:6px;margin-top:18px"><input type="checkbox" data-m="showPoints" ${e.showPoints ? 'checked' : ''}> הצג ניקוד במסמך התלמיד</label>
    </div>
    <label class="exam-meta" style="display:block;margin-top:10px"><label>הוראות כלליות (אופציונלי)<textarea data-m="instructions" rows="2" style="width:100%">${esc(e.instructions)}</textarea></label></label>
  </div>
  <div class="totalbar ${diff ? 'warn' : ''}" id="totalbar">${totalHtml(tot, e.targetPoints)}
    <span class="spacer"></span>
    <button class="btn sm" id="eqsplit">הצע חלוקה שווה</button>
    <button class="btn primary" id="exp-s" ${e.items.length ? '' : 'disabled'}>הפק Word לתלמיד</button>
    <button class="btn primary" id="exp-t" ${e.items.length ? '' : 'disabled'}>הפק Word למורה</button>
  </div>
  ${e.items.length ? e.items.map((it, i) => itemHtml(it, i, first)).join('') : '<div class="card empty">המבחן ריק. הוסיפו שאלות מלשונית "מאגר שאלות".</div>'}`;
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
        <button class="btn sm danger" data-rm="${it.id}">מחק</button>
      </span></div>
    ${it.edited ? '<div class="editnote">השאלה נערכה. מומלץ לבדוק אם יש צורך לעדכן את הניקוד</div>' : ''}
    ${editing ? editorHtml(it) : `<div class="qbody">${blocksHtml(it.snap.blocks)}</div>`}
  </div>`;
}
function editorHtml(it) {
  return it.snap.blocks.map((b, bi) => {
    const del = `<button class="btn sm danger" data-delblk="${it.id}:${bi}" title="מחק רכיב">✕</button>`;
    if (b.type === 'text' || b.type === 'caption') return `<div class="blkedit"><textarea data-blk="${it.id}:${bi}">${esc(b.text)}</textarea>${del}</div>`;
    if (b.type === 'section' || b.type === 'choice') return `<div class="blkedit"><div><b>${esc(b.label)}.</b><textarea data-blk="${it.id}:${bi}">${esc(b.text)}</textarea></div>${del}</div>`;
    return `<div class="blkedit"><div class="qbody">${blocksHtml([b]) || '<i>(תמונת בקרה מוסתרת)</i>'}</div>${del}</div>`;
  }).join('') + `<button class="btn sm" data-addblk="${it.id}">+ הוסף פסקה</button>`;
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

async function importFiles(fileList) {
  S.importReports = [];
  for (const f of fileList) {
    const r = await parsePackage(await f.arrayBuffer(), f.name);
    const rep = { ...r.report, summary: '' };
    if (!r.report.errors.length) {
      try {
        await db.savePackage(r);
        rep.summary = `${r.questions.length} שאלות, ${r.cases.length} סיפורי מקרה, ${r.media.size} תמונות (${KIND_LABEL[r.pkg.kind]})`;
      } catch (e) { rep.errors.push('שמירה מקומית נכשלה: ' + e.message); }
    }
    S.importReports.push(rep);
  }
  await loadAll(); render();
}

// ---------- אירועים ----------
$app.addEventListener('click', async e => {
  const t = e.target.closest('button, .qrow'); if (!t) return;
  const d = t.dataset;
  if (d.tab) { S.tab = d.tab; return render(); }
  if (t.id === 'reset') { S.f = { text: '', domains: new Set(), types: new Set(), kinds: new Set(), years: new Set(), codes: new Set() }; return render(); }
  if (t.id === 'selall') { filtered().forEach(q => S.checked.add(q.uid)); return render(); }
  if (t.id === 'addchecked') { const n = S.checked.size; for (const q of S.questions.filter(q => S.checked.has(q.uid))) addQuestion(S.exam, q, S.cases.get(q.caseStudyId)); S.checked.clear(); saveExamSoon(); toast(`${n} שאלות נוספו למבחן`); return render(); }
  if (d.add) { const q = qByUid(d.add); addQuestion(S.exam, q, S.cases.get(q.caseStudyId)); saveExamSoon(); toast(q.caseStudyId ? 'השאלה נוספה, וסיפור המקרה צורף פעם אחת (אפשר להסיר במבחן)' : 'השאלה נוספה למבחן'); return render(); }
  if (d.uid && !e.target.matches('input')) { S.sel = d.uid; return render(); }
  if (d.mv) { const [dir, id] = d.mv.split(':'); moveItem(S.exam, id, dir === 'up' ? -1 : 1); saveExamSoon(); return render(); }
  if (d.rm) { removeItem(S.exam, d.rm); saveExamSoon(); return render(); }
  if (d.edit) { S.editing.has(d.edit) ? S.editing.delete(d.edit) : S.editing.add(d.edit); return render(); }
  if (d.delblk) { const [id, bi] = d.delblk.split(':'); const it = S.exam.items.find(i => i.id === id); it.snap.blocks.splice(+bi, 1); it.edited = true; saveExamSoon(); return render(); }
  if (d.addblk) { const it = S.exam.items.find(i => i.id === d.addblk); it.snap.blocks.push({ type: 'text', text: '' }); it.edited = true; saveExamSoon(); return render(); }
  if (t.id === 'eqsplit') { equalSplit(S.exam); saveExamSoon(); return render(); }
  if (t.id === 'newexam') { S.exam = newExam(); S.editing.clear(); saveExamSoon(); return render(); }
  if (t.id === 'dupexam') { const c = JSON.parse(JSON.stringify(S.exam)); c.id = newExam().id; c.title += ' (עותק)'; S.exam = c; saveExamSoon(); return render(); }
  if (t.id === 'delexam') { if (!confirm('למחוק את המבחן? השאלות במאגר לא יימחקו.')) return; await db.del('exams', S.exam.id); S.exams = S.exams.filter(x => x.id !== S.exam.id); S.exam = S.exams[0] || newExam(); return render(); }
  if (t.id === 'exp-s' || t.id === 'exp-t') return exportDoc(t.id === 'exp-t' ? 'teacher' : 'student');
  if (d.rmpkg) { if (!confirm('להסיר את החבילה מהמאגר המקומי? מבחנים קיימים שומרים עותקים של השאלות.')) return; await db.removePackage(d.rmpkg); await loadAll(); return render(); }
  if (t.id === 'devload') {
    const names = await (await fetch('/__samples/')).json(); const files = [];
    for (const n of names) files.push(new File([await (await fetch('/__samples/' + encodeURIComponent(n))).arrayBuffer()], n));
    return importFiles(files);
  }
});
$app.addEventListener('change', async e => {
  const t = e.target; const d = t.dataset;
  if (t.id === 'files') return importFiles([...t.files]);
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
  if (d.casein) { S.exam.cases[d.casein].include = t.checked; saveExamSoon(); return render(); }
});
$app.addEventListener('input', e => {
  const t = e.target; const d = t.dataset;
  if (t.id === 'q') { S.f.text = t.value; clearTimeout(input.h); input.h = setTimeout(() => { render(); const q = document.getElementById('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); }
  if (d.blk) { const [id, bi] = d.blk.split(':'); const it = S.exam.items.find(i => i.id === id); it.snap.blocks[+bi].text = t.value; if (!it.edited) { it.edited = true; } saveExamSoon(); }
  if (d.m && t.type !== 'checkbox') { S.exam[d.m] = t.type === 'number' ? Number(t.value) : t.value; saveExamSoon(); }
});
const input = {};
$app.addEventListener('dragover', e => { if (e.target.closest('#drop')) { e.preventDefault(); e.target.closest('#drop').classList.add('over'); } });
$app.addEventListener('drop', e => { if (e.target.closest('#drop')) { e.preventDefault(); importFiles([...e.dataTransfer.files].filter(f => f.name.endsWith('.zip'))); } });

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

await loadAll();
render();
// פיתוח בלבד: מאגר ריק -> טעינה אוטומטית של חבילות הדוגמה, כדי שהאתר ייפתח עם נתונים
if (import.meta.env.DEV && !S.packages.length) {
  try {
    const names = await (await fetch('/__samples/')).json(); const files = [];
    for (const n of names) files.push(new File([await (await fetch('/__samples/' + encodeURIComponent(n))).arrayBuffer()], n));
    if (files.length) { await importFiles(files); S.tab = 'bank'; render(); toast(`נטענו ${S.questions.length} שאלות מחבילות הדוגמה`); }
  } catch { /* אין samples */ }
}
window.__app = { S, importFiles, render };
