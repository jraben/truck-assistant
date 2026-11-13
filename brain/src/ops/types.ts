// Track D API shapes. Pure types (no Node imports) so the UI can import them.

export const PURPOSES = ['business', 'personal', 'commute', 'other'] as const;
export type Purpose = (typeof PURPOSES)[number];
/** What a saved place stands for. client = business. */
export type PlaceTag = 'business' | 'client' | 'personal' | 'commute';
export const PLACE_TAGS: PlaceTag[] = ['business', 'client', 'personal', 'commute'];

/** One IRS rate, in effect from `from` (YYYY-MM-DD) until the next one. */
export type MileageRate = { from: string; centsPerMile: number; source: string };

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
  updater: { repo: string | null; channel: 'stable' | 'main'; auto: AutoUpdate };
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

export type PurposeSource = 'manual' | 'place' | 'feed' | 'driver';
export type EndStopInfo = { nameSource: string | null; placeId: number | null };
export type Tag = { purpose: Purpose | null; note: string | null };

export type MileageRow = {
  tripId: number;
  startedAt: string; endedAt: string | null;
  date: string;                       // local YYYY-MM-DD the trip started
  driverId: string | null; driver: string;
  purpose: Purpose | null; purposeSource: PurposeSource | null;
  note: string | null;
  from: string; to: string;
  startOdometer: number | null; endOdometer: number | null;
  miles: number;
  approximate: boolean;               // phone trip: straight lines between sparse points
  source: 'truck' | 'phone';
  rateCents: number | null;           // IRS rate in effect that day (business rows)
  deduction: number | null;           // USD, business rows only
};

export type MileageTotals = {
  trips: number; miles: number;
  byPurpose: Record<Purpose | 'untagged', number>;
  businessMiles: number;
  deduction: number;
  untaggedTrips: number;
  approximateMiles: number;
  ratesUsed: MileageRate[];
};

export type DueState = 'ok' | 'soon' | 'due' | 'unset' | 'needs-odometer';
export type ReminderStatus = Reminder & {
  state: DueState;
  milesLeft: number | null; daysLeft: number | null;
  dueAtMiles: number | null; dueOn: string | null;
  why: string;
};

export type MaintEntry = {
  id: number; date: string; odometer: number | null; item: string; reminderId: string | null;
  cost: number | null; shop: string | null; note: string | null; receipt: string | null;
};

export type TpmsPoint = { t: string; psi: number | null; tempF: number | null };

export type Release = {
  tag: string; name: string; sha: string | null;
  publishedAt: string | null; notes: string;
  tarballUrl: string;                 // source tarball
  assetUrl: string | null;            // prebuilt slate-cockpit-<tag>.tar.gz from the release workflow
  prerelease: boolean;
  /**
   * How much the install downloads. `bytes`: exact for a prebuilt release asset;
   * for a source install, what the last source download was (an estimate), or null.
   * `packagesChanged`: package-lock.json differs from the installed version, so the
   * build fetches new packages too (can be much more); null when not known.
   */
  download?: { bytes: number | null; exact: boolean; packagesChanged: boolean | null };
};

export type Installed = { version: string; tag: string | null; sha: string | null; channel: string | null; installedAt: string | null; downloadBytes?: number | null };

export type Phase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'requested' | 'downloading' | 'building' | 'restarting' | 'verifying' | 'done' | 'rolled-back' | 'failed';

export type Job = { id: string; action: 'install' | 'rollback'; tag: string | null; sha: string | null; repo: string; channel: 'stable' | 'main'; assetUrl: string | null; tarballUrl: string | null; requestedAt: string };

/** Install new versions by themselves: never while driving; `when` adds home Wi-Fi as a condition. */
export type AutoUpdate = { enabled: boolean; when: 'parked' | 'home-wifi' };

export type UpdateStatus = {
  phase: Phase; message: string | null;
  repo: string | null; channel: 'stable' | 'main';
  installed: Installed;
  latest: Release | null; releases: Release[];
  checkedAt: string | null;
  job: Job | null;
  canInstall: boolean; installNote: string | null;
  canRollback: boolean;
  /** Automatic updates: the setting, why an available update is waiting (or null), and the next check. */
  auto: AutoUpdate & { waiting: string | null; nextCheckAt: string | null; skipped: string | null };
};

export type BackupStatus = {
  running: boolean;
  lastAt: string | null; lastOk: boolean | null; lastError: string | null;
  lastName: string | null; lastSize: number | null;
  lastSuccessAt: string | null;
  sentTo: string | null;              // where the last good one went
};

export type OpsSummary = {
  maintenanceDue: number; maintenanceSoon: number;
  dueItems: string[];               // names, due first
  lastBackupAt: string | null; lastBackupOk: boolean | null; backupTarget: string | null;
  updateAvailable: string | null;   // tag, or null
  version: string;
  odometerEst: number | null;
};
