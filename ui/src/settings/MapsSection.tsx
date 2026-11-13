// Settings, Truck: Offline maps. Frame an area on the map (or take one around
// the truck), pick how much detail, and the Pi downloads it from Protomaps'
// OpenStreetMap build (brain/src/maps). The cockpit's maps then work there
// with no signal.
import { useEffect, useRef, useState } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapsView } from '../../../brain/src/maps/service.ts';
import { countTiles, type Bbox } from '../../../brain/src/maps/tiles.ts';
import { api, stateStore, toast, useStore } from '../lib/brain.ts';
import { addOfflineAreas, mapsInfo, osmLayer } from '../lib/basemap.ts';
import { isLight } from '../lib/theme.ts';

type Area = MapsView['areas'][number];

/** Detail levels offered: the zoom the download stops at. */
const DETAIL: [number, string][] = [[15, 'Every building'], [14, 'Streets (recommended)'], [12, 'Roads and towns'], [10, 'Highways only']];
/** Rough size per tile for the estimate: cities run ~60 KB, countryside a few KB. */
const KB_PER_TILE = 30;

const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const boundsOf = (b: Bbox) => L.latLngBounds([b[1], b[0]], [b[3], b[2]]);

function status(a: Area): preact.ComponentChildren {
  const pct = a.tilesTotal ? Math.floor((a.tilesDone / a.tilesTotal) * 100) : 0;
  if (a.status === 'ready') return <span class="okmsg">Ready · {size(a.bytes)}{a.build ? ` · map of ${a.build.slice(0, 4)}-${a.build.slice(4, 6)}-${a.build.slice(6, 8)}` : ''}</span>;
  if (a.status === 'queued') return <span class="dimtxt">Waiting to download</span>;
  if (a.status === 'downloading') return (
    <span class="row" style="gap:var(--s1);align-items:center">
      <progress max={100} value={pct} style="width:120px" /> <span class="num">{pct}%</span>
      <span class="dimtxt num">{a.tilesDone.toLocaleString()} / {a.tilesTotal.toLocaleString()} tiles · {size(a.bytes)}</span>
    </span>
  );
  return <span class="err">{a.error ?? 'Failed'}</span>;
}

export function MapsSection() {
  const s = useStore(stateStore);
  const [v, setV] = useState<MapsView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [zoom, setZoom] = useState(14);
  const [box, setBox] = useState<Bbox | null>(null);
  const [busy, setBusy] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const drawn = useRef<L.LayerGroup | null>(null);

  const load = async () => {
    try { const n = await api<MapsView>('/api/maps'); setV(n); setErr(null); void mapsInfo(true); } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  // While something downloads, keep the progress moving.
  const active = !!v?.areas.some((a) => a.status === 'queued' || a.status === 'downloading');
  useEffect(() => { if (!active) return; const t = setInterval(() => void load(), 2000); return () => clearInterval(t); }, [active]);

  // The picker map: frame what to download. Existing areas are outlined.
  const loaded = !!v;
  useEffect(() => {
    if (!el.current) return;
    const g = s?.gps?.fix ? s.gps : null;
    const m = L.map(el.current, { center: g ? [g.lat, g.lon] : [39.5, -98.35], zoom: g ? 9 : 4, zoomControl: true });
    osmLayer().addTo(m);
    // Downloaded areas show here too, so the picker works with no signal.
    void addOfflineAreas(m, !isLight(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#000000'));
    drawn.current = L.layerGroup().addTo(m);
    const upd = () => { const b = m.getBounds(); setBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => Math.round(n * 1e5) / 1e5) as Bbox); };
    m.on('moveend', upd);
    upd();
    // The card starts folded (zero size): redraw when it opens.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    map.current = m;
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, [loaded]);
  useEffect(() => {
    const g = drawn.current;
    if (!g) return;
    g.clearLayers();
    for (const a of v?.areas ?? []) L.rectangle(boundsOf(a.bbox), { color: a.status === 'ready' ? '#3fa66b' : '#d39b2a', weight: 2, fillOpacity: 0.08, interactive: false }).addTo(g);
  }, [v, loaded]);

  const tiles = box ? countTiles(box, zoom) : 0;
  const tooBig = !!v && tiles > v.maxTiles;
  const est = tiles * KB_PER_TILE * 1000;
  const lowDisk = v?.freeBytes != null && est > v.freeBytes - 500e6;

  const add = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { await api('/api/maps/areas', { method: 'POST', body: JSON.stringify({ maxZoom: zoom, ...body }) }); setName(''); await load(); toast('Download started'); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const act = async (a: Area, what: 'update' | 'retry' | 'delete') => {
    if (what === 'delete' && !confirm(`Delete the offline map "${a.name}"? Its ${size(a.bytes)} is freed; parts another area also covers are kept.`)) return;
    try {
      if (what === 'delete') await api(`/api/maps/areas/${a.id}`, { method: 'DELETE' });
      else await api(`/api/maps/areas/${a.id}/download`, { method: 'POST', body: JSON.stringify({ fresh: what === 'update' }) });
      await load();
    } catch (e) { toast((e as Error).message); }
  };
  const setEnabled = async (on: boolean) => { try { setV(await api<MapsView>('/api/maps', { method: 'PUT', body: JSON.stringify({ enabled: on }) })); void mapsInfo(true); } catch (e) { toast((e as Error).message); } };

  return (
    <section class="card" id="maps">
      <h2>Offline maps</h2>
      <p class="help">
        Download the maps for places you drive, so the Map view and trip maps work with no signal. Maps are OpenStreetMap, from Protomaps' daily build, stored on the Pi.
        Downloads use the truck's internet: in the driveway that's home Wi-Fi, on the road a phone's hotspot data.
      </p>
      {err && <div class="err">{err}</div>}
      {v && (
        <>
          <div class="row wrap" style="gap:var(--s15);align-items:center">
            <label class="check"><input type="checkbox" checked={v.enabled} onChange={(e) => void setEnabled((e.target as HTMLInputElement).checked)} /> Use downloaded maps</label>
            <span class="dimtxt">{v.areas.length} area{v.areas.length === 1 ? '' : 's'} · {size(v.usedBytes)} used{v.freeBytes != null ? ` · ${size(v.freeBytes)} free on the Pi` : ''}</span>
          </div>

          {v.areas.length > 0 && (
            <div class="list" style="margin-top:var(--s15)">
              {v.areas.map((a) => (
                <div class="item row wrap" style="gap:var(--s15);align-items:center">
                  <b style="min-width:140px">{a.name}</b>
                  <span class="grow">{status(a)}</span>
                  <span class="row" style="gap:var(--s1)">
                    <button type="button" class="btn sm" onClick={() => map.current?.fitBounds(boundsOf(a.bbox))}>Show</button>
                    {a.status === 'error' && <button type="button" class="btn sm primary" onClick={() => void act(a, 'retry')}>Retry</button>}
                    {a.status === 'ready' && <button type="button" class="btn sm" title="Download the newest map of this area" onClick={() => void act(a, 'update')}>Update</button>}
                    <button type="button" class="btn sm" onClick={() => void act(a, 'delete')}>Delete</button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <h3 class="sub">Add an area</h3>
          <p class="help">Pan and zoom the map so it frames the area you want: everything on screen is downloaded.</p>
          <div ref={el} class="maps-picker" style="height:320px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--line)" />
          <div class="row wrap" style="gap:var(--s15);align-items:flex-end;margin-top:var(--s15)">
            <label class="f" style="min-width:200px"><span>Name</span><input type="text" maxLength={60} value={name} placeholder="Home, Moab trip…" onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
            <label class="f" style="min-width:200px"><span>Detail</span>
              <select value={zoom} onChange={(e) => setZoom(Number((e.target as HTMLSelectElement).value))}>{DETAIL.map(([z, l]) => <option value={z}>{l}</option>)}</select>
            </label>
            <button type="button" class="btn primary" disabled={busy || !box || tooBig} onClick={() => void add({ name: name || 'Area', bbox: box })}>Download what's on the map</button>
          </div>
          <p class={tooBig || lowDisk ? 'err' : 'help'}>
            {tooBig ? `${tiles.toLocaleString()} tiles is too many (at most ${v.maxTiles.toLocaleString()}): zoom the map in or pick less detail.`
              : `About ${tiles.toLocaleString()} tiles, roughly ${size(est)} (cities take more, open country less).${lowDisk ? ' That may not fit on the Pi.' : ''}`}
          </p>
          <div class="row wrap" style="gap:var(--s1);align-items:center">
            <span class="lbl">Or around the truck:</span>
            {[10, 25, 50].map((mi) => <button type="button" class="btn sm" disabled={busy || !s?.gps?.fix} onClick={() => void add({ name: name || `${mi} mi around the truck`, aroundTruckMi: mi })}>{mi} mi</button>)}
            {!s?.gps?.fix && <span class="dimtxt">(needs a GPS fix)</span>}
          </div>
        </>
      )}
    </section>
  );
}
