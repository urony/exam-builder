// סורק חבילות מקור (קריאה בלבד) ומדווח תאימות + מועמדים לסוג "זיהוי מבנים בתרשימים"
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { parsePackage } from '../src/adapter.js';
const roots = process.argv.slice(2);
const out = [];
async function visit(buf, name, depth = 0) {
  const r = await parsePackage(buf, name);
  if (r.pkg) { out.push({ name, r }); return; }
  // חבילה עוטפת (zip בתוך zip)? נסה לפתוח קבצי zip פנימיים
  if (depth < 1) {
    try {
      const z = await JSZip.loadAsync(buf);
      const inner = Object.keys(z.files).filter(n => n.endsWith('.zip'));
      if (inner.length && !z.file('questions.json')) for (const n of inner) await visit(await z.file(n).async('uint8array'), name + '>' + n, depth + 1);
      else out.push({ name, r });
    } catch { out.push({ name, r }); }
  } else out.push({ name, r });
}
for (const root of roots) for (const f of fs.readdirSync(root).filter(f => f.endsWith('.zip'))) await visit(fs.readFileSync(path.join(root, f)), f);
const ID = /(זה[ו]?|זהה|זיהוי|רשמו|רשום|ציינו|ציין).{0,60}(מסומנ|ממוספר|בספרות|מספר\s+(ה)?(חלק|איבר|רכיב|חומר|מבנה))|(מסומנ|ממוספר)\S*\s.{0,40}(בספרות|בתרשים|באיור)|(החלקים|האיברים|המבנים|הרכיבים)\s+(ה)?(מסומנים|ממוספרים)/;
let total = 0;
for (const { name, r } of out) {
  if (!r.pkg) { console.log('!!', name, r.report.errors.slice(0, 2)); continue; }
  const qs = r.questions; total += qs.length;
  const cand = qs.filter(q => ID.test(q.blocks.map(b => b.text || '').join(' ')));
  console.log(`== ${name} ${r.pkg.kind} q=${qs.length} imgs=${r.media.size} candidates=${cand.length}`);
  for (const q of cand) console.log(`   ${q.uid.split('-').slice(-2).join('-')} [${q.typeId}|${q.domainId}] img=${q.blocks.some(b => b.type === 'image' && !b.reference)} :: ${q.blocks.map(b => b.text || '').join(' ').replace(/\s+/g, ' ').slice(0, 150)}`);
}
console.log('total questions', total);
