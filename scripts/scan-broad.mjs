// קריאה בלבד: שאלות עם סימני זיהוי מבנים שלא נתפסות בכלל הליבה (לבדיקה ידנית)
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { parsePackage } from '../src/adapter.js';

const strict = /(מסומנ|ממוספר)/, ident = /(זה[ו]?|זהה|זיהוי)/;
const roots = process.argv.slice(2);
async function* pk(buf, name, d = 0) {
  const r = await parsePackage(buf, name);
  if (r.pkg) { yield { name, r }; return; }
  if (d < 1) {
    const z = await JSZip.loadAsync(buf);
    for (const n of Object.keys(z.files).filter(n => n.endsWith('.zip'))) yield* pk(await z.file(n).async('uint8array'), name + '>' + n, d + 1);
  }
}
let seen = 0;
for (const root of roots) for (const f of fs.readdirSync(root).filter(f => f.endsWith('.zip'))) {
  for await (const { name, r } of pk(fs.readFileSync(path.join(root, f)), f)) {
    for (const q of r.questions) {
      const t = q.blocks.map(b => b.text || '').join(' ').replace(/\s+/g, ' ');
      const a = strict.test(t), b = ident.test(t);
      if ((a || (b && /באיור|בתרשים/.test(t))) && !(a && b)) {
        seen++;
        console.log(`${name.replace('exam-', '').slice(0, 24)} ${q.uid.split('-').slice(-1)} [${q.typeId}] ${t.slice(0, 170)}`);
      }
    }
  }
}
console.log('non-core hits', seen);
