// השוואת גופנים בעיצוב ב׳ המעודכן: אותו דף בית ואותה כרטיסיית שאלה (דורש npm run dev). node scripts/font-shots.mjs [url] [outDir]
import { launch } from './cdp.mjs';
import fs from 'node:fs';
const base = (process.argv[2] || 'http://localhost:5174').replace(/\/$/, ''), out = process.argv[3] || 'docs/design/shots';
const FONTS = [['opensans', 'Open Sans', 'open-sans'], ['assistant', 'Assistant', 'assistant'], ['heebo', 'Heebo', 'heebo']];
const b = await launch(); await b.viewport(1366, 820); await b.goto(base + '/'); await b.waitFor('window.__app && __app.S.questions.length > 50', 40000);
// נתוני דוגמה זהים לכל הגופנים: שאלה עם עברית, מספרים ומונחים באנגלית
await b.run(`const A=__app,S=A.S,dom=Object.keys(S.tax.domains);
 const txt=t=>({type:'text',text:t}), sec=(l,t,p)=>({type:'section',label:l,text:t,points:p});
 const q=(i,o)=>({uid:'f'+i,pkgId:'d',kind:'teacher',examCode:null,year:null,session:null,originalNumber:null,pages:[],points:null,typeId:null,domainId:dom[i%dom.length],addDomainIds:[],topicIds:[],title:'',caseStudyId:null,blocks:[],rubric:null,issues:[],corrections:[],createdAt:1,searchText:'x',...o});
 S.questions=[q(1,{blocks:[txt('אדם בן 45 הגיע למיון עם צמא מוגבר, מתן שתן תכוף ורמת גלוקוז של 310 mg/dL. הסבירו את הקשר בין Insulin לבין Glucagon, וציינו מדוע רמת HbA1c של 8.5% מעידה על ויסות לקוי לאורך זמן.'),sec('א','תארו את התגובה של הלבלב (Pancreas) לעלייה ברמת הסוכר.',6),sec('ב','הסבירו כיצד ניתן לשנות את התוצאה בעזרת פעילות גופנית (3 פעמים בשבוע).',4)],rubric:{matchStatus:null,officialKind:'author',pages:[],answer:[{type:'text',text:'x'}],notes:null,points:null,allocation:[]}})];
 S.cases=new Map(); S.packages=[]; S.personal=[]; S.exams=[{id:'e1',title:'מבחן לדוגמה: ויסות הומיאוסטזיס',items:[],cases:{},updatedAt:Date.now(),targetPoints:100}]; S.exam={id:'e1',title:'מבחן לדוגמה',school:'',teacher:'',date:'',instructions:'',targetPoints:100,showPoints:true,items:[],cases:{},updatedAt:Date.now()}; S.tab='work'; S.mode='split'; A.render(); await new Promise(r=>setTimeout(r,200)); document.querySelector('[data-add]').click(); await new Promise(r=>setTimeout(r,200)); S.exam.items[0].points=10; S.exam.items[0].answerLines=4; S.exams[0].items=[S.exam.items[0]]; S.saveState='saved';`);
const links = FONTS.map(([, , p]) => [400, 600, 700, 800].map(w => `@import url('/node_modules/@fontsource/${p}/${w}.css');`).join('')).join('');
for (const [key, name] of FONTS) {
  await b.run(`document.getElementById('__t')?.remove(); const s=document.createElement('style'); s.id='__t'; s.textContent=${JSON.stringify(links)}; document.head.appendChild(s); const l=document.createElement('link'); l.rel='stylesheet'; l.href='/docs/design/theme-b2.css'; l.dataset.t='1'; document.querySelectorAll('link[data-t]').forEach(x=>x.remove()); document.head.appendChild(l); await new Promise(r=>l.onload=r); document.documentElement.style.setProperty('--f', ${JSON.stringify("'" + name + "'")}); await Promise.all(['400','600','700','800'].map(w=>document.fonts.load(w+' 16px "${name}"','אבגabc'))); await document.fonts.ready; await new Promise(r=>setTimeout(r,500));`);
  await b.run(`__app.S.tab='home'; __app.render(); await new Promise(r=>setTimeout(r,300));`); await b.shot(`${out}/b2-${key}-home.png`);
  await b.run(`__app.S.tab='work'; __app.S.mode='exam'; __app.S.pv='edit'; __app.render(); await new Promise(r=>setTimeout(r,300));`);
  await b.run(`document.getElementById('toast').classList.remove('on')`); const c = await b.rect('.item.cmp'); await b.shot(`${out}/b2-${key}-card.png`, { x: Math.max(0, c.x - 20), y: c.y - 20, width: Math.min(1100, c.width + 40), height: c.height + 40 });
  // מסך קטן: כרטיס ב-375
  await b.viewport(375, 800, true); await b.run(`await new Promise(r=>setTimeout(r,300)); document.querySelector('.item.cmp').scrollIntoView(); await new Promise(r=>setTimeout(r,300));`); await b.shot(`${out}/b2-${key}-mobile.png`); await b.viewport(1366, 820);
  console.log('done', key, await b.eval(`getComputedStyle(document.body).fontFamily + ' | loaded:' + document.fonts.check('16px "${name}"')`));
}
console.log(b.logs.slice(0, 4)); await b.close();
