// צילומי חלופות עיצוב (דורש שרת פיתוח). שימוש: node scripts/design-shots.mjs [url] [outDir]
import { launch } from './cdp.mjs';
const base = (process.argv[2] || 'http://localhost:5174').replace(/\/$/, ''), out = process.argv[3] || 'docs/design/shots';
const b = await launch(); const sleep = ms => new Promise(r => setTimeout(r, ms));
await b.viewport(1200, 1000);
for (const t of ['base', 'a', 'b']) { await b.goto(`${base}/docs/design/tile.html${t === 'base' ? '' : '?theme=' + t}`); await b.run('await document.fonts.ready; await new Promise(r=>setTimeout(r,700));'); await b.shot(`${out}/${t}-5-tile.png`); }
await b.viewport(1366, 820);
await b.goto(base + '/'); await b.waitFor('window.__app && __app.S.questions.length > 50', 40000);
// מבחן לדוגמה עם פרק ושאלות מגוונות
await b.run(`const A=__app, S=A.S; S.tab='work'; S.mode='split'; A.render(); await new Promise(r=>setTimeout(r,200));
  const pick=[...S.questions.filter(q=>q.kind==='bagrut'&&q.rubric).slice(0,2), ...S.questions.filter(q=>q.blocks.some(x=>x.type==='table')&&q.kind==='bagrut').slice(0,1), ...S.questions.filter(q=>q.blocks.filter(x=>x.type==='section').length>=3&&q.kind==='bagrut').slice(0,1)];
  for(const q of pick){ document.querySelector('[data-add="'+CSS.escape(q.uid)+'"]')?.click(); await new Promise(r=>setTimeout(r,150)); }
  document.getElementById('newchap')?.click(); await new Promise(r=>setTimeout(r,150));
  const ex=S.exam; ex.title='מבחן בגרות לדוגמה'; const ch=ex.items.find(i=>i.type==='chapter'); if(ch){ ch.title='פרק א: ידע בסיסי'; ex.items.splice(ex.items.indexOf(ch),1); ex.items.unshift(ch);} ex.items.filter(i=>!i.type).forEach((i,k)=>{i.points=[25,20,30,25][k]||20}); A.render(); await new Promise(r=>setTimeout(r,300)); return 1`);
for (const t of ['base', 'a', 'b']) {
  await b.run(`document.querySelectorAll('link[data-theme]').forEach(l=>l.remove()); ${t === 'base' ? '' : `const l=document.createElement('link'); l.rel='stylesheet'; l.href='/docs/design/theme-${t}.css'; l.dataset.theme='1'; document.head.appendChild(l); await new Promise(r=>l.onload=r);`} await document.fonts.ready; await new Promise(r=>setTimeout(r,500));`);
  await b.viewport(1366, 820);
  await b.run(`__app.S.tab='home'; __app.render(); await new Promise(r=>setTimeout(r,300));`); await b.shot(`${out}/${t}-1-home.png`);
  await b.run(`__app.S.tab='work'; __app.S.mode='split'; __app.render(); await new Promise(r=>setTimeout(r,400));`); await b.shot(`${out}/${t}-2-work.png`);
  await b.run(`__app.S.mode='search'; __app.render(); await new Promise(r=>setTimeout(r,300));`); await b.shot(`${out}/${t}-3-search.png`);
  await b.run(`__app.S.mode='split'; __app.render(); await new Promise(r=>setTimeout(r,300)); document.querySelector('[data-imgmenu]').click(); await new Promise(r=>setTimeout(r,200));`);
  await b.shot(`${out}/${t}-4-menu.png`); await b.key('Escape');
}
console.log('console issues:', b.logs.slice(0, 5)); await b.close();
