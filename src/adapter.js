// מתאם ייבוא גמיש: ZIP של חבילת שאלות -> רשומות אחידות.
// לא משנה את ה-ZIP; מתעלם מקבצים שאינם חלק מהחבילה ומדווח.
import JSZip from 'jszip';
import { cleanText, cellLines } from './clean.js';
import { refineQuestionType, DIAGRAM_TYPE, DIAGRAM_TYPE_LABEL } from './classify.js';

const LIMITS = { maxEntries: 500, maxJsonBytes: 20e6, maxMediaBytes: 25e6, maxTotalMediaBytes: 150e6 };
const KNOWN_FILES = new Set(['manifest.json', 'questions.json', 'taxonomy.json', 'reviews.json', 'source-references.json']);

export const KIND_LABEL = { bagrut: 'שאלות ממבחנים', teacher: 'שאלות ממורים' };

function safePath(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  return !name.split('/').some(p => p === '..' || p === '');
}
function sniffImage(u8) {
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png';
  if (u8[0] === 0xff && u8[1] === 0xd8) return 'image/jpeg';
  return null;
}
export function imageSize(u8) {
  if (u8[0] === 0x89 && u8[1] === 0x50) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  let i = 2;
  while (i < u8.length) {
    if (u8[i] !== 0xff) { i++; continue; }
    const m = u8[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8] };
    }
    i += 2 + ((u8[i + 2] << 8) | u8[i + 3]);
  }
  return { w: 600, h: 400 };
}

async function readJson(zip, name, report, required) {
  const f = zip.file(name);
  if (!f) { if (required) report.errors.push(`חסר קובץ חובה: ${name}`); return null; }
  const u8 = await f.async('uint8array');
  if (u8.length > LIMITS.maxJsonBytes) { report.errors.push(`${name} גדול מדי`); return null; }
  try { return JSON.parse(new TextDecoder('utf-8').decode(u8).replace(/^﻿/, '')); }
  catch (e) { report.errors.push(`${name}: JSON לא תקין`); return null; }
}

const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return null; };

function cleanCell(c, b, corrections, where) {
  const r = cleanText(c);
  if (r.text !== c) corrections.push({ where: where + ':cell', from: c, to: r.text, rules: r.rules });
  return r.text;
}

function cleanBlock(b, corrections, where) {
  if (typeof b.text === 'string') {
    const r = cleanText(b.text);
    if (r.text !== b.text) corrections.push({ where, from: b.text, to: r.text, rules: r.rules });
    b.text = r.text;
  }
  if (b.rows) {
    b.rows = b.rows.map(row => row.map(c => {
      if (c == null) return null;
      if (Array.isArray(c)) return c.map(x => cleanCell(String(x), b, corrections, where));
      return cleanCell(String(c), b, corrections, where);
    }));
  }
  return b;
}

function normBlocks(blocks, ctx, where) {
  const out = [];
  const hasTable = (blocks || []).some(b => b.type === 'table');
  for (const raw of (blocks || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const b = { type: raw.type };
    if (raw.type === 'text' || raw.type === 'caption') b.text = raw.text ?? '';
    else if (raw.type === 'section') { b.label = raw.label ?? ''; b.text = raw.text ?? ''; if (raw.points != null) b.points = raw.points; }
    else if (raw.type === 'choice') { b.label = raw.label ?? ''; b.text = raw.text ?? ''; }
    else if (raw.type === 'table') { b.rows = (raw.rows || []).map(r => r.slice()); }
    else if (raw.type === 'image') {
      if (!raw.path) { ctx.report.warnings.push(`${where}: בלוק תמונה בלי נתיב`); continue; }
      b.mediaKey = `${ctx.pkgId}/${raw.path}`;
      b.path = raw.path;
      b.role = raw.role || null;
      b.caption = raw.caption || null;
      // תמונת מקור של טבלה שקיימת גם כטבלה עריכה -> בקרה בלבד, לא מוצגת
      // תמונת מקור של טבלה (שקיימת גם כטבלה עריכה) = בקרה בלבד. הכרעה לפי שם הקובץ: תרשים/איור/חיתוך/עמוד תמיד מוצג.
      const fname = raw.path.split('/').pop();
      b.reference = hasTable && /table/i.test(fname) && !/(diagram|figure|crop|imaging|page|options)/i.test(fname);
      b.scanned = /scanned|rubric_page/i.test(raw.role || '');
      ctx.mediaNeeded.add(raw.path);
    } else { ctx.report.warnings.push(`${where}: סוג בלוק לא מוכר '${raw.type}' דולג`); continue; }
    if (raw.role && /mc_key|correct_choice/.test(raw.role)) b.isKey = true;
    cleanBlock(b, ctx.corrections, where + '#' + (raw.order ?? out.length + 1));
    out.push(b);
  }
  return out;
}

function normRubric(r, ctx, kind, where) {
  if (!r) return null;
  const answer = normBlocks(r.answer_blocks, ctx, where + ':rubric');
  const notes = typeof r.grading_notes === 'string' ? cleanText(r.grading_notes).text : null;
  if (!answer.length && !notes) return null;
  return {
    matchStatus: r.match_status || null,
    officialKind: kind === 'bagrut' ? 'official' : 'author',
    pages: r.rubric_source?.pages || [],
    answer, notes,
    points: r.points ?? null,
    allocation: Array.isArray(r.allocation) ? r.allocation : [],
  };
}

export async function parsePackage(data, fileName = 'package.zip') {
  const report = { fileName, errors: [], warnings: [], ignored: [], corrections: 0 };
  let zip;
  try { zip = await JSZip.loadAsync(data); } catch { report.errors.push('הקובץ אינו ZIP תקין'); return { report }; }
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  if (names.length > LIMITS.maxEntries) { report.errors.push('מספר קבצים חריג בחבילה'); return { report }; }
  const bad = names.filter(n => !safePath(n));
  if (bad.length) { report.errors.push('נתיב לא בטוח בחבילה: ' + bad.slice(0, 3).join(', ')); return { report }; }

  const manifest = await readJson(zip, 'manifest.json', report, true);
  const qdata = await readJson(zip, 'questions.json', report, true);
  const taxonomy = (await readJson(zip, 'taxonomy.json', report, false)) || {};
  if (report.errors.length) return { report };
  if (!qdata || !Array.isArray(qdata.questions)) { report.errors.push('questions.json: אין מערך questions'); return { report }; }
  const sv = String(qdata.schema_version ?? manifest.schema_version ?? '');
  if (!sv.startsWith('1.')) { report.errors.push(`גרסת סכמה לא נתמכת: ${sv || '?'}`); return { report }; }

  const src = manifest.source || {};
  const pkgId = qdata.exam_id || manifest.exam_id || src.id;
  if (!pkgId) { report.errors.push('חסר exam_id'); return { report }; }
  const kind = (src.kind === 'teacher' || /^teacher/.test(pkgId)) ? 'teacher' : 'bagrut';
  const expected = pick(manifest, 'expected_questions', 'expected_question_count');

  const tax = {
    types: { ...(taxonomy.question_types || {}), [DIAGRAM_TYPE]: DIAGRAM_TYPE_LABEL },
    domains: taxonomy.domains || taxonomy.knowledge_domains || {},
  };

  const ctx = { pkgId, report, mediaNeeded: new Set(), corrections: [] };
  const questions = [];
  const seen = new Set();
  for (const q of qdata.questions) {
    if (!q.id) { report.warnings.push('שאלה בלי id דולגה'); continue; }
    if (seen.has(q.id)) { report.errors.push(`id כפול: ${q.id}`); continue; }
    seen.add(q.id);
    ctx.corrections = [];
    const where = `q${q.original_number ?? ''}`;
    const blocks = normBlocks(q.blocks, ctx, where);
    const rubric = normRubric(q.rubric, ctx, kind, where);
    const rec = {
      uid: q.id, pkgId, kind,
      examCode: src.exam_code || null,
      year: src.year ?? null,
      session: src.session || null,
      originalNumber: q.original_number ?? null,
      pages: q.source_pages || [],
      section: q.source_section || null,
      heading: q.source_heading || null,
      points: q.original_points ?? null,
      typeId: q.question_type_id || null,
      domainId: q.primary_domain_id || null,
      addDomainIds: q.additional_domain_ids || [],
      topicIds: q.curriculum_topic_ids || [],
      title: q.title_for_search || '',
      caseStudyId: q.case_study_id || null,
      blocks, rubric,
      extractionStatus: q.extraction_status || null,
      reviewStatus: q.review_status || null,
      issues: (q.issues || []).map(i => ({ severity: i.severity, type: i.type, description: i.description })),
      corrections: ctx.corrections,
    };
    report.corrections += ctx.corrections.length;
    // שדות חובה עסקיים: תוכן, מקור, נושא ראשי
    if (!blocks.some(b => b.text || b.rows || b.mediaKey)) report.errors.push(`${q.id}: שאלה בלי תוכן`);
    if (!rec.domainId) report.errors.push(`${q.id}: חסר נושא ראשי`);
    rec.searchText = [rec.title, ...blocks.map(b => b.text || ''), ...blocks.flatMap(b => (b.rows || []).flat().map(c => cellLines(c).join(' ')))].join(' ');
    questions.push(refineQuestionType(rec));
  }
  if (expected != null && expected !== questions.length) report.warnings.push(`צפויות ${expected} שאלות, נקלטו ${questions.length}`);

  const cases = [];
  for (const c of qdata.case_studies || []) {
    ctx.corrections = [];
    const blocks = normBlocks(c.blocks, ctx, 'case');
    report.corrections += ctx.corrections.length;
    const qids = questions.filter(q => q.caseStudyId === c.id).map(q => q.uid);
    cases.push({ uid: c.id, pkgId, blocks, questionIds: qids, corrections: ctx.corrections });
  }
  for (const q of questions) if (q.caseStudyId && !cases.some(c => c.uid === q.caseStudyId)) {
    report.errors.push(`${q.uid}: סיפור מקרה ${q.caseStudyId} לא נמצא`);
  }

  // מדיה: רק קבצים שמוזכרים; קבצים אחרים בחבילה נרשמים כמתעלמים
  const media = new Map();
  let total = 0;
  for (const path of ctx.mediaNeeded) {
    const f = zip.file(path);
    if (!f) { report.errors.push(`קובץ מדיה חסר: ${path}`); continue; }
    const u8 = await f.async('uint8array');
    total += u8.length;
    if (u8.length > LIMITS.maxMediaBytes || total > LIMITS.maxTotalMediaBytes) { report.errors.push(`מדיה גדולה מדי: ${path}`); continue; }
    if (!sniffImage(u8)) { report.errors.push(`${path}: אינו קובץ תמונה`); continue; }
    media.set(`${pkgId}/${path}`, u8);
  }
  for (const n of names) {
    if (KNOWN_FILES.has(n) || ctx.mediaNeeded.has(n)) continue;
    report.ignored.push(n);
  }

  const pkg = {
    id: pkgId, kind, fileName,
    examCode: src.exam_code || null, year: src.year ?? null, session: src.session || null,
    title: src.title || src.display_name || null,
    questionCount: questions.length, mediaCount: media.size, caseCount: cases.length,
    taxonomy: tax, importedAt: new Date().toISOString(),
  };
  return { pkg, questions, cases, media, report };
}
