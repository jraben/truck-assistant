// Maintenance: a log (with receipt photos in DATA_DIR/receipts), reminders by
// miles and/or months, and TPMS history from the truck box readings.
// Intervals start empty ("set from the owner's manual"): the Slate's own
// schedule isn't published, and a guessed interval is worse than none.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.ts';
import type { State, Wheel } from '../types.ts';
import { OpsInputError, OWNER_MANUAL, type OpsStore, type Reminder } from './config.ts';
import type { DueState, MaintEntry, ReminderStatus, TpmsPoint } from './types.ts';
export type { DueState, MaintEntry, ReminderStatus, TpmsPoint } from './types.ts';


/** "Soon" when this close: the larger of 300 mi and 10% of the interval, or 30 days. */
export const SOON_MI = 300;
export const SOON_DAYS = 30;
const DAY_MS = 86_400_000;

export function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + months, 1, d.getHours(), d.getMinutes());
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}

/** Where a reminder stands. Pure. */
export function dueStatus(r: Reminder, odometer: number | null, now = new Date()): ReminderStatus {
  const base = r.lastDone ?? r.since;
  let milesLeft: number | null = null, daysLeft: number | null = null, dueAtMiles: number | null = null, dueOn: string | null = null;
  const why: string[] = [];
  if (r.everyMiles) {
    if (base.odometer !== null && base.odometer !== undefined) {
      dueAtMiles = Math.round(base.odometer + r.everyMiles);
      if (odometer !== null) milesLeft = Math.round(dueAtMiles - odometer);
    }
    if (milesLeft === null) why.push('miles unknown: enter an odometer reading on the Mileage settings');
  }
  if (r.everyMonths) {
    const d = addMonths(base.at, r.everyMonths);
    dueOn = d.toISOString();
    daysLeft = Math.ceil((d.getTime() - now.getTime()) / DAY_MS);
  }
  let state: DueState;
  if (!r.everyMiles && !r.everyMonths) state = 'unset';
  else if ((milesLeft !== null && milesLeft <= 0) || (daysLeft !== null && daysLeft <= 0)) state = 'due';
  else if ((milesLeft !== null && milesLeft <= Math.max(SOON_MI, (r.everyMiles ?? 0) * 0.1)) || (daysLeft !== null && daysLeft <= SOON_DAYS)) state = 'soon';
  else if (r.everyMiles && milesLeft === null && !r.everyMonths) state = 'needs-odometer';
  else state = 'ok';
  if (state === 'unset') why.push(r.note || OWNER_MANUAL);
  // Due: name only what is overdue ("1644 mi overdue", never "1644 mi overdue · in 31 days").
  const overMi = milesLeft !== null && milesLeft <= 0, overDays = daysLeft !== null && daysLeft <= 0;
  if (milesLeft !== null && (state !== 'due' || overMi)) why.push(overMi ? `${-milesLeft} mi overdue` : `in ${milesLeft} mi`);
  if (daysLeft !== null && (state !== 'due' || overDays)) why.push(overDays ? `${-daysLeft} days overdue` : `in ${daysLeft} days`);
  return { ...r, state, milesLeft, daysLeft, dueAtMiles, dueOn, why: why.join(' · ') };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const optNum = (v: unknown, name: string, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new OpsInputError(`${name} must be ${min} to ${max}, or empty`);
  return n;
};

/** Replace the reminder list. Keeps each id's history; a newly set interval starts counting now. Pure apart from `now`/`odometer`. */
export function mergeReminders(cur: Reminder[], body: unknown, odometer: number | null, now = new Date()): Reminder[] {
  if (!Array.isArray(body)) throw new OpsInputError('reminders must be a list');
  const seen = new Set<string>();
  return body.map((x, i) => {
    if (!isObj(x)) throw new OpsInputError(`reminders[${i}] must be an object`);
    const name = typeof x.name === 'string' ? x.name.trim().slice(0, 60) : '';
    if (!name) throw new OpsInputError(`reminders[${i}].name is required`);
    let id = typeof x.id === 'string' && x.id ? x.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || `item-${i}`;
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new OpsInputError(`reminders[${i}].id: lowercase letters, digits and -`);
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    const everyMiles = optNum(x.everyMiles, `${name}: every miles`, 1, 200_000);
    const everyMonths = optNum(x.everyMonths, `${name}: every months`, 1, 240);
    const old = cur.find((r) => r.id === id);
    const fresh = { at: now.toISOString(), odometer };
    const wasUnset = !old || (!old.everyMiles && !old.everyMonths);
    return {
      id, name, everyMiles, everyMonths,
      note: typeof x.note === 'string' ? x.note.trim().slice(0, 120) : old?.note ?? OWNER_MANUAL,
      lastDone: old?.lastDone ?? null,
      since: old && !(wasUnset && (everyMiles || everyMonths) && !old.lastDone) ? old.since : fresh,
    };
  });
}


export const RECEIPT_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
export const RECEIPT_MAX = 15 * 1024 * 1024;
const TYPE_OF: Record<string, string> = Object.fromEntries(Object.entries(RECEIPT_TYPES).map(([k, v]) => [v, k]));

type Row = { id: number; date: string; odometer: number | null; item: string; reminder_id: string | null; cost: number | null; shop: string | null; note: string | null; receipt: string | null };
const toEntry = (r: Row): MaintEntry => ({ id: r.id, date: r.date, odometer: r.odometer, item: r.item, reminderId: r.reminder_id, cost: r.cost, shop: r.shop, note: r.note, receipt: r.receipt });

const WHEELS: Wheel[] = ['fl', 'fr', 'rl', 'rr'];
/** Keep a TPMS reading when it moved this much, or this long passed. */
export const TPMS_MIN_DELTA = 0.5;
export const TPMS_EVERY_MS = 10 * 60_000;
export const TPMS_KEEP_DAYS = 400;


/** Should this reading be stored, given the last stored one for that wheel? Pure. */
export function keepTpms(last: { t: number; psi: number | null } | undefined, psi: number | null, t: number): boolean {
  if (psi === null) return false;
  if (!last) return true;
  if (last.psi === null || Math.abs(psi - last.psi) >= TPMS_MIN_DELTA) return true;
  return t - last.t >= TPMS_EVERY_MS;
}

export class MaintenanceService {
  private db: Db;
  private ops: OpsStore;
  readonly receiptDir: string;
  private lastTpms = new Map<Wheel, { t: number; psi: number | null }>();

  constructor(db: Db, ops: OpsStore, dataDir: string) {
    this.db = db; this.ops = ops;
    this.receiptDir = path.join(dataDir, 'receipts');
    db.exec(`
      CREATE TABLE IF NOT EXISTS maint_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, odometer REAL, item TEXT NOT NULL,
        reminder_id TEXT, cost REAL, shop TEXT, note TEXT, receipt TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tpms_readings (t TEXT NOT NULL, wheel TEXT NOT NULL, psi REAL, temp_f REAL);
      CREATE INDEX IF NOT EXISTS tpms_readings_t ON tpms_readings(t);
    `);
  }

  log(): MaintEntry[] { return (this.db.prepare('SELECT * FROM maint_log ORDER BY date DESC, id DESC').all() as Row[]).map(toEntry); }
  get(id: number): MaintEntry | null { const r = this.db.prepare('SELECT * FROM maint_log WHERE id = ?').get(id) as Row | undefined; return r ? toEntry(r) : null; }

  statuses(odometer: number | null, now = new Date()): ReminderStatus[] { return this.ops.get().maintenance.reminders.map((r) => dueStatus(r, odometer, now)); }

  private parse(b: unknown, partial: boolean) {
    if (!isObj(b)) throw new OpsInputError('body must be a JSON object');
    const out: Partial<Omit<MaintEntry, 'id' | 'receipt'>> = {};
    if (b.date !== undefined || !partial) {
      const d = b.date === undefined ? new Date().toISOString() : String(b.date);
      if (!Number.isFinite(Date.parse(d))) throw new OpsInputError('date must be a date');
      out.date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`).toISOString() : new Date(d).toISOString();
    }
    const reminders = this.ops.get().maintenance.reminders;
    if (b.reminderId !== undefined) {
      if (b.reminderId === null || b.reminderId === '') out.reminderId = null;
      else if (!reminders.some((r) => r.id === b.reminderId)) throw new OpsInputError(`no reminder "${String(b.reminderId)}"`);
      else out.reminderId = String(b.reminderId);
    }
    if (b.item !== undefined || !partial) {
      const item = typeof b.item === 'string' && b.item.trim() ? b.item.trim().slice(0, 80) : reminders.find((r) => r.id === out.reminderId)?.name;
      if (!item) throw new OpsInputError('item is required (e.g. "Tire rotation")');
      out.item = item;
    }
    if (b.odometer !== undefined) out.odometer = optNum(b.odometer, 'odometer', 0, 2_000_000);
    if (b.cost !== undefined) out.cost = optNum(b.cost, 'cost', 0, 100_000);
    for (const k of ['shop', 'note'] as const) if (b[k] !== undefined) out[k] = typeof b[k] === 'string' && (b[k] as string).trim() ? (b[k] as string).trim().slice(0, k === 'note' ? 500 : 80) : null;
    return out;
  }

  add(body: unknown): MaintEntry {
    const p = this.parse(body, false);
    const res = this.db.prepare('INSERT INTO maint_log (date, odometer, item, reminder_id, cost, shop, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.date!, p.odometer ?? null, p.item!, p.reminderId ?? null, p.cost ?? null, p.shop ?? null, p.note ?? null, new Date().toISOString());
    const e = this.get(Number(res.lastInsertRowid))!;
    if (e.reminderId) this.markDone(e.reminderId, { at: e.date, odometer: e.odometer });
    return e;
  }

  update(id: number, body: unknown): MaintEntry | null {
    const cur = this.get(id);
    if (!cur) return null;
    const p = { ...cur, ...this.parse(body, true) };
    this.db.prepare('UPDATE maint_log SET date = ?, odometer = ?, item = ?, reminder_id = ?, cost = ?, shop = ?, note = ? WHERE id = ?')
      .run(p.date, p.odometer, p.item, p.reminderId, p.cost, p.shop, p.note, id);
    const e = this.get(id)!;
    if (e.reminderId) this.markDone(e.reminderId, { at: e.date, odometer: e.odometer });
    return e;
  }

  delete(id: number): boolean {
    const cur = this.get(id);
    if (!cur) return false;
    if (cur.receipt) this.removeReceiptFile(cur.receipt);
    this.db.prepare('DELETE FROM maint_log WHERE id = ?').run(id);
    return true;
  }

  /** A reminder done: only moves forward (an old entry logged late doesn't reset a newer one). */
  markDone(reminderId: string, done: { at: string; odometer: number | null }): boolean {
    const m = this.ops.get().maintenance;
    const r = m.reminders.find((x) => x.id === reminderId);
    if (!r) return false;
    if (r.lastDone && Date.parse(r.lastDone.at) > Date.parse(done.at)) return true;
    this.ops.set('maintenance', { ...m, reminders: m.reminders.map((x) => (x.id === reminderId ? { ...x, lastDone: done } : x)), notifiedOn: Object.fromEntries(Object.entries(m.notifiedOn).filter(([k]) => k !== reminderId)) });
    return true;
  }

  setReminders(body: unknown, odometer: number | null): Reminder[] {
    const m = this.ops.get().maintenance;
    const reminders = mergeReminders(m.reminders, body, odometer);
    this.ops.set('maintenance', { ...m, reminders });
    return reminders;
  }

  setNotify(service: unknown) {
    const m = this.ops.get().maintenance;
    const s = service === null || service === '' || service === undefined ? null : String(service).trim().replace(/^notify\./, '');
    if (s !== null && !/^[a-z0-9_]{1,80}$/.test(s)) throw new OpsInputError('notify service looks like mobile_app_jeffs_iphone (from notify.mobile_app_jeffs_iphone)');
    this.ops.set('maintenance', { ...m, notifyService: s });
  }

  // ---- receipts ---------------------------------------------------------------

  saveReceipt(id: number, contentType: string, body: Buffer): MaintEntry | null {
    const cur = this.get(id);
    if (!cur) return null;
    const ext = RECEIPT_TYPES[contentType.split(';')[0].trim().toLowerCase()];
    if (!ext) throw new OpsInputError(`receipt must be a photo or PDF (${Object.keys(RECEIPT_TYPES).join(', ')})`);
    if (!body.length) throw new OpsInputError('empty upload');
    if (body.length > RECEIPT_MAX) throw new OpsInputError('receipt is larger than 15 MB');
    mkdirSync(this.receiptDir, { recursive: true });
    const name = `${id}-${randomBytes(6).toString('hex')}.${ext}`;
    writeFileSync(path.join(this.receiptDir, name), body, { mode: 0o600 });
    if (cur.receipt) this.removeReceiptFile(cur.receipt);
    this.db.prepare('UPDATE maint_log SET receipt = ? WHERE id = ?').run(name, id);
    return this.get(id);
  }

  /** Only names this service made: <id>-<hex>.<ext>. Never a path from a request. */
  receipt(name: string): { file: string; type: string } | null {
    const m = /^\d+-[0-9a-f]{12}\.([a-z]+)$/.exec(name);
    if (!m || !TYPE_OF[m[1]]) return null;
    const file = path.join(this.receiptDir, name);
    return existsSync(file) ? { file, type: TYPE_OF[m[1]] } : null;
  }

  readReceipt(name: string): { body: Buffer; type: string } | null {
    const r = this.receipt(name);
    return r ? { body: readFileSync(r.file), type: r.type } : null;
  }

  private removeReceiptFile(name: string) {
    const r = this.receipt(name);
    if (r) try { unlinkSync(r.file); } catch { /* already gone */ }
  }

  // ---- TPMS history -----------------------------------------------------------

  sampleTpms(s: State, now = Date.now()): number {
    if (!s.tpms) return 0;
    const ins = this.db.prepare('INSERT INTO tpms_readings (t, wheel, psi, temp_f) VALUES (?, ?, ?, ?)');
    let n = 0;
    for (const w of WHEELS) {
      const r = s.tpms[w];
      if (!keepTpms(this.lastTpms.get(w), r.psi, now)) continue;
      ins.run(new Date(now).toISOString(), w, r.psi, r.tempF);
      this.lastTpms.set(w, { t: now, psi: r.psi });
      n++;
    }
    return n;
  }

  pruneTpms(now = Date.now()) {
    this.db.prepare('DELETE FROM tpms_readings WHERE t < ?').run(new Date(now - TPMS_KEEP_DAYS * DAY_MS).toISOString());
  }

  /** Per wheel, thinned to at most `max` points (every n-th, last kept). */
  tpmsHistory(days = 30, max = 400): Record<Wheel, TpmsPoint[]> {
    const since = new Date(Date.now() - Math.max(1, Math.min(TPMS_KEEP_DAYS, days)) * DAY_MS).toISOString();
    const rows = this.db.prepare('SELECT t, wheel, psi, temp_f FROM tpms_readings WHERE t >= ? ORDER BY t').all(since) as { t: string; wheel: Wheel; psi: number | null; temp_f: number | null }[];
    const out = { fl: [], fr: [], rl: [], rr: [] } as Record<Wheel, TpmsPoint[]>;
    for (const r of rows) if (out[r.wheel]) out[r.wheel].push({ t: r.t, psi: r.psi, tempF: r.temp_f });
    for (const w of WHEELS) {
      const a = out[w];
      if (a.length > max) { const step = Math.ceil(a.length / max); out[w] = a.filter((_, i) => i % step === 0 || i === a.length - 1); }
    }
    return out;
  }
}
