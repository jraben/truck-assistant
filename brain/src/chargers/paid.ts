// What you actually paid at a charger: the charge log (receipts confirmed on
// /settings, manual entries, detected sessions given a cost) joined to the
// stations the finder shows. The real number, beside the feeds' price text.
import { metersBetween } from '../geo.ts';
import type { ChargeSession, LastPaid } from '../types.ts';
import type { Station } from './score.ts';

/** A logged session with coordinates this close to a station was at it. */
export const PAID_NEAR_M = 200;

export type PaidSession = Pick<ChargeSession, 'id' | 'startedAt' | 'network' | 'stationName' | 'lat' | 'lon' | 'kwh' | 'cost'>;

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Is this session at this station? By position when the session has one;
 * otherwise (a receipt-only session has an address, not coordinates) by name:
 * one normalised name containing the other, at least 6 characters, and the
 * networks agreeing when both are known. A loose name match is the risk here,
 * so the length floor and the network check are deliberately strict.
 */
export function sessionAt(st: Station, s: PaidSession): boolean {
  if (s.lat !== null && s.lon !== null) return metersBetween(st, { lat: s.lat, lon: s.lon }) <= PAID_NEAR_M;
  const a = norm(st.name), b = norm(s.stationName);
  if (a.length < 6 || b.length < 6 || !(a.includes(b) || b.includes(a))) return false;
  if (st.network && s.network) {
    const n1 = norm(st.network), n2 = norm(s.network);
    if (!(n1.includes(n2) || n2.includes(n1))) return false;
  }
  return true;
}

/** Sessions must be newest first. Only sessions with a cost above zero count. */
export function lastPaidAt(st: Station, sessions: PaidSession[]): LastPaid | null {
  const here = sessions.filter((s) => s.cost !== null && s.cost > 0 && sessionAt(st, s));
  if (!here.length) return null;
  const s = here[0];
  const perKwh = s.kwh && s.kwh > 0 ? Math.round(((s.cost as number) / s.kwh) * 1000) / 1000 : null;
  return { sessionId: s.id, at: s.startedAt, cost: s.cost as number, kwh: s.kwh, perKwh, sessions: here.length };
}

export function withLastPaid(stations: Station[], sessions: PaidSession[]): Station[] {
  if (!sessions.length) return stations;
  return stations.map((st) => {
    const lp = lastPaidAt(st, sessions);
    return lp ? { ...st, lastPaid: lp } : st;
  });
}
