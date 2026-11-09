// Naming stops and managing saved places: the naming chain (places > HA zones >
// places feed > OSM), tap-to-name, and "you keep going here" suggestions.
import { EventEmitter } from 'node:events';
import type { Db } from '../db.ts';
import { metersBetween } from '../geo.ts';
import { HaClient, zonesFrom } from '../ha/client.ts';
import type { Geocoder } from '../places/geocode.ts';
import { DEFAULT_RADIUS_M, parseFeed, resolveName, type Area } from '../places/naming.ts';
import type { Place, PlaceSuggestion, Settings, Stop } from '../types.ts';
import { PlaceStore, StopStore } from './store.ts';

export const PLACE_KINDS = ['home', 'restaurant', 'friend', 'hotel', 'work', 'other'];

export class PlaceInputError extends Error {}

export const SUGGEST_MIN_VISITS = 3;

type FeedFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class StopService extends EventEmitter {
  readonly stops: StopStore;
  readonly places: PlaceStore;
  zones: Area[] = [];
  feed: Area[] = [];
  feedError: string | null = null;
  private ha: HaClient;
  private getSettings: () => Settings;
  private geocoder: Geocoder | null;
  private fetchFn: FeedFetch;
  private geocoding: Promise<number> | null = null;

  constructor(db: Db, ha: HaClient, getSettings: () => Settings, geocoder: Geocoder | null, fetchFn: FeedFetch = fetch as unknown as FeedFetch) {
    super();
    this.stops = new StopStore(db);
    this.places = new PlaceStore(db);
    this.ha = ha; this.getSettings = getSettings; this.geocoder = geocoder; this.fetchFn = fetchFn;
  }

  tiers() {
    return {
      places: this.places.all().map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, radiusM: p.radius_m, placeId: p.id })),
      zones: this.zones,
      feed: this.feed,
    };
  }

  /** Apply the sync part of the chain to these stops; returns how many changed. */
  rename(stops: Stop[]): number {
    const tiers = this.tiers();
    let n = 0;
    for (const s of stops) {
      const r = resolveName(s, tiers);
      let next = r;
      if (!next) {
        const c = this.geocoder?.cached(s.lat, s.lon);
        next = c?.hit && c.name ? { name: c.name, source: 'geocode', placeId: null } : null;
      }
      if (next?.name !== s.name || (next?.source ?? null) !== s.nameSource || (next?.placeId ?? null) !== s.placeId) {
        this.stops.setName(s.id, next);
        n++;
      }
    }
    if (n) this.emit('renamed');
    return n;
  }

  /** A name for any point, for alert text: your places and zones, else OpenStreetMap
   *  (cached; at most `waitMs` here). null when nothing names it. */
  async placeName(p: { lat: number; lon: number }, waitMs = 4000): Promise<string | null> {
    const local = resolveName(p as Stop, this.tiers());
    if (local?.name) return local.name;
    if (!this.geocoder) return null;
    const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), waitMs));
    return (await Promise.race([this.geocoder.lookup(p.lat, p.lon), timeout])) ?? null;
  }

  /** Address search for pickers. null = no geocoder (GEOCODE_DISABLED). */
  searchAddress(q: string): Promise<{ name: string; lat: number; lon: number }[]> | null {
    return this.geocoder ? this.geocoder.search(q) : null;
  }

  /** Name one stop now, and queue the geocoder if nothing local matched. */
  nameStop(id: number): Stop | null {
    const s = this.stops.get(id);
    if (!s) return null;
    this.rename([s]);
    void this.geocodePass();
    return this.stops.get(id);
  }

  /** Name unnamed stops from OSM, one request a second, a few at a time. */
  geocodePass(max = 20): Promise<number> {
    if (!this.geocoder) return Promise.resolve(0);
    // One pass at a time; a second call waits for it and then runs (new stops may have arrived).
    const prev = this.geocoding ?? Promise.resolve(0);
    const run = prev.then(() => this.geocodeOnce(max));
    this.geocoding = run.finally(() => { if (this.geocoding === run) this.geocoding = null; });
    return run;
  }

  private async geocodeOnce(max: number): Promise<number> {
    const geo = this.geocoder!;
    let named = 0;
    try {
      for (const s of this.stops.needingGeocode(max)) {
        const name = await geo.lookup(s.lat, s.lon);
        if (name === undefined) break; // offline: try again later
        const cur = this.stops.get(s.id);
        if (!cur || cur.nameSource !== null) continue; // named meanwhile
        if (name) { this.stops.setName(s.id, { name, source: 'geocode', placeId: null }); named++; }
        this.stops.markGeocodeTried(s.id);
      }
    } catch (e) { console.error('[stops] geocode', e); }
    if (named) this.emit('renamed');
    return named;
  }

  async refreshZones(): Promise<void> {
    if (!this.ha.configured()) { if (this.zones.length) { this.zones = []; this.rename(this.stops.notFromPlaces()); } return; }
    try {
      const z = zonesFrom(await this.ha.states());
      const changed = JSON.stringify(z) !== JSON.stringify(this.zones);
      this.zones = z;
      if (changed) this.rename(this.stops.notFromPlaces());
    } catch { /* HA away: keep the last zones */ }
  }

  async refreshFeed(): Promise<void> {
    const st = this.getSettings();
    const url = st.placesFeed.url;
    if (!url) { this.feedError = null; if (this.feed.length) { this.feed = []; this.rename(this.stops.notFromPlaces()); } return; }
    const headers: Record<string, string> = { accept: 'application/json' };
    if (st.keys.placesFeed) headers.authorization = `Basic ${Buffer.from(st.keys.placesFeed).toString('base64')}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    try {
      const res = await this.fetchFn(url, { headers, signal: ctl.signal });
      if (!res.ok) { this.feedError = `places feed answered ${res.status}`; return; }
      const f = parseFeed(await res.json());
      this.feedError = null;
      const changed = JSON.stringify(f) !== JSON.stringify(this.feed);
      this.feed = f;
      if (changed) this.rename(this.stops.notFromPlaces());
    } catch (e) {
      this.feedError = `places feed not reachable (${(e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message})`;
    } finally { clearTimeout(timer); }
  }

  // ---- places ----------------------------------------------------------------

  private checkPlace(b: Record<string, unknown>, partial: boolean) {
    const out: { name?: string; lat?: number; lon?: number; radiusM?: number; kind?: string | null; chargeKw?: number | null; note?: string | null } = {};
    if (b.name !== undefined || !partial) {
      if (typeof b.name !== 'string' || !b.name.trim()) throw new PlaceInputError('name is required');
      out.name = b.name.trim().slice(0, 80);
    }
    if (b.radiusM !== undefined && b.radiusM !== null) {
      const r = Number(b.radiusM);
      if (!Number.isFinite(r) || r < 20 || r > 2000) throw new PlaceInputError('radiusM must be 20 to 2000');
      out.radiusM = r;
    }
    if (b.kind !== undefined) {
      if (b.kind !== null && !PLACE_KINDS.includes(b.kind as string)) throw new PlaceInputError(`kind is one of ${PLACE_KINDS.join(', ')}, or null`);
      out.kind = (b.kind as string | null) ?? null;
    }
    if (b.chargeKw !== undefined) {
      if (b.chargeKw === null || b.chargeKw === '' || b.chargeKw === 0) out.chargeKw = null;
      else { const k = Number(b.chargeKw); if (!Number.isFinite(k) || k < 0.5 || k > 350) throw new PlaceInputError('chargeKw is 0.5 to 350 (kW), or empty for none'); out.chargeKw = k; }
    }
    if (b.note !== undefined) out.note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 300) : null;
    if (!partial) {
      const lat = Number(b.lat), lon = Number(b.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new PlaceInputError('lat and lon are required');
      out.lat = lat; out.lon = lon;
    }
    return out;
  }

  placesWithVisits(driver?: string | null): Place[] { return this.places.withVisits(driver); }

  createPlace(body: unknown, createdBy: string | null): { place: Place; renamed: number } {
    if (!body || typeof body !== 'object') throw new PlaceInputError('body must be a JSON object');
    const p = this.checkPlace(body as Record<string, unknown>, false);
    const row = this.places.create({ name: p.name!, lat: p.lat!, lon: p.lon!, radiusM: p.radiusM ?? DEFAULT_RADIUS_M, createdBy });
    if (p.kind !== undefined || p.chargeKw !== undefined || p.note !== undefined) this.places.update(row.id, { kind: p.kind, chargeKw: p.chargeKw, note: p.note });
    const renamed = this.renameNear(row.lat, row.lon, row.radius_m);
    return { place: this.placesWithVisits().find((x) => x.id === row.id)!, renamed };
  }

  /** Tap-to-name: a saved place at the stop, and every stop inside it renamed. */
  nameFromStop(stopId: number, body: unknown, createdBy: string | null): { place: Place; renamed: number } | null {
    const s = this.stops.get(stopId);
    if (!s) return null;
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return this.createPlace({ ...b, lat: s.lat, lon: s.lon }, createdBy);
  }

  updatePlace(id: number, body: unknown): Place | null {
    if (!this.places.get(id)) return null;
    const p = this.checkPlace((body && typeof body === 'object' ? body : {}) as Record<string, unknown>, true);
    const row = this.places.update(id, p)!;
    this.rename([...this.stops.withPlace(id)]);
    this.renameNear(row.lat, row.lon, row.radius_m);
    return this.placesWithVisits().find((x) => x.id === id) ?? null;
  }

  deletePlace(id: number): boolean {
    const affected = this.stops.withPlace(id);
    const ok = this.places.delete(id);
    if (ok) this.rename(affected);
    return ok;
  }

  private renameNear(lat: number, lon: number, radiusM: number): number {
    const near = this.stops.all().filter((s) => metersBetween(s, { lat, lon }) <= radiusM + DEFAULT_RADIUS_M);
    return this.rename(near);
  }

  /** Spots visited SUGGEST_MIN_VISITS+ times that only OSM (or nothing) has a name for. */
  suggestions(driver?: string | null): PlaceSuggestion[] {
    const cand = this.stops.all().filter((s) => (s.nameSource === null || s.nameSource === 'geocode') && (!driver || s.driverId === driver));
    const clusters: { lat: number; lon: number; stops: Stop[] }[] = [];
    for (const s of cand) {
      const c = clusters.find((k) => metersBetween(k, s) <= DEFAULT_RADIUS_M);
      if (c) { c.stops.push(s); c.lat = c.stops.reduce((a, x) => a + x.lat, 0) / c.stops.length; c.lon = c.stops.reduce((a, x) => a + x.lon, 0) / c.stops.length; }
      else clusters.push({ lat: s.lat, lon: s.lon, stops: [s] });
    }
    return clusters.filter((c) => c.stops.length >= SUGGEST_MIN_VISITS).sort((a, b) => b.stops.length - a.stops.length).map((c) => {
      const names = new Map<string, number>();
      for (const s of c.stops) if (s.name) names.set(s.name, (names.get(s.name) ?? 0) + 1);
      const best = [...names.entries()].sort((a, b) => b[1] - a[1])[0];
      return { lat: Math.round(c.lat * 1e6) / 1e6, lon: Math.round(c.lon * 1e6) / 1e6, visits: c.stops.length, suggestedName: best?.[0] ?? null, stopIds: c.stops.map((s) => s.id) };
    });
  }
}
