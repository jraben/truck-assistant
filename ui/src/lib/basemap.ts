// The cockpit's map base: OpenStreetMap's own raster tiles when online, with the
// offline areas downloaded in Settings (brain/src/maps) drawn on top from the Pi,
// so a map keeps working with no signal inside those areas.
import L from 'leaflet';
import type { MapsView } from '../../../brain/src/maps/service.ts';
import { api } from './brain.ts';

export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

let info: Promise<MapsView | null> | null = null;
/** What's downloaded (cached; `fresh` asks again, e.g. after Settings changed it). */
export function mapsInfo(fresh = false): Promise<MapsView | null> {
  if (!info || fresh) info = api<MapsView>('/api/maps').catch(() => null);
  return info;
}

export const osmLayer = (attribution = OSM_ATTRIBUTION) => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution });

/**
 * One vector layer per downloaded area, limited to its box and its detail level
 * (zooming further in stretches the last level), above the online map.
 * Nothing when offline maps are off or none is downloaded.
 */
export async function addOfflineAreas(m: L.Map, dark: boolean): Promise<L.Layer[]> {
  const i = await mapsInfo();
  const ready = i?.enabled ? i.areas.filter((a) => a.status === 'ready') : [];
  if (!ready.length) return [];
  const { leafletLayer } = await import('protomaps-leaflet');
  return ready.map((a, n) => {
    const layer = leafletLayer({
      url: '/api/maps/tiles/{z}/{x}/{y}.mvt',
      flavor: dark ? 'dark' : 'light',
      lang: 'en',
      maxDataZoom: a.maxZoom,
      maxZoom: 19,
      bounds: L.latLngBounds([a.bbox[1], a.bbox[0]], [a.bbox[3], a.bbox[2]]),
      attribution: n === 0 ? 'Offline map: <a href="https://protomaps.com">Protomaps</a>' : undefined,
      zIndex: 2,
    } as Parameters<typeof leafletLayer>[0]);
    (layer as unknown as L.Layer).addTo(m);
    return layer as unknown as L.Layer;
  });
}

/** The downloaded area holding a point, if any. */
export async function areaAt(lat: number, lon: number): Promise<MapsView['areas'][number] | null> {
  const i = await mapsInfo();
  if (!i?.enabled) return null;
  return i.areas.find((a) => a.status === 'ready' && lon >= a.bbox[0] && lon <= a.bbox[2] && lat >= a.bbox[1] && lat <= a.bbox[3]) ?? null;
}
