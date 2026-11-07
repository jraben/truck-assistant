// Makes ui/public/carplay-sim/test.h264, the CarPlay simulator's clip
// (?carplaySim=1): 10 s of 1280x480 H.264 Annex-B at 30 fps, test pattern +
// a moving block + a running timestamp. Needs ffmpeg on PATH.
//   node scripts/make-carplay-sim-clip.mjs
// Encoded the way the dongle sends CarPlay: no B-frames, a keyframe every
// second, an AUD before each frame (the simulator splits frames on it).
// Also writes test.mp4, the same frames remuxed, for browsers without WebCodecs
// (an http:// LAN origin isn't a secure context, so VideoDecoder is missing).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'ui/public/carplay-sim/test.h264');
mkdirSync(dirname(out), { recursive: true });

// drawtext needs a font file where fontconfig isn't set up (Windows ffmpeg builds).
const font = ['C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/System/Library/Fonts/Menlo.ttc']
  .find((f) => existsSync(f));
const fontArg = font ? `fontfile='${font.replace(/:/g, '\\:')}':` : '';

const W = 1280, H = 480, FPS = 30, SECONDS = 10;
const filter = [
  `testsrc2=size=${W}x${H}:rate=${FPS}`,
  // A block sweeping across: smooth motion shows dropped or stuttering frames.
  `drawbox=x='mod(t*320\\,${W}-120)':y=${H / 2 - 60}:w=120:h=120:color=0x4fc3d9@1:t=fill`,
  `drawtext=${fontArg}text='SLATE CARPLAY SIM  %{pts\\:hms}  frame %{n}':x=24:y=24:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8`,
].join(',');

const args = [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', filter, '-t', String(SECONDS),
  '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
  '-tune', 'zerolatency', '-bf', '0', '-g', String(FPS), '-keyint_min', String(FPS), '-sc_threshold', '0',
  '-b:v', '1200k', '-maxrate', '1500k', '-bufsize', '1500k',
  '-bsf:v', 'h264_metadata=aud=insert',
  '-f', 'h264', out,
];
const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (r.status !== 0) { console.error('ffmpeg failed', r.error ?? r.status); process.exitCode = 1; }
else {
  console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} KiB`);
  const mp4 = out.replace(/\.h264$/, '.mp4');
  const m = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(FPS), '-i', out,
    '-c:v', 'copy', '-bsf:v', 'h264_metadata=aud=remove', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  if (m.status !== 0) { console.error('ffmpeg (mp4) failed', m.error ?? m.status); process.exitCode = 1; }
  else console.log(`${mp4}: ${(statSync(mp4).size / 1024).toFixed(0)} KiB`);
}
