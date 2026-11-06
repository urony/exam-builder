// שער לפני commit/push: כל כשל = יציאה עם קוד שגיאה (והפקודה שאחריו ב-&& לא תרוץ).
// 1) npm test  2) vite build  3) קבצים רגישים/סודות בקבצים שייכנסו ל-commit.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = cmd => execSync(cmd, { stdio: 'inherit' });
const out = cmd => execSync(cmd, { encoding: 'utf8' });
const fail = msg => { console.error('\n✗ release-check נכשל: ' + msg); process.exit(1); };

try { run('npm test'); } catch { fail('npm test'); }
try { run('npx vite build'); } catch { fail('vite build'); }

const files = [...new Set([...out('git ls-files').split('\n'), ...out('git ls-files --others --exclude-standard').split('\n')].filter(Boolean))];
const badName = /\.(zip|docx|pdf|png|jpe?g|pem|key)$|(^|\/)samples\/|(^|\/)\.env|serviceAccount|credential/i;
const bad = files.filter(f => badName.test(f));
if (bad.length) fail('קבצים רגישים/בינאריים: ' + bad.join(', '));

const secret = /(api[_-]?key|secret|passw(or)?d|BEGIN (RSA|PRIVATE|OPENSSH)|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,})/i;
const hits = [];
for (const f of files.filter(f => !/package-lock\.json$/.test(f) && f !== 'scripts/release-check.mjs' && f !== 'src/firebase-config.js')) {
  let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (secret.test(text)) hits.push(f);
}
if (hits.length) fail('נמצאו דפוסי סוד בקבצים: ' + hits.join(', '));

console.log(`\n✓ release-check עבר (${files.length} קבצים, בלי קבצים רגישים או סודות)`);
