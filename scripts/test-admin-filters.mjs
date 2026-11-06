// בדיקת מסנני ניהול שאלות: שנה, מקור, מחבר, מגיש, חבילה, שילובים, נתונים חסרים וביצועים (5000 שאלות סינתטיות).
import assert from 'node:assert/strict';
import { rubricKind, EMPTY_FILTERS, applyFilters, facets, sessionsOf, activeCount, packageOptions, yearOf, kindOf, authorOf, NO_YEAR, UNKNOWN_AUTHOR, UNKNOWN_KIND } from '../src/admin-filters.js';

const mk = (uid, o) => ({ uid, pkgId: 'p', kind: 'bagrut', year: null, session: null, domainId: 'cardio', typeId: 'open', searchText: 'שאלה ' + uid, published: true, ...o });
const qs = [
  mk('b17a', { year: 2017, session: 'קיץ תשע״ז', pkgId: 'bagrut-2017' }),
  mk('b17b', { year: 2017, session: 'חורף תשע״ז', pkgId: 'bagrut-2017-w', domainId: 'endo' }),
  mk('b19', { year: 2019, session: 'קיץ תשע״ט', pkgId: 'bagrut-2019' }),
  mk('b-str', { year: '2012', pkgId: 'bagrut-2012' }),
  mk('b-bad', { year: 'abc', pkgId: 'bagrut-bad' }),
  mk('t1', { kind: 'teacher', pkgId: 'teacher-endo', author: 'דנה כהן', domainId: 'endo' }),
  mk('t2', { kind: 'teacher', pkgId: 'teacher-endo', author: 'דנה כהן', published: false }),
  mk('t3', { kind: 'teacher', pkgId: 'teacher-cardio', reviewFlag: true }),
  mk('t4', { kind: 'teacher', pkgId: 'teacher-cardio', authorAdmin: 'רוני לוי', author: 'מקור' }),
  mk('s1', { kind: 'teacher', pkgId: 'approved', credit: 'מיכל', submitterUid: 'uidAAAA1111', submitterName: 'מיכל' }),
  mk('s2', { kind: 'teacher', pkgId: 'approved', submitterUid: 'uidBBBB2222' }),
  mk('x1', { kind: undefined, pkgId: 'weird' }),
];
const ids = f => applyFilters(qs, { ...EMPTY_FILTERS(), ...f }).map(q => q.uid).sort().join(',');

// שנה: רק שנים תקינות; שנה כמחרוזת תקינה מזוהה; ערך זבל = ללא שנה; שאלות מורים לא בשנה
assert.equal(yearOf(qs[3]), 2012); assert.equal(yearOf(qs[4]), null);
assert.equal(ids({ year: '2017' }), 'b17a,b17b');
assert.equal(ids({ year: '2012' }), 'b-str');
assert.ok(!ids({ year: '2017' }).includes('t'), 'שאלות מורים לא נכללות בשנה');
assert.deepEqual(facets(qs).years.map(y => y[0]), [2019, 2017, 2012], 'רק שנים שקיימות, מהחדשה לישנה');
assert.equal(facets(qs).noYear, 8);
assert.ok(ids({ year: NO_YEAR }).includes('t1') && ids({ year: NO_YEAR }).includes('b-bad'));
// מועדים באותה שנה נשמרים בנפרד
assert.deepEqual(sessionsOf(qs.filter(q => yearOf(q) === 2017)).map(x => x[0]).sort(), ['חורף תשע״ז', 'קיץ תשע״ז'].sort());
assert.equal(ids({ year: '2017', session: 'חורף תשע״ז' }), 'b17b');

// מקור: אמיתי בלבד; חסר = unknown במפורש
assert.equal(kindOf(qs[11]), UNKNOWN_KIND);
assert.equal(ids({ kind: 'teacher' }), 's1,s2,t1,t2,t3,t4');
assert.equal(ids({ kind: UNKNOWN_KIND }), 'x1');
assert.ok(!ids({ kind: 'bagrut' }).includes('x1'));

// מחבר: עדיפות שיוך מנהל > חבילה > קרדיט; לא ממציאים
assert.equal(authorOf(qs[8]), 'רוני לוי'); assert.equal(authorOf(qs[5]), 'דנה כהן'); assert.equal(authorOf(qs[9]), 'מיכל'); assert.equal(authorOf(qs[7]), null);
assert.equal(ids({ teacher: 'a:דנה כהן' }), 't1,t2');
assert.equal(ids({ teacher: 'a:מקור' }), '');
assert.equal(ids({ teacher: UNKNOWN_AUTHOR }), 's2,t3,x1');
assert.ok(!ids({ teacher: UNKNOWN_AUTHOR }).includes('b'), 'שאלות בגרות לא "מחבר לא ידוע"');
// מגיש דרך האתר, שונה ממחבר
assert.equal(ids({ teacher: 's:uidBBBB2222' }), 's2');
assert.equal(facets(qs).submitters.length, 2);
// חבילה (כולל עברית/רווחים/סימנים)
const weird = [mk('w1', { pkgId: 'חבילה א׳ & ב (2017)/x' }), mk('w2', { pkgId: 'other' })];
assert.equal(applyFilters(weird, { ...EMPTY_FILTERS(), pkg: 'חבילה א׳ & ב (2017)/x' }).length, 1);
assert.equal(ids({ pkg: 'teacher-endo' }), 't1,t2');
const po = packageOptions([{ id: 'teacher-endo', fileName: 'endo.zip', title: 'אנדוקרינולוגיה' }], qs);
assert.ok(po.some(p => p.id === 'approved' && p.label === 'הצעות מורים שאושרו') && po.find(p => p.id === 'teacher-endo').label === 'אנדוקרינולוגיה');

// שילובים
assert.equal(ids({ kind: 'bagrut', year: '2017', domain: 'cardio' }), 'b17a');
assert.equal(ids({ kind: 'teacher', teacher: 'a:דנה כהן', domain: 'endo' }), 't1');
assert.equal(ids({ kind: 'teacher', status: 'hidden' }), 't2');
assert.equal(ids({ status: 'flag' }), 't3');
assert.equal(ids({ kind: 'teacher', text: 'T1' }), 't1');
assert.equal(activeCount({ ...EMPTY_FILTERS(), kind: 'teacher', year: '2017' }), 2);
assert.equal(activeCount(EMPTY_FILTERS()), 0);
assert.equal(applyFilters(qs, EMPTY_FILTERS()).length, qs.length, 'איפוס מחזיר הכול');
// "סמן לבדיקה" בלתי תלוי ב-needs_review מחבילת מקור
assert.equal(applyFilters([mk('r1', { reviewStatus: 'needs_review', extractionStatus: 'needs_review' })], { ...EMPTY_FILTERS(), status: 'flag' }).length, 0);

assert.equal(rubricKind({}), 'none'); assert.equal(rubricKind({ rubric: { answer: [{ type: 'text', text: 'א' }] } }), 'text');
assert.equal(rubricKind({ rubric: { answer: [{ type: 'image', mediaKey: 'k' }] } }), 'image'); assert.equal(rubricKind({ rubric: { answer: [{ text: 'א' }, { mediaKey: 'k' }] } }), 'both');
// ביצועים: 5000 שאלות
const big = []; for (let i = 0; i < 5000; i++) big.push(mk('g' + i, { year: 2010 + (i % 15), kind: i % 3 ? 'bagrut' : 'teacher', author: i % 3 ? undefined : 'מחבר ' + (i % 20), pkgId: 'pk' + (i % 40), domainId: 'd' + (i % 9), searchText: 'שאלה מספר ' + i + ' על לב וכליה ' + 'מילה '.repeat(40) }));
const ix = new Map(); let t0 = performance.now();
const r1 = applyFilters(big, { ...EMPTY_FILTERS(), text: 'כליה 4999' }, ix); const cold = performance.now() - t0;
t0 = performance.now(); for (let k = 0; k < 20; k++) applyFilters(big, { ...EMPTY_FILTERS(), kind: 'bagrut', year: '2017', domain: 'd3', text: 'לב' }, ix); const warm = (performance.now() - t0) / 20;
t0 = performance.now(); facets(big); packageOptions([], big); const fct = performance.now() - t0;
assert.equal(r1.length, 1);
console.log(`ביצועים (5000 שאלות): חיפוש קר ${cold.toFixed(1)}ms, סינון משולב ${warm.toFixed(1)}ms, ערכי מסנן ${fct.toFixed(1)}ms`);
assert.ok(cold < 500 && warm < 100 && fct < 200, 'ביצועים איטיים מדי');
console.log('test-admin-filters: OK');
