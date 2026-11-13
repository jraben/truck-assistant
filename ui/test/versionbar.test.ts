import { describe, expect, it } from 'vitest';
import { downloadWords, versionLabel, wifiAdvice } from '../src/components/VersionBar.tsx';
import type { Release } from '../../brain/src/ops/types.ts';

const inst = (o: Partial<{ version: string; tag: string | null; sha: string | null }>) => ({ installed: { version: '0.1.0', tag: null, sha: null, channel: null, installedAt: null, ...o } });
const rel = (download: Release['download']): Release => ({ tag: 'main@abc1234', name: 'main', sha: 'abc', publishedAt: null, notes: '', tarballUrl: '', assetUrl: null, prerelease: true, download });

describe('version bar', () => {
  it('labels the running build', () => {
    expect(versionLabel(inst({ tag: 'main@3d06fb9', sha: '3d06fb9795bb' }))).toBe('TA_v0.1.0+3d06fb9');
    expect(versionLabel(inst({ tag: 'v1.4.2', sha: null }))).toBe('TA_v1.4.2');
    expect(versionLabel(inst({}))).toBe('TA_v0.1.0');
  });
  it('says how big: exact for a release bundle, an estimate for source, more when packages changed', () => {
    expect(downloadWords(rel({ bytes: 48_200_000, exact: true, packagesChanged: null }))).toEqual({ size: '48 MB', big: true });
    expect(downloadWords(rel({ bytes: 6_100_000, exact: false, packagesChanged: false }))).toEqual({ size: 'about 6 MB (packages unchanged)', big: false });
    expect(downloadWords(rel({ bytes: 6_100_000, exact: false, packagesChanged: true })).big).toBe(true);
    expect(downloadWords(rel(undefined)).size).toMatch(/^about 5-10 MB of source/);
  });
  it('says whether to wait for home Wi-Fi', () => {
    expect(wifiAdvice('home', true).ok).toBe(true);
    expect(wifiAdvice('hotspot', true)).toEqual({ text: "Better on home Wi-Fi: this is big for a phone's hotspot data.", ok: false });
    expect(wifiAdvice('hotspot', false).ok).toBe(true);
    expect(wifiAdvice('offline', false).ok).toBe(false);
  });
});
