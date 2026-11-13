// The Map view: where the truck is, on a map that follows it. With signal it's
// OpenStreetMap; inside an area downloaded in Settings (Offline maps) it draws
// from the Pi, so it keeps working with no signal at all.
import { useEffect, useRef, useState } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Layout } from '../../../brain/src/types.ts';
import type { MapsView } from '../../../brain/src/maps/service.ts';
import type { WP } from '../components/drive.tsx';
import { addOfflineAreas, areaAt, osmLayer } from '../lib/basemap.ts';
import { isLight } from '../lib/theme.ts';
import './map.css';

export const MAP_ICON = 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14';
export const MAP_VIEW: Layout['views'][number] = { id: 'map', label: 'Map', widgets: [{ type: 'map', col: 1, row: 1, w: 12, h: 2 }] };
/** Every layout gets the Map view, after Drive, unless it already has one. */
export function withMapView(layout: Layout): Layout {
  if (layout.views.some((v) => v.id === 'map')) return layout;
  const i = layout.views.findIndex((v) => v.id === 'drive');
  const views = [...layout.views];
  views.splice(i >= 0 ? i + 1 : views.length, 0, MAP_VIEW);
  return { ...layout, views };
}

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ARROW = (deg: number | null) => `<svg viewBox="0 0 40 40" width="40" height="40" style="transform:rotate(${deg ?? 0}deg)"><circle cx="20" cy="20" r="17" fill="var(--accent)" fill-opacity=".25"/><path d="M20 6 30 31 20 25 10 31z" fill="var(--accent)" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;

type Area = MapsView['areas'][number];

export function MapW({ s }: WP) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const truck = useRef<L.Marker | null>(null);
  const [follow, setFollow] = useState(true);
  const [area, setArea] = useState<Area | null>(null);
  const [failed, setFailed] = useState(false);
  const gps = s?.gps?.fix ? s.gps : null;

  useEffect(() => {
    if (!el.current) return;
    const dark = !isLight(cssVar('--bg') || '#000000');
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, center: gps ? [gps.lat, gps.lon] : [39.5, -98.35], zoom: gps ? 15 : 4, maxZoom: 19 });
    m.getContainer().classList.toggle('dark', dark);
    const base = osmLayer();
    (base.options as L.TileLayerOptions).className = 'osm-base';
    base.on('tileerror', () => setFailed(true));
    base.on('tileload', () => setFailed(false));
    base.addTo(m);
    void addOfflineAreas(m, dark);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.on('dragstart', () => setFollow(false));
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    map.current = m;
    return () => { ro.disconnect(); m.remove(); map.current = null; truck.current = null; };
  }, []);

  // The truck: an arrow pointing where it's heading; the map follows until someone drags it.
  useEffect(() => {
    const m = map.current;
    if (!m || !gps) return;
    const icon = L.divIcon({ className: 'truck-arrow', html: ARROW(gps.headingDeg), iconSize: [40, 40], iconAnchor: [20, 20] });
    if (!truck.current) truck.current = L.marker([gps.lat, gps.lon], { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(m);
    else truck.current.setLatLng([gps.lat, gps.lon]).setIcon(icon);
    if (follow) m.setView([gps.lat, gps.lon], Math.max(m.getZoom(), 13), { animate: true });
  }, [gps?.lat, gps?.lon, gps?.headingDeg, follow]);

  // Is there an offline map where the truck is? (checked about every ~100 m of travel)
  const cell = gps ? `${gps.lat.toFixed(3)},${gps.lon.toFixed(3)}` : '';
  useEffect(() => { if (gps) void areaAt(gps.lat, gps.lon).then(setArea); else setArea(null); }, [cell]);

  const status = !gps ? 'Waiting for GPS'
    : area ? `Offline map: ${area.name}`
    : failed ? 'No signal, and no offline map here'
    : 'Online map';
  return (
    <div class="card mapv">
      <div class="mapv-map" ref={el} />
      <div class="mapv-bar">
        <span class={`pill mapv-status ${area ? 'ok' : failed ? 'bad' : ''}`}>{status}</span>
        {!area && gps && <a class="pill" href="/settings#maps">Download this area</a>}
        {!follow && gps && <button type="button" class="btn sm primary" onClick={() => setFollow(true)}>Re-centre</button>}
      </div>
    </div>
  );
}

export const MAP_WIDGETS = { map: MapW };
