// עריכה קבוצתית: רק שדות שנבחרו, היסטוריה, מקורות מעורבים, נתונים חסרים, כישלון חלקי, ושמירת תוכן.
import assert from 'node:assert/strict';
import { EMPTY_BULK, chosen, planBulk, applyPatch, runBulk, describe } from '../src/admin-bulk.js';
import { EMPTY_FILTERS, applyFilters } from '../src/admin-filters.js';

const rubric = { answer: [{ type: 'text', text: 'מחוון' }, { type: 'image', mediaKey: 'p/rub.png' }] };
const blocks = [{ type: 'text', text: 'שאלה' }, { type: 'table', rows: [[['א', 'ב'], null], ['ג', 'ד']] }, { type: 'image', mediaKey: 'p/q.png' }];
const mk = (uid, o = {}) => ({ uid, pkgId: 'p', kind: 'bagrut', year: 2017, session: 'קיץ תשע״ז', domainId: 'cardio', typeId: 'open', blocks, rubric, caseStudyId: 'cs1', addDomainIds: ['endo'], searchText: uid, ...o });
const qs = [mk('b1'), mk('b2', { year: 2019, session: 'חורף' }), mk('t1', { kind: 'teacher', year: null, session: null, author: 'ישן' }), mk('x1', { kind: undefined, year: undefined })];
const snap = JSON.stringify(qs);

// בחירה: רק מה שמולא
assert.deepEqual(chosen(EMPTY_BULK()).changes, {});
assert.deepEqual(chosen({ ...EMPTY_BULK(), year: '2018' }).changes, { year: 2018 });
assert.ok(chosen({ ...EMPTY_BULK(), year: '1800' }).errors.length && chosen({ ...EMPTY_BULK(), year: 'abc' }).errors.length);
assert.deepEqual(chosen({ ...EMPTY_BULK(), clearYear: true, year: '2020' }).changes, { year: null });

// תכנון: מקורות מעורבים; שנה לא חלה על מורים; מחבר לא חל על בגרות; unknown מדולג
let p = planBulk(qs, { year: 2018 });
assert.deepEqual(p.updates.map(u => u.q.uid), ['b1', 'b2']);
assert.deepEqual(p.skipped.map(s => s.q.uid).sort(), ['t1', 'x1']);
assert.ok(p.warnings.length, 'אזהרת מקורות מעורבים');
p = planBulk(qs, { author: 'חדש' });
assert.deepEqual(p.updates.map(u => u.q.uid), ['t1']); assert.equal(p.skipped.length, 3);
p = planBulk(qs.slice(0, 1), { year: 2017 }); assert.equal(p.updates.length, 0); assert.equal(p.noop.length, 1, 'ערך זהה = ללא שינוי');
assert.equal(planBulk(qs, { domain: 'nope' }, { domains: { cardio: 'ל' } }).updates.length, 0, 'תחום לא קיים');
assert.equal(JSON.stringify(qs), snap, 'תכנון אינו משנה את הקלט');

// החלה: היסטוריה, תוכן ללא שינוי, שדות שלא נבחרו ללא שינוי
const q0 = qs[0]; const n = applyPatch(q0, { year: 2018, session: null }, '2026-11-06T10:00:00Z');
assert.equal(n.year, 2018); assert.equal(n.session, undefined);
assert.deepEqual(n.sourceHistory, [{ at: '2026-11-06T10:00:00Z', field: 'year', from: 2017, to: 2018 }, { at: '2026-11-06T10:00:00Z', field: 'session', from: 'קיץ תשע״ז', to: null }]);
assert.deepEqual([n.blocks, n.rubric, n.caseStudyId, n.pkgId, n.uid, n.domainId, n.typeId, n.addDomainIds], [q0.blocks, q0.rubric, q0.caseStudyId, q0.pkgId, q0.uid, q0.domainId, q0.typeId, q0.addDomainIds], 'תוכן ומזהים ללא שינוי');
assert.equal(n.adminEdited, undefined, 'שינוי מקור אינו "נערכה"');
assert.equal(q0.year, 2017, 'המקור לא שונה');
const n2 = applyPatch(n, { year: 2020 }); assert.equal(n2.sourceHistory.length, 3); assert.equal(n2.sourceHistory[2].from, 2018, 'היסטוריה מצטברת');
const n3 = applyPatch(q0, { domain: 'endo' }); assert.equal(n3.domainId, 'endo'); assert.deepEqual(n3.addDomainIds, []); assert.equal(n3.adminOrig.domainId, 'cardio'); assert.equal(n3.adminEdited, true);
assert.equal(applyPatch({ ...mk('m'), author: undefined }, { author: 'ד' }).sourceHistory[0].from, null, 'נתון חסר: from=null');
assert.equal(applyPatch(qs[2], { authorAdmin: 'ר' }).author, 'ישן', 'author ישן לא נדרס');

// ביצוע עמיד: כישלון באמצע לא עוצר ולא מזייף הצלחה
const saved = [];
const r = await runBulk(planBulk(qs.slice(0, 2), { year: 2021 }), async q => { if (q.uid === 'b1') throw Object.assign(new Error('x'), { code: 'unavailable' }); saved.push(q.uid); });
assert.deepEqual(saved, ['b2']); assert.equal(r.ok.length, 1); assert.equal(r.failed.length, 1); assert.equal(r.failed[0].q.uid, 'b1'); assert.equal(r.failed[0].error, 'unavailable');
assert.equal(qs[0].year, 2017, 'שאלה שנכשלה לא שונתה בזיכרון');

// מסננים נשארים נכונים אחרי עריכה: שנה חדשה מופיעה, ישנה נעלמת
const after = [r.ok[0], ...qs.slice(2)];
assert.equal(applyFilters(after, { ...EMPTY_FILTERS(), year: '2021' }).length, 1);
assert.equal(applyFilters(after, { ...EMPTY_FILTERS(), year: '2019' }).length, 0);
assert.ok(describe({ year: 2018, session: null }).join('|').includes('ניקוי'));
// 3000 שאלות: תכנון מהיר
const big = Array.from({ length: 3000 }, (_, i) => mk('g' + i, { year: 2010 + i % 10 }));
const t0 = performance.now(); const bp = planBulk(big, { year: 2018, author: 'x' }); const dt = performance.now() - t0;
assert.ok(bp.updates.length > 0 && dt < 200, 'תכנון איטי ' + dt);
console.log('test-admin-bulk: OK');
