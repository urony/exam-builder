import JSZip from 'jszip';
import { parsePackage } from '../src/adapter.js';
const mk = async files => { const z = new JSZip(); for (const [k, v] of Object.entries(files)) z.file(k, v); return z.generateAsync({ type: 'uint8array' }); };
const base = { 'manifest.json': '{"schema_version":"1.0","exam_id":"t","source":{}}', 'questions.json': '{"schema_version":"1.0","exam_id":"t","questions":[],"case_studies":[]}' };
const cases = {
  'נתיב ../ זדוני': { ...base, '../evil.txt': 'x' },
  'נתיב מוחלט': { ...base, '/abs.txt': 'x' },
  'JSON שבור': { ...base, 'questions.json': '{bad' },
  'סכמה לא נתמכת': { ...base, 'questions.json': '{"schema_version":"9.0","exam_id":"t","questions":[]}' },
  'מדיה חסרה': { ...base, 'questions.json': '{"schema_version":"1.0","exam_id":"t","questions":[{"id":"a","primary_domain_id":"x","blocks":[{"order":1,"type":"image","path":"media/none.png"}]}]}' },
  'קובץ מדיה שאינו תמונה': { ...base, 'media/a.png': 'not an image', 'questions.json': '{"schema_version":"1.0","exam_id":"t","questions":[{"id":"a","primary_domain_id":"x","blocks":[{"order":1,"type":"image","path":"media/a.png"}]}]}' },
  'שאלה בלי נושא ראשי': { ...base, 'questions.json': '{"schema_version":"1.0","exam_id":"t","questions":[{"id":"a","blocks":[{"order":1,"type":"text","text":"x"}]}]}' },
  'id כפול': { ...base, 'questions.json': '{"schema_version":"1.0","exam_id":"t","questions":[{"id":"a","primary_domain_id":"x","blocks":[{"order":1,"type":"text","text":"x"}]},{"id":"a","primary_domain_id":"x","blocks":[{"order":1,"type":"text","text":"y"}]}]}' },
};
let bad = 0;
for (const [name, files] of Object.entries(cases)) {
  const r = await parsePackage(await mk(files), 't.zip');
  // JSZip מנרמל '../' לשם בטוח; הקובץ לא נכתב לדיסק ומדווח כמתעלמים -> גם זה תקין
  const rejected = r.report.errors.length > 0 || (name.includes('../') && r.report.ignored.includes('evil.txt'));
  console.log(rejected ? 'נדחה ✓' : 'לא נדחה ✗', '-', name, '->', r.report.errors[0] || '');
  if (!rejected) bad++;
}
const r = await parsePackage(new Uint8Array([1, 2, 3]), 'x.zip'); console.log(r.report.errors.length ? 'נדחה ✓ - לא ZIP' : 'לא נדחה ✗'); if (!r.report.errors.length) bad++;
process.exit(bad ? 1 : 0);
