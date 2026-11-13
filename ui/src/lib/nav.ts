// Navigation hand-off. Pure (tested in ui/test/nav.test.ts), except the
// per-screen preferences at the bottom.
//
// Apps, and how Chrome on the Android dash tablet opens each one. Link formats
// are from each app's own source code: Organic Maps' and CoMaps' AndroidManifest
// intent-filters and libs/map/mwm_url.cpp, and OsmAnd's IntentHelper.
// Chrome can only launch an app through an intent whose filter is BROWSABLE.
// - Waze (iPhone, CarPlay; needs signal): https://waze.com/ul links, as a QR code.
// - Organic Maps (offline): om://route|map|search, package app.organicmaps.
// - CoMaps (offline; the Organic Maps fork): its own cm:// scheme. It does NOT
//   open om:// links. No package in the intent, so the Google Play
//   (app.comaps.google) and F-Droid (app.comaps.fdroid) builds both answer.
// - OsmAnd (offline): https://osmand.net/map/?start=…&end=…&profile=car aimed at
//   the app's package (net.osmand, or net.osmand.plus for OsmAnd+ / F-Droid).
//   Its osmand.api:// scheme isn't BROWSABLE, so Chrome can't use it.
// - ABRP: no documented link takes a destination, so the window offers the
//   place to copy, and opens ABRP.
//
// om:// and cm:// routes need all five parameters in order (sll, saddr, dll,
// daddr, type), so a route needs the truck's GPS fix; without one it's the
// place on the map, with a Route button there.

export type NavApp = 'waze' | 'organic' | 'comaps' | 'osmand' | 'abrp';
export type NavPref = NavApp | 'auto';
export type NavTarget = { name: string; lat?: number | null; lon?: number | null; query?: string | null };
export type LatLon = { lat: number; lon: number };
export type OsmandPackage = 'net.osmand' | 'net.osmand.plus';

export const NAV_APPS: { id: NavApp; label: string; offline: boolean; note: string }[] = [
  { id: 'waze', label: 'Waze', offline: false, note: 'On the iPhone, through CarPlay. Needs signal' },
  { id: 'comaps', label: 'CoMaps', offline: true, note: 'On this tablet. Offline in downloaded regions' },
  { id: 'organic', label: 'Organic Maps', offline: true, note: 'On this tablet. Offline in downloaded regions' },
  { id: 'osmand', label: 'OsmAnd', offline: true, note: 'On this tablet. Offline in downloaded regions' },
  { id: 'abrp', label: 'ABRP', offline: false, note: 'EV route planner with charging stops. Needs signal' },
];
export const appLabel = (a: NavApp) => NAV_APPS.find((x) => x.id === a)!.label;

export const PLAY = (pkg: string) => `https://play.google.com/store/apps/details?id=${pkg}`;
export const ORGANIC_PACKAGE = 'app.organicmaps';
export const COMAPS_PLAY_PACKAGE = 'app.comaps.google';
export const ABRP_URL = 'https://abetterrouteplanner.com/';

const c6 = (n: number) => n.toFixed(6);
const hasPoint = (t: NavTarget): t is NavTarget & { lat: number; lon: number } => typeof t.lat === 'number' && typeof t.lon === 'number' && Number.isFinite(t.lat) && Number.isFinite(t.lon);
const nameOf = (t: NavTarget) => encodeURIComponent(t.name.trim().slice(0, 80) || 'Destination');

/** Waze: exact coordinates when known, else a search for the typed place. */
export function wazeLink(t: NavTarget): string | null {
  if (hasPoint(t)) return `https://waze.com/ul?ll=${c6(t.lat)},${c6(t.lon)}&navigate=yes`;
  if (t.query?.trim()) return `https://waze.com/ul?q=${encodeURIComponent(t.query.trim())}&navigate=yes`;
  return null;
}

/** Organic Maps (om://) or CoMaps (cm://): the same link API under two schemes. */
export function mwmLink(scheme: 'om' | 'cm', t: NavTarget, from: LatLon | null): string | null {
  if (hasPoint(t)) {
    if (from) return `${scheme}://route?sll=${c6(from.lat)},${c6(from.lon)}&saddr=Truck&dll=${c6(t.lat)},${c6(t.lon)}&daddr=${nameOf(t)}&type=vehicle`;
    return `${scheme}://map?ll=${c6(t.lat)},${c6(t.lon)}&n=${nameOf(t)}`;
  }
  // Search near the truck: the parameter is cll (ll is the map's own point).
  if (t.query?.trim()) return `${scheme}://search?query=${encodeURIComponent(t.query.trim())}${from ? `&cll=${c6(from.lat)},${c6(from.lon)}` : ''}&map`;
  return null;
}
export const organicLink = (t: NavTarget, from: LatLon | null) => mwmLink('om', t, from);
export const comapsLink = (t: NavTarget, from: LatLon | null) => mwmLink('cm', t, from);

/** OsmAnd's navigation link: from the truck if known (else OsmAnd starts from its own fix). Needs a point, not an address. */
export function osmandLink(t: NavTarget, from: LatLon | null): string | null {
  if (!hasPoint(t)) return null;
  return `https://osmand.net/map/?${from ? `start=${c6(from.lat)},${c6(from.lon)}&` : ''}end=${c6(t.lat)},${c6(t.lon)}&profile=car`;
}

/** What to paste into ABRP: the coordinates, or the typed address. */
export const abrpText = (t: NavTarget): string | null => (hasPoint(t) ? `${c6(t.lat)}, ${c6(t.lon)}` : t.query?.trim() || null);

/**
 * The link as Chrome on Android opens an app: `intent://<rest>#Intent;scheme=…;[package=…;]
 * S.browser_fallback_url=<Play Store>;end`. Without a package, any app that handles
 * the scheme opens (both CoMaps builds); the fallback still says where to get one.
 */
export function androidIntent(link: string, o: { package?: string; fallbackPackage: string }): string {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(link);
  if (!m) throw new Error('not a scheme:// link');
  return `intent://${m[2]}#Intent;scheme=${m[1]};${o.package ? `package=${o.package};` : ''}S.browser_fallback_url=${encodeURIComponent(PLAY(o.fallbackPackage))};end`;
}

/** The tablet's launch link for an app, or null when there's nothing to send. */
export function tabletLink(app: NavApp, t: NavTarget, from: LatLon | null, osmandPkg: OsmandPackage = 'net.osmand'): string | null {
  if (app === 'organic') { const l = organicLink(t, from); return l && androidIntent(l, { package: ORGANIC_PACKAGE, fallbackPackage: ORGANIC_PACKAGE }); }
  if (app === 'comaps') { const l = comapsLink(t, from); return l && androidIntent(l, { fallbackPackage: COMAPS_PLAY_PACKAGE }); }
  if (app === 'osmand') { const l = osmandLink(t, from); return l && androidIntent(l, { package: osmandPkg, fallbackPackage: osmandPkg }); }
  return null;
}

/**
 * Which app opens first. A fixed choice wins if it's shown. "auto": with no
 * internet, the first offline app shown; with internet, Waze if shown. Else the first shown.
 */
export function pickApp(pref: NavPref, truckOffline: boolean, shown: NavApp[]): NavApp {
  const list = shown.length ? shown : (['waze'] as NavApp[]);
  if (pref !== 'auto' && list.includes(pref)) return pref;
  if (truckOffline) return list.find((a) => NAV_APPS.find((x) => x.id === a)!.offline) ?? list[0];
  return list.includes('waze') ? 'waze' : list[0];
}

export const isAndroid = (ua: string) => /Android/i.test(ua);

// ---- this screen's preferences (the dash tablet and a phone can differ) ----
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const ALL: NavApp[] = NAV_APPS.map((a) => a.id);
export const DEFAULT_SHOWN: NavApp[] = ['waze', 'comaps', 'organic', 'osmand', 'abrp'];

export function getNavPref(): NavPref { const v = lsGet('slate.nav.app'); return v === 'auto' || ALL.includes(v as NavApp) ? (v as NavPref) : 'auto'; }
export function setNavPref(v: NavPref) { lsSet('slate.nav.app', v); }
export function getShownApps(): NavApp[] {
  try { const v = JSON.parse(lsGet('slate.nav.apps') ?? 'null'); if (Array.isArray(v)) { const ok = ALL.filter((a) => v.includes(a)); if (ok.length) return ok; } } catch { /* bad value: defaults */ }
  return DEFAULT_SHOWN;
}
export function setShownApps(v: NavApp[]) { lsSet('slate.nav.apps', JSON.stringify(ALL.filter((a) => v.includes(a)))); }
export function getOsmandPackage(): OsmandPackage { return lsGet('slate.nav.osmand') === 'net.osmand.plus' ? 'net.osmand.plus' : 'net.osmand'; }
export function setOsmandPackage(v: OsmandPackage) { lsSet('slate.nav.osmand', v); }
