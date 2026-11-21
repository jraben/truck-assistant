// The dash tablet's battery, last 48 hours (brain/src/tabletBattery.ts): the level, when it
// charged (green) and when its screen was on (amber), gaps where it was asleep, and the rate
// in each state, which answers "does the charger keep up with CarPlay?" and "did the screen
// stay on all night?".
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/brain.ts';
import type { BatterySample, BatterySummary } from '../../../brain/src/tabletBattery.ts';

const GAP_MS = 20 * 60_000;
const W = 600, H = 156, TOP = 16, BOT = 134;

type Resp = { hours: number; samples: BatterySample[]; summary: BatterySummary };

/** The level line as SVG paths, broken where the reports stop (asleep). Pure. */
export function batteryPaths(samples: BatterySample[], from: number, to: number): { line: string[]; gaps: string[]; bands: { x: number; w: number; kind: 'charging' | 'screen' }[] } {
  const x = (t: number) => Math.round(((t - from) / (to - from)) * W * 10) / 10;
  const y = (l: number) => Math.round((BOT - (l / 100) * (BOT - TOP)) * 10) / 10;
  const line: string[] = [], gaps: string[] = [], bands: { x: number; w: number; kind: 'charging' | 'screen' }[] = [];
  let cur = '';
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], t = Date.parse(s.t);
    const prev = samples[i - 1];
    if (prev && t - Date.parse(prev.t) > GAP_MS) {
      if (cur) line.push(cur);
      gaps.push(`M${x(Date.parse(prev.t))} ${y(prev.level)} L${x(t)} ${y(s.level)}`);
      cur = '';
    }
    cur += `${cur ? 'L' : 'M'}${x(t)} ${y(s.level)} `;
    const next = samples[i + 1];
    const end = next && Date.parse(next.t) - t <= GAP_MS ? Date.parse(next.t) : t;
    if (end > t) {
      if (s.charging) bands.push({ x: x(t), w: Math.max(0.5, x(end) - x(t)), kind: 'charging' });
      if (s.screen) bands.push({ x: x(t), w: Math.max(0.5, x(end) - x(t)), kind: 'screen' });
    }
  }
  if (cur) line.push(cur);
  return { line: line.map((p) => p.trim()), gaps, bands };
}

const rateText = (r: { pctPerHour: number | null; hours: number }) =>
  r.pctPerHour === null ? (r.hours ? `not enough yet (${r.hours} h)` : 'no data yet') : `${r.pctPerHour > 0 ? '+' : ''}${r.pctPerHour}% an hour (${r.hours} h)`;

export function TabletBattery() {
  const [d, setD] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Resp>('/api/tablet/battery?hours=48').then(setD, (e: Error) => setErr(e.message)); }, []);
  if (err) return <p class="help">Tablet battery log: {err}</p>;
  if (!d) return null;
  const to = Date.now(), from = to - d.hours * 3_600_000;
  const p = batteryPaths(d.samples, from, to);
  const s = d.summary;
  const short = s.charging.pctPerHour !== null && s.charging.pctPerHour < 1;
  return (
    <div class="tbat">
      <h3 class="sub">Dash tablet battery, last 48 hours</h3>
      {!d.samples.length ? <p class="help">No reports yet. The cockpit on the tablet sends its battery every minute while it's open; it shows up here within a few minutes.</p> : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} class="tbat-chart" role="img" aria-label="Tablet battery level over the last 48 hours">
            {[0, 50, 100].map((l) => <g><line x1="0" x2={W} y1={BOT - (l / 100) * (BOT - TOP)} y2={BOT - (l / 100) * (BOT - TOP)} class="grid" /><text x="2" y={BOT - (l / 100) * (BOT - TOP) - 2} class="ax">{l}%</text></g>)}
            {p.bands.map((b) => <rect x={b.x} width={b.w} y={b.kind === 'charging' ? TOP : BOT + 4} height={b.kind === 'charging' ? BOT - TOP : 6} class={`band ${b.kind}`} />)}
            {p.gaps.map((g) => <path d={g} class="gap" />)}
            {p.line.map((l) => <path d={l} class="lvl" />)}
            {[48, 36, 24, 12, 0].map((h) => <text x={Math.min(W - 30, Math.max(0, W - (h / d.hours) * W - 14))} y={H - 2} class="ax">{h ? `-${h}h` : 'now'}</text>)}
          </svg>
          <div class="tbat-key"><span class="k charging">charging</span><span class="k screen">screen on</span><span class="k gap">asleep (no reports)</span></div>
          <ul class="tbat-rates">
            <li><b>Plugged in:</b> {rateText(s.charging)}{short ? '. The charger barely keeps up: a stronger charger (30 W+) or a powered hub, especially with CarPlay running.' : ''}</li>
            <li><b>Unplugged, screen on:</b> {rateText(s.screenOn)}</li>
            <li><b>Unplugged, screen off:</b> {rateText(s.screenOff)}</li>
            <li><b>Asleep:</b> {rateText(s.asleep)}</li>
          </ul>
          <p class="help">While the screen is off the page can't report, so a gap means asleep. Tasker can fill it in: a profile on Event › Power › Battery Changed posting {'{"level":"%BATT","screen":"%SCREEN"}'} to /api/tablet/battery (deploy/android/README.md).</p>
        </>
      )}
    </div>
  );
}
