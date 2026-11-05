// Business mileage log: trip purposes (by hand or auto-tagged), estimated
// odometer readings, and an IRS-style export (CSV + printable HTML).
//
// Auto-tagging, first match wins (a purpose set by hand always beats it):
//   1. the destination stop is a saved place tagged business/client/personal/commute
//   2. the destination stop was named from the places feed (client records) -> business
//   3. the driver's default purpose
//   4. untagged
// Odometer: until CAN gives the real one, readings are estimated from truck
// GPS miles counted forward and back from an anchor the owner enters
// (a reading off the dash and when it was read). Phone trips get no odometer.
import type { Db } from '../db.ts';
import type { TripStore } from '../trips.ts';
import type { Settings, Trip } from '../types.ts';
import type { EndStopInfo, MileageRow, MileageTotals, PurposeSource, Tag } from './types.ts';
export type { EndStopInfo, MileageRow, MileageTotals, PurposeSource, Tag } from './types.ts';
import { OpsInputError, PLACE_TAGS, PURPOSES, type MileageRate, type OpsConfig, type OpsStore, type PlaceTag, type Purpose } from './config.ts';



export type MileageFilter = { from?: string | null; to?: string | null; driver?: string | null; purpose?: Purpose | 'untagged' | null };

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day of an ISO time, "YYYY-MM-DD". */
export const localDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const placeTagPurpose = (t: PlaceTag): Purpose => (t === 'client' ? 'business' : t);

/** The purpose a trip gets, and why. Pure. */
export function autoPurpose(tag: Tag | null, end: EndStopInfo | null, driverId: string | null, cfg: OpsConfig['mileage']): { purpose: Purpose | null; source: PurposeSource | null } {
  if (tag?.purpose) return { purpose: tag.purpose, source: 'manual' };
  if (end?.placeId != null) {
    const t = cfg.placeTags[String(end.placeId)];
    if (t) return { purpose: placeTagPurpose(t), source: 'place' };
  }
  if (end?.nameSource === 'feed' && cfg.feedIsBusiness) return { purpose: 'business', source: 'feed' };
  const d = driverId ? cfg.driverDefaults[driverId] : undefined;
  if (d) return { purpose: d, source: 'driver' };
  return { purpose: null, source: null };
}

type OdoTrip = Pick<Trip, 'id' | 'startedAt' | 'miles' | 'source'>;

/**
 * Estimated odometer at each truck trip's start and end, counted forward
 * from the anchor for trips that started at or after it and backward for
 * trips before it. Phone trips are skipped. Pure.
 */
export function estimateOdometers(trips: OdoTrip[], anchor: OpsConfig['mileage']['odometerAnchor']): Map<number, { start: number; end: number }> {
  const out = new Map<number, { start: number; end: number }>();
  if (!anchor) return out;
  const at = Date.parse(anchor.at);
  const truck = trips.filter((t) => t.source === 'truck').sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id - b.id);
  let odo = anchor.odometer;
  for (const t of truck.filter((x) => Date.parse(x.startedAt) >= at)) { out.set(t.id, { start: round1(odo), end: round1(odo + t.miles) }); odo += t.miles; }
  odo = anchor.odometer;
  for (const t of truck.filter((x) => Date.parse(x.startedAt) < at).reverse()) { out.set(t.id, { start: round1(Math.max(0, odo - t.miles)), end: round1(odo) }); odo -= t.miles; }
  return out;
}

/** The odometer now: the anchor plus every truck mile since. null without an anchor. Pure. */
export function odometerNow(trips: OdoTrip[], anchor: OpsConfig['mileage']['odometerAnchor']): number | null {
  if (!anchor) return null;
  const at = Date.parse(anchor.at);
  return round1(anchor.odometer + trips.filter((t) => t.source === 'truck' && Date.parse(t.startedAt) >= at).reduce((a, t) => a + t.miles, 0));
}

/** The rate in effect on a local day: the latest one starting on or before it. Pure. */
export function rateFor(day: string, rates: MileageRate[]): MileageRate | null {
  let best: MileageRate | null = null;
  for (const r of rates) if (r.from <= day && (!best || r.from > best.from)) best = r;
  return best;
}

export type RowInput = { trip: Trip; tag: Tag | null; end: EndStopInfo | null };

/** Log rows and totals. Pure: the service hands in trips, tags, stop info and the full truck-trip list for odometers. */
export function buildRows(inputs: RowInput[], allTrips: OdoTrip[], cfg: OpsConfig['mileage'], driverName: (id: string | null) => string): { rows: MileageRow[]; totals: MileageTotals } {
  const odo = estimateOdometers(allTrips, cfg.odometerAnchor);
  const rows: MileageRow[] = inputs.map(({ trip: t, tag, end }) => {
    const p = autoPurpose(tag, end, t.driverId, cfg);
    const date = localDate(t.startedAt);
    const rate = p.purpose === 'business' ? rateFor(date, cfg.rates) : null;
    const o = odo.get(t.id);
    const miles = round2(t.miles);
    return {
      tripId: t.id, startedAt: t.startedAt, endedAt: t.endedAt, date,
      driverId: t.driverId, driver: driverName(t.driverId),
      purpose: p.purpose, purposeSource: p.source, note: tag?.note ?? null,
      from: t.from ? t.from.name ?? 'Unnamed stop' : '', to: t.to ? t.to.name ?? 'Unnamed stop' : '',
      startOdometer: o?.start ?? null, endOdometer: o?.end ?? null,
      miles, approximate: t.source === 'phone', source: t.source,
      rateCents: rate?.centsPerMile ?? null,
      deduction: rate ? round2((miles * rate.centsPerMile) / 100) : null,
    };
  });
  return { rows, totals: totalsOf(rows, cfg.rates) };
}

/** Totals for a set of rows. Pure. */
export function totalsOf(rows: MileageRow[], rates: MileageRate[]): MileageTotals {
  const byPurpose = { business: 0, personal: 0, commute: 0, other: 0, untagged: 0 } as MileageTotals['byPurpose'];
  const used = new Map<string, MileageRate>();
  for (const r of rows) {
    byPurpose[r.purpose ?? 'untagged'] = round2(byPurpose[r.purpose ?? 'untagged'] + r.miles);
    if (r.purpose === 'business') { const rate = rateFor(r.date, rates); if (rate) used.set(rate.from, rate); }
  }
  return {
    trips: rows.length,
    miles: round2(rows.reduce((a, r) => a + r.miles, 0)),
    byPurpose,
    businessMiles: byPurpose.business,
    deduction: round2(rows.reduce((a, r) => a + (r.deduction ?? 0), 0)),
    untaggedTrips: rows.filter((r) => !r.purpose).length,
    approximateMiles: round2(rows.filter((r) => r.approximate).reduce((a, r) => a + r.miles, 0)),
    ratesUsed: [...used.values()].sort((a, b) => a.from.localeCompare(b.from)),
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_HEADER = ['Date', 'Driver', 'Purpose', 'Business purpose / note', 'From', 'To', 'Start odometer (est.)', 'End odometer (est.)', 'Miles', 'Approximate', 'Rate (cents/mi)', 'Deduction (USD)'];

export function toCsv(rows: MileageRow[], totals: MileageTotals): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push([r.date, r.driver, r.purpose ?? '', r.note ?? '', r.from, r.to, r.startOdometer ?? '', r.endOdometer ?? '', r.miles.toFixed(2), r.approximate ? 'yes (phone)' : '', r.rateCents ?? '', r.deduction?.toFixed(2) ?? ''].map(csvCell).join(','));
  }
  lines.push('');
  lines.push(['Total miles', '', '', '', '', '', '', '', totals.miles.toFixed(2)].map(csvCell).join(','));
  lines.push(['Business miles', '', '', '', '', '', '', '', totals.businessMiles.toFixed(2), '', '', totals.deduction.toFixed(2)].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A printable page: one table, totals, and what the numbers are based on. */
export function toHtml(rows: MileageRow[], totals: MileageTotals, meta: { title: string; period: string; truck: string; anchor: OpsConfig['mileage']['odometerAnchor']; generated: string }): string {
  const tr = rows.map((r) => `<tr${r.purpose === 'business' ? ' class="biz"' : ''}><td>${esc(r.date)}</td><td>${esc(r.driver)}</td><td>${esc(r.purpose ?? '—')}</td><td>${esc(r.note ?? '')}</td><td>${esc(r.from)}</td><td>${esc(r.to)}</td><td class="n">${r.startOdometer ?? '—'}</td><td class="n">${r.endOdometer ?? '—'}</td><td class="n">${r.miles.toFixed(1)}${r.approximate ? ' *' : ''}</td><td class="n">${r.deduction !== null ? `$${r.deduction.toFixed(2)}` : ''}</td></tr>`).join('\n');
  const rates = totals.ratesUsed.map((r) => `${r.centsPerMile}¢/mi from ${esc(r.from)} (${esc(r.source)})`).join('; ') || 'no business trips in this period';
  const anchor = meta.anchor ? `Odometer readings are estimates: GPS miles counted from a reading of ${meta.anchor.odometer} on ${esc(localDate(meta.anchor.at))}, until the truck's own odometer is readable (CAN).` : 'No odometer reading entered yet, so odometer columns are blank (set one on the Mileage settings).';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(meta.title)}</title>
<style>
body{font:13px/1.4 system-ui,sans-serif;color:#111;background:#fff;margin:24px}
h1{font-size:20px;margin:0 0 4px}p{margin:4px 0}table{border-collapse:collapse;width:100%;margin-top:12px}
th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eee}td.n{text-align:right;font-variant-numeric:tabular-nums}
tr.biz td{background:#f4f9ff}.tot{margin-top:12px;font-size:14px}.note{color:#555;font-size:12px}
@media print{.noprint{display:none}body{margin:0}}
</style></head><body>
<button class="noprint" onclick="print()">Print</button>
<h1>${esc(meta.title)}</h1>
<p>${esc(meta.truck)} · ${esc(meta.period)} · generated ${esc(meta.generated)}</p>
<table><thead><tr><th>Date</th><th>Driver</th><th>Purpose</th><th>Business purpose / note</th><th>From</th><th>To</th><th>Odometer start</th><th>Odometer end</th><th>Miles</th><th>Deduction</th></tr></thead>
<tbody>
${tr}
</tbody></table>
<div class="tot"><b>Total miles:</b> ${totals.miles.toFixed(1)} · <b>Business miles:</b> ${totals.businessMiles.toFixed(1)} · <b>Personal:</b> ${totals.byPurpose.personal.toFixed(1)} · <b>Commute:</b> ${totals.byPurpose.commute.toFixed(1)} · <b>Other:</b> ${totals.byPurpose.other.toFixed(1)} · <b>Untagged:</b> ${totals.byPurpose.untagged.toFixed(1)}<br><b>Business deduction at the standard mileage rate:</b> $${totals.deduction.toFixed(2)}</div>
<p class="note">Rates used: ${rates}. Check the IRS standard mileage rate every year (irs.gov, "standard mileage rates").</p>
<p class="note">${anchor}</p>
<p class="note">* Approximate: replayed from a phone's location history (straight lines between sparse points), not the truck's GPS.${totals.approximateMiles ? ` ${totals.approximateMiles.toFixed(1)} mi in this log.` : ''}</p>
<p class="note">This is a record-keeping aid, not tax advice.</p>
</body></html>`;
}

// ---- validation ----------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validateMileageConfig(base: OpsConfig['mileage'], patch: unknown): OpsConfig['mileage'] {
  if (!isObj(patch)) throw new OpsInputError('body must be a JSON object');
  const next = structuredClone(base);
  if ('odometerAnchor' in patch) {
    const a = patch.odometerAnchor;
    if (a === null) next.odometerAnchor = null;
    else {
      if (!isObj(a)) throw new OpsInputError('odometerAnchor must be {odometer, at} or null');
      const o = Number(a.odometer);
      if (!Number.isFinite(o) || o < 0 || o > 2_000_000) throw new OpsInputError('odometerAnchor.odometer must be 0 to 2,000,000 miles');
      const at = a.at === undefined ? new Date().toISOString() : String(a.at);
      if (!Number.isFinite(Date.parse(at))) throw new OpsInputError('odometerAnchor.at must be a date/time');
      next.odometerAnchor = { odometer: round1(o), at: new Date(at).toISOString() };
    }
  }
  if ('rates' in patch) {
    if (!Array.isArray(patch.rates)) throw new OpsInputError('rates must be a list');
    next.rates = patch.rates.map((r, i) => {
      if (!isObj(r) || typeof r.from !== 'string' || !DAY.test(r.from)) throw new OpsInputError(`rates[${i}].from must be YYYY-MM-DD`);
      const c = Number(r.centsPerMile);
      if (!Number.isFinite(c) || c < 0 || c > 500) throw new OpsInputError(`rates[${i}].centsPerMile must be 0 to 500`);
      return { from: r.from, centsPerMile: c, source: typeof r.source === 'string' && r.source.trim() ? r.source.trim().slice(0, 120) : 'entered by hand' };
    }).sort((a, b) => a.from.localeCompare(b.from));
  }
  if ('driverDefaults' in patch) {
    if (!isObj(patch.driverDefaults)) throw new OpsInputError('driverDefaults must be {driverId: purpose}');
    const dd: Record<string, Purpose> = {};
    for (const [k, v] of Object.entries(patch.driverDefaults)) {
      if (v === null || v === '') continue;
      if (!(PURPOSES as readonly string[]).includes(v as string)) throw new OpsInputError(`driverDefaults.${k} must be one of ${PURPOSES.join(', ')}`);
      dd[k] = v as Purpose;
    }
    next.driverDefaults = dd;
  }
  if ('placeTags' in patch) {
    if (!isObj(patch.placeTags)) throw new OpsInputError('placeTags must be {placeId: tag}');
    const pt: Record<string, PlaceTag> = {};
    for (const [k, v] of Object.entries(patch.placeTags)) {
      if (!/^\d+$/.test(k)) throw new OpsInputError('placeTags keys are place ids');
      if (v === null || v === '') continue;
      if (!(PLACE_TAGS as string[]).includes(v as string)) throw new OpsInputError(`placeTags.${k} must be one of ${PLACE_TAGS.join(', ')}`);
      pt[k] = v as PlaceTag;
    }
    next.placeTags = pt;
  }
  if ('feedIsBusiness' in patch) next.feedIsBusiness = patch.feedIsBusiness === true;
  return next;
}

// ---- service -----------------------------------------------------------------

export class MileageService {
  private db: Db;
  private ops: OpsStore;
  private trips: TripStore;
  private settings: () => Settings;

  constructor(db: Db, ops: OpsStore, trips: TripStore, settings: () => Settings) {
    this.db = db; this.ops = ops; this.trips = trips; this.settings = settings;
    db.exec('CREATE TABLE IF NOT EXISTS trip_tags (trip_id INTEGER PRIMARY KEY, purpose TEXT, note TEXT, updated_at TEXT NOT NULL)');
  }

  private tags(): Map<number, Tag> {
    const m = new Map<number, Tag>();
    for (const r of this.db.prepare('SELECT trip_id, purpose, note FROM trip_tags').all() as { trip_id: number; purpose: string | null; note: string | null }[]) m.set(r.trip_id, { purpose: r.purpose as Purpose | null, note: r.note });
    return m;
  }

  private endStops(): Map<number, EndStopInfo> {
    const m = new Map<number, EndStopInfo>();
    for (const r of this.db.prepare('SELECT t.id, s.name_source, s.place_id FROM trips t JOIN stops s ON s.id = t.end_stop_id').all() as { id: number; name_source: string | null; place_id: number | null }[]) m.set(r.id, { nameSource: r.name_source, placeId: r.place_id });
    return m;
  }

  allTruckTrips(): Trip[] { return this.trips.between(null, null, { source: 'truck' }); }

  odometerNow(): number | null { return odometerNow(this.allTruckTrips(), this.ops.get().mileage.odometerAnchor); }

  list(f: MileageFilter = {}): { rows: MileageRow[]; totals: MileageTotals } {
    const trips = this.trips.between(f.from ?? null, f.to ?? null, { driver: f.driver ?? null }).filter((t) => t.endedAt);
    const tags = this.tags(), ends = this.endStops();
    const names = new Map(this.settings().drivers.map((d) => [d.id, d.name]));
    const cfg = this.ops.get().mileage;
    const built = buildRows(trips.map((t) => ({ trip: t, tag: tags.get(t.id) ?? null, end: ends.get(t.id) ?? null })), this.allTruckTrips(), cfg, (id) => (id ? names.get(id) ?? id : '—'));
    if (!f.purpose) return built;
    const rows = built.rows.filter((r) => (f.purpose === 'untagged' ? !r.purpose : r.purpose === f.purpose));
    return { rows, totals: totalsOf(rows, cfg.rates) };
  }

  /** Bulk tag. purpose null = back to automatic; note undefined = leave it; "" clears it. Returns how many trips changed. */
  tag(body: unknown): number {
    if (!isObj(body)) throw new OpsInputError('body must be {tripIds, purpose?, note?}');
    const ids = body.tripIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || ids.some((i) => !Number.isInteger(i))) throw new OpsInputError('tripIds must be a list of trip ids');
    const hasPurpose = 'purpose' in body;
    const purpose = body.purpose === null || body.purpose === '' ? null : body.purpose;
    if (hasPurpose && purpose !== null && !(PURPOSES as readonly string[]).includes(purpose as string)) throw new OpsInputError(`purpose must be one of ${PURPOSES.join(', ')}, or null for automatic`);
    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') throw new OpsInputError('note must be text');
    const note = body.note === undefined ? undefined : body.note === null ? null : String(body.note).trim().slice(0, 300) || null;
    const cur = this.tags();
    const up = this.db.prepare('INSERT INTO trip_tags (trip_id, purpose, note, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(trip_id) DO UPDATE SET purpose = excluded.purpose, note = excluded.note, updated_at = excluded.updated_at');
    const del = this.db.prepare('DELETE FROM trip_tags WHERE trip_id = ?');
    const exists = this.db.prepare('SELECT 1 FROM trips WHERE id = ?');
    let n = 0;
    this.db.exec('BEGIN');
    try {
      for (const id of ids as number[]) {
        if (!exists.get(id)) continue;
        const was = cur.get(id) ?? { purpose: null, note: null };
        const p = hasPurpose ? (purpose as Purpose | null) : was.purpose;
        const nt = note === undefined ? was.note : note;
        if (p === null && nt === null) del.run(id); else up.run(id, p, nt, new Date().toISOString());
        n++;
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return n;
  }

  updateConfig(patch: unknown) {
    const next = validateMileageConfig(this.ops.get().mileage, patch);
    this.ops.set('mileage', next);
    return next;
  }
}
