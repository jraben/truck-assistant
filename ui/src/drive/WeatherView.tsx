// The Weather view (docs/drive-v2.md §8): radar over a themed map, the truck,
// NWS alert polygons, and a side panel with the next 12 hours. Leaflet (about
// 40 kB gzipped) rather than MapLibre: raster tiles are all this needs, and it
// is far lighter on a Pi. Loaded only when the view is first opened.
//   Base map: OpenStreetMap tiles, recoloured by CSS filters to suit a dark or light theme.
//   Radar: RainViewer public tiles, the last ~2 hours (plus nowcast when offered).
// Online only for the map; offline it says so and shows the last cached forecast.
import { useEffect, useRef, useState } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { WeatherReport } from '../../../brain/src/drive/types.ts';
import { api, type State } from '../lib/brain.ts';
import { ago } from '../lib/data.ts';
import { fmtTime } from '../lib/fmt.ts';
import { isLight } from '../lib/theme.ts';
import { WIcon } from './icons.tsx';

type Frame = { time: number; path: string };
type Radar = { host: string; frames: Frame[]; nowcastFrom: number };

const RAINVIEWER = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_MAX_ZOOM = 7; // RainViewer's free tiles stop here; Leaflet scales them up beyond
const FRAME_MS = 700;

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

async function loadRadar(): Promise<Radar> {
  const r = await fetch(RAINVIEWER);
  if (!r.ok) throw new Error(`RainViewer answered ${r.status}`);
  const j = await r.json() as { host: string; radar?: { past?: Frame[]; nowcast?: Frame[] } };
  const past = j.radar?.past ?? [], now = j.radar?.nowcast ?? [];
  return { host: j.host, frames: [...past, ...now], nowcastFrom: past.length };
}

export default function WeatherView({ s, onClose }: { s: State | null; onClose: () => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.TileLayer[]>([]);
  const truck = useRef<L.Marker | null>(null);
  const alertsLayer = useRef<L.LayerGroup | null>(null);
  const [report, setReport] = useState<(WeatherReport & { error: string | null }) | null>(null);
  const [repErr, setRepErr] = useState<string | null>(null);
  const [radar, setRadar] = useState<Radar | null>(null);
  const [radarErr, setRadarErr] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [tilesFailed, setTilesFailed] = useState(0);
  const [nLayers, setNLayers] = useState(0);

  const saveData = !!s?.network?.saveData;
  const offline = (s?.network?.link === 'offline' && s.network.backend === 'nmcli') || !navigator.onLine;
  const gps = s?.gps?.fix ? s.gps : null;
  const center: [number, number] | null = gps ? [gps.lat, gps.lon] : report ? [report.lat, report.lon] : null;

  useEffect(() => { api<WeatherReport & { error: string | null }>('/api/weather').then(setReport).catch((e) => setRepErr((e as Error).message)); }, []);
  useEffect(() => { if (offline) return; loadRadar().then((r) => { setRadar(r); setIdx(Math.max(0, r.nowcastFrom - 1)); }).catch((e) => setRadarErr((e as Error).message)); }, [offline]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);

  // the map itself
  useEffect(() => {
    if (!mapEl.current || map.current || !center || offline) return;
    const m = L.map(mapEl.current, { zoomControl: false, attributionControl: true, center, zoom: 8, minZoom: 4, maxZoom: 11 });
    const dark = !isLight(cssVar('--bg') || '#000000');
    // OpenStreetMap's own tiles (no key; light use from one truck is within their policy),
    // themed in CSS: dark themes invert them (.wx-dark), light themes mute them.
    m.getContainer().classList.toggle('wx-dark', dark);
    const base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Radar © <a href="https://www.rainviewer.com/">RainViewer</a> · Weather: NWS / Open-Meteo',
    });
    base.on('tileerror', () => setTilesFailed((n) => n + 1));
    base.addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    alertsLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; layers.current = []; truck.current = null; };
  }, [center?.[0] !== undefined, offline]);

  // the truck: an arrow pointing where it is heading
  useEffect(() => {
    const m = map.current;
    if (!m || !gps) return;
    const html = `<svg viewBox="0 0 40 40" style="transform:rotate(${gps.headingDeg ?? 0}deg)"><circle cx="20" cy="20" r="17" class="wx-truck-halo"/><path d="M20 6 L30 31 L20 25 L10 31 Z" class="wx-truck"/></svg>`;
    const icon = L.divIcon({ className: 'wx-truck-icon', html, iconSize: [40, 40], iconAnchor: [20, 20] });
    if (!truck.current) truck.current = L.marker([gps.lat, gps.lon], { icon, interactive: false, zIndexOffset: 1000 }).addTo(m);
    else { truck.current.setLatLng([gps.lat, gps.lon]); truck.current.setIcon(icon); }
  }, [gps?.lat, gps?.lon, gps?.headingDeg, map.current]);

  // NWS alert polygons
  useEffect(() => {
    const g = alertsLayer.current;
    if (!g || !report) return;
    g.clearLayers();
    for (const a of report.alerts) {
      if (!a.polygon) continue;
      const color = a.severity === 'Extreme' || a.severity === 'Severe' ? cssVar('--bad') : cssVar('--warn');
      L.polygon(a.polygon, { color, weight: 2, fillOpacity: 0.12 }).bindTooltip(a.event).addTo(g);
    }
  }, [report, map.current]);

  // radar frames: every frame a layer, only the current one visible (save-data: just the latest)
  useEffect(() => {
    const m = map.current;
    if (!m || !radar || !radar.frames.length) return;
    const use = saveData ? [radar.frames[radar.nowcastFrom - 1] ?? radar.frames[radar.frames.length - 1]] : radar.frames;
    layers.current = use.map((f) => L.tileLayer(`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0, maxNativeZoom: RADAR_MAX_ZOOM, maxZoom: 11, zIndex: 5 }).addTo(m));
    setNLayers(layers.current.length);
    if (saveData) setIdx(0);
    return () => { for (const l of layers.current) l.remove(); layers.current = []; setNLayers(0); };
  }, [radar, saveData, map.current]);

  useEffect(() => { layers.current.forEach((l, i) => l.setOpacity(i === idx ? 0.72 : 0)); }, [idx, nLayers]);
  useEffect(() => {
    if (!playing || saveData || nLayers < 2) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % nLayers), FRAME_MS);
    return () => clearInterval(id);
  }, [playing, saveData, nLayers]);

  const frames = saveData && radar ? [radar.frames[radar.nowcastFrom - 1] ?? radar.frames[radar.frames.length - 1]] : radar?.frames ?? [];
  const frame = frames[idx];
  const r = report;
  const mapDown = offline || tilesFailed > 8;

  return (
    <div class="wxview" role="dialog" aria-modal="true" aria-label="Weather">
      <div class="wxmap">
        {!offline && center && <div ref={mapEl} class="wxleaflet" />}
        {(mapDown || !center) && (
          <div class="wxoffline">
            <b>{!center ? 'No position yet' : 'Offline'}</b>
            <span class="dimtxt">{!center ? 'The map centres on the truck once GPS has a fix.' : 'Radar and the map need the internet. The forecast on the right is the last one saved.'}</span>
          </div>
        )}
        {!mapDown && center && (
          <div class="wxcontrols">
            <button type="button" class="btn big" disabled={saveData || frames.length < 2} onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause radar' : 'Play radar'}>{playing && !saveData ? 'Pause' : 'Play'}</button>
            <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={idx} disabled={frames.length < 2} onInput={(e) => { setPlaying(false); setIdx(Number((e.target as HTMLInputElement).value)); }} aria-label="Radar time" />
            <span class="num wxtime">{frame ? `${new Date(frame.time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${radar && idx >= radar.nowcastFrom && !saveData ? ' · forecast' : ''}` : radarErr ? 'No radar' : '…'}</span>
            {saveData && <span class="tag warn" title="On a phone's data: the radar shows the latest frame only">Saving data</span>}
          </div>
        )}
      </div>
      <aside class="wxpanel">
        <div class="row between">
          <div class="ccol">
            <span class="lbl">{r?.place ?? s?.drive?.weather?.place ?? 'Weather'}</span>
            {r && <span class="dimtxt wxage">{r.source === 'nws' ? 'National Weather Service' : 'Open-Meteo'} · {ago(r.fetchedAt)}</span>}
          </div>
          <button type="button" class="btn big primary wxclose" onClick={onClose}>Close</button>
        </div>
        {!r && <div class="dimtxt">{repErr ?? 'Loading…'}</div>}
        {r && (
          <>
            <div class="wxnow">
              <WIcon icon={r.current.icon} day={r.current.isDay} size={72} />
              <div><div class="wxtemp num">{r.current.tempF ?? '—'}°</div><div>{r.current.condition}</div></div>
            </div>
            <div class="wxfacts num">
              <span><span class="lbl">High</span>{r.today.highF ?? '—'}°</span>
              <span><span class="lbl">Low</span>{r.today.lowF ?? '—'}°</span>
              <span><span class="lbl">Wind</span>{r.current.windMph === null ? '—' : `${r.current.windDir ?? ''} ${r.current.windMph} mph`}</span>
              <span><span class="lbl">Sunrise</span>{r.sun.rise ? fmtTime(r.sun.rise) : '—'}</span>
              <span><span class="lbl">Sunset</span>{r.sun.set ? fmtTime(r.sun.set) : '—'}</span>
            </div>
            {r.alerts.map((a) => <div class={`dbanner ${a.severity === 'Extreme' || a.severity === 'Severe' ? 'bad' : 'warn'}`}><b>{a.event}</b>{a.expires ? ` · until ${fmtTime(a.expires)}` : ''}</div>)}
            <div class="wxhours">
              {r.hourly.map((h) => (
                <div class="wxhour">
                  <span class="num">{new Date(h.t).toLocaleTimeString([], { hour: 'numeric' })}</span>
                  <WIcon icon={h.icon} day={h.isDay} size={30} />
                  <b class="num">{h.tempF ?? '—'}°</b>
                  <span class="num dimtxt">{h.popPct ? `${h.popPct}%` : ''}</span>
                  <span class="num dimtxt">{h.windMph ?? '—'} mph</span>
                </div>
              ))}
            </div>
            {r.error && <div class="dimtxt" style="font-size:16px">Last refresh failed: {r.error}</div>}
          </>
        )}
      </aside>
    </div>
  );
}
