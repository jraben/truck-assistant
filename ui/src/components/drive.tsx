import type { State } from '../lib/brain.ts';
import { useChargers } from '../lib/data.ts';
import { fmtNum } from '../lib/fmt.ts';
import { Card, V, whyGps, whySoc, whyTruck } from './common.tsx';

export type WP = { s: State | null; props?: Record<string, unknown>; go: (view: string) => void };

export function Speed({ s }: WP) {
  const gear = s?.gear ?? null;
  return (
    <Card class="speedo" label="Speed" right={<span class="tag dim">GPS</span>}>
      <div class="speed num"><V v={fmtNum(s?.speedMph)} why={whyGps(s)} /><small>MPH</small></div>
      <div>
        <div class="lbl" style="margin-bottom:6px">Gear {gear === null && <V v={null} why={s?.truckbox ? 'P, N and D need the CAN bus; only R is wired (reverse lamp)' : whyTruck(s, 'reverse')} />}</div>
        <div class="gears" role="group" aria-label="Gear (display only)">
          {(['P', 'R', 'N', 'D'] as const).map((g) => <div class={`gear ${gear === g ? 'on' : ''}`}>{g}</div>)}
        </div>
      </div>
    </Card>
  );
}

const C = 2 * Math.PI * 58;
export function Ring({ soc, size }: { soc: number | null; size?: number }) {
  const color = soc === null ? 'var(--dim)' : soc < 15 ? 'var(--bad)' : soc < 30 ? 'var(--warn)' : 'var(--ok)';
  return (
    <svg class="ring" viewBox="0 0 140 140" style={size ? `width:${size}px;height:${size}px` : undefined} aria-label={`Battery ${soc ?? 'unknown'}%`}>
      <circle class="track" cx="70" cy="70" r="58" />
      <circle class="val" cx="70" cy="70" r="58" stroke-dasharray={C} stroke-dashoffset={C * (1 - (soc ?? 0) / 100)} style={{ stroke: color }} />
      <text x="70" y="82" text-anchor="middle">{soc === null ? '—' : `${Math.round(soc)}%`}</text>
    </svg>
  );
}

export const socLabel = (src: State['socSource']) => src === 'manual' ? 'MANUAL' : src === 'estimate' ? 'ESTIMATE' : src === 'can' ? 'CAN' : 'UNKNOWN';

export function Soc({ s, go }: WP) {
  const soc = s?.soc ?? null;
  return (
    <Card class="socw" label="Battery" right={<button type="button" class={`tag ${s?.socSource === 'estimate' ? 'warn' : s?.socSource ? 'ok' : 'dim'}`} title="Tap to set the charge level" onClick={() => go('charge')}>{socLabel(s?.socSource ?? null)}</button>}>
      <div class="row wrap" style="gap:20px">
        <span title={soc === null ? whySoc(s) : s?.socSource === 'estimate' ? 'Estimated: last manual value minus GPS miles / efficiency' : 'Set by hand'}><Ring soc={soc} /></span>
        <div>
          <div class="lbl">Range</div>
          <div class="big num"><V v={fmtNum(s?.rangeMi)} why={soc === null ? whySoc(s) : 'Not known'} /><small>mi</small></div>
        </div>
      </div>
      {soc === null && <button type="button" class="btn" onClick={() => go('charge')}>Set charge level</button>}
    </Card>
  );
}

export function NextCharger({ s, go }: WP) {
  const c = useChargers();
  const top = c.list[0];
  return (
    <Card label="Next charger" right={<button class="tag accent" type="button" onClick={() => go('charge')}>ALL</button>}>
      {top ? (
        <button type="button" class="next" style="text-align:left" onClick={() => go('charge')}>
          <div class="icon"><svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg></div>
          <div class="grow">
            <div class="lbl ellip">{top.network ?? 'Unknown network'} · {top.distanceMi.toFixed(1)} mi · {top.maxKw ? `${Math.round(top.maxKw)} kW` : 'kW unknown'}</div>
            <div class="ellip" style="font-family:var(--display);font-size:28px;font-weight:600">{top.name}</div>
            <div class="dimtxt ellip" style="font-size:14px">{top.reasons.find((r) => r.startsWith('Arrive')) ?? top.reasons[0]}</div>
          </div>
          <div class="score">{top.score}</div>
        </button>
      ) : (
        <div class="dimtxt">{c.loading ? 'Looking…' : c.message ?? (s?.gps?.fix ? 'No chargers found' : whyGps(s))}</div>
      )}
    </Card>
  );
}

export function TripW({ s, go }: WP) {
  return (
    <Card label="Trip" right={<button class="tag accent" type="button" onClick={() => go('trips')}>LOG</button>}>
      <div class="mid num"><V v={s?.trip ? s.trip.miles.toFixed(1) : null} why={s ? 'No trip in progress' : 'Not connected'} /><small>mi</small></div>
      <div class="dimtxt" style="font-size:13px">{s?.trip ? `since ${new Date(s.trip.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'parked'}</div>
    </Card>
  );
}

export function Cabin({ s }: WP) {
  return <Card label="Cabin"><div class="mid num"><V v={fmtNum(s?.cabinTempF)} why={whyTruck(s, 'cabin temperature')} /><small>°F</small></div></Card>;
}

export function Aux12v({ s }: WP) {
  const v = s?.aux12v ?? null;
  const tone = v === null ? '' : v < 11.8 ? 'var(--bad)' : v < 12.2 ? 'var(--warn)' : '';
  return <Card label="12V"><div class="mid num" style={tone ? { color: tone } : undefined}><V v={fmtNum(v, 1)} why={whyTruck(s, '12V')} /><small>V</small></div></Card>;
}

export function Tilt({ s }: WP) {
  const t = s?.tilt ?? null;
  const p = t ? Math.max(-30, Math.min(30, t.pitch)) : 0;
  const r = t ? Math.max(-30, Math.min(30, t.roll)) : 0;
  return (
    <Card class="tilt" label="Tilt">
      <svg viewBox="0 0 100 60" aria-label={t ? `Pitch ${t.pitch}°, roll ${t.roll}°` : 'Tilt unknown'}>
        <line x1="5" y1="30" x2="95" y2="30" stroke="var(--line)" stroke-width="1" />
        <g transform={`rotate(${r} 50 30)`} opacity={t ? 1 : 0.3}>
          <rect x="22" y={22 - p * 0.4} width="56" height="14" rx="4" fill="none" stroke="var(--accent)" stroke-width="3" />
          <circle cx="34" cy={40 - p * 0.4} r="5" fill="var(--accent)" /><circle cx="66" cy={40 - p * 0.4} r="5" fill="var(--accent)" />
        </g>
      </svg>
      <div class="num" style="font-family:var(--mono);font-size:13px">
        {t ? <>P {t.pitch.toFixed(1)}° · R {t.roll.toFixed(1)}°</> : <V v={null} why={whyTruck(s, 'tilt')} />}
      </div>
    </Card>
  );
}

export function CarPlay(_: WP) {
  return (
    <div class="cpscreen" id="carplay-host" data-aspect="1600x720">
      <div>
        <h2>CarPlay goes here</h2>
        <p>The Carlinkit dongle's video lands in this panel once react-carplay is embedded (#carplay-host). Waze and music stay on the phone; the strip beside it is ours, so speed and battery never leave the screen.</p>
      </div>
    </div>
  );
}

export function LiveStrip({ s }: WP) {
  return (
    <div class="strip-live">
      <Card label="Speed"><div class="big num"><V v={fmtNum(s?.speedMph)} why={whyGps(s)} /><small>mph</small></div></Card>
      <Card label="Battery" right={<span class="tag dim">{socLabel(s?.socSource ?? null)}</span>}>
        <div class="big num"><V v={fmtNum(s?.soc)} why={whySoc(s)} /><small>%</small></div>
      </Card>
      <Card label="Range"><div class="big num"><V v={fmtNum(s?.rangeMi)} why={whySoc(s)} /><small>mi</small></div></Card>
    </div>
  );
}
