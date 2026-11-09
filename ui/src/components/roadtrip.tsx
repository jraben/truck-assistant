// The Road trip screen: pick a destination, see the planned charging stops
// (how much to charge, when to leave, a backup for each), start the trip, and
// follow it: the next stop, alerts when a stop is full and the plan switches,
// and the charging coach while plugged in.
import { useEffect, useState } from 'preact/hooks';
import { api, toast, type State } from '../lib/brain.ts';
import type { Coach, CurvePoint, PlanStop, RoadTripView, TripPlan } from '../../../brain/src/types.ts';
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

type Dest = { name: string; lat: number; lon: number };

function Planner({ s, v, busy, onPlan }: { s: State | null; v: RoadTripView; busy: string | null; onPlan: (b: { to: Dest; from?: Dest; startSoc: number | null }) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Dest[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [soc, setSoc] = useState<number | null>(null);
  const cur = s?.soc ?? null;
  const startSoc = soc ?? (cur === null ? null : Math.round(cur));
  const search = async () => {
    setSearchErr(null);
    try { const r = await api<{ results: Dest[] }>(`/api/geocode/search?q=${encodeURIComponent(q)}`); setHits(r.results); if (!r.results.length) setSearchErr('Nothing found.'); }
    catch (e) { setHits(null); setSearchErr((e as Error).message); }
  };
  const pick = (d: Dest) => onPlan({ to: d, startSoc: soc });
  const planning = busy === 'plan';
  return (
    <Card label="Plan a road trip" right={planning ? <span class="tag accent">Planning…</span> : undefined}>
      {v.presets.length > 0 && (
        <div class="rtdests">
          {v.presets.map((p) => <button type="button" class="btn primary" disabled={planning} onClick={() => onPlan({ from: p.from, to: p.to, startSoc: p.startSoc })}>{p.name} · leave at {p.startSoc}%</button>)}
        </div>
      )}
      <form class="row" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) void search(); }}>
        <input class="grow rtinput" type="search" placeholder="Where to? (town or address)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Destination" />
        <button class="btn" type="submit" disabled={q.trim().length < 3 || planning}>Search</button>
      </form>
      {searchErr && <div class="dimtxt" style="font-size:14px">{searchErr}</div>}
      <div class="rtdests">
        {(hits ?? v.destinations).slice(0, 8).map((d) => (
          <button type="button" class="btn" disabled={planning || startSoc === null} onClick={() => pick(d)} title={`Plan a trip to ${d.name}`}>{d.name}</button>
        ))}
        {!hits && !v.destinations.length && <span class="dimtxt" style="font-size:14px">Search for a destination, or save places on the Trips screen to see them here.</span>}
      </div>
      <div class="row between rtstart">
        <span class="dimtxt">Leaving with</span>
        <div class="row" style="gap:8px">
          <input type="range" min={10} max={100} step={1} value={startSoc ?? 80} aria-label="Starting charge level" onInput={(e) => setSoc(Number((e.target as HTMLInputElement).value))} />
          <b class="num" style="min-width:52px;text-align:right">{startSoc === null ? '?' : `${startSoc}%`}</b>
          {soc !== null && <button type="button" class="btn sm" onClick={() => setSoc(null)}>Now</button>}
        </div>
      </div>
      <div class="dimtxt" style="font-size:13px">Plans the fastest set of stops from the truck's charging curve, the climbs, the heat and your charging preferences, arriving everywhere above your minimum charge.</div>
    </Card>
  );
}

const usd = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;

function Summary({ p }: { p: TripPlan }) {
  const r = p.result;
  const stopMin = Math.max(0, r.totalMin - r.driveMin - r.chargeMin);
  const pct = (m: number) => `${r.totalMin > 0 ? (m / r.totalMin) * 100 : 0}%`;
  const gas = p.gas;
  return (
    <div class="rtsummary">
      <div class="rtsum">
        <div><b class="num">{p.routeMiles}</b><small>mi</small></div>
        <div><b class="num">{hm(r.totalMin)}</b><small>total</small></div>
        <div><b class="num">{r.stops.length}</b><small>{r.stops.length === 1 ? 'stop' : 'stops'}</small></div>
        <div><b class="num">{r.stops.length ? usd(r.chargeCost) : '$0'}</b><small>charging, est.</small></div>
        <div><b class="num">{r.arriveSoc}%</b><small>arrive {fmtTime(r.arriveAt)}</small></div>
      </div>
      <div class="rttime" role="img" aria-label={`Driving ${hm(r.driveMin)}, charging ${hm(r.chargeMin)}, stops ${hm(stopMin)}`}>
        <span class="seg-drive" style={{ width: pct(r.driveMin) }} />
        <span class="seg-charge" style={{ width: pct(r.chargeMin) }} />
        <span class="seg-stops" style={{ width: pct(stopMin) }} />
      </div>
      <div class="rttimekey num">
        <span><i class="seg-drive" />Driving <b>{hm(r.driveMin)}</b></span>
        <span><i class="seg-charge" />Charging <b>{hm(r.chargeMin)}</b></span>
        {stopMin >= 1 && <span><i class="seg-stops" />Pulling in and out <b>{hm(stopMin)}</b></span>}
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
      <Stops stops={r.stops} onWaze={setWaze} />
      <div class="row wrap">
        <button class="btn primary" type="button" disabled={!r.feasible || !!busy} onClick={onStart}>{busy === 'start' ? 'Starting…' : 'Start trip'}</button>
        <button class="btn" type="button" disabled={!!busy} onClick={onDiscard}>Discard</button>
      </div>
      <div class="attrib">Route: {p.routeSource === 'osrm' ? 'OpenStreetMap via OSRM' : 'straight line (no router)'}{p.elevation ? '; elevation: Open-Meteo' : ''}. {p.candidates} fast chargers near the route. Navigation stays in Waze.</div>
      {waze && <WazeModal ch={waze as never} onClose={() => setWaze(null)} />}
    </Card>
  );
}

function Stops({ stops, done = [], next = null, onWaze }: { stops: PlanStop[]; done?: string[]; next?: number | null; onWaze: (s: PlanStop) => void }) {
  if (!stops.length) return null;
  return (
    <ol class="rtstops">
      {stops.map((s, i) => (
        <li class={`item rtstop${i === next ? ' sel' : ''}${done.includes(s.id) ? ' done' : ''}`}>
          <div class="row" style="align-items:flex-start">
            <div class="rtnum">{i + 1}</div>
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
      ))}
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
        <Stops stops={stops} next={next} onWaze={setWaze} />
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
