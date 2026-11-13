// A trip's energy, reviewed after the drive (GET /api/trips/:id/energy,
// brain/src/drive/energy.ts): power used and regenerated along the route,
// against height and speed, with the load it carried. Scrubbing the chart
// moves a marker on the map, so a hill or a fast stretch can be matched to
// where it was. Loaded only when opened (Leaflet), never while driving.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/brain.ts';
import { fmtDuration } from '../lib/fmt.ts';
import { isLight } from '../lib/theme.ts';
import { addOfflineAreas, osmLayer } from '../lib/basemap.ts';

type Point = { t: string; mi: number; lat: number; lon: number; altM: number | null; speedMph: number | null; powerKw: number; measured: boolean };
export type EnergyResp = {
  tripId: number;
  source: 'measured' | 'model' | 'mixed' | 'none';
  measuredShare: number;
  totals: { miles: number; movingS: number; usedKwh: number; regenKwh: number; netKwh: number; whPerMi: number | null; climbM: number | null; descentM: number | null; maxKw: number; maxRegenKw: number; driveKwh: number; techKwh: number; accessoryKwh: number; techMeasured: number; accessoryMeasured: number };
  breakdown: { rolling: number; aero: number; climbing: number; accelerating: number; aux: number; tech: number; accessories: number } | null;
  massLb: number;
  load: { lb: number | null; note: string | null };
  series: Point[];
};

const FT = 3.28084;
const k1 = (v: number) => v.toFixed(v < 10 ? 2 : 1);
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/** Power to colour: regen green, then cool to hot as the draw rises. Pure. */
export function powerColor(kw: number): string {
  if (kw < -0.5) return 'var(--ok, #2e9e5b)';
  if (kw < 12) return 'var(--accent, #4fc3d9)';
  if (kw < 30) return 'var(--warn, #f2b33d)';
  return 'var(--bad, #e5484d)';
}
const rawColor = (kw: number) => { const m = /var\((--[\w-]+), ([^)]+)\)/.exec(powerColor(kw))!; return cssVar(m[1]) || m[2]; };

const SOURCE: Record<EnergyResp['source'], string> = {
  measured: 'Measured: the truck’s own pack power',
  mixed: 'Part measured, part estimated',
  model: 'Estimated: physics model (no pack power from the truck yet)',
  none: 'Not enough samples',
};

export function TripEnergy({ tripId, title, onClose }: { tripId: number; title: string; onClose: () => void }) {
  const [e, setE] = useState<EnergyResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [lb, setLb] = useState('');
  const [note, setNote] = useState('');
  const load = () => api<EnergyResp>(`/api/trips/${tripId}/energy`).then((r) => { setE(r); setLb(r.load.lb === null ? '' : String(r.load.lb)); setNote(r.load.note ?? ''); }, (x: Error) => setErr(x.message));
  useEffect(() => { void load(); }, [tripId]);
  useEffect(() => { const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  const saveLoad = async () => {
    try { await api(`/api/trips/${tripId}/load`, { method: 'PUT', body: JSON.stringify({ lb: lb.trim() === '' ? null : Number(lb), note }) }); await load(); }
    catch (x) { setErr((x as Error).message); }
  };

  const t = e?.totals;
  return (
    <div class="scrim" onClick={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div class="modal energy" role="dialog" aria-modal="true" aria-label={`Energy: ${title}`}>
        <div class="row between"><h3 class="ellip">Energy · {title}</h3><button class="btn" type="button" onClick={onClose}>Close</button></div>
        {err && <div class="err">{err}</div>}
        {!e && !err && <div class="dimtxt">Loading…</div>}
        {e && t && (e.source === 'none' ? <div class="dimtxt">This trip has no energy samples (it was recorded before trip energy logging, or came from phone history).</div> : (
          <>
            <div class={`tag ${e.source === 'measured' ? 'ok' : 'dim'}`} style="justify-self:start">{SOURCE[e.source]}{e.source === 'mixed' ? ` (${Math.round(e.measuredShare * 100)}% measured)` : ''}</div>
            <div class="etiles">
              <Tile k="Used" v={`${k1(t.usedKwh)} kWh`} />
              <Tile k="Regenerated" v={`${k1(t.regenKwh)} kWh`} sub={t.usedKwh > 0 ? `${Math.round((t.regenKwh / t.usedKwh) * 100)}% back` : undefined} good />
              <Tile k="Net" v={`${k1(t.netKwh)} kWh`} sub={t.whPerMi !== null ? `${t.whPerMi} Wh/mi` : undefined} />
              <Tile k="Climb / descent" v={t.climbM === null ? '—' : `↑${Math.round(t.climbM * FT)} ft`} sub={t.descentM === null ? 'no GPS height' : `↓${Math.round(t.descentM * FT)} ft`} />
              <Tile k="Peak" v={`${t.maxKw} kW`} sub={`regen ${t.maxRegenKw} kW`} />
              <Tile k="Moving" v={fmtDuration(t.movingS)} sub={`${t.miles.toFixed(1)} mi`} />
            </div>
            <Split t={t} />
            <EnergyMap pts={e.series} hover={hover} />
            <Chart pts={e.series} hover={hover} onHover={setHover} />
            {e.breakdown && <Breakdown b={e.breakdown} regen={t.regenKwh} />}
            <div class="row wrap" style="gap:var(--s1);align-items:flex-end">
              <label class="f" style="width:170px"><span>Load beyond the driver, lb</span><input type="number" min={0} max={5000} value={lb} placeholder="0" onInput={(x) => setLb((x.target as HTMLInputElement).value)} /></label>
              <label class="f grow" style="min-width:180px"><span>What it was</span><input type="text" maxLength={80} value={note} placeholder="2 passengers, bed of mulch, the camper…" onInput={(x) => setNote((x.target as HTMLInputElement).value)} /></label>
              <button class="btn" type="button" onClick={() => void saveLoad()}>Save load</button>
            </div>
            <p class="help">Weight in the model: {e.massLb.toLocaleString()} lb (truck, driver{e.load.lb ? ', load' : ''}). {e.source === 'measured'
              ? 'Power is the pack’s own; the load is a label for comparing trips.'
              : 'The model’s numbers (drag, rolling resistance, efficiencies) are estimates on /settings → Truck: they show where the energy went better than exactly how much.'} Tech and accessories come from the truck box's current sensors where fitted, otherwise the rated watts in Settings.</p>
          </>
        ))}
      </div>
    </div>
  );
}

function Tile({ k, v, sub, good }: { k: string; v: string; sub?: string; good?: boolean }) {
  return <div class="etile"><span class="lbl">{k}</span><b class="num" style={good ? 'color:var(--ok)' : ''}>{v}</b>{sub && <span class="dimtxt num" style="font-size:var(--fs-caption)">{sub}</span>}</div>;
}

/** Driving vs the dash's tech vs switched accessories, as one bar. */
function Split({ t }: { t: EnergyResp['totals'] }) {
  const how = (share: number) => (share >= 0.95 ? 'measured' : share > 0.05 ? `${Math.round(share * 100)}% measured` : 'rated watts');
  const parts = [
    { k: 'Driving', v: Math.max(0, t.driveKwh), c: 'var(--accent)', how: '' },
    { k: 'Tech (dash, Pi, cameras, tablet)', v: t.techKwh, c: 'var(--warn)', how: how(t.techMeasured) },
    { k: 'Accessories (switched loads)', v: t.accessoryKwh, c: 'var(--fg-dim, #8a99a5)', how: how(t.accessoryMeasured) },
  ];
  const sum = parts.reduce((a, p) => a + p.v, 0) || 1;
  return (
    <div class="esplit">
      <div class="ebar" role="img" aria-label={parts.map((p) => `${p.k} ${k1(p.v)} kWh`).join(', ')}>
        {parts.map((p) => p.v > 0 && <span style={{ width: `${(p.v / sum) * 100}%`, background: p.c }} />)}
      </div>
      <div class="row wrap" style="gap:var(--s2);font-size:var(--fs-body-sm)">
        {parts.map((p) => <span><i class="dot" style={{ background: p.c }} /> {p.k}: <b class="num">{k1(p.v)} kWh</b> <span class="dimtxt">({Math.round((p.v / sum) * 100)}%{p.how ? `, ${p.how}` : ''})</span></span>)}
      </div>
    </div>
  );
}

function Breakdown({ b, regen }: { b: NonNullable<EnergyResp['breakdown']>; regen: number }) {
  const rows: [string, number][] = [['Air drag', b.aero], ['Rolling', b.rolling], ['Climbing', b.climbing], ['Speeding up', b.accelerating], ['Truck systems (climate etc.)', b.aux], ['Tech', b.tech], ['Accessories', b.accessories]];
  const max = Math.max(...rows.map((r) => r[1]), regen, 0.001);
  return (
    <div class="ebreak">
      <span class="lbl">Where it went (model)</span>
      {rows.map(([k, v]) => <div class="ebrow"><span>{k}</span><span class="ebtrack"><span style={{ width: `${(v / max) * 100}%` }} /></span><b class="num">{k1(v)}</b></div>)}
      <div class="ebrow good"><span>Back from regen</span><span class="ebtrack"><span style={{ width: `${(regen / max) * 100}%` }} /></span><b class="num">−{k1(regen)}</b></div>
    </div>
  );
}

/** The route on the map, each stretch coloured by its power; the scrubbed point marked. */
function EnergyMap({ pts, hover }: { pts: Point[]; hover: number | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const mark = useRef<L.CircleMarker | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  useEffect(() => {
    if (!el.current || pts.length < 2) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, zoomSnap: 0.25 });
    m.getContainer().classList.toggle('wx-dark', !isLight(cssVar('--bg') || '#000000'));
    const base = osmLayer();
    base.on('tileerror', () => setTilesFailed(true));
    base.addTo(m);
    // Downloaded areas (Settings, Offline maps) draw from the Pi with no signal. Light style: a dark theme inverts the whole tile pane (.wx-dark).
    void addOfflineAreas(m, false);
    for (let i = 1; i < pts.length; i++) {
      L.polyline([[pts[i - 1].lat, pts[i - 1].lon], [pts[i].lat, pts[i].lon]], { color: rawColor(pts[i].powerKw), weight: 5, opacity: 0.9, interactive: false }).addTo(m);
    }
    m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon] as [number, number])), { padding: [16, 16] });
    map.current = m;
    return () => { m.remove(); map.current = null; mark.current = null; };
  }, [pts]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (hover === null) { mark.current?.remove(); mark.current = null; return; }
    const p = pts[hover];
    if (!mark.current) mark.current = L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 3, fillColor: rawColor(p.powerKw), fillOpacity: 1 }).addTo(m);
    else mark.current.setLatLng([p.lat, p.lon]).setStyle({ fillColor: rawColor(p.powerKw) });
  }, [hover, pts]);
  return (
    <div class="emapwrap">
      <div class="emap" ref={el} />
      <div class="elegend"><i style="background:var(--ok)" />regen <i style="background:var(--accent)" />under 12 kW <i style="background:var(--warn)" />12-30 <i style="background:var(--bad)" />30+ kW</div>
      {tilesFailed && <div class="dimtxt" style="font-size:var(--fs-caption)">Without signal the map shows only areas downloaded in Settings, Offline maps; the route is drawn anyway.</div>}
    </div>
  );
}

/** Height, speed and power against distance; pointer or touch scrubs. */
function Chart({ pts, hover, onHover }: { pts: Point[]; hover: number | null; onHover: (i: number | null) => void }) {
  const W = 1000, H = 300, bands = { alt: [0, 80], spd: [96, 166], pwr: [182, 292] } as const;
  const g = useMemo(() => {
    const total = pts.at(-1)?.mi || 1;
    const x = (mi: number) => (mi / total) * W;
    const alts = pts.map((p) => p.altM).filter((a): a is number => a !== null);
    const aLo = alts.length ? Math.min(...alts) : 0, aHi = alts.length ? Math.max(...alts) : 1, aSpan = Math.max(aHi - aLo, 15);
    const yA = (a: number) => bands.alt[1] - ((a - aLo) / aSpan) * (bands.alt[1] - bands.alt[0] - 6);
    const sHi = Math.max(10, ...pts.map((p) => p.speedMph ?? 0));
    const yS = (s: number) => bands.spd[1] - (s / sHi) * (bands.spd[1] - bands.spd[0]);
    const pHi = Math.max(5, ...pts.map((p) => p.powerKw)), pLo = Math.min(0, ...pts.map((p) => p.powerKw));
    const zero = bands.pwr[0] + ((pHi) / (pHi - pLo)) * (bands.pwr[1] - bands.pwr[0]);
    const yP = (kw: number) => zero - (kw / (pHi - pLo)) * (bands.pwr[1] - bands.pwr[0]);
    const altPath = alts.length ? `M0 ${bands.alt[1]} ` + pts.map((p) => (p.altM === null ? '' : `L${x(p.mi)} ${yA(p.altM)}`)).join(' ') + ` L${W} ${bands.alt[1]} Z` : '';
    const spdPath = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.mi)} ${yS(p.speedMph ?? 0)}`).join(' ');
    const barW = Math.max(1, W / pts.length);
    return { x, total, aLo, aHi, sHi, pHi, pLo, zero, yP, altPath, spdPath, barW, hasAlt: alts.length > 0 };
  }, [pts]);
  const svg = useRef<SVGSVGElement>(null);
  const pick = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    const mi = ((clientX - r.left) / r.width) * g.total;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].mi < mi) lo = mid + 1; else hi = mid; }
    onHover(lo);
  };
  const h = hover !== null ? pts[hover] : null;
  return (
    <div class="echart">
      <div class="row between dimtxt num" style="font-size:var(--fs-caption);min-height:1.4em">
        {h ? <span>{h.mi.toFixed(1)} mi · {h.altM !== null ? `${Math.round(h.altM * FT)} ft · ` : ''}{h.speedMph !== null ? `${Math.round(h.speedMph)} mph · ` : ''}<b style={{ color: powerColor(h.powerKw) }}>{h.powerKw >= 0 ? `${h.powerKw.toFixed(1)} kW` : `regen ${(-h.powerKw).toFixed(1)} kW`}</b>{h.measured ? '' : ' (model)'}</span> : <span>Drag across the chart to follow the trip on the map.</span>}
        <span>{g.total.toFixed(1)} mi</span>
      </div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Height, speed and power along the trip"
        onPointerMove={(ev) => pick(ev.clientX)} onPointerDown={(ev) => pick(ev.clientX)} onPointerLeave={() => onHover(null)} style="touch-action:none">
        {g.hasAlt && <path d={g.altPath} class="ealt" />}
        <path d={g.spdPath} class="espd" />
        <line x1={0} x2={W} y1={g.zero} y2={g.zero} class="ezero" />
        {pts.map((p) => <rect x={g.x(p.mi) - g.barW / 2} width={g.barW} y={Math.min(g.zero, g.yP(p.powerKw))} height={Math.max(0.5, Math.abs(g.yP(p.powerKw) - g.zero))} fill={powerColor(p.powerKw)} />)}
        {h && <line x1={g.x(h.mi)} x2={g.x(h.mi)} y1={0} y2={H} class="ecursor" />}
      </svg>
      <div class="row between dimtxt num" style="font-size:var(--fs-caption)">
        <span>Height {g.hasAlt ? `${Math.round(g.aLo * FT)}-${Math.round(g.aHi * FT)} ft` : '(no GPS height)'} · Speed to {Math.round(g.sHi)} mph · Power {Math.round(g.pLo)} to {Math.round(g.pHi)} kW</span>
      </div>
    </div>
  );
}
