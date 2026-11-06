// בונה את public/guide.html: קובץ HTML יחיד (עצמאי, ניתן לשליחה) עם צילומי המסך משובצים.
// קלט: docs/guide/guide.src.html + out/guide-img/*.jpg (נוצרים ב-npm run guide:shots). כל תמונה חסרה = כשל (לא מפרסמים מדריך עם תמונות חסרות).
import fs from 'node:fs';
const dir = process.argv[2] || 'out/guide-img';
let html = fs.readFileSync('docs/guide/guide.src.html', 'utf8');
// גופן Open Sans משובץ (קובץ עצמאי, בלי טעינה משירות חיצוני)
let fonts = '';
for (const sub of ['latin', 'hebrew']) for (const w of [400, 600, 700, 800]) {
  const css = fs.readFileSync(`node_modules/@fontsource/open-sans/${sub}-${w}.css`, 'utf8');
  const ur = /unicode-range:([^;]+);/.exec(css)?.[1] || '';
  const data = fs.readFileSync(`node_modules/@fontsource/open-sans/files/open-sans-${sub}-${w}-normal.woff2`).toString('base64');
  fonts += `@font-face{font-family:"Open Sans";font-weight:${w};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${ur}}
`;
}
if (fs.existsSync('docs/guide/theme.css')) html = html.replace('/*GUIDE_THEME*/', fonts + '/*THEME*/');
if (fs.existsSync('docs/guide/theme.css')) html = html.replace('</style>', () => fs.readFileSync('docs/guide/theme.css', 'utf8') + '</style>');
const miss = [];
html = html.replace(/<img data-shot="([\w-]+)"/g, (m, name) => {
  const f = `${dir}/${name}.jpg`; if (!fs.existsSync(f)) { miss.push(name); return m; }
  return `<img src="data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}" loading="lazy"`;
});
if (miss.length) { console.error('חסרים צילומים: ' + miss.join(', ') + '\nהרץ: npm run guide:shots'); process.exit(1); }
fs.mkdirSync('public', { recursive: true }); fs.writeFileSync('public/guide.html', html);
console.log(`public/guide.html נבנה (${Math.round(html.length / 1024)}KB)`);
