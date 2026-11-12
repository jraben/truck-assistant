// Puts the recorded dash over the globe clip and writes the finished video.
//   node scripts/video/compose.mjs scene.gevbundle.json [out.mp4]
// Part A (30 s): the globe, with the dash in the top-right corner showing the frame
// taken where the truck was at the same spot on the route. Part B: the globe's last
// frame held while the dash, now large, shows arrival and fast charging (charging at
// 2.5x). A caption names each feature. Reads $WORK/globe.mp4 (globe-chase.mjs) and
// $WORK/dash-frames (record-dash.mjs); writes out.mp4 and a 720p copy beside it.
// Keep the bottom corners clear: Google's and the route's attribution sit there.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FPS, FRAMES, globeMiles, loadScene } from './route.mjs';

if (!process.argv[2]) { console.error('usage: node scripts/video/compose.mjs scene.gevbundle.json [out.mp4]'); process.exit(2); }
const WORK = resolve(process.env.WORK ?? 'video-work');
const out = resolve(process.argv[3] ?? join(WORK, 'truck-gods-eye-dash.mp4'));
const globe = globeMiles(loadScene(resolve(process.argv[2])));
const meta = JSON.parse(readFileSync(join(WORK, 'dash-frames', 'meta.json'), 'utf8'));
const ff = (args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit', cwd: WORK }); if (r.status !== 0) { console.error('ffmpeg failed'); process.exit(1); } };

// Part A: per globe frame, the last dash frame taken at or before that spot.
const drive = meta.filter((m) => m.tag === 'drive');
const pick = []; let j = 0;
for (const g of globe) { while (j + 1 < drive.length && drive[j + 1].d <= g) j++; pick.push(drive[j].f); }
writeFileSync(join(WORK, 'a-dash.txt'), pick.map((f) => `file 'dash-frames/${f}'\nduration ${1 / FPS}`).join('\n') + `\nfile 'dash-frames/${pick.at(-1)}'\n`);
// Part B: arrival at real pace, charging sped up.
const SPEED = { arrive: 1, charge: 2.5, after: 1 };
const tail = meta.filter((m) => m.tag !== 'drive');
const dur = (i) => (i + 1 < tail.length ? (tail[i + 1].at - tail[i].at) / 1000 / SPEED[tail[i].tag] : 1.5);
writeFileSync(join(WORK, 'b-dash.txt'), tail.map((m, i) => `file 'dash-frames/${m.f}'\nduration ${Math.max(0.02, dur(i)).toFixed(3)}`).join('\n') + `\nfile 'dash-frames/${tail.at(-1).f}'\n`);
const bDur = tail.reduce((a, _, i) => a + dur(i), 0);
const arriveDur = tail.filter((m) => m.tag === 'arrive').reduce((a, m, i, arr) => a + (i + 1 < arr.length ? (arr[i + 1].at - m.at) / 1000 : 0), 0);

// Captions at the same miles record-dash.mjs acts on.
const tAt = (mi) => { const f = globe.findIndex((g) => g >= mi); return (f < 0 ? FRAMES : f) / FPS; };
const capsA = [
  [0, tAt(0.8), 'Drive screen: speed, range, battery, music'],
  [tAt(0.8), tAt(1.5), 'Change the radio: tap a saved FM station'],
  [tAt(1.5), tAt(2.2), 'Now playing that station, with HD song info'],
  [tAt(2.2), tAt(3.0), 'Airport pickup: follows the flight, when to leave'],
  [tAt(3.0), tAt(3.6), 'Range and battery update as you drive'],
  [tAt(3.6), tAt(4.3), 'Road ahead: crashes, roadwork, speed cameras'],
  [tAt(4.3), FRAMES / FPS, 'Payoff from gas savings, miles since charge'],
];
const capsB = [
  [0, arriveDur, 'Arrived: the gate code comes up on its own'],
  [arriveDur, bDur + 1, 'Fast charging: level climbs, then it asks the cost'],
];
// drawtext needs a font file; ffmpeg's filter escaping of "C:/…" is fragile, so it is copied in.
const font = ['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'].find((f) => existsSync(f));
if (!font) { console.error('no font found for captions'); process.exit(1); }
copyFileSync(font, join(WORK, 'caption.ttf'));
const esc = (s) => s.replace(/'/g, '').replace(/: /g, ' — ');
const draw = (caps) => caps.map(([a, b, t]) => `drawtext=fontfile='caption.ttf':text='${esc(t)}':x=32:y=32:fontsize=30:fontcolor=white:box=1:boxcolor=0x0d1114@0.78:boxborderw=14:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`).join(',');
writeFileSync(join(WORK, 'a-filter.txt'), `[1]fps=30,scale=1056:-2,pad=iw+6:ih+6:3:3:color=0x4fc3d9[d];[0][d]overlay=W-w-24:24:shortest=1,${draw(capsA)},format=yuv420p[v]`);
writeFileSync(join(WORK, 'b-filter.txt'), `[1]fps=30,scale=1680:-2,pad=iw+8:ih+8:4:4:color=0x4fc3d9[d];[0][d]overlay=(W-w)/2:150:shortest=1,${draw(capsB)},format=yuv420p[v]`);

ff(['-sseof', '-0.05', '-i', 'globe.mp4', '-frames:v', '1', 'globe-last.png']);
ff(['-i', 'globe.mp4', '-f', 'concat', '-safe', '0', '-i', 'a-dash.txt', '-/filter_complex', 'a-filter.txt', '-map', '[v]', '-c:v', 'libx264', '-crf', '22', '-r', '30', 'partA.mp4']);
ff(['-loop', '1', '-framerate', '30', '-i', 'globe-last.png', '-f', 'concat', '-safe', '0', '-i', 'b-dash.txt', '-/filter_complex', 'b-filter.txt', '-map', '[v]', '-c:v', 'libx264', '-crf', '22', '-r', '30', 'partB.mp4']);
ff(['-i', 'partA.mp4', '-i', 'partB.mp4', '-filter_complex', '[0][1]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
ff(['-i', out, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-crf', '25', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out.replace(/\.mp4$/, '-720p.mp4')]);
console.log(`wrote ${out} (${(FRAMES / FPS + bDur).toFixed(1)} s) and its 720p copy`);
