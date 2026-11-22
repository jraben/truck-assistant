// The Gauges screen: two dials (speed, 12V battery), tiles for everything else
// the truck reports, and a fault-code card. Every value that isn't reported
// shows a dash with the reason, never a made-up zero.
import { useState } from 'preact/hooks';
import type { WP } from '../components/drive.tsx';
import { V, whyGps, whySoc, whyTruck } from '../components/common.tsx';
import type { State } from '../lib/brain.ts';
import { batteryTone, batteryWords, compassPoint, dialAngle, explainCode, socTone, tiltTone, tireTone, type Tone } from './logic.ts';
import './gauges.css';

const R = 80;
const arc = (a0: number, a1: number) => {
  const p = (a: number) => { const r = ((a - 90) * Math.PI) / 180; return `${100 + R * Math.cos(r)} ${100 + R * Math.sin(r)}`; };
  return `M ${p(a0)} A ${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`;
};

function Dial({ label, value, unit, min, max, ticks, tone, sub, why }: {
  label: string; value: number | null; unit: string; min: number; max: number; ticks: number[]; tone: Tone; sub?: string; why: string;
}) {
  const a = dialAngle(value, min, max);
  const shown = value === null ? null : unit === 'V' ? value.toFixed(1) : Math.round(value);
  return (
    <div class={`gdial tone-${tone}`} role="img" aria-label={`${label}: ${value === null ? 'not reported' : `${shown} ${unit}`}`}>
      <svg viewBox="0 0 200 170">
        <path class="track" d={arc(-120, 120)} />
        {value !== null && a > -120 && <path class="fill" d={arc(-120, a)} />}
        {ticks.map((t) => {
          const ta = dialAngle(t, min, max), r = ((ta - 90) * Math.PI) / 180;
          return <text class="tick" x={100 + 62 * Math.cos(r)} y={104 + 62 * Math.sin(r)} text-anchor="middle">{t}</text>;
        })}
        <line class="needle" x1="100" y1="100" x2="100" y2="50" transform={`rotate(${a} 100 100)`} />
        <circle class="hub" cx="100" cy="100" r="6" />
      </svg>
      <div class="gdial-read"><b class="num"><V v={shown} why={why} /></b><small>{unit}</small></div>
      <div class="gdial-lbl">{label}{sub && <span> · {sub}</span>}</div>
    </div>
  );
}

function Tile({ label, tone = 'ok', children, sub }: { label: string; tone?: Tone; children: preact.ComponentChildren; sub?: preact.ComponentChildren }) {
  return (
    <div class={`gtile tone-${tone}`}>
      <span class="gtile-lbl">{label}</span>
      <span class="gtile-val num">{children}</span>
      {sub && <span class="gtile-sub">{sub}</span>}
    </div>
  );
}

function Tires({ s }: { s: State | null }) {
  const t = s?.tpms ?? null;
  const why = t ? 'This tyre has no reading yet' : 'No tyre sensors reporting';
  const wheel = (k: 'fl' | 'fr' | 'rl' | 'rr', name: string) => {
    const w = t?.[k] ?? { psi: null, tempF: null };
    return (
      <div class={`gtire tone-${tireTone(w.psi)}`} aria-label={`${name} tyre`}>
        <b class="num"><V v={w.psi === null ? null : Math.round(w.psi)} why={why} /></b><small>psi</small>
        <span>{w.tempF === null ? name : `${name} · ${Math.round(w.tempF)}°`}</span>
      </div>
    );
  };
  return (
    <div class="gtile gtires">
      <span class="gtile-lbl">Tyres</span>
      <div class="gtires-grid">{wheel('fl', 'FL')}{wheel('fr', 'FR')}{wheel('rl', 'RL')}{wheel('rr', 'RR')}</div>
    </div>
  );
}

function FaultCodes({ locked }: { locked: boolean }) {
  const [q, setQ] = useState('');
  const m = q.trim() ? explainCode(q) : null;
  return (
    <div class="gcard gfaults">
      <div class="row between"><h2 class="sect">Fault codes</h2><span class="tag dim">No engine data yet</span></div>
      <p class="dimtxt">
        The Slate's engine data (its OBD port) isn't read yet, so there's no check-engine light here. When it is, codes
        show up on this card in plain English. Until then, type a code from any car's reader.
      </p>
      {locked ? <p class="dimtxt">Park (or say a passenger is using it) to look up a code.</p> : <label class="gfault-in">
        <input aria-label="Fault code" type="text" inputMode="text" autoCapitalize="characters" maxLength={6} placeholder="P0420" value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      </label>}
      {m && !locked && (
        <div class={`gfault-out ${m.valid ? '' : 'bad'}`} aria-live="polite">
          {m.valid && <div class="row between"><b class="num">{m.code}</b><span class="tag dim">{m.known ? 'Known' : m.generic ? 'Standard' : 'Maker-specific'}</span></div>}
          {m.valid && <div class="dimtxt">{m.area}</div>}
          <div>{m.meaning}</div>
        </div>
      )}
    </div>
  );
}

export function Gauges({ s }: WP) {
  const v12 = s?.aux12v ?? null;
  const speed = s?.speedMph ?? null;
  const limit = s?.drive?.speedLimit?.mph ?? null;
  const speedTone: Tone = speed === null ? 'dim' : limit !== null && speed > limit + 5 ? 'warn' : 'ok';
  const soc = s?.soc ?? null;
  const range = s?.drive?.range?.current ?? s?.rangeMi ?? null;
  const outF = s?.drive?.weather?.tempF ?? null;
  const pitch = s?.tilt?.pitch ?? null, roll = s?.tilt?.roll ?? null;
  const heading = s?.gps?.headingDeg ?? null;
  const loadW = s ? Object.values(s.relays ?? {}).reduce((n, r) => n + (r.on ? (r.measuredW ?? r.watts) : 0), 0) : null;
  const dashW = s?.dashW ?? null;
  return (
    <div class="gauges">
      <div class="gdials">
        <Dial label="Speed" value={speed} unit="mph" min={0} max={100} ticks={[0, 20, 40, 60, 80, 100]} tone={speedTone}
          sub={limit !== null ? `limit ${limit}` : undefined} why={whyGps(s)} />
        <Dial label="12V battery" value={v12} unit="V" min={10} max={15} ticks={[10, 11, 12, 13, 14, 15]} tone={batteryTone(v12)}
          sub={batteryWords(v12)} why={whyTruck(s, 'the 12V battery')} />
      </div>
      <div class="gtiles">
        <Tile label="Charge" tone={socTone(soc)} sub={range !== null ? `${Math.round(range)} mi range` : undefined}>
          <V v={soc === null ? null : `${Math.round(soc)}%`} why={whySoc(s)} />
        </Tile>
        <Tile label="Cabin">
          <V v={s?.cabinTempF == null ? null : `${Math.round(s.cabinTempF)}°`} why={whyTruck(s, 'the cabin temperature')} />
        </Tile>
        <Tile label="Outside" sub={s?.drive?.weather?.condition}>
          <V v={outF === null ? null : `${Math.round(outF)}°`} why={s?.drive?.weatherWhy ?? 'No weather yet'} />
        </Tile>
        <Tile label="Heading" sub={heading !== null ? `${Math.round(heading)}°` : undefined}>
          {heading !== null && <svg class="gcompass" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" /><path d="M12 4l5 13-5-3-5 3z" transform={`rotate(${heading} 12 12)`} /></svg>}
          <V v={compassPoint(heading)} why={whyGps(s)} />
        </Tile>
        <Tile label="Pitch" tone={tiltTone(pitch)}><V v={pitch === null ? null : `${Math.round(pitch)}°`} why={whyTruck(s, 'tilt')} /></Tile>
        <Tile label="Roll" tone={tiltTone(roll)}><V v={roll === null ? null : `${Math.round(roll)}°`} why={whyTruck(s, 'tilt')} /></Tile>
        <Tile label="Loads on" sub="switched circuits">
          <V v={loadW === null ? null : `${Math.round(loadW)} W`} why={whyTruck(s, 'the relays')} />
        </Tile>
        <Tile label="Dash power" sub="Pi, screen, cameras">
          <V v={dashW === null ? null : `${Math.round(dashW)} W`} why={s?.truckbox ? 'No power sensor on the dash feed' : whyTruck(s, 'dash power')} />
        </Tile>
        <Tires s={s} />
      </div>
      <FaultCodes locked={!!s?.drive?.lockout.locked && !s.drive.lockout.passenger} />
    </div>
  );
}

export const GAUGES_WIDGETS = { gauges: Gauges };
