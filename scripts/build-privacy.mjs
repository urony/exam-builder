// בונה את public/privacy.html ממקור docs/privacy/privacy.src.html: משבץ גופני Open Sans (400/700) שכבר משובצים במדריך.
// הרצה: node scripts/build-privacy.mjs
import fs from 'node:fs';
const fonts = fs.readFileSync('public/guide.html', 'utf8').split('\n').filter(l => l.startsWith('@font-face{font-family:"Open Sans"') && /font-weight:(400|700);/.test(l));
if (fonts.length !== 4) throw new Error('נמצאו ' + fonts.length + ' הגדרות גופן במדריך (צפוי 4)');
const src = fs.readFileSync('docs/privacy/privacy.src.html', 'utf8');
fs.writeFileSync('public/privacy.html', src.replace('/*FONTS*/', fonts.join('\n')));
console.log('privacy.html נבנה');
