// Track B settings (media sources and WOPR), in their own file next to
// settings.json: DATA_DIR/media.json, mode 0600, written atomically. Secrets
// (WOPR password, Plex token, Spotify tokens) are masked like the truck's
// keys and never returned in full.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FmPreset, MaskedMediaSettings, MediaSettings, RadioStation, SpotifyToken } from './types.ts';
export type { FmPreset, MaskedMediaSettings, MediaSettings, RadioStation, SpotifyToken } from './types.ts';

/** KJEF (SUB/WAVE on NOMAD) is public at radio.jeffraben.com since 2026-11-03; on the home LAN http://192.168.1.30:7700/stream.mp3 also works. */
export const KJEF_PUBLIC = 'https://radio.jeffraben.com/stream.mp3';
export const KJEF_LAN = 'http://192.168.1.30:7700/stream.mp3';

export function defaultMediaSettings(): MediaSettings {
  return {
    wopr: { url: null, username: 'jeff' },
    spotify: { clientId: null, deviceName: 'Slate Truck', connect: true, bitrate: 160, tokens: {} },
    plex: { url: null },
    radio: { kjefUrl: KJEF_PUBLIC, favourites: {} },
    fm: { presets: [], ppm: 0, gain: null, source: 'auto' },
    local: { folder: null },
    receipts: { autoImport: true },
  };
}

export class MediaSettingsError extends Error {}

const MASK = '•';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const mask = (k: string | undefined) => (k ? MASK.repeat(4) + k.slice(-4) : undefined);
const URL_RE = /^https?:\/\/[^\s/]+/i;

export function maskMedia(s: MediaSettings): MaskedMediaSettings {
  const wopr = { ...s.wopr, password: mask(s.wopr.password) };
  if (!wopr.password) delete wopr.password;
  const plex = { ...s.plex, token: mask(s.plex.token) };
  if (!plex.token) delete plex.token;
  const { tokens, ...sp } = s.spotify;
  return { ...structuredClone(s), wopr, plex, spotify: { ...sp, connected: Object.fromEntries(Object.entries(tokens).map(([k, t]) => [k, { user: t.user }])) } };
}

const secret = (patch: unknown, cur: string | undefined): string | undefined => {
  if (patch === undefined) return cur;
  if (patch === null || patch === '') return undefined;
  if (typeof patch !== 'string') throw new MediaSettingsError('secrets must be text');
  return patch.includes(MASK) ? cur : patch.trim() || undefined;
};

function optUrl(v: unknown, name: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !URL_RE.test(v.trim())) throw new MediaSettingsError(`${name} must start with http:// or https://`);
  return v.trim().replace(/\/+$/, '');
}

export function validStation(v: unknown): RadioStation | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.url !== 'string' || !/^https?:\/\//i.test(v.url)) return null;
  const s = (x: unknown, n = 300) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : null);
  return {
    id: v.id.slice(0, 80), name: v.name.trim().slice(0, 120) || 'Station', url: v.url.trim().slice(0, 1000),
    homepage: s(v.homepage), favicon: s(v.favicon), tags: Array.isArray(v.tags) ? v.tags.filter((t) => typeof t === 'string').slice(0, 12) as string[] : [],
    country: s(v.country, 8), codec: s(v.codec, 16), bitrate: typeof v.bitrate === 'number' && v.bitrate > 0 ? Math.round(v.bitrate) : null, hls: v.hls === true,
  };
}

/** PUT /api/media/settings: partial merge. Tokens and favourites have their own routes and are ignored here. */
export function mergeMedia(base: MediaSettings, patch: unknown): MediaSettings {
  if (!isObj(patch)) throw new MediaSettingsError('body must be a JSON object');
  const n = structuredClone(base);
  if (isObj(patch.wopr)) {
    const w = patch.wopr;
    if ('url' in w) n.wopr.url = optUrl(w.url, 'wopr.url');
    if ('username' in w) {
      if (typeof w.username !== 'string') throw new MediaSettingsError('wopr.username must be text');
      n.wopr.username = w.username.trim().slice(0, 60);
    }
    const pw = secret(w.password, base.wopr.password);
    if (pw) n.wopr.password = pw; else delete n.wopr.password;
  }
  if (isObj(patch.spotify)) {
    const p = patch.spotify;
    if ('clientId' in p) {
      if (p.clientId === null || p.clientId === '') n.spotify.clientId = null;
      else if (typeof p.clientId !== 'string' || !/^[0-9a-f]{32}$/i.test(p.clientId.trim())) throw new MediaSettingsError('spotify.clientId is the 32-character Client ID from developer.spotify.com/dashboard');
      else n.spotify.clientId = p.clientId.trim();
    }
    if ('deviceName' in p) {
      if (typeof p.deviceName !== 'string' || !p.deviceName.trim()) throw new MediaSettingsError('spotify.deviceName is required');
      n.spotify.deviceName = p.deviceName.trim().replace(/[^\w .'-]/g, '').slice(0, 40) || 'Slate Truck';
    }
    if ('connect' in p) n.spotify.connect = p.connect === true;
    if ('bitrate' in p) {
      if (![96, 160, 320].includes(p.bitrate as number)) throw new MediaSettingsError('spotify.bitrate must be 96, 160 or 320');
      n.spotify.bitrate = p.bitrate as 96 | 160 | 320;
    }
  }
  if (isObj(patch.plex)) {
    if ('url' in patch.plex) n.plex.url = optUrl(patch.plex.url, 'plex.url');
    const t = secret(patch.plex.token, base.plex.token);
    if (t) n.plex.token = t; else delete n.plex.token;
  }
  if (isObj(patch.radio) && 'kjefUrl' in patch.radio) {
    n.radio.kjefUrl = optUrl(patch.radio.kjefUrl, 'radio.kjefUrl') ?? KJEF_PUBLIC;
  }
  if (isObj(patch.fm)) {
    const f = patch.fm;
    if ('presets' in f) {
      if (!Array.isArray(f.presets)) throw new MediaSettingsError('fm.presets must be a list');
      n.fm.presets = f.presets.map((x, i) => {
        if (!isObj(x) || typeof x.mhz !== 'number' || !(validFm(x.mhz) || (x.mhz === 0 && typeof x.streamId === 'string'))) throw new MediaSettingsError(`fm.presets[${i}].mhz must be an FM frequency 87.5-108.0 or an AM one 0.53-1.71`);
        const sid = typeof x.streamId === 'string' && /^(tunein:s\d+|rb:[\w-]+)$/.test(x.streamId) ? x.streamId : null;
        return { mhz: Math.round(x.mhz * 100) / 100, name: typeof x.name === 'string' && x.name.trim() ? x.name.trim().slice(0, 40) : fmLabel(x.mhz), streamId: sid };
      }).slice(0, 30);
    }
    if ('source' in f) { if (f.source !== 'auto' && f.source !== 'internet' && f.source !== 'tuner') throw new MediaSettingsError('fm.source is auto, internet or tuner'); n.fm.source = f.source; }
    if ('ppm' in f) { if (typeof f.ppm !== 'number' || Math.abs(f.ppm) > 200) throw new MediaSettingsError('fm.ppm must be -200..200'); n.fm.ppm = Math.round(f.ppm); }
    if ('gain' in f) { if (f.gain !== null && (typeof f.gain !== 'number' || f.gain < 0 || f.gain > 60)) throw new MediaSettingsError('fm.gain is 0-60 dB or null (automatic)'); n.fm.gain = f.gain as number | null; }
  }
  if (isObj(patch.local) && 'folder' in patch.local) {
    const fo = patch.local.folder;
    if (fo === null || fo === '') n.local.folder = null;
    else if (typeof fo !== 'string' || !path.isAbsolute(fo.trim())) throw new MediaSettingsError('local.folder must be an absolute path (or empty for DATA_DIR/music)');
    else n.local.folder = fo.trim();
  }
  if (isObj(patch.receipts) && 'autoImport' in patch.receipts) n.receipts.autoImport = patch.receipts.autoImport === true;
  return n;
}

/** FM 87.5-108 MHz, or AM 530-1710 kHz written in MHz. */
export const validFm = (mhz: number) => Number.isFinite(mhz) && ((mhz >= 87.5 && mhz <= 108) || (mhz >= 0.53 && mhz <= 1.71));
export const fmLabel = (mhz: number) => (mhz < 2 ? `${Math.round(mhz * 1000)} AM` : `${mhz.toFixed(1)} FM`);

function load(raw: unknown): MediaSettings {
  const d = defaultMediaSettings();
  if (!isObj(raw)) return d;
  const r = raw as Partial<MediaSettings>;
  let s: MediaSettings;
  try { s = mergeMedia(d, raw); } catch { s = d; }
  // the parts mergeMedia leaves to their own routes
  if (isObj(r.spotify) && isObj(r.spotify.tokens)) {
    for (const [k, t] of Object.entries(r.spotify.tokens)) if (isObj(t) && typeof t.access === 'string' && typeof t.refresh === 'string') s.spotify.tokens[k] = { access: t.access, refresh: t.refresh, expiresAt: Number(t.expiresAt) || 0, scope: String(t.scope ?? ''), user: typeof t.user === 'string' ? t.user : null };
  }
  if (isObj(r.radio) && isObj(r.radio.favourites)) {
    for (const [k, list] of Object.entries(r.radio.favourites)) if (Array.isArray(list)) s.radio.favourites[k] = list.map(validStation).filter((x): x is RadioStation => !!x);
  }
  return s;
}

export class MediaSettingsStore {
  private file: string;
  private s: MediaSettings;
  private listeners: ((s: MediaSettings, prev: MediaSettings) => void)[] = [];

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'media.json');
    let raw: unknown = null;
    try { raw = JSON.parse(readFileSync(this.file, 'utf8')); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[media] ${this.file} unreadable, using defaults: ${(e as Error).message}`);
    }
    this.s = load(raw);
  }

  get(): MediaSettings { return this.s; }
  update(patch: unknown): MediaSettings { return this.commit(mergeMedia(this.s, patch)); }
  /** For the routes that own tokens and favourites. */
  mutate(f: (s: MediaSettings) => void): MediaSettings { const n = structuredClone(this.s); f(n); return this.commit(n); }
  onChange(l: (s: MediaSettings, prev: MediaSettings) => void) { this.listeners.push(l); }

  private commit(n: MediaSettings): MediaSettings {
    const prev = this.s;
    this.s = n;
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(n, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
    for (const l of this.listeners) { try { l(n, prev); } catch (e) { console.error('[media] settings listener', e); } }
    return n;
  }
}
