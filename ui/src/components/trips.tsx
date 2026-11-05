import { useEffect, useState } from 'preact/hooks';
import { api, type Trip, type TripPoint } from '../lib/brain.ts';
import { fmtDate, fmtDuration, fmtTime } from '../lib/fmt.ts';
import { Card, V } from './common.tsx';
import type { WP } from './drive.tsx';

type Detail = Trip & { points: TripPoint[] };

export function Trips({ s }: WP) {
  const [list, setList] = useState<Trip[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const load = () => api<Trip[]>('/api/trips?limit=100').then((l) => { setList(l); setErr(null); if (sel === null && l.length) setSel(l[0].id); }).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, [s?.trip?.id ?? null]);
  useEffect(() => {
    if (sel === null) return;
    let live = true;
    const get = () => api<Detail>(`/api/trips/${sel}`).then((d) => { if (live) setDetail(d); }).catch(() => {});
    void get();
    const id = s?.trip?.id === sel ? setInterval(get, 10_000) : undefined; // the trip in progress keeps drawing
    return () => { live = false; clearInterval(id); };
  }, [sel, s?.trip?.id]);

  return (
    <div class="trips">
      <Card label="Trips" right={<button class="btn sm" type="button" onClick={() => void load()}>Refresh</button>}>
        {err && <div class="err">{err}</div>}
        {list && !list.length && <div class="dimtxt">No trips yet. One starts when the ignition comes on.</div>}
        <div class="list">
          {list?.map((t) => (
            <button type="button" class={`item ${t.id === sel ? 'sel' : ''}`} onClick={() => setSel(t.id)}>
              <div class="row between">
                <b>{fmtDate(t.startedAt)} · {fmtTime(t.startedAt)}</b>
                {t.endedAt === null && <span class="tag ok">NOW</span>}
              </div>
              <div class="row wrap dimtxt" style="font-size:14px">
                <span class="num">{t.miles.toFixed(1)} mi</span><span>{fmtDuration(t.durationS)}</span>
                {t.kwhEst !== null && <span class="num">~{t.kwhEst.toFixed(1)} kWh</span>}
              </div>
            </button>
          ))}
        </div>
      </Card>
      <Card class="route" label={detail ? `Route · ${detail.miles.toFixed(1)} mi` : 'Route'} right={detail && <span class="dimtxt num" style="font-size:13px">SoC <V v={detail.startSoc?.toFixed(0)} why="Charge level unknown at start" />% → <V v={detail.endSoc?.toFixed(0)} why={detail.endedAt ? 'Charge level unknown at end' : 'Trip in progress'} />%</span>}>
        {detail ? <RoutePlot pts={detail.points} /> : <div class="dimtxt">Pick a trip.</div>}
      </Card>
    </div>
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
