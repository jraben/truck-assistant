// PARKED: streaming apps, games and karaoke, only while the truck isn't moving.
//
// Netflix, YouTube TV and the rest refuse to run inside another page, so on
// the Pi each one opens as its own full-screen Chromium window over the
// cockpit (Raspberry Pi OS's Chromium carries the Widevine DRM they need).
// The brain runs as a service with no screen, so it doesn't open windows
// itself: deploy/pi/parked-launcher.sh runs in the kiosk's desktop session,
// asks GET /api/parked/next every second, and opens or closes what it's told.
// The brain closes the window the moment the truck moves.
//
// With no launcher checking in (the NAS copy, a laptop) the page is handed
// the address to open itself.

/** `android`: the app's package on the dash tablet (the real app opens instead of a browser window). */
export type ParkedApp = { id: string; label: string; kind: 'video' | 'games' | 'karaoke'; url: string | null; native?: string; android?: string; note?: string };

export const APPS: ParkedApp[] = [
  { id: 'youtube', label: 'YouTube', kind: 'video', url: 'https://www.youtube.com/tv', android: 'com.google.android.youtube' },
  { id: 'youtubetv', label: 'YouTube TV', kind: 'video', url: 'https://tv.youtube.com/', android: 'com.google.android.apps.youtube.unplugged' },
  { id: 'netflix', label: 'Netflix', kind: 'video', url: 'https://www.netflix.com/browse', android: 'com.netflix.mediaclient' },
  { id: 'prime', label: 'Prime Video', kind: 'video', url: 'https://www.amazon.com/gp/video/storefront', android: 'com.amazon.avod.thirdpartyclient' },
  { id: 'disney', label: 'Disney+', kind: 'video', url: 'https://www.disneyplus.com/home', android: 'com.disney.disneyplus' },
  { id: 'max', label: 'Max', kind: 'video', url: 'https://play.max.com/', android: 'com.wbd.stream' },
  { id: 'hulu', label: 'Hulu', kind: 'video', url: 'https://www.hulu.com/hub/home', android: 'com.hulu.plus' },
  { id: 'peacock', label: 'Peacock', kind: 'video', url: 'https://www.peacocktv.com/watch/home', android: 'com.peacocktv.peacockandroid' },
  { id: 'paramount', label: 'Paramount+', kind: 'video', url: 'https://www.paramountplus.com/home/', android: 'com.cbs.app' },
  { id: 'jeffgames', label: "Jeff's Games", kind: 'games', url: 'https://games.jeffraben.com' },
  { id: 'moonlight', label: 'Moonlight', kind: 'games', url: null, native: 'moonlight-qt', note: 'PC and Steam games streamed from a gaming PC at home (Wi-Fi or Tailscale). Pair it once with the PC.', android: 'com.limelight' },
  { id: 'retroarch', label: 'RetroArch', kind: 'games', url: null, native: 'retroarch', note: 'Classic console games from ROMs you own, with a Bluetooth controller.', android: 'com.retroarch' },
];

/** The YouTube address for a karaoke search. Pure. */
export const karaokeUrl = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q.trim()} karaoke`)}`;

import { intentUrl } from './tablet.ts';

export class ParkedError extends Error {
  status: number;
  constructor(m: string, status = 400) { super(m); this.status = status; }
}

export type LauncherCmd = { seq: number; action: 'open' | 'close'; url?: string; native?: string };
const LAUNCHER_FRESH_MS = 5000;

export class Parked {
  private seq = 0;
  private cmd: LauncherCmd | null = null;
  private current: { id: string; label: string; since: string; android?: boolean } | null = null;
  private launcherAt = 0;
  private natives: string[] = [];

  /** The launcher on the Pi checked in recently: windows can be opened on the truck's screen. */
  onScreen() { return Date.now() - this.launcherAt < LAUNCHER_FRESH_MS; }

  /** android: asked from the dash tablet, where Moonlight/RetroArch are Android apps opened by Tasker. */
  apps(android = false) {
    return APPS.map((a) => ({ ...a, available: a.native ? (android ? !!a.android : this.onScreen() && this.natives.includes(a.native)) : true }));
  }

  status() { return { open: this.current, onScreen: this.onScreen() }; }

  /** Open an app (or a karaoke search). Refused while moving. */
  /**
   * Open an app (or a karaoke search). Refused while moving.
   * android: the request came from the dash tablet. Apps with a web address open
   * as the real Android app through an intent link; Moonlight/RetroArch come back
   * as `tasker` (a package for Tasker to open, see tablet.ts).
   */
  launch(id: string, moving: boolean, extra?: { q?: string; android?: boolean }): { opened: boolean; open?: string; tasker?: string; label: string } {
    if (moving) throw new ParkedError('Parked only: stop the truck first.', 409);
    const app = id === 'karaoke' ? { id, label: 'Karaoke', kind: 'karaoke' as const, url: karaokeUrl(extra?.q ?? '') } as ParkedApp : APPS.find((a) => a.id === id);
    if (!app) throw new ParkedError(`unknown app ${id}`, 404);
    if (id === 'karaoke' && !(extra?.q ?? '').trim()) throw new ParkedError('type a song or artist');
    if (extra?.android) {
      this.current = { id: app.id, label: app.label, since: new Date().toISOString(), android: true };
      if (app.url) return { opened: false, open: app.android ? intentUrl(app.url, app.android) : app.url, label: app.label };
      if (app.android) return { opened: false, tasker: app.android, label: app.label };
    }
    if (!this.onScreen()) {
      if (!app.url) throw new ParkedError(`${app.label} runs on the truck's own screen only.`, 409);
      return { opened: false, open: app.url, label: app.label };
    }
    if (app.native && !this.natives.includes(app.native)) throw new ParkedError(`${app.label} isn't installed on the Pi (sudo apt install ${app.native}).`, 409);
    this.cmd = { seq: ++this.seq, action: 'open', ...(app.native ? { native: app.native } : { url: app.url! }) };
    this.current = { id: app.id, label: app.label, since: new Date().toISOString() };
    return { opened: true, label: app.label };
  }

  close(): boolean {
    if (!this.current) return false;
    if (this.current.android) { this.current = null; this.onAndroidClose?.(); return true; }
    this.cmd = { seq: ++this.seq, action: 'close' };
    this.current = null;
    return true;
  }

  /** The launcher's poll: its installed apps in, the latest command out. */
  next(installed: string[]): LauncherCmd | null {
    this.launcherAt = Date.now();
    this.natives = installed.filter((x) => /^[a-z0-9-]+$/.test(x)).slice(0, 10);
    return this.cmd;
  }

  /** Set by the routes: bring the cockpit back to the front on the tablet (Tasker). */
  onAndroidClose: (() => void) | null = null;

  /** Called on every state tick: anything open closes as soon as the truck moves. */
  guard(moving: boolean) { if (moving && this.current) { console.log('[parked] truck moving: closing', this.current.label); this.close(); } }
}
