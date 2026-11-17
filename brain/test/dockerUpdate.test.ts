// The NAS (UPDATES_BY=docker): the footer's "Update available" asks the updater container
// to install now (request.json / status.json in the data volume), and only builds GitHub
// finished making an image for count as available.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { autoUpdateStep, DOCKER_CHECK_MS, DockerRunner, GithubSource, Updater, type Job } from '../src/ops/updater.ts';

const commits = (shas: string[]) => shas.map((sha, i) => ({ sha, commit: { message: `change ${i}`, committer: { date: '2026-11-17T00:00:00Z' } } }));
const fakeFetch = (built: string | null) => (async (url: string) => {
  const body = url.includes('/actions/workflows/') ? { workflow_runs: built ? [{ head_sha: built }] : [] }
    : url.includes('/commits?') ? commits(['c3', 'c2', 'c1']) : url.includes('/compare/') ? { files: [] } : {};
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}) as never;

describe('updates on the NAS (Docker)', () => {
  it('offers the newest commit GitHub has built an image for, not one still building', async () => {
    const src = new GithubSource('test', fakeFetch('c2'));
    const r = await src.list('jraben/truck-assistant', 'main', 'c1', null, { builtOnly: true });
    expect(r[0].sha).toBe('c2');                         // c3 is still building
    expect(r[0].notes).toContain('change 1');
    expect(r[0].notes).not.toContain('change 0');
    expect(await src.list('jraben/truck-assistant', 'main', 'c1', null, { builtOnly: true }).then((x) => x.length)).toBe(1);
    expect(await new GithubSource('t', fakeFetch(null)).list('jraben/truck-assistant', 'main', 'c1', null, { builtOnly: true })).toEqual([]);
    expect((await src.list('jraben/truck-assistant', 'main', 'c1'))[0].sha).toBe('c3');   // the Pi builds from source: the newest commit
  });

  it('hands the install to the updater container and follows its status', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'slate-dock-'));
    const runner = new DockerRunner(dir);
    expect(runner.unavailable()).toBeNull();
    expect(runner.hasPrevious()).toBe(false);
    const u = new Updater({ runner, source: new GithubSource('t', fakeFetch('c2')), builtOnly: true, cfg: () => ({ repo: 'jraben/truck-assistant', channel: 'main' }), installed: () => ({ version: '0.1.0', tag: 'main@c1', sha: 'c1', channel: 'main', installedAt: null }) });
    expect((await u.check()).phase).toBe('available');
    const s = await u.install();
    expect(s.phase).toBe('requested');
    const job = JSON.parse(readFileSync(path.join(dir, 'update', 'request.json'), 'utf8')) as Job;
    expect(job.tag).toBe('main@c2');
    // what auto-update.sh writes back
    writeFileSync(path.join(dir, 'update', 'status.json'), JSON.stringify({ id: job.id, phase: 'restarting', message: 'Restarting', at: new Date().toISOString() }));
    expect(await u.poll()).toBe('restarting');
    writeFileSync(path.join(dir, 'update', 'status.json'), JSON.stringify({ id: job.id, phase: 'done', message: 'Updated', at: new Date().toISOString() }));
    expect(await u.poll()).toBe('done');
  });

  it('checks GitHub every 10 minutes there, so the footer shows a new build soon', () => {
    const base = { now: 1_000_000_000, online: true, driving: false, homeWifi: true, phase: 'up-to-date' as const, latestTag: null, triedTag: null, installNote: null };
    const off = { enabled: false, when: 'parked' as const };
    expect(autoUpdateStep(off, { ...base, lastCheckAt: base.now - DOCKER_CHECK_MS + 1000, checkEveryMs: DOCKER_CHECK_MS }).act).toBeNull();
    expect(autoUpdateStep(off, { ...base, lastCheckAt: base.now - DOCKER_CHECK_MS, checkEveryMs: DOCKER_CHECK_MS }).act).toBe('check');
    expect(autoUpdateStep(off, { ...base, lastCheckAt: base.now - DOCKER_CHECK_MS }).act).toBeNull();   // the Pi: still 12 hours
  });
});
