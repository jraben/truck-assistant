// Settings, Truck, Vehicle settings: the truck's own instrument-screen menu, in its
// order (Charging, Tire pressure, Parking brake, Diagnostic mode; battery state of
// health; distance since last update). TA follows these so its numbers match the
// truck: it can't set them on the truck itself until it can talk on the CAN bus.
import { useEffect, useState } from 'preact/hooks';
import type { Trip } from '../../../brain/src/types.ts';
import { homeKw, hoursToLimit, type VehicleSettings } from '../../../brain/src/vehicle.ts';
import { api, loadSettings } from '../lib/brain.ts';
import { ask } from '../components/Ask.tsx';

type Status = VehicleSettings & {
  homeKw: number; hoursFrom10: number;
  battery: { pct: number | null; capacityKwh: number | null; sessions: number };
  tpms: Record<'fl' | 'fr' | 'rl' | 'rr', { psi: number | null }> | null;
  low: string[];
};
const AMPS = [12, 16, 24, 32, 40, 48];
const WHEEL = { fl: 'Front left', fr: 'Front right', rl: 'Rear left', rr: 'Rear right' } as const;

export function VehicleSection({ value, packKwh, onChange }: { value: VehicleSettings; packKwh: number; onChange: (v: VehicleSettings) => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [miles, setMiles] = useState<{ mi: number; since: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => api<Status>('/api/vehicle/status').then(setSt).catch(() => {});
  useEffect(() => {
    void load();
    // Distance since last update: real truck miles since this version of TA was installed.
    void (async () => {
      try {
        const v = await api<{ installedAt: string | null }>('/api/update/version');
        if (!v.installedAt) return;
        const trips = await api<Trip[]>('/api/trips?limit=500&source=truck');
        const mi = trips.filter((t) => Date.parse(t.startedAt) >= Date.parse(v.installedAt!)).reduce((s, t) => s + (t.miles ?? 0), 0);
        setMiles({ mi, since: v.installedAt });
      } catch { /* shown as — */ }
    })();
  }, []);
  const reset = async () => {
    setMsg(null);
    if (!(await ask('Reset the tire pressure system?\n\nDo this after checking and filling ALL four tires. Each tire\'s pressure now becomes its normal one, and TA warns when a tire falls 25% below it.', { ok: 'Reset' }))) return;
    try { await api('/api/vehicle/tpms-reset', { method: 'POST' }); await loadSettings(); await load(); setMsg({ ok: true, text: 'Tire pressures reset.' }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const kw = homeKw(value.chargeAmps);
  const base = st?.tpmsBaseline ?? value.tpmsBaseline;
  return (
    <div class="form" style="gap:var(--s15)">
      <h3 class="sub">Charging</h3>
      <div class="fields">
        <label class="f"><span>Charge current (home, 240 V)</span>
          <select value={String(value.chargeAmps)} onChange={(e) => onChange({ ...value, chargeAmps: Number((e.target as HTMLSelectElement).value) })}>
            {[...new Set([...AMPS, value.chargeAmps])].sort((a, b) => a - b).map((a) => <option value={String(a)}>{a} A</option>)}
          </select>
        </label>
        <fieldset class="f" style="border:0;padding:0;margin:0"><legend class="lbl" style="padding:0">Charge limit</legend>
          <div class="row wrap" role="radiogroup" aria-label="Charge limit" style="gap:var(--s1)">
            {([100, 80] as const).map((p) => <button type="button" role="radio" aria-checked={value.chargeLimitPct === p} class={`btn ${value.chargeLimitPct === p ? 'primary' : ''}`} onClick={() => onChange({ ...value, chargeLimitPct: p })}>{p}% max charge</button>)}
          </div>
        </fieldset>
      </div>
      <p class="help" style="margin:0">To prolong battery life, set max charge to 80%. For maximum range, set max charge to 100%. At {value.chargeAmps} A the truck takes about {kw} kW: {hoursToLimit(packKwh, value, 10)} h from 10% to {value.chargeLimitPct}%. Trips, WEEK starts from this limit, and its overnight hours use this current.</p>

      <h3 class="sub">Tire pressure</h3>
      <div class="row wrap" style="gap:var(--s15)">
        {(Object.keys(WHEEL) as (keyof typeof WHEEL)[]).map((w) => {
          const p = st?.tpms?.[w]?.psi ?? null;
          const low = st?.low.includes(w);
          return <div><div class="lbl">{WHEEL[w]}</div><b class={`num ${low ? 'err' : ''}`}>{p === null ? '—' : `${Math.round(p)} psi`}</b>{base && <span class="dimtxt" style="font-size:var(--fs-caption)"> · set {Math.round(base.psi[w])}</span>}</div>;
        })}
      </div>
      <div class="row wrap" style="gap:var(--s1);align-items:center">
        <button type="button" class="btn" onClick={() => void reset()}>Reset system</button>
        <span class="dimtxt" style="font-size:var(--fs-caption)">{base ? `Last reset ${new Date(base.at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Not reset yet: TA warns under 30 psi.'}</span>
      </div>
      {msg && <div class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</div>}
      <p class="help" style="margin:0">After checking and filling ALL four tires, reset the system here (and on the truck's screen). If you need further help, see the owner's manual.</p>

      <h3 class="sub">Parking brake</h3>
      <p class="help" style="margin:0">Set it on the truck's own screen (Vehicle settings, Parking brake). When it is off, the automatic parking brake won't engage when the park button on the shifter is pressed. TA can't read or change it yet: that needs the truck's CAN bus.</p>

      <h3 class="sub">Diagnostic mode</h3>
      <p class="help" style="margin:0">TA's own check is the health button in the cockpit's top bar (every part of the dash, its connections and what's wrong), and the logs under Logs &amp; system.</p>

      <h3 class="sub">Battery and updates</h3>
      <div class="row wrap" style="gap:var(--s3)">
        <div><div class="lbl">Battery state of health</div><b class="num" style="font-size:var(--fs-title)">{st?.battery.pct != null ? `${st.battery.pct.toFixed(1)}%` : '—'}</b>
          <div class="dimtxt" style="font-size:var(--fs-caption)">{st?.battery.pct != null ? `about ${st.battery.capacityKwh} of ${packKwh} kWh, from ${st.battery.sessions} charge${st.battery.sessions === 1 ? '' : 's'}` : 'an estimate once a charge of 20% or more is logged with its kWh and start and end %'}</div></div>
        <div><div class="lbl">Distance since last update</div><b class="num" style="font-size:var(--fs-title)">{miles ? `${Math.round(miles.mi)} mi` : '—'}</b>
          <div class="dimtxt" style="font-size:var(--fs-caption)">{miles ? `real truck miles since this version of TA, ${new Date(miles.since).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : 'since this version of TA was installed'}</div></div>
      </div>
      <p class="help" style="margin:0">The truck reads its battery's health from the battery itself; TA infers it from how much energy each logged charge took.</p>
    </div>
  );
}
