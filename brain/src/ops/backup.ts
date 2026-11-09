// Nightly backups when the truck is on home Wi-Fi: a consistent copy of the
// SQLite DB (VACUUM INTO), settings (secrets stripped unless opted in), the
// setup/ops file, the clips index (never videos) and maintenance receipts,
// in one .tar.gz, sent to a mounted share (SMB/NFS), an rsync/SSH target or
// an HTTP PUT. A copy stays in DATA_DIR/backups too.
//
// Restore never swaps the live database under the running brain: the files
// are staged in DATA_DIR/restore-pending and applied at the next start
// (applyPendingRestore, called before the DB opens).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Db } from '../db.ts';
import { PROJECT_NAME } from '../project.ts';
import { OpsInputError, type BackupTarget, type OpsConfig } from './config.ts';
import { readTar, writeTar, type TarEntry } from './tar.ts';
import type { BackupStatus } from './types.ts';
export type { BackupStatus } from './types.ts';

export const NAME_RE = /^slate-backup-([a-z0-9_-]{1,32})-(\d{8}-\d{6})\.tar\.gz$/i;
const pad = (n: number) => String(n).padStart(2, '0');
export const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
export const backupName = (truckId: string, d: Date) => `slate-backup-${truckId.toLowerCase().replace(/[^a-z0-9_-]/g, '')}-${stamp(d)}.tar.gz`;

/** Backups past the newest `keep` (by the stamp in the name). Never all of them. Pure. */
export function toPrune(names: string[], keep: number): string[] {
  const ours = names.filter((n) => NAME_RE.test(n)).sort((a, b) => NAME_RE.exec(b)![2].localeCompare(NAME_RE.exec(a)![2]));
  return ours.slice(Math.max(1, keep));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** settings.json without keys, the HA token or Wi-Fi passwords. Pure. */
export function stripSettingsSecrets(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const s = structuredClone(raw) as Record<string, unknown>;
  s.keys = {};
  if (isObj(s.homeAssistant)) delete s.homeAssistant.token;
  if (isObj(s.homeWifi)) delete s.homeWifi.password;
  if (Array.isArray(s.drivers)) for (const d of s.drivers) if (isObj(d) && isObj(d.hotspot)) delete d.hotspot.password;
  return s;
}

export function stripOpsSecrets(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const o = structuredClone(raw) as Record<string, unknown>;
  if (isObj(o.auth)) o.auth.passwordHash = null;
  if (isObj(o.backup) && isObj(o.backup.target) && o.backup.target.kind === 'http') o.backup.target.auth = null;
  return o;
}

/**
 * A restored settings file that left its secrets behind gets the truck's
 * current ones back (same key, same Wi-Fi network, same driver). Pure.
 */
export function keepCurrentSecrets(restored: unknown, current: unknown): unknown {
  if (!isObj(restored) || !isObj(current)) return restored;
  const r = structuredClone(restored) as Record<string, unknown>;
  const ck = isObj(current.keys) ? current.keys : {};
  r.keys = { ...ck, ...(isObj(r.keys) ? r.keys : {}) };
  if (isObj(r.homeAssistant) && !r.homeAssistant.token && isObj(current.homeAssistant) && current.homeAssistant.token && r.homeAssistant.url === current.homeAssistant.url) r.homeAssistant.token = current.homeAssistant.token;
  if (isObj(r.homeWifi) && !r.homeWifi.password && isObj(current.homeWifi) && current.homeWifi.ssid === r.homeWifi.ssid && current.homeWifi.password) r.homeWifi.password = current.homeWifi.password;
  if (Array.isArray(r.drivers) && Array.isArray(current.drivers)) {
    for (const d of r.drivers) {
      if (!isObj(d) || !isObj(d.hotspot) || d.hotspot.password) continue;
      const c = (current.drivers as unknown[]).find((x) => isObj(x) && x.id === d.id) as Record<string, unknown> | undefined;
      if (c && isObj(c.hotspot) && c.hotspot.ssid === d.hotspot.ssid && c.hotspot.password) d.hotspot.password = c.hotspot.password;
    }
  }
  return r;
}

export type Manifest = { project: string; version: string; truckId: string; createdAt: string; includesSecrets: boolean; files: { name: string; size: number; sha256: string }[] };
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const readJson = (f: string): unknown => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/** The clips index Track C keeps (JSON next to the clips), never the videos. */
function clipsIndex(dataDir: string): TarEntry[] {
  const out: TarEntry[] = [];
  for (const f of ['clips.json', 'clips-index.json']) if (existsSync(path.join(dataDir, f))) out.push({ name: f, data: readFileSync(path.join(dataDir, f)) });
  const dir = path.join(dataDir, 'clips');
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/\.json$/i.test(f) && /^[\w.-]+$/.test(f) && statSync(path.join(dir, f)).size < 20e6) out.push({ name: `clips/${f}`, data: readFileSync(path.join(dir, f)) });
  return out;
}

/** Build one backup file in DATA_DIR/backups. */
export function makeBackup(db: Db, dataDir: string, o: { truckId: string; version: string; includeSecrets: boolean; now?: Date }): { name: string; file: string; size: number; manifest: Manifest } {
  const now = o.now ?? new Date();
  const dir = path.join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const name = backupName(o.truckId, now);
  const tmpDb = path.join(dir, `.vacuum-${process.pid}-${Date.now()}.db`);
  try { unlinkSync(tmpDb); } catch { /* none */ }
  db.exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);
  const entries: TarEntry[] = [];
  try {
    entries.push({ name: 'cockpit.db', data: readFileSync(tmpDb) });
  } finally { try { unlinkSync(tmpDb); } catch { /* gone */ } }
  const settings = readJson(path.join(dataDir, 'settings.json'));
  if (settings) entries.push({ name: 'settings.json', data: Buffer.from(JSON.stringify(o.includeSecrets ? settings : stripSettingsSecrets(settings), null, 2)) });
  const ops = readJson(path.join(dataDir, 'ops.json'));
  if (ops) entries.push({ name: 'ops.json', data: Buffer.from(JSON.stringify(o.includeSecrets ? ops : stripOpsSecrets(ops), null, 2)) });
  entries.push(...clipsIndex(dataDir));
  const rdir = path.join(dataDir, 'receipts');
  if (existsSync(rdir)) for (const f of readdirSync(rdir)) if (/^[\w.-]+$/.test(f)) entries.push({ name: `receipts/${f}`, data: readFileSync(path.join(rdir, f)) });
  const pdir = path.join(dataDir, 'driver-photos');
  if (existsSync(pdir)) for (const f of readdirSync(pdir)) if (/^[a-z0-9-]+\.(jpg|png|webp)$/.test(f)) entries.push({ name: `driver-photos/${f}`, data: readFileSync(path.join(pdir, f)) });
  const manifest: Manifest = { project: PROJECT_NAME, version: o.version, truckId: o.truckId, createdAt: now.toISOString(), includesSecrets: o.includeSecrets, files: entries.map((e) => ({ name: e.name, size: e.data.length, sha256: sha256(e.data) })) };
  const gz = gzipSync(writeTar([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...entries]));
  const file = path.join(dir, name);
  writeFileSync(file + '.tmp', gz, { mode: 0o600 });
  renameSync(file + '.tmp', file);
  return { name, file, size: gz.length, manifest };
}

/** Open and check a backup: the manifest and every file's sha256. */
export function openBackup(gz: Buffer): { manifest: Manifest; entries: TarEntry[] } {
  let entries: TarEntry[];
  try { entries = readTar(gunzipSync(gz)); } catch (e) { throw new OpsInputError(`not a readable backup: ${(e as Error).message}`); }
  const m = entries.find((e) => e.name === 'manifest.json');
  if (!m) throw new OpsInputError('not a backup: no manifest.json');
  const manifest = JSON.parse(m.data.toString('utf8')) as Manifest;
  for (const f of manifest.files) {
    const e = entries.find((x) => x.name === f.name);
    if (!e || sha256(e.data) !== f.sha256) throw new OpsInputError(`backup damaged: ${f.name} doesn't match its checksum`);
  }
  if (!entries.some((e) => e.name === 'cockpit.db')) throw new OpsInputError('backup has no database');
  return { manifest, entries: entries.filter((e) => e.name !== 'manifest.json') };
}

const PENDING = 'restore-pending';

/** Stage a restore; it is applied when the brain next starts. */
export function stageRestore(dataDir: string, gz: Buffer): Manifest {
  const { manifest, entries } = openBackup(gz);
  const dir = path.join(dataDir, PENDING);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const e of entries) {
    if (!/^(cockpit\.db|settings\.json|ops\.json|clips(-index)?\.json|clips\/[\w.-]+\.json|receipts\/[\w.-]+)$/.test(e.name)) continue;
    let data = e.data;
    if (e.name === 'settings.json') data = Buffer.from(JSON.stringify(keepCurrentSecrets(JSON.parse(data.toString('utf8')), readJson(path.join(dataDir, 'settings.json'))), null, 2));
    if (e.name === 'ops.json') {
      const r = JSON.parse(data.toString('utf8')) as Record<string, Record<string, unknown>>;
      const cur = readJson(path.join(dataDir, 'ops.json')) as Record<string, Record<string, unknown>> | null;
      // The truck's current password and backup target win: restoring must not lock you out or point backups elsewhere.
      if (cur?.auth) r.auth = { ...(r.auth ?? {}), passwordHash: r.auth?.passwordHash ?? cur.auth.passwordHash };
      if (cur?.backup) r.backup = cur.backup;
      data = Buffer.from(JSON.stringify(r, null, 2));
    }
    mkdirSync(path.dirname(path.join(dir, e.name)), { recursive: true });
    writeFileSync(path.join(dir, e.name), data, { mode: 0o600 });
  }
  writeFileSync(path.join(dir, 'READY'), JSON.stringify({ stagedAt: new Date().toISOString(), from: manifest.createdAt }));
  return manifest;
}

/** At start-up, before the DB opens: swap a staged restore in. The old DB is kept beside it. */
export function applyPendingRestore(dataDir: string): boolean {
  const dir = path.join(dataDir, PENDING);
  if (!existsSync(path.join(dir, 'READY'))) return false;
  const keep = path.join(dataDir, 'backups', `before-restore-${stamp(new Date())}`);
  mkdirSync(keep, { recursive: true });
  for (const f of ['cockpit.db', 'cockpit.db-wal', 'cockpit.db-shm', 'settings.json', 'ops.json']) {
    const p = path.join(dataDir, f);
    if (existsSync(p)) renameSync(p, path.join(keep, f));
  }
  const walk = (rel: string) => {
    for (const f of readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${f}` : f;
      if (r === 'READY') continue;
      if (statSync(path.join(dir, r)).isDirectory()) { mkdirSync(path.join(dataDir, r), { recursive: true }); walk(r); }
      else copyFileSync(path.join(dir, r), path.join(dataDir, r));
    }
  };
  walk('');
  rmSync(dir, { recursive: true, force: true });
  console.log(`[backup] restored a backup; the previous data is in ${keep}`);
  return true;
}

// ---- targets -------------------------------------------------------------------

export type Exec = (cmd: string, args: string[], timeoutMs?: number) => Promise<{ stdout: string }>;
export const realExec: Exec = (cmd, args, timeoutMs = 300_000) => new Promise((res, rej) => {
  execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (e, stdout, stderr) => (e ? rej(new Error(`${cmd}: ${(stderr || e.message).toString().trim().split('\n').slice(-2).join(' ')}`)) : res({ stdout: stdout.toString() })));
});

export interface Target {
  send(file: string, name: string): Promise<void>;
  list(): Promise<string[] | null>;           // null = this target can't list
  remove(name: string): Promise<void>;
  fetch(name: string): Promise<Buffer>;
}

const RSYNC_DEST = /^([\w.-]+@)?[\w.-]+:([\w./~-]+)$/;
const SAFE_NAME = (n: string) => { if (!NAME_RE.test(n)) throw new OpsInputError('not a backup name'); return n; };

export function validateTarget(t: unknown): BackupTarget {
  if (!isObj(t)) throw new OpsInputError('target must be an object');
  if (t.kind === 'none') return { kind: 'none' };
  if (t.kind === 'path') {
    const p = typeof t.path === 'string' ? t.path.trim() : '';
    if (!p || !path.isAbsolute(p) || p.includes('..')) throw new OpsInputError('path must be an absolute folder, e.g. /mnt/nas/slate-backups (the SMB share mounted there)');
    return { kind: 'path', path: p };
  }
  if (t.kind === 'rsync') {
    const dest = typeof t.dest === 'string' ? t.dest.trim().replace(/\/+$/, '') : '';
    if (!RSYNC_DEST.test(dest)) throw new OpsInputError('rsync destination looks like backup@nas.local:/volume1/backups/slate');
    const key = t.sshKey === null || t.sshKey === undefined || t.sshKey === '' ? null : String(t.sshKey).trim();
    if (key !== null && (!path.isAbsolute(key) || key.includes('..'))) throw new OpsInputError('sshKey must be an absolute path to a private key on the Pi');
    const port = t.port === undefined || t.port === null || t.port === '' ? 22 : Number(t.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new OpsInputError('port must be 1-65535');
    return { kind: 'rsync', dest, sshKey: key, port };
  }
  if (t.kind === 'http') {
    const url = typeof t.url === 'string' ? t.url.trim().replace(/\/+$/, '') : '';
    if (!/^https?:\/\/\S+$/i.test(url)) throw new OpsInputError('url must start with http:// or https://');
    const auth = t.auth === undefined || t.auth === null || t.auth === '' ? null : String(t.auth);
    return { kind: 'http', url, auth };
  }
  throw new OpsInputError('target kind is none, path, rsync or http');
}

export function makeTarget(t: BackupTarget, exec: Exec = realExec, fetchFn: typeof fetch = fetch, tmpDir = '/tmp'): Target | null {
  if (t.kind === 'none') return null;
  if (t.kind === 'path') {
    const dir = t.path;
    const ready = () => { if (!existsSync(dir)) throw new Error(`${dir} isn't there: is the NAS share mounted?`); };
    return {
      async send(file, name) { ready(); copyFileSync(file, path.join(dir, `${name}.part`)); renameSync(path.join(dir, `${name}.part`), path.join(dir, name)); },
      async list() { ready(); return readdirSync(dir).filter((n) => NAME_RE.test(n)); },
      async remove(name) { unlinkSync(path.join(dir, SAFE_NAME(name))); },
      async fetch(name) { ready(); return readFileSync(path.join(dir, SAFE_NAME(name))); },
    };
  }
  if (t.kind === 'rsync') {
    const m = RSYNC_DEST.exec(t.dest)!;
    const host = t.dest.slice(0, t.dest.lastIndexOf(':'));
    const rdir = m[2];
    const ssh = ['-p', String(t.port), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', ...(t.sshKey ? ['-i', t.sshKey] : [])];
    const sshCmd = ['ssh', ...ssh].join(' ');
    return {
      async send(file, name) { await exec('rsync', ['-t', '--timeout=120', '-e', sshCmd, file, `${host}:${rdir}/${SAFE_NAME(name)}`]); },
      async list() { const r = await exec('ssh', [...ssh, host, 'ls', '-1', '--', rdir], 60_000); return r.stdout.split('\n').map((s) => s.trim()).filter((n) => NAME_RE.test(n)); },
      async remove(name) { await exec('ssh', [...ssh, host, 'rm', '-f', '--', `${rdir}/${SAFE_NAME(name)}`], 60_000); },
      async fetch(name) {
        const local = path.join(tmpDir, `fetch-${SAFE_NAME(name)}`);
        await exec('rsync', ['-t', '--timeout=120', '-e', sshCmd, `${host}:${rdir}/${name}`, local]);
        try { return readFileSync(local); } finally { try { unlinkSync(local); } catch { /* gone */ } }
      },
    };
  }
  const headers = (): Record<string, string> => (t.auth ? { authorization: `Basic ${Buffer.from(t.auth).toString('base64')}` } : {});
  return {
    async send(file, name) {
      const res = await fetchFn(`${t.url}/${encodeURIComponent(name)}`, { method: 'PUT', headers: { ...headers(), 'content-type': 'application/gzip' }, body: readFileSync(file), signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`upload answered ${res.status}`);
    },
    async list() { return null; },
    async remove() { /* the server keeps its own retention */ },
    async fetch(name) {
      const res = await fetchFn(`${t.url}/${encodeURIComponent(SAFE_NAME(name))}`, { headers: headers(), signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`download answered ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

export const EMPTY_STATUS: BackupStatus = { running: false, lastAt: null, lastOk: null, lastError: null, lastName: null, lastSize: null, lastSuccessAt: null, sentTo: null };

export function targetLabel(t: BackupTarget): string {
  if (t.kind === 'path') return t.path;
  if (t.kind === 'rsync') return t.dest;
  if (t.kind === 'http') return t.url;
  return 'this truck only';
}

/** Is a nightly run due now? On home Wi-Fi, not driving, past the hour, nothing good today. Pure. */
export function backupDue(cfg: OpsConfig['backup'], st: BackupStatus, now: Date, onHomeWifi: boolean, driving: boolean): boolean {
  if (!cfg.enabled || st.running || !onHomeWifi || driving) return false;
  if (now.getHours() < cfg.hour) return false;
  const last = st.lastSuccessAt ? new Date(st.lastSuccessAt) : null;
  if (last && last.toDateString() === now.toDateString()) return false;
  // after a failure, wait an hour before trying again
  if (st.lastOk === false && st.lastAt && now.getTime() - Date.parse(st.lastAt) < 3_600_000) return false;
  return true;
}
