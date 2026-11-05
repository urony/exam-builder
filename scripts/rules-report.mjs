import fs from 'node:fs';
import { parsePackage } from '../src/adapter.js';
const hist = {}; const samples = {};
for (const f of fs.readdirSync('samples').filter(f => f.endsWith('.zip'))) {
  const r = await parsePackage(fs.readFileSync('samples/' + f), f);
  for (const q of r.questions) for (const c of q.corrections) for (const rule of c.rules) {
    hist[f.slice(0, 20) + ' ' + rule] = (hist[f.slice(0, 20) + ' ' + rule] || 0) + 1;
    (samples[rule] ||= []).push([f.slice(5, 15), c.from, c.to]);
  }
}
console.log(hist);
const want = process.argv.slice(2);
for (const rule of want) for (const [f, a, b] of (samples[rule] || []).slice(0, 4)) {
  // show only differing neighborhood
  let i = 0; while (a[i] === b[i]) i++;
  console.log(rule, f, '|', JSON.stringify(a.slice(Math.max(0, i - 25), i + 40)), '=>', JSON.stringify(b.slice(Math.max(0, i - 25), i + 40)));
}
