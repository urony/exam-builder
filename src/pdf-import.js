// ייבוא עמוד מקובץ PDF כתמונה. ההמרה מתבצעת כולה בדפדפן (pdf.js של Mozilla, רישיון Apache-2.0): הקובץ לא עולה לשום שרת.
// בטיחות: אין הרצת קוד מהקובץ (isEvalSupported:false, סקריפטים ו-XFA כבויים), הקובץ נקרא מהזיכרון בלבד, ויש תקרות גודל, מספר עמודים וזמן.
// התוצאה (Uint8Array של PNG/JPEG) נכנסת לאותו מנגנון תמונות קיים של המבחן (גודל ומיקום ניתנים לכוונון כרגיל).
import { esc } from './util.js';

export const PDF_LIMITS = { bytes: 25 * 1024 * 1024, pages: 400, openMs: 20000, renderMs: 25000, maxWidthPx: 1800, maxPixels: 14e6, outBytes: 1.8 * 1024 * 1024 };

let lib = null;
async function pdfjs() {
  if (lib) return lib;
  const [m, worker] = await Promise.all([import('pdfjs-dist/build/pdf.min.mjs'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  m.GlobalWorkerOptions.workerSrc = worker.default; lib = m; return m;
}
const withTimeout = (p, ms, msg) => { let h; return Promise.race([p, new Promise((_, rej) => { h = setTimeout(() => rej(Object.assign(new Error(msg), { code: 'pdf-timeout' })), ms); })]).finally(() => clearTimeout(h)); };

// קוד שגיאה ידידותי למורה
export function friendlyPdfError(e) {
  const n = e?.name || '', c = e?.code || '';
  if (c === 'pdf-too-big' || c === 'pdf-too-many-pages' || c === 'pdf-not-pdf' || c === 'pdf-timeout') return e.message;
  if (n === 'PasswordException') return 'הקובץ מוגן בסיסמה. אפשר להסיר את ההגנה ולנסות שוב.';
  if (n === 'InvalidPDFException' || n === 'MissingPDFException' || n === 'FormatError') return 'הקובץ אינו PDF תקין או שהוא פגום.';
  return 'לא הצלחנו לקרוא את קובץ ה־PDF (' + (e?.message || n || 'שגיאה') + ').';
}

export async function openPdf(file) {
  if (file.size > PDF_LIMITS.bytes) throw Object.assign(new Error('הקובץ גדול מדי (מעל ' + PDF_LIMITS.bytes / 1024 / 1024 + 'MB).'), { code: 'pdf-too-big' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (!head.includes('%PDF-')) throw Object.assign(new Error('הקובץ אינו PDF.'), { code: 'pdf-not-pdf' });
  const lb = await pdfjs();
  const task = lb.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, useSystemFonts: true, stopAtErrors: false });
  let doc;
  try { doc = await withTimeout(task.promise, PDF_LIMITS.openMs, 'פתיחת הקובץ ארכה יותר מדי.'); }
  catch (e) { try { task.destroy(); } catch { /* ignore */ } throw e; }
  if (doc.numPages > PDF_LIMITS.pages) { doc.destroy(); throw Object.assign(new Error('המסמך ארוך מדי (' + doc.numPages + ' עמודים; המקסימום ' + PDF_LIMITS.pages + ').'), { code: 'pdf-too-many-pages' }); }
  return doc;
}

async function renderTo(doc, pageNo, targetWidth, maxPixels = PDF_LIMITS.maxPixels) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  let scale = targetWidth / base.width;
  if (base.width * base.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (base.width * base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(vp.width)); canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await withTimeout(page.render({ canvasContext: ctx, canvas, viewport: vp }).promise, PDF_LIMITS.renderMs, 'עיבוד העמוד ארך יותר מדי.');
  page.cleanup();
  return canvas;
}
const toBlob = (canvas, type, q) => new Promise(r => canvas.toBlob(r, type, q));

// עמוד -> תמונה לשימוש בהדפסה: רוחב עד 1800px; PNG כשהוא קל, אחרת JPEG; מוקטן עד שהקובץ סביר.
export async function pageToImage(doc, pageNo, baseName = 'pdf') {
  let width = PDF_LIMITS.maxWidthPx;
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = await renderTo(doc, pageNo, width);
    let blob = await toBlob(canvas, 'image/png');
    let ext = 'png';
    if (!blob || blob.size > PDF_LIMITS.outBytes) { blob = await toBlob(canvas, 'image/jpeg', attempt ? 0.85 : 0.92); ext = 'jpg'; }
    if (blob && blob.size <= PDF_LIMITS.outBytes) return { data: new Uint8Array(await blob.arrayBuffer()), name: `${baseName}-עמוד-${pageNo}.${ext}`, width: canvas.width, height: canvas.height };
    width = Math.round(width * 0.8);
  }
  throw new Error('העמוד כבד מדי גם אחרי הקטנה. נסו עמוד אחר או PDF בדחיסה גבוהה יותר.');
}

// חלון בחירת עמוד: מציג תמונות ממוזערות (נטענות לפי הצורך), בחירה בלחיצה, אישור -> onPick({data,name})
export async function pickPdfPage(file, { onPick, onError }) {
  let doc;
  try { doc = await openPdf(file); } catch (e) { onError(friendlyPdfError(e)); return; }
  const base = file.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'pdf';
  const wrap = document.createElement('div'); wrap.className = 'modal dlg pdfdlg'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'בחירת עמוד מקובץ PDF');
  wrap.innerHTML = `<div class="modalbox card"><h3>בחרו עמוד להוספה כתמונה</h3><p class="hint">${esc(file.name)} · ${doc.numPages} עמודים. הקובץ נשאר במחשב שלכם ולא מועלה לשום שרת.</p>
    <div class="pdfgrid" id="pdfgrid"></div><div class="dlgbtns"><button class="btn primary" id="pdfok" disabled>הוסף את העמוד שנבחר</button><button class="btn" id="pdfcancel">ביטול</button><span class="hint" id="pdfmsg" role="status"></span></div></div>`;
  document.body.appendChild(wrap);
  let sel = 0, busy = false;
  const close = () => { wrap.remove(); try { doc.destroy(); } catch { /* ignore */ } document.removeEventListener('keydown', onKey); };
  const onKey = ev => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const grid = wrap.querySelector('#pdfgrid'), ok = wrap.querySelector('#pdfok'), msg = wrap.querySelector('#pdfmsg');
  const io = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) {
      const cell = en.target; io.unobserve(cell); const n = Number(cell.dataset.page);
      renderTo(doc, n, 260, 1.5e6).then(cv => { cv.setAttribute('aria-hidden', 'true'); cell.querySelector('.ph').replaceWith(cv); }).catch(() => { cell.querySelector('.ph').textContent = 'לא ניתן להציג'; });
    }
  }, { root: grid, rootMargin: '200px' });
  for (let n = 1; n <= doc.numPages; n++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pdfcell'; b.dataset.page = n; b.setAttribute('aria-label', 'עמוד ' + n);
    b.innerHTML = `<span class="ph">טוען…</span><span class="pn">עמוד ${n}</span>`; grid.appendChild(b); io.observe(b);
  }
  grid.addEventListener('click', ev => { const c = ev.target.closest('.pdfcell'); if (!c || busy) return; grid.querySelectorAll('.pdfcell.on').forEach(x => x.classList.remove('on')); c.classList.add('on'); sel = Number(c.dataset.page); ok.disabled = false; msg.textContent = 'נבחר עמוד ' + sel; });
  wrap.querySelector('#pdfcancel').addEventListener('click', close);
  wrap.addEventListener('click', ev => { if (ev.target === wrap && !busy) close(); });
  ok.addEventListener('click', async () => {
    if (!sel || busy) return; busy = true; ok.disabled = true; msg.textContent = 'ממיר לתמונה…';
    try { const img = await pageToImage(doc, sel, base); close(); await onPick(img); }
    catch (e) { busy = false; ok.disabled = false; msg.textContent = friendlyPdfError(e); }
  });
  (grid.querySelector('.pdfcell') || ok).focus?.();
}
