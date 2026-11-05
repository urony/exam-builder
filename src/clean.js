// ניקוי שיבושי חילוץ ברורים (פיסוק, כיווניות, רווחים). הנוסח המקורי נשמר ע"י הקורא.
const H = 'א-ת';
const rx = (src, flags = 'g') => new RegExp(src, flags);

const RULES = [
  ['bmi-swap', /(\d+(?:\.\d+)?) = BMI/g, 'BMI = $1'],
  ['num-comma', rx(String.raw`(\s),\s?(\d+)(?=[${H}])`), '$1$2, '],
  ['latin-comma', rx(String.raw`(\s),\s?([A-Za-z]{2,})(?=[${H}])`), '$1$2, '],
  ['paren-num', rx(String.raw`(\([${H}]+) \)(\d+)`), '$1 $2) '],
  ['range-dot', /\s\.\s(\d+) – (\d+)(?=\s|$)/g, ' $2 – $1.'],
  ['trailing-num-dot', /\s\.\s?(\d{1,4})(?=\s|$)/g, ' $1.'],
  ['label-colon', rx(String.raw`\s:(\d+)(?=[${H}])`), ' $1: '],
  ['digit-heb', rx(String.raw`(\d)([${H}])`), '$1 $2'],
  ['latin-heb', rx(String.raw`([A-Za-z]{2,}\d*)(?=[${H}])`), '$1 '],
  ['dash-latin', rx(String.raw`([${H}])– (?=[A-Z])`), '$1–'],
  ['space-before-punct', /[ \t]+([.,:;?!])(?=[ \t]|$|\n)/g, '$1'],
  ['punct-glued', rx(String.raw`[ \t]+([.,:;])(?=[${H}A-Za-z"“(])`), '$1 '],
  ['paren-space-in', /\(\s+/g, '('],
  ['paren-space-out', /\s+\)/g, ')'],
  ['multi-space', /[ \t]{2,}/g, ' '],
];

export function cleanText(input) {
  if (typeof input !== 'string') return { text: input, rules: [] };
  let t = input.replace(/\r\n?/g, '\n');
  const used = [];
  // שבירות שורה שנוצרו ע"י גלישת PDF באמצע משפט -> רווח
  const lines = t.split('\n');
  if (lines.length > 1) {
    let out = lines[0];
    for (let i = 1; i < lines.length; i++) {
      const keep = /[.?!:;]\s*$/.test(out) || /^\s*(מטופל|\d+[.)]|[א-ת][.)]|[-•–])/.test(lines[i]) || !out.trim();
      out += (keep ? '\n' : ' ') + lines[i];
    }
    if (out !== t) used.push('join-lines');
    t = out;
  }
  for (const [name, re, rep] of RULES) {
    const next = t.replace(re, rep);
    if (next !== t) { used.push(name); t = next; }
  }
  t = t.split('\n').map(s => s.trim()).join('\n').trim();
  return { text: t, rules: used };
}

// תא טבלה: null | מחרוזת | מערך מחרוזות (כמה פסקאות) -> מערך שורות
export const cellLines = c => (c == null ? [] : Array.isArray(c) ? c : [c]).map(x => String(x)).filter(x => x !== '');
