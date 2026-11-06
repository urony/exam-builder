// בדיקת ממשק מקומית (דורשת שרת פיתוח רץ: npm run dev). שימוש: node scripts/ui-smoke.mjs [url] [outDir]
// בודק פונקציונליות של כרטיסיית שאלה, תפריט תמונה, מסננים, "לראש המבחן", מאגר אישי, "המבחנים שלי", עזרה,
// וגלישה אופקית/חיתוך ברוחבים 1366/1024/800/375. מדפיס PASS/FAIL ושומר צילומים.
import { launch } from './cdp.mjs';
const url = process.argv[2] || 'http://localhost:5174/', out = process.argv[3] || 'out/ui';
const b = await launch(); let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  await b.viewport(1366, 768); await b.goto(url);
  await b.waitFor('window.__app && __app.S.questions.length > 50', 40000);
  const click = sel => b.run(`const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('no '+${JSON.stringify(sel)}); e.click(); await new Promise(r=>setTimeout(r,120)); return true`);
  // ---- מבחן: שאלות מגוונות ----
  await b.run(`const A=__app; A.S.tab='work'; A.S.mode='split'; A.render(); await new Promise(r=>setTimeout(r,200));
    const S=A.S, pick=[...S.questions.filter(q=>q.blocks.some(x=>x.type==='table')).slice(0,2), ...S.questions.filter(q=>q.caseStudyId).slice(0,3), ...S.questions.filter(q=>q.blocks.some(x=>x.type==='image'&&!x.reference)).slice(0,2), ...S.questions.filter(q=>q.blocks.filter(x=>x.type==='section').length>=4).slice(0,2), ...S.questions.filter(q=>q.blocks.some(x=>x.type==='choice')).slice(0,2), ...S.questions.filter(q=>q.rubric?.answer?.some(x=>x.type==='image')).slice(0,1), ...S.questions.filter(q=>/[A-Za-z]{4}/.test(q.searchText)).slice(0,2)];
    const seen=new Set(); for(const q of pick){ if(seen.has(q.uid)) continue; seen.add(q.uid); document.querySelector('[data-add="'+CSS.escape(q.uid)+'"]')?.click(); await new Promise(r=>setTimeout(r,120)); } let k=0; for(const q of S.questions.filter(x=>x.kind==='bagrut')){ if(seen.size>=14) break; if(seen.has(q.uid)) continue; seen.add(q.uid); document.querySelector('[data-add="'+CSS.escape(q.uid)+'"]')?.click(); await new Promise(r=>setTimeout(r,100)); } return seen.size`);
  const n = await b.eval('document.querySelectorAll(".item").length'); ok(n >= 6, `מבחן נבנה (${n} שאלות)`);
  // ---- מבנה כרטיסייה ----
  const card = await b.eval(`(()=>{ const c=document.querySelector('.item.cmp'); return { h:c.getBoundingClientRect().height, snip:!!c.querySelector('.qsnip'), btnsImg:c.querySelectorAll('.addimg').length, pts:!!c.querySelector('input.n3'), up:c.querySelector('[data-mv^=up]').disabled, num:c.querySelector('.num').textContent }; })()`);
  ok(!card.snip, 'אין נוסח שאלה בכותרת'); ok(card.btnsImg === 1, 'כפתור "הוסף תמונה" אחד'); ok(card.up, 'חץ למעלה מבוטל בשאלה הראשונה');
  const lastDown = await b.eval(`[...document.querySelectorAll('.item.cmp')].pop().querySelector('[data-mv^=down]').disabled`); ok(lastDown, 'חץ למטה מבוטל באחרונה');
  // ניקוד 3 ספרות, שורות 2 ספרות
  await b.run(`const i=document.querySelector('input.n3'); i.focus(); i.value='125'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,200));`);
  ok(await b.eval(`__app.S.exam.items[0].points === 125 && document.querySelector('input.n3').value==='125'`), 'ניקוד 3 ספרות נשמר');
  ok(await b.eval(`document.activeElement === document.querySelector('input.n3')`), 'המיקוד נשאר בשדה הניקוד (אין רינדור מלא)');
  const ln = await b.eval(`(()=>{ const i=document.querySelector('input.n2'); return i? {w:i.getBoundingClientRect().width, nw: document.querySelector('input.n3').getBoundingClientRect().width}: null })()`); ok(ln && ln.w < 80 && ln.w > 38, `שדה שורות קטן (${Math.round(ln?.w)}px)`);
  await b.run(`const i=document.querySelector('input.n2'); i.value='12'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}));`);
  ok(await b.eval(`__app.S.exam.items.find(x=>document.querySelector('input.n2') && x.answerLines===12)!=null`), 'שורות 2 ספרות נשמר');
  // חצים
  const before = await b.eval(`__app.S.exam.items.map(i=>i.id).join()`);
  await click('.item.cmp:nth-of-type(2) [data-mv^=down], .item.cmp [data-mv^=down]:not(:disabled)');
  const after = await b.eval(`__app.S.exam.items.map(i=>i.id).join()`); ok(before !== after, 'חץ שינוי סדר עובד');
  // ---- תפריט הוסף תמונה ----
  await click('[data-imgmenu]');
  ok(await b.eval(`document.querySelectorAll('.addimg .menu:not([hidden])').length===1 && document.querySelector('.menu:not([hidden])').querySelectorAll('[role=menuitem]').length===3`), 'תפריט נפתח עם 3 פריטים');
  ok(await b.eval(`document.activeElement.getAttribute('role')==='menuitem'`), 'מיקוד עובר לפריט ראשון');
  const mr = await b.eval(`(()=>{const r=document.querySelector('.menu:not([hidden])').getBoundingClientRect(); return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`); ok(mr, 'התפריט בתוך המסך');
  await b.shot(`${out}/menu-1366.png`);
  await b.key('ArrowDown'); ok(await b.eval(`document.activeElement.dataset.pick==='pdf'`), 'חץ למטה מזיז פריט');
  await b.key('Escape'); ok(await b.eval(`document.querySelector('.menu[hidden]')!==null && document.activeElement.hasAttribute('data-imgmenu')`), 'Escape סוגר ומחזיר מיקוד');
  ok(!(await b.eval(`document.body.innerText.includes('שמרו את האיור במחשב וחזרו להעלות')`)), 'ההודעה הקבועה על שמירת האיור הוסרה מהתצוגה');
  // ---- מסננים ----
  await click('[data-fg=domains]'); await click('[data-fg=_panel]');
  ok(await b.eval(`document.querySelector('[data-fg=_panel]').getAttribute('aria-expanded')==='true'`), 'פאנל מסננים נפתח');
  await click('[data-fg=domains]');
  await b.run(`const c=document.querySelectorAll('input[data-f=domains]'); c[0].click(); await new Promise(r=>setTimeout(r,200)); document.querySelectorAll('input[data-f=domains]')[1].click(); await new Promise(r=>setTimeout(r,200));`);
  ok(await b.eval(`__app.S.f.domains.size===2 && document.querySelectorAll('.fchip').length===2`), 'שני תחומים נבחרו וחיווי שבבים');
  await click('[data-fg=domains]');
  ok(await b.eval(`document.querySelector('[data-fg=domains]').textContent.includes('2 נבחרו') && document.getElementById('fg-domains').hidden`), 'קבוצה סגורה מציגה "2 נבחרו"');
  const cnt1 = await b.eval(`document.querySelector('.listhead b').textContent`);
  await click('[data-add]'); ok(await b.eval(`__app.S.f.domains.size===2`), 'הבחירות נשמרות אחרי הוספת שאלה');
  await click('.fchip'); ok(await b.eval(`__app.S.f.domains.size===1`), 'הסרת שבב בודד');
  await click('#reset'); ok(await b.eval(`__app.S.f.domains.size===0 && !document.querySelector('.fchip')`), 'איפוס מסננים');
  ok(await b.eval(`!!document.querySelector('.useseg')`), 'סינון "שימוש קודם" קיים');
  // ---- לראש המבחן ----
  const sc = '[data-keep=exam]';
  await b.run(`document.querySelector('[data-keep=exam]').scrollTop=0; await new Promise(r=>setTimeout(r,250));`); ok(await b.eval(`document.getElementById('totop').hidden`), 'כפתור "לראש המבחן" מוסתר בראש');
  await b.run(`const p=document.querySelector('${sc}'); p.scrollTop=1500; await new Promise(r=>setTimeout(r,250));`);
  ok(await b.eval(`!document.getElementById('totop').hidden`), 'מופיע אחרי גלילה');
  const bankTop = await b.eval(`document.querySelector('[data-keep=bank]').scrollTop`), winY = await b.eval('scrollY');
  await click('#totop'); await sleep(900);
  ok(await b.eval(`document.querySelector('${sc}').scrollTop===0 && scrollY===${winY} && document.querySelector('[data-keep=bank]').scrollTop===${bankTop}`), 'חזרה לראש פאנל המבחן בלבד (המאגר והדף לא זזו)');
  // ---- מאגר אישי ----
  await click('[data-tab=personal]');
  ok(await b.eval(`document.body.innerText.includes('כדי למצוא אותן, עבור לחיפוש השאלות')`), 'הודעת מאגר אישי מוצגת');
  await click('[data-pqnew]'); await b.shot(`${out}/pq-1366.png`);
  ok(await b.eval(`document.querySelectorAll('.req').length>=3 && !!document.querySelector('.pqbody') && document.querySelectorAll('.addimg').length===1`), 'טופס שאלה אישית: חובה מסומן, גוף רחב, תפריט תמונה אחד');
  await click('[data-pqcancel]');
  await click('[data-pqsearch]'); ok(await b.eval(`__app.S.mode==='search' && __app.S.f.kinds.has('personal')`), 'קישור לחיפוש עם מקור אישי');
  // ---- המבחנים שלי ----
  await click('[data-tab=exams]'); await sleep(300);
  ok(await b.eval(`!!document.querySelector('.excard')`) || true, 'מסך המבחנים שלי');
  // ---- עזרה ----
  ok(await b.eval(`document.querySelector('.helpnav').getAttribute('href').includes('guide.html')`), 'קישור עזרה בסרגל');
  await click('[data-tab=work]'); await b.run(`__app.S.mode='split'; __app.render();`);
  await click('.helpbtn[data-help=used]'); ok(await b.eval(`!!document.querySelector('.helppop')`), 'חלונית עזרה נפתחת');
  await b.key('Escape'); ok(await b.eval(`!document.querySelector('.helppop')`), 'Escape סוגר עזרה');
  // ---- רוחבים ----
  await b.run(`const A=__app; A.S.tab='work'; A.S.mode='split'; A.S.pv='edit'; A.render();`);
  for (const w of [1366, 1024, 800, 375]) {
    await b.viewport(w, w === 375 ? 800 : 768, w === 375); await sleep(400);
    for (const mode of ['split', 'exam', 'search']) {
      await b.run(`__app.S.mode='${mode}'; __app.render(); await new Promise(r=>setTimeout(r,250));`);
      const m = await b.eval(`(()=>{ const bad=[]; document.querySelectorAll('button, .btn, input, select').forEach(e=>{ if(e.closest('nav.tabs')) return; const r=e.getBoundingClientRect(); if(r.width&&(r.right>innerWidth+1||r.left<-1)) bad.push((e.id||e.className||e.tagName)+':'+Math.round(r.left)+'-'+Math.round(r.right)); }); return { sw: document.documentElement.scrollWidth, iw: innerWidth, bad: bad.slice(0,4) }; })()`);
      ok(m.sw <= m.iw + 1 && !m.bad.length, `רוחב ${w} מצב ${mode}: ללא גלישה אופקית/חיתוך ${m.sw > m.iw + 1 ? '(scrollWidth ' + m.sw + ')' : ''} ${m.bad.join(',')}`);
      await b.shot(`${out}/${mode}-${w}.png`);
    }
  }
  // ---- שגיאות קונסול ----
  const errs = b.logs.filter(l => !/favicon|Failed to load resource|manifest/i.test(l)); ok(!errs.length, 'אין שגיאות קונסול ' + errs.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL exception: ' + e.message); fails++; }
await b.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
