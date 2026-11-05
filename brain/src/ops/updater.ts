// Software updates from GitHub. The brain checks releases (stable channel:
// tags/releases) or the main branch, shows the changelog, and hands an
// install or rollback to the updater service on the Pi
// (deploy/pi/updater/: a systemd path unit runs update.sh as the slate user,
// which fetches, builds, switches /opt/slate-cockpit-releases/current, restarts
// the brain through one sudoers rule, health-checks, and rolls back by itself
// if /api/health doesn't come back on the new version). The brain can't do the
// install itself: it would be restarting the process doing the work.
//
// Request/status files in DATA_DIR/update/ are the whole interface.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OpsInputError } from './config.ts';

export type Release = {
  tag: string; name: string; sha: string | null;
  publishedAt: string | null; notes: string;
  tarballUrl: string;                 // source tarball
  assetUrl: string | null;            // prebuilt slate-cockpit-<tag>.tar.gz from the release workflow
  prerelease: boolean;
};

export type Installed = { version: string; tag: string | null; sha: string | null; channel: string | null; installedAt: string | null };

export type Phase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'requested' | 'downloading' | 'building' | 'restarting' | 'verifying' | 'done' | 'rolled-back' | 'failed';
export const BUSY: Phase[] = ['requested', 'downloading', 'building', 'restarting', 'verifying'];

export type Job = { id: string; action: 'install' | 'rollback'; tag: string | null; sha: string | null; repo: string; channel: 'stable' | 'main'; assetUrl: string | null; tarballUrl: string | null; requestedAt: string };
export type Report = { id: string; phase: Exclude<Phase, 'idle' | 'checking' | 'up-to-date' | 'available' | 'requested'>; message: string; at: string; tag?: string | null; previous?: string | null };

export interface Runner {
  /** null when installs can run here; otherwise why not. */
  unavailable(): string | null;
  request(job: Job): Promise<void>;
  report(): Promise<Report | null>;
  /** Is there a previous release to go back to? */
  hasPrevious(): boolean;
}

export type UpdateStatus = {
  phase: Phase; message: string | null;
  repo: string | null; channel: 'stable' | 'main';
  installed: Installed;
  latest: Release | null; releases: Release[];
  checkedAt: string | null;
  job: Job | null;
  canInstall: boolean; installNote: string | null;
  canRollback: boolean;
};

/** "v1.2.3" vs "1.2.10": -1, 0, 1. Non-numeric parts compare as text; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) => v.trim().replace(/^v/i, '').split(/[-+]/);
  const [ma, pa] = norm(a), [mb, pb] = norm(b);
  const xa = ma.split('.'), xb = mb.split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    const na = Number(xa[i] ?? 0), nb = Number(xb[i] ?? 0);
    if (Number.isFinite(na) && Number.isFinite(nb)) { if (na !== nb) return na < nb ? -1 : 1; }
    else { const c = String(xa[i] ?? '').localeCompare(String(xb[i] ?? '')); if (c) return c < 0 ? -1 : 1; }
  }
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  return pa && pb ? Math.sign(pa.localeCompare(pb)) : 0;
}

export function parseRepo(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null;
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim()) ?? /^([\w.-]+)\/([\w.-]+)$/.exec(url.trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Is `latest` newer than what's installed? Pure. */
export function isNewer(latest: Release | null, inst: Installed, channel: 'stable' | 'main'): boolean {
  if (!latest) return false;
  if (channel === 'main') return !!latest.sha && latest.sha !== inst.sha;
  if (inst.tag && latest.tag === inst.tag) return false;
  return compareVersions(latest.tag, inst.tag ?? inst.version) > 0;
}

type FetchFn = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** GitHub's REST API, read-only, no token (60 requests/hour is plenty for a truck). */
export class GithubSource {
  private fetchFn: FetchFn;
  private ua: string;
  constructor(ua: string, fetchFn: FetchFn = fetch as unknown as FetchFn) { this.ua = ua; this.fetchFn = fetchFn; }

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetchFn(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': this.ua }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) throw new OpsInputError('GitHub has no such repository (or it is private)');
    if (res.status === 403 || res.status === 429) throw new OpsInputError('GitHub rate limit reached; try again in an hour');
    if (!res.ok) throw new OpsInputError(`GitHub answered ${res.status}`);
    return (await res.json()) as T;
  }

  async list(repoUrl: string, channel: 'stable' | 'main', installedSha: string | null): Promise<Release[]> {
    const r = parseRepo(repoUrl);
    if (!r) throw new OpsInputError('repo must look like https://github.com/owner/name');
    const base = `https://api.github.com/repos/${r.owner}/${r.repo}`;
    if (channel === 'main') {
      const commits = await this.get<{ sha: string; commit: { message: string; committer?: { date?: string } } }[]>(`${base}/commits?sha=main&per_page=30`);
      if (!commits.length) return [];
      const since: string[] = [];
      for (const c of commits) { if (c.sha === installedSha) break; since.push(`- ${c.commit.message.split('\n')[0]} (${c.sha.slice(0, 7)})`); }
      const top = commits[0];
      return [{ tag: `main@${top.sha.slice(0, 7)}`, name: 'main', sha: top.sha, publishedAt: top.commit.committer?.date ?? null, notes: since.join('\n') || 'No new commits.', tarballUrl: `https://github.com/${r.owner}/${r.repo}/archive/${top.sha}.tar.gz`, assetUrl: null, prerelease: true }];
    }
    type GhRelease = { tag_name: string; name: string | null; body: string | null; draft: boolean; prerelease: boolean; published_at: string | null; tarball_url: string; assets: { name: string; browser_download_url: string }[] };
    const rel = await this.get<GhRelease[]>(`${base}/releases?per_page=15`);
    const out: Release[] = rel.filter((x) => !x.draft && !x.prerelease).map((x) => ({
      tag: x.tag_name, name: x.name || x.tag_name, sha: null, publishedAt: x.published_at, notes: x.body ?? '',
      tarballUrl: `https://github.com/${r.owner}/${r.repo}/archive/refs/tags/${x.tag_name}.tar.gz`,
      assetUrl: x.assets.find((a) => a.name === `slate-cockpit-${x.tag_name}.tar.gz`)?.browser_download_url ?? null,
      prerelease: false,
    }));
    if (out.length) return out.sort((a, b) => compareVersions(b.tag, a.tag));
    // No releases yet: plain version tags.
    const tags = await this.get<{ name: string; commit: { sha: string } }[]>(`${base}/tags?per_page=30`);
    return tags.filter((t) => /^v?\d+\.\d+/.test(t.name)).map((t) => ({ tag: t.name, name: t.name, sha: t.commit.sha, publishedAt: null, notes: '(tag without release notes)', tarballUrl: `https://github.com/${r.owner}/${r.repo}/archive/refs/tags/${t.name}.tar.gz`, assetUrl: null, prerelease: false })).sort((a, b) => compareVersions(b.tag, a.tag));
  }
}

/** The installed release, from release.json the updater (or the release tarball) writes beside brain/. */
export function readInstalled(appRoot: string, version: string): Installed {
  try {
    const j = JSON.parse(readFileSync(path.join(appRoot, 'release.json'), 'utf8')) as Partial<Installed>;
    return { version, tag: j.tag ?? null, sha: j.sha ?? null, channel: j.channel ?? null, installedAt: j.installedAt ?? null };
  } catch { return { version, tag: null, sha: null, channel: null, installedAt: null }; }
}

/** The Pi: request.json is picked up by slate-updater.path; update.sh writes status.json. */
export class SystemdRunner implements Runner {
  readonly dir: string;
  private releasesDir: string;
  private installed: boolean;
  constructor(dataDir: string, releasesDir = '/opt/slate-cockpit-releases', installed = existsSync('/etc/systemd/system/slate-updater.path')) {
    this.dir = path.join(dataDir, 'update'); this.releasesDir = releasesDir; this.installed = installed;
  }
  unavailable() { return this.installed ? null : 'Installing runs on the Pi with the updater service (sudo ./deploy/pi/updater/setup.sh). This brain can check for updates only.'; }
  async request(job: Job) {
    mkdirSync(this.dir, { recursive: true });
    const f = path.join(this.dir, 'request.json');
    writeFileSync(f + '.tmp', JSON.stringify(job, null, 2));
    renameSync(f + '.tmp', f);
  }
  async report(): Promise<Report | null> {
    try { return JSON.parse(readFileSync(path.join(this.dir, 'status.json'), 'utf8')) as Report; } catch { return null; }
  }
  hasPrevious() { return existsSync(path.join(this.releasesDir, 'previous')); }
}

/** Give up on a request the updater service never picked up. */
export const PICKUP_TIMEOUT_MS = 2 * 60_000;
/** A run that stops reporting (crashed mid-build) is failed after this. */
export const STALL_MS = 30 * 60_000;

export class Updater {
  private runner: Runner;
  private source: Pick<GithubSource, 'list'>;
  private cfg: () => { repo: string | null; channel: 'stable' | 'main' };
  private installed: () => Installed;
  private save: (j: { job: Job | null; phase: Phase; message: string | null }) => void;
  private s: { phase: Phase; message: string | null; latest: Release | null; releases: Release[]; checkedAt: string | null; job: Job | null };
  private now: () => number;

  constructor(o: {
    runner: Runner; source: Pick<GithubSource, 'list'>;
    cfg: () => { repo: string | null; channel: 'stable' | 'main' };
    installed: () => Installed;
    saved?: { job: Job | null; phase: Phase; message: string | null } | null;
    save?: (j: { job: Job | null; phase: Phase; message: string | null }) => void;
    now?: () => number;
  }) {
    this.runner = o.runner; this.source = o.source; this.cfg = o.cfg; this.installed = o.installed;
    this.save = o.save ?? (() => {}); this.now = o.now ?? Date.now;
    this.s = { phase: o.saved?.phase ?? 'idle', message: o.saved?.message ?? null, latest: null, releases: [], checkedAt: null, job: o.saved?.job ?? null };
  }

  get phase() { return this.s.phase; }
  busy() { return BUSY.includes(this.s.phase); }

  private set(phase: Phase, message: string | null = null) {
    this.s.phase = phase; this.s.message = message;
    this.save({ job: this.s.job, phase, message });
  }

  status(): UpdateStatus {
    const c = this.cfg();
    const why = this.runner.unavailable();
    return {
      phase: this.s.phase, message: this.s.message, repo: c.repo, channel: c.channel,
      installed: this.installed(), latest: this.s.latest, releases: this.s.releases, checkedAt: this.s.checkedAt, job: this.s.job,
      canInstall: !why && !this.busy() && !!c.repo, installNote: why,
      canRollback: !why && !this.busy() && this.runner.hasPrevious(),
    };
  }

  async check(): Promise<UpdateStatus> {
    if (this.busy()) return this.status();
    const c = this.cfg();
    if (!c.repo) { this.set('idle', 'Set the GitHub repository first'); return this.status(); }
    this.set('checking');
    try {
      const inst = this.installed();
      const rel = await this.source.list(c.repo, c.channel, inst.sha);
      this.s.releases = rel; this.s.latest = rel[0] ?? null; this.s.checkedAt = new Date(this.now()).toISOString();
      if (!this.s.latest) this.set('up-to-date', c.channel === 'stable' ? 'No releases published yet' : 'No commits on main');
      else if (isNewer(this.s.latest, inst, c.channel)) this.set('available', `${this.s.latest.tag} is available`);
      else this.set('up-to-date', `${inst.tag ?? `v${inst.version}`} is the latest`);
    } catch (e) { this.set('failed', `Check failed: ${(e as Error).message}`); }
    return this.status();
  }

  async install(tag?: string): Promise<UpdateStatus> {
    const c = this.cfg();
    const why = this.runner.unavailable();
    if (why) throw new OpsInputError(why);
    if (this.busy()) throw new OpsInputError('An update is already running');
    if (!c.repo) throw new OpsInputError('Set the GitHub repository first');
    const rel = tag ? this.s.releases.find((r) => r.tag === tag) : this.s.latest;
    if (!rel) throw new OpsInputError(tag ? `${tag} isn't in the list: check for updates first` : 'Check for updates first');
    this.s.job = { id: `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, action: 'install', tag: rel.tag, sha: rel.sha, repo: c.repo, channel: c.channel, assetUrl: rel.assetUrl, tarballUrl: rel.tarballUrl, requestedAt: new Date(this.now()).toISOString() };
    await this.runner.request(this.s.job);
    this.set('requested', `Installing ${rel.tag}`);
    return this.status();
  }

  async rollback(): Promise<UpdateStatus> {
    const why = this.runner.unavailable();
    if (why) throw new OpsInputError(why);
    if (this.busy()) throw new OpsInputError('An update is already running');
    if (!this.runner.hasPrevious()) throw new OpsInputError('No previous version kept to go back to');
    const c = this.cfg();
    this.s.job = { id: `${this.now().toString(36)}-rb`, action: 'rollback', tag: null, sha: null, repo: c.repo ?? '', channel: c.channel, assetUrl: null, tarballUrl: null, requestedAt: new Date(this.now()).toISOString() };
    await this.runner.request(this.s.job);
    this.set('requested', 'Going back to the previous version');
    return this.status();
  }

  /** Follow the updater service's progress. Called every few seconds while busy, and once at start-up. */
  async poll(): Promise<Phase> {
    const job = this.s.job;
    if (!job || !this.busy()) return this.s.phase;
    const r = await this.runner.report();
    const age = this.now() - Date.parse(job.requestedAt);
    if (!r || r.id !== job.id) {
      if (this.s.phase === 'requested' && age > PICKUP_TIMEOUT_MS) this.set('failed', 'The updater service never picked up the request (is slate-updater.path enabled on the Pi?)');
      return this.s.phase;
    }
    if (r.phase !== this.s.phase || r.message !== this.s.message) this.set(r.phase, r.message);
    else if (this.busy() && this.now() - Date.parse(r.at) > STALL_MS) this.set('failed', `The updater stopped reporting during "${r.phase}"; the running version is unchanged unless it says otherwise`);
    return this.s.phase;
  }
}
