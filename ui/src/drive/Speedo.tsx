// The speedometers (docs/drive-v2.md §5). Every style is fed the same data and
// draws only with theme tokens. Needles move by CSS transform transitions, so
// prefers-reduced-motion (and the heat "calm" mode) turn the motion off.
import type { SpeedoStyle } from '../../../brain/src/drive/types.ts';
import { RingSpeedo } from './RingSpeedo.tsx';

export type SpeedoProps = { mph: number | null; limit: number | null; over: boolean; why: string };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
};
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const shown = (mph: number | null) => (mph === null ? '—' : String(Math.round(mph)));

/** US-style limit sign, in theme colours. */
export function LimitSign({ limit, over, size = 1 }: { limit: number | null; over: boolean; size?: number }) {
  if (limit === null) return null;
  return (
    <div class={`limit ${over ? 'over' : ''}`} style={{ '--s': size } as Record<string, number>} title="Speed limit from OpenStreetMap: a hint, not a guarantee" aria-label={`Speed limit ${limit}`}>
      <span>SPEED<br />LIMIT</span><b class="num">{limit}</b>
    </div>
  );
}

function Digital({ mph, limit, over, why }: SpeedoProps) {
  return (
    <div class="sp-digital">
      <div class={`sp-num num ${over ? 'over' : ''}`} title={mph === null ? why : undefined}>{shown(mph)}</div>
      <div class="sp-side"><span class="sp-unit">MPH</span><LimitSign limit={limit} over={over} /></div>
    </div>
  );
}

function Minimal({ mph, over, why }: SpeedoProps) {
  return <div class="sp-minimal"><div class={`sp-num num ${over ? 'over' : ''}`} title={mph === null ? why : undefined}>{shown(mph)}</div></div>;
}

const SWEEP_MAX = 100, SWEEP_A0 = -135, SWEEP_A1 = 135;
function Sweep({ mph, limit, over, why }: SpeedoProps) {
  const v = clamp(mph ?? 0, 0, SWEEP_MAX);
  const ang = SWEEP_A0 + ((SWEEP_A1 - SWEEP_A0) * v) / SWEEP_MAX;
  const C = 200, R = 168;
  const len = (Math.PI * 2 * R * (SWEEP_A1 - SWEEP_A0)) / 360;
  const ticks = [];
  for (let s = 0; s <= SWEEP_MAX; s += 5) {
    const a = SWEEP_A0 + ((SWEEP_A1 - SWEEP_A0) * s) / SWEEP_MAX;
    const major = s % 20 === 0;
    const [x0, y0] = polar(C, C, R - (major ? 30 : 22), a), [x1, y1] = polar(C, C, R - 14, a);
    ticks.push(<line class={major ? 'tk major' : 'tk'} x1={x0} y1={y0} x2={x1} y2={y1} />);
    if (major) { const [tx, ty] = polar(C, C, R - 52, a); ticks.push(<text class="tn" x={tx} y={ty + 8} text-anchor="middle">{s}</text>); }
  }
  const lim = limit !== null && limit <= SWEEP_MAX ? SWEEP_A0 + ((SWEEP_A1 - SWEEP_A0) * limit) / SWEEP_MAX : null;
  return (
    <svg class={`sp-sweep ${over ? 'over' : ''}`} viewBox="0 0 400 370" role="img" aria-label={mph === null ? `Speed unknown: ${why}` : `${Math.round(mph)} mph`}>
      <path class="track" d={arc(C, C, R, SWEEP_A0, SWEEP_A1)} />
      <path class="trail" d={arc(C, C, R, SWEEP_A0, SWEEP_A1)} style={{ strokeDasharray: len, strokeDashoffset: len * (1 - v / SWEEP_MAX) }} />
      {ticks}
      {lim !== null && <path class="limtick" d={arc(C, C, R, lim - 1.2, lim + 1.2)} />}
      <g class="needle" style={{ transform: `rotate(${ang}deg)` }}>
        <path d={`M${C - 5} ${C} L${C} ${C - R + 8} L${C + 5} ${C} Z`} />
      </g>
      <circle class="hub" cx={C} cy={C} r="14" />
      <text class="sp-mid num" x={C} y={C + 92} text-anchor="middle">{shown(mph)}</text>
      <text class="sp-u" x={C} y={C + 122} text-anchor="middle">MPH</text>
    </svg>
  );
}

// '57: a wide, shallow fan across the top of a cream face in a chrome bezel, the
// needle pivoting far below the dial. Original drawing in that period style.
const F_MAX = 120, F_A = 47, FACE_A = 55, PX = 400, PY = 548, RO = 500, RI = 352;
function FiftySeven({ mph, limit, over, why }: SpeedoProps) {
  const v = clamp(mph ?? 0, 0, F_MAX);
  const ang = -F_A + (2 * F_A * v) / F_MAX;
  const at = (s: number) => -F_A + (2 * F_A * s) / F_MAX;
  const [ox0, oy0] = polar(PX, PY, RO, -FACE_A), [ox1, oy1] = polar(PX, PY, RO, FACE_A);
  const [ix1, iy1] = polar(PX, PY, RI, FACE_A), [ix0, iy0] = polar(PX, PY, RI, -FACE_A);
  const face = `M${ox0} ${oy0}A${RO} ${RO} 0 0 1 ${ox1} ${oy1}L${ix1} ${iy1}A${RI} ${RI} 0 0 0 ${ix0} ${iy0}Z`;
  const marks = [];
  for (let s = 0; s <= F_MAX; s += 5) {
    const major = s % 20 === 0, mid = s % 10 === 0;
    const [x0, y0] = polar(PX, PY, RO - 18, at(s)), [x1, y1] = polar(PX, PY, RO - (major ? 54 : mid ? 42 : 32), at(s));
    marks.push(<line class={major ? 'tk major' : mid ? 'tk mid' : 'tk'} x1={x0} y1={y0} x2={x1} y2={y1} />);
    if (major) {
      const [tx, ty] = polar(PX, PY, RO - 84, at(s));
      marks.push(<text class="f-num" x={tx} y={ty} text-anchor="middle" dominant-baseline="middle" transform={`rotate(${at(s) * 0.6} ${tx} ${ty})`}>{s}</text>);
    }
  }
  const lim = limit !== null && limit <= F_MAX ? at(limit) : null;
  return (
    <div class="sp-57wrap">
      <svg class={`sp-57 ${over ? 'over' : ''}`} viewBox="-24 34 848 326" role="img" aria-label={mph === null ? `Speed unknown: ${why}` : `${Math.round(mph)} mph`}>
        <defs>
          <linearGradient id="chrome57" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--fg)" /><stop offset=".22" stop-color="var(--panel)" /><stop offset=".5" stop-color="var(--dim)" />
            <stop offset=".72" stop-color="var(--panel)" /><stop offset="1" stop-color="var(--line)" />
          </linearGradient>
          <radialGradient id="face57" cx=".5" cy="1.4" r="1.3">
            <stop offset=".55" stop-color="var(--panel)" /><stop offset="1" stop-color="var(--panel-2)" />
          </radialGradient>
          <clipPath id="clip57"><path d={face} /></clipPath>
        </defs>
        <path d={face} fill="url(#face57)" />
        <path class="f-band" d={arc(PX, PY, RO - 10, -F_A, F_A)} clip-path="url(#clip57)" />
        {lim !== null && <path class="f-limit" d={arc(PX, PY, RO - 10, lim, F_A)} clip-path="url(#clip57)" />}
        {marks}
        <text class="f-script" x={PX} y={PY - RI - 14} text-anchor="middle">Miles per Hour</text>
        <g clip-path="url(#clip57)">
          <g class="needle" style={{ transform: `rotate(${ang}deg)`, transformOrigin: `${PX}px ${PY}px` }}>
            <path class="f-needle" d={`M${PX - 4} ${PY - RI + 30} L${PX} ${PY - RO + 6} L${PX + 4} ${PY - RI + 30} Z`} />
          </g>
        </g>
        <path d={face} class="f-bezel" stroke="url(#chrome57)" />
      </svg>
      <div class="sp-57foot">
        <span class={`sp-57num num ${over ? 'over' : ''}`} title={mph === null ? why : undefined}>{shown(mph)}</span>
        <LimitSign limit={limit} over={over} size={0.8} />
      </div>
    </div>
  );
}

const RIB_PX = 14; // px per mph on the tape
function Ribbon({ mph, limit, over, why }: SpeedoProps) {
  const v = clamp(mph ?? 0, 0, 120);
  const W = 900, cx = W / 2;
  const marks = [];
  for (let s = 0; s <= 120; s += 5) {
    const x = cx + s * RIB_PX;
    const major = s % 10 === 0;
    marks.push(<line class={major ? 'tk major' : 'tk'} x1={x} x2={x} y1={major ? 40 : 52} y2={80} />);
    if (major) marks.push(<text class="r-num" x={x} y={118} text-anchor="middle">{s}</text>);
  }
  return (
    <div class="sp-ribbon">
      <div class="r-top">
        <span class={`sp-num num ${over ? 'over' : ''}`} title={mph === null ? why : undefined}>{shown(mph)}</span>
        <span class="sp-unit">MPH</span>
        <LimitSign limit={limit} over={over} size={0.8} />
      </div>
      <svg viewBox={`0 0 ${W} 140`} class="r-tape" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="ribfade" x1="0" x2="1"><stop offset="0" stop-color="var(--bg)" stop-opacity="1" /><stop offset=".2" stop-color="var(--bg)" stop-opacity="0" /><stop offset=".8" stop-color="var(--bg)" stop-opacity="0" /><stop offset="1" stop-color="var(--bg)" stop-opacity="1" /></linearGradient>
        </defs>
        <g class="needle" style={{ transform: `translateX(${-v * RIB_PX}px)` }}>
          <rect class="r-fill" x={cx} y={80} width={v * RIB_PX} height={6} />
          {limit !== null && <rect class="r-limit" x={cx + limit * RIB_PX - 3} y={36} width={6} height={50} />}
          {marks}
        </g>
        <rect x="0" y="0" width={W} height="140" fill="url(#ribfade)" />
        <path class="r-pointer" d={`M${cx - 14} 6 L${cx + 14} 6 L${cx} 30 Z`} />
        <line class="r-center" x1={cx} x2={cx} y1={30} y2={92} />
      </svg>
    </div>
  );
}

export const SPEEDO_LABELS: Record<SpeedoStyle, string> = { digital: 'Digital', ring: 'Power ring', sweep: 'Sweep', 'fifty-seven': "'57", ribbon: 'Ribbon', minimal: 'Minimal' };

export function Speedo({ style, ...p }: SpeedoProps & { style: SpeedoStyle }) {
  switch (style) {
    case 'ring': return <RingSpeedo {...p} sign={<LimitSign limit={p.limit} over={p.over} size={0.72} />} />;
    case 'sweep': return <Sweep {...p} />;
    case 'fifty-seven': return <FiftySeven {...p} />;
    case 'ribbon': return <Ribbon {...p} />;
    case 'minimal': return <Minimal {...p} />;
    default: return <Digital {...p} />;
  }
}
