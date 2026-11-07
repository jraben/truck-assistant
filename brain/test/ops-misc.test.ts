import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { addMonths, dueStatus, keepTpms, mergeReminders } from '../src/ops/maintenance.ts';
import { defaultReminders, type Reminder } from '../src/ops/config.ts';
import { hashPassword, isLocal, needsAuth, RateLimiter, verifyPassword } from '../src/ops/auth.ts';
import { applyPendingRestore, backupDue, EMPTY_STATUS, keepCurrentSecrets, makeBackup, openBackup, stageRestore, stripSettingsSecrets, toPrune } from '../src/ops/backup.ts';
import { readTar, writeTar } from '../src/ops/tar.ts';
import { compareVersions, isNewer, parseRepo, Updater, PICKUP_TIMEOUT_MS, type Job, type Report, type Runner } from '../src/ops/updater.ts';
import { openDb } from '../src/db.ts';
import { defaultOps } from '../src/ops/config.ts';

const rem = (p: Partial<Reminder>): Reminder => ({ id: 'x', name: 'X', everyMiles: null, everyMonths: null, note: '', lastDone: null, since: { at: '2026-01-01T12:00:00.000Z', odometer: 1000 }, ...p });

describe('maintenance due logic', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  it('no interval = unset, says to set it from the manual', () => {
    const s = dueStatus(defaultReminders()[0], 5000, now);
    expect(s.state).toBe('unset');
    expect(s.why).toMatch(/owner's manual/);
  });
  it('by miles: ok, soon, due', () => {
    expect(dueStatus(rem({ everyMiles: 7500 }), 2000, now)).toMatchObject({ state: 'ok', milesLeft: 6500, dueAtMiles: 8500 });
    expect(dueStatus(rem({ everyMiles: 7500 }), 7900, now)).toMatchObject({ state: 'soon', milesLeft: 600 }); // 10% of 7500 = 750
    expect(dueStatus(rem({ everyMiles: 7500 }), 8600, now)).toMatchObject({ state: 'due', milesLeft: -100 });
  });
  it('by months, from the last time it was done', () => {
    expect(dueStatus(rem({ everyMonths: 6 }), null, now).state).toBe('soon'); // due 2026-07-01, 30 days away
    expect(dueStatus(rem({ everyMonths: 3 }), null, now).state).toBe('due');
    expect(dueStatus(rem({ everyMonths: 3, lastDone: { at: '2026-05-01T12:00:00Z', odometer: null } }), null, now).state).toBe('ok');
  });
  it('whichever comes first', () => {
    expect(dueStatus(rem({ everyMiles: 10000, everyMonths: 24 }), 11500, now).state).toBe('due');
  });
  it('miles with no odometer reading', () => {
    expect(dueStatus(rem({ everyMiles: 5000 }), null, now).state).toBe('needs-odometer');
    expect(dueStatus(rem({ everyMiles: 5000, since: { at: now.toISOString(), odometer: null } }), 3000, now).state).toBe('needs-odometer');
  });
  it('addMonths clamps to the end of the month', () => {
    expect(addMonths(new Date(2026, 0, 31, 12).toISOString(), 1).getDate()).toBe(28);
  });
  it('setting an interval starts the count now; history is kept', () => {
    const now2 = new Date('2026-08-01T00:00:00Z');
    const cur = defaultReminders(new Date('2026-01-01T00:00:00Z'));
    const next = mergeReminders(cur, [{ id: 'tire-rotation', name: 'Tire rotation', everyMiles: 7500 }, { name: 'Coolant check', everyMonths: 12 }], 4200, now2);
    expect(next[0].since).toEqual({ at: now2.toISOString(), odometer: 4200 });
    expect(next[1].id).toBe('coolant-check');
    expect(() => mergeReminders(cur, [{ name: '' }], null)).toThrow();
    expect(() => mergeReminders(cur, [{ name: 'A', everyMiles: -5 }], null)).toThrow();
  });
  it('TPMS thinning keeps changes and a periodic sample', () => {
    expect(keepTpms(undefined, 35, 0)).toBe(true);
    expect(keepTpms({ t: 0, psi: 35 }, 35.2, 60_000)).toBe(false);
    expect(keepTpms({ t: 0, psi: 35 }, 34.4, 60_000)).toBe(true);
    expect(keepTpms({ t: 0, psi: 35 }, 35, 11 * 60_000)).toBe(true);
    expect(keepTpms({ t: 0, psi: 35 }, null, 11 * 60_000)).toBe(false);
  });
});

describe('passwords and login', () => {
  const fast = { N: 1 << 10, r: 8, p: 1, keylen: 32 };
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('correct horse', fast);
    expect(h).toMatch(/^scrypt\$1024\$8\$1\$/);
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong horse', h)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', 'md5$abc')).toBe(false);
    expect(await hashPassword('correct horse', fast)).not.toBe(h); // salted
  });
  it('rate limit: locks after 5 failures in the window, clears on success', () => {
    const r = new RateLimiter(5, 15 * 60_000, 15 * 60_000);
    for (let i = 0; i < 4; i++) r.fail('1.2.3.4', 1000 + i);
    expect(r.blockedFor('1.2.3.4', 2000)).toBe(0);
    r.fail('1.2.3.4', 2000);
    expect(r.blockedFor('1.2.3.4', 2001)).toBeGreaterThan(14 * 60_000);
    expect(r.blockedFor('5.6.7.8', 2001)).toBe(0);
    expect(r.blockedFor('1.2.3.4', 2000 + 15 * 60_000 + 1)).toBe(0);
    r.fail('9.9.9.9', 0); r.fail('9.9.9.9', 16 * 60_000); // outside the window: not 2 in a row
    for (let i = 0; i < 3; i++) r.fail('9.9.9.9', 16 * 60_000 + i);
    expect(r.blockedFor('9.9.9.9', 16 * 60_000 + 5)).toBe(0);
    r.ok('9.9.9.9');
  });
  it('gates settings, truck and the API, not the cockpit or health', () => {
    expect(needsAuth('GET', '/settings')).toBe('page');
    expect(needsAuth('GET', '/truck?x=1')).toBe('page');
    expect(needsAuth('PUT', '/api/settings')).toBe('api');
    expect(needsAuth('GET', '/ws')).toBe('api');
    expect(needsAuth('GET', '/api/health')).toBeNull();
    expect(needsAuth('POST', '/api/auth/login')).toBeNull();
    expect(needsAuth('GET', '/')).toBeNull();
    expect(needsAuth('GET', '/assets/index.js')).toBeNull();
    expect(isLocal('127.0.0.1')).toBe(true);
    expect(isLocal('10.42.0.23')).toBe(false);
  });
});

describe('backups', () => {
  it('tar round-trips', () => {
    const t = writeTar([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'dir/b.bin', data: Buffer.alloc(1000, 7) }]);
    expect(t.length % 512).toBe(0);
    const r = readTar(t);
    expect(r.map((e) => e.name)).toEqual(['a.txt', 'dir/b.bin']);
    expect(r[0].data.toString()).toBe('hello');
    expect(r[1].data.length).toBe(1000);
    expect(() => writeTar([{ name: '../evil', data: Buffer.alloc(1) }])).toThrow();
  });
  it('retention keeps the newest N and never deletes the last one', () => {
    const names = ['slate-backup-slate-20261101-020000.tar.gz', 'slate-backup-slate-20261103-020000.tar.gz', 'slate-backup-slate-20261102-020000.tar.gz', 'notes.txt'];
    expect(toPrune(names, 2)).toEqual(['slate-backup-slate-20261101-020000.tar.gz']);
    expect(toPrune(names, 0)).toHaveLength(2);
    expect(toPrune(names, 10)).toEqual([]);
  });
  it('strips secrets by default and puts the current ones back on restore', () => {
    const s = { keys: { afdc: 'K' }, homeAssistant: { url: 'http://ha', token: 'T' }, homeWifi: { ssid: 'home', password: 'P' }, drivers: [{ id: 'jeff', hotspot: { ssid: 'jp', password: 'H' } }] };
    const stripped = stripSettingsSecrets(s) as typeof s;
    expect(JSON.stringify(stripped)).not.toMatch(/"(K|T|P|H)"/);
    const back = keepCurrentSecrets(stripped, s) as typeof s;
    expect(back.keys.afdc).toBe('K');
    expect(back.homeAssistant.token).toBe('T');
    expect(back.homeWifi.password).toBe('P');
    expect(back.drivers[0].hotspot.password).toBe('H');
  });
  it('makes a consistent copy, checks it, stages and applies a restore', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bk-'));
    const db = openDb(dir);
    db.exec("INSERT INTO kv (k, v) VALUES ('marker', '\"before\"')");
    writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ truckId: 'slate', keys: { afdc: 'SECRET' } }));
    mkdirSync(path.join(dir, 'clips')); writeFileSync(path.join(dir, 'clips', 'index.json'), '[]'); writeFileSync(path.join(dir, 'clips', 'a.mp4'), 'video');
    const b = makeBackup(db, dir, { truckId: 'slate', version: '0.1.0', includeSecrets: false, now: new Date(2026, 10, 5, 2, 0, 0) });
    expect(b.name).toBe('slate-backup-slate-20261105-020000.tar.gz');
    const gz = readFileSync(b.file);
    const { manifest, entries } = openBackup(gz);
    expect(manifest.includesSecrets).toBe(false);
    expect(entries.map((e) => e.name).sort()).toEqual(['clips/index.json', 'cockpit.db', 'settings.json']);
    expect(entries.find((e) => e.name === 'settings.json')!.data.toString()).not.toContain('SECRET');
    // tamper -> refused
    // flip a byte inside settings.json's data (found via its 512-aligned tar header), not a fixed offset that
    // shifts with the manifest's length (e.g. when PROJECT_NAME changes)
    const tar = gunzipSync(gz);
    let hdr = -1;
    for (let i = tar.indexOf('settings.json'); i >= 0; i = tar.indexOf('settings.json', i + 1)) if (i % 512 === 0) { hdr = i; break; }
    expect(hdr).toBeGreaterThanOrEqual(0);
    tar[hdr + 512 + 2] ^= 1;
    expect(() => openBackup(gzipSync(tar))).toThrow();
    // change the live db, then restore the backup
    db.exec("UPDATE kv SET v = '\"after\"' WHERE k = 'marker'");
    stageRestore(dir, gz);
    db.close();
    expect(applyPendingRestore(dir)).toBe(true);
    const db2 = openDb(dir);
    expect((db2.prepare("SELECT v FROM kv WHERE k = 'marker'").get() as { v: string }).v).toBe('"before"');
    expect(JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8')).keys.afdc).toBe('SECRET'); // current secret kept
    expect(existsSync(path.join(dir, 'restore-pending'))).toBe(false);
    expect(applyPendingRestore(dir)).toBe(false);
    db2.close();
  });
  it('runs nightly only on home Wi-Fi, parked, after the hour, once a day', () => {
    const cfg = { ...defaultOps().backup, enabled: true, hour: 2 };
    const at = new Date(2026, 10, 5, 3, 0);
    expect(backupDue(cfg, EMPTY_STATUS, at, true, false)).toBe(true);
    expect(backupDue(cfg, EMPTY_STATUS, at, false, false)).toBe(false);
    expect(backupDue(cfg, EMPTY_STATUS, at, true, true)).toBe(false);
    expect(backupDue(cfg, EMPTY_STATUS, new Date(2026, 10, 5, 1, 0), true, false)).toBe(false);
    expect(backupDue(cfg, { ...EMPTY_STATUS, lastSuccessAt: new Date(2026, 10, 5, 2, 30).toISOString() }, at, true, false)).toBe(false);
    expect(backupDue({ ...cfg, enabled: false }, EMPTY_STATUS, at, true, false)).toBe(false);
  });
});

describe('updater', () => {
  it('compares versions and parses repos', () => {
    expect(compareVersions('v1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('v1.0.0-rc1', 'v1.0.0')).toBe(-1);
    expect(compareVersions('0.1.0', 'v0.1.0')).toBe(0);
    expect(parseRepo('https://github.com/jraben/slate-cockpit.git')).toEqual({ owner: 'jraben', repo: 'slate-cockpit' });
    expect(parseRepo('nope')).toBeNull();
    expect(isNewer({ tag: 'v0.2.0' } as never, { version: '0.1.0', tag: null, sha: null, channel: null, installedAt: null }, 'stable')).toBe(true);
    expect(isNewer({ tag: 'main@abc', sha: 'abc' } as never, { version: '0.1.0', tag: null, sha: 'abc', channel: 'main', installedAt: null }, 'main')).toBe(false);
  });

  class FakeRunner implements Runner {
    jobs: Job[] = []; rep: Report | null = null; prev = true; why: string | null = null;
    unavailable() { return this.why; }
    async request(j: Job) { this.jobs.push(j); }
    async report() { return this.rep; }
    hasPrevious() { return this.prev; }
  }
  const releases = [{ tag: 'v0.2.0', name: 'v0.2.0', sha: null, publishedAt: null, notes: 'New stuff', tarballUrl: 't', assetUrl: 'a', prerelease: false }];
  const make = (runner: FakeRunner, clock: { t: number }, saved: unknown[] = []) => new Updater({
    runner, source: { list: async () => releases }, cfg: () => ({ repo: 'https://github.com/jraben/slate-cockpit', channel: 'stable' }),
    installed: () => ({ version: '0.1.0', tag: 'v0.1.0', sha: null, channel: 'stable', installedAt: null }),
    save: (j) => saved.push(j), now: () => clock.t,
  });

  it('check -> install -> runner phases -> done', async () => {
    const r = new FakeRunner(); const clock = { t: 1_000_000 }; const saved: unknown[] = [];
    const u = make(r, clock, saved);
    expect((await u.check()).phase).toBe('available');
    await u.install();
    expect(u.phase).toBe('requested');
    expect(r.jobs[0]).toMatchObject({ action: 'install', tag: 'v0.2.0', assetUrl: 'a' });
    await expect(u.install()).rejects.toThrow(/already running/);
    const id = r.jobs[0].id;
    r.rep = { id, phase: 'building', message: 'npm ci', at: new Date(clock.t).toISOString() };
    expect(await u.poll()).toBe('building');
    r.rep = { id, phase: 'verifying', message: 'health check', at: new Date(clock.t).toISOString() };
    expect(await u.poll()).toBe('verifying');
    r.rep = { id, phase: 'done', message: 'v0.2.0 running', at: new Date(clock.t).toISOString() };
    expect(await u.poll()).toBe('done');
    expect(u.busy()).toBe(false);
    expect(saved.length).toBeGreaterThan(3);
  });
  it('reports a rollback after a failed health check, and ignores reports for other jobs', async () => {
    const r = new FakeRunner(); const clock = { t: 0 };
    const u = make(r, clock);
    await u.check(); await u.install('v0.2.0');
    r.rep = { id: 'someone-else', phase: 'done', message: '', at: new Date(0).toISOString() };
    expect(await u.poll()).toBe('requested');
    r.rep = { id: r.jobs[0].id, phase: 'rolled-back', message: 'health check failed; back on v0.1.0', at: new Date(0).toISOString() };
    expect(await u.poll()).toBe('rolled-back');
    expect(u.status().message).toMatch(/back on/);
  });
  it('times out when the updater service never answers', async () => {
    const r = new FakeRunner(); const clock = { t: 0 };
    const u = make(r, clock);
    await u.check(); await u.install();
    clock.t = PICKUP_TIMEOUT_MS + 1;
    expect(await u.poll()).toBe('failed');
  });
  it('refuses to install on a desk, and to roll back with nothing kept', async () => {
    const r = new FakeRunner(); r.why = 'not on the Pi';
    const u = make(r, { t: 0 });
    await u.check();
    expect(u.status().canInstall).toBe(false);
    await expect(u.install()).rejects.toThrow(/not on the Pi/);
    r.why = null; r.prev = false;
    await expect(u.rollback()).rejects.toThrow(/No previous/);
    r.prev = true;
    expect((await u.rollback()).phase).toBe('requested');
    expect(r.jobs.at(-1)?.action).toBe('rollback');
  });
});
