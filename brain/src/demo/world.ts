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
  // Along I-17 north and I-10 west/south, for the road-trip demo (approximate, invented sites).
  { id: 910101, name: 'Anthem Outlets fast chargers', network: 'EVgo', lat: 33.8669, lon: -112.1466, kw: 100, connectors: ['CCS'], price: '$0.52/kWh', level: 3 },
  { id: 910102, name: 'Cordes Junction travel center', network: 'Electrify America', lat: 34.3254, lon: -112.1172, kw: 150, connectors: ['CCS', 'NACS'], price: '$0.56/kWh', level: 3 },
  { id: 910103, name: 'Munds Park fast chargers', network: 'ChargePoint', lat: 34.9412, lon: -111.6405, kw: 62.5, connectors: ['CCS'], price: '$0.49/kWh', level: 3 },
  { id: 910104, name: 'Tesla Supercharger, Flagstaff', network: 'Tesla', lat: 35.1890, lon: -111.6620, kw: 250, connectors: ['NACS'], price: '$0.45/kWh', level: 3 },
  { id: 910105, name: 'Electrify America, Flagstaff Mall', network: 'Electrify America', lat: 35.2210, lon: -111.5815, kw: 350, connectors: ['CCS', 'NACS'], price: '$0.56/kWh', level: 3 },
  { id: 910201, name: 'Buckeye travel plaza', network: 'EVgo', lat: 33.4377, lon: -112.6413, kw: 100, connectors: ['CCS'], price: '$0.52/kWh', level: 3 },
  { id: 910202, name: 'Tonopah truck stop chargers', network: 'Electrify America', lat: 33.4930, lon: -112.9410, kw: 150, connectors: ['CCS', 'NACS'], price: '$0.56/kWh', level: 3 },
  { id: 910203, name: 'Tesla Supercharger, Quartzsite', network: 'Tesla', lat: 33.6640, lon: -114.2290, kw: 250, connectors: ['NACS'], price: '$0.47/kWh', level: 3 },
  { id: 910204, name: 'Electrify America, Blythe', network: 'Electrify America', lat: 33.6105, lon: -114.5960, kw: 350, connectors: ['CCS', 'NACS'], price: '$0.58/kWh', level: 3 },
  { id: 910205, name: 'Desert Center fast chargers', network: 'EVgo', lat: 33.7130, lon: -115.4010, kw: 100, connectors: ['CCS'], price: '$0.55/kWh', level: 3 },
  { id: 910206, name: 'Tesla Supercharger, Indio', network: 'Tesla', lat: 33.7206, lon: -116.2156, kw: 250, connectors: ['NACS'], price: '$0.50/kWh', level: 3 },
  { id: 910207, name: 'Electrify America, Banning', network: 'Electrify America', lat: 33.9253, lon: -116.8760, kw: 350, connectors: ['CCS', 'NACS'], price: '$0.58/kWh', level: 3 },
  { id: 910301, name: 'Casa Grande fast chargers', network: 'Electrify America', lat: 32.8795, lon: -111.7574, kw: 150, connectors: ['CCS', 'NACS'], price: '$0.56/kWh', level: 3 },
  { id: 910302, name: 'Tesla Supercharger, Tucson', network: 'Tesla', lat: 32.2860, lon: -110.9810, kw: 250, connectors: ['NACS'], price: '$0.46/kWh', level: 3 },
];

/**
 * The factory pickup: Slate builds the truck in Warsaw, Indiana, so the first
 * road trip is the drive home. I-70, I-44, I-40 and I-17; the chargers on it
 * are invented, at the towns the interstates really pass.
 */
const PICKUP_VIA: [string, number, number][] = [
  ['Kokomo, IN', 40.486, -86.134], ['Indianapolis, IN', 39.77, -86.16], ['Terre Haute, IN', 39.467, -87.414], ['Effingham, IL', 39.12, -88.54],
  ['St. Louis, MO', 38.63, -90.2], ['Rolla, MO', 37.95, -91.77], ['Springfield, MO', 37.21, -93.29], ['Joplin, MO', 37.08, -94.51],
  ['Tulsa, OK', 36.15, -95.99], ['Oklahoma City, OK', 35.47, -97.52], ['Clinton, OK', 35.51, -98.97], ['Shamrock, TX', 35.21, -100.25],
  ['Amarillo, TX', 35.22, -101.83], ['Tucumcari, NM', 35.17, -103.72], ['Santa Rosa, NM', 34.94, -104.68], ['Albuquerque, NM', 35.08, -106.65],
  ['Grants, NM', 35.15, -107.85], ['Gallup, NM', 35.53, -108.74], ['Holbrook, AZ', 34.9, -110.16], ['Winslow, AZ', 35.02, -110.7],
  ['Flagstaff, AZ', 35.1983, -111.6513], ['Camp Verde, AZ', 34.563, -111.854], ['Cordes Junction, AZ', 34.325, -112.117], ['Anthem, AZ', 33.87, -112.146],
];
export const PICKUP_FROM = { name: 'Slate factory, Warsaw, IN', lat: 41.2381, lon: -85.853 };
const NETS: [string, number, DemoCharger['connectors']][] = [['Tesla', 250, ['NACS']], ['Electrify America', 350, ['CCS', 'NACS']], ['Ionna', 400, ['CCS', 'NACS']], ['EVgo', 100, ['CCS']], ['ChargePoint', 62.5, ['CCS']]];
/** One charger per town on the way (Flagstaff south already has some), and one between towns more than 85 miles apart. */
function pickupChargers(): DemoCharger[] {
  const out: DemoCharger[] = [];
  const towns: [string, number, number][] = [['Warsaw, IN', PICKUP_FROM.lat, PICKUP_FROM.lon], ...PICKUP_VIA.slice(0, 20)];
  towns.forEach(([name, lat, lon], i) => {
    const [network, kw, connectors] = NETS[i % NETS.length];
    out.push({ id: 920000 + i * 2, name: `${network === 'Tesla' ? 'Tesla Supercharger' : network}, ${name}`, network, lat: lat + 0.004, lon: lon + 0.006, kw, connectors, price: `$0.${44 + (i * 7) % 16}/kWh`, level: 3 });
    // A second site in town on another network, so each stop has a backup.
    const [nb, kwb, cb] = NETS[(i + 3) % NETS.length];
    out.push({ id: 930000 + i, name: `${nb === 'Tesla' ? 'Tesla Supercharger' : nb}, ${name} (east)`, network: nb, lat: lat - 0.006, lon: lon + 0.03, kw: kwb, connectors: cb, price: `$0.${46 + (i * 5) % 14}/kWh`, level: 3 });
    const next = towns[i + 1];
    if (!next) return;
    const mi = Math.hypot((next[1] - lat) * 69, (next[2] - lon) * 69 * Math.cos((lat * Math.PI) / 180));
    if (mi > 85) {
      const [n2, kw2, c2] = NETS[(i + 2) % NETS.length];
      out.push({ id: 920001 + i * 2, name: `${n2}, I-${lon < -103 ? 40 : lon < -95 ? 40 : lon < -90 ? 44 : 70} travel plaza near ${name.split(',')[0]}`, network: n2, lat: (lat + next[1]) / 2, lon: (lon + next[2]) / 2, kw: kw2, connectors: c2, price: '$0.55/kWh', level: 3 });
    }
  });
  return out;
}
DEMO_CHARGERS.push(...pickupChargers());

/** Ready-made trips for the Road trip screen (from, to, and the charge at the start). */
export const DEMO_TRIPS = [
  { name: 'Factory pickup: Warsaw, IN to home', from: PICKUP_FROM, to: { name: 'Home', lat: DEMO_PLACES[0].lat, lon: DEMO_PLACES[0].lon }, startSoc: 80 },
];

/** Road-trip demo: destinations, and the highway each route follows (no router reached from a demo truck). */
export const DEMO_DESTINATIONS = [
  { name: 'Flagstaff, AZ', lat: 35.1983, lon: -111.6513 },
  { name: 'Tucson, AZ', lat: 32.2226, lon: -110.9747 },
  { name: 'Los Angeles, CA', lat: 34.0522, lon: -118.2437 },
  // Saved places to add as stops (invented): a diner, a friend with a charger, a hotel.
  { name: 'Cordes Lakes Diner', lat: 34.3290, lon: -112.1140, placeId: 9001, kind: 'restaurant', chargeKw: null },
  { name: 'Sam’s place, Flagstaff', lat: 35.2100, lon: -111.6300, placeId: 9002, kind: 'friend', chargeKw: 7.2 },
  { name: 'Desert Rest Inn, Quartzsite', lat: 33.6640, lon: -114.2170, placeId: 9003, kind: 'hotel', chargeKw: 1.4 },
];
export const DEMO_HIGHWAYS: { to: string; from?: [number, number]; via: [number, number][] }[] = [
  { to: 'Home', from: [PICKUP_FROM.lat, PICKUP_FROM.lon], via: [...PICKUP_VIA.map(([, lat, lon]) => [lat, lon] as [number, number]), [DEMO_PLACES[0].lat, DEMO_PLACES[0].lon]] },
  { to: 'Flagstaff, AZ', via: [[33.58, -112.10], [33.87, -112.146], [34.325, -112.117], [34.563, -111.854], [34.66, -111.76], [34.94, -111.64], [35.1983, -111.6513]] },
  { to: 'Tucson, AZ', via: [[33.30, -111.90], [32.88, -111.75], [32.65, -111.50], [32.2226, -110.9747]] },
  { to: 'Los Angeles, CA', via: [[33.44, -112.64], [33.49, -112.94], [33.664, -114.23], [33.61, -114.60], [33.713, -115.40], [33.72, -116.22], [33.925, -116.876], [34.06, -117.75], [34.0522, -118.2437]] },
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

/**
 * Invented Arizona 511 data along the simulated drive (and I-17 north), so the
 * Traffic screen has cameras and incidents in demo mode. The images are a
 * placeholder the brain draws (DEMO_FOOTAGE/traffic-<n>.jpg replaces one).
 */
export const DEMO_TRAFFIC_CAMS = [
  { id: 7101, roadway: 'Loop 202', direction: 'Eastbound', location: 'L-202 EB @ 44th St', lat: 33.4440, lon: -111.9870 },
  { id: 7102, roadway: 'Loop 202', direction: 'Westbound', location: 'L-202 WB @ Priest Dr', lat: 33.4320, lon: -111.9400 },
  { id: 7103, roadway: 'I-10', direction: 'Westbound', location: 'I-10 WB @ 24th St', lat: 33.4380, lon: -112.0300 },
  { id: 7104, roadway: 'I-10', direction: 'Westbound', location: 'I-10 WB @ 7th St', lat: 33.4470, lon: -112.0650 },
  { id: 7105, roadway: 'SR-51', direction: 'Northbound', location: 'SR-51 NB @ Thomas Rd', lat: 33.4800, lon: -112.0420 },
  { id: 7106, roadway: 'I-17', direction: 'Northbound', location: 'I-17 NB @ Carefree Hwy', lat: 33.8050, lon: -112.1260 },
  { id: 7107, roadway: 'I-17', direction: 'Northbound', location: 'I-17 NB @ Sunset Point', lat: 34.1950, lon: -112.1420 },
  { id: 7108, roadway: 'Scottsdale Rd', direction: 'Southbound', location: 'Scottsdale Rd SB @ McDowell', lat: 33.4660, lon: -111.9262 },
];
export const DEMO_TRAFFIC_EVENTS = [
  { ID: 88001, RoadwayName: 'I-10', DirectionOfTravel: 'Westbound', EventType: 'accidentsAndIncidents', EventSubType: 'Crash', Description: 'Crash blocking the left lane', LanesAffected: '1 left lane', Latitude: 33.4410, Longitude: -112.0480, IsFullClosure: false },
  { ID: 88002, RoadwayName: 'Loop 202', DirectionOfTravel: 'Eastbound', EventType: 'roadwork', EventSubType: 'Lane restriction', Description: 'Right lane closed for paving overnight', LanesAffected: '1 right lane', Latitude: 33.4280, Longitude: -111.9600, IsFullClosure: false },
  { ID: 88003, RoadwayName: 'I-17', DirectionOfTravel: 'Northbound', EventType: 'closures', EventSubType: 'Ramp closure', Description: 'Exit 229 off-ramp closed', LanesAffected: 'Ramp', Latitude: 33.7100, Longitude: -112.1120, IsFullClosure: false },
];

/** An invented address book for demo mode (already on the map: no lookups from a demo truck). */
export const DEMO_CONTACTS = [
  { sourceId: 'demo-1', name: 'Sam Rivera', org: null, phones: [{ number: '+1 602 555 0134', label: 'mobile' as const }], address: '1200 N Beaver St, Flagstaff, AZ 86001', lat: 35.2063, lon: -111.6510 },
  { sourceId: 'demo-2', name: 'Jordan Lee', org: null, phones: [{ number: '+1 520 555 0177', label: 'mobile' as const }], address: '400 N 4th Ave, Tucson, AZ 85705', lat: 32.2290, lon: -110.9670 },
  { sourceId: 'demo-3', name: 'Desert Bloom Café', org: 'Desert Bloom Café', phones: [{ number: '+1 928 555 0110', label: 'work' as const }], address: 'Main St, Camp Verde, AZ 86322', lat: 34.5640, lon: -111.8540 },
];
