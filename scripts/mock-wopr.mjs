// A stand-in WOPR for desk testing of the truck's WOPR features, so nothing
// real is called (no model, speech or Graph spend). Same routes and shapes as
// WOPR: /api/status, /api/stt, /api/WOPR (streamed, with [[WOPR_SEARCH]] and
// [[WOPR_KEEPALIVE]] markers and an action block), /api/tts, /api/where,
// /api/calendar, /api/mobile/context. Basic auth jeff:test.
//   node scripts/mock-wopr.mjs [port]     (default 18190)
// Then on /settings → WOPR: http://localhost:18190, jeff, test.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 18190);
const AUTH = 'Basic ' + Buffer.from('jeff:test').toString('base64');

/** Half a second of a 440 Hz tone, as a WAV. */
function tone(ms = 500) {
  const rate = 16000, n = Math.round(rate * ms / 1000), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 6000 * Math.min(1, (n - i) / 800)), 44 + i * 2);
  return b;
}

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://x');
    console.log(`[mock-wopr] ${req.method} ${url.pathname}`);
    if (url.pathname === '/api/status') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"app":"wopr","version":"mock"}');
    if (req.headers.authorization !== AUTH) return res.writeHead(401, { 'www-authenticate': 'Basic realm="WOPR"' }).end();
    const json = (o) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    switch (url.pathname) {
      case '/api/stt': return json({ text: 'What is on my calendar this afternoon?' });
      case '/api/tts': return res.writeHead(200, { 'content-type': 'audio/wav' }).end(tone());
      case '/api/where': return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Acme Storage — Gate Code 5150#, Alarm 2468 · 18m away');
      case '/api/mobile/context': return json({ context: '[CALENDAR — next 7 days]\n  Thu · 2:00 PM · Pickup Barney  [id:AAA]\n\n[OPEN TASKS]\n  [id:1] Buy cabin air filter' });
      case '/api/calendar': {
        const t = Date.now();
        return json({ connected: true, events: [
          { id: 'a', title: 'Pickup Barney', start: new Date(t + 50 * 60_000).toISOString().replace('Z', '0000Z'), end: new Date(t + 80 * 60_000).toISOString(), allDay: false, location: 'Scottsdale Airport, 15000 N Airport Dr, Scottsdale, AZ' },
          { id: 'b', title: 'Bentley Scottsdale Polo Championships', start: new Date(t + 20 * 3600_000).toISOString(), end: new Date(t + 26 * 3600_000).toISOString(), allDay: false, location: 'WestWorld of Scottsdale' },
        ] });
      }
      case '/api/WOPR': {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        const parts = ['You have one thing', ' this afternoon. [[WOPR_SE', 'ARCH]]', 'Pickup Barney at two, at Scottsdale Airport', '. [[WOPR_KEEPALIVE]]', '{"action":"taskSync","op":"create","task":{"title":"x"}}', ' Traffic on the 101 is light, so leave by one thirty.'];
        let i = 0;
        const t = setInterval(() => { if (i < parts.length) res.write(parts[i++]); else { clearInterval(t); res.end(); } }, 250);
        return;
      }
      default: return res.writeHead(404).end();
    }
  });
}).listen(port, () => console.log(`[mock-wopr] http://localhost:${port} (jeff / test)`));
