// The truck being built, as an exploded view that comes together: bare frame, battery
// and drive unit, body shell bonded, the coat of paint, then general assembly with
// several stations at once, the build's accessories, and the lamps coming on.
// Same drawing and colours as TruckArt (the owner's build from Settings › Truck).
// Shown at startup (StartupAssembly) and while an update runs (VersionBar UpdateScreen).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { TruckLook } from '../../../brain/src/drive/types.ts';

const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${100 - pct}%, ${b})`;
const INK = '#1c1d1f';
const AMBER = '#f0a21a';
/** Body-in-white: the bare shell before its coat. */
const BIW = '#9da3aa';
const RA = 102, FA = 352, WY = 153;

/** Seconds: the build is done at BUILT, the clip ends (or loops) at END. */
export const BUILT = 12.2;
export const END = 14;

/** Each part: when it starts moving in (s), how long it takes, and where it comes from (exploded offset, spin for wheels). */
export const PARTS = {
  ground: { at: 0, dur: 0.6, dx: 0, dy: 0 },
  rails: { at: 0.2, dur: 1.0, dx: 0, dy: 0 },
  xmem: { at: 0.8, dur: 0.6, dx: 0, dy: -30 },
  axles: { at: 1.3, dur: 0.7, dx: 0, dy: 40 },
  springs: { at: 1.7, dur: 0.5, dx: 0, dy: -40 },
  battery: { at: 2.3, dur: 0.9, dx: 0, dy: 70 },
  motor: { at: 2.8, dur: 0.7, dx: 0, dy: 60 },
  body: { at: 3.8, dur: 1.1, dx: 0, dy: -120 },
  seams: { at: 5.0, dur: 0.3, dx: 0, dy: 0 },
  glass: { at: 7.9, dur: 0.7, dx: 40, dy: -60 },
  roof: { at: 8.1, dur: 0.7, dx: 0, dy: -70 },
  flareR: { at: 8.3, dur: 0.7, dx: -70, dy: 0 },
  flareF: { at: 8.3, dur: 0.7, dx: 70, dy: 0 },
  door: { at: 8.7, dur: 0.6, dx: 30, dy: 0 },
  lamp: { at: 9.0, dur: 0.7, dx: 60, dy: -10 },
  tail: { at: 9.0, dur: 0.6, dx: -50, dy: 0 },
  bumperF: { at: 9.2, dur: 0.6, dx: 60, dy: 0 },
  bumperR: { at: 9.2, dur: 0.6, dx: -60, dy: 0 },
  wheelR: { at: 9.6, dur: 0.9, dx: -160, dy: 0, rot: -300 },
  wheelF: { at: 9.6, dur: 0.9, dx: 160, dy: 0, rot: 300 },
  tonneau: { at: 10.7, dur: 0.7, dx: 0, dy: -60 },
  bedLights: { at: 11.0, dur: 0.5, dx: 0, dy: 0 },
  hitch: { at: 11.1, dur: 0.6, dx: -50, dy: 0 },
} as const;
export type PartId = keyof typeof PARTS;

export const PHASES = [
  { at: 0, title: 'Frame', sub: 'Ladder rails, crossmembers, axles' },
  { at: 2.2, title: 'Battery & drive', sub: 'Pack under the floor, rear drive unit' },
  { at: 3.7, title: 'Body & bonding', sub: 'Body shell set on the frame and bonded' },
  { at: 5.6, title: 'Coating', sub: 'Paint in your build’s body colour' },
  { at: 7.8, title: 'General assembly', sub: 'Glass, roof wrap, flares, lamps, bumpers, wheels' },
  { at: 10.6, title: 'Accessories', sub: 'Tonneau, bed lights, hitch' },
  { at: 11.9, title: 'Ready', sub: 'Your truck, as built in Settings' },
] as const;

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
/** Overshoots a touch and settles: a part clicking into place. */
const settle = (x: number) => { const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

export type Pose = { opacity: number; dx: number; dy: number; rot: number };
/** Where a part is at time t (s). Pure. */
export function partPose(id: PartId, t: number): Pose {
  const p = PARTS[id];
  const rot = 'rot' in p ? p.rot : 0;
  const k = clamp((t - p.at) / p.dur);
  const e = rot ? easeOut(k) : settle(k);
  return { opacity: k <= 0 ? 0 : Math.min(1, k * 3), dx: p.dx * (1 - e) || 0, dy: p.dy * (1 - e) || 0, rot: rot * (1 - e) || 0 };
}
/** Which phase is running at t. Pure. */
export const phaseAt = (t: number) => PHASES.reduce((i, p, j) => (t >= p.at ? j : i), 0);
/** How far the coat of paint has swept, in drawing units (0 = none, 450 = all). Pure. */
export const coatAt = (t: number) => Math.max(0, -10 + 450 * easeOut(clamp((t - 5.7) / 1.7)));
/** The lamps and bed lights coming on at the end, 0-1. Pure. */
export const lightsAt = (t: number) => clamp((t - 12.1) / 0.6);

const arch = (x: number) => `L${x + 46} 160 L${x + 40} 118 Q${x + 37} 112 ${x + 31} 112 L${x - 31} 112 Q${x - 37} 112 ${x - 40} 118 L${x - 46} 160`;
const BODY = `M20 90 L214 90 L216 40 Q217 31 226 30 L288 30 Q296 30 300 36 L338 90 L404 96 Q418 98 420 106 L422 150 Q422 160 412 160 ${arch(FA)} L${RA + 46} 160 ${arch(RA)} L24 160 Q18 160 18 152 L18 94 Q18 90 20 90 Z`;
const RAILS = 'M24 128 L62 128 Q70 128 74 120 L130 120 Q136 120 140 128 L316 128 Q322 128 326 120 L380 120 Q386 120 390 128 L414 128 L414 138 L390 138 Q384 138 380 130 L326 130 Q320 130 316 138 L140 138 Q134 138 130 130 L74 130 Q68 138 62 138 L24 138 Z';
const flare = (x: number) => `M${x - 50} 162 L${x - 44} 116 Q${x - 41} 107 ${x - 33} 107 L${x + 33} 107 Q${x + 41} 107 ${x + 44} 116 L${x + 50} 162 L${x + 42} 162 L${x + 37} 119 Q${x + 35} 114 ${x + 30} 114 L${x - 30} 114 Q${x - 35} 114 ${x - 37} 119 L${x - 42} 162 Z`;
const spring = (x: number) => { let d = `M${x - 6} 122`; for (let i = 0; i < 6; i++) d += ` L${x + (i % 2 ? -6 : 6)} ${124 + i * 3}`; return d; };
const SEAMS = [[226, 92], [226, 150], [214, 90], [300, 36], [338, 90], [150, 160], [300, 160], [20, 120]] as const;

function Wheel({ cx, t }: { cx: number; t: TruckLook }) {
  const steel = mix(INK, '#ffffff', 6);
  return (
    <>
      <circle cx={cx} cy={WY} r="33" fill={mix(INK, t.colors.trim, 15)} />
      <circle cx={cx} cy={WY} r="29" fill="none" stroke={mix(INK, '#ffffff', 14)} stroke-width="1.5" />
      <circle cx={cx} cy={WY} r="22" fill={steel} />
      <circle cx={cx} cy={WY} r="18.5" fill="none" stroke={t.colors.wheelDecal} stroke-width="3.6" />
      {[0, 60, 120, 180, 240, 300].map((a) => {
        const r = (a * Math.PI) / 180, x = cx + 12 * Math.cos(r), y = WY + 12 * Math.sin(r);
        return <ellipse cx={x} cy={y} rx="2.4" ry="3.4" transform={`rotate(${a + 90} ${x} ${y})`} fill={INK} />;
      })}
      <circle cx={cx} cy={WY} r="6.5" fill={mix(steel, '#ffffff', 10)} />
      <circle cx={cx} cy={WY} r="2.4" fill={INK} />
    </>
  );
}

/** The drawing at time `at` (s). */
export function AssemblyFrame({ t, at, id = 'asm' }: { t: TruckLook; at: number; id?: string }) {
  const c = t.colors;
  const part = (pid: PartId, children: preact.ComponentChildren) => {
    const p = partPose(pid, at);
    if (p.opacity <= 0) return null;
    const spin = p.rot ? ` rotate(${p.rot} ${pid === 'wheelR' ? RA : FA} ${WY})` : '';
    return <g opacity={p.opacity} transform={`translate(${p.dx} ${p.dy})${spin}`}>{children}</g>;
  };
  const coat = coatAt(at);
  const lit = lightsAt(at);
  const spraying = coat > 0 && coat < 440;
  return (
    <svg class="assembly-art" viewBox="-20 -30 480 236" role="img" aria-label="Your truck being assembled">
      <defs>
        <linearGradient id={`${id}-paint`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={mix(c.body, c.roof, t.finish === 'gloss' ? 26 : t.finish === 'satin' ? 14 : 5)} />
          <stop offset=".45" stop-color={c.body} /><stop offset="1" stop-color={mix(c.body, INK, 22)} />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color={mix(INK, c.roof, 30)} /><stop offset=".6" stop-color={INK} /></linearGradient>
        <linearGradient id={`${id}-lamp`} x1="0" y1="0" x2="1" y2="1">
          {c.lampPlates === 'synthwave'
            ? <><stop offset="0" stop-color={mix(INK, '#ffffff', 12)} /><stop offset="1" stop-color={INK} /></>
            : <><stop offset="0" stop-color={c.lampPlates} /><stop offset="1" stop-color={mix(c.lampPlates, INK, 25)} /></>}
        </linearGradient>
        <radialGradient id={`${id}-glow`}><stop offset="0" stop-color={AMBER} stop-opacity=".9" /><stop offset="1" stop-color={AMBER} stop-opacity="0" /></radialGradient>
        <clipPath id={`${id}-coat`}><rect x="-20" y="0" width={coat + 20} height="200" /></clipPath>
      </defs>
      {part('ground', <><ellipse cx="220" cy="187" rx="215" ry="5" fill="#000" opacity=".4" /><path d="M-10 187 L450 187" stroke="var(--hairline, #2a2f36)" /></>)}
      {/* 1 · frame */}
      {part('rails', <path d={RAILS} fill="#4a4f56" stroke="#6b727b" stroke-width="1" />)}
      {part('xmem', [40, 170, 230, 290, 400].map((x) => <rect x={x - 4} y="129" width="8" height="8" rx="1.5" fill="#6b727b" />))}
      {part('axles', <>{[RA, FA].map((x) => <><rect x={x - 36} y={WY - 3} width="72" height="6" rx="3" fill="#5a6068" /><circle cx={x} cy={WY} r="9" fill="#7d848c" /></>)}</>)}
      {part('springs', <path d={spring(RA) + ' ' + spring(FA)} stroke="#7d848c" stroke-width="2" fill="none" />)}
      {/* 2 · battery and drive unit */}
      {part('battery', <>
        <rect x="146" y="139" width="162" height="17" rx="3" fill="#2b3a4a" stroke="#4d6a86" />
        <path d="M160 147.5 L294 147.5" stroke="#4d6a86" stroke-dasharray="10 6" />
      </>)}
      {part('motor', <><rect x={RA + 14} y="139" width="28" height="15" rx="3" fill="#3d4650" stroke="#6b727b" /><circle cx={RA + 28} cy="146.5" r="4" fill="#6b727b" /></>)}
      {/* 3 · body shell, bonded, then its coat */}
      {part('body', <><path d={BODY} fill={BIW} /><path d={BODY} fill={`url(#${id}-paint)`} clip-path={`url(#${id}-coat)`} /></>)}
      {part('seams', <path d="M226 90 L226 152 M334 92 L334 150 M24 98 L210 98" stroke={INK} stroke-opacity=".45" stroke-width="1.3" fill="none" />)}
      {at > 4.9 && at < 5.7 && SEAMS.map(([x, y], i) => {
        const f = (at * 9 + i * 0.37) % 1;
        return f < 0.55 ? <g><circle cx={x} cy={y} r={1.5 + 3 * f} fill="#fff6d0" opacity={1 - f / 0.55} /><circle cx={x} cy={y} r={6 + 10 * f} fill="none" stroke="#9fd0ff" opacity={0.5 - f} /></g> : null;
      })}
      {spraying && <rect x={coat} y="20" width="3" height="150" fill={c.body} opacity=".55" />}
      {/* 4 · general assembly */}
      {part('glass', <><path d="M228 42 L284 42 Q290 42 293 47 L322 86 L228 86 Z" fill={`url(#${id}-glass)`} /><path d="M236 46 L252 46 L240 70 Z" fill={c.roof} opacity=".18" /></>)}
      {t.roofWrap && part('roof', <path d="M216.5 38 Q217 31 226 30 L288 30 Q296 30 300 36 L303 40 L216.4 41 Z" fill={c.roof} />)}
      {part('flareR', <path d={flare(RA)} fill={c.trim} />)}
      {part('flareF', <path d={flare(FA)} fill={c.trim} />)}
      {part('door', <>
        <rect x="236" y="98" width="16" height="4" rx="2" fill={mix(c.body, INK, 45)} />
        <path d="M318 84 L330 80 L334 92 L322 94 Z" fill={c.trim} />
        {c.logo !== 'none' && <text x="266" y="140" text-anchor="middle" class="truck-logo sm" fill={c.logo}>SLATE</text>}
      </>)}
      {part('lamp', <>
        <path d="M409 100 Q418 101 419 108 L420 128 L408 128 Z" fill={`url(#${id}-lamp)`} />
        <circle cx="414" cy="114" r="5.2" fill={c.lampPlates === 'synthwave' ? AMBER : '#f4f1e6'} stroke={INK} stroke-width="1" />
      </>)}
      {part('tail', <rect x="15" y="96" width="5" height="26" rx="1.5" fill="var(--bad, #d8362f)" />)}
      {part('bumperF', <path d="M402 136 L424 136 Q428 136 428 141 L428 156 Q428 162 422 162 L398 162 Z" fill={c.trim} />)}
      {part('bumperR', <path d="M12 140 L30 140 L30 162 L16 162 Q12 162 12 158 Z" fill={c.trim} />)}
      {part('wheelR', <Wheel cx={RA} t={t} />)}
      {part('wheelF', <Wheel cx={FA} t={t} />)}
      {/* the build's accessories */}
      {t.accessories.tonneau === 'nexus-flip' && part('tonneau', <>
        <path d="M19 84 L214 84 L214 91 L19 91 Z" fill={mix(INK, c.trim, 20)} />
        <path d="M84 84 L84 91 M149 84 L149 91" stroke={mix(c.trim, INK, 10)} stroke-width="1" />
      </>)}
      {t.accessories.bedLights && part('bedLights', <path d="M28 94 L208 94" stroke={lit > 0 ? '#ffc04d' : mix(c.trim, INK, 40)} stroke-width={lit > 0 ? 2.6 : 1.6} stroke-linecap="round" />)}
      {t.accessories.hitch && part('hitch', <><rect x="2" y="152" width="14" height="9" rx="1" fill={mix(c.trim, INK, 45)} /><circle cx="7" cy="156.5" r="1.6" fill={c.roof} /></>)}
      {lit > 0 && <circle cx="430" cy="114" r={40 * lit * (0.92 + 0.08 * Math.sin(at * 6))} fill={`url(#${id}-glow)`} />}
    </svg>
  );
}

const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/**
 * The clip, played: once (onDone when it has ended) or on a loop (the update screen).
 * With reduced motion it shows the finished truck and ends after a moment.
 */
export function Assembly({ t, loop = false, still = false, captions = false, onDone, id }: {
  t: TruckLook; loop?: boolean; captions?: boolean; onDone?: () => void; id?: string;
  /** Just the finished truck (the update is done). */
  still?: boolean;
}) {
  const [at, setAt] = useState(() => (reducedMotion() || still ? END : 0));
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (still) { setAt(END); return; }
    if (reducedMotion()) { const h = setTimeout(() => done.current?.(), 1500); return () => clearTimeout(h); }
    let raf = 0, t0: number | null = null, ended = false;
    const tick = (now: number) => {
      t0 ??= now;
      let s = (now - t0) / 1000;
      if (loop) s %= END + 1.2; // hold the finished truck a moment, then build it again
      setAt(Math.min(s, END));
      if (!loop && s >= END && !ended) { ended = true; done.current?.(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loop, still]);
  const ph = PHASES[phaseAt(at)];
  return (
    <div class="assembly">
      <AssemblyFrame t={t} at={at} id={id} />
      {captions && (
        <div class="asm-cap" aria-live="off">
          <b>{ph.title}</b><span>{ph.sub}</span>
          <div class="asm-bar" aria-hidden="true"><i style={{ width: `${(100 * clamp(at / BUILT)).toFixed(1)}%` }} /></div>
        </div>
      )}
    </div>
  );
}
