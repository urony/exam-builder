// קריאה בלבד: מועמדי "זיהוי מבנים בתרשימים" לפי הכלל ב-src/classify.js + מצב האיורים שלהם
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { parsePackage, imageSize } from '../src/adapter.js';
import { isDiagramIdentification } from '../src/classify.js';

async function* pk(buf, name, d = 0) {
  const r = await parsePackage(buf, name);
  if (r.pkg) { yield { name, r }; return; }
  if (d < 1) {
    const z = await JSZip.loadAsync(buf);
    for (const n of Object.keys(z.files).filter(n => n.endsWith('.zip'))) yield* pk(await z.file(n).async('uint8array'), name + '>' + n, d + 1);
  }
}
let n = 0, noImg = 0;
for (const root of process.argv.slice(2)) for (const f of fs.readdirSync(root).filter(f => f.endsWith('.zip'))) {
  for await (const { name, r } of pk(fs.readFileSync(path.join(root, f)), f)) {
    const hits = r.questions.filter(isDiagramIdentification);
    for (const q of hits) {
      n++;
      const imgs = q.blocks.filter(b => b.type === 'image');
      const dims = imgs.map(b => { const s = imageSize(r.media.get(b.mediaKey)); return `${b.role}:${s.w}x${s.h}${b.reference ? '(ref)' : ''}`; });
      if (!imgs.length) noImg++;
      console.log(`${name.replace('exam-', '').slice(0, 26).padEnd(26)} q${String(q.originalNumber).padEnd(3)} [${q.typeId}|${q.domainId}+${q.addDomainIds.join(',')}] imgs=${imgs.length} ${dims.join(' ')}${imgs.length ? '' : '  <<< אין איור בחבילה; issues=' + q.issues.map(i => i.type).join(',')}`);
    }
  }
}
console.log('diagram-identification questions:', n, 'without image in package:', noImg);
