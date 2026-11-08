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
  const pw = powerSummary(s?.relays, tablet, tabletWatts);
  return (
    <Card label="Upfit relays" right={<span class="row" style="gap:10px">
      <span class="powertotal num" title="Estimated from the watts set for each load in Settings (nothing in the truck box measures current)">≈ {pw.total} W · {pw.amps} A</span>
      <span class={`tag ${online ? 'ok' : 'warn'}`}>{online ? 'TRUCK BOX ONLINE' : 'TRUCK BOX OFFLINE'}</span>
    </span>}>
      {!online && <div class="banner">Truck box offline. Relay states are unknown and switching is disabled until it reconnects.</div>}
      <div class="tiles">
        {ids.map((id, i) => {
          const r = s!.relays[id];
          const p = pending[id];
          return (
            <button type="button" class={`tile ${r.on ? 'on' : ''} ${p ? 'pending' : ''}`} disabled={!online} aria-pressed={r.on === true} onClick={() => tap(id, r.on)}>
              <span class="tag">RELAY {i + 1}</span>
              <span>
                <div class="name">{r.name}</div>
                <div class="state">{p ? (p.on ? 'TURNING ON…' : 'TURNING OFF…') : r.on === null ? <V v={null} why={whyTruck(s, 'this relay')} /> : r.on ? 'ON' : 'OFF'}</div>
              </span>
              <span class={`watts num ${r.on ? '' : 'idle'}`} title="Estimate: the watts set for this load in Settings">{r.on ? `≈ ${pw.byRelay[id]} W` : `${r.watts ?? 0} W when on`}</span>
              {isInverter(r.name) && <InverterCharge s={s} />}
            </button>
          );
        })}
        <div class="tile tablet" aria-label="Dash tablet">
          <span class="tag">TABLET</span>
          <span>
            <div class="name">Dash tablet</div>
            <div class="state">{tablet.charging === null ? 'BATTERY UNKNOWN' : tablet.charging ? `CHARGING · ${tablet.level}%` : `ON BATTERY · ${tablet.level}%`}</div>
          </span>
          <span class="watts num" title={tablet.charging === false ? 'On its own battery: no draw on the truck' : 'Estimate: the tablet watts set in Settings'}>{tablet.charging === false ? '0 W from the truck' : `≈ ${pw.tablet} W`}</span>
          {tablet.level !== null && <span class="invbar" role="meter" aria-label="Tablet battery" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tablet.level}><span style={{ width: `${tablet.level}%` }} /></span>}
        </div>
      </div>
    </Card>
  );
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
      <div class="dimtxt" style="font-size:13px">Sensed from Slate's own switch circuits; this screen never drives them.</div>
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
