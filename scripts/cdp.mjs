// עזר קטן להפעלת Edge/Chrome ללא ראש דרך פרוטוקול DevTools: צילומי מסך ובדיקות ממשק מקומיות.
// משמש את scripts/guide-shots.mjs (צילומי המדריך) ואת בדיקות הממשק. לא נכנס לבנייה.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

export async function launch({ port = 9333 + Math.floor(Math.random() * 500) } = {}) {
  const exe = CANDIDATES.find(p => fs.existsSync(p)); if (!exe) throw new Error('לא נמצא דפדפן (Edge/Chrome). אפשר להגדיר BROWSER_PATH.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars=false', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* עדיין עולה */ } await new Promise(r => setTimeout(r, 250)); }
  const page = targets?.find(t => t.type === 'page'); if (!page) throw new Error('הדפדפן לא עלה');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
    else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' '));
    else if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  const api = {
    logs, send,
    async viewport(w, h, mobile = false) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile, screenWidth: w, screenHeight: h, positionX: 0, positionY: 0 }); await new Promise(r => setTimeout(r, 250)); },
    async goto(url) { await send('Page.navigate', { url }); await new Promise(r => setTimeout(r, 400)); await api.waitFor('document.readyState === "complete"'); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: `(async()=>{ return (${expr}) })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async run(code) {                                   // גוף פונקציה אסינכרונית
      const r = await send('Runtime.evaluate', { expression: `(async()=>{ ${code} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(cond, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await api.eval(cond)) return true; } catch { /* עדיין */ } await new Promise(r => setTimeout(r, 150)); } throw new Error('timeout waiting for: ' + cond); },
    async shot(file, clip) {
      const params = { format: 'png' }; if (clip) params.clip = { ...clip, scale: 1 };
      const r = await send('Page.captureScreenshot', params); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file;
    },
    async rect(sel) { return api.eval(`(()=>{ const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height}; })()`); },
    async key(key) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 }[key] || 0 }); },
    async close() { try { ws.close(); } catch { /* ignore */ } proc.kill(); await new Promise(r => setTimeout(r, 300)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* נעול */ } },
  };
  return api;
}
