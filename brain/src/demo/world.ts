// DEMO=1: the invented world the demo truck lives in. Everything here is made
// up: generic driver names, public places and neighbourhoods (never a street
// address), and the addresses of the invented services the gate answers for.
import { SIM_ROUTE } from '../sim.ts';
import type { LatLon } from '../geo.ts';

/** The invented services. `.demo` is not a real top-level domain: nothing outside the gate can answer these. */
export const DEMO_HA_URL = 'http://homeassistant.demo:8123';
export const DEMO_HA_HOST = 'homeassistant.demo';
export const DEMO_WOPR_URL = 'https://wopr.demo';
export const DEMO_WOPR_HOST = 'wopr.demo';
/** A token-shaped string for the invented services; worthless anywhere else. */
export const DEMO_SECRET = 'demo-not-a-real-credential';

export type DemoDriver = { id: string; name: string; initials: string; color: string; hotspot: string };
export const DEMO_DRIVERS: DemoDriver[] = [
  { id: 'alex', name: 'Alex', initials: 'A', color: '#4fc3d9', hotspot: "Alex's iPhone" },
  { id: 'sam', name: 'Sam', initials: 'S', color: '#f2b33d', hotspot: "Sam's Pixel" },
];

export type DemoPlace = LatLon & { key: string; name: string; radiusM: number };

/** Public places and neighbourhoods. Home is the simulator's start point (a neighbourhood, never shown as an address). */
export const DEMO_PLACES: DemoPlace[] = [
  { key: 'home', name: 'Home', ...SIM_ROUTE[0][0], radiusM: 150 },
  { key: 'office', name: 'Office', ...SIM_ROUTE[1][0], radiusM: 150 },
  { key: 'downtown', name: 'Downtown Phoenix', ...SIM_ROUTE[2][0], radiusM: 200 },
  { key: 'costco', name: 'Costco Tempe', lat: 33.4431, lon: -111.9257, radiusM: 200 },
  { key: 'papago', name: 'Papago Park', lat: 33.4556, lon: -111.9455, radiusM: 300 },
  { key: 'grocery', name: 'Safeway Arcadia', lat: 33.4946, lon: -111.9856, radiusM: 120 },
  { key: 'tire', name: 'Discount Tire', lat: 33.4806, lon: -111.9815, radiusM: 120 },
  { key: 'ea', name: 'Walmart Tempe', lat: 33.4141, lon: -111.9262, radiusM: 150 },
  { key: 'gym', name: 'Gym', lat: 33.5031, lon: -111.9995, radiusM: 120 },
  { key: 'sedona', name: 'Sedona', lat: 34.8697, lon: -111.7610, radiusM: 1500 },
  { key: 'tlaquepaque', name: 'Tlaquepaque, Sedona', lat: 34.8627, lon: -111.7654, radiusM: 200 },
];
export const place = (key: string): DemoPlace => DEMO_PLACES.find((p) => p.key === key)!;

/** Public chargers (approximate positions of the real public sites). */
export type DemoCharger = LatLon & { id: number; name: string; network: string; kw: number; connectors: ('NACS' | 'CCS' | 'J1772')[]; price: string | null; level: 2 | 3 };
export const DEMO_CHARGERS: DemoCharger[] = [
  { id: 910001, name: 'Tesla Supercharger, Tempe Marketplace', network: 'Tesla', lat: 33.4301, lon: -111.9021, kw: 250, connectors: ['NACS'], price: '$0.43/kWh', level: 3 },
  { id: 910002, name: 'Electrify America, Walmart Supercenter Tempe', network: 'Electrify America', lat: 33.4141, lon: -111.9262, kw: 350, connectors: ['CCS', 'NACS'], price: '$0.56/kWh', level: 3 },
  { id: 910003, name: 'EVgo, Fry\'s Marketplace Arcadia', network: 'EVgo', lat: 33.4949, lon: -111.9998, kw: 100, connectors: ['CCS'], price: '$0.52/kWh', level: 3 },
  { id: 910004, name: 'Burton Barr Central Library', network: 'ChargePoint', lat: 33.4648, lon: -112.0731, kw: 6.6, connectors: ['J1772'], price: 'Free', level: 2 },
  { id: 910005, name: 'Tempe Beach Park garage', network: 'Blink', lat: 33.4311, lon: -111.9413, kw: 7.2, connectors: ['J1772'], price: '$0.39/kWh', level: 2 },
  { id: 910006, name: 'Tesla Supercharger, Sedona', network: 'Tesla', lat: 34.8641, lon: -111.7932, kw: 150, connectors: ['NACS'], price: '$0.48/kWh', level: 3 },
  { id: 910007, name: 'Tlaquepaque Arts Village', network: 'Non-Networked', lat: 34.8627, lon: -111.7654, kw: 7.2, connectors: ['J1772'], price: 'Free', level: 2 },
  { id: 910008, name: 'Electrify America, Camp Verde', network: 'Electrify America', lat: 34.5636, lon: -111.8540, kw: 350, connectors: ['CCS', 'NACS'], price: '$0.56/kWh', level: 3 },
];

/** Invented music: artists, albums and tracks that don't exist. */
export type DemoTrack = { title: string; artist: string; album: string; ms: number; hue: number };
export const DEMO_TRACKS: DemoTrack[] = [
  { title: 'Saguaro Static', artist: 'The Night Rangers', album: 'Desert Frequencies', ms: 214_000, hue: 18 },
  { title: 'Monsoon Season', artist: 'Lila Marchetti', album: 'Low Desert Light', ms: 247_000, hue: 205 },
  { title: 'Copper Mile', artist: 'Vela Coast', album: 'Copper Mile', ms: 198_000, hue: 32 },
  { title: 'Highway Glow', artist: 'Neon Arroyo', album: 'After the Heat', ms: 231_000, hue: 285 },
  { title: 'Paper Lanterns', artist: 'June & the Wildflowers', album: 'Porch Songs', ms: 186_000, hue: 120 },
  { title: 'Second Wind', artist: 'The Night Rangers', album: 'Desert Frequencies', ms: 222_000, hue: 18 },
  { title: 'Blue Hour', artist: 'Marlowe Reyes', album: 'Blue Hour', ms: 263_000, hue: 225 },
  { title: 'Gravel & Gold', artist: 'Dusty Kites', album: 'County Line', ms: 205_000, hue: 45 },
];
export const DEMO_PLAYLISTS = [
  { id: 'demoRoadTrip001', name: 'Road Trip', tracks: 64 },
  { id: 'demoMorningDrv02', name: 'Morning Drive', tracks: 38 },
  { id: 'demoDesertNts003', name: 'Desert Nights', tracks: 51 },
  { id: 'demoChillMix0004', name: 'Chill Mix', tracks: 72 },
];

/** A square cover for an invented album: a gradient and a sun over hills, as an SVG data URL. Pure. */
export function coverArt(hue: number, label = ''): string {
  const h2 = (hue + 40) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,62%)"/><stop offset="1" stop-color="hsl(${h2},55%,22%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="150" cy="150" r="58" fill="hsl(${(hue + 20) % 360},90%,78%)" opacity=".85"/><path d="M0 210 Q70 160 140 200 T300 190 V300 H0Z" fill="hsl(${h2},45%,14%)"/><path d="M0 250 Q90 215 180 245 T300 235 V300 H0Z" fill="hsl(${h2},40%,9%)"/>${label ? `<text x="20" y="40" font-family="sans-serif" font-size="22" fill="#fff" opacity=".8">${label.replace(/[<&>"]/g, '')}</text>` : ''}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Freeway stretches, named for the location chip while driving at speed. */
export const DEMO_FREEWAYS: { name: string; path: LatLon[] }[] = [
  { name: 'Loop 202', path: [{ lat: 33.4255, lon: -111.9400 }, { lat: 33.4255, lon: -111.9790 }, { lat: 33.4370, lon: -112.0200 }] },
  { name: 'I-10', path: [{ lat: 33.4370, lon: -112.0200 }, { lat: 33.4480, lon: -112.0400 }, { lat: 33.4484, lon: -112.0740 }] },
  { name: 'SR-51', path: [{ lat: 33.4600, lon: -112.0420 }, { lat: 33.4990, lon: -112.0420 }, { lat: 33.5400, lon: -112.0400 }] },
  { name: 'I-17', path: [{ lat: 33.4600, lon: -112.1150 }, { lat: 33.7000, lon: -112.1100 }, { lat: 34.2000, lon: -112.0600 }, { lat: 34.5600, lon: -111.8600 }, { lat: 34.8000, lon: -111.7700 }] },
];

/** Neighbourhoods and districts for the location chip. */
export const DEMO_AREAS: (LatLon & { name: string })[] = [
  { name: 'Arcadia, Phoenix', lat: 33.4990, lon: -111.9788 },
  { name: 'Camelback East, Phoenix', lat: 33.5100, lon: -112.0100 },
  { name: 'Biltmore, Phoenix', lat: 33.5100, lon: -112.0300 },
  { name: 'Midtown Phoenix', lat: 33.4800, lon: -112.0740 },
  { name: 'Downtown Phoenix', lat: 33.4500, lon: -112.0700 },
  { name: 'Sky Harbor, Phoenix', lat: 33.4350, lon: -112.0100 },
  { name: 'Papago Park', lat: 33.4570, lon: -111.9480 },
  { name: 'Downtown Tempe', lat: 33.4255, lon: -111.9400 },
  { name: 'North Tempe', lat: 33.4450, lon: -111.9260 },
  { name: 'South Scottsdale', lat: 33.4750, lon: -111.9260 },
  { name: 'Sedona', lat: 34.8697, lon: -111.7610 },
  { name: 'Camp Verde', lat: 34.5636, lon: -111.8540 },
];
