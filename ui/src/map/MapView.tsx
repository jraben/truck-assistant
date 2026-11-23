// The Map view: where the truck is, on a map that follows it. With signal it's
// OpenStreetMap; inside an area downloaded in Settings (Offline maps) it draws
// from the Pi, so it keeps working with no signal at all.
import { useEffect, useRef, useState } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapsView } from '../../../brain/src/maps/service.ts';
import type { WP } from '../components/drive.tsx';
import { addOfflineAreas, areaAt, cleanLayer, cleanUrl, osmLayer } from '../lib/basemap.ts';
import { mapTabStore } from '../lib/panels.ts';
import { useStore } from '../lib/brain.ts';
import { TrafficAhead } from '../components/traffic.tsx';
import { isLight } from '../lib/theme.ts';
import './map.css';

export { foldTrafficIntoMap, MAP_ICON, MAP_VIEW, withMapView } from './views.ts';

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ARROW = (deg: number | null) => `<svg viewBox="0 0 40 40" width="40" height="40" style="transform:rotate(${deg ?? 0}deg)"><circle cx="20" cy="20" r="17" fill="var(--accent)" fill-opacity=".25"/><path d="M20 6 30 31 20 25 10 31z" fill="var(--accent)" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;

type Area = MapsView['areas'][number];

export function MapW(props: WP) {
  const tab = useStore(mapTabStore);
  return (
    <div class="mapv-wrap">
      <div class="mtabs mapv-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'map'} onClick={() => mapTabStore.set('map')}>Map</button>
        <button type="button" role="tab" aria-selected={tab === 'traffic'} onClick={() => mapTabStore.set('traffic')}>Traffic</button>
      </div>
      {/* The map stays mounted (and keeps following the truck) while Traffic is shown. */}
      <div class="mapv-pane" hidden={tab !== 'map'}><MapPane {...props} /></div>
      {tab === 'traffic' && <div class="mapv-pane"><TrafficAhead {...props} /></div>}
    </div>
  );
}

/** The live map on its own (the Map view, and the Glass Drive layout's right side). */
export function MapPane({ s, props }: WP) {
  /** The Glass Drive look: a status pill and round buttons (recentre, close-up, +, −) instead of Leaflet's zoom. */
  const glass = !!props?.glass;
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
    // Glass: the calm light/dark map, swapped when the theme flips at sunset; otherwise OSM (inverted at night).
    const base = glass ? cleanLayer(dark) : osmLayer();
    (base.options as L.TileLayerOptions).className = glass ? 'clean-base' : 'osm-base';
    const mo = glass ? new MutationObserver(() => {
      const d = !isLight(cssVar('--bg') || '#000000');
      base.setUrl(cleanUrl(d));
      m.getContainer().classList.toggle('dark', d);
    }) : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    base.on('tileerror', () => setFailed(true));
    base.on('tileload', () => setFailed(false));
    base.addTo(m);
    void addOfflineAreas(m, dark);
    if (!glass) L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.on('dragstart', () => setFollow(false));
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    map.current = m;
    return () => { mo?.disconnect(); ro.disconnect(); m.remove(); map.current = null; truck.current = null; };
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
        {/* Glass: say something only when there is something wrong (no GPS, or no map at all here). */}
        {(!glass || !gps || (failed && !area)) && <span class={`pill mapv-status ${area ? 'ok' : failed ? 'bad' : ''}`}>{status}</span>}
        {!area && gps && (!glass || failed) && <a class="pill" href="/settings#maps">Download this area</a>}
        {!glass && !follow && gps && <button type="button" class="btn sm primary" onClick={() => setFollow(true)}>Re-centre</button>}
      </div>
      {glass && <>
        <div class="mapv-pill">
          <span class="mp-dot" aria-hidden="true" />
          <span class="ellip">{s?.driver?.name ? `${s.driver.name}'s truck` : 'My truck'}</span>
          {!gps && <span class="mp-badge">NO GPS</span>}
          <span class="num">{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
        <div class="mapv-ctl" role="group" aria-label="Map controls">
          <button type="button" aria-label="Re-centre on the truck" aria-pressed={follow} onClick={() => { setFollow(true); if (gps) map.current?.setView([gps.lat, gps.lon], map.current.getZoom()); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
          </button>
          <button type="button" aria-label="Close up on the truck" onClick={() => { setFollow(true); if (gps) map.current?.setView([gps.lat, gps.lon], 17); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18v-3l-2-5H5l-2 5zM6 15v2M18 15v2M7 12h1M16 12h1" /></svg>
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
          <button type="button" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
        </div>
      </>}
    </div>
  );
}

export const MAP_WIDGETS = { map: MapW };
