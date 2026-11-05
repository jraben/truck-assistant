// Track D config (mileage, maintenance, updates, backups, security, setup
// wizard) in DATA_DIR/ops.json, separate from settings.json so it never
// collides with the truck/driver settings. Written atomically like settings.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PURPOSES = ['business', 'personal', 'commute', 'other'] as const;
export type Purpose = (typeof PURPOSES)[number];
/** What a saved place stands for. client = business. */
export type PlaceTag = 'business' | 'client' | 'personal' | 'commute';
export const PLACE_TAGS: PlaceTag[] = ['business', 'client', 'personal', 'commute'];

/** One IRS rate, in effect from `from` (YYYY-MM-DD) until the next one. */
export type MileageRate = { from: string; centsPerMile: number; source: string };

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

export type Reminder = {
  id: string;                       // lowercase, digits, "-"
  name: string;
  everyMiles: number | null;        // null = not set
  everyMonths: number | null;
  /** Where the interval came from, shown next to it. Defaults say "set from the owner's manual". */
  note: string;
  lastDone: { at: string; odometer: number | null } | null;
  /** Counting starts here when it has never been done (set when the interval is first set). */
  since: { at: string; odometer: number | null };
};

export const OWNER_MANUAL = "Set from the owner's manual";

export function defaultReminders(now = new Date()): Reminder[] {
  const since = { at: now.toISOString(), odometer: null };
  const r = (id: string, name: string): Reminder => ({ id, name, everyMiles: null, everyMonths: null, note: OWNER_MANUAL, lastDone: null, since });
  // No intervals on purpose: the Slate's aren't published yet, and guessing would be worse than nothing.
  return [r('tire-rotation', 'Tire rotation'), r('cabin-filter', 'Cabin air filter'), r('wiper-blades', 'Wiper blades'), r('battery-12v', '12V battery check'), r('brake-fluid', 'Brake fluid')];
}

export type BackupTarget =
  | { kind: 'none' }
  | { kind: 'path'; path: string }                                    // a mounted SMB/NFS share, e.g. /mnt/nas/slate-backups
  | { kind: 'rsync'; dest: string; sshKey: string | null; port: number } // user@nas:/volume1/backups/slate
  | { kind: 'http'; url: string; auth: string | null };               // PUT <url>/<file>; auth = "user:password"

export type OpsConfig = {
  mileage: {
    odometerAnchor: { odometer: number; at: string } | null;
    rates: MileageRate[];
    driverDefaults: Record<string, Purpose>;
    placeTags: Record<string, PlaceTag>;   // Place id -> tag
    feedIsBusiness: boolean;               // places-feed stops (client records) count as business
  };
  maintenance: {
    reminders: Reminder[];
    notifyService: string | null;          // HA notify service, e.g. "mobile_app_jeffs_iphone"
    notifiedOn: Record<string, string>;    // reminder id -> last day notified (YYYY-MM-DD)
  };
  updater: { repo: string | null; channel: 'stable' | 'main' };
  backup: {
    enabled: boolean;
    hour: number;                          // local hour to run, when on home Wi-Fi
    target: BackupTarget;
    keep: number;                          // on the target
    keepLocal: number;                     // in DATA_DIR/backups
    includeSecrets: boolean;               // keys/tokens/passwords; default false
  };
  auth: { passwordHash: string | null; trustLocal: boolean };
  setup: { done: boolean; steps: Record<string, 'done' | 'skipped'> };
};

export function defaultOps(): OpsConfig {
  return {
    mileage: { odometerAnchor: null, rates: structuredClone(DEFAULT_RATES), driverDefaults: {}, placeTags: {}, feedIsBusiness: true },
    maintenance: { reminders: defaultReminders(), notifyService: null, notifiedOn: {} },
    updater: { repo: null, channel: 'stable' },
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
  return out as unknown as OpsConfig;
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
