// The Road trip screen: pick a destination, see the planned charging stops
// (how much to charge, when to leave, a backup for each), start the trip, and
// follow it: the next stop, alerts when a stop is full and the plan switches,
// and the charging coach while plugged in.
import { useEffect, useState } from 'preact/hooks';
import { api, toast, type State } from '../lib/brain.ts';
import type { Coach, CurvePoint, PlannedWaypoint, PlanStop, RoadTripView, TripPlan, TripWaypoint } from '../../../brain/src/types.ts';
import { STAY_BY_KIND } from '../../../brain/src/roadtrip/types.ts';
import { fmtTime } from '../lib/fmt.ts';
import { Card } from './common.tsx';
import { WazeModal } from './charge.tsx';
import type { WP } from './drive.tsx';

const EMPTY: RoadTripView = { draft: null, active: null, progress: null, coach: null, alerts: [], destinations: [], presets: [], curve: { learnedBins: 0, samples: 0, points: [] } };

function useRoadTrip(ms = 5000) {
  const [v, setV] = useState<RoadTripView>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => { try { setV(await api<RoadTripView>('/api/roadtrip')); setErr(null); } catch (e) { setErr((e as Error).message); } };
  useEffect(() => { void load(); const id = setInterval(() => void load(), ms); return () => clearInterval(id); }, [ms]);
  return { v, setV, err, load };
}

const hm = (min: number) => { const m = Math.max(0, Math.round(min)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

export function RoadTrip({ s }: WP) {
  const { v, setV, err, load } = useRoadTrip();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, f: () => Promise<RoadTripView | TripPlan | unknown>) => {
    setBusy(label);
    try { await f(); await load(); } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  };
  const post = (path: string, body: unknown = {}) => api<RoadTripView>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  if (v.active) {
    return (
      <div class="rtgrid">
        <ActiveTrip v={v} busy={busy} onReplan={() => void run('replan', () => post('/api/roadtrip/replan'))} onEnd={() => void run('end', () => post('/api/roadtrip/stop').then(setV))} />
        <div class="rtside">
          {v.coach && <CoachCard c={v.coach} />}
          <CurveCard v={v} />
        </div>
      </div>
    );
  }
  return (
    <div class="rtgrid">
      <div class="rtmain">
        <Planner s={s} v={v} busy={busy} onPlan={(body) => void run('plan', () => post('/api/roadtrip/plan', body))} />
        {err && <div class="banner">{err}</div>}
        {v.draft && <PlanCard p={v.draft} busy={busy}
          onStart={() => void run('start', () => post('/api/roadtrip/start', { planId: v.draft!.id }))}
          onDiscard={() => void run('discard', () => post('/api/roadtrip/discard'))} />}
      </div>
      <div class="rtside">
        {v.coach && <CoachCard c={v.coach} />}
        <CurveCard v={v} />
      </div>
    </div>
  );
}

type Dest = { name: string; lat: number; lon: number; placeId?: number; kind?: string | null; chargeKw?: number | null };
type Stop = TripWaypoint;

const KINDS: { id: string; label: string }[] = [
  { id: 'restaurant', label: 'Restaurant' }, { id: 'friend', label: 'Friend / family' }, { id: 'hotel', label: 'Hotel' },
  { id: 'home', label: 'Home' }, { id: 'work', label: 'Work' }, { id: 'other', label: 'Other' },
];
const kindLabel = (k: string | null | undefined) => KINDS.find((x) => x.id === k)?.label ?? null;
const stayLabel = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

function Planner({ s, v, busy, onPlan }: { s: State | null; v: RoadTripView; busy: string | null; onPlan: (b: { to: Dest; from?: Dest; startSoc: number | null; via?: Stop[] }) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Dest[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [soc, setSoc] = useState<number | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [saving, setSaving] = useState<Dest | null>(null);
  const cur = s?.soc ?? null;
  const startSoc = soc ?? (cur === null ? null : Math.round(cur));
  const search = async () => {
    setSearchErr(null);
    try { const r = await api<{ results: Dest[] }>(`/api/geocode/search?q=${encodeURIComponent(q)}`); setHits(r.results); if (!r.results.length) setSearchErr('Nothing found.'); }
    catch (e) { setHits(null); setSearchErr((e as Error).message); }
  };
  const go = (d: Dest) => onPlan({ to: d, startSoc: soc, via: stops });
  const addStop = (d: Dest) => setStops([...stops, { name: d.name, lat: d.lat, lon: d.lon, placeId: d.placeId ?? null, kind: d.kind ?? null, stayMin: STAY_BY_KIND[d.kind ?? 'other'] ?? 30, chargeKw: d.chargeKw ?? null }].slice(0, 8));
  const editStop = (i: number, patch: Partial<Stop>) => setStops(stops.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const planning = busy === 'plan';
  const list = (hits ?? v.destinations).slice(0, 10);
  return (
    <Card label="Plan a road trip" right={planning ? <span class="tag accent">Planning…</span> : undefined}>
      {v.presets.length > 0 && (
        <div class="rtdests">
          {v.presets.map((p) => <button type="button" class="btn primary" disabled={planning} onClick={() => onPlan({ from: p.from, to: p.to, startSoc: p.startSoc, via: stops })}>{p.name} · leave at {p.startSoc}%</button>)}
        </div>
      )}
      <form class="row" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) void search(); }}>
        <input class="grow rtinput" type="search" placeholder="Where to? (town, address or place)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Destination" />
        <button class="btn" type="submit" disabled={q.trim().length < 3 || planning}>Search</button>
        {hits && <button class="btn" type="button" onClick={() => { setHits(null); setQ(''); }}>Saved places</button>}
      </form>
      {searchErr && <div class="dimtxt" style="font-size:14px">{searchErr}</div>}
      <div class="rtplaces">
        {list.map((d) => (
          <div class="rtplace">
            <div class="grow"><b>{d.name}</b>{(kindLabel(d.kind) || d.chargeKw) && <span class="dimtxt"> · {[kindLabel(d.kind), d.chargeKw ? `charging ${d.chargeKw} kW` : null].filter(Boolean).join(' · ')}</span>}</div>
            {hits && !d.placeId && <button type="button" class="btn sm" onClick={() => setSaving(d)}>Save</button>}
            <button type="button" class="btn sm" disabled={planning || stops.length >= 8} onClick={() => addStop(d)} title="Stop here on the way">+ Stop</button>
            <button type="button" class="btn sm primary" disabled={planning || startSoc === null} onClick={() => go(d)} title={`Plan a trip to ${d.name}`}>Go</button>
          </div>
        ))}
        {!hits && !v.destinations.length && <span class="dimtxt" style="font-size:14px">Search for a place, or save places (restaurants, friends' houses) to find them here.</span>}
      </div>
      {saving && <SavePlace d={saving} onDone={(saved) => { setSaving(null); if (saved) setHits(null); }} />}
      {stops.length > 0 && (
        <div class="rtvia">
          <div class="lbl">Stops along the way, in order</div>
          {stops.map((w, i) => (
            <div class="rtviarow">
              <span class="rtnum sm">{i + 1}</span>
              <b class="grow">{w.name}</b>
              <label class="dimtxt">stay <input type="number" min={0} max={1440} step={15} value={w.stayMin} onInput={(e) => editStop(i, { stayMin: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} /> min</label>
              <label class="dimtxt">charge <input type="number" min={0} max={350} step={0.1} value={w.chargeKw ?? ''} placeholder="none" onInput={(e) => { const n = Number((e.target as HTMLInputElement).value); editStop(i, { chargeKw: n > 0 ? n : null }); }} /> kW</label>
              <button type="button" class="btn sm" aria-label={`Remove ${w.name}`} onClick={() => setStops(stops.filter((_, k) => k !== i))}>✕</button>
            </div>
          ))}
          <div class="dimtxt" style="font-size:13px">Now pick where you're going (Go). Charging during a stay counts: a wall outlet is about 1.4 kW, a Level 2 charger 7 kW.</div>
        </div>
      )}
      <div class="row between rtstart">
        <span class="dimtxt">Leaving with</span>
        <div class="row" style="gap:8px">
          <input type="range" min={10} max={100} step={1} value={startSoc ?? 80} aria-label="Starting charge level" onInput={(e) => setSoc(Number((e.target as HTMLInputElement).value))} />
          <b class="num" style="min-width:52px;text-align:right">{startSoc === null ? '?' : `${startSoc}%`}</b>
          {soc !== null && <button type="button" class="btn sm" onClick={() => setSoc(null)}>Now</button>}
        </div>
      </div>
      <div class="dimtxt" style="font-size:13px">Plans the fastest set of charging stops from the truck's charging curve, the climbs, the heat and your charging preferences, around your stops, arriving everywhere above your minimum charge.</div>
    </Card>
  );
}

/** Save a searched address as a place: what it is, and whether you can charge there. */
function SavePlace({ d, onDone }: { d: Dest; onDone: (saved: boolean) => void }) {
  const [name, setName] = useState(d.name.split(',')[0]);
  const [kind, setKind] = useState('restaurant');
  const [kw, setKw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try {
      await api('/api/places', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), lat: d.lat, lon: d.lon, kind, chargeKw: Number(kw) > 0 ? Number(kw) : null }) });
      toast(`Saved ${name.trim()}`); onDone(true);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div class="rtsave">
      <label class="f"><span>Name</span><input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <label class="f"><span>What it is</span><select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)}>{KINDS.map((k) => <option value={k.id}>{k.label}</option>)}</select></label>
      <label class="f"><span>Charging there (kW)</span><input type="number" min={0} max={350} step={0.1} value={kw} placeholder="none" onInput={(e) => setKw((e.target as HTMLInputElement).value)} /></label>
      <div class="row"><button class="btn primary" type="button" disabled={!name.trim()} onClick={() => void save()}>Save place</button><button class="btn" type="button" onClick={() => onDone(false)}>Cancel</button>{err && <span class="err">{err}</span>}</div>
    </div>
  );
}

const usd = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;

function Summary({ p }: { p: TripPlan }) {
  const r = p.result;
  const stayMin = (p.via ?? []).reduce((a, w) => a + w.stayMin, 0);
  const stopMin = Math.max(0, r.totalMin - r.driveMin - r.chargeMin - stayMin);
  const pct = (m: number) => `${r.totalMin > 0 ? (m / r.totalMin) * 100 : 0}%`;
  const gas = p.gas;
  return (
    <div class="rtsummary">
      <div class="rtsum">
        <div><b class="num">{p.routeMiles}</b><small>mi</small></div>
        <div><b class="num">{hm(r.totalMin)}</b><small>total</small></div>
        <div><b class="num">{r.stops.length}</b><small>{r.stops.length === 1 ? 'stop' : 'stops'}</small></div>
        <div><b class="num">{r.stops.length ? usd(r.chargeCost) : '$0'}</b><small>charging, est.</small></div>
        <div>{r.feasible ? <><b class="num">{r.arriveSoc}%</b><small>arrive {fmtTime(r.arriveAt)}</small></> : <><b class="num">—</b><small>can’t reach</small></>}</div>
      </div>
      <div class="rttime" role="img" aria-label={`Driving ${hm(r.driveMin)}, charging ${hm(r.chargeMin)}, stops ${hm(stopMin)}`}>
        <span class="seg-drive" style={{ width: pct(r.driveMin) }} />
        <span class="seg-charge" style={{ width: pct(r.chargeMin) }} />
        <span class="seg-stops" style={{ width: pct(stopMin) }} />
        <span class="seg-stay" style={{ width: pct(stayMin) }} />
      </div>
      <div class="rttimekey num">
        <span><i class="seg-drive" />Driving <b>{hm(r.driveMin)}</b></span>
        <span><i class="seg-charge" />Charging <b>{hm(r.chargeMin)}</b></span>
        {stopMin >= 1 && <span><i class="seg-stops" />Pulling in and out <b>{hm(stopMin)}</b></span>}
        {stayMin > 0 && <span><i class="seg-stay" />Your stops <b>{hm(stayMin)}</b></span>}
        <span class="dimtxt">Charging adds {r.driveMin > 0 ? Math.round(((r.chargeMin + stopMin) / r.driveMin) * 100) : 0}% to the drive</span>
      </div>
      {r.stops.length > 0 && (
        <div class="dimtxt rtcost">
          {r.kwh} kWh for the trip; {usd(r.chargeCost)} at the fast chargers{r.typicalPriceStops ? ` (${r.typicalPriceStops} stop${r.typicalPriceStops === 1 ? '' : 's'} at a typical $0.48/kWh: no listed price)` : ''}, plus the charge you leave with.
          {gas && <> The {gas.label} would burn {gas.gallons} gal at {usd(gas.pricePerGallon)}: <b>{usd(gas.cost)}</b>{gas.cost > r.chargeCost ? `, so this trip saves about ${usd(gas.cost - r.chargeCost)}` : `, about ${usd(r.chargeCost - gas.cost)} less than fast charging the whole way (charging at home is where the savings are)`}.</>}
        </div>
      )}
    </div>
  );
}

function PlanCard({ p, busy, onStart, onDiscard }: { p: TripPlan; busy: string | null; onStart: () => void; onDiscard: () => void }) {
  const [waze, setWaze] = useState<PlanStop | null>(null);
  const r = p.result;
  return (
    <Card label={`To ${p.to.name}`} right={<span class="dimtxt" style="font-size:13px">leaving at {p.startSoc}%</span>}>
      <Summary p={p} />
      {p.warnings.map((w) => <div class="banner" style="font-size:14px">{w}</div>)}
      {!r.feasible && <div class="banner bad">{r.note}</div>}
      {r.feasible && r.note && <div class="banner ok">{r.note}</div>}
      <Stops stops={r.stops} via={p.via ?? []} onWaze={setWaze} />
      <div class="row wrap">
        <button class="btn primary" type="button" disabled={!r.feasible || !!busy} onClick={onStart}>{busy === 'start' ? 'Starting…' : 'Start trip'}</button>
        <button class="btn" type="button" disabled={!!busy} onClick={onDiscard}>Discard</button>
      </div>
      <div class="attrib">Route: {p.routeSource === 'osrm' ? 'OpenStreetMap via OSRM' : 'straight line (no router)'}{p.elevation ? '; elevation: Open-Meteo' : ''}. {p.candidates} fast chargers near the route. Navigation stays in Waze.</div>
      {waze && <WazeModal ch={waze as never} onClose={() => setWaze(null)} />}
    </Card>
  );
}

/** One of your own stops in the timeline: when you get there and leave, and any charging while you stay. */
function ViaRow({ w }: { w: PlannedWaypoint }) {
  return (
    <li class="item rtviastop">
      <div class="row" style="align-items:flex-start">
        <div class="rtnum via" aria-hidden="true">●</div>
        <div class="grow">
          <h4 class="clamp2">{w.name}</h4>
          <div class="chmeta">{[kindLabel(w.kind), `mile ${Math.round(w.routeMi)}`, `stay ${stayLabel(w.stayMin)}`].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div class="rtcharge num">
        <span>Arrive <b>{w.arriveSoc}%</b> at {fmtTime(w.arriveAt)}</span>
        <span class="rtarrow">→</span>
        <span>leave <b>{fmtTime(w.departAt)}</b>{w.departSoc > w.arriveSoc ? <> with <b>{w.departSoc}%</b> ({w.chargeKw} kW while you stay)</> : ''}</span>
      </div>
    </li>
  );
}

/** One charging stop: arrive, charge to, minutes, cost, leave by, backup. */
function ChargeRow({ s, n, sel, done, onWaze }: { s: PlanStop; n: number; sel: boolean; done: boolean; onWaze: (s: PlanStop) => void }) {
  return (
    <li class={`item rtstop${sel ? ' sel' : ''}${done ? ' done' : ''}`}>
      <div class="row" style="align-items:flex-start">
        <div class="rtnum">{n}</div>
        <div class="grow">
          <h4 class="clamp2">{s.name}</h4>
          <div class="chmeta num">mile {Math.round(s.routeMi)} · {s.maxKw ? `${Math.round(s.maxKw)} kW` : 'kW ?'} · {s.network ?? 'Network unknown'}{s.offMi >= 1 ? ` · ${s.offMi} mi off route` : ''}</div>
        </div>
        <button class="gobtn" type="button" onClick={() => onWaze(s)} aria-label={`Send ${s.name} to Waze`} title="Send to Waze">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z" /></svg>
        </button>
      </div>
      <div class="rtcharge num">
        <span>Arrive <b>{s.arriveSoc}%</b> at {fmtTime(s.arriveAt)}</span>
        <span class="rtarrow">→</span>
        <span>charge to <b>{s.departSoc}%</b></span>
        <span class="dimtxt">{s.chargeMin} min · ~{s.avgKw} kW</span>
        <span title={s.priceSource === 'paid' ? 'What you paid here last time' : s.priceSource === 'listed' ? 'The site’s listed price' : 'No price listed: a typical DC price'}>~<b>{usd(s.cost)}</b> <span class="dimtxt">({s.kwhBought} kWh at {usd(s.pricePerKwh)}{s.priceSource === 'paid' ? ', what you paid' : s.priceSource === 'typical' ? ', typical' : ''})</span></span>
        <span>leave by <b>{fmtTime(s.departAt)}</b></span>
      </div>
      {s.availability && s.availability.total > 0 && <div class={`tag ${s.availability.available ? 'ok' : 'bad'}`} style="justify-self:start">{s.availability.available} of {s.availability.total} stalls free</div>}
      <div class="dimtxt rtbackup">{s.backup ? <>Backup: <b>{s.backup.name}</b> (mile {Math.round(s.backup.routeMi)}{s.backup.extraMin ? `, +${s.backup.extraMin} min` : ''})</> : <span style="color:var(--warn)">No backup in reach: charge a little extra at the stop before.</span>}</div>
      {s.reasons.length > 0 && <div class="reasons">{s.reasons.slice(0, 4).map((x) => <span class={/Slow last time|avoid|needs an adapter|busy/i.test(x) ? 'neg' : /You paid|stalls free|full speed/.test(x) ? 'pos' : ''}>{x}</span>)}</div>}
    </li>
  );
}

/** Charging stops and your own stops, in the order you reach them. */
function Stops({ stops, via = [], done = [], next = null, onWaze }: { stops: PlanStop[]; via?: PlannedWaypoint[]; done?: string[]; next?: number | null; onWaze: (s: PlanStop) => void }) {
  if (!stops.length && !via.length) return null;
  type Row = { at: number; stop?: PlanStop; i?: number; via?: PlannedWaypoint };
  const rows: Row[] = [...stops.map((s, i) => ({ at: Date.parse(s.arriveAt), stop: s, i })), ...via.map((w) => ({ at: Date.parse(w.arriveAt), via: w }))].sort((a, b) => a.at - b.at);
  return (
    <ol class="rtstops">
      {rows.map((r) => (r.via ? <ViaRow w={r.via} /> : <ChargeRow s={r.stop!} n={r.i! + 1} sel={r.i === next} done={done.includes(r.stop!.id)} onWaze={onWaze} />))}
    </ol>
  );
}

function ActiveTrip({ v, busy, onReplan, onEnd }: { v: RoadTripView; busy: string | null; onReplan: () => void; onEnd: () => void }) {
  const [waze, setWaze] = useState<PlanStop | null>(null);
  const p = v.active!;
  const pr = v.progress;
  const stops = p.result.stops;
  const next = pr?.nextStop ?? null;
  const ns = next !== null ? stops[next] : null;
  return (
    <div class="rtmain">
      <Card label={`On the way to ${p.to.name}`} right={<span class="dimtxt num">{pr ? `${pr.milesLeft} mi left` : ''}</span>}>
        {v.alerts.filter((a) => a.kind !== 'info').slice(0, 2).map((a) => <div class={`banner ${a.kind === 'full' ? 'bad' : ''}`}><b>{fmtTime(a.at)}</b> {a.message}</div>)}
        {ns ? (
          <div class="rtnext">
            <div class="lbl">{pr?.atStop ? 'At the stop' : 'Next stop'}</div>
            <div class="rtnextname">{ns.name}</div>
            <div class="num">{pr?.atStop ? <>Charge to <b>{ns.departSoc}%</b>, leave by {fmtTime(ns.departAt)}</> : <>Arrive ~<b>{pr?.nextArriveSoc ?? ns.arriveSoc}%</b> (plan {ns.arriveSoc}%) · charge to {ns.departSoc}%</>}</div>
            <div class="row wrap">
              <button class="btn primary" type="button" onClick={() => setWaze(ns)}>Waze to this stop</button>
              {ns.backup && <span class="dimtxt" style="font-size:14px">Backup: {ns.backup.name}</span>}
            </div>
          </div>
        ) : <div class="banner ok">No more charging stops: arrive with about {p.result.arriveSoc}%.</div>}
        <Summary p={p} />
        <div class="row wrap">
          <button class="btn" type="button" disabled={!!busy} onClick={onReplan}>{busy === 'replan' ? 'Replanning…' : 'Replan from here'}</button>
          <button class="btn" type="button" disabled={!!busy} onClick={onEnd}>End trip</button>
        </div>
      </Card>
      <Card label="Stops">
        <Stops stops={stops} via={p.via ?? []} next={next} onWaze={setWaze} />
      </Card>
      {waze && <WazeModal ch={waze as never} onClose={() => setWaze(null)} />}
    </div>
  );
}

export function CoachCard({ c }: { c: Coach }) {
  const tone = c.state === 'go' ? 'ok' : c.state === 'slow' ? 'bad' : '';
  return (
    <Card label="Charging coach" class={`coach ${tone}`}>
      <div class={`coachmsg ${tone}`}>{c.state === 'go' ? <><span class="gobig">GO</span>{c.message.replace(/^GO:\s*/, '')}</> : c.message}</div>
      {c.detail && <div class="dimtxt">{c.detail}</div>}
      <div class="rtsum">
        <div><b class="num">{c.soc === null ? '?' : `${Math.round(c.soc)}%`}</b><small>now</small></div>
        {c.targetSoc !== null && <div><b class="num">{Math.round(c.targetSoc)}%</b><small>target</small></div>}
        {c.minutesLeft !== null && c.state !== 'go' && <div><b class="num">{c.minutesLeft}</b><small>min left</small></div>}
        {c.kwNow !== null && <div><b class="num">{c.kwNow}</b><small>kW now{c.kwExpected ? ` (~${c.kwExpected})` : ''}</small></div>}
      </div>
    </Card>
  );
}

/** The charging curve: generic until the truck has charged on DC, then learned bin by bin. */
function CurveCard({ v }: { v: RoadTripView }) {
  const pts = v.curve.points;
  if (!pts.length) return null;
  const max = Math.max(...pts.map((p) => p.kw), 1);
  const W = 300, H = 120, bw = W / pts.length;
  return (
    <Card label="Charging curve" right={<span class={`tag ${v.curve.learnedBins ? 'ok' : 'dim'}`}>{v.curve.learnedBins ? `${v.curve.learnedBins} of ${pts.length} learned` : 'generic'}</span>}>
      <svg class="rtcurve" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Charging power by charge level">
        {pts.map((p: CurvePoint, i) => {
          const h = (p.kw / max) * H;
          return <rect x={i * bw + 1} y={H - h} width={bw - 2} height={h} rx="2" class={p.learned ? 'learned' : ''}><title>{`${p.soc}-${p.soc + 5}%: ${p.kw} kW${p.learned ? ` (learned, ${p.samples} samples)` : ''}`}</title></rect>;
        })}
        {[0, 50, 100].map((x) => <text x={(x / 100) * W} y={H + 14} text-anchor={x === 0 ? 'start' : x === 100 ? 'end' : 'middle'}>{x}%</text>)}
      </svg>
      <div class="dimtxt" style="font-size:13px">{v.curve.learnedBins ? 'Bright bars are learned from this truck’s own DC charging; the rest follow their scale.' : 'Slate hasn’t published a curve. This starts generic and learns from every DC charge.'} Fastest charging is below about 50%.</div>
    </Card>
  );
}
