import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// פיתוח בלבד: מגיש את תיקיית samples/ (לא נכנסת ל-git ולא ל-build) כדי לבדוק ייבוא בלי בחירת קבצים ידנית.
const devSamples = () => ({
  name: 'dev-samples',
  configureServer(server) {
    const dir = path.resolve('samples');
    server.middlewares.use('/__samples', (req, res) => {
      const name = decodeURIComponent((req.url || '/').slice(1).split('?')[0]);
      if (!name) {
        const list = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.zip')) : [];
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(list)); return;
      }
      const file = path.join(dir, path.basename(name));
      if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
      res.end(fs.readFileSync(file));
    });
  },
});

export default defineConfig({ base: './', plugins: [devSamples()] });
