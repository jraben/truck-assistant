// The dash TABLET (Galaxy Tab S7 FE in Slate's tablet mount) running the
// cockpit in Chrome, with the Pi under the dash as the brain.
//
// What the brain can't do from here, Tasker on the tablet does, triggered by
// its local "HTTP Request" event (deploy/android/README.md):
//   GET http://<tablet>:<port>/slate/front          bring the cockpit back to the front
//   GET http://<tablet>:<port>/slate/launch?pkg=…    open an installed app (Moonlight, RetroArch)
//   GET http://<tablet>:<port>/slate/media?cmd=…     play/pause, next, previous in the music app playing
// and Tasker tells the brain what that app is playing: POST /api/tablet/nowplaying.
// The tablet's address is learned from the cockpit itself (it says hello every
// minute), so nothing has to be typed in. Ignition wake/sleep is Tasker's own
// "power connected / disconnected" profile; on power loss it asks the brain
// how long to wait (GET /api/tablet/sleep, Settings > Truck > "When the truck
// turns off"), and falls back to 2 minutes if the brain doesn't answer.
import { kvGet, kvSet, type Db } from './db.ts';
import type { NowPlaying, TabletSleep } from './types.ts';

/** What Tasker reads when the truck turns off. Flat fields, seconds included, so the task needs no arithmetic. Pure. */
export function sleepPlan(t: TabletSleep) {
  return { minutes: t.minutes, waitSec: t.minutes * 60, never: t.never, keepOn: t.never ? 1 : 0, minBattery: t.minBattery };
}

export type TabletState = { ip: string | null; seenAt: string | null; ua: string | null; taskerPort: number };
const KEY = 'tablet';

/** Android app links: the streaming apps open themselves for their own https address. Pure. */
export function intentUrl(url: string, pkg: string): string {
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=${pkg};S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

/** A private LAN or Tailscale address, the only places a tablet in the truck can be. Pure. */
export const okTabletIp = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(ip.replace(/^::ffff:/, ''));

export const MEDIA_CMDS = ['toggle', 'play', 'pause', 'next', 'prev'] as const;
export type MediaCmd = (typeof MEDIA_CMDS)[number];

/** What a music app on the tablet is playing, as Tasker last said. */
export type TabletMedia = { title: string | null; artist: string | null; album: string | null; app: string | null; pkg: string | null; playing: boolean; at: string };
/** A paused report is forgotten after this; a "playing" one after STALE_MS with no new song (the app was closed). */
export const TABLET_MEDIA_TTL_MS = 30 * 60_000;
export const TABLET_MEDIA_STALE_MS = 15 * 60_000;

/** A Tasker value: unset variables arrive as their own name ("%mt_title"), which means nothing. Pure. */
const val = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return !s || /^%\w+$/.test(s) ? null : s.slice(0, max);
};
const yes = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  const s = val(v)?.toLowerCase();
  if (s == null) return null;
  if (['true', '1', 'yes', 'on', 'playing', 'play'].includes(s)) return true;
  if (['false', '0', 'no', 'off', 'paused', 'pause', 'stopped', 'stop'].includes(s)) return false;
  return null;
};
/** Common Android music apps by package, for a report that names only the package. */
const APP_NAMES: Record<string, string> = {
  'com.pandora.android': 'Pandora', 'com.google.android.apps.youtube.music': 'YouTube Music', 'com.amazon.mp3': 'Amazon Music',
  'com.spotify.music': 'Spotify', 'com.plexapp.android': 'Plex', 'tv.plex.labs.plexamp': 'Plexamp', 'com.google.android.youtube': 'YouTube',
};

/**
 * Tasker's report as TabletMedia. It sends title/artist/album/app/pkg/playing, or one
 * "Artist - Title" line as `track`; null when there's no song at all. Pure.
 */
export function parseTabletMedia(body: unknown, now: Date): TabletMedia | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  let title = val(b.title), artist = val(b.artist);
  const track = val(b.track);
  if (!title && track) {
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(track);
    if (m && !artist) { artist = m[1]; title = m[2]; } else title = track;
  }
  if (!title && !artist) return null;
  const pkg = val(b.pkg, 120);
  const okPkg = pkg && /^[a-zA-Z][\w.]{2,119}$/.test(pkg) ? pkg : null;
  return { title, artist, album: val(b.album), app: val(b.app, 60) ?? (okPkg ? APP_NAMES[okPkg] ?? null : null), pkg: okPkg, playing: yes(b.playing) ?? true, at: now.toISOString() };
}

/** For the now-playing hub: the song while it plays, nothing once paused. Pure. */
export const tabletNowPlaying = (m: TabletMedia | null): NowPlaying | null =>
  m && m.playing ? { title: m.title, artist: m.artist, album: m.album, source: 'tablet' } : null;

export class Tablet {
  private db: Db;
  private media: TabletMedia | null = null;
  constructor(db: Db) { this.db = db; }

  get(): TabletState { return { ip: null, seenAt: null, ua: null, taskerPort: 1821, ...(kvGet<TabletState>(this.db, KEY) ?? {}) }; }

  /** The cockpit on an Android tablet checking in. */
  hello(ip: string, ua: string) {
    const clean = ip.replace(/^::ffff:/, '');
    if (!/Android/i.test(ua) || !okTabletIp(clean)) return this.get();
    const s = { ...this.get(), ip: clean, seenAt: new Date().toISOString(), ua: ua.slice(0, 160) };
    kvSet(this.db, KEY, s);
    return s;
  }

  setPort(port: unknown) {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('port is 1024-65535');
    kvSet(this.db, KEY, { ...this.get(), taskerPort: p });
    return this.get();
  }

  private async tasker(path: string): Promise<{ ok: boolean; error?: string }> {
    const s = this.get();
    if (!s.ip) return { ok: false, error: 'The tablet hasn\'t checked in yet: open the cockpit on it.' };
    try {
      const r = await fetch(`http://${s.ip}:${s.taskerPort}${path}`, { signal: AbortSignal.timeout(3000) });
      return r.ok ? { ok: true } : { ok: false, error: `Tasker on the tablet answered ${r.status}` };
    } catch (e) { return { ok: false, error: `Tasker on the tablet didn't answer (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}): see deploy/android/README.md` }; }
  }

  /** Bring the cockpit back over whatever app is open (the truck started moving). */
  front() { return this.tasker('/slate/front'); }
  /** Play/pause, next, previous in whatever music app plays on the tablet (Tasker's Media Control). */
  mediaCmd(cmd: unknown) {
    if (!(MEDIA_CMDS as readonly unknown[]).includes(cmd)) return Promise.resolve({ ok: false, error: `cmd is one of ${MEDIA_CMDS.join(', ')}` });
    return this.tasker(`/slate/media?cmd=${cmd}`);
  }

  /** Tasker's now-playing report; only from the tablet's own address (it has no login). */
  report(ip: string, body: unknown, now = new Date()): { ok: true; media: TabletMedia | null } | { ok: false; error: string } {
    const s = this.get();
    if (!s.ip || ip.replace(/^::ffff:/, '') !== s.ip) return { ok: false, error: 'only the dash tablet reports here (open the cockpit on it first)' };
    const m = parseTabletMedia(body, now);
    // Just "playing"/"paused" (Tasker's Music Active profile): the last song keeps its card, with the new state.
    const flag = yes((body as Record<string, unknown> | null)?.playing);
    this.media = m ?? (this.media && flag !== null ? { ...this.media, playing: flag, at: now.toISOString() } : null);
    return { ok: true, media: this.media };
  }

  /** What the tablet's music app plays now, or null (nothing, or an old paused report). */
  nowPlaying(now = Date.now()): TabletMedia | null {
    const m = this.media;
    if (m && now - Date.parse(m.at) > (m.playing ? TABLET_MEDIA_STALE_MS : TABLET_MEDIA_TTL_MS)) this.media = null;
    return this.media;
  }

  /** Open an installed Android app by package name. */
  launch(pkg: string) {
    if (!/^[a-zA-Z][\w.]{2,100}$/.test(pkg)) return Promise.resolve({ ok: false, error: 'bad package' });
    return this.tasker(`/slate/launch?pkg=${encodeURIComponent(pkg)}`);
  }

  /**
   * A music app plays behind the cockpit: Tasker opens it, presses Play, and brings
   * the cockpit straight back, so the driver never has to leave it. The app needs a
   * moment to start before Play reaches it (`settleMs`). If Play or the return
   * fails, the cockpit is still asked to come back, and the error says which step.
   */
  async playInBackground(pkg: string, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), settleMs = 3000): Promise<{ ok: boolean; error?: string }> {
    const opened = await this.launch(pkg);
    if (!opened.ok) return opened;
    await wait(settleMs);
    const played = await this.mediaCmd('play');
    await wait(800);
    const back = await this.front();
    if (!played.ok) return { ok: false, error: `The app opened, but Play didn't reach it: ${played.error}` };
    if (!back.ok) return { ok: false, error: `It's playing, but the cockpit didn't come back: ${back.error}` };
    return { ok: true };
  }
}
