// Renders the chase scene on God's Eye View frame by frame, then encodes it.
//   GEV_URL=https://your-gods-eye-host node scripts/video/globe-chase.mjs scene.gevbundle.json
// Real Chrome (CHROME=path to override), a throwaway profile, ?embed=1, every data
// layer off. The camera follows the scene's chase shots, linear between them, 3 s a
// leg; each frame is captured once the 3D tiles in view have loaded, so it plays
// smoothly at 30 fps however slow the machine. The truck is a yellow point snapped
// onto the route line. God's Eye itself is not changed: the viewer is reached by
// noting `this` on its first render, in this browser only.
// Out: $WORK/globe-frames/*.jpg and $WORK/globe.mp4 (WORK defaults to ./video-work).
// Playwright's own Chromium draws the globe grey on some GPUs; use real Chrome.
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FPS, FRAMES, aheadOf, cameraAt, loadScene, snapper } from './route.mjs';

const bundlePath = resolve(process.argv[2] ?? '');
const GEV = process.env.GEV_URL;
if (!process.argv[2] || !GEV) { console.error('usage: GEV_URL=https://… node scripts/video/globe-chase.mjs scene.gevbundle.json'); process.exit(2); }
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WORK = resolve(process.env.WORK ?? 'video-work'), OUT = join(WORK, 'globe-frames');
const N = Number(process.env.FRAMES ?? FRAMES);
const ALT_M = 380; // the chase camera's height above the truck
const scene = loadScene(bundlePath);
const PROF = join(tmpdir(), 'gev-chase-profile');
rmSync(PROF, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROF, { executablePath: CHROME, headless: false, viewport: { width: 1920, height: 1080 }, args: ['--window-size=1940,1150', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const p = ctx.pages()[0];
await p.addInitScript(() => {
  const iv = setInterval(() => {
    const C = window.__CESIUM__;
    if (!C?.Scene || C.Scene.prototype.__recHooked) return;
    const r = C.Scene.prototype.render;
    C.Scene.prototype.render = function (...a) { if (!window.__recScene && this.globe) window.__recScene = this; return r.apply(this, a); };
    C.Scene.prototype.__recHooked = true;
    clearInterval(iv);
  }, 10);
});
await p.goto(new URL('/?embed=1', GEV).href, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(15000);
const c0 = scene.shots[0];
await p.evaluate((c) => postMessage({ type: 'gev:view', id: 'rec', view: { camera: { lat: c.lat, lon: c.lon, altitude_m: c.alt, heading_deg: c.heading, pitch_deg: c.pitch }, layers: [] } }, '*'), c0);
await p.waitForTimeout(6000);
// The agent's SEND bar is not part of the picture.
await p.evaluate(() => { const send = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'SEND'); if (send?.parentElement) send.parentElement.style.setProperty('display', 'none', 'important'); });
await p.setInputFiles('#scene-import-file', bundlePath);
await p.waitForTimeout(2500);
console.log('import', await p.evaluate(() => { const b = [...document.querySelectorAll('dialog button, [role=dialog] button')].find((x) => /apply/i.test(x.innerText)); b?.click(); return !!b; }));
await p.waitForTimeout(3000);
// The route line is drawn when the scene is LOADed (not played).
console.log('load', await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^load$/i.test((x.innerText || '').trim())); b?.click(); return !!b; }));
await p.waitForTimeout(4000);
if (!(await p.evaluate(() => !!window.__recScene?.camera))) { console.error('could not reach the God\'s Eye viewer'); await ctx.close(); process.exit(1); }

await p.evaluate(() => {
  const C = window.__CESIUM__, sc = window.__recScene;
  const pts = sc.primitives.add(new C.PointPrimitiveCollection());
  window.__recTruck = pts.add({ position: C.Cartesian3.fromDegrees(0, 0, 0), pixelSize: 16, color: C.Color.fromCssColorString('#ffd166'), outlineColor: C.Color.WHITE, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY });
});

const snap = snapper(scene);
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  const cam = cameraAt(scene.shots, f);
  const truck = { ...snap(aheadOf(cam)), h: cam.alt - ALT_M + 6 };
  const waited = await p.evaluate(async ({ cam, truck }) => {
    const C = window.__CESIUM__, scene = window.__recScene;
    scene.camera.setView({ destination: C.Cartesian3.fromDegrees(cam.lon, cam.lat, cam.alt), orientation: { heading: C.Math.toRadians(cam.heading), pitch: C.Math.toRadians(cam.pitch), roll: 0 } });
    window.__recTruck.position = C.Cartesian3.fromDegrees(truck.lon, truck.lat, truck.h);
    const sets = []; for (let i = 0; i < scene.primitives.length; i++) { const x = scene.primitives.get(i); if (x && 'tilesLoaded' in x) sets.push(x); }
    const start = performance.now();
    await new Promise((res) => { const tick = () => { scene.requestRender?.(); if (performance.now() - start > 120 && sets.every((s) => s.tilesLoaded)) res(); else if (performance.now() - start > 6000) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return Math.round(performance.now() - start);
  }, { cam, truck });
  await p.screenshot({ path: join(OUT, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  if (f % 60 === 0) console.log(`frame ${f}/${N} (waited ${waited} ms for tiles), ${Math.round((Date.now() - t0) / 1000)} s in`);
}
await ctx.close();
const enc = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(OUT, '%05d.jpg'), '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(WORK, 'globe.mp4')], { stdio: 'inherit' });
process.exitCode = enc.status ?? 1;
console.log(enc.status === 0 ? `wrote ${join(WORK, 'globe.mp4')}` : 'ffmpeg failed');
