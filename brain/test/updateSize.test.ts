import { describe, expect, it } from 'vitest';
import { GithubSource } from '../src/ops/updater.ts';

type Route = Record<string, unknown>;
const fake = (routes: Route) => async (url: string) => {
  const k = Object.keys(routes).find((p) => url.includes(p));
  if (!k) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => routes[k] };
};

describe('update download size', () => {
  it('main: the last source download as the estimate, and whether the package list changed', async () => {
    const gh = new GithubSource('test', fake({
      '/commits?': [{ sha: 'bbbbbbb1', commit: { message: 'New thing', committer: { date: '2026-11-13T22:00:00Z' } } }, { sha: 'aaaaaaa1', commit: { message: 'Old' } }],
      '/compare/aaaaaaa1...bbbbbbb1': { files: [{ filename: 'ui/src/x.ts' }, { filename: 'package-lock.json' }] },
    }));
    const [r] = await gh.list('https://github.com/o/r', 'main', 'aaaaaaa1', 6_100_000);
    expect(r.download).toEqual({ bytes: 6_100_000, exact: false, packagesChanged: true });
    expect(r.notes).toBe('- New thing (bbbbbbb)');
  });
  it('main: packages unchanged, and unknown when GitHub cannot compare', async () => {
    const same = new GithubSource('test', fake({ '/commits?': [{ sha: 'b2', commit: { message: 'x' } }], '/compare/': { files: [{ filename: 'README.md' }] } }));
    expect((await same.list('https://github.com/o/r', 'main', 'a2'))[0].download).toEqual({ bytes: null, exact: false, packagesChanged: false });
    const none = new GithubSource('test', fake({ '/commits?': [{ sha: 'b3', commit: { message: 'x' } }] }));
    expect((await none.list('https://github.com/o/r', 'main', 'a3'))[0].download!.packagesChanged).toBeNull();
    expect((await none.list('https://github.com/o/r', 'main', null))[0].download!.packagesChanged).toBeNull();
  });
  it('stable: the prebuilt bundle size is exact', async () => {
    const gh = new GithubSource('test', fake({ '/releases?': [{ tag_name: 'v1.2.0', name: null, body: 'notes', draft: false, prerelease: false, published_at: null, tarball_url: '', assets: [{ name: 'slate-cockpit-v1.2.0.tar.gz', browser_download_url: 'https://x/a.tgz', size: 48_200_000 }] }] }));
    const [r] = await gh.list('https://github.com/o/r', 'stable', null);
    expect(r.download).toEqual({ bytes: 48_200_000, exact: true, packagesChanged: null });
  });
});
