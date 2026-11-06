// ממשק מנהל (מקומי). אין כאן אבטחה אמיתית: הרשאות מנהל ייאכפו בשירות הנתונים (Firestore) כשיחובר.
// כל הפעולות עוברות דרך store, כך שהחלפת התשתית לא תשנה את הממשק.
import JSZip from 'jszip';
import { cellLines } from './clean.js';
import { KIND_LABEL } from './adapter.js';

const isPub = q => q.published !== false;
const clone = o => JSON.parse(JSON.stringify(o));
const SUBS = [['home', 'סקירה'], ['import', 'ייבוא ZIP'], ['questions', 'ניהול שאלות'], ['suggestions', 'הצעות ממורים'], ['taxonomy', 'מילוני סיווג'], ['backup', 'גיבוי ושחזור']];

export function createAdmin(ctx) {
  const { S, store, esc, toast, render, label } = ctx;
  S.adm = { sub: 'home', f: { text: '', status: 'all', kind: '', domain: '' }, checked: new Set(), draft: null, publishOnImport: true, bulk: { domain: '', type: '' }, restoreMsg: '' };
  const A = S.adm;
  const bankQs = () => S.questions.filter(q => q.kind !== 'personal');
  const stat = () => { const b = bankQs(); return { total: b.length, pub: b.filter(isPub).length, hidden: b.filter(q => !isPub(q)).length, flag: b.filter(q => q.reviewFlag).length, edited: b.filter(q => q.adminEdited).length, pending: S.suggestions.filter(s => s.status === 'pending').length }; };
  const saveQ = async q => { await store.saveBankQuestion(q); const i = S.questions.findIndex(x => x.uid === q.uid); if (i >= 0) S.questions[i] = q; else S.questions.push(q); };
  const recomputeSearch = q => { q.searchText = [q.title, ...q.blocks.map(b => b.text || ''), ...q.blocks.flatMap(b => (b.rows || []).flat().map(c => cellLines(c).join(' ')))].join(' '); };

  function filteredQs() {
    const f = A.f; const words = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return bankQs().filter(q => {
      if (f.status === 'published' && !isPub(q)) return false;
      if (f.status === 'hidden' && isPub(q)) return false;
      if (f.status === 'flag' && !q.reviewFlag) return false;
      if (f.status === 'edited' && !q.adminEdited) return false;
      if (f.kind && q.kind !== f.kind) return false;
      if (f.domain && q.domainId !== f.domain) return false;
      if (words.length && !words.every(w => q.searchText.toLowerCase().includes(w))) return false;
      return true;
    });
  }
  const opt = (map, sel, ph) => `<option value="">${ph}</option>` + Object.entries(S.tax[map]).map(([k, l]) => `<option value="${esc(k)}" ${sel === k ? 'selected' : ''}>${esc(l)}</option>`).join('');

  // ---------- מסכים ----------
  function view() {
    return `<div class="adm-banner">${S.user ? 'מחובר כמנהל. השינויים נשמרים במאגר המרכזי בענן (הרשאה נאכפת בשרת) ונרשמים ביומן פעולות מנהל.' : 'מצב ניהול מקומי – אין כאן הרשאות אמיתיות. הרשאות מנהל נאכפות רק כשמחוברים כמנהל לענן.'}</div>
    <div class="subtabs">${SUBS.map(([k, t]) => `<button data-adm="sub:${k}" class="${A.sub === k ? 'on' : ''}">${t}${k === 'suggestions' && stat().pending ? ` <span class="badge warn">${stat().pending}</span>` : ''}</button>`).join('')}</div>
    ${A.sub === 'home' ? home() : A.sub === 'import' ? importV() : A.sub === 'questions' ? questionsV() : A.sub === 'suggestions' ? suggestionsV() : A.sub === 'taxonomy' ? taxonomyV() : backupV()}`;
  }
  function home() {
    const s = stat();
    const tile = (n, t, sub) => `<button class="tile" data-adm="sub:${sub}"><b>${n}</b><span>${t}</span></button>`;
    return `<div class="tiles">${tile(s.total, 'שאלות במאגר', 'questions')}${tile(s.pending, 'הצעות ממתינות', 'suggestions')}${tile(s.hidden, 'שאלות מוסתרות', 'questions')}${tile(s.flag, 'דורשות בדיקה', 'questions')}</div>
    <div class="card"><b>קיצורי דרך</b><p><button class="btn primary" data-adm="sub:import">ייבוא בחינה</button> <button class="btn" data-adm="sub:questions">ניהול שאלות</button> <button class="btn" data-adm="sub:taxonomy">נושאים</button> <button class="btn" data-adm="sub:suggestions">הצעות ממורים</button> <button class="btn" data-adm="sub:backup">גיבוי</button></p></div>`;
  }
  function importV() {
    return `<div class="card"><div class="drop" id="drop">גררו לכאן קובצי ZIP של חבילות שאלות, או <input type="file" id="files" accept=".zip" multiple></div>
      <p><label><input type="radio" name="pub" data-admf="pubimport" value="1" ${A.publishOnImport ? 'checked' : ''}> ייבא ופרסם</label> &nbsp; <label><input type="radio" name="pub" data-admf="pubimport" value="0" ${A.publishOnImport ? '' : 'checked'}> ייבא כמוסתר</label></p>
      <p class="hint">ייבוא חוזר בטוח: שאלה זהה מדולגת, שאלה שונה עם אותו מזהה מסומנת לבדיקה ולא נדרסת, שאלה חדשה נוספת.</p>
      ${import.meta.env.DEV ? '<p><button class="btn sm" data-adm="devload:">טען חבילות לדוגמה (פיתוח בלבד)</button></p>' : ''}
      ${S.importReports.map(r => `<div class="rep ${r.errors.length ? 'bad' : ''}"><b>${esc(r.fileName)}</b>: ${r.errors.length ? 'נכשל – ' + esc(r.errors.join('; ')) : esc(r.summary)}${r.warnings.length ? `<br>אזהרות: ${esc(r.warnings.join('; '))}` : ''}${r.ignored.length ? `<br>קבצים שאינם חלק מהחבילה (התעלמות): ${esc(r.ignored.join(', '))}` : ''}${r.corrections ? `<br>תוקנו אוטומטית ${r.corrections} שיבושי חילוץ (הנוסח המקורי נשמר)` : ''}</div>`).join('')}</div>
      <div class="card"><b>חבילות במאגר</b>${S.packages.map(p => `<div class="rep">${esc(p.fileName)} · ${esc(KIND_LABEL[p.kind] || p.kind)} · ${p.questionCount} שאלות · ${p.mediaCount} תמונות <button class="btn sm danger" data-adm="rmpkg:${esc(p.id)}">הסר חבילה</button></div>`).join('') || '<div class="empty">אין חבילות</div>'}</div>`;
  }
  function questionsV() {
    const list = filteredQs(); const n = A.checked.size;
    const f = A.f;
    return `<div class="adm-grid"><div class="card">
      <div class="admfilters"><input type="search" data-admf="text" placeholder="חיפוש…" value="${esc(f.text)}">
        <select data-admf="status">${[['all', 'כל הסטטוסים'], ['published', 'מפורסמות'], ['hidden', 'מוסתרות'], ['flag', 'דורשות בדיקה'], ['edited', 'נערכו']].map(([k, l]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select data-admf="kind"><option value="">כל המקורות</option>${['bagrut', 'teacher'].map(k => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select>
        <select data-admf="domain">${opt('domains', f.domain, 'כל התחומים')}</select></div>
      <div class="bulk"><b>${list.length} שאלות</b> <button class="btn sm" data-adm="selall:">בחר הכול</button> <button class="btn sm" data-adm="selnone:">נקה בחירה</button>
        <span class="spacer"></span><span>${n ? `נבחרו ${n}:` : 'סמנו שאלות לפעולה מרובה'}</span>
        <button class="btn sm" data-adm="bulkpub:1" ${n ? '' : 'disabled'}>פרסם</button><button class="btn sm" data-adm="bulkpub:0" ${n ? '' : 'disabled'}>הסתר</button><button class="btn sm" data-adm="bulkflag:" ${n ? '' : 'disabled'}>סמן לבדיקה</button><button class="btn sm danger" data-adm="bulkdel:" ${n ? '' : 'disabled'}>מחק לצמיתות</button></div>
      <div class="bulk"><b>שנה סיווג למסומנות:</b> <select data-admf="bdomain">${opt('domains', A.bulk.domain, 'תחום ראשי (ללא שינוי)')}</select> <select data-admf="btype">${opt('types', A.bulk.type, 'סוג שאלה (ללא שינוי)')}</select> <button class="btn sm primary" data-adm="bulkclass:" ${n && (A.bulk.domain || A.bulk.type) ? '' : 'disabled'}>עדכן רק את השדות שנבחרו</button></div>
      <div class="admlist">${list.slice(0, 300).map(q => `<div class="qrow ${A.draft?.uid === q.uid ? 'sel' : ''}" data-adm="edit:${esc(q.uid)}"><input type="checkbox" data-admchk="${esc(q.uid)}" ${A.checked.has(q.uid) ? 'checked' : ''}><div><div class="t">${esc(q.title || q.blocks.find(b => b.text)?.text.slice(0, 80) || '')}</div><div class="s">${esc(ctx.srcLabel(q))}${q.originalNumber ? ' · שאלה ' + esc(q.originalNumber) : ''} · ${esc(label('domains', q.domainId))}</div><div>${isPub(q) ? '<span class="badge ok">מפורסמת</span>' : '<span class="badge warn">מוסתרת</span>'}${q.reviewFlag ? '<span class="badge warn">לבדיקה</span>' : ''}${q.adminEdited ? '<span class="badge">נערכה</span>' : ''}</div></div></div>`).join('') || '<div class="empty">אין תוצאות</div>'}</div></div>
      <div class="card detail">${A.draft ? editor() : '<div class="empty">בחרו שאלה לעריכה</div>'}</div></div>`;
  }
  function editor() {
    const q = A.draft; const orig = q.adminOrig;
    const blk = q.blocks.map((b, i) => {
      if (b.type === 'text' || b.type === 'caption' || b.type === 'section' || b.type === 'choice') return `<div class="blkedit"><div>${b.label ? `<b>${esc(b.label)}.</b>` : ''}<textarea rows="2" data-admblk="${i}">${esc(b.text)}</textarea></div><button class="btn sm danger" data-adm="delblk:${i}">✕</button></div>`;
      return `<div class="blkedit"><div class="qbody">${ctx.blocksHtml([b]) || '<i>(תמונת בקרה)</i>'}</div><button class="btn sm danger" data-adm="delblk:${i}">✕</button></div>`;
    }).join('');
    const ans = q.rubric?.answer?.filter(b => b.type === 'text' && !b.isKey).map(b => b.text).join('\n') || '';
    return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b>עריכת שאלה</b><span class="spacer"></span>
      <button class="btn sm" data-adm="togglepub:">${isPub(q) ? 'הסתר' : 'פרסם'}</button><button class="btn sm" data-adm="toggleflag:">${q.reviewFlag ? 'בטל סימון לבדיקה' : 'סמן לבדיקה'}</button></div>
      <div class="exam-meta" style="margin:8px 0"><label>כותרת לחיפוש<input data-admd="title" value="${esc(q.title)}"></label>
      <label>תחום ראשי<select data-admd="domainId">${opt('domains', q.domainId, '—')}</select></label>
      <label>סוג שאלה<select data-admd="typeId">${opt('types', q.typeId, '—')}</select></label>
      <label>ניקוד מקור<input type="number" data-admd="points" value="${q.points ?? ''}"></label></div>
      <label class="exam-meta" style="display:block">תחומים נוספים<div>${Object.entries(S.tax.domains).filter(([k]) => k !== q.domainId).map(([k, l]) => `<label style="display:inline-flex;gap:4px;margin-inline-end:10px"><input type="checkbox" data-admadd="${esc(k)}" ${q.addDomainIds.includes(k) ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div></label>
      ${q.reviewFlag && q.conflictNote ? `<div class="editnote">${esc(q.conflictNote)}</div>` : ''}
      <b>תוכן השאלה</b>${blk}<button class="btn sm" data-adm="addblk:">+ פסקה</button>
      <label class="exam-meta" style="display:block;margin-top:8px">תשובה / מחוון (טקסט)<textarea rows="3" data-admans>${esc(ans)}</textarea></label>
      <p><button class="btn primary" data-adm="saveq:">שמור שינויים</button> <button class="btn" data-adm="closeq:">סגור</button></p>
      ${q.corrections?.length || q.issues?.length || orig ? `<details class="adm-hist"><summary>נוסח מקורי, תיקוני חילוץ והיסטוריית בקרה (למנהל בלבד)</summary>
        <div>סטטוס חילוץ: ${esc(q.extractionStatus || '—')} · סטטוס אישור: ${esc(q.reviewStatus || '—')}${q.originalTypeId ? ` · סוג מקורי: ${esc(label('types', q.originalTypeId))}` : ''}</div>
        ${q.issues.map(i => `<div class="corr">${esc(i.severity)} · ${esc(i.type)}: ${esc(i.description)}</div>`).join('')}
        ${q.corrections.map(c => `<div class="corr"><del>${esc(c.from)}</del><br><ins>${esc(c.to)}</ins></div>`).join('<hr>')}
        ${orig ? `<div class="editnote">השאלה נערכה אחרי הייבוא – נוסחה אינו זהה למקור.</div>` : ''}</details>` : ''}`;
  }
  function suggestionsV() {
    const list = S.suggestions.slice().sort((a, b) => b.submittedAt - a.submittedAt);
    if (!list.length) return '<div class="card empty">אין הצעות. (בשלב המקומי נוצרות הצעות מלשונית "המאגר האישי" באותו דפדפן.)</div>';
    return list.map(s => `<div class="card item"><div class="hd"><b>${esc(s.question.title || s.question.blocks.find(b => b.text)?.text.slice(0, 70) || '')}</b>
      <span class="badge">${{ pending: 'ממתינה', approved: 'אושרה', rejected: 'נדחתה', 'in-review': 'בעריכה (עותק מוסתר)' }[s.status]}</span>${s.credit ? `<span class="badge">קרדיט: ${esc(s.authorName)}</span>` : '<span class="badge">ללא קרדיט</span>'}
      <span class="ctrl">${s.status === 'pending' || s.status === 'in-review' ? `<button class="btn sm primary" data-adm="approve:${esc(s.id)}">${s.status === 'in-review' ? 'פרסם כפי שהוא' : 'אשר והוסף למאגר'}</button><button class="btn sm" data-adm="editsg:${esc(s.id)}">${s.status === 'in-review' ? 'פתח לעריכה' : 'ערוך לפני אישור'}</button><button class="btn sm danger" data-adm="reject:${esc(s.id)}">דחה</button>` : ''}</span></div>
      <div class="qbody">${ctx.blocksHtml(s.question.blocks)}</div></div>`).join('');
  }
  function taxonomyV() {
    const used = (map, k) => bankQs().filter(q => (map === 'domains' ? q.domainId : q.typeId) === k).length;
    const sect = (map, title) => `<div class="card"><b>${title}</b>${Object.entries(S.tax[map]).map(([k, l]) => `<div class="taxrow"><code>${esc(k)}</code><input data-admtax="${map}:${esc(k)}" value="${esc(l)}"><span class="badge">${used(map, k)} שאלות</span>${used(map, k) ? '' : `<button class="btn sm danger" data-adm="deltax:${map}:${esc(k)}">מחק</button>`}</div>`).join('')}
      <div class="taxrow"><input id="newid-${map}" placeholder="מזהה באנגלית (קבוע)"><input id="newlabel-${map}" placeholder="שם בעברית"><button class="btn sm primary" data-adm="addtax:${map}">הוסף</button></div></div>`;
    return `<p class="hint">שינוי שם לא משנה את המזהה היציב. נושא עם שאלות אינו ניתן למחיקה עד העברת השאלות לנושא אחר (עריכה מרובה).</p>${sect('domains', 'תחומי ידע / נושאים ראשיים')}${sect('types', 'סוגי שאלות')}`;
  }
  function backupV() {
    return `<div class="card"><b>גיבוי המאגר המרכזי</b><p>קובץ ZIP עם כל שאלות המאגר, סיפורי המקרה, המחוונים, האיורים והמילונים. ללא מבחנים ושאלות אישיות של מורים.</p>
      <p><button class="btn primary" data-adm="backup:">הורד גיבוי</button></p></div>
      <div class="card"><b>שחזור מגיבוי</b><p>הקובץ נבדק, מוצג סיכום, ולפני הדריסה יורד אוטומטית גיבוי בטיחות של המצב הנוכחי.</p>
      <input type="file" accept=".zip" data-admrestore>${A.restoreMsg ? `<div class="rep">${esc(A.restoreMsg)}</div>` : ''}</div>`;
  }

  // ---------- פעולות ----------
  async function makeBackup() {
    const z = new JSZip();
    const central = { version: 1, createdAt: new Date().toISOString(), packages: S.packages, questions: bankQs(), cases: [...S.cases.values()], taxonomy: await store.loadTaxonomy() };
    z.file('central.json', JSON.stringify(central));
    for (const [k, v] of S.media) if (!k.startsWith('user/')) z.file('media/' + encodeURIComponent(k), v);
    return { blob: await z.generateAsync({ type: 'blob', compression: 'DEFLATE' }), central };
  }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

  async function restore(file) {
    try {
      const z = await JSZip.loadAsync(await file.arrayBuffer());
      const cf = z.file('central.json'); if (!cf) throw new Error('חסר central.json – לא קובץ גיבוי של המערכת');
      const c = JSON.parse(await cf.async('string'));
      if (c.version !== 1 || !Array.isArray(c.questions) || !Array.isArray(c.packages) || !Array.isArray(c.cases)) throw new Error('מבנה גיבוי לא תקין');
      if (c.questions.some(q => !q.uid || !q.domainId || !Array.isArray(q.blocks))) throw new Error('שאלות לא תקינות בגיבוי');
      const media = new Map();
      for (const name of Object.keys(z.files).filter(n => n.startsWith('media/') && !z.files[n].dir)) media.set(decodeURIComponent(name.slice(6)), await z.file(name).async('uint8array'));
      const missing = []; for (const q of c.questions) for (const b of q.blocks) if (b.mediaKey && !media.has(b.mediaKey)) missing.push(b.mediaKey);
      if (missing.length) throw new Error('חסרים קובצי מדיה בגיבוי: ' + missing.slice(0, 3).join(', '));
      const msg = `לשחזר ${c.questions.length} שאלות, ${c.cases.length} סיפורי מקרה ו־${media.size} תמונות (גיבוי מ־${c.createdAt.slice(0, 10)})?\nהמאגר המרכזי הנוכחי (${bankQs().length} שאלות) יוחלף. נתונים אישיים ומבחנים לא ייפגעו. לפני כן יורד גיבוי בטיחות.`;
      if (!confirm(msg)) { A.restoreMsg = 'השחזור בוטל.'; return render(); }
      const safety = await makeBackup(); download(safety.blob, `גיבוי-בטיחות-לפני-שחזור-${Date.now()}.zip`);
      await store.replaceCentral({ packages: c.packages, questions: c.questions, cases: c.cases, media, taxonomy: c.taxonomy });
      await ctx.loadAll(); A.restoreMsg = `שוחזרו ${c.questions.length} שאלות.`; render();
    } catch (e) { A.restoreMsg = 'השחזור נכשל: ' + e.message; render(); }
  }

  async function approve(id, { publish = true } = {}) {
    const s = S.suggestions.find(x => x.id === id); const src = clone(s.question);
    const nid = 'approved-' + id;
    for (const b of src.blocks) if (b.mediaKey?.startsWith('user/')) { const nk = `central/${nid}/${b.mediaKey.slice(5)}`; const data = S.media.get(b.mediaKey); if (data) { S.media.set(nk, data); await store.putMedia(nk, data); b.mediaKey = nk; } }
    if (src.rubric) for (const b of src.rubric.answer) if (b.mediaKey?.startsWith('user/')) { const nk = `central/${nid}/${b.mediaKey.slice(5)}`; const data = S.media.get(b.mediaKey); if (data) { S.media.set(nk, data); await store.putMedia(nk, data); b.mediaKey = nk; } }
    const q = { ...src, uid: nid, pkgId: 'approved', kind: 'teacher', published: publish, credit: s.credit ? s.authorName : null, fromSuggestion: id, approvedAt: Date.now(), year: null, examCode: null, originalNumber: null };
    await saveQ(q); s.status = publish ? 'approved' : 'in-review'; s.draftUid = nid; await store.saveSuggestion(s);
    toast(publish ? 'נוצרה רשומה עצמאית במאגר המרכזי' : 'נוצר עותק מוסתר לעריכה'); return q;
  }

  // ---------- אירועים ----------
  async function click(t, d) {
    const a = t.dataset.adm; if (!a) { return false; }
    const i = a.indexOf(':'); const act = a.slice(0, i), arg = a.slice(i + 1);
    if (act === 'sub') { A.sub = arg; if (arg !== 'questions') A.draft = null; render(); return true; }
    if (act === 'edit') { if (!A.draft || A.draft.uid !== arg) { A.draft = clone(S.questions.find(q => q.uid === arg)); } render(); return true; }
    if (act === 'closeq') { A.draft = null; render(); return true; }
    if (act === 'selall') { filteredQs().forEach(q => A.checked.add(q.uid)); render(); return true; }
    if (act === 'selnone') { A.checked.clear(); render(); return true; }
    if (act === 'bulkpub') { for (const q of S.questions.filter(q => A.checked.has(q.uid))) { q.published = arg === '1'; await saveQ(q); } toast(`${A.checked.size} שאלות ${arg === '1' ? 'פורסמו' : 'הוסתרו'}`); render(); return true; }
    if (act === 'bulkflag') { for (const q of S.questions.filter(q => A.checked.has(q.uid))) { q.reviewFlag = true; await saveQ(q); } render(); return true; }
    if (act === 'bulkdel') {
      const n = A.checked.size; if (!confirm(`למחוק לצמיתות ${n} שאלות מהמאגר? מבחנים של מורים שכבר כוללים אותן לא ישתנו. אי אפשר לבטל.`)) return true;
      for (const uid of A.checked) { await store.deleteBankQuestion(uid); S.questions = S.questions.filter(q => q.uid !== uid); }
      A.checked.clear(); A.draft = null; toast(`${n} שאלות נמחקו`); render(); return true;
    }
    if (act === 'bulkclass') {
      const { domain, type } = A.bulk; const n = A.checked.size;
      if (!confirm(`לעדכן ${n} שאלות? ישתנו רק: ${[domain && 'תחום ראשי', type && 'סוג שאלה'].filter(Boolean).join(' ו')}. שאר השדות לא ייגעו.`)) return true;
      for (const q of S.questions.filter(q => A.checked.has(q.uid))) {
        q.adminOrig ||= { domainId: q.domainId, typeId: q.typeId, addDomainIds: q.addDomainIds, blocks: q.blocks, rubric: q.rubric, title: q.title, points: q.points };
        if (domain) { q.domainId = domain; q.addDomainIds = q.addDomainIds.filter(x => x !== domain); }
        if (type) q.typeId = type;
        q.adminEdited = true; await saveQ(q);
      }
      toast('הסיווג עודכן'); render(); return true;
    }
    if (act === 'togglepub') {
      A.draft.published = !isPub(A.draft); await saveQ(clone(A.draft));
      if (A.draft.fromSuggestion && A.draft.published) { const s = S.suggestions.find(x => x.id === A.draft.fromSuggestion); if (s) { s.status = 'approved'; await store.saveSuggestion(s); } }
      render(); return true;
    }
    if (act === 'toggleflag') { A.draft.reviewFlag = !A.draft.reviewFlag; await saveQ(clone(A.draft)); render(); return true; }
    if (act === 'delblk') { A.draft.blocks.splice(+arg, 1); render(); return true; }
    if (act === 'addblk') { A.draft.blocks.push({ type: 'text', text: '' }); render(); return true; }
    if (act === 'saveq') {
      const cur = S.questions.find(q => q.uid === A.draft.uid); const q = clone(A.draft);
      q.adminOrig ||= { domainId: cur.domainId, typeId: cur.typeId, addDomainIds: cur.addDomainIds, blocks: cur.blocks, rubric: cur.rubric, title: cur.title, points: cur.points };
      q.adminEdited = true; q.addDomainIds = q.addDomainIds.filter(x => x !== q.domainId); recomputeSearch(q);
      if (!q.domainId) { toast('חובה נושא ראשי'); return true; }
      if (q.blocks.length === 0) { toast('חובה תוכן'); return true; }
      await saveQ(q); A.draft = clone(q); toast('נשמר'); render(); return true;
    }
    if (act === 'rmpkg') { if (!confirm('להסיר את החבילה והשאלות שלה מהמאגר?')) return true; await store.removePackage(arg); await ctx.loadAll(); render(); return true; }
    if (act === 'devload') { await ctx.devLoad(); return true; }
    if (act === 'approve') {
      const s = S.suggestions.find(x => x.id === arg);
      if (s.draftUid) { const q = S.questions.find(x => x.uid === s.draftUid); q.published = true; await saveQ(q); s.status = 'approved'; await store.saveSuggestion(s); toast('פורסם במאגר המרכזי'); }
      else await approve(arg);
      render(); return true;
    }
    if (act === 'reject') { const s = S.suggestions.find(x => x.id === arg); s.status = 'rejected'; await store.saveSuggestion(s); render(); return true; }
    if (act === 'editsg') {
      const s = S.suggestions.find(x => x.id === arg); const q = s.draftUid ? S.questions.find(x => x.uid === s.draftUid) : await approve(arg, { publish: false });
      A.sub = 'questions'; A.draft = clone(q); render(); return true;
    }
    if (act === 'addtax') {
      const id = document.getElementById('newid-' + arg).value.trim(), lab = document.getElementById('newlabel-' + arg).value.trim();
      if (!/^[a-z][a-z0-9_]*$/.test(id) || !lab) { toast('מזהה באנגלית (a-z, _) ושם בעברית חובה'); return true; }
      if (S.tax[arg][id]) { toast('המזהה כבר קיים'); return true; }
      const tx = await store.loadTaxonomy(); (tx[arg] ||= {})[id] = lab; await store.saveTaxonomy(tx); S.tax[arg][id] = lab; render(); return true;
    }
    if (act === 'deltax') {
      const [map, k] = arg.split(':'); if (!confirm('למחוק את הערך מהמילון?')) return true;
      const tx = await store.loadTaxonomy(); if (tx[map]) delete tx[map][k]; await store.saveTaxonomy(tx); delete S.tax[map][k]; render(); return true;
    }
    if (act === 'backup') { const { blob, central } = await makeBackup(); download(blob, `גיבוי-מאגר-מרכזי-${central.createdAt.slice(0, 10)}.zip`); toast(`הגיבוי הורד (${central.questions.length} שאלות)`); return true; }
    return false;
  }
  async function change(t, d) {
    if (t.dataset.admchk) { t.checked ? A.checked.add(t.dataset.admchk) : A.checked.delete(t.dataset.admchk); render(); return true; }
    if (t.dataset.admrestore !== undefined) { if (t.files[0]) await restore(t.files[0]); return true; }
    const f = t.dataset.admf;
    if (f === 'pubimport') { A.publishOnImport = t.value === '1'; return true; }
    if (f === 'status' || f === 'kind' || f === 'domain') { A.f[f] = t.value; render(); return true; }
    if (f === 'bdomain') { A.bulk.domain = t.value; render(); return true; }
    if (f === 'btype') { A.bulk.type = t.value; render(); return true; }
    if (t.dataset.admd) { const k = t.dataset.admd; A.draft[k] = k === 'points' ? (t.value === '' ? null : Number(t.value)) : t.value; return true; }
    if (t.dataset.admadd) { const k = t.dataset.admadd; const set = new Set(A.draft.addDomainIds); t.checked ? set.add(k) : set.delete(k); A.draft.addDomainIds = [...set]; return true; }
    if (t.dataset.admtax) {
      const [map, k] = t.dataset.admtax.split(':'); const tx = await store.loadTaxonomy(); (tx[map] ||= {})[k] = t.value; await store.saveTaxonomy(tx); S.tax[map][k] = t.value; toast('השם עודכן'); return true;
    }
    return false;
  }
  function input(t) {
    const f = t.dataset.admf;
    if (f === 'text') { A.f.text = t.value; clearTimeout(input.h); input.h = setTimeout(() => { render(); const e = document.querySelector('[data-admf=text]'); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }, 250); return true; }
    if (t.dataset.admblk !== undefined) { A.draft.blocks[+t.dataset.admblk].text = t.value; return true; }
    if (t.dataset.admans !== undefined) {
      const txt = t.value; const r = A.draft.rubric ||= { matchStatus: null, officialKind: 'official', pages: [], answer: [], notes: null, points: null, allocation: [] };
      const rest = r.answer.filter(b => !(b.type === 'text' && !b.isKey)); r.answer = txt.trim() ? [{ type: 'text', text: txt }, ...rest] : rest; return true;
    }
    if (t.dataset.admd) { const k = t.dataset.admd; if (k === 'title') { A.draft.title = t.value; return true; } }
    return false;
  }
  return { view, click, change, input, stat };
}
