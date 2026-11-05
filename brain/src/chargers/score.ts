// Pure charger scoring. 0-100, with the reasons shown in the UI.
import type { Charger, ChargingPrefs, Settings } from '../types.ts';
import { socForMiles } from '../soc.ts';

/** A station before scoring. `level2Only` lets us know a kW ceiling without guessing a number. */
export type Station = Omit<Charger, 'score' | 'reasons' | 'distanceMi'> & { level2Only?: boolean; distanceMi?: number };

/** The truck's DC peak (~120 kW); faster stalls earn nothing extra. */
export const TRUCK_PEAK_KW = 120;
const L2_CEILING_KW = 19.2;

export type ScoreContext = {
  distanceMi: number;
  soc: number | null;
  settings: Pick<Settings, 'packKwh' | 'efficiencyMiPerKwh'> & { charging: ChargingPrefs };
  /** Clock for the availability age; tests pass one. */
  now?: number;
};

/** A live count older than this is shown with its age and not scored. */
export const AVAILABILITY_STALE_MS = 30 * 60_000;

const ago = (ms: number) => (ms < 90_000 ? 'just now' : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`);
const money = (n: number) => `$${n.toFixed(2)}`;
const shortDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Tesla" matches "Tesla Destination" and "TESLA"; "EA" style abbreviations are not guessed. */
export function networkMatches(network: string | null, wanted: string): boolean {
  if (!network) return false;
  const n = norm(network), w = norm(wanted);
  return w.length > 0 && (n === w || n.startsWith(w) || n.includes(w));
}

export function scoreCharger(st: Station, ctx: ScoreContext): Charger {
  const prefs = ctx.settings.charging;
  const reasons: string[] = [];
  let score = 50;

  // Network preference: earlier in the list counts more.
  const prefIdx = prefs.networks.findIndex((n) => networkMatches(st.network, n));
  if (prefs.avoidNetworks.some((n) => networkMatches(st.network, n))) {
    score -= 40; reasons.push(`${st.network}: on your avoid list`);
  } else if (prefIdx >= 0) {
    const bonus = Math.max(6, 20 - prefIdx * 4);
    score += bonus; reasons.push(`${st.network}: preferred network #${prefIdx + 1}`);
  }

  // Power, capped at what the truck can take.
  const kwCeiling = st.maxKw ?? (st.level2Only ? L2_CEILING_KW : null);
  if (kwCeiling === null) {
    score -= 5; reasons.push('Power unknown');
  } else if (kwCeiling < prefs.minKw) {
    score -= 25; reasons.push(st.maxKw === null ? `Level 2 only, below your ${prefs.minKw} kW minimum` : `${Math.round(kwCeiling)} kW, below your ${prefs.minKw} kW minimum`);
  } else {
    score += (Math.min(kwCeiling, TRUCK_PEAK_KW) / TRUCK_PEAK_KW) * 15;
    reasons.push(kwCeiling > TRUCK_PEAK_KW ? `${Math.round(kwCeiling)} kW (truck takes ~${TRUCK_PEAK_KW})` : `${Math.round(kwCeiling)} kW`);
  }

  // Connector.
  if (prefs.connector !== 'any') {
    if (st.connectors.includes(prefs.connector)) { score += 10; reasons.push(`Has ${prefs.connector}`); }
    else if (st.connectors.length === 0) { score -= 5; reasons.push('Connectors unknown'); }
    else { score -= 20; reasons.push(`No ${prefs.connector} plug (${st.connectors.join(', ')}), needs an adapter`); }
  }

  // Distance as the detour proxy (straight line until routing exists).
  const d = ctx.distanceMi;
  if (d > prefs.maxDetourMi) {
    score -= 20; reasons.push(`${d.toFixed(1)} mi away, past your ${prefs.maxDetourMi} mi limit`);
  } else {
    score += (1 - d / prefs.maxDetourMi) * 15;
    reasons.push(`${d.toFixed(1)} mi away`);
  }

  // Reachable with the minimum arrival charge?
  if (ctx.soc === null) {
    reasons.push('Charge level unknown, reach not checked');
  } else {
    const arrive = ctx.soc - socForMiles(d, ctx.settings.efficiencyMiPerKwh, ctx.settings.packKwh);
    if (arrive < prefs.arriveMinSoc) {
      score -= 50; reasons.push(`Arrive ~${Math.max(0, Math.round(arrive))}%, below your ${prefs.arriveMinSoc}%`);
    } else reasons.push(`Arrive ~${Math.round(arrive)}%`);
  }

  // Amenities.
  const have = prefs.wantAmenities.filter((a) => st.amenities.includes(a));
  if (have.length) { score += have.length * 4; reasons.push(`Has ${have.join(', ')}`); }

  // Live stalls (Google Places). A stale count is reported, not scored.
  const av = st.availability;
  if (av && av.total > 0) {
    const age = av.updatedAt ? (ctx.now ?? Date.now()) - Date.parse(av.updatedAt) : null;
    const fresh = age === null || !Number.isFinite(age) || age <= AVAILABILITY_STALE_MS;
    const when = age !== null && Number.isFinite(age) ? `, ${ago(Math.max(0, age))}` : '';
    if (av.available === 0) {
      if (fresh) score -= 15;
      reasons.push(`All ${av.total} stalls busy${when}`);
    } else {
      if (fresh) score += 5;
      reasons.push(`${av.available} of ${av.total} stalls free${when}`);
    }
    if (av.outOfService > 0) reasons.push(`${av.outOfService} out of service`);
  }

  if (st.price) reasons.push(`Price: ${st.price}`);
  // What the charge log says was actually paid here: the number to trust.
  const lp = st.lastPaid;
  if (lp) reasons.push(`You paid ${lp.perKwh !== null ? `${money(lp.perKwh)}/kWh` : money(lp.cost)} here (${shortDate(lp.at)}${lp.sessions > 1 ? `, ${lp.sessions} visits` : ''})`);

  const { level2Only: _l2, ...rest } = st;
  return { ...rest, distanceMi: Math.round(d * 10) / 10, score: Math.round(Math.max(0, Math.min(100, score))), reasons };
}

/** Score and sort, best first; ties go to the nearer one. */
export function rankChargers(stations: Station[], at: { lat: number; lon: number }, soc: number | null, settings: ScoreContext['settings'], distance: (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => number, now?: number): Charger[] {
  return stations
    .map((s) => scoreCharger(s, { distanceMi: distance(at, s), soc, settings, now }))
    .sort((a, b) => b.score - a.score || a.distanceMi - b.distanceMi);
}
