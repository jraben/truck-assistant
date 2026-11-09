// HD Radio (NRSC-5): the digital side of an FM station, including its HD2-HD4
// sub-channels, song titles and album art. Two ways to hear it:
//
//  - the truck's own RTL-SDR dongle, decoded by nrsc5 (github.com/theori-io/nrsc5,
//    built by deploy/pi/install.sh): `nrsc5 -t raw -o - <MHz> <program>` writes
//    16-bit 44.1 kHz stereo PCM that ffmpeg turns into MP3, as for analog FM;
//  - an nrsc5-webplayer somewhere else (github.com/wryandginger/nrsc5-webplayer,
//    MIT): a small Flask app with its own dongle, e.g. at home. The brain asks it
//    to tune (/tune_manual), relays its /stream.mp3 and reads /status, so the
//    cockpit never talks to it directly (no mixed content, one origin).
//
// Programs are 0-3 in nrsc5 and HD1-HD4 on the dial; this file uses HD numbers
// (1-4) everywhere outside nrsc5's own arguments.
import type { Readable } from 'node:stream';

export const HD_MAX = 4;
export const validHd = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= HD_MAX;

/**
 * nrsc5's arguments for an FM frequency and HD channel: raw PCM to stdout.
 * No --dump-aas-files: nrsc5 writes those files under names the BROADCAST
 * chooses, unchecked (its help says "WARNING: insecure"), so a hostile
 * transmitter could write outside the folder. Album art comes only from a
 * webplayer, which takes that risk on its own box.
 */
export function nrsc5Args(mhz: number, hd: number, o: { ppm: number; gain: number | null }): string[] {
  const a = ['-t', 'raw', '-o', '-'];
  if (o.ppm) a.push('-p', String(o.ppm));
  if (o.gain !== null) a.push('-g', String(o.gain));
  a.push(mhz.toFixed(1), String(hd - 1));
  return a;
}

/** nrsc5's raw output: signed 16-bit little-endian, 44.1 kHz, stereo. */
export const HD_FFMPEG_ARGS = ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0', '-f', 'mp3', '-b:a', '128k', '-flush_packets', '1', 'pipe:1'];

export type HdProgram = { hd: number; type: string | null };
export type HdNow = {
  via: 'tuner' | 'server';
  mhz: number; hd: number;
  synced: boolean;
  station: string | null; slogan: string | null;
  title: string | null; artist: string | null; album: string | null; genre: string | null;
  programs: HdProgram[];
  /** URL of the current album art (served by the brain), or null. */
  art: string | null;
  merDb: number | null; kbps: number | null;
  alert: string | null;
  since: string;
};

/** What nrsc5's log has said so far about one tune. */
export type HdLog = Omit<HdNow, 'via' | 'art' | 'since'>;

export function newHdLog(mhz: number, hd: number): HdLog {
  return { mhz, hd, synced: false, station: null, slogan: null, title: null, artist: null, album: null, genre: null, programs: [], merDb: null, kbps: null, alert: null };
}

// nrsc5's own log lines (src/main.c, v3.x). ID3 lines are already filtered to the program being decoded.
// Each line starts "HH:MM:SS " (src/log.c).
const STRIP = /^\s*(?:\d{2}:\d{2}:\d{2}\s+)?/;
const AAS_NAME = /^[\w.@-]{1,120}$/;

/**
 * Feed one log line into the state. Pure apart from mutating `s`. Returns true
 * when something a listener sees changed (title, station, programs...).
 */
export function readHdLine(s: HdLog, raw: string): boolean {
  const line = raw.replace(STRIP, '').trim();
  let m: RegExpExecArray | null;
  const set = <K extends keyof HdLog>(k: K, v: HdLog[K]) => { if (s[k] === v) return false; s[k] = v; return true; };
  if (line === 'Synchronized') return set('synced', true);
  if (line === 'Lost synchronization') return set('synced', false);
  if ((m = /^Title: (.*)$/.exec(line))) return set('title', m[1].trim() || null);
  if ((m = /^Artist: (.*)$/.exec(line))) return set('artist', m[1].trim() || null);
  if ((m = /^Album: (.*)$/.exec(line))) return set('album', m[1].trim() || null);
  if ((m = /^Genre: (.*)$/.exec(line))) return set('genre', m[1].trim() || null);
  if ((m = /^Station name: (.*)$/.exec(line))) return set('station', m[1].trim() || null);
  if ((m = /^Slogan: (.*)$/.exec(line))) return set('slogan', m[1].trim() || null);
  if ((m = /^MER: (-?[\d.]+) dB \(lower\), (-?[\d.]+) dB \(upper\)/.exec(line))) { s.merDb = Math.round(Math.max(Number(m[1]), Number(m[2])) * 10) / 10; return false; }
  if ((m = /^Audio bit rate: ([\d.]+) kbps/.exec(line))) { s.kbps = Math.round(Number(m[1])); return false; }
  if ((m = /^Alert: (.*)$/.exec(line))) return set('alert', m[1].trim().slice(0, 300) || null);
  if ((m = /^Audio program (\d+): \w+, type: ([^,]+)/.exec(line))) {
    const hd = Number(m[1]) + 1, type = m[2].trim() || null;
    if (!validHd(hd)) return false;
    const have = s.programs.find((p) => p.hd === hd);
    if (have && have.type === type) return false;
    s.programs = [...s.programs.filter((p) => p.hd !== hd), { hd, type }].sort((a, b) => a.hd - b.hd);
    return true;
  }
  return false;
}

// ---- nrsc5-webplayer (remote) ------------------------------------------------------

/** "http://host:7430" (no trailing slash), or null when it isn't an http(s) URL. */
export function serverBase(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}

/** The webplayer's /status JSON -> HdNow (art proxied through the brain). Pure. */
export function mapServerStatus(j: unknown, tuned: { mhz: number; hd: number } | null, since: string): HdNow | null {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const str = (k: string) => { const v = o[k]; if (typeof v !== 'string') return null; const t = v.trim(); return t && !/^Unknown (Title|Artist|Genre)$|^Loading\.\.\.$|^Tuning receiver\.\.\.$/.test(t) ? t : null; };
  if (!tuned || o.running === false) return null;
  const art = typeof o.art_url === 'string' && /^\/aas\/[\w.@-]+(\?t=\d+)?$/.test(o.art_url) ? `/api/media/fm/hd/server-art?f=${encodeURIComponent(o.art_url.slice(5).replace(/\?.*$/, ''))}` : null;
  const mer = /(-?[\d.]+)/.exec(String(o.mer ?? '')), kb = /([\d.]+)/.exec(String(o.bitrate ?? ''));
  const title = str('title');
  return {
    via: 'server', mhz: tuned.mhz, hd: tuned.hd, synced: !!title || !!str('artist'),
    station: null, slogan: str('slogan'), title, artist: str('artist'), album: str('album'), genre: str('genre'),
    programs: [], art, merDb: mer ? Number(mer[1]) : null, kbps: kb ? Math.round(Number(kb[1])) : null, alert: null, since,
  };
}

export class HdServerError extends Error {
  status: number;
  constructor(msg: string, status = 502) { super(msg); this.status = status; }
}

/** A remote nrsc5-webplayer: tune it, relay its stream, read what it's playing. */
export class HdServer {
  private f: typeof fetch;
  private tuned: { mhz: number; hd: number } | null = null;
  private since = new Date().toISOString();
  private base: () => string | null;
  constructor(base: () => string | null, fetchFn: typeof fetch = fetch) { this.base = base; this.f = fetchFn; }

  configured() { return !!this.base(); }
  current() { return this.tuned; }

  private url(p: string) {
    const b = this.base();
    if (!b) throw new HdServerError('No HD Radio server set: add its address in Settings → Media.', 503);
    return b + p;
  }

  /** Is it there? Its /stream_status answers quickly whether or not it's playing. */
  async reachable(timeoutMs = 2500): Promise<boolean> {
    if (!this.base()) return false;
    try { const r = await this.f(this.url('/stream_status'), { signal: AbortSignal.timeout(timeoutMs) }); return r.ok; } catch { return false; }
  }

  async tune(mhz: number, hd: number): Promise<void> {
    const r = await this.f(this.url(`/tune_manual?freq=${mhz.toFixed(1)}&program=${hd - 1}`), { signal: AbortSignal.timeout(15_000) })
      .catch((e: Error) => { throw new HdServerError(`HD Radio server not reachable (${e.message})`, 502); });
    if (!r.ok) {
      let msg = `HD Radio server answered ${r.status}`;
      try { const j = await r.json() as { message?: unknown }; if (typeof j.message === 'string') msg = `HD Radio server: ${j.message.slice(0, 160)}`; } catch { /* not JSON */ }
      throw new HdServerError(msg, r.status === 400 ? 400 : 502);
    }
    this.tuned = { mhz, hd };
    this.since = new Date().toISOString();
  }

  /** Tune (unless already there) and return its audio stream (MP3 from the webplayer) and type. */
  async stream(mhz: number, hd: number): Promise<{ body: Readable; type: string }> {
    const t = this.tuned;
    let live = false;
    if (t && t.mhz === mhz && t.hd === hd) {
      try { const s = await this.f(this.url('/stream_status'), { signal: AbortSignal.timeout(3000) }); live = s.ok && !!((await s.json()) as { active?: boolean }).active; } catch { /* retune */ }
    }
    if (!live) await this.tune(mhz, hd);
    // nrsc5 needs a few seconds to lock on; the webplayer answers 503 until ffmpeg is running.
    for (let i = 0; i < 12; i++) {
      const r = await this.f(this.url('/stream.mp3')).catch(() => null);
      if (r?.ok && r.body) {
        const { Readable } = await import('node:stream');
        const type = r.headers.get('content-type') ?? '';
        return { body: Readable.fromWeb(r.body as import('node:stream/web').ReadableStream), type: /^audio\/[\w.+-]+$/.test(type) ? type : 'audio/mpeg' };
      }
      try { await r?.body?.cancel(); } catch { /* nothing to drop */ }
      await new Promise((res) => setTimeout(res, 500));
    }
    throw new HdServerError('The HD Radio server tuned but sent no audio: weak signal, or no HD on that channel?', 504);
  }

  async stop(): Promise<void> {
    this.tuned = null;
    try { await this.f(this.url('/stop'), { signal: AbortSignal.timeout(5000) }); } catch { /* gone already */ }
  }

  async now(): Promise<HdNow | null> {
    if (!this.tuned) return null;
    const r = await this.f(this.url('/status'), { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new HdServerError(`HD Radio server answered ${r.status}`);
    return mapServerStatus(await r.json(), this.tuned, this.since);
  }

  /** One AAS file (album art) from the webplayer; the name is checked, never a path. */
  async art(name: string): Promise<Response> {
    if (!AAS_NAME.test(name) || name.startsWith('.')) throw new HdServerError('bad file name', 400);
    return this.f(this.url(`/aas/${encodeURIComponent(name)}`), { signal: AbortSignal.timeout(10_000) });
  }
}
