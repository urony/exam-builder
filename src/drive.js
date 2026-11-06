// אחסון נתונים אישיים ב-Google Drive appDataFolder של המורה (REST, הרשאת drive.appdata בלבד).
// קובץ JSON לכל ישות: exam-<id>.json, pq-<id>.json; תמונות: img-<key>. הטוקן והפונקציה fetch ניתנים להזרקה (לבדיקות).
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export function createDrive({ getToken, fetchImpl = (...a) => fetch(...a) }) {
  const auth = () => {
    const t = getToken();
    if (!t) throw new Error('אין הרשאת Drive – נדרשת התחברות מחדש');
    return { Authorization: 'Bearer ' + t };
  };
  const ok = async r => {
    if (!r.ok) { const e = new Error('Drive ' + r.status); e.status = r.status; throw e; }
    return r;
  };

  async function list(prefix = '') {
    const out = []; let pageToken = '';
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(id,name,modifiedTime)' });
      if (pageToken) q.set('pageToken', pageToken);
      const j = await (await ok(await fetchImpl(`${API}?${q}`, { headers: auth() }))).json();
      out.push(...j.files.filter(f => f.name.startsWith(prefix)));
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  const findId = async name => (await list(name)).find(f => f.name === name)?.id || null;

  async function putFile(name, body, mime) {
    const id = await findId(name);
    const meta = id ? { name } : { name, parents: ['appDataFolder'] };
    const boundary = 'b' + Math.random().toString(36).slice(2);
    const enc = new TextEncoder();
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
    const data = typeof body === 'string' ? enc.encode(body) : body;
    const tail = enc.encode(`\r\n--${boundary}--`);
    const buf = new Uint8Array(head.length + data.length + tail.length);
    buf.set(head, 0); buf.set(data, head.length); buf.set(tail, head.length + data.length);
    const url = id ? `${UPLOAD}/${id}?uploadType=multipart` : `${UPLOAD}?uploadType=multipart`;
    await ok(await fetchImpl(url, { method: id ? 'PATCH' : 'POST', headers: { ...auth(), 'Content-Type': `multipart/related; boundary=${boundary}` }, body: buf }));
  }

  async function getBytes(name) {
    const id = await findId(name);
    if (!id) return null;
    return new Uint8Array(await (await ok(await fetchImpl(`${API}/${id}?alt=media`, { headers: auth() }))).arrayBuffer());
  }

  return {
    list,
    putJson: (name, obj) => putFile(name, JSON.stringify(obj), 'application/json'),
    async getJson(name) { const b = await getBytes(name); return b ? JSON.parse(new TextDecoder().decode(b)) : null; },
    putBytes: (name, bytes, mime = 'application/octet-stream') => putFile(name, bytes, mime),
    getBytes,
    async remove(name) {
      const id = await findId(name);
      if (id) await ok(await fetchImpl(`${API}/${id}`, { method: 'DELETE', headers: auth() }));
    },
  };
}
