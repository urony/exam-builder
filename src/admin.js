// ממשק מנהל (מקומי). אין כאן אבטחה אמיתית: הרשאות מנהל ייאכפו בשירות הנתונים (Firestore) כשיחובר.
// כל הפעולות עוברות דרך store, כך שהחלפת התשתית לא תשנה את הממשק.
import JSZip from 'jszip';
import { buildBackup, parseBackup } from './backup.js';
import { cellLines } from './clean.js';
import { KIND_LABEL } from './adapter.js';
import { BULK_FIELDS, EMPTY_BULK, chosen, planBulk, runBulk, describe } from './admin-bulk.js';
import { EMPTY_FILTERS, applyFilters, facets, sessionsOf, activeCount, packageOptions, yearOf, authorOf, submitterOf, submitterLabel, isPub, rubricKind, RUBRIC_LABEL, NO_YEAR, NO_SESSION, UNKNOWN_AUTHOR, UNKNOWN_KIND } from './admin-filters.js';

const NL = String.fromCharCode(10);
const clone = o => JSON.parse(JSON.stringify(o));
const SUBS = [['home', 'סקירה'], ['import', 'ייבוא ZIP'], ['questions', 'ניהול שאלות'], ['suggestions', 'הצעות ממורים'], ['taxonomy', 'מילוני סיווג'], ['backup', 'גיבוי ושחזור']];

export function createAdmin(ctx) {
  const { S, store, esc, toast, render, label } = ctx;
  S.adm = { sub: 'home', f: EMPTY_FILTERS(), limit: 200, ix: new Map(), checked: new Set(), draft: null, publishOnImport: true, bulk: EMPTY_BULK(), bulkMsg: '', restoreMsg: '' };
  const A = S.adm;
  const bankQs = () => S.questions.filter(q => q.kind !== 'personal');
  const stat = () => { const b = bankQs(); return { total: b.length, pub: b.filter(isPub).length, hidden: b.filter(q => !isPub(q)).length, flag: b.filter(q => q.reviewFlag).length, edited: b.filter(q => q.adminEdited).length, pending: S.suggestions.filter(s => s.status === 'pending').length }; };
  const saveQ = async q => { await store.saveBankQuestion(q); const i = S.questions.findIndex(x => x.uid === q.uid); if (i >= 0) S.questions[i] = q; else S.questions.push(q); };
  const recomputeSearch = q => { q.searchText = [q.title, ...q.blocks.map(b => b.text || ''), ...q.blocks.flatMap(b => (b.rows || []).flat().map(c => cellLines(c).join(' ')))].join(' '); };

  const filteredQs = () => applyFilters(bankQs(), A.f, A.ix);
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
  const authorLine = q => { const a = authorOf(q), sb = submitterOf(q); return [a ? 'מחבר: ' + a : (q.kind === 'bagrut' ? '' : 'מחבר לא ידוע'), sb ? 'הוגש ע״י: ' + submitterLabel(sb) : ''].filter(Boolean).join(' · '); };
  const sel = (key, ph, opts, cur) => `<select data-admf="${key}" aria-label="${esc(ph)}"><option value="">${esc(ph)}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  function filterBar(all) {
    const f = A.f, fc = facets(all);
    const yearOpts = [...fc.years.map(([y, n]) => [String(y), `${y} (${n})`]), ...(fc.noYear ? [[NO_YEAR, `ללא שנת בחינה (${fc.noYear})`]] : [])];
    const inYear = f.year && f.year !== NO_YEAR ? all.filter(q => String(yearOf(q)) === f.year) : [];
    const ses = inYear.length ? sessionsOf(inYear) : [];
    const kindOpts = [['bagrut', 'שאלות בגרות'], ['teacher', 'שאלות מורים'], ...(fc.kinds.has(UNKNOWN_KIND) ? [[UNKNOWN_KIND, 'מקור לא מוגדר']] : [])];
    const tOpts = [...(fc.unknownAuthor ? [[UNKNOWN_AUTHOR, `מחבר לא ידוע (${fc.unknownAuthor})`]] : []), ...fc.authors.map(([n, c]) => ['a:' + n, `מחבר: ${n} (${c})`]), ...fc.submitters.map(x => ['s:' + x.uid, `הוגש ע״י: ${submitterLabel(x)} (${x.n})`])];
    const pk = packageOptions(S.packages, all).map(p => [p.id, `${p.label} (${p.n})`]);
    const adv = f.type || f.teacher || f.pkg || f.session;
    return `<div class="admfilters"><input type="search" data-admf="text" placeholder="חיפוש…" value="${esc(f.text)}">
        ${sel('status', 'כל הסטטוסים', [['published', 'מפורסמות'], ['hidden', 'מוסתרות'], ['flag', 'דורשות בדיקה'], ['edited', 'נערכו']], f.status === 'all' ? '' : f.status)}
        ${sel('kind', 'כל המקורות', kindOpts, f.kind)}
        ${sel('year', 'כל השנים', yearOpts, f.year)}
        ${ses.length > 1 ? sel('session', 'כל המועדים', ses.map(([v, n]) => [v, `${v === NO_SESSION ? 'ללא מועד' : v} (${n})`]), f.session) : ''}
        ${sel('domain', 'כל התחומים', Object.entries(S.tax.domains), f.domain)}</div>
      <details class="admmore" ${adv ? 'open' : ''}><summary>מסננים נוספים: סוג שאלה, מורה, חבילת מקור</summary><div class="admfilters">
        ${sel('type', 'כל סוגי השאלות', Object.entries(S.tax.types), f.type)}
        ${sel('teacher', 'כל המורים והמחברים', tOpts, f.teacher)}
        ${sel('pkg', 'כל החבילות', pk, f.pkg)}</div></details>`;
  }
  function questionsV() {
    const all = bankQs(); const list = filteredQs(); const n = A.checked.size; const act = activeCount(A.f);
    return `<div class="adm-grid"><div class="card">
      ${filterBar(all)}
      <div class="bulk" data-testid="count"><b>${act ? `${list.length} מתוך ${all.length} שאלות` : `${all.length} שאלות`}</b>${act ? ' <button class="btn sm" data-adm="resetf:">איפוס כל המסננים</button>' : ''} <button class="btn sm" data-adm="selall:">בחר הכול (${list.length})</button> <button class="btn sm" data-adm="selnone:">נקה בחירה</button>
        <span class="spacer"></span><span>${n ? `נבחרו ${n}:` : 'סמנו שאלות לפעולה מרובה'}</span>
        <button class="btn sm" data-adm="bulkpub:1" ${n ? '' : 'disabled'}>פרסם</button><button class="btn sm" data-adm="bulkpub:0" ${n ? '' : 'disabled'}>הסתר</button><button class="btn sm" data-adm="bulkflag:" ${n ? '' : 'disabled'}>סמן לבדיקה</button><button class="btn sm danger" data-adm="bulkdel:" ${n ? '' : 'disabled'}>מחק לצמיתות</button></div>
      <details class="admmore" ${A.bulkOpen ? 'open' : ''} data-admbulkdet><summary>עריכה קבוצתית של פרטי מקור וסיווג (${n ? n + ' שאלות נבחרו' : 'סמנו שאלות'})</summary>
        <div class="hint">משתנים רק השדות שמילאתם. שדה ריק = ללא שינוי. ערכי שנה/מועד קודמים נשמרים בהיסטוריית השאלה. תוכן השאלות לא משתנה.</div>
        <div class="admfilters">
          <select data-admb="domain">${opt('domains', A.bulk.domain, 'תחום ראשי (ללא שינוי)')}</select>
          <select data-admb="type">${opt('types', A.bulk.type, 'סוג שאלה (ללא שינוי)')}</select></div>
        <div class="admfilters">
          <input type="number" data-admb="year" placeholder="שנת בחינה" min="1990" max="2100" value="${esc(A.bulk.year)}" ${A.bulk.clearYear ? 'disabled' : ''}><label><input type="checkbox" data-admb="clearYear" ${A.bulk.clearYear ? 'checked' : ''}> נקה שנה</label>
          <input data-admb="session" placeholder="מועד בחינה (למשל קיץ תשפ״ה)" value="${esc(A.bulk.session)}" ${A.bulk.clearSession ? 'disabled' : ''}><label><input type="checkbox" data-admb="clearSession" ${A.bulk.clearSession ? 'checked' : ''}> נקה מועד</label></div>
        <div class="admfilters">
          <input data-admb="author" list="authlist" placeholder="מחבר השאלה (שאלות מורים)" value="${esc(A.bulk.author)}" ${A.bulk.clearAuthor ? 'disabled' : ''}><label><input type="checkbox" data-admb="clearAuthor" ${A.bulk.clearAuthor ? 'checked' : ''}> נקה</label>
          <input data-admb="authorAdmin" list="authlist" placeholder="שיוך מחבר ניהולי" value="${esc(A.bulk.authorAdmin)}" ${A.bulk.clearAuthorAdmin ? 'disabled' : ''}><label><input type="checkbox" data-admb="clearAuthorAdmin" ${A.bulk.clearAuthorAdmin ? 'checked' : ''}> נקה</label>
          <datalist id="authlist">${facets(all).authors.map(([x]) => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div class="hint">חבילת מקור אינה ניתנת לשינוי בעריכה קבוצתית: היא מזהה את מזהי השאלות, התמונות, המחוונים וסיפורי המקרה, ושינוי שלה עלול לשבור אותם. להעברת שאלות בין חבילות יש לייבא מחדש.</div>
        <p><button class="btn sm primary" data-adm="bulkclass:" ${n && Object.keys(chosen(A.bulk).changes).length ? '' : 'disabled'}>עדכן את השדות שנבחרו (${n} שאלות)</button> <button class="btn sm" data-adm="bulkreset:">נקה טופס</button></p>
        ${A.bulkMsg ? `<div class="rep">${esc(A.bulkMsg).split(String.fromCharCode(10)).join('<br>')}</div>` : ''}</details>
      <div class="admlist">${list.slice(0, A.limit).map(q => `<div class="qrow ${A.draft?.uid === q.uid ? 'sel' : ''}" data-adm="edit:${esc(q.uid)}"><input type="checkbox" data-admchk="${esc(q.uid)}" ${A.checked.has(q.uid) ? 'checked' : ''}><div><div class="t">${esc(q.title || q.blocks.find(b => b.text)?.text.slice(0, 80) || '')}</div><div class="s">${esc(ctx.srcLabel(q))}${q.session ? ' · ' + esc(q.session) : ''}${q.originalNumber ? ' · שאלה ' + esc(q.originalNumber) : ''} · ${esc(label('domains', q.domainId))}</div><div class="s">${esc(authorLine(q))}</div><div>${isPub(q) ? '<span class="badge ok">מפורסמת</span>' : '<span class="badge warn">מוסתרת</span>'}${q.reviewFlag ? '<span class="badge warn">לבדיקה</span>' : ''}${q.adminEdited ? '<span class="badge">נערכה</span>' : ''}<span class="badge ${rubricKind(q) === 'none' ? 'warn' : ''}">${RUBRIC_LABEL[rubricKind(q)]}</span></div></div></div>`).join('') || '<div class="empty">אין תוצאות</div>'}${list.length > A.limit ? `<div class="bulk">מוצגות ${A.limit} מתוך ${list.length}. <button class="btn sm" data-adm="more:">הצג עוד 200</button> או צמצמו בעזרת המסננים.</div>` : ''}</div></div>
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
      ${q.kind === 'bagrut' ? '' : `<div class="exam-meta" style="margin:8px 0"><label>מחבר השאלה (שיוך מנהל; לא משנה את נוסח השאלה)<input data-admd="authorAdmin" list="authlist" value="${esc(q.authorAdmin || '')}" placeholder="${esc(q.author || 'מחבר לא ידוע')}"></label><datalist id="authlist">${facets(bankQs()).authors.map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist><div class="hint">${[q.author ? 'מחבר מהחבילה: ' + esc(q.author) : '', q.credit ? 'קרדיט שאושר לפרסום: ' + esc(q.credit) : '', submitterOf(q) ? 'הוגש ע״י: ' + esc(submitterLabel(submitterOf(q))) : ''].filter(Boolean).join(' · ') || 'אין פרטי מחבר שמורים.'}</div></div>`}
      ${q.reviewFlag && q.conflictNote ? `<div class="editnote">${esc(q.conflictNote)}</div>` : ''}
      <b>תוכן השאלה</b>${blk}<button class="btn sm" data-adm="addblk:">+ פסקה</button>
      <div class="hint" style="margin-top:8px">${RUBRIC_LABEL[rubricKind(q)]}${q.rubric?.answer?.some(b => b.mediaKey) ? ' (התמונה מוצגת בגרסת המורה ואינה ניתנת לעריכה כאן)' : ''}</div>
      ${(q.rubric?.answer || []).filter(b => b.mediaKey).map(b => `<div class="qbody">${ctx.blocksHtml([b])}</div>`).join('')}
      <label class="exam-meta" style="display:block;margin-top:8px">תשובה / מחוון (טקסט)<textarea rows="3" data-admans>${esc(ans)}</textarea></label>
      <p><button class="btn primary" data-adm="saveq:">שמור שינויים</button> <button class="btn" data-adm="closeq:">סגור</button></p>
      <details class="adm-hist"><summary>נתוני מקור והיסטוריה (לבדיקה מעמיקה, למנהל בלבד)</summary>
        <div class="hint">נתונים היסטוריים מתהליך החילוץ. אינם משפיעים על פרסום או על אישור השאלה.</div>
        <div>חילוץ: ${esc(q.extractionStatus || '—')} · אישור בחבילת המקור: ${esc(q.reviewStatus || '—')}${q.originalTypeId ? ` · סוג מקורי: ${esc(label('types', q.originalTypeId))}` : ''}${q.pkgId ? ` · חבילה: ${esc(q.pkgId)}` : ''}${q.session ? ` · מועד: ${esc(q.session)}` : ''}</div>
        ${(q.issues || []).map(i => `<div class="corr">${esc(i.severity)} · ${esc(i.type)}: ${esc(i.description)}</div>`).join('')}
        ${(q.corrections || []).map(c => `<div class="corr"><del>${esc(c.from)}</del><br><ins>${esc(c.to)}</ins></div>`).join('<hr>')}
        ${(q.sourceHistory || []).map(h => `<div class="corr">${esc(new Date(h.at).toLocaleString('he-IL'))} · ${esc(BULK_FIELDS[h.field] || h.field)}: ${esc(h.from ?? '—')} ← ${esc(h.to ?? '—')}</div>`).join('')}
        ${orig ? `<div class="editnote">השאלה נערכה אחרי הייבוא – נוסחה אינו זהה למקור.</div>` : ''}</details>`;
  }
  const sgSubmitter = s => s.credit && s.authorName ? s.authorName + ' (קרדיט מאושר)' : 'מורה ' + String(s.authorUid || '').slice(-4);
  const sgTitle = s => s.question.title || s.question.blocks.find(b => b.text)?.text.slice(0, 70) || '(ללא כותרת)';
  function suggestionsV() {
    const list = S.suggestions.slice().sort((a, b) => b.submittedAt - a.submittedAt);
    if (!list.length) return '<div class="card empty">אין הצעות. (בשלב המקומי נוצרות הצעות מלשונית "המאגר האישי" באותו דפדפן.)</div>';
    return list.map(s => `<div class="card item"><div class="hd"><b>${esc(s.question.title || s.question.blocks.find(b => b.text)?.text.slice(0, 70) || '')}</b>
      <span class="badge">${{ pending: 'ממתינה', approved: 'אושרה', rejected: 'נדחתה', 'in-review': 'בעריכה (עותק מוסתר)' }[s.status]}</span>${s.credit ? `<span class="badge">קרדיט: ${esc(s.authorName)}</span>` : '<span class="badge">ללא קרדיט</span>'}
      <span class="ctrl">${s.status === 'pending' || s.status === 'in-review' ? `<button class="btn sm primary" data-adm="approve:${esc(s.id)}">${s.status === 'in-review' ? 'פרסם כפי שהוא' : 'אשר והוסף למאגר'}</button><button class="btn sm" data-adm="editsg:${esc(s.id)}">${s.status === 'in-review' ? 'פתח לעריכה' : 'ערוך לפני אישור'}</button><button class="btn sm danger" data-adm="reject:${esc(s.id)}">דחה</button>` : ''}${s.status === 'pending' || s.status === 'rejected' ? `<button class="btn sm danger" data-adm="delsg:${esc(s.id)}">מחק לצמיתות</button>` : ''}</span></div>
      ${s.status === 'approved' || s.status === 'in-review' ? '<div class="hint">הצעה שאושרה אינה נמחקת מכאן. השאלה שנוצרה ממנה במאגר המרכזי עצמאית, ומנוהלת בלשונית "ניהול שאלות".</div>' : ''}
      <div class="hint">הוגש ע״י: ${esc(sgSubmitter(s))} · ${new Date(s.submittedAt).toLocaleDateString('he-IL')}</div>
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
  // גיבוי שלם: קורא מחדש את המאגר ומושך במפורש כל תמונה (בענן התמונות אינן בזיכרון). נכשל בקול רם אם משהו חסר.
  async function makeBackup(onProgress) {
    const bank = await store.loadBank();
    if (bank.warning) throw new Error('המאגר המרכזי אינו זמין כרגע, לכן לא נוצר גיבוי (כדי לא לגבות מאגר חלקי).');
    const taxonomy = await store.loadTaxonomy();
    const r = await buildBackup({ JSZip, central: { packages: bank.packages, questions: bank.questions, cases: bank.cases, taxonomy }, listKeys: store.listMediaKeys && (() => store.listMediaKeys()), getMedia: k => store.getMedia(k), onProgress });
    return { blob: new Blob([r.data], { type: 'application/zip' }), central: r.central, orphanFailed: r.orphanFailed };
  }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

  async function restore(file) {
    try {
      const p = await parseBackup({ JSZip, data: await file.arrayBuffer() });
      const c = p.central;
      let msg = `לשחזר ${c.questions.length} שאלות, ${c.cases.length} סיפורי מקרה ו־${p.media.size} תמונות (גיבוי מ־${c.createdAt.slice(0, 10)})?\nהמאגר המרכזי הנוכחי (${bankQs().length} שאלות) יוחלף. נתונים אישיים ומבחנים לא ייפגעו. לפני כן יורד גיבוי בטיחות.`;
      if (p.missingMedia.length) {
        msg += `\n\nשים לב: בקובץ חסרות ${p.missingMedia.length} תמונות שהשאלות מפנות אליהן${p.legacy ? ' (גיבוי בפורמט ישן ללא תמונות)' : ''}. תמונות כאלה יישארו רק אם הן עדיין קיימות במאגר הנוכחי; אחרת השאלות יוצגו בלי התמונה.`;
      }
      if (!confirm(msg)) { A.restoreMsg = 'השחזור בוטל.'; return render(); }
      A.restoreMsg = 'יוצר גיבוי בטיחות לפני השחזור...'; render();
      const safety = await makeBackup();          // נכשל (ועוצר את השחזור) אם אי אפשר לגבות את המצב הנוכחי במלואו
      download(safety.blob, `גיבוי-בטיחות-לפני-שחזור-${Date.now()}.zip`);
      await store.replaceCentral({ packages: c.packages, questions: c.questions, cases: c.cases, media: p.media, taxonomy: c.taxonomy, keepMediaKeys: p.missingMedia });
      await ctx.loadAll(); A.restoreMsg = `שוחזרו ${c.questions.length} שאלות, ${p.media.size} תמונות.` + (p.missingMedia.length ? ` ${p.missingMedia.length} תמונות לא היו בקובץ (נשמרו רק אם קיימות במאגר).` : ''); render();
    } catch (e) { A.restoreMsg = 'השחזור נכשל: ' + e.message; render(); }
  }

  async function approve(id, { publish = true } = {}) {
    const s = S.suggestions.find(x => x.id === id); const src = clone(s.question);
    const nid = 'approved-' + id;
    for (const b of src.blocks) if (b.mediaKey?.startsWith('user/')) { const nk = `central/${nid}/${b.mediaKey.slice(5)}`; const data = S.media.get(b.mediaKey); if (data) { S.media.set(nk, data); await store.putMedia(nk, data); b.mediaKey = nk; } }
    if (src.rubric) for (const b of src.rubric.answer) if (b.mediaKey?.startsWith('user/')) { const nk = `central/${nid}/${b.mediaKey.slice(5)}`; const data = S.media.get(b.mediaKey); if (data) { S.media.set(nk, data); await store.putMedia(nk, data); b.mediaKey = nk; } }
    const q = { ...src, uid: nid, pkgId: 'approved', kind: 'teacher', published: publish, credit: s.credit ? s.authorName : null, fromSuggestion: id, submitterUid: s.authorUid || undefined, submitterName: s.credit ? s.authorName : undefined, approvedAt: Date.now(), year: null, examCode: null, originalNumber: null };
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
    if (act === 'resetf') { A.f = EMPTY_FILTERS(); A.limit = 200; render(); return true; }
    if (act === 'more') { A.limit += 200; render(); return true; }
    if (act === 'selnone') { A.checked.clear(); render(); return true; }
    if (act === 'bulkpub') { for (const q of S.questions.filter(q => A.checked.has(q.uid))) { q.published = arg === '1'; await saveQ(q); } toast(`${A.checked.size} שאלות ${arg === '1' ? 'פורסמו' : 'הוסתרו'}`); render(); return true; }
    if (act === 'bulkflag') { for (const q of S.questions.filter(q => A.checked.has(q.uid))) { q.reviewFlag = true; await saveQ(q); } render(); return true; }
    if (act === 'bulkdel') {
      const n = A.checked.size; if (!confirm(`למחוק לצמיתות ${n} שאלות מהמאגר? מבחנים של מורים שכבר כוללים אותן לא ישתנו. אי אפשר לבטל.`)) return true;
      for (const uid of A.checked) { await store.deleteBankQuestion(uid); S.questions = S.questions.filter(q => q.uid !== uid); }
      A.checked.clear(); A.draft = null; toast(`${n} שאלות נמחקו`); render(); return true;
    }
    if (act === 'bulkreset') { A.bulk = EMPTY_BULK(); A.bulkMsg = ''; render(); return true; }
    if (act === 'bulkclass') {
      const { changes, errors } = chosen(A.bulk); if (errors.length) { toast(errors[0]); return true; }
      const sel = S.questions.filter(q => A.checked.has(q.uid)); const plan = planBulk(sel, changes, S.tax);
      if (!plan.updates.length) { A.bulkMsg = 'אין מה לעדכן: ' + (plan.skipped.length ? plan.skipped.length + ' שאלות דולגו (' + plan.skipped[0].reason + ')' : 'הערכים כבר זהים'); render(); return true; }
      const msg = ['לעדכן ' + plan.updates.length + ' מתוך ' + sel.length + ' השאלות שנבחרו?', '', 'שינויים: ' + describe(changes, S.tax.domains ? { domain: S.tax.domains, type: S.tax.types } : {}).join(' | '), plan.skipped.length ? plan.skipped.length + ' שאלות ידולגו: ' + plan.skipped[0].reason : '', ...plan.warnings, '', 'שאר השדות והתוכן לא ישתנו.'].filter(x => x !== '').join(NL);
      if (!confirm(msg)) return true;
      A.bulkMsg = 'מעדכן…'; const r = await runBulk(plan, saveQ);
      A.bulkMsg = `עודכנו ${r.ok.length} שאלות${plan.skipped.length ? `, דולגו ${plan.skipped.length}` : ''}${r.failed.length ? `, נכשלו ${r.failed.length} (${r.failed[0].error}). השאלות שנכשלו נשארו מסומנות לניסיון חוזר.` : '.'}`;
      if (r.failed.length) A.checked = new Set(r.failed.map(x => x.q.uid)); else A.checked.clear();
      if (A.draft && r.ok.some(x => x.uid === A.draft.uid)) A.draft = clone(S.questions.find(x => x.uid === A.draft.uid));
      A.bulk = EMPTY_BULK(); toast(r.failed.length ? 'העדכון הושלם חלקית' : 'העדכון הושלם'); render(); return true;
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
      const core = x => JSON.stringify([x.domainId, x.typeId, x.addDomainIds, x.blocks, x.rubric, x.title, x.points]);
      q.authorAdmin = (q.authorAdmin || '').trim() || undefined;
      if (core(q) !== core(cur)) { q.adminOrig ||= { domainId: cur.domainId, typeId: cur.typeId, addDomainIds: cur.addDomainIds, blocks: cur.blocks, rubric: cur.rubric, title: cur.title, points: cur.points }; q.adminEdited = true; }
      q.addDomainIds = q.addDomainIds.filter(x => x !== q.domainId); recomputeSearch(q);
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
    if (act === 'delsg') {
      const s = S.suggestions.find(x => x.id === arg); if (!s) return true;
      if (!(s.status === 'pending' || s.status === 'rejected')) { toast('הצעה שאושרה אינה נמחקת'); return true; }
      const imgs = (s.imageKeys || []).length;
      if (!confirm(`האם אתה בטוח שברצונך למחוק את ההצעה לצמיתות? פעולה זו אינה ניתנת לביטול.

שאלה: ${sgTitle(s)}
מגיש: ${sgSubmitter(s)}
סטטוס: ${s.status === 'pending' ? 'ממתינה' : 'נדחתה'}
תמונות שיימחקו: ${imgs}`)) return true;
      try { const r = await store.deleteSuggestion(s); S.suggestions = S.suggestions.filter(x => x.id !== s.id); toast(`ההצעה נמחקה לצמיתות${r?.mediaDeleted ? ` (${r.mediaDeleted} חלקי תמונה)` : ''}`); }
      catch (e) { console.error(e); toast(e.code === 'partial-delete' || e.code === 'suggestion-approved' ? e.message : 'המחיקה נכשלה: ' + (e.code || e.message)); try { S.suggestions = await store.loadSuggestions(); } catch {} }
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
    if (act === 'backup') { try { toast('מכין גיבוי שלם (כולל תמונות)...'); const { blob, central } = await makeBackup(); download(blob, `גיבוי-מאגר-מרכזי-${central.createdAt.slice(0, 10)}.zip`); toast(`הגיבוי הורד: ${central.counts.questions} שאלות, ${central.counts.media} תמונות`); } catch (e) { A.restoreMsg = 'הגיבוי נכשל: ' + e.message; render(); } return true; }
    return false;
  }
  async function change(t, d) {
    if (t.dataset.admchk) { t.checked ? A.checked.add(t.dataset.admchk) : A.checked.delete(t.dataset.admchk); render(); return true; }
    if (t.dataset.admrestore !== undefined) { if (t.files[0]) await restore(t.files[0]); return true; }
    const f = t.dataset.admf;
    if (f === 'pubimport') { A.publishOnImport = t.value === '1'; return true; }
    if (f in A.f && f !== 'text') { A.f[f] = f === 'status' ? (t.value || 'all') : t.value; if (f === 'year') A.f.session = ''; A.limit = 200; render(); return true; }
    if (t.dataset.admb) { const k = t.dataset.admb; A.bulk[k] = t.type === 'checkbox' ? t.checked : t.value; A.bulkOpen = true; render(); return true; }
    if (t.dataset.admd) { const k = t.dataset.admd; A.draft[k] = k === 'points' ? (t.value === '' ? null : Number(t.value)) : t.value; return true; }
    if (t.dataset.admadd) { const k = t.dataset.admadd; const set = new Set(A.draft.addDomainIds); t.checked ? set.add(k) : set.delete(k); A.draft.addDomainIds = [...set]; return true; }
    if (t.dataset.admtax) {
      const [map, k] = t.dataset.admtax.split(':'); const tx = await store.loadTaxonomy(); (tx[map] ||= {})[k] = t.value; await store.saveTaxonomy(tx); S.tax[map][k] = t.value; toast('השם עודכן'); return true;
    }
    return false;
  }
  function input(t) {
    const f = t.dataset.admf;
    if (f === 'text') { A.f.text = t.value; A.limit = 200; clearTimeout(input.h); input.h = setTimeout(() => { render(); const e = document.querySelector('[data-admf=text]'); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }, 250); return true; }
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
