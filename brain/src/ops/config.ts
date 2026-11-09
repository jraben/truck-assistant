// Track D config (mileage, maintenance, updates, backups, security, setup
// wizard) in DATA_DIR/ops.json, separate from settings.json so it never
// collides with the truck/driver settings. Written atomically like settings.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { MileageRate, OpsConfig, Reminder } from './types.ts';
import { PURPOSES, PLACE_TAGS } from './types.ts';
export { PURPOSES, PLACE_TAGS } from './types.ts';
export type { BackupTarget, MileageRate, OpsConfig, PlaceTag, Purpose, Reminder } from './types.ts';



/**
 * IRS business standard mileage rates. MUST be checked every year (and the
 * IRS changed 2026 mid-year): irs.gov/tax-professionals/standard-mileage-rates.
 * - 2025: 70 cents (IRS Notice 2025-5)
 * - 2026 Jan 1 to Jun 30: 72.5 cents (IRS Notice 2026-10, IR-2025-128, Dec 2025)
 * - 2026 from Jul 1: 76 cents (IRS Announcement 2026-11, fuel costs)
 * Checked 2026-11-05.
 */
export const DEFAULT_RATES: MileageRate[] = [
  { from: '2025-01-01', centsPerMile: 70, source: 'IRS Notice 2025-5' },
  { from: '2026-01-01', centsPerMile: 72.5, source: 'IRS Notice 2026-10 (IR-2025-128)' },
  { from: '2026-07-01', centsPerMile: 76, source: 'IRS Announcement 2026-11 (mid-year increase)' },
];


export const OWNER_MANUAL = "Set from the owner's manual";

export function defaultReminders(now = new Date()): Reminder[] {
  const since = { at: now.toISOString(), odometer: null };
  const r = (id: string, name: string): Reminder => ({ id, name, everyMiles: null, everyMonths: null, note: OWNER_MANUAL, lastDone: null, since });
  // No intervals on purpose: the Slate's aren't published yet, and guessing would be worse than nothing.
  return [r('tire-rotation', 'Tire rotation'), r('cabin-filter', 'Cabin air filter'), r('wiper-blades', 'Wiper blades'), r('battery-12v', '12V battery check'), r('brake-fluid', 'Brake fluid')];
}


export function defaultOps(): OpsConfig {
  return {
    mileage: { odometerAnchor: null, rates: structuredClone(DEFAULT_RATES), driverDefaults: {}, placeTags: {}, feedIsBusiness: true },
    maintenance: { reminders: defaultReminders(), notifyService: null, notifiedOn: {} },
    updater: { repo: null, channel: 'stable', auto: { enabled: false, when: 'parked' } },
    backup: { enabled: false, hour: 2, target: { kind: 'none' }, keep: 14, keepLocal: 3, includeSecrets: false },
    auth: { passwordHash: null, trustLocal: true },
    setup: { done: false, steps: {} },
  };
}

export class OpsInputError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Defaults filled in section by section, so an older file gains new fields. */
export function loadOps(raw: unknown): OpsConfig {
  const d = defaultOps();
  if (!isObj(raw)) return d;
  const out = d as unknown as Record<string, Record<string, unknown>>;
  for (const k of Object.keys(d) as (keyof OpsConfig)[]) {
    if (isObj(raw[k])) out[k] = { ...out[k], ...(raw[k] as Record<string, unknown>) };
  }
  const c = out as unknown as OpsConfig;
  const a = (isObj(c.updater.auto) ? c.updater.auto : {}) as Record<string, unknown>;
  c.updater.auto = { enabled: a.enabled === true, when: a.when === 'home-wifi' ? 'home-wifi' : 'parked' };
  return c;
}

export class OpsStore {
  private file: string;
  private c: OpsConfig;
  private listeners: ((c: OpsConfig) => void)[] = [];

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'ops.json');
    try { this.c = loadOps(JSON.parse(readFileSync(this.file, 'utf8'))); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[ops] ${this.file} unreadable, using defaults: ${(e as Error).message}`);
      this.c = defaultOps();
      this.write();
    }
  }

  get(): OpsConfig { return this.c; }

  /** Replace one section (already validated by its owner). */
  set<K extends keyof OpsConfig>(k: K, v: OpsConfig[K]) {
    this.c = { ...this.c, [k]: structuredClone(v) };
    this.write();
    for (const l of this.listeners) { try { l(this.c); } catch (e) { console.error('[ops] listener', e); } }
  }

  onChange(l: (c: OpsConfig) => void) { this.listeners.push(l); }

  private write() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.c, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
