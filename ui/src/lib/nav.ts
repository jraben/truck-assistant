// Navigation hand-off. Pure (tested in ui/test/nav.test.ts), except the
// per-tablet preference at the bottom.
//
// Two apps: Waze (on the iPhone through CarPlay; needs signal) and Organic Maps
// (free, OpenStreetMap, fully offline once a state is downloaded inside it; on
// the Galaxy dash tablet). Organic Maps' link API: om://route, om://map,
// om://search (organicmaps.app/api); on Android, Chrome opens an om:// link
// through an intent:// URL naming the package, with a fallback to Google Play
// when it isn't installed.

export type NavApp = 'waze' | 'organic';
export type NavPref = NavApp | 'auto';
export type NavTarget = { name: string; lat?: number | null; lon?: number | null; query?: string | null };
export type LatLon = { lat: number; lon: number };

export const ORGANIC_PACKAGE = 'app.organicmaps';
export const ORGANIC_PLAY = `https://play.google.com/store/apps/details?id=${ORGANIC_PACKAGE}`;

const c6 = (n: number) => n.toFixed(6);
const hasPoint = (t: NavTarget): t is NavTarget & { lat: number; lon: number } => typeof t.lat === 'number' && typeof t.lon === 'number' && Number.isFinite(t.lat) && Number.isFinite(t.lon);

/** Waze: exact coordinates when known, else a search for the typed place. */
export function wazeLink(t: NavTarget): string | null {
  if (hasPoint(t)) return `https://waze.com/ul?ll=${c6(t.lat)},${c6(t.lon)}&navigate=yes`;
  if (t.query?.trim()) return `https://waze.com/ul?q=${encodeURIComponent(t.query.trim())}&navigate=yes`;
  return null;
}

/**
 * Organic Maps: a driving route from the truck when its position is known, else
 * the place on the map (one tap on "Route" there); a typed address becomes a search.
 */
export function organicLink(t: NavTarget, from: LatLon | null): string | null {
  const name = encodeURIComponent(t.name.trim().slice(0, 80) || 'Destination');
  if (hasPoint(t)) {
    if (from) return `om://route?sll=${c6(from.lat)},${c6(from.lon)}&saddr=${encodeURIComponent('Truck')}&dll=${c6(t.lat)},${c6(t.lon)}&daddr=${name}&type=vehicle`;
    return `om://map?ll=${c6(t.lat)},${c6(t.lon)}&n=${name}`;
  }
  if (t.query?.trim()) return `om://search?query=${encodeURIComponent(t.query.trim())}${from ? `&ll=${c6(from.lat)},${c6(from.lon)}` : ''}&map`;
  return null;
}

/** The same link as Chrome on Android opens it: the app if installed, else its Play Store page. */
export function androidIntent(omLink: string): string {
  if (!omLink.startsWith('om://')) throw new Error('not an om:// link');
  return `intent://${omLink.slice('om://'.length)}#Intent;scheme=om;package=${ORGANIC_PACKAGE};S.browser_fallback_url=${encodeURIComponent(ORGANIC_PLAY)};end`;
}

/** Which app to show first: the preference, or with "auto" Organic Maps when the truck has no internet. */
export const pickApp = (pref: NavPref, truckOffline: boolean): NavApp => (pref === 'auto' ? (truckOffline ? 'organic' : 'waze') : pref);

export const isAndroid = (ua: string) => /Android/i.test(ua);

// ---- this tablet's preference (each screen can differ: the dash tablet has Organic Maps, a phone may not) ----
const KEY = 'slate.nav.app';
export function getNavPref(): NavPref {
  try { const v = localStorage.getItem(KEY); return v === 'waze' || v === 'organic' || v === 'auto' ? v : 'auto'; } catch { return 'auto'; }
}
export function setNavPref(v: NavPref) { try { localStorage.setItem(KEY, v); } catch { /* private mode: stays auto */ } }
