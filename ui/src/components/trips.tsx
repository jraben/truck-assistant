import { useEffect, useState } from 'preact/hooks';
import { api, settingsStore, useStore, type ImportJob, type Place, type PlaceSuggestion, type Stop, type TimelineItem, type Trip, type TripPoint } from '../lib/brain.ts';
import { fmtDate, fmtDuration, fmtTime } from '../lib/fmt.ts';
import { Card, Modal, V } from './common.tsx';
import type { WP } from './drive.tsx';
import { DrivingLock, ModeSplit } from '../drive/Lock.tsx';
import { logsStore } from '../lib/panels.ts';

type Detail = Trip & { points: TripPoint[] };
type Tab = 'day' | 'trips' | 'places';

const stopName = (n: string | null | undefined) => n ?? 'Unnamed stop';
export const tripTitle = (t: Trip) => (t.from || t.to ? `${stopName(t.from?.name)} → ${t.to ? stopName(t.to.name) : t.endedAt ? 'Unnamed stop' : 'driving'}` : `${fmtTime(t.startedAt)} trip`);
const localDay = (d: Date) => d.toLocaleDateString('en-CA');
const shiftDay = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number); return localDay(new Date(y, m - 1, d + n)); };

function PhoneTag() { return <span class="tag dim" title="Replayed from the phone's location history: straight lines between sparse points">from phone, approximate</span>; }

export function Trips({ s }: WP) {
  const settings = useStore(settingsStore);
  const [tab, setTab] = useState<Tab>('day');
  const [driver, setDriver] = useState<string>('');
  const [day, setDay] = useState(() => localDay(new Date()));
  const [timeline, setTimeline] = useState<TimelineItem[] | null>(null);
  const [list, setList] = useState<Trip[] | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [sugg, setSugg] = useState<PlaceSuggestion[]>([]);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [naming, setNaming] = useState<{ stopId: number; name: string } | null>(null);

  const q = driver ? `driver=${encodeURIComponent(driver)}` : '';
  const load = async () => {
    try {
      if (tab === 'day') setTimeline((await api<{ items: TimelineItem[] }>(`/api/timeline?date=${day}${q ? `&${q}` : ''}`)).items);
      if (tab === 'trips') { const l = await api<Trip[]>(`/api/trips?limit=100${q ? `&${q}` : ''}`); setList(l); if (sel === null && l.length) setSel(l[0].id); }
      if (tab === 'places') { const [p, g] = await Promise.all([api<Place[]>(`/api/places?${q}`), api<PlaceSuggestion[]>(`/api/places/suggestions?${q}`)]); setPlaces(p); setSugg(g); }
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void load(); }, [tab, day, driver, s?.trip?.id ?? null, s?.place?.stopId ?? null, s?.place?.name ?? null]);

  // Phone import in progress (started from /settings): show it, and reload when it finishes.
  useEffect(() => {
    let live = true;
    const f = () => api<ImportJob | null>('/api/import/phone').then((j) => { if (!live) return; if (job?.state === 'running' && j?.state !== 'running') void load(); setJob(j); }).catch(() => {});
    void f();
    const id = setInterval(f, job?.state === 'running' ? 2000 : 20_000);
    return () => { live = false; clearInterval(id); };
  }, [job?.state]);

  useEffect(() => {
    if (sel === null) { setDetail(null); return; }
    let live = true;
    const get = () => api<Detail>(`/api/trips/${sel}`).then((d) => { if (live) setDetail(d); }).catch(() => {});
    void get();
    const id = s?.trip?.id === sel ? setInterval(get, 10_000) : undefined; // the trip in progress keeps drawing
    return () => { live = false; clearInterval(id); };
  }, [sel, s?.trip?.id]);

  // The energy review (Leaflet and the chart) loads only when it's opened.
  const [energy, setEnergy] = useState<{ C: typeof import('./TripEnergy.tsx').TripEnergy } | null>(null);
  const openEnergy = async () => {
    try { const m = await import('./TripEnergy.tsx'); setEnergy({ C: m.TripEnergy }); } catch (e) { setErr(`Couldn't open the energy view: ${(e as Error).message}`); }
  };

  const drivers = settings?.drivers ?? [];
  const nameOf = (id: string | null) => drivers.find((d) => d.id === id)?.name ?? null;

  return (
    <DrivingLock what="list" summary={s?.trip ? <>This trip: <b class="num">{s.trip.miles.toFixed(1)} mi</b></> : null}>
    <div class="trips">
      <Card label="Trips" right={
        <div class="row" style="gap:var(--s05)">
          {(['day', 'trips', 'places'] as const).map((t) => <button type="button" class={`tag ${tab === t ? 'accent' : 'dim'}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>)}
          {/* The mileage and maintenance logs (they had their own rail icon) */}
          <button type="button" class="tag dim" onClick={() => logsStore.set('mileage')}>MILEAGE</button>
          <button type="button" class="tag dim" onClick={() => logsStore.set('maintenance')}>MAINTENANCE</button>
        </div>}>
        <div class="row wrap" style="gap:var(--s1)" role="group" aria-label="Whose trips">
          <button type="button" class={`btn sm ${driver === '' ? 'primary' : ''}`} onClick={() => setDriver('')}>Everyone</button>
          {drivers.filter((d) => !d.guest).map((d) => <button type="button" class={`btn sm ${driver === d.id ? 'primary' : ''}`} onClick={() => setDriver(d.id)}>{d.name}</button>)}
        </div>
        {job?.state === 'running' && <div class="banner" style="font-size:var(--fs-body-sm)">Importing {nameOf(job.driverId) ?? job.driverId}'s phone history: day {job.daysDone} of {job.daysTotal}…</div>}
        {job?.state === 'error' && <div class="banner bad" style="font-size:var(--fs-body-sm)">Phone import stopped: {job.error}</div>}
        {err && <div class="err">{err}</div>}

        {tab === 'day' && (
          <>
            <div class="row between">
              <button class="btn sm" type="button" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day">‹</button>
              <b>{day === localDay(new Date()) ? 'Today' : fmtDate(`${day}T12:00:00`)}</b>
              <button class="btn sm" type="button" disabled={day >= localDay(new Date())} onClick={() => setDay(shiftDay(day, 1))} aria-label="Next day">›</button>
            </div>
            {timeline && !timeline.length && <div class="dimtxt">Nothing recorded this day.</div>}
            <div class="list timeline">
              {timeline?.map((it) => it.kind === 'stop'
                ? <StopRow st={it} onName={() => setNaming({ stopId: it.id, name: it.nameSource === 'geocode' ? it.name ?? '' : '' })} />
                : <TripRow t={it} sel={it.id === sel} onClick={() => setSel(it.id)} />)}
            </div>
          </>
        )}

        {tab === 'trips' && (
          <>
            {list && !list.length && <div class="dimtxt">No trips yet. One starts when the ignition comes on, or import phone history on the settings page.</div>}
            <div class="list">
              {list?.map((t) => <TripRow t={t} sel={t.id === sel} showDate onClick={() => setSel(t.id)} driverName={!driver ? nameOf(t.driverId) : null} />)}
            </div>
          </>
        )}

        {tab === 'places' && (
          <>
            {sugg.map((g) => (
              <div class="item">
                <div class="row between">
                  <div>You've stopped here <b>{g.visits} times</b>{g.suggestedName ? <> · near {g.suggestedName}</> : ''}</div>
                  <button class="btn sm primary" type="button" onClick={() => setNaming({ stopId: g.stopIds[0], name: g.suggestedName ?? '' })}>Name it</button>
                </div>
              </div>
            ))}
            {places && !places.length && !sugg.length && <div class="dimtxt">No saved places yet. Tap "Name it" on a stop in the day view.</div>}
            <div class="list">
              {places?.map((p) => (
                <div class="item row between">
                  <b>{p.name}</b>
                  <span class="dimtxt num" style="font-size:var(--fs-body-sm)">{p.visits} visit{p.visits === 1 ? '' : 's'}{p.lastVisit ? ` · last ${fmtDate(p.lastVisit)}` : ''}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
      <Card class="route" label={detail ? `${tripTitle(detail)} · ${detail.miles.toFixed(1)} mi` : 'Route'} right={detail && (detail.source === 'phone'
        ? <PhoneTag />
        : <span class="dimtxt num" style="font-size:var(--fs-caption)">SoC <V v={detail.startSoc?.toFixed(0)} why="Charge level unknown at start" />% → <V v={detail.endSoc?.toFixed(0)} why={detail.endedAt ? 'Charge level unknown at end' : 'Trip in progress'} />%</span>)}>
        {detail && <ModeSplit t={detail} kwh />}
        {detail ? <RoutePlot pts={detail.points} /> : <div class="dimtxt">Pick a trip.</div>}
        {detail && detail.points.length > 1 && (
          <div class="row wrap" style="gap:var(--s1)">
            {detail.source === 'truck' && detail.endedAt && <button class="btn sm primary" type="button" onClick={() => void openEnergy()}>Energy</button>}
            <a class="btn sm" href={`/api/trips/${detail.id}/scene.gevbundle.json`} download title="A God's Eye View scene: IMPORT it in God's Eye's Scenes panel">Replay in God's Eye</a>
          </div>
        )}
      </Card>
      {energy && detail && <energy.C tripId={detail.id} title={tripTitle(detail)} onClose={() => setEnergy(null)} />}
      {naming && <NameStop stopId={naming.stopId} initial={naming.name} onClose={(saved) => { setNaming(null); if (saved) void load(); }} />}
    </div>
    </DrivingLock>
  );
}

function StopRow({ st, onName }: { st: Stop; onName: () => void }) {
  const named = st.nameSource === 'place' || st.nameSource === 'zone' || st.nameSource === 'feed';
  return (
    <div class="item stop">
      <div class="row between">
        <div class="grow ellip"><span class="pin" aria-hidden="true">●</span> <b>{stopName(st.name)}</b>{st.nameSource === 'geocode' && <span class="dimtxt" style="font-size:var(--fs-caption)"> · map</span>}</div>
        {!named && <button class="btn sm" type="button" onClick={onName}>Name it</button>}
      </div>
      <div class="row wrap dimtxt" style="font-size:var(--fs-body-sm)">
        <span>{fmtTime(st.arrivedAt)}{st.departedAt ? ` – ${fmtTime(st.departedAt)}` : st.source === 'truck' ? ' – now' : ''}</span>
        <span>{fmtDuration(st.durationS)}</span>
        {st.source === 'phone' && <span class="tag dim">phone</span>}
      </div>
    </div>
  );
}

function TripRow({ t, sel, onClick, showDate, driverName }: { t: Trip; sel: boolean; onClick: () => void; showDate?: boolean; driverName?: string | null }) {
  return (
    <button type="button" class={`item ${sel ? 'sel' : ''}`} onClick={onClick}>
      <div class="row between">
        <b class="ellip">{tripTitle(t)}</b>
        {t.endedAt === null && <span class="tag ok">NOW</span>}
      </div>
      <div class="row wrap dimtxt" style="font-size:var(--fs-body-sm)">
        {showDate && <span>{fmtDate(t.startedAt)} · {fmtTime(t.startedAt)}</span>}
        {!showDate && <span>{fmtTime(t.startedAt)}</span>}
        <span class="num">{t.source === 'phone' ? '~' : ''}{t.miles.toFixed(1)} mi</span><span>{fmtDuration(t.durationS)}</span>
        {t.kwhEst !== null && <span class="num">~{t.kwhEst.toFixed(1)} kWh</span>}
        {driverName && <span>{driverName}</span>}
        <ModeSplit t={t} />
        {t.source === 'phone' && <PhoneTag />}
      </div>
    </button>
  );
}

function NameStop({ stopId, initial, onClose }: { stopId: number; initial: string; onClose: (saved: boolean) => void }) {
  const [name, setName] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { await api(`/api/stops/${stopId}/name`, { method: 'PUT', body: JSON.stringify({ name }) }); onClose(true); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title="Name this place" onClose={() => onClose(false)}>
      <p class="dimtxt" style="margin:0">Every stop within about 120 m, past and future, gets this name.</p>
      <input type="text" value={name} placeholder="e.g. Costco, Mom's, the shop" autoFocus onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void save(); }} />
      <div class="row wrap">
        {['Home', 'Work', 'Gym', 'School', 'Store'].map((n) => <button class="btn sm" type="button" onClick={() => setName(n)}>{n}</button>)}
      </div>
      <div class="row"><button class="btn big primary" type="button" disabled={!name.trim()} onClick={() => void save()}>Save place</button>{err && <span class="err">{err}</span>}</div>
    </Modal>
  );
}

/** Plain SVG route: equirectangular, scaled by cos(lat), no map tiles. */
export function RoutePlot({ pts }: { pts: TripPoint[] }) {
  if (pts.length < 2) return <div class="dimtxt">Not enough GPS points to draw ({pts.length}).</div>;
  const k = Math.cos((pts[0].lat * Math.PI) / 180);
  const xs = pts.map((p) => p.lon * k), ys = pts.map((p) => -p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-5);
  const pad = span * 0.08;
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  const d = xs.map((x, i) => `${i ? 'L' : 'M'}${x} ${ys[i]}`).join(' ');
  const r = span * 0.012;
  return (
    <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Route of the selected trip">
      <path class="path" d={d} />
      <circle cx={xs[0]} cy={ys[0]} r={r} fill="var(--ok)" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={r} fill="var(--bad)" />
    </svg>
  );
}
