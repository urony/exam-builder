import fs from 'node:fs';
import { parsePackage } from '../src/adapter.js';

const dir = process.argv[2] || 'samples';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.zip'));
let fail = 0;
for (const f of files) {
  const r = await parsePackage(fs.readFileSync(dir + '/' + f), f);
  const { pkg, questions, cases, media, report } = r;
  console.log('==', f, pkg ? `${pkg.kind} q=${questions.length} cases=${cases.length} media=${media.size}` : 'FAILED');
  console.log('  errors:', report.errors, 'warnings:', report.warnings.slice(0, 5), 'ignored:', report.ignored, 'corrections:', report.corrections);
  if (process.argv[3] === 'dump' && pkg) {
    for (const q of questions) for (const c of q.corrections) console.log(`  [${q.originalNumber}] ${c.rules.join(',')}\n     - ${JSON.stringify(c.from)}\n     + ${JSON.stringify(c.to)}`);
  }
  if (report.errors.length) fail++;
}
process.exit(fail ? 1 : 0);
