// Track D's running parts, beside the Brain: TPMS sampling, maintenance
// reminders (HA notify), nightly backups, the updater, and the ops summary
// on MQTT for Home Assistant.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { Brain } from '../brain.ts';
import { BRAIN_ROOT, config } from '../config.ts';
import { kvGet, kvSet } from '../db.ts';
import { PROJECT_NAME } from '../project.ts';
import { RateLimiter, Sessions } from './auth.ts';
import { backupDue, EMPTY_STATUS, makeBackup, makeTarget, NAME_RE, stageRestore, targetLabel, toPrune, validateTarget, type BackupStatus } from './backup.ts';
import { OpsInputError, OpsStore, type OpsConfig } from './config.ts';
import { opsDiscovery, opsTopic, type OpsSummary } from './haOps.ts';
import { MaintenanceService } from './maintenance.ts';
import { MileageService } from './mileage.ts';
import { AUTO_CHECK_MS, autoUpdateStep, GithubSource, isDriving, readInstalled, SystemdRunner, Updater, type Job, type Phase } from './updater.ts';

export const AP_PROFILE = 'slate-ap';

export class OpsService {
  readonly store: OpsStore;
  readonly mileage: MileageService;
  readonly maintenance: MaintenanceService;
  readonly updater: Updater;
  readonly sessions: Sessions;
  readonly limiter = new RateLimiter();
  readonly dataDir: string;
  private brain: Brain;
  private timers: NodeJS.Timeout[] = [];
  private updTimer: NodeJS.Timeout | null = null;
  private mqttWasUp = false;
  private lastSummary = '';
  backup: BackupStatus;

  constructor(brain: Brain, dataDir = config.dataDir) {
    this.brain = brain;
    this.dataDir = dataDir;
    const db = (brain as unknown as { db: import('../db.ts').Db }).db;
    this.store = new OpsStore(dataDir);
    this.mileage = new MileageService(db, this.store, brain.trips, () => brain.settings.get());
    this.maintenance = new MaintenanceService(db, this.store, dataDir);
    this.sessions = new Sessions(db);
    this.backup = { ...EMPTY_STATUS, ...(kvGet<BackupStatus>(db, 'backupStatus') ?? {}), running: false };
    const appRoot = path.resolve(BRAIN_ROOT, '..');
    this.updater = new Updater({
      runner: new SystemdRunner(dataDir),
      source: new GithubSource(`slate-cockpit/${config.version}`),
      cfg: () => this.store.get().updater,
      installed: () => readInstalled(appRoot, config.version),
      saved: kvGet<{ job: Job | null; phase: Phase; message: string | null }>(db, 'updater'),
      save: (j) => { try { kvSet(db, 'updater', j); } catch { /* best effort */ } },
      autoInfo: () => this.autoInfo(),
    });
    const a = kvGet<{ lastCheckAt: number | null; triedTag: string | null }>(db, 'autoUpdate');
    if (a) this.auto = { lastCheckAt: a.lastCheckAt ?? null, triedTag: a.triedTag ?? null, waiting: null };
    this.db = db;
  }

  private db: import('../db.ts').Db;

  start() {
    const every = (ms: number, f: () => unknown) => { this.timers.push(setInterval(() => { try { const p = f(); if (p instanceof Promise) p.catch((e) => console.error('[ops]', e)); } catch (e) { console.error('[ops]', e); } }, ms)); };
    every(60_000, () => this.maintenance.sampleTpms(this.brain.getState()));
    every(24 * 3_600_000, () => this.maintenance.pruneTpms());
    every(5 * 60_000, () => this.backupTick());
    every(30 * 60_000, () => this.notifyDue());
    every(10_000, () => this.mqttTick());
    every(60_000, () => this.autoTick());
    this.store.onChange(() => this.publishSummary());
    this.followUpdate();
  }

  stop() { for (const t of this.timers) clearInterval(t); if (this.updTimer) clearTimeout(this.updTimer); }

  // ---- updater -----------------------------------------------------------------

  /** The automatic updater's memory (kv 'autoUpdate'): when GitHub was last asked, and the tag it last installed by itself. */
  private auto: { lastCheckAt: number | null; triedTag: string | null; waiting: string | null } = { lastCheckAt: null, triedTag: null, waiting: null };

  private autoInfo() {
    const cfg = this.store.get().updater;
    const u = this.updater ? { phase: this.updater.phase } : { phase: 'idle' as Phase };
    return {
      waiting: cfg.auto.enabled ? this.auto.waiting : null,
      // never checked: the next minute's tick does it
      nextCheckAt: cfg.repo ? new Date(this.auto.lastCheckAt === null ? Date.now() + 60_000 : this.auto.lastCheckAt + AUTO_CHECK_MS).toISOString() : null,
      skipped: cfg.auto.enabled && u.phase === 'available' && this.auto.triedTag && this.lastLatest === this.auto.triedTag ? `${this.auto.triedTag} didn't install by itself last time; install it by hand when you're ready` : null,
    };
  }
  private lastLatest: string | null = null;

  /** Once a minute: check GitHub every 12 hours, and install by itself when allowed (updater.ts autoUpdateStep). */
  async autoTick() {
    const cfg = this.store.get().updater;
    if (!cfg.repo) { this.auto.waiting = null; return; }
    const st = this.brain.getState();
    const u = this.updater.status();
    this.lastLatest = u.latest?.tag ?? null;
    const step = autoUpdateStep(cfg.auto, {
      now: Date.now(), lastCheckAt: this.auto.lastCheckAt, online: st.network.link !== 'offline',
      driving: isDriving(st), homeWifi: st.network.link === 'home',
      phase: u.phase, latestTag: this.lastLatest, triedTag: this.auto.triedTag, installNote: u.installNote,
    });
    this.auto.waiting = step.waiting;
    const save = () => { try { kvSet(this.db, 'autoUpdate', { lastCheckAt: this.auto.lastCheckAt, triedTag: this.auto.triedTag }); } catch { /* best effort */ } };
    if (step.act === 'check') {
      this.auto.lastCheckAt = Date.now(); save();
      await this.updater.check();
      this.lastLatest = this.updater.status().latest?.tag ?? null;
      this.publishSummary();
    } else if (step.act === 'install' && this.lastLatest) {
      this.auto.triedTag = this.lastLatest; save();
      console.log(`[update] installing ${this.lastLatest} by itself (${cfg.auto.when === 'home-wifi' ? 'parked on home Wi-Fi' : 'parked'})`);
      await this.updater.install(this.lastLatest);
      this.followUpdate();
    }
  }

  /** Poll the updater service every 3 s while an update runs. */
  followUpdate() {
    if (this.updTimer) return;
    const go = async () => {
      this.updTimer = null;
      try { await this.updater.poll(); } catch (e) { console.error('[update] poll', e); }
      if (this.updater.busy()) this.updTimer = setTimeout(() => void go(), 3000);
      this.publishSummary();
    };
    void go();
  }

  // ---- backups -----------------------------------------------------------------

  private saveBackupStatus() { try { kvSet(this.db, 'backupStatus', { ...this.backup, running: false }); } catch { /* best effort */ } this.publishSummary(); }

  private async backupTick() {
    const st = this.brain.getState();
    const cfg = this.store.get().backup;
    if (cfg.target.kind === 'none') return;
    if (backupDue(cfg, this.backup, new Date(), st.network.link === 'home', !!st.trip)) await this.runBackup();
  }

  async runBackup(): Promise<BackupStatus> {
    if (this.backup.running) throw new OpsInputError('A backup is already running');
    const cfg = this.store.get().backup;
    const s = this.brain.settings.get();
    this.backup = { ...this.backup, running: true };
    try {
      const b = makeBackup(this.db, this.dataDir, { truckId: s.truckId, version: config.version, includeSecrets: cfg.includeSecrets });
      for (const old of toPrune(this.localBackups().map((x) => x.name), cfg.keepLocal)) try { unlinkSync(path.join(this.dataDir, 'backups', old)); } catch { /* gone */ }
      const target = makeTarget(cfg.target, undefined, undefined, path.join(this.dataDir, 'backups'));
      if (target) {
        await target.send(b.file, b.name);
        const names = await target.list().catch(() => null);
        if (names) for (const old of toPrune(names, cfg.keep)) await target.remove(old).catch((e) => console.warn('[backup] prune', (e as Error).message));
      }
      this.backup = { running: false, lastAt: new Date().toISOString(), lastOk: true, lastError: null, lastName: b.name, lastSize: b.size, lastSuccessAt: new Date().toISOString(), sentTo: targetLabel(cfg.target) };
      console.log(`[backup] ${b.name} (${Math.round(b.size / 1024)} KB) -> ${targetLabel(cfg.target)}`);
    } catch (e) {
      this.backup = { ...this.backup, running: false, lastAt: new Date().toISOString(), lastOk: false, lastError: (e as Error).message };
      console.error('[backup] failed:', (e as Error).message);
    }
    this.saveBackupStatus();
    return this.backup;
  }

  localBackups(): { name: string; size: number; at: string }[] {
    const dir = path.join(this.dataDir, 'backups');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((n) => NAME_RE.test(n)).map((n) => { const st = statSync(path.join(dir, n)); return { name: n, size: st.size, at: st.mtime.toISOString() }; }).sort((a, b) => b.name.localeCompare(a.name));
  }

  async targetBackups(): Promise<{ names: string[] | null; error: string | null }> {
    const t = makeTarget(this.store.get().backup.target, undefined, undefined, path.join(this.dataDir, 'backups'));
    if (!t) return { names: [], error: null };
    try { const n = await t.list(); return { names: n ? n.sort().reverse() : null, error: null }; } catch (e) { return { names: null, error: (e as Error).message }; }
  }

  async restore(name: string, from: 'local' | 'target' | 'upload', upload?: Buffer) {
    let gz: Buffer;
    if (from === 'upload') { if (!upload?.length) throw new OpsInputError('empty upload'); gz = upload; }
    else {
      if (!NAME_RE.test(name)) throw new OpsInputError('not a backup name');
      if (from === 'local') {
        const f = path.join(this.dataDir, 'backups', name);
        if (!existsSync(f)) throw new OpsInputError('no such backup on the truck');
        gz = readFileSync(f);
      } else {
        const t = makeTarget(this.store.get().backup.target, undefined, undefined, path.join(this.dataDir, 'backups'));
        if (!t) throw new OpsInputError('no backup target set');
        gz = await t.fetch(name);
      }
    }
    const manifest = stageRestore(this.dataDir, gz);
    // Under systemd, exit and let it start us again with the restored files; on a desk, say so.
    const managed = !!process.env.INVOCATION_ID;
    if (managed) setTimeout(() => { console.log('[backup] restarting to apply the restore'); process.kill(process.pid, 'SIGTERM'); }, 1500);
    return { manifest, restarting: managed, message: managed ? 'Restored. The brain restarts in a moment to load it.' : 'Staged. Restart the brain to load the restored data.' };
  }

  updateBackupConfig(patch: unknown): OpsConfig['backup'] {
    if (!patch || typeof patch !== 'object') throw new OpsInputError('body must be a JSON object');
    const p = patch as Record<string, unknown>;
    const cur = this.store.get().backup;
    const next = { ...cur };
    if ('enabled' in p) next.enabled = p.enabled === true;
    if ('includeSecrets' in p) next.includeSecrets = p.includeSecrets === true;
    for (const [k, min, max] of [['hour', 0, 23], ['keep', 1, 365], ['keepLocal', 1, 30]] as const) {
      if (k in p) { const n = Number(p[k]); if (!Number.isInteger(n) || n < min || n > max) throw new OpsInputError(`${k} must be a whole number ${min}-${max}`); next[k] = n; }
    }
    if ('target' in p) {
      const t = validateTarget(p.target);
      // a masked or missing HTTP password keeps the stored one
      if (t.kind === 'http' && cur.target.kind === 'http' && (t.auth === null || t.auth.includes('•')) && t.url === cur.target.url && p.target && (p.target as Record<string, unknown>).auth !== '') t.auth = cur.target.auth;
      next.target = t;
    }
    this.store.set('backup', next);
    return next;
  }

  // ---- maintenance reminders -----------------------------------------------------

  private async notifyDue() {
    const m = this.store.get().maintenance;
    const s = this.brain.settings.get();
    if (!m.notifyService || !s.homeAssistant.url || !s.homeAssistant.token) return;
    if (config.sim && !config.simAlerts) return;   // SIM: a simulated odometer's reminders stay on screen
    const now = new Date();
    if (now.getHours() < 9 || now.getHours() >= 21) return;
    const today = now.toDateString();
    const due = this.maintenance.statuses(this.mileage.odometerNow(), now).filter((r) => r.state === 'due' && m.notifiedOn[r.id] !== today);
    if (!due.length) return;
    try {
      const res = await fetch(`${s.homeAssistant.url}/api/services/notify/${m.notifyService}`, {
        method: 'POST', headers: { authorization: `Bearer ${s.homeAssistant.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Truck maintenance due', message: due.map((r) => `${r.name}: ${r.why}`).join('\n') }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HA answered ${res.status}`);
      const cur = this.store.get().maintenance;
      this.store.set('maintenance', { ...cur, notifiedOn: { ...cur.notifiedOn, ...Object.fromEntries(due.map((r) => [r.id, today])) } });
    } catch (e) { console.warn('[maint] notify:', (e as Error).message); }
  }

  // ---- AP password ---------------------------------------------------------------

  /** The truck's own Wi-Fi (deploy/pi/network/setup-ap.sh made the slate-ap profile; polkit lets the slate user modify it). */
  setApPassword(pw: unknown): Promise<{ applied: boolean; message: string }> {
    if (typeof pw !== 'string' || pw.length < 8 || pw.length > 63) throw new OpsInputError('Wi-Fi password must be 8 to 63 characters (WPA)');
    if (config.sim || process.platform !== 'linux') return Promise.resolve({ applied: false, message: `Simulated: on the Pi this sets the password of the ${AP_PROFILE} profile.` });
    const run = (args: string[]) => new Promise<void>((res, rej) => execFile('nmcli', args, { timeout: 20_000 }, (e, _o, err) => (e ? rej(new Error((err || e.message).toString().trim())) : res())));
    return run(['connection', 'modify', AP_PROFILE, 'wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', pw])
      .then(() => run(['connection', 'up', AP_PROFILE]).catch(() => {}))
      .then(() => {
        try { unlinkSync(path.join(this.dataDir, 'ap-initial-password')); } catch { /* none */ }
        return { applied: true, message: 'Saved. Devices on slate-truck reconnect with the new password; put it in the truck box\'s ESPHome secrets too (wifi_password).' };
      })
      .catch((e) => { throw new OpsInputError(`Couldn't change the access point: ${(e as Error).message}. Run sudo ./deploy/pi/network/setup-ap.sh --reset instead.`); });
  }

  /** First-boot AP password from the image (deploy/image), shown once on the dash until it's changed. */
  initialApPassword(): string | null {
    try { return readFileSync(path.join(this.dataDir, 'ap-initial-password'), 'utf8').trim() || null; } catch { return null; }
  }

  // ---- Home Assistant ------------------------------------------------------------

  summary(): OpsSummary {
    const odo = this.mileage.odometerNow();
    const st = this.maintenance.statuses(odo);
    const u = this.updater.status();
    return {
      maintenanceDue: st.filter((r) => r.state === 'due').length,
      maintenanceSoon: st.filter((r) => r.state === 'soon').length,
      dueItems: [...st.filter((r) => r.state === 'due'), ...st.filter((r) => r.state === 'soon')].map((r) => r.name),
      lastBackupAt: this.backup.lastSuccessAt, lastBackupOk: this.backup.lastOk,
      backupTarget: this.backup.sentTo,
      updateAvailable: u.phase === 'available' ? u.latest?.tag ?? null : null,
      version: config.version,
      odometerEst: odo,
    };
  }

  private mqttTick() {
    const mq = this.brain.mqtt;
    const up = !!mq?.connected;
    if (up && !this.mqttWasUp) {
      const s = this.brain.settings.get();
      for (const d of opsDiscovery(s.truckId, config.version)) mq!.publish(d.topic, s.homeAssistant.bridge ? JSON.stringify(d.payload) : '', { retain: true, qos: 1 });
      this.lastSummary = '';
    }
    this.mqttWasUp = up;
    this.publishSummary();
  }

  publishSummary() {
    const mq = this.brain.mqtt;
    if (!mq?.connected) return;
    try {
      const j = JSON.stringify(this.summary());
      if (j === this.lastSummary) return;
      if (mq.publish(opsTopic(this.brain.settings.get().truckId), j, { retain: true })) this.lastSummary = j;
    } catch (e) { console.error('[ops] summary', e); }
  }

  about() { return { name: PROJECT_NAME, version: config.version }; }
}
