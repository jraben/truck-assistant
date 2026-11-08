// The power ring speedometer (docs/drive-v2.md §5): the speed in the middle of a ring
// whose arc shows power going out (clockwise from the top) and regen coming back
// (anticlockwise). Inside the ring sits a small scene that belongs to the theme:
// stars over the mesas at night, a sun and saguaros by day, gears for Toolbox Red, a
// radar for WOPR, and so on. Every scene draws with theme tokens only, so a theme's
// own colours repaint it; a theme of the owner's own gets the road. Scenes that
// move with the truck (road, grid, gears) run at the truck's speed and stop when it
// stops; calm mode and reduced motion stop them all (drive.css).
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { estimateDriveKw, motionSeconds, ringMotif, RING_OUT_KW, RING_REGEN_KW, type RingMotif } from './logic.ts';

/** themeId: draw this theme's scene instead of the page's (a preview of several themes at once). */
type Props = { mph: number | null; limit: number | null; over: boolean; why: string; sign: JSX.Element | null; themeId?: string };
let rings = 0;

const C = 200, R = 180, RS = 160;
const polar = (r: number, deg: number) => { const a = ((deg - 90) * Math.PI) / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)] as const; };
const arc = (r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/** data-theme on <html>, kept current when the theme changes (sunset, or the driver's pick). */
function useThemeId(): string | undefined {
  const [id, setId] = useState(() => document.documentElement.dataset.theme);
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => setId(el.dataset.theme));
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return id;
}

/** Estimated battery kW from the speed and how fast it changes, smoothed, re-read once a second. */
function useEstimatedKw(mph: number | null): number | null {
  const cur = useRef(mph);
  const last = useRef<{ mph: number; t: number; kw: number } | null>(null);
  const [kw, setKw] = useState<number | null>(null);
  cur.current = mph;
  useEffect(() => {
    const step = () => {
      const m = cur.current, now = performance.now(), p = last.current;
      if (m === null) { last.current = null; setKw(null); return; }
      if (p && now - p.t < 250) return;
      const dt = p ? (now - p.t) / 1000 : 0;
      const accel = p && dt < 5 ? ((m - p.mph) * 0.44704) / dt : 0;
      const raw = estimateDriveKw(m, accel);
      const k = p ? p.kw + 0.55 * (raw - p.kw) : raw;
      last.current = { mph: m, t: now, kw: k };
      setKw(Math.abs(k) < 0.5 ? 0 : k);
    };
    step();
    const id = window.setInterval(step, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { if (mph === null) { last.current = null; setKw(null); } }, [mph]);
  return kw;
}

// ---- the scenes ---------------------------------------------------------------------------
// Coordinates sit inside the face: a circle of radius 160 around (200, 200). The number
// covers the middle, so skies go above y 140 and the ground below y 296.

const MESA = 'M30 318 L30 306 L84 306 L96 290 L142 290 L154 306 L238 306 L250 284 L300 284 L312 306 L370 306 L370 372 L30 372Z';
const Saguaro = ({ x, base, h }: { x: number; base: number; h: number }) => (
  <path class="s-l" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"
    d={`M${x} ${base} V${base - h} M${x} ${base - h * 0.45} H${x - 10} V${base - h * 0.8} M${x} ${base - h * 0.6} H${x + 10} V${base - h * 0.95}`} />
);
const at = (i: number, n: number) => ({ animationDelay: `calc(var(--mv) * ${(-i / n).toFixed(3)})` });
const late = (s: number) => ({ animationDelay: `${-s}s` });

function gear(cx: number, cy: number, r: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n, w = 360 / n;
    for (const [rad, da] of [[r - 9, -w * 0.5], [r, -w * 0.22], [r, w * 0.22], [r - 9, w * 0.5]] as const) {
      const t = ((a + da - 90) * Math.PI) / 180;
      pts.push(`${(cx + rad * Math.cos(t)).toFixed(1)} ${(cy + rad * Math.sin(t)).toFixed(1)}`);
    }
  }
  return `M${pts.join(' L')}Z`;
}
const starburst = (x: number, y: number, r: number, i: number) => (
  <g class="tw" style={late(i * 0.7)}>
    {[0, 45, 90, 135].map((a, j) => {
      const len = j % 2 ? r * 0.55 : r, t = (a * Math.PI) / 180;
      return <line class="s-a" stroke-width="2.5" stroke-linecap="round" x1={x - len * Math.cos(t)} y1={y - len * Math.sin(t)} x2={x + len * Math.cos(t)} y2={y + len * Math.sin(t)} />;
    })}
    <circle class="k-a" cx={x} cy={y} r={r * 0.16} />
  </g>
);

const STARS: [number, number, number][] = [[96, 98, 1.8], [132, 70, 1.3], [164, 112, 1.5], [206, 60, 2], [238, 124, 1.2], [320, 142, 1.6], [108, 146, 1.3], [184, 88, 1.1], [302, 64, 1.4], [342, 108, 1.2], [76, 186, 1.3], [334, 190, 1.1]];

function Scene({ m, over, u }: { m: RingMotif; over: boolean; u: string }) {
  switch (m) {
    case 'night': return (
      <g>
        {STARS.map(([x, y, r], i) => <circle class="k-f tw" cx={x} cy={y} r={r} style={late(i * 0.41)} />)}
        <mask id={`${u}-moon`}><rect width="400" height="400" fill="#000" /><circle cx="272" cy="98" r="24" fill="#fff" /><circle cx="284" cy="90" r="21" fill="#000" /></mask>
        <circle class="k-f" cx="272" cy="98" r="24" mask={`url(#${u}-moon)`} opacity=".85" />
        <path class="k-l" d={MESA} />
        <Saguaro x={118} base={308} h={40} /><Saguaro x={286} base={308} h={30} />
      </g>
    );
    case 'day': return (
      <g>
        <g class="spin-slow">{Array.from({ length: 12 }, (_, i) => { const [x0, y0] = [200 + 32 * Math.sin((i * Math.PI) / 6), 92 - 32 * Math.cos((i * Math.PI) / 6)], [x1, y1] = [200 + 42 * Math.sin((i * Math.PI) / 6), 92 - 42 * Math.cos((i * Math.PI) / 6)]; return <line class="s-w" stroke-width="4" stroke-linecap="round" x1={x0} y1={y0} x2={x1} y2={y1} />; })}</g>
        <circle class="k-w" cx="200" cy="92" r="23" />
        <g class="drift"><circle class="k-p" cx="96" cy="140" r="12" /><circle class="k-p" cx="112" cy="132" r="15" /><circle class="k-p" cx="128" cy="141" r="11" /></g>
        <path class="k-l" d={MESA} />
        <Saguaro x={118} base={308} h={40} /><Saguaro x={286} base={308} h={30} />
      </g>
    );
    case 'toolbox': return (
      <g>
        <mask id={`${u}-wrench`}><rect width="400" height="400" fill="#000" /><g transform="rotate(-38 118 112)" fill="#fff"><rect x="78" y="106" width="74" height="13" rx="6.5" /><circle cx="156" cy="112" r="18" /></g><rect x="160" y="74" width="20" height="20" transform="rotate(7 170 84)" fill="#000" /></mask>
        <rect width="400" height="400" class="k-d" mask={`url(#${u}-wrench)`} opacity=".8" />
        <g class="mov spin-gear"><path class="k-l" d={gear(200, 346, 76, 14)} /><circle class="k-bg" cx="200" cy="346" r="22" /></g>
        <g class="mov spin-gear-r"><path class="k-a" d={gear(302, 300, 38, 8)} /><circle class="k-bg" cx="302" cy="300" r="10" /></g>
        <g class="mov spin-gear-r"><path class="k-a" d={gear(98, 300, 38, 8)} /><circle class="k-bg" cx="98" cy="300" r="10" /></g>
      </g>
    );
    case 'synthwave': return (
      <g>
        <defs>
          <linearGradient id={`${u}-sun`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--warn)" /><stop offset="1" stop-color="var(--accent)" /></linearGradient>
          <clipPath id={`${u}-horizon`}><rect width="400" height="292" /></clipPath>
          <mask id={`${u}-stripes`}><rect width="400" height="400" fill="#fff" />{[[236, 3], [250, 5], [264, 7], [278, 9]].map(([y, h]) => <rect x="0" y={y} width="400" height={h} fill="#000" />)}</mask>
        </defs>
        {STARS.slice(0, 7).map(([x, y, r], i) => <circle class="k-f tw" cx={x} cy={y} r={r} style={late(i * 0.5)} />)}
        <circle cx="200" cy="232" r="74" fill={`url(#${u}-sun)`} mask={`url(#${u}-stripes)`} clip-path={`url(#${u}-horizon)`} />
        <line class="s-a" x1="30" x2="370" y1="292" y2="292" stroke-width="2.5" />
        {Array.from({ length: 13 }, (_, i) => i - 6).map((k) => <line class="s-a" stroke-width="1.5" opacity=".7" x1={200 + k * 9} y1="292" x2={200 + k * 62} y2="372" />)}
        {[0, 1, 2, 3, 4].map((i) => <line class="s-a mov hz" stroke-width="1.5" x1="30" x2="370" y1="292" y2="292" style={at(i, 5)} />)}
      </g>
    );
    case 'forest': return (
      <g>
        <path class="k-l" d="M30 300 Q110 262 200 292 T370 286 V372 H30Z" />
        <path class="k-d" opacity=".55" d="M30 326 Q130 296 230 320 T370 312 V372 H30Z" />
        {[[70, 300, 34], [98, 296, 44], [262, 292, 40], [300, 300, 30], [330, 296, 38]].map(([x, y, h]) => <path class="k-a" d={`M${x} ${y - h} L${x + h * 0.32} ${y} L${x - h * 0.32} ${y}Z`} />)}
        {[[120, 60, 0], [250, 40, 3.2], [180, 30, 6.1]].map(([x, y, d]) => <ellipse class="k-o fall" cx={x} cy={y} rx="7" ry="3.5" style={late(d)} />)}
      </g>
    );
    case 'tarpit': return (
      <g>
        <g class="bob"><path class="k-d" d="M298 316 C292 272 298 242 318 226 C327 219 342 221 345 231 C338 233 327 233 321 242 C313 258 316 288 320 316Z" /><circle class="k-bg" cx="333" cy="227" r="2" /></g>
        <g class="wave"><path class="k-l" d="M-60 304 q20 -8 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V372 H-60Z" /></g>
        {[[140, 0], [176, 1.1], [228, 2.3], [256, 0.6], [110, 1.8]].map(([x, d]) => <circle class="s-d bub" fill="none" stroke-width="2" cx={x} cy="300" r="5" style={late(d)} />)}
      </g>
    );
    case 'radar': return (
      <g>
        {[52, 104, 156].map((r) => <circle class="s-a" fill="none" stroke-width="1.5" opacity=".55" cx="200" cy="200" r={r} />)}
        <line class="s-a" opacity=".4" x1="40" x2="360" y1="200" y2="200" /><line class="s-a" opacity=".4" x1="200" x2="200" y1="40" y2="360" />
        <g class="spin-radar">
          <path class="k-a" opacity=".28" d={`M200 200 L${200 + 160 * Math.sin((-40 * Math.PI) / 180)} ${200 - 160 * Math.cos((-40 * Math.PI) / 180)} A160 160 0 0 1 200 40Z`} />
          <line class="s-a" stroke-width="2.5" x1="200" y1="200" x2="200" y2="40" />
        </g>
        {[[128, 116, 0], [288, 150, 1.4], [262, 300, 2.6], [104, 284, 3.3]].map(([x, y, d]) => <circle class="k-a blip" cx={x} cy={y} r="4" style={late(d)} />)}
        <text class={`r-defcon ${over ? 'hot' : ''}`} x="200" y="338" text-anchor="middle">{over ? 'DEFCON 3' : 'DEFCON 5'}</text>
      </g>
    );
    case 'sketch': return (
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <circle class="s-d" stroke-width="2" cx="128" cy="98" r="18" />
        <path class="s-d" stroke-width="2" d="M262 92 l8 6 l8 -6 M290 112 l6 4 l6 -4" />
        <path class="s-d" stroke-width="2" d="M30 300 L92 246 L124 272 L170 226 L222 284 L262 254 L312 292 L370 260" />
        <line class="s-d" stroke-width="2" x1="30" x2="370" y1="300" y2="300" />
        <path class="s-d" stroke-width="2.5" d="M186 300 L118 372 M214 300 L282 372" />
        <line class="s-d mov dash" stroke-width="3" stroke-dasharray="10 12" x1="200" y1="300" x2="200" y2="372" />
      </g>
    );
    case 'atomic': return (
      <g>
        {starburst(110, 100, 20, 0)}{starburst(298, 86, 24, 1)}{starburst(204, 66, 12, 2)}{starburst(86, 300, 15, 3)}{starburst(322, 304, 17, 4)}
        <g class="swing"><path class="k-w" opacity=".8" d="M150 318 q22 -20 48 -6 q-24 -4 -38 16Z" /></g>
        <g class="swing" style={late(2)}><path class="k-a" opacity=".8" d="M236 330 q24 -16 46 0 q-24 -8 -40 10Z" /></g>
      </g>
    );
    default: return (
      <g>
        <path class="k-l" d="M30 300 L96 236 L136 270 L188 214 L246 280 L292 242 L370 300Z" />
        <line class="s-l" stroke-width="2" x1="30" x2="370" y1="300" y2="300" />
        <path class="k-d" opacity=".45" d="M190 300 L210 300 L300 372 L100 372Z" />
        <line class="s-f mov dash" stroke-width="4" stroke-dasharray="10 12" x1="200" y1="300" x2="200" y2="372" />
      </g>
    );
  }
}

export function RingSpeedo({ mph, over, why, sign, themeId }: Props) {
  const pageTheme = useThemeId();
  const motif = ringMotif(themeId ?? pageTheme);
  // SVG ids are document-wide, and a gradient's var() colours resolve where it is defined: each ring gets its own.
  const u = useRef(`ring${++rings}`).current;
  const kw = useEstimatedKw(mph);
  const k = kw ?? 0;
  const outA = k > 0 ? (180 * Math.min(k, RING_OUT_KW)) / RING_OUT_KW : 0;
  const regA = k < 0 ? (-90 * Math.min(-k, RING_REGEN_KW)) / RING_REGEN_KW : 0;
  const mv = motionSeconds(mph);
  const kwText = kw === null ? '— kW' : k < 0 ? `≈${Math.round(-k)} kW regen` : `≈${Math.round(k)} kW`;
  const ticks = [[0, true], [60, false], [120, false], [180, true], [-45, false], [-90, true]] as const;
  return (
    <div class="sp-ringwrap">
      <svg class={`sp-ring m-${motif} ${over ? 'over' : ''} ${mv === null ? 'still' : ''}`} style={{ '--mv': `${mv ?? 4}s` } as Record<string, string>}
        viewBox="-14 -14 428 428" role="img" aria-label={mph === null ? `Speed unknown: ${why}` : `${Math.round(mph)} mph, ${kwText}`}>
        <title>Power is estimated from the speed until the truck's CAN bus reports it</title>
        <defs>
          <clipPath id={`${u}-face`}><circle cx={C} cy={C} r={RS} /></clipPath>
          <radialGradient id={`${u}-bg`} cx=".5" cy=".36" r=".72"><stop offset="0" stop-color="var(--panel-2)" /><stop offset="1" stop-color="var(--bg)" /></radialGradient>
        </defs>
        <circle cx={C} cy={C} r={RS} fill={`url(#${u}-bg)`} />
        <g class="scene" clip-path={`url(#${u}-face)`}><Scene m={motif} over={over} u={u} /></g>
        <circle class="r-track" cx={C} cy={C} r={R} />
        {ticks.map(([a, major]) => { const [x0, y0] = polar(R + 11, a), [x1, y1] = polar(R + (major ? 22 : 17), a); return <line class="r-tick" x1={x0} y1={y0} x2={x1} y2={y1} />; })}
        <path class={`r-out ${outA > 0.5 ? '' : 'off'}`} d={arc(R, 0, Math.max(outA, 0.01))} />
        <path class={`r-regen ${regA < -0.5 ? '' : 'off'}`} d={arc(R, Math.min(regA, -0.01), 0)} />
        <text class="r-num num" x={C} y={C + 40} text-anchor="middle">{mph === null ? '—' : Math.round(mph)}</text>
        <text class="r-sub" x={C} y={C + 84} text-anchor="middle">MPH · {kwText}</text>
      </svg>
      {sign && <div class="r-sign">{sign}</div>}
    </div>
  );
}
