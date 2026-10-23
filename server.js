// Nebula chat server: rooms + message history saved to a JSON file. Messages are deleted after 7 days.
const http = require('http'), fs = require('fs'), { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const FILE = process.env.DATA_FILE || './chat-data.json';
const ADMIN = process.env.ADMIN_TOKEN; // optional: lets you clear a room
const MAX_ROOMS = 500, KEEP = 200, WEEK = 7 * 24 * 60 * 60 * 1000;

let rooms = {};
try { rooms = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
let dirty = false;
function prune() {
  const cutoff = Date.now() - WEEK;
  for (const r of Object.keys(rooms)) {
    const kept = rooms[r].filter(m => m.ts > cutoff);
    if (kept.length !== rooms[r].length) dirty = true;
    if (kept.length) rooms[r] = kept; else { delete rooms[r]; dirty = true; }
  }
}
prune(); setInterval(prune, 60 * 60 * 1000);
setInterval(() => { if (dirty) { dirty = false; fs.writeFile(FILE, JSON.stringify(rooms), () => {}); } }, 5000);

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, '').slice(0, n);
const roomName = n => clean(n, 40).trim().toLowerCase() || 'global';

const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/plain' }); r.end('Nebula chat server running'); });
const wss = new WebSocketServer({ server: srv, maxPayload: 4096 });

wss.on('connection', ws => {
  ws.room = null; ws.last = 0;
  ws.on('message', d => {
    let m; try { m = JSON.parse(d); } catch (e) { return; }
    if (m.type === 'join') {
      const r = roomName(m.room);
      if (!rooms[r] && Object.keys(rooms).length >= MAX_ROOMS) return ws.close();
      ws.room = r;
      prune();
      ws.send(JSON.stringify({ type: 'history', msgs: rooms[r] || [] }));
    } else if (m.type === 'msg' && ws.room) {
      const now = Date.now();
      if (now - ws.last < 800) return;
      ws.last = now;
      const t = clean(m.t, 300).trim();
      if (!t) return;
      const o = { type: 'msg', n: clean(m.n, 20).trim() || 'Guest', t, ts: now };
      const list = rooms[ws.room] = rooms[ws.room] || [];
      list.push(o); if (list.length > KEEP) list.shift();
      dirty = true;
      const out = JSON.stringify(o);
      wss.clients.forEach(c => { if (c.readyState === 1 && c.room === ws.room) c.send(out); });
    } else if (m.type === 'clear' && ADMIN && m.token === ADMIN) {
      rooms[roomName(m.room)] = []; dirty = true;
    }
  });
});
srv.listen(PORT, () => console.log('Listening on ' + PORT));
