// צילומי מסך אמיתיים של הממשק עבור המדריך (דורש שרת פיתוח: npm run dev). שימוש: node scripts/guide-shots.mjs [url] [outDir]
// הנתונים בצילומים הם שאלות לדוגמה קצרות שנכתבו במיוחד למדריך (לא תוכן ממאגר הבחינות), כדי שהמדריך הציבורי לא יחשוף שאלות מהמאגר.
// הממשק עצמו אמיתי (אותו קוד, בלי עריכת תמונות). המסגרות המודגשות מוזרקות כ-outline זמני בעמוד.
import { launch } from './cdp.mjs';
const base = (process.argv[2] || 'http://localhost:5174').replace(/\/$/, ''), out = process.argv[3] || 'out/guide-img';
const b = await launch(); const sleep = ms => new Promise(r => setTimeout(r, ms));
await b.viewport(1366, 820); await b.goto(base + '/'); await b.waitFor('window.__app && __app.S.questions.length > 50', 40000);

// ---- נתוני דוגמה ----
await b.run(`
const A=__app, S=A.S, dom=Object.keys(S.tax.domains), typ=Object.keys(S.tax.types);
const mk=(i,o)=>{ const q={ uid:'demo-'+i, pkgId:'demo', kind:'teacher', examCode:null, year:null, session:null, originalNumber:null, pages:[], section:null, heading:null, points:null, typeId:typ[0]||null, domainId:dom[i%dom.length], addDomainIds:[], topicIds:[], title:'', caseStudyId:null, blocks:[], rubric:null, issues:[], corrections:[], createdAt:1, ...o };
  q.searchText=q.blocks.map(b=>b.text||'').join(' ')+q.title; return q; };
const sec=(l,t,p)=>({type:'section',label:l,text:t,points:p}), txt=t=>({type:'text',text:t});
const rub=t=>({matchStatus:null,officialKind:'author',pages:[],answer:[{type:'text',text:t}],notes:null,points:null,allocation:[]});
const cs={ uid:'demo-case', blocks:[txt('אדם בן 45 הגיע למיון עם צמא מוגבר, מתן שתן תכוף ועייפות. בבדיקת דם נמצאה רמת סוכר גבוהה, ובבדיקת שתן נמצא סוכר.')], questionIds:['demo-4','demo-5'] };
const qs=[
 mk(1,{ title:'משוב שלילי ברמת הסוכר', blocks:[txt('הסבירו כיצד פועל מנגנון משוב שלילי בוויסות רמת הסוכר בדם.'), sec('א','תארו את התגובה של הגוף לעלייה ברמת הסוכר.',6), sec('ב','ציינו איבר אחד המשתתף בוויסות והסבירו את תפקידו.',4)], rubric:rub('עלייה בסוכר מעוררת הפרשת אינסולין מהלבלב, והוא מגביר את ספיגת הסוכר לתאים ואחסונו בכבד.') }),
 mk(2,{ title:'איברים והורמונים', blocks:[txt('מלאו את הטבלה.'), {type:'table',rows:[['איבר','הורמון','תפקיד'],['לבלב','',''],['בלוטת התריס','','']]}], rubric:rub('לבלב: אינסולין וגלוקגון. בלוטת התריס: תירוקסין.') }),
 mk(3,{ title:'מה מפריש אינסולין', blocks:[txt('איזה איבר מפריש אינסולין?'), {type:'choice',label:'א',text:'הכבד'},{type:'choice',label:'ב',text:'הלבלב'},{type:'choice',label:'ג',text:'הכליה'},{type:'choice',label:'ד',text:'הטחול'}], rubric:rub('ב. הלבלב.') }),
 mk(4,{ title:'סיפור מקרה: סוכרת', caseStudyId:'demo-case', blocks:[sec('א','הסבירו מדוע נמצא סוכר בשתן.',5), sec('ב','הסבירו את הצמא המוגבר של המטופל.',5)], rubric:rub('הסוכר עולה על סף הספיגה בכליה ולכן מופרש בשתן; השתן מוציא מים ולכן המטופל צמא.') }),
 mk(5,{ title:'סיפור מקרה: טיפול', caseStudyId:'demo-case', blocks:[txt('הרופא המליץ למטופל על שינוי תזונתי ופעילות גופנית.'), sec('א','הסבירו כיצד פעילות גופנית משפיעה על רמת הסוכר.',5)], rubric:rub('פעילות גופנית מגבירה צריכת סוכר בשרירים ומורידה את רמתו בדם.') }),
 mk(6,{ title:'ויסות חום', blocks:[txt('תארו שני מנגנונים שבאמצעותם הגוף מונע התחממות יתר.')], rubric:rub('הזעה והרחבת כלי דם בעור.') }),
 mk(7,{ title:'מערכת הנשימה', blocks:[txt('הסבירו כיצד מתבצעת חילוף גזים בנאדיות.'), sec('א','ציינו שתי תכונות של הנאדיות המאפשרות חילוף גזים יעיל.',5)] }),
 mk(8,{ title:'Insulin and Glucagon', blocks:[txt('הסבירו את הקשר בין Insulin לבין Glucagon בוויסות רמת הגלוקוז.')] }),
];
S.questions=qs; S.packages=[]; S.cases=new Map([[cs.uid,cs]]); S.personal=[]; S.exams=[]; S.usage=S.usage; S.f={text:'',domains:new Set(),types:new Set(),kinds:new Set(),years:new Set(),codes:new Set(),use:'all'};
S.exam={ id:'demo', title:'מבחן לדוגמה: ויסות הומיאוסטזיס', school:'', teacher:'', date:'', instructions:'', targetPoints:100, showPoints:true, items:[], cases:{}, updatedAt:Date.now() };
S.tab='home'; A.render(); return qs.length`);

const shot = async (name, { clip, hl = [], pad = 8 } = {}) => {
  await b.run(`document.getElementById('toast').classList.remove('on'); document.querySelectorAll('.__hl').forEach(e=>{e.classList.remove('__hl'); e.style.outline=''; e.style.outlineOffset='';}); ${JSON.stringify(hl)}.forEach(s=>{ const e=document.querySelector(s); if(e){ e.classList.add('__hl'); e.style.outline='3px solid #e11d48'; e.style.outlineOffset='2px'; e.style.borderRadius='8px'; } }); await new Promise(r=>setTimeout(r,250));`);
  let c;
  if (clip) { c = await b.rect(clip.sel); if (!c) throw new Error('אין ' + clip.sel); c = { x: Math.max(0, c.x - pad), y: Math.max(0, c.y - pad), width: Math.min(1366, c.width + pad * 2), height: Math.min(clip.maxH || 900, c.height + (clip.extraH || 0) + pad * 2) }; }
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1100, deviceScaleFactor: 1, mobile: false });
  const r = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 84, ...(c ? { clip: { ...c, scale: 1 } } : {}) });
  (await import('node:fs')).mkdirSync(out, { recursive: true }); (await import('node:fs')).writeFileSync(`${out}/${name}.jpg`, Buffer.from(r.data, 'base64'));
  await b.viewport(1366, 820); console.log('shot', name);
};
const run = c => b.run(c + `; await new Promise(r=>setTimeout(r,350)); return 1`);

await run(`__app.S.tab='home'; __app.render()`); await shot('home', { hl: ['[data-home=new]'] });
// מבחן עם פרק ושאלות
await run(`const A=__app,S=A.S; S.tab='work'; S.mode='split'; A.render(); await new Promise(r=>setTimeout(r,200)); document.getElementById('newchap').click(); await new Promise(r=>setTimeout(r,150)); const ch=S.exam.items[0]; ch.title='פרק א: ויסות רמת הסוכר'; A.render();
  for (const u of ['demo-1','demo-3','demo-2']) { document.querySelector('[data-add="'+u+'"]')?.click(); await new Promise(r=>setTimeout(r,150)); }
  S.exam.items.filter(i=>!i.type).forEach((i,k)=>i.points=[10,5,15][k]); S.exam.items.find(i=>i.snap?.uid==='demo-1').answerLines=4; A.render(); document.querySelector('[data-keep=exam]').scrollTop=0; S.saveState='saved'; A.render()`);
await shot('split', { hl: ['[data-fg=_panel]'] });
await run(`document.querySelector('[data-fg=_panel]').click(); document.querySelector('[data-fg=domains]').click()`);
await run(`const c=document.querySelectorAll('input[data-f=domains]'); if(c[0]) c[0].click(); await new Promise(r=>setTimeout(r,200)); const d=document.querySelectorAll('input[data-f=domains]'); if(d[1]) d[1].click(); await new Promise(r=>setTimeout(r,200)); document.querySelector('[data-fg=types]')?.click();`);
await shot('filters', { clip: { sel: '.splitL', maxH: 640 }, hl: ['.fchips'] });
await run(`__app.S.f.domains.clear(); __app.S.fopen.delete('_panel'); __app.S.fopen.delete('types'); __app.render()`);
await shot('card', { clip: { sel: '.item.cmp' }, hl: ['.item.cmp .ih2 .n3', '.item.cmp .ih2 .n2', '.item.cmp [data-mv^=down]'], pad: 10 });
await run(`document.querySelector('.item.cmp [data-imgmenu]').click()`);
await shot('menu', { clip: { sel: '.item.cmp .ih2', extraH: 130 }, hl: [], pad: 14 });
await b.key('Escape');
// סיפור מקרה במאגר
await run(`const S=__app.S; S.mode='search'; S.caseOpen.add('demo-case'); __app.render()`);
await shot('case', { clip: { sel: '.cgroup', maxH: 620 }, hl: ['[data-cgadd]'] });
// תצוגה מקדימה
await run(`const S=__app.S; S.mode='exam'; S.pv='preview'; S._pvTouched=true; __app.render()`);
await shot('preview', { clip: { sel: '.paperwrap', maxH: 760 }, pad: 6 });
// המבחנים שלי (צריך מבחן שמור: שומרים דרך ה-store)
await run(`const S=__app.S; S.pv='edit'; S.mode='split'; __app.render(); S.exams=[JSON.parse(JSON.stringify(S.exam)), {...JSON.parse(JSON.stringify(S.exam)), id:'demo2', title:'מבחן סיכום – מערכת העיכול', updatedAt:Date.now()-86400000*9}, {...JSON.parse(JSON.stringify(S.exam)), id:'demo3', title:'בוחן קצר – נשימה', updatedAt:Date.now()-86400000*20}]; S.tab='exams'; __app.render()`);
await shot('exams', { clip: { sel: '#main', maxH: 420 }, hl: ['.excard [data-renex]'] });
// מאגר אישי: טופס
await run(`const S=__app.S; S.tab='personal'; S.pq={uid:null,sourceKind:'authored',sourceText:'',domainId:Object.keys(S.tax.domains)[1],typeId:'',title:'ויסות חום בגוף',body:'תארו שני מנגנונים שבאמצעותם הגוף מונע התחממות יתר.',sections:['',''],choices:[],answer:'',images:[],error:''}; __app.render()`);
await shot('personal', { clip: { sel: '#main', maxH: 900 }, hl: ['.pqmeta', '.pqbody'] });
console.log('console issues:', b.logs.slice(0, 5)); await b.close();
