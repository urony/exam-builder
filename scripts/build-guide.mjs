// בונה את public/guide.html: קובץ HTML יחיד (עצמאי, ניתן לשליחה) עם צילומי המסך משובצים.
// קלט: docs/guide/guide.src.html + out/guide-img/*.jpg (נוצרים ב-npm run guide:shots). כל תמונה חסרה = כשל (לא מפרסמים מדריך עם תמונות חסרות).
import fs from 'node:fs';
const dir = process.argv[2] || 'out/guide-img';
let html = fs.readFileSync('docs/guide/guide.src.html', 'utf8');
if (fs.existsSync('docs/guide/theme.css')) html = html.replace('/*GUIDE_THEME*/', fs.readFileSync('docs/guide/theme.css', 'utf8'));
const miss = [];
html = html.replace(/<img data-shot="([\w-]+)"/g, (m, name) => {
  const f = `${dir}/${name}.jpg`; if (!fs.existsSync(f)) { miss.push(name); return m; }
  return `<img src="data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}" loading="lazy"`;
});
if (miss.length) { console.error('חסרים צילומים: ' + miss.join(', ') + '\nהרץ: npm run guide:shots'); process.exit(1); }
fs.mkdirSync('public', { recursive: true }); fs.writeFileSync('public/guide.html', html);
console.log(`public/guide.html נבנה (${Math.round(html.length / 1024)}KB)`);
