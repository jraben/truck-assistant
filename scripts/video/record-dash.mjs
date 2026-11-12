// Records the Drive screen while the DEMO truck drives the scene's leg (Home →
// Tempe), with features shown at set miles along the route, then parks and fast
// charges on the Charge screen. Every screenshot is saved with the truck's
// position (miles along the route) so compose.mjs can line it up with the globe.
//   DEMO=1 SIM=1 SIM_SPEEDUP=3 PORT=8096 DATA_DIR=<fresh dir> node brain/src/index.ts   (first, in another shell)
//   node scripts/video/record-dash.mjs scene.gevbundle.json
// Only against a demo brain (it refuses a real one): it changes the sim, the
// battery level, the drivers' theme and the pickup. Out: $WORK/dash-frames/.
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadScene, snapper } from './route.mjs';

const B = process.env.DASH_URL ?? 'http://localhost:8096';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WORK = resolve(process.env.WORK ?? 'video-work'), OUT = join(WORK, 'dash-frames');
if (!process.argv[2]) { console.error('usage: node scripts/video/record-dash.mjs scene.gevbundle.json'); process.exit(2); }
const scene = loadScene(resolve(process.argv[2]));
const total = scene.cum.at(-1);
const post = (path, body, method = 'POST') => fetch(B + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json().catch(() => ({})));
const sim = () => fetch(B + '/api/sim').then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const s0 = await sim().catch(() => null);
if (!s0?.demo) { console.error(`${B} is not a demo truck (DEMO=1 SIM=1); refusing to change it.`); process.exit(1); }
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });

// Clean start: parked at Home, no pickup, no low tire, battery at 64%, day theme (the globe is daylight).
await post('/api/sim', { mode: 'manual', gear: 'park', ignition: false, lowTire: null });
for (let i = 0; i < 30 && (await sim()).speedMph > 1; i++) await wait(1000);
await fetch(B + '/api/pickup', { method: 'DELETE' }).catch(() => {});
await post('/api/sim/unplug');
await post('/api/sim/jump', { leg: 0 });
await post('/api/sim/soc', { value: 64 });
const settings = await fetch(B + '/api/settings').then((r) => r.json());
for (const d of settings.drivers ?? []) await post(`/api/drivers/${encodeURIComponent(d.id)}`, { theme: { active: 'day', auto: { ...d.theme.auto, enabled: false } } }, 'PUT');

const b = await chromium.launch({ executablePath: CHROME });
const p = await (await b.newContext({ viewport: { width: 1920, height: 720 } })).newPage();
await p.clock.setFixedTime(new Date('2026-11-10T10:20:00')); // the dash clock matches the daylight globe
await p.goto(B + '/#drive');
await wait(7000);
const okAll = () => p.evaluate(() => { for (const x of document.querySelectorAll('button')) if (['OK', 'Later', 'Dismiss'].includes((x.innerText || '').trim())) x.click(); });
await okAll();
const view = (h) => p.evaluate((x) => { location.hash = x; }, h);

// What happens where, in miles along the route. compose.mjs captions the same miles.
const steps = [
  [0.8, async () => {
    await okAll(); await view('media'); await wait(900);
    await p.click('button.mtile:has-text("Desert Jazz")', { timeout: 3000 }).then(() => console.log('radio tap ok'), (e) => console.log('radio tap failed', e.message));
    await wait(1500);
    await p.click('button:has-text("Play anyway")', { timeout: 3000 }).then(() => console.log('play anyway ok'), () => console.log('no data prompt'));
  }],
  [1.5, () => view('drive')],
  [2.2, async () => { await post('/api/sim/flight', { flight: 'AA 1234', who: 'Sam' }); await wait(600); await view('roadtrip'); }],
  [3.0, () => view('drive')],
  [3.6, () => view('traffic')],
  [4.3, () => view('drive')],
];
await post('/api/sim', { mode: 'auto' });
const snap = snapper(scene);
const meta = [];
let n = 0, started = false, d = 0;
const shot = async (s, tag) => {
  const f = `${String(n++).padStart(5, '0')}.jpg`;
  await p.screenshot({ path: join(OUT, f), type: 'jpeg', quality: 90 });
  meta.push({ f, d, mph: s.speedMph, tag, at: Date.now() });
};
const t0 = Date.now();
while (Date.now() - t0 < 15 * 60 * 1000) {
  const s = await sim();
  if (s.speedMph > 1) started = true;
  d = snap(s.pos).miles;
  while (steps.length && d >= steps[0][0]) { const [m, fn] = steps.shift(); console.log('step at', m, 'mi'); await fn(); }
  await shot(s, 'drive');
  if (n % 100 === 0) { writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta)); console.log(n, d.toFixed(2), 'mi', s.speedMph, 'mph'); }
  if (started && d > total - 0.02 && s.speedMph < 1) break;
  if (s.leg !== 0) break;
}
// Arrived: park, plug into a fast charger, the gate code card, then the Charge screen.
await post('/api/sim', { mode: 'manual', gear: 'park', ignition: false });
await wait(1500);
await post('/api/sim/charge', { kind: 'fast', target: 90 });
const g0 = Date.now();
while (Date.now() - g0 < 3500) await shot(await sim(), 'arrive');
await p.evaluate(() => { for (const x of document.querySelectorAll('button')) if ((x.innerText || '').trim() === 'Dismiss') x.click(); });
await view('charge');
const c0 = Date.now();
while (Date.now() - c0 < 30000) {
  const s = await sim();
  await shot(s, 'charge');
  if (!s.charging && Date.now() - c0 > 4000) break;
}
for (let k = 0; k < 25; k++) await shot(await sim(), 'after');
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta));
console.log('done', n, 'frames,', meta.filter((m) => m.tag !== 'drive').length, 'after arriving');
await b.close();
