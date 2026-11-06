// Charge sessions: manual entry, detection from a parked SoC rise, home pricing.
import { metersBetween } from '../geo.ts';
import type { ChargeSession, Settings } from '../types.ts';
import type { SocChange } from '../soc.ts';
import type { Station } from '../chargers/score.ts';
import { ChargeInputError, ChargeStore, type NewSession, type SessionInput } from './store.ts';
import { kwhFromSoc, priceHomeSession } from './pricing.ts';
import { periodKey } from './summary.ts';

export const HOME_RADIUS_M = 150;
/** A rise of at least this many points, parked, opens a session. */
export const MIN_RISE = 2;
/** A second rise this soon, at the same place, extends the open draft instead. */
const EXTEND_MS = 6 * 3600_000;
const MAX_LOOKBACK_MS = 24 * 3600_000;

export type ChargeContext = {
  settings: Settings;
  parked: boolean;
  gps: { lat: number; lon: number } | null;
  /** Latest value of Settings.homeAssistant.homeChargerEnergyEntity, if one has arrived. */
  homeChargerKwh: number | null;
  nearestStation: (lat: number, lon: number) => Station | null;
  driverId: string | null;
};

export const isHome = (s: Settings, gps: { lat: number; lon: number } | null) =>
  !!(s.homeLocation && gps && metersBetween(s.homeLocation, gps) <= HOME_RADIUS_M);

export class ChargeService {
  private listeners: (() => void)[] = [];

  store: ChargeStore;

  constructor(store: ChargeStore) { this.store = store; }

  onChange(l: () => void) { this.listeners.push(l); }
  private changed() { for (const l of this.listeners) { try { l(); } catch (e) { console.error('[charges] listener', e); } } }

  /**
   * Called on every manual or CAN SoC anchor. A rise while parked opens (or
   * extends) a 'detected' session at the current location. Home sessions are
   * priced at once; elsewhere the UI asks what it cost.
   */
  onSocAnchor(c: SocChange, ctx: ChargeContext): ChargeSession | null {
    if (c.source !== 'manual' && c.source !== 'can') return null;
    if (c.prev === null || c.next - c.prev < MIN_RISE || !ctx.parked) return null;
    const now = new Date(c.at);
    const home = isHome(ctx.settings, ctx.gps);

    const last = this.store.latest();
    const lastEnd = last ? Date.parse(last.endedAt ?? last.startedAt) : 0;
    const samePlace = !!last && (last.lat === null || last.lon === null || !ctx.gps
      ? last.lat === null && !ctx.gps
      : metersBetween({ lat: last.lat, lon: last.lon }, ctx.gps) <= HOME_RADIUS_M);
    if (last && last.source === 'detected' && now.getTime() - lastEnd < EXTEND_MS && samePlace && last.endSoc !== null && Math.abs(last.endSoc - c.prev) < MIN_RISE) {
      const patch: SessionInput = { endSoc: c.next, endedAt: now.toISOString() };
      if (last.place === 'home') Object.assign(patch, this.homePrice(last.startSoc, c.next, new Date(last.startedAt), ctx));
      const s = this.store.update(last.id, patch);
      this.changed();
      return s;
    }

    const prevAt = c.prevAt ? Date.parse(c.prevAt) : NaN;
    const startedAt = new Date(Number.isFinite(prevAt) && now.getTime() - prevAt < MAX_LOOKBACK_MS ? prevAt : now.getTime());
    const st = !home && ctx.gps ? ctx.nearestStation(ctx.gps.lat, ctx.gps.lon) : null;
    const session: NewSession = {
      startedAt: startedAt.toISOString(), endedAt: now.toISOString(),
      place: home ? 'home' : st ? 'public' : 'other',
      network: st?.network ?? null, stationName: st?.name ?? null,
      lat: ctx.gps?.lat ?? null, lon: ctx.gps?.lon ?? null,
      kwh: null, cost: null, costSource: null,
      startSoc: c.prev, endSoc: c.next, maxKw: st?.maxKw ?? null, note: null,
      source: 'detected', driverId: ctx.driverId,
    };
    if (home) Object.assign(session, this.homePrice(c.prev, c.next, startedAt, ctx));
    const s = this.store.create(session);
    this.changed();
    return s;
  }

  private homePrice(startSoc: number | null, endSoc: number | null, startedAt: Date, ctx: ChargeContext): Pick<ChargeSession, 'kwh' | 'cost' | 'costSource'> {
    const kwh = ctx.homeChargerKwh ?? kwhFromSoc(startSoc, endSoc, ctx.settings.packKwh);
    const cost = priceHomeSession(kwh, startedAt, ctx.settings.homeRate);
    return { kwh, cost, costSource: cost === null ? null : 'home-rate' };
  }

  /** POST /api/charges: a hand-entered session. Home sessions without a cost are priced from the rate. */
  createManual(input: SessionInput, settings: Settings, gps: { lat: number; lon: number } | null, driverId: string | null = null): ChargeSession {
    const startedAt = input.startedAt ?? new Date().toISOString();
    const place = input.place ?? (isHome(settings, input.lat != null && input.lon != null ? { lat: input.lat, lon: input.lon! } : gps) ? 'home' : 'public');
    let cost = input.cost ?? null;
    let costSource = input.costSource ?? (cost === null ? null : cost === 0 ? 'free' : 'receipt');
    let kwh = input.kwh ?? null;
    if (place === 'home' && kwh === null) kwh = kwhFromSoc(input.startSoc ?? null, input.endSoc ?? null, settings.packKwh);
    if (place === 'home' && cost === null && costSource !== 'free') {
      cost = priceHomeSession(kwh, new Date(startedAt), settings.homeRate);
      costSource = cost === null ? null : 'home-rate';
    }
    if (costSource === 'free') cost = 0;
    const s = this.store.create({
      startedAt, endedAt: input.endedAt ?? null, place,
      network: input.network ?? null, stationName: input.stationName ?? null,
      lat: input.lat ?? (input.lat === undefined ? gps?.lat ?? null : null),
      lon: input.lon ?? (input.lon === undefined ? gps?.lon ?? null : null),
      kwh, cost, costSource,
      startSoc: input.startSoc ?? null, endSoc: input.endSoc ?? null, maxKw: input.maxKw ?? null,
      note: input.note ?? null, source: 'manual',
      driverId: input.driverId !== undefined ? input.driverId : driverId,
    });
    this.changed();
    return s;
  }

  /** PUT /api/charges/:id. Entering a cost marks it a receipt (or free at $0) unless told otherwise. */
  update(id: number, input: SessionInput): ChargeSession | null {
    if (!this.store.get(id)) return null;
    const patch = { ...input };
    delete patch.source; // how it was created doesn't change
    if (patch.cost !== undefined && patch.costSource === undefined) patch.costSource = patch.cost === null ? null : patch.cost === 0 ? 'free' : 'receipt';
    if (patch.costSource === 'free') patch.cost = 0;
    if (patch.startedAt === null) throw new ChargeInputError('startedAt cannot be empty');
    const s = this.store.update(id, patch);
    this.changed();
    return s;
  }

  delete(id: number): boolean {
    const ok = this.store.delete(id);
    if (ok) this.changed();
    return ok;
  }

  /** For HA: this month's spend and the last session's cost. */
  haSummary(now = new Date()) {
    const month = periodKey(now.toISOString(), 'month');
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthCost = this.store.list(start, null).filter((s) => periodKey(s.startedAt, 'month') === month)
      .reduce((a, s) => a + (s.cost ?? 0), 0);
    const last = this.store.latest();
    return { monthCost: Math.round(monthCost * 100) / 100, lastSessionCost: last?.cost ?? null, lastSessionAt: last?.startedAt ?? null, lastSessionPlace: last?.place ?? null };
  }
}
