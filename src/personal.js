// מאגר אישי: טופס שאלה חדשה -> רשומת שאלה (אותו מבנה כמו שאלות המאגר המרכזי).
// שדות חובה: תוכן, מקור, נושא ראשי. כל השאר אופציונלי.
import { uid } from './exam.js';

export const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י'];
export const SOURCE_OPTIONS = { authored: 'שאלה שחיברתי', exam: 'שאלה מבחינה', other: 'מקור אחר' };

export const emptyDraft = () => ({ uid: null, sourceKind: 'authored', sourceText: '', domainId: '', typeId: '', title: '', body: '', sections: [], choices: [], answer: '', images: [], error: '' });

export function draftToQuestion(pq) {
  const blocks = [];
  if (pq.body.trim()) blocks.push({ type: 'text', text: pq.body.trim() });
  for (const im of pq.images) blocks.push({ type: 'image', mediaKey: im.key, path: im.name, role: 'teacher_image', caption: null, reference: false, scanned: false, widthCm: 12 });
  pq.sections.filter(s => s.trim()).forEach((s, i) => blocks.push({ type: 'section', label: LETTERS[i] || String(i + 1), text: s.trim() }));
  pq.choices.filter(s => s.trim()).forEach((s, i) => blocks.push({ type: 'choice', label: LETTERS[i] || String(i + 1), text: s.trim() }));
  const id = pq.uid || 'personal-' + uid();
  return {
    uid: id, pkgId: 'personal', kind: 'personal',
    examCode: null, year: null, session: null, originalNumber: null, pages: [], section: null, heading: null,
    points: null, typeId: pq.typeId || null, domainId: pq.domainId, addDomainIds: [], topicIds: [],
    title: pq.title.trim(), caseStudyId: null, blocks,
    rubric: pq.answer.trim() ? { matchStatus: null, officialKind: 'author', pages: [], answer: [{ type: 'text', text: pq.answer.trim() }], notes: null, points: null, allocation: [] } : null,
    sourceKind: pq.sourceKind, sourceText: pq.sourceText.trim(),
    extractionStatus: null, reviewStatus: null, issues: [], corrections: [],
    searchText: [pq.title, pq.body, ...pq.sections, ...pq.choices, pq.answer].join(' '),
    createdAt: Date.now(),
  };
}

export function validateDraft(pq) {
  const hasContent = pq.body.trim() || pq.sections.some(s => s.trim()) || pq.choices.some(s => s.trim());
  if (!hasContent) return 'חסר תוכן לשאלה';
  if (!pq.sourceKind) return 'חסר מקור';
  if (!pq.domainId) return 'חסר נושא ראשי';
  return '';
}

export function questionToDraft(q) {
  const d = emptyDraft();
  d.uid = q.uid; d.sourceKind = q.sourceKind || 'authored'; d.sourceText = q.sourceText || '';
  d.domainId = q.domainId || ''; d.typeId = q.typeId || ''; d.title = q.title || '';
  d.body = q.blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
  d.sections = q.blocks.filter(b => b.type === 'section').map(b => b.text);
  d.choices = q.blocks.filter(b => b.type === 'choice').map(b => b.text);
  d.images = q.blocks.filter(b => b.type === 'image' && b.mediaKey?.startsWith('user/')).map(b => ({ key: b.mediaKey, name: b.path }));
  d.answer = q.rubric?.answer?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
  return d;
}

// פריט שנכתב ישירות בתוך מבחן -> טיוטת שאלה למאגר האישי
export function itemToDraft(item) {
  return questionToDraft({ uid: null, blocks: item.snap.blocks, rubric: item.snap.rubric, domainId: item.snap.domainId, typeId: item.snap.typeId, title: '' });
}
