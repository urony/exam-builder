// הפקת Word בעברית (RTL אמיתי): גרסת תלמיד וגרסת מורה.
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ImageRun, Footer, PageNumber, ShadingType, HeightRule, TableLayoutType,
} from 'docx';
import { imageSize } from './adapter.js';
import { caseFirstUse } from './exam.js';
import { cellLines } from './clean.js';

const FONT = 'Arial';
const BODY = 24; // half-points = 12pt
const CONTENT_DXA = 9638; // A4 עם שוליים 2 ס"מ

const run = (text, o = {}) => new TextRun({ text, rightToLeft: true, font: FONT, size: BODY, ...o });

function textRuns(text, o = {}) {
  const parts = String(text ?? '').split('\n');
  const out = [];
  parts.forEach((p, i) => out.push(run(p, { ...o, break: i > 0 ? 1 : undefined })));
  return out;
}
const P = (children, o = {}) => new Paragraph({ bidirectional: true, children, ...o });

// ברירת מחדל גדולה כדי שמספרים וסימונים בתרשימים מורכבים יישארו קריאים (640px ~ 17 ס"מ). widthCm גובר.
function imageParagraph(u8, { maxW = 640, maxH = 640, widthCm = null, alt = 'איור', after = 120 } = {}) {
  const { w, h } = imageSize(u8);
  const s = widthCm ? (widthCm * 96 / 2.54) / w : Math.min(1, maxW / w, maxH / h);
  const type = u8[0] === 0x89 ? 'png' : 'jpg';
  return new Paragraph({
    alignment: AlignmentType.CENTER, keepNext: false, spacing: { before: 80, after },
    children: [new ImageRun({ type, data: u8, transformation: { width: Math.round(w * s), height: Math.round(h * s) }, altText: { name: alt, title: alt, description: alt } })],
  });
}

function tableFrom(rows, { shadeFill = 'F2F2F2', keep = true } = {}) {
  const cols = Math.max(...rows.map(r => r.length), 1);
  const colW = Math.floor(CONTENT_DXA / cols);
  const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const trs = rows.map((r, ri) => {
    const hasBlank = r.some(c => cellLines(c).length === 0);
    const cells = Array.from({ length: cols }, (_, ci) => {
      const v = r[ci];
      return new TableCell({
        width: { size: colW, type: WidthType.DXA }, borders,
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: shadeFill, color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: (cellLines(v).length ? cellLines(v) : ['']).map((line, li, arr) => P(line ? textRuns(line, { bold: ri === 0 }) : [run('')], { keepNext: keep && ri < rows.length - 1, spacing: { after: li < arr.length - 1 ? 60 : 0 } })),
      });
    });
    return new TableRow({ cantSplit: true, tableHeader: ri === 0, height: hasBlank && ri > 0 ? { value: 700, rule: HeightRule.ATLEAST } : undefined, children: cells });
  });
  return new Table({
    visuallyRightToLeft: true, layout: TableLayoutType.FIXED,
    width: { size: CONTENT_DXA, type: WidthType.DXA }, columnWidths: Array(cols).fill(colW), rows: trs,
  });
}

const spacer = (after = 120) => P([run('')], { spacing: { after, before: 0 } });

function answerLines(n) {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const line = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const rows = Array.from({ length: n }, () => new TableRow({
    cantSplit: true, height: { value: 520, rule: HeightRule.EXACT },
    children: [new TableCell({ width: { size: CONTENT_DXA, type: WidthType.DXA }, borders: { top: none, left: none, right: none, bottom: line }, children: [P([run('')], { spacing: { after: 0 } })] })],
  }));
  return [new Table({ visuallyRightToLeft: true, layout: TableLayoutType.FIXED, width: { size: CONTENT_DXA, type: WidthType.DXA }, columnWidths: [CONTENT_DXA], rows }), spacer(60)];
}

// בלוקים של תוכן -> אלמנטים; lines: שורות תשובה לכל סעיף (או בסוף השאלה אם אין סעיפים)
function renderBlocks(blocks, ctx, { lines = 0, showSectionPoints = false, noKeep = false } = {}) {
  const out = [];
  const hasSections = blocks.some(b => b.type === 'section');
  const visible = blocks.filter(b => !(b.type === 'image' && b.reference));
  visible.forEach((b, i) => {
    const next = visible[i + 1];
    const keepNext = !noKeep && !!next && (next.type === 'table' || next.type === 'image' || next.type === 'choice');
    if (b.type === 'text') out.push(P(textRuns(b.text), { keepNext, keepLines: keepNext, spacing: { after: 100 } }));
    else if (b.type === 'caption') out.push(P(textRuns(b.text, { italics: true, size: 20 }), { alignment: AlignmentType.CENTER }));
    else if (b.type === 'section') {
      const kids = [run(`${b.label}. `, { bold: true }), ...textRuns(b.text)];
      if (showSectionPoints && b.points != null) kids.push(run(` (${b.points} נק׳)`));
      out.push(P(kids, { indent: { start: 400, hanging: 400 }, keepNext: false, spacing: { before: 80, after: 80 } }));
    } else if (b.type === 'choice') {
      out.push(P([run(`${b.label}. `, { bold: true }), ...textRuns(b.text)], { indent: { start: 700, hanging: 400 }, keepLines: true, keepNext: next?.type === 'choice', spacing: { after: 40 } }));
    } else if (b.type === 'table') {
      out.push(tableFrom(b.rows), spacer(100));
    } else if (b.type === 'image') {
      const u8 = ctx.getMedia(b.mediaKey);
      if (u8) { out.push(imageParagraph(u8, { alt: b.caption || 'איור', widthCm: b.widthCm })); if (b.caption) out.push(P(textRuns(b.caption, { italics: true, size: 20 }), { alignment: AlignmentType.CENTER })); }
      else out.push(P([run('[תמונה חסרה]', { color: 'AA0000' })]));
    }
    // שורות תשובה: אחרי כל סעיף (כשיש סעיפים), כלומר לפני הסעיף הבא או בסוף
    const isLastOfSegment = !next || next.type === 'section';
    if (lines > 0 && isLastOfSegment && (hasSections ? visible.slice(0, i + 1).some(x => x.type === 'section') : true) && !visible.some(x => x.type === 'choice')) {
      out.push(...answerLines(lines));
    }
  });
  return out;
}

// תמונה לצד השאלה: טבלה דו-עמודתית בלי מסגרת (עמודה ימנית = תוכן השאלה)
function sideBySide(content, imgs) {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const borders = { top: none, bottom: none, left: none, right: none };
  const textW = Math.round(CONTENT_DXA * 0.64), imgW = CONTENT_DXA - textW;
  const cell = (w, kids) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders, margins: { left: 80, right: 80 }, children: [...kids, P([run('')], { spacing: { after: 0 } })] });
  return new Table({
    visuallyRightToLeft: true, layout: TableLayoutType.FIXED, width: { size: CONTENT_DXA, type: WidthType.DXA }, columnWidths: [textW, imgW],
    rows: [new TableRow({ children: [cell(textW, content), cell(imgW, imgs)] })],
  });
}

function sectionPointsMatch(item) {
  const secs = item.snap.blocks.filter(b => b.type === 'section' && b.points != null);
  return secs.length > 0 && secs.reduce((a, b) => a + b.points, 0) === Number(item.points);
}

function caseBox(blocks, ctx) {
  const box = { top: { style: BorderStyle.SINGLE, size: 6, color: '6B7FD7', space: 4 }, bottom: { style: BorderStyle.SINGLE, size: 6, color: '6B7FD7', space: 4 }, left: { style: BorderStyle.SINGLE, size: 6, color: '6B7FD7', space: 4 }, right: { style: BorderStyle.SINGLE, size: 6, color: '6B7FD7', space: 4 } };
  const out = [P([run('סיפור מקרה', { bold: true, size: 26 })], { keepNext: true, spacing: { before: 240, after: 80 } })];
  const vis = blocks.filter(b => !(b.type === 'image' && b.reference));
  for (const b of vis) {
    if (b.type === 'text') out.push(P(textRuns(b.text), { shading: { type: ShadingType.CLEAR, fill: 'EEF1FB', color: 'auto' }, border: box, keepNext: true, keepLines: true, spacing: { after: 100 } }));
    else out.push(...renderBlocks([b], ctx));
  }
  out.push(P([run('')], { keepNext: true, spacing: { after: 80 } }));
  return out;
}

function rubricBox(item, ctx) {
  const r = item.snap.rubric;
  if (!r) return [];
  const kids = [];
  const label = r.officialKind === 'official' ? 'מחוון רשמי' : 'תשובה (לפי מחבר השאלה)';
  kids.push(P([run(label, { bold: true, color: '1F3A8A' })], { keepNext: true, spacing: { after: 60 } }));
  const hasKey = r.answer.some(b => b.isKey);
  for (const b of r.answer) {
    if (b.type === 'text' && b.isKey) {
      const ch = item.snap.blocks.find(x => x.type === 'choice' && x.label === b.text.trim());
      kids.push(P([run('תשובה נכונה: ', { bold: true }), run(b.text.trim() + (ch ? '. ' + ch.text : ''))]));
    } else if (b.type === 'text') kids.push(P(textRuns(b.text), { spacing: { after: 80 } }));
    else if (b.type === 'table') { kids.push(tableFrom(b.rows, { shadeFill: 'DDE3F5' }), spacer(60)); }
    else if (b.type === 'image' && b.scanned) {
      if (hasKey) continue;
      const idx = ctx.appendixIndex(b.mediaKey);
      kids.push(P([run(`המחוון הרשמי לשאלה זו סרוק – ראו נספח ${idx} בסוף המסמך.`, { italics: true })]));
    } else if (b.type === 'image') {
      const u8 = ctx.getMedia(b.mediaKey);
      if (u8) kids.push(imageParagraph(u8, { maxW: 480, maxH: 360 }));
    }
  }
  if (r.notes) kids.push(P([run('הנחיות בדיקה: ', { bold: true }), ...textRuns(r.notes)], { spacing: { before: 60 } }));
  if (r.allocation?.length) {
    kids.push(P([run('חלוקת ניקוד: ', { bold: true }), run(r.allocation.map(a => `${a.component} – ${a.percent != null ? a.percent + '%' : (a.points ?? '')}`).join('; '))], { spacing: { before: 60 } }));
  }
  kids.push(P([run('')], { spacing: { after: 0 } }));
  const b = { style: BorderStyle.SINGLE, size: 6, color: '9AA5D6' };
  return [
    new Table({
      visuallyRightToLeft: true, width: { size: CONTENT_DXA, type: WidthType.DXA }, columnWidths: [CONTENT_DXA],
      rows: [new TableRow({ children: [new TableCell({ width: { size: CONTENT_DXA, type: WidthType.DXA }, borders: { top: b, bottom: b, left: b, right: b }, shading: { type: ShadingType.CLEAR, fill: 'F3F5FC', color: 'auto' }, margins: { top: 80, bottom: 80, left: 140, right: 140 }, children: kids })] })],
    }),
    spacer(160),
  ];
}

export function buildExamDocument(exam, { getMedia }, mode = 'student') {
  const teacher = mode === 'teacher';
  const appendix = [];
  const ctx = {
    getMedia,
    appendixIndex: key => { let i = appendix.indexOf(key); if (i < 0) { appendix.push(key); i = appendix.length - 1; } return i + 1; },
  };
  const ch = [];
  const total = exam.items.filter(it => !it.type || it.type === 'question').reduce((a, it) => a + (Number(it.points) || 0), 0);

  if (exam.school) ch.push(P([run(exam.school, { bold: true, size: 26 })], { spacing: { after: 60 } }));
  ch.push(P([run(exam.title || 'מבחן', { bold: true, size: 40 })], { alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 } }));
  if (teacher) ch.push(P([run('גרסת מורה – כולל תשובות ומחוונים', { bold: true, color: 'B00020', size: 26 })], { alignment: AlignmentType.CENTER, spacing: { after: 100 } }));
  const meta = [exam.teacher && `מורה: ${exam.teacher}`, exam.date && `תאריך: ${exam.date}`, exam.showPoints && total ? `סה״כ ${total} נקודות` : null].filter(Boolean);
  if (meta.length) ch.push(P([run(meta.join('   |   '))], { alignment: AlignmentType.CENTER, spacing: { after: 100 } }));
  if (!teacher) ch.push(P([run('שם התלמיד/ה: ______________________     כיתה: ________')], { spacing: { before: 120, after: 160 } }));
  if (exam.instructions) {
    ch.push(P([run('הוראות', { bold: true })], { keepNext: true, spacing: { before: 120, after: 40 } }));
    ch.push(...exam.instructions.split(/\n+/).map(t => P(textRuns(t), { spacing: { after: 60 } })));
  }
  ch.push(P([run('')], { border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '333333', space: 1 } }, spacing: { after: 160 } }));

  const firstCase = caseFirstUse(exam);
  let qn = 0;
  exam.items.forEach(it => {
    if (it.type === 'chapter') {
      const l1 = it.level !== 2;
      ch.push(P([run(it.title || (l1 ? 'פרק' : 'תת־פרק'), { bold: true, size: l1 ? 32 : 27, color: l1 ? '1F2A5A' : '333333' })], { keepNext: true, pageBreakBefore: !!it.pageBreak, spacing: { before: l1 ? 360 : 240, after: 120 }, ...(l1 ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1F2A5A', space: 2 } } } : {}) }));
      return;
    }
    if (it.type === 'free') {
      String(it.text || '').split(/\n+/).filter(t => t.trim()).forEach(t => ch.push(P(textRuns(t), { spacing: { before: 60, after: 80 } })));
      return;
    }
    qn++;
    const cid = firstCase.get(it.id);
    if (cid) ch.push(...caseBox(exam.cases[cid].blocks, ctx));
    const head = [run(`שאלה ${qn}`, { bold: true, size: 26 })];
    if (exam.showPoints && it.points) head.push(run(` (${it.points} נקודות)`, { size: 24 }));
    ch.push(P(head, { keepNext: true, pageBreakBefore: !!it.pageBreak, spacing: { before: 200, after: 80 } }));
    const imgs = (it.images || []).filter(im => getMedia(im.key));
    const userImg = (im, maxW) => imageParagraph(getMedia(im.key), { maxW, widthCm: im.widthCm, alt: im.name });
    imgs.filter(im => im.position === 'above').forEach(im => ch.push(userImg(im, 640)));
    const content = renderBlocks(it.snap.blocks, ctx, {
      lines: teacher ? 0 : (Number(it.answerLines) || 0),
      showSectionPoints: exam.showPoints && sectionPointsMatch(it),
      noKeep: imgs.some(im => im.position === 'side'),
    });
    const side = imgs.filter(im => im.position === 'side');
    if (side.length) ch.push(sideBySide(content, side.map(im => imageParagraph(getMedia(im.key), { maxW: 250, widthCm: Math.min(im.widthCm, 6.5), alt: im.name }))));
    else ch.push(...content);
    imgs.filter(im => im.position === 'below').forEach(im => ch.push(userImg(im, 640)));
    if (teacher) ch.push(...rubricBox(it, ctx));
    else ch.push(spacer(60));
  });

  if (teacher && appendix.length) {
    appendix.forEach((key, i) => {
      const u8 = getMedia(key);
      ch.push(P([run(`נספח ${i + 1}: עמוד מחוון רשמי (סריקה)`, { bold: true, size: 26 })], { pageBreakBefore: true, spacing: { after: 120 } }));
      if (u8) ch.push(imageParagraph(u8, { maxW: 640, maxH: 900, alt: `מחוון נספח ${i + 1}` }));
    });
  }

  return new Document({
    creator: 'Health Exam Builder', title: exam.title || 'מבחן',
    styles: { default: { document: { run: { font: FONT, size: BODY, rightToLeft: true, language: { value: 'he-IL', bidirectional: 'he-IL' } }, paragraph: { spacing: { after: 100, line: 300 } } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [P([run('עמוד '), new TextRun({ children: [PageNumber.CURRENT], rightToLeft: true, font: FONT, size: 20 }), run(' מתוך '), new TextRun({ children: [PageNumber.TOTAL_PAGES], rightToLeft: true, font: FONT, size: 20 })], { alignment: AlignmentType.CENTER })] }) },
      children: ch,
    }],
  });
}

export const toBlob = doc => Packer.toBlob(doc);
export const toBuffer = doc => Packer.toBuffer(doc);
