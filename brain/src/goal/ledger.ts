// "Pay off the truck with gas savings": the pure half. One ledger row per
// local day, computed only from that day's own trips, charge sessions and gas
// price; the summary and the payoff projection are sums over those rows.
// No Node APIs, no clock reads: every "now" comes in as an argument.
import type { CompareVehicle, FuelGrade, GoalAdjustment, GoalDay, GoalMonth, GoalSummary, PayoffGoal } from '../types.ts';
import { round2 } from '../charges/pricing.ts';

/** Days per month for "per month" figures (365.25 / 12). */
export const DAYS_PER_MONTH = 30.44;
/** The average looks back this far. */
export const AVG_WINDOW_DAYS = 90;
/** No projected payoff date before this many days of driving data. */
export const MIN_PROJECTION_DAYS = 30;

/** "2027-05-14" in local time. */
export const localDay = (d: Date | string): string => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const parseDay = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };

/** day + n days, local calendar (DST-safe). */
export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Whole days from a to b (b - a), local calendar. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86_400_000);
}
const ymd = (day: string): [number, number, number] => { const [y, m, d] = day.split('-').map(Number); return [y, m - 1, d]; };

/** [start, end) ISO instants of one local day. */
export function dayRange(day: string): [string, string] {
  const d = parseDay(day);
  return [d.toISOString(), new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString()];
}

export const monthOf = (day: string) => day.slice(0, 7);
export const monthStart = (month: string) => `${month}-01`;
/** The last day of "2027-05". */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return localDay(new Date(y, m, 0));
}
/** "2027-05" -> "2027-06". */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export type LedgerTrip = { startedAt: string; miles: number; cityMiles: number | null; highwayMiles: number | null };
/** possibleDemand: USD this session may add as an on-peak demand charge (charges/peak.ts sessionDemand), null if none / unknown. */
export type LedgerSession = { startedAt: string; place: 'home' | 'public' | 'other'; cost: number | null; possibleDemand?: number | null };
export type GasRow = { day: string; fuel: string; price: number };
export type DayPrice = { price: number; source: GoalDay['priceSource'] };

/**
 * A trip's miles as city / highway / unsplit. A split that overshoots the
 * total is scaled down to it; what the split doesn't cover is "other" and is
 * burned at combined mpg (the same rule as the Charge view's gas comparison).
 */
export function tripSplit(t: LedgerTrip): { city: number; highway: number; other: number } {
  const miles = Math.max(0, t.miles);
  if (t.cityMiles == null && t.highwayMiles == null) return { city: 0, highway: 0, other: miles };
  const city = Math.max(0, t.cityMiles ?? 0), hwy = Math.max(0, t.highwayMiles ?? 0);
  const split = city + hwy;
  const scale = split > miles && split > 0 ? miles / split : 1;
  return { city: city * scale, highway: hwy * scale, other: Math.max(0, miles - split * scale) };
}

/**
 * The gas price for a day: that day's stored price for the grade, else the
 * nearest stored day of that grade (earlier wins a tie), else the manual price.
 * A manual gas source always uses the manual price.
 */
export function priceForGoalDay(day: string, fuel: FuelGrade, rows: GasRow[], gas: { source: 'manual' | 'ha'; manualPrice: number }): DayPrice {
  if (gas.source === 'manual') return { price: gas.manualPrice, source: 'manual' };
  const same = rows.filter((r) => r.fuel === fuel);
  const exact = same.find((r) => r.day === day);
  if (exact) return { price: exact.price, source: 'day' };
  if (!same.length) return { price: gas.manualPrice, source: 'manual' };
  let best = same[0], bestD = Infinity;
  for (const r of same) {
    const d = Math.abs(daysBetween(r.day, day));
    if (d < bestD || (d === bestD && r.day < best.day)) { best = r; bestD = d; }
  }
  return { price: best.price, source: 'nearest' };
}

/**
 * One day of the ledger from that day's own data. `trips` and `sessions` must
 * already be the day's real ones (no phone trips, nothing simulated).
 */
export function computeDay(day: string, trips: LedgerTrip[], sessions: LedgerSession[], vehicle: CompareVehicle, price: DayPrice, includeHome: boolean, computedAt: string): GoalDay {
  let city = 0, hwy = 0, other = 0, miles = 0, n = 0;
  for (const t of trips) {
    if (!(t.miles > 0)) continue;
    const s = tripSplit(t);
    city += s.city; hwy += s.highway; other += s.other; miles += Math.max(0, t.miles); n++;
  }
  const gallons = city / vehicle.mpgCity + hwy / vehicle.mpgHighway + other / vehicle.mpgCombined;
  let charge = 0, unknown = 0, homeOut = 0, demand: number | null = null;
  for (const s of sessions) {
    // Demand is billed on the month's single highest on-peak hour, so a day carries its largest, never a sum, and it is never subtracted.
    if (s.possibleDemand != null && s.possibleDemand > 0) demand = Math.max(demand ?? 0, s.possibleDemand);
    if (s.cost === null) { unknown++; continue; }
    if (s.place === 'home' && !includeHome) { homeOut += s.cost; continue; }
    charge += s.cost;
  }
  const gasCost = round2(gallons * price.price), chargeCost = round2(charge);
  return {
    day, trips: n,
    miles: round2(miles), cityMiles: round2(city), highwayMiles: round2(hwy), otherMiles: round2(other),
    gallons: Math.round(gallons * 1000) / 1000,
    gasPrice: price.price, priceSource: price.source,
    vehicle: { ...vehicle },
    gasCost, chargeSessions: sessions.length, chargeCost, chargeCostUnknown: unknown, homeChargeExcluded: round2(homeOut),
    net: round2(gasCost - chargeCost),
    possibleDemandCharge: demand === null ? null : round2(demand),
    frozen: false, computedAt,
  };
}

/** A day with nothing to record is not stored. */
export const isEmptyDay = (d: GoalDay) => d.trips === 0 && d.chargeSessions === 0;

export type Projection = GoalSummary['projection'];

/**
 * When the target is reached at the recent rate. `saved` includes the
 * adjustments; `windowNet` / `windowDays` is the recent ledger rate.
 */
export function projectPayoff(o: { target: number; saved: number; daysOfData: number; windowNet: number; windowDays: number; today: string; paidOffOn: string | null }): Projection {
  if (o.daysOfData <= 0) return { state: 'no-data', date: null };
  if (o.saved >= o.target) return { state: 'paid-off', date: o.paidOffOn };
  if (o.daysOfData < MIN_PROJECTION_DAYS) return { state: 'not-enough-data', date: null };
  const perDay = o.windowDays > 0 ? o.windowNet / o.windowDays : 0;
  if (!(perDay > 0)) return { state: 'not-saving', date: null };
  return { state: 'projected', date: addDays(o.today, Math.ceil((o.target - o.saved) / perDay)) };
}

export type SummaryInput = {
  goal: PayoffGoal;
  start: { day: string; source: 'setting' | 'first-trip' } | null;
  today: string;
  days: GoalDay[];
  adjustments: GoalAdjustment[];
  vehicle: CompareVehicle;
  excluded: GoalSummary['excluded'];
  computedAt: string | null;
};

/** The goal card's numbers. Ledger days before the start date (or after today) never count; every adjustment does. */
export function summarizeGoal(i: SummaryInput): GoalSummary {
  const start = i.start?.day ?? null;
  const days = start ? i.days.filter((d) => d.day >= start && d.day <= i.today).sort((a, b) => a.day.localeCompare(b.day)) : [];
  const sum = (xs: GoalDay[], k: 'net' | 'gasCost' | 'chargeCost' | 'miles') => round2(xs.reduce((a, d) => a + d[k], 0));
  const ledgerSaved = sum(days, 'net');
  const adjustmentsTotal = round2(i.adjustments.reduce((a, x) => a + x.amount, 0));
  const saved = round2(ledgerSaved + adjustmentsTotal);
  const daysOfData = start && start <= i.today ? daysBetween(start, i.today) + 1 : 0;
  const windowDays = Math.min(AVG_WINDOW_DAYS, daysOfData);
  const windowFrom = windowDays ? addDays(i.today, -(windowDays - 1)) : i.today;
  const windowNet = days.filter((d) => d.day >= windowFrom).reduce((a, d) => a + d.net, 0);

  // The day the running total (adjustments on their own day, or the start day if earlier) first reached the target.
  let paidOffOn: string | null = null;
  if (start && saved >= i.goal.target) {
    const s0 = start;
    const events = [...days.map((d) => ({ day: d.day, v: d.net })), ...i.adjustments.map((a) => ({ day: a.day < s0 ? s0 : a.day, v: a.amount }))]
      .sort((a, b) => a.day.localeCompare(b.day));
    let run = 0;
    for (const e of events) { run += e.v; if (run >= i.goal.target - 0.005) { paidOffOn = e.day; break; } }
  }

  const byMonth = new Map<string, GoalMonth>();
  for (const d of days) {
    const k = monthOf(d.day);
    const m = byMonth.get(k) ?? { month: k, net: 0, gasCost: 0, chargeCost: 0, miles: 0, days: 0, possibleDemandCharge: null };
    if (d.possibleDemandCharge != null) m.possibleDemandCharge = Math.max(m.possibleDemandCharge ?? 0, d.possibleDemandCharge);
    m.net += d.net; m.gasCost += d.gasCost; m.chargeCost += d.chargeCost; m.miles += d.miles; m.days++;
    byMonth.set(k, m);
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, net: round2(m.net), gasCost: round2(m.gasCost), chargeCost: round2(m.chargeCost), miles: round2(m.miles) }));

  let message: string | null = null;
  if (!i.start) {
    const ex = i.excluded;
    const why = [ex.simulatedTrips ? `${ex.simulatedTrips} simulated trip${ex.simulatedTrips === 1 ? '' : 's'} (SIM=1)` : '', ex.phoneTrips ? `${ex.phoneTrips} phone trip${ex.phoneTrips === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
    message = `No real truck trips yet${why ? `: ${why} aren't counted` : ''}. Set the delivery date on the settings page, or it starts with the first real drive.`;
  } else if (start && start > i.today) message = `Counting starts ${start}.`;

  return {
    target: i.goal.target,
    startDate: start, startSource: i.start?.source ?? null,
    includeHomeCharging: i.goal.includeHomeCharging,
    saved, ledgerSaved, adjustmentsTotal,
    pct: i.goal.target > 0 ? Math.round((saved / i.goal.target) * 1000) / 10 : 0,
    remaining: round2(Math.max(0, i.goal.target - saved)),
    miles: sum(days, 'miles'), gasCost: sum(days, 'gasCost'), chargeCost: sum(days, 'chargeCost'),
    thisMonth: round2(days.filter((d) => monthOf(d.day) === monthOf(i.today)).reduce((a, d) => a + d.net, 0)),
    avgPerMonth: windowDays ? round2((windowNet / windowDays) * DAYS_PER_MONTH) : null,
    daysOfData,
    projection: projectPayoff({ target: i.goal.target, saved, daysOfData, windowNet, windowDays, today: i.today, paidOffOn }),
    months,
    vehicle: i.vehicle.label,
    excluded: i.excluded,
    message,
    computedAt: i.computedAt,
  };
}

/** "Truck payoff: $1,234 of $30,741 (4.0%)", for WOPR's truck block. */
export function goalLine(s: Pick<GoalSummary, 'saved' | 'target' | 'pct'>): string {
  const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
  return `Truck payoff: ${usd(s.saved)} of ${usd(s.target)} (${s.pct.toFixed(1)}%)`;
}

const CSV_COLS = ['day', 'trips', 'miles', 'city_miles', 'highway_miles', 'other_miles', 'vehicle', 'fuel', 'mpg_city', 'mpg_highway', 'mpg_combined',
  'gas_price', 'price_source', 'gallons', 'gas_cost', 'charge_sessions', 'charge_cost', 'charge_cost_unknown', 'home_charge_excluded', 'net', 'possible_demand_charge', 'frozen', 'computed_at'];

export function ledgerCsv(days: GoalDay[]): string {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = days.map((d) => [d.day, d.trips, d.miles, d.cityMiles, d.highwayMiles, d.otherMiles, d.vehicle.label, d.vehicle.fuel, d.vehicle.mpgCity, d.vehicle.mpgHighway, d.vehicle.mpgCombined,
    d.gasPrice, d.priceSource, d.gallons, d.gasCost, d.chargeSessions, d.chargeCost, d.chargeCostUnknown, d.homeChargeExcluded, d.net, d.possibleDemandCharge, d.frozen ? 1 : 0, d.computedAt].map(esc).join(','));
  return [CSV_COLS.join(','), ...rows].join('\r\n') + '\r\n';
}
