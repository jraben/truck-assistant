// DEMO=1: a lived-in truck for a fresh DATA_DIR. Three-odd weeks of trips at
// daytime hours (commutes, errands, a weekend in Sedona), the charge sessions
// that kept it going (home overnight on a time-of-use rate, a Supercharger,
// Electrify America, a free destination charger), maintenance and mileage
// logs, and the settings for the invented services behind the gate. Every
// name is generic and every place is public; nothing is read from anywhere.
//
// Only an EMPTY DATA_DIR is seeded: a directory with anything in it is left
// alone, so restarting a demo keeps what it has, and pointing DEMO=1 at a real
// truck's data never rewrites it.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openDb, kvSet, type Db } from '../db.ts';
import { haversineMi, type LatLon } from '../geo.ts';
import { defaultSettings, guestDriver, newDriver, validate } from '../settings.ts';
import { defaultMediaSettings, mergeMedia } from '../media/settings.ts';
import { defaultOps } from '../ops/config.ts';
import { PlaceStore, StopStore } from '../stops/store.ts';
import { kwhFromSoc, priceHomeSession } from '../charges/pricing.ts';
import { SIM_ROUTE } from '../sim.ts';
import type { Settings } from '../types.ts';
import { DEMO_CHARGERS, DEMO_DRIVERS, DEMO_HA_URL, DEMO_PLACES, DEMO_SECRET, DEMO_WOPR_URL, place, type DemoPlace } from './world.ts';

export const DEMO_DAYS = 24;
export const PACK_KWH = 52.7;

/** True when the directory is missing or has nothing in it. */
export function isEmptyDataDir(dir: string): boolean {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).length === 0;
}

/** Deterministic randomness: the same history every time it is seeded. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- routes -------------------------------------------------------------------------

type Seg = { pts: LatLon[]; hwy: boolean };
const P = (lat: number, lon: number): LatLon => ({ lat, lon });
const home = () => place('home');

/** Each route as segments of waypoints; a route not listed is its reverse's mirror. */
function routeTable(): Record<string, Seg[]> {
  const h = home(), office = place('office'), down = place('downtown');
  const tempeCharger = DEMO_CHARGERS.find((c) => c.id === 910002)!;
  const superSedona = DEMO_CHARGERS.find((c) => c.id === 910006)!;
  const north: LatLon[] = [P(33.4990, -112.0420), P(33.6400, -112.1150), P(33.8500, -112.1400), P(34.2000, -112.0600), P(34.5600, -111.8600), P(34.7400, -111.7900)];
  return {
    'home>office': [{ pts: SIM_ROUTE[0], hwy: false }],
    'office>downtown': [{ pts: SIM_ROUTE[1], hwy: true }],
    'downtown>home': [{ pts: SIM_ROUTE[2], hwy: false }],
    'home>grocery': [{ pts: [h, P(33.4946, h.lon), place('grocery')], hwy: false }],
    'home>costco': [{ pts: [h, P(33.4945, h.lon), P(33.4945, -111.9262), P(33.4431, -111.9262), place('costco')], hwy: false }],
    'home>papago': [{ pts: [h, P(33.4945, h.lon), P(33.4945, -111.9455), place('papago')], hwy: false }],
    'home>gym': [{ pts: [h, P(33.5031, h.lon), place('gym')], hwy: false }],
    'home>tire': [{ pts: [h, P(33.4806, h.lon), place('tire')], hwy: false }],
    'office>tire': [{ pts: [office, P(33.4255, -111.9262), P(33.4806, -111.9262), place('tire')], hwy: false }],
    'home>downtown': [{ pts: [h, P(33.4990, -112.0740), down], hwy: false }],
    'costco>ea': [{ pts: [place('costco'), P(33.4431, -111.9262), P(tempeCharger.lat, -111.9262), tempeCharger], hwy: false }],
    'ea>home': [{ pts: [tempeCharger, P(tempeCharger.lat, -111.9262), P(33.4945, -111.9262), P(33.4945, h.lon), h], hwy: false }],
    'home>supercharger': [{ pts: [h, north[0]], hwy: false }, { pts: north, hwy: true }, { pts: [north[north.length - 1], superSedona], hwy: false }],
    'supercharger>tlaquepaque': [{ pts: [superSedona, P(34.8690, -111.7700), place('tlaquepaque')], hwy: false }],
    'tlaquepaque>sedona': [{ pts: [place('tlaquepaque'), P(34.8660, -111.7620), place('sedona')], hwy: false }],
    'sedona>home': [{ pts: [place('sedona'), north[north.length - 1]], hwy: false }, { pts: [...north].reverse(), hwy: true }, { pts: [north[0], h], hwy: false }],
  };
}

function route(from: string, to: string): Seg[] {
  const t = routeTable();
  if (t[`${from}>${to}`]) return t[`${from}>${to}`];
  const r = t[`${to}>${from}`];
  if (!r) throw new Error(`no demo route ${from} -> ${to}`);
  return [...r].reverse().map((s) => ({ pts: [...s.pts].reverse(), hwy: s.hwy }));
}

const polyMi = (pts: LatLon[]) => pts.slice(1).reduce((a, p, i) => a + haversineMi(pts[i], p), 0);

/** Corners cut ~40 m short, the way a truck (and its GPS) actually takes a turn. */
function roundCorners(pts: LatLon[]): LatLon[] {
  if (pts.length < 3) return pts;
  const toward = (to: LatLon, from: LatLon) => { const d = haversineMi(from, to); const f = d > 0 ? Math.min(0.4, 0.025 / d) : 0; return P(to.lat + (from.lat - to.lat) * f, to.lon + (from.lon - to.lon) * f); };
  const out: LatLon[] = [pts[0]];
  for (let i = 1; i + 1 < pts.length; i++) {
    const b = pts[i], inn = toward(b, pts[i - 1]), outp = toward(b, pts[i + 1]);
    const mid = P((inn.lat + outp.lat) / 2, (inn.lon + outp.lon) / 2);
    out.push(inn, P(b.lat * 0.6 + mid.lat * 0.4, b.lon * 0.6 + mid.lon * 0.4), outp);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Points every ~0.1 mi along the segments, with timestamps at city or highway pace and a little GPS wander. */
function densify(segs: Seg[], start: number, r: () => number): { pts: { t: number; lat: number; lon: number; mph: number; hdg: number }[]; end: number } {
  const out: { t: number; lat: number; lon: number; mph: number; hdg: number }[] = [];
  let t = start;
  let drift = 0; // lateral offset in degrees, a slow random walk (lane changes, GPS noise)
  for (const s of segs) {
    const path = roundCorners(s.pts);
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1];
      const d = haversineMi(a, b);
      const n = Math.max(1, Math.ceil(d / 0.1));
      const k0 = Math.cos((a.lat * Math.PI) / 180);
      const len = Math.hypot((b.lon - a.lon) * k0, b.lat - a.lat) || 1;
      const nx = -(b.lat - a.lat) / len, ny = ((b.lon - a.lon) * k0) / len; // unit normal (lon scaled, lat)
      const hdg = (Math.atan2((b.lon - a.lon) * k0, b.lat - a.lat) * 180) / Math.PI;
      for (let k = 0; k < n; k++) {
        const f = k / n;
        const mph = s.hwy ? 56 + r() * 12 : 24 + r() * 18;
        drift = Math.max(-0.00012, Math.min(0.00012, drift + (r() - 0.5) * 0.00006));
        const w = d > 0.2 ? Math.sin(Math.PI * f) : 0; // wander away from the corners only
        out.push({ t, lat: a.lat + (b.lat - a.lat) * f + ny * drift * w, lon: a.lon + (b.lon - a.lon) * f + (nx * drift * w) / k0, mph: Math.round(mph * 10) / 10, hdg: Math.round((hdg + 360) % 360) });
        t += ((d / n) / mph) * 3600_000 * (s.hwy ? 1.3 : 1.7); // traffic, lights and turns
      }
    }
  }
  const last = segs[segs.length - 1].pts.at(-1)!;
  out.push({ t, lat: last.lat, lon: last.lon, mph: 0, hdg: out.at(-1)?.hdg ?? 0 });
  return { pts: out, end: t };
}

// ---- the plan --------------------------------------------------------------------------

type Plan =
  | { kind: 'drive'; at: number; driver: string; from: string; to: string; eff?: { city: number; hwy: number }; purpose?: 'business'; note?: string }
  | { kind: 'charge'; at: number; network: 'Tesla' | 'Electrify America' | 'free'; chargerId: number; toSoc: number; minutes?: number };

/** Local time on a day offset from `base` (midnight of today). */
const tAt = (base: Date, day: number, h: number, m: number) => { const d = new Date(base); d.setDate(d.getDate() + day); d.setHours(h, m, 0, 0); return d.getTime(); };

/** Day-by-day itinerary. Weekdays: Alex commutes, Sam runs errands; one weekend in Sedona. Pure given the clock and seed. */
export function buildPlan(now: Date, r: () => number): Plan[] {
  const base = new Date(now); base.setHours(0, 0, 0, 0);
  const plan: Plan[] = [];
  const jit = (max: number) => Math.round((r() - 0.5) * 2 * max);
  // The weekend for Sedona: the Saturday nearest ten days back.
  let sedona = -1;
  for (let d = -DEMO_DAYS; d <= -2; d++) {
    const dow = new Date(tAt(base, d, 12, 0)).getDay();
    if (dow === 6 && (sedona < 0 || Math.abs(d + 10) < Math.abs(sedona + 10))) sedona = d;
  }
  let sundayN = 0;
  for (let d = -DEMO_DAYS; d <= 0; d++) {
    const dow = new Date(tAt(base, d, 12, 0)).getDay();
    const at = (h: number, m: number, j = 6) => tAt(base, d, h, m) + jit(j) * 60_000;
    const drive = (time: number, driver: string, from: string, to: string, extra: Partial<Extract<Plan, { kind: 'drive' }>> = {}) => plan.push({ kind: 'drive', at: time, driver, from, to, ...extra });
    if (d === sedona) {
      drive(at(8, 10, 4), 'alex', 'home', 'supercharger', { eff: { city: 3.6, hwy: 2.75 } });
      plan.push({ kind: 'charge', at: 0, network: 'Tesla', chargerId: 910006, toSoc: 80 });
      drive(at(11, 5, 3), 'alex', 'supercharger', 'tlaquepaque');
      plan.push({ kind: 'charge', at: 0, network: 'free', chargerId: 910007, toSoc: 94, minutes: 150 });
      drive(at(16, 20, 5), 'sam', 'tlaquepaque', 'sedona');
      continue;
    }
    if (d === sedona + 1) {
      drive(at(9, 40, 6), 'sam', 'sedona', 'home', { eff: { city: 4.1, hwy: 4.25 } });
      continue;
    }
    if (dow === 0 || dow === 6) {
      if (dow === 0) sundayN++;
      if (dow === 6) {
        drive(at(7, 50), 'sam', 'home', 'papago');
        drive(at(9, 55), 'sam', 'papago', 'home');
        drive(at(14, 20, 15), 'alex', 'home', 'costco');
        drive(at(15, 25, 10), 'alex', 'costco', 'home');
      } else if (sundayN % 2) {
        drive(at(10, 15, 10), 'alex', 'home', 'downtown');
        drive(at(12, 50, 10), 'alex', 'downtown', 'home');
      } else {
        drive(at(11, 0, 20), 'sam', 'home', 'grocery');
        drive(at(11, 45, 10), 'sam', 'grocery', 'home');
      }
      continue;
    }
    // Weekdays: the commute (Wednesday Alex works from home and Sam has the truck).
    if (dow === 3) {
      drive(at(9, 30, 15), 'sam', 'home', 'costco');
      if (d > -9) { // one week a fast-charge top-up next door, on the way back from Costco
        drive(at(10, 40, 10), 'sam', 'costco', 'ea');
        plan.push({ kind: 'charge', at: 0, network: 'Electrify America', chargerId: 910002, toSoc: 76 });
        drive(at(11, 10, 5), 'sam', 'ea', 'home');
      } else drive(at(10, 40, 10), 'sam', 'costco', 'home');
      drive(at(17, 30, 10), 'sam', 'home', 'grocery');
      drive(at(18, 5, 5), 'sam', 'grocery', 'home');
      continue;
    }
    drive(at(7, 35), 'alex', 'home', 'office');
    if (dow === 4) {
      drive(at(17, 40), 'alex', 'office', 'downtown', { purpose: 'business', note: 'Client dinner' });
      drive(at(20, 25, 10), 'alex', 'downtown', 'home');
    } else {
      drive(at(17, 15, 10), 'alex', 'office', 'home');
      if (dow === 2) {
        drive(at(18, 20, 5), 'alex', 'home', 'gym');
        drive(at(19, 35, 5), 'alex', 'gym', 'home');
      }
    }
  }
  return plan;
}

// ---- writing it ----------------------------------------------------------------------

export type SeedSummary = { trips: number; stops: number; charges: number; miles: number; firstDay: string; soc: number };

function demoSettings(firstDay: string): Settings {
  const s = defaultSettings();
  const h = home();
  s.drivers = [
    ...DEMO_DRIVERS.map((d) => ({ ...newDriver(d.id, d.name, { initials: d.initials, color: d.color }), hotspot: { ssid: d.hotspot } })),
    guestDriver(),
  ];
  s.homeAssistant = { bridge: true, url: DEMO_HA_URL, token: DEMO_SECRET };
  // A typical Phoenix time-of-use plan: on-peak weekday afternoons, off-peak the rest.
  s.homeRate = { flatPerKwh: 0.1067, tou: [{ name: 'On-peak', days: [1, 2, 3, 4, 5], start: '16:00', end: '19:00', perKwh: 0.2925 }], fixedPerSession: 0, demandPerKw: null };
  s.homeLocation = { lat: h.lat, lon: h.lon };
  s.compareVehicle = { id: null, label: 'Gas pickup (V6)', mpgCity: 18, mpgHighway: 24, mpgCombined: 20, fuel: 'regular' };
  s.gas = { source: 'manual', manualPrice: 3.29, haEntities: [], pick: 'cheapest' };
  s.homeWifi = { ssid: 'Home Wi-Fi' };
  s.keys = { openChargeMap: DEMO_SECRET, traffic511: { az: DEMO_SECRET } };
  s.payoffGoal = { ...s.payoffGoal, target: 29_950, startDate: firstDay }; // a round sticker price, not anyone's build
  return validate(s);
}

function writeJson(file: string, v: unknown) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const iso = (t: number) => new Date(t).toISOString();
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Seed an empty DATA_DIR. Returns null (and touches nothing) when the directory
 * already has files in it.
 */
export function seedDemo(dataDir: string, now = new Date()): SeedSummary | null {
  if (!isEmptyDataDir(dataDir)) return null;
  mkdirSync(dataDir, { recursive: true });
  try { return seedInto(dataDir, now); }
  catch (e) {
    // Half a seed would read as "already has data" next time: put the directory back to empty.
    for (const f of readdirSync(dataDir)) rmSync(path.join(dataDir, f), { recursive: true, force: true });
    throw e;
  }
}

function seedInto(dataDir: string, now: Date): SeedSummary {
  const r = rng(20261107);
  const plan = buildPlan(now, r);
  const firstDrive = plan.find((p) => p.kind === 'drive')!.at;
  const firstDay = day(firstDrive);
  const settings = demoSettings(firstDay);
  writeJson(path.join(dataDir, 'settings.json'), settings);

  const media = defaultMediaSettings();
  media.wopr = { url: DEMO_WOPR_URL, username: 'alex', password: DEMO_SECRET };
  media.spotify.clientId = 'de300000000000000000000000000000';
  const far = now.getTime() + 10 * 365 * 86400_000;
  for (const d of [...DEMO_DRIVERS.map((x) => x.id), 'guest']) media.spotify.tokens[d] = { access: 'demo-access', refresh: 'demo-refresh', expiresAt: far, scope: 'user-read-playback-state', user: DEMO_DRIVERS.find((x) => x.id === d)?.name ?? 'Guest' };
  media.radio.kjefUrl = 'https://stream.demo/radio.mp3';
  media.receipts.autoImport = false;
  mergeMedia(defaultMediaSettings(), media); // throws if the store would refuse any of it (it falls back to defaults)
  writeJson(path.join(dataDir, 'media.json'), media);

  const db = openDb(dataDir);
  try {
    const sum = writeHistory(db, settings, plan, now, r);
    writeOps(dataDir, db, now, firstDrive, sum);
    return { ...sum, firstDay };
  } finally { db.close(); }
}

function writeHistory(db: Db, settings: Settings, plan: Plan[], now: Date, r: () => number): Omit<SeedSummary, 'firstDay'> & { odoMiles: number } {
  const places = new PlaceStore(db), stops = new StopStore(db);
  const placeIds = new Map<string, number>();
  for (const p of DEMO_PLACES) placeIds.set(p.key, places.create({ name: p.name, lat: p.lat, lon: p.lon, radiusM: p.radiusM, createdBy: 'alex' }).id);
  db.prepare('UPDATE places SET created_at = ?').run(iso(plan[0].at - 86400_000));
  const chargerAt = (id: number) => DEMO_CHARGERS.find((c) => c.id === id)!;
  const where = (key: string): DemoPlace & { stationOf?: number } => {
    if (key === 'supercharger') { const c = chargerAt(910006); return { key, name: 'Sedona', lat: c.lat, lon: c.lon, radiusM: 80 }; }
    return place(key);
  };
  const placeFor = (key: string) => (key === 'supercharger' ? placeIds.get('sedona')! : placeIds.get(key) ?? null);

  const insTrip = db.prepare(`INSERT INTO trips (started_at, ended_at, miles, duration_s, start_soc, end_soc, kwh_est, start_lat, start_lon, end_lat, end_lon, end_reason,
    driver_id, source, start_stop_id, end_stop_id, city_miles, highway_miles, city_kwh, highway_kwh, simulated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ignition off', ?, 'truck', ?, ?, ?, ?, ?, ?, 0)`);
  const insPt = db.prepare('INSERT INTO trip_points (trip_id, t, lat, lon, speed_mph, heading_deg) VALUES (?, ?, ?, ?, ?, ?)');
  const insCharge = db.prepare(`INSERT INTO charge_sessions (started_at, ended_at, place, network, station_name, lat, lon, kwh, cost, cost_source, start_soc, end_soc, max_kw, note, source, driver_id, simulated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0)`);
  db.exec('CREATE TABLE IF NOT EXISTS trip_tags (trip_id INTEGER PRIMARY KEY, purpose TEXT, note TEXT, updated_at TEXT NOT NULL)'); // as MileageService makes it
  const insTag = db.prepare('INSERT INTO trip_tags (trip_id, purpose, note, updated_at) VALUES (?, ?, ?, ?)');

  let soc = 81;
  let atKey = 'home';
  let openStop = stops.create({ driverId: 'alex', source: 'truck', arrivedAt: iso(plan[0].at - 14 * 3600_000), departedAt: null, lat: home().lat, lon: home().lon, reason: 'ignition' });
  stops.setName(openStop.id, { name: 'Home', source: 'place', placeId: placeIds.get('home')! });
  let nTrips = 0, nStops = 1, nCharges = 0, miles = 0;
  let lastEnd = 0;
  let homeCharged = '';   // the day of the last home session (one a night)

  /** Overnight at home: plug in at 9 pm (after on-peak) when it's below ~60%, charge to 80% at 7.2 kW. */
  const maybeHomeCharge = (arriveAt: number, nextLeaveAt: number, driver: string, roadTrip = false) => {
    if (atKey !== 'home' || (soc >= 58 && !roadTrip) || homeCharged === day(arriveAt)) return;
    const night = new Date(arriveAt); night.setHours(21, 0, 0, 0);
    const start = Math.max(arriveAt + 10 * 60_000, night.getTime()) + Math.round(r() * 20) * 60_000;
    const target = roadTrip ? 100 : 80;
    const kwh = kwhFromSoc(soc, target, PACK_KWH)!;
    const end = start + (kwh / 7.2) * 3600_000;
    if (end > nextLeaveAt - 5 * 60_000 || end > now.getTime()) return;
    const h = home();
    insCharge.run(iso(start), iso(end), 'home', null, 'Home', h.lat, h.lon, r2(kwh), priceHomeSession(kwh, new Date(start), settings.homeRate), 'home-rate', Math.round(soc), target, 7.2, 'detected', driver);
    nCharges++; homeCharged = day(arriveAt);
    soc = target;
  };

  // Today's drives count only up to the last one home that finished half an hour ago, so the truck is home now.
  const cutoff = (() => {
    let c = -Infinity;
    for (const p of plan) if (p.kind === 'drive' && p.to === 'home' && p.at < now.getTime() - 90 * 60_000) c = p.at;
    return c;
  })();
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (p.kind === 'charge') {
      const c = chargerAt(p.chargerId);
      const start = lastEnd + (4 + Math.round(r() * 4)) * 60_000;
      const target = p.toSoc;
      const packIn = ((target - soc) / 100) * PACK_KWH;
      const free = p.network === 'free';
      const kwh = free ? kwhFromSoc(soc, target, PACK_KWH)! : packIn / 0.95;
      const avgKw = free ? c.kw * 0.95 : soc < 50 ? 82 : 55;
      const minutes = p.minutes ?? (kwh / avgKw) * 60;
      const end = start + minutes * 60_000;
      const cost = free ? 0 : r2(kwh * Number(c.price!.replace(/[^\d.]/g, '')));
      insCharge.run(iso(start), iso(end), 'public', free ? null : c.network, c.name, c.lat, c.lon, r2(kwh), cost, free ? 'free' : 'receipt', Math.round(soc), target, free ? c.kw : Math.round(avgKw * 1.6), 'manual', plan.slice(0, i).reverse().find((x) => x.kind === 'drive')?.driver ?? 'alex');
      nCharges++;
      soc = target;
      lastEnd = end;
      continue;
    }
    // The truck sat at atKey since the last arrival; maybe it charged overnight first.
    if (p.at > cutoff) break;   // today, still to come: the simulator drives from here
    maybeHomeCharge(lastEnd || p.at - 12 * 3600_000, p.at, p.driver, p.to === 'supercharger');
    const start = Math.max(p.at, lastEnd + 15 * 60_000);
    const segs = route(p.from, p.to);
    const { pts, end } = densify(segs, start, r);
    const eff = p.eff ?? { city: 3.7 + r() * 0.5, hwy: 3.05 + r() * 0.3 };
    const cityMi = segs.filter((s) => !s.hwy).reduce((a, s) => a + polyMi(s.pts), 0) * 1.08;
    const hwyMi = segs.filter((s) => s.hwy).reduce((a, s) => a + polyMi(s.pts), 0) * 1.1;
    const tripMi = cityMi + hwyMi;
    const cityKwh = cityMi / eff.city, hwyKwh = hwyMi / eff.hwy;
    const startSoc = soc;
    soc = Math.max(5, soc - ((cityKwh + hwyKwh) / PACK_KWH) * 100);
    // Close the stop it left from, open one where it arrives.
    db.prepare('UPDATE stops SET departed_at = ? WHERE id = ?').run(iso(start), openStop.id);
    const fromStopId = openStop.id;
    const dest = where(p.to);
    openStop = stops.create({ driverId: p.driver, source: 'truck', arrivedAt: iso(end), departedAt: null, lat: dest.lat + (r() - 0.5) * 0.0003, lon: dest.lon + (r() - 0.5) * 0.0003, reason: 'ignition' });
    const pid = placeFor(p.to);
    const pname = pid ? DEMO_PLACES.find((x) => placeIds.get(x.key) === pid)!.name : dest.name;
    stops.setName(openStop.id, { name: pname, source: 'place', placeId: pid });
    nStops++;
    const a = pts[0], b = pts[pts.length - 1];
    const res = insTrip.run(iso(start), iso(end), Math.round(tripMi * 1000) / 1000, Math.round((end - start) / 1000), Math.round(startSoc * 10) / 10, Math.round(soc * 10) / 10,
      r2(cityKwh + hwyKwh), a.lat, a.lon, b.lat, b.lon, p.driver, fromStopId, openStop.id,
      Math.round(cityMi * 100) / 100, Math.round(hwyMi * 100) / 100, r2(cityKwh), r2(hwyKwh));
    const tripId = Number(res.lastInsertRowid);
    for (const q of pts) insPt.run(tripId, iso(q.t), q.lat, q.lon, q.mph, q.hdg);
    if (p.purpose) insTag.run(tripId, p.purpose, p.note ?? null, iso(end));
    nTrips++; miles += tripMi;
    atKey = p.to === 'supercharger' ? 'sedona' : p.to;
    lastEnd = end;
  }
  // Last night at home, plugged in as usual.
  maybeHomeCharge(lastEnd, now.getTime() - 30 * 60_000, 'alex');

  kvSet(db, 'soc', { value: Math.round(soc * 10) / 10, source: 'can', updatedAt: now.toISOString() });
  kvSet(db, 'activeDriver', 'alex');
  kvSet(db, 'haPanel', {
    garage: { cover: 'cover.garage_door', light: 'light.garage_opener_light', obstruction: 'binary_sensor.garage_door_obstruction', ask: true, nearM: 250 },
    pages: [
      { title: 'House', dashboard: null, entities: ['lock.front_door', 'climate.thermostat', 'light.porch', 'camera.backyard', 'sensor.living_room_temperature', 'light.patio', 'lock.side_gate', 'switch.sprinklers', 'sensor.pool_temperature'] },
    ],
  });
  return { trips: nTrips, stops: nStops, charges: nCharges, miles: Math.round(miles * 10) / 10, soc: Math.round(soc * 10) / 10, odoMiles: miles };
}

function writeOps(dataDir: string, db: Db, now: Date, firstDrive: number, sum: { odoMiles: number }) {
  const ops = defaultOps();
  ops.setup = { done: true, steps: { password: 'skipped', ap: 'skipped', truck: 'done', home: 'done', drivers: 'done', ha: 'done', hotspot: 'done', vehicle: 'done' } };
  // Delivered five months ago; the odometer as read off the dash the day before the history starts.
  const DELIVERED = 150, odoStart = 2318;
  ops.mileage.odometerAnchor = { odometer: odoStart, at: new Date(firstDrive - 86400_000).toISOString() };
  ops.mileage.driverDefaults = { alex: 'personal', sam: 'personal' };
  const officeId = (db.prepare("SELECT id FROM places WHERE name = 'Office'").get() as { id: number }).id;
  ops.mileage.placeTags = { [String(officeId)]: 'commute' };
  const ago = (days: number) => new Date(now.getTime() - days * 86400_000).toISOString();
  /** Odometer that many days ago: 12 mi at delivery, rising steadily to the anchor. */
  const odoAt = (days: number) => Math.round(days >= DELIVERED ? 12 : 12 + ((DELIVERED - days) / (DELIVERED - DEMO_DAYS - 1)) * (odoStart - 12));
  const delivered = { at: ago(DELIVERED), odometer: 12 };
  const rem = (id: string, name: string, everyMiles: number | null, everyMonths: number | null, doneDaysAgo: number | null) => ({
    id, name, everyMiles, everyMonths, note: "Set from the owner's manual",
    lastDone: doneDaysAgo === null ? null : { at: ago(doneDaysAgo), odometer: odoAt(doneDaysAgo) }, since: delivered,
  });
  ops.maintenance.reminders = [
    rem('tire-rotation', 'Tire rotation', 3500, 6, null),
    rem('cabin-filter', 'Cabin air filter', 15000, 12, null),
    rem('wiper-blades', 'Wiper blades', null, 12, DELIVERED),
    rem('battery-12v', '12V battery check', null, 12, 95),
    rem('brake-fluid', 'Brake fluid', null, 24, null),
  ];
  writeJson(path.join(dataDir, 'ops.json'), ops);
  db.exec(`CREATE TABLE IF NOT EXISTS maint_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, odometer REAL, item TEXT NOT NULL,
    reminder_id TEXT, cost REAL, shop TEXT, note TEXT, receipt TEXT, created_at TEXT NOT NULL)`);
  const ins = db.prepare('INSERT INTO maint_log (date, odometer, item, reminder_id, cost, shop, note, receipt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)');
  const log = (daysAgo: number, item: string, reminder: string | null, cost: number | null, shop: string | null, note: string | null) => ins.run(ago(daysAgo), odoAt(daysAgo), item, reminder, cost, shop, note, ago(daysAgo));
  log(DELIVERED, 'Delivery inspection', null, 0, 'Slate service center', 'Pre-delivery checklist, all good');
  log(DELIVERED, 'Wiper blades', 'wiper-blades', 0, 'Slate service center', 'Fitted at delivery');
  log(95, '12V battery check', 'battery-12v', 0, null, '12.7 V at rest');
  log(62, 'Bed liner installed', null, 389, 'Truck accessory shop', 'Spray-in liner');
  log(18, 'Tire pressure top-up', null, 0, null, 'Set to 38 front / 40 rear before the Sedona trip');
}
