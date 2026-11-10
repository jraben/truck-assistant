import { useEffect, useState } from 'preact/hooks';
import { send, settingsStore, toast, useStore } from '../lib/brain.ts';
import { powerSummary, useTabletPower } from '../lib/power.ts';
import { Card, V, whyTruck } from './common.tsx';
import type { WP } from './drive.tsx';
import { inverterReadout, isInverter } from '../lib/inverter.ts';

export function Relays({ s }: WP) {
  const [pending, setPending] = useState<Record<string, { on: boolean; at: number }>>({});
  const online = !!s?.truckbox;

  // Clear a pending tap once the truck box echoes it, or give up after 3 s.
  useEffect(() => {
    if (!s) return;
    const now = Date.now();
    const next = { ...pending };
    let changed = false;
    for (const [id, p] of Object.entries(pending)) {
      if (s.relays[id]?.on === p.on) { delete next[id]; changed = true; }
      else if (now - p.at > 3000) { delete next[id]; changed = true; toast(`${s.relays[id]?.name ?? id}: no answer from the truck box`); }
    }
    if (changed) setPending(next);
  }, [s]);

  const tap = (id: string, on: boolean | null) => {
    const want = !on;
    if (send({ type: 'relay', id, on: want })) setPending({ ...pending, [id]: { on: want, at: Date.now() } });
  };

  const ids = Object.keys(s?.relays ?? {}).sort();
  const tablet = useTabletPower();
  const tabletWatts = useStore(settingsStore)?.tabletWatts ?? 12;
  const pw = powerSummary(s?.relays, tablet, tabletWatts, s?.dashW ?? null);
  return (
    <Card label="Upfit relays" right={<span class="row" style="gap:var(--s1)">
      <span class="powertotal num" title={pw.allMeasured ? 'Measured by the truck box’s current sensors (the tablet is its rated watts)' : 'Measured where a circuit has a current sensor; the rest from the watts set in Settings'}>{pw.allMeasured ? '' : '≈ '}{pw.total} W · {pw.amps} A</span>
      <span class={`tag ${online ? 'ok' : 'warn'}`}>{online ? 'TRUCK BOX ONLINE' : 'TRUCK BOX OFFLINE'}</span>
    </span>}>
      {!online && <div class="banner">Truck box offline. Relay states are unknown and switching is disabled until it reconnects.</div>}
      <div class="tiles">
        {ids.map((id, i) => {
          const r = s!.relays[id];
          const p = pending[id];
          return (
            <button type="button" class={`tile ${r.on ? 'on' : ''} ${p ? 'pending' : ''}`} disabled={!online} aria-pressed={r.on === true} onClick={() => tap(id, r.on)}>
              <span class="tilehead"><LoadIcon name={r.name} /><span class="lbl">Relay {i + 1}</span></span>
              <span>
                <div class="name">{r.name}</div>
                <div class="state">{p ? (p.on ? 'Turning on…' : 'Turning off…') : r.on === null ? <V v={null} why={whyTruck(s, 'this relay')} /> : r.on ? 'On' : 'Off'}</div>
              </span>
              {pw.measured[id]
                ? <span class={`watts num ${pw.byRelay[id] > 0 ? '' : 'idle'}`} title="Measured by the current sensor on this circuit">{pw.byRelay[id]} W{r.on && pw.byRelay[id] === 0 ? ' · nothing drawing' : ''}</span>
                : <span class={`watts num ${r.on ? '' : 'idle'}`} title="Estimate: the watts set for this load in Settings">{r.on ? `≈ ${pw.byRelay[id]} W` : `${r.watts ?? 0} W when on`}</span>}
              {isInverter(r.name) && <InverterCharge s={s} />}
            </button>
          );
        })}
        <div class="tile tablet" aria-label="Dash tablet">
          <span class="tilehead"><LoadIcon name="tablet" /><span class="lbl">Dash</span></span>
          <span>
            <div class="name">Dash tablet</div>
            <div class="state">{tablet.charging === null ? 'Battery unknown' : tablet.charging ? `Charging · ${tablet.level}%` : `On battery · ${tablet.level}%`}</div>
          </span>
          <span class="watts num" title={tablet.charging === false ? 'On its own battery: no draw on the truck' : 'Estimate: the tablet watts set in Settings'}>{tablet.charging === false ? '0 W from the truck' : `≈ ${pw.tablet} W`}</span>
          {tablet.level !== null && <span class="invbar" role="meter" aria-label="Tablet battery" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tablet.level}><span style={{ width: `${tablet.level}%` }} /></span>}
        </div>
        {pw.dash !== null && (
          <div class="tile tablet" aria-label="Dash electronics">
            <span class="tilehead"><LoadIcon name="screen" /><span class="lbl">Dash</span></span>
            <span><div class="name">Dash electronics</div><div class="state">Pi, screen, cameras, truck box</div></span>
            <span class="watts num" title="Measured by the current sensor on the dash feed">{pw.dash} W</span>
          </div>
        )}
      </div>
    </Card>
  );
}

/** A simple line icon for a load, picked from its (editable) name. */
const LOAD_ICONS: [RegExp, string][] = [
  [/light ?bar/i, 'M3 8h18v5H3zM6 16l-1 4M12 16v4M18 16l1 4'],
  [/light|lamp/i, 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z'],
  [/compress|air/i, 'M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7'],
  [/fridge|cool|freez/i, 'M12 2v20M3.5 7l17 10M20.5 7l-17 10'],
  [/inverter|outlet|120/i, 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4'],
  [/tablet|screen/i, 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2'],
];
function LoadIcon({ name }: { name: string }) {
  const d = LOAD_ICONS.find(([re]) => re.test(name))?.[1] ?? 'M12 2v10M5.6 6.6a8 8 0 1 0 12.8 0';
  return <svg class="loadicon" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
}

/** On the Inverter tile: the battery it is running from, as a bar, plus range and 12V. */
function InverterCharge({ s }: { s: WP['s'] }) {
  const r = inverterReadout(s);
  return (
    <span class={`invcharge ${r.low ? 'low' : ''}`} title="The inverter runs from the truck's battery">
      <span class="row between num">
        <b><V v={r.soc === null ? null : `${r.soc}%`} why={s ? 'No charge reading yet' : 'Not connected to the brain'} /></b>
        <span class="invfacts">
          {r.rangeMi !== null && <span>{r.rangeMi} mi</span>}
          {r.volts !== null && <span title="12V battery">{r.volts.toFixed(1)} V</span>}
        </span>
      </span>
      <span class="invbar" role="meter" aria-label="Truck battery" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.soc ?? undefined}>
        <span style={{ width: `${r.soc ?? 0}%` }} />
      </span>
    </span>
  );
}

export function FiveSwitch({ s }: WP) {
  const fs = s?.fiveSwitch ?? [null, null, null, null, null];
  return (
    <Card label="Five Switch" right={<span class="tag dim">READ-ONLY</span>}>
      <div class="leds">
        {fs.map((on, i) => <div class={`led ${on ? 'on' : ''}`} title={on === null ? whyTruck(s, 'this circuit') : undefined}>{i + 1}<br />{on === null ? '—' : on ? 'ON' : 'OFF'}</div>)}
      </div>
      <div class="dimtxt" style="font-size:var(--fs-caption)">Sensed from Slate's own switch circuits; this screen never drives them.</div>
    </Card>
  );
}

export function Tpms({ s }: WP) {
  const t = s?.tpms ?? null;
  const why = t ? 'Sensor not reporting' : s?.truckbox ? 'No TPMS sensors reporting' : whyTruck(s);
  return (
    <Card label="Tire pressure">
      <div class="tires num">
        {(['fl', 'fr', 'rl', 'rr'] as const).map((w) => {
          const psi = t?.[w].psi ?? null;
          return <div class="tire" style={psi !== null && psi < 34 ? { color: 'var(--warn)' } : undefined}><V v={psi === null ? null : psi.toFixed(0)} why={why} /><small> psi {w.toUpperCase()}</small></div>;
        })}
      </div>
    </Card>
  );
}
