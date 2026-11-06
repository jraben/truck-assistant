// AM/FM without a tuner: the local stations' own internet streams.
//
// The dial is built from TuneIn's "local radio" list for where the truck is
// (opml.radiotime.com, no key; frequencies come with it), with Radio Browser's
// stations within ~120 km filling frequencies TuneIn doesn't have. A station is
// resolved to a playable URL only when it is played (TuneIn's URLs carry a
// short-lived token). Some big chains (iHeart) keep their stations off TuneIn;
// "Find" searches TuneIn and Radio Browser by call sign or name for those.
import type { RadioStation } from './types.ts';

export type AirStation = {
  id: string;                    // "tunein:s31621" | "rb:<uuid>"
  mhz: number;                   // FM MHz, or AM as MHz (0.62 = 620 AM)
  band: 'FM' | 'AM';
  hd: string | null;             // "HD2" for an HD sub-channel
  name: string;                  // "KBACH 89.5 FM (Classical)"
  slogan: string | null;
  image: string | null;
  url: string | null;            // Radio Browser: the stream; TuneIn: null until resolved
};

const TUNEIN = 'https://opml.radiotime.com';
const RB = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];
const LIST_TTL_MS = 12 * 3600_000;
const URL_TTL_MS = 20 * 60_000;

const FM_RE = /(?<![\d.])(8[7-9]|9\d|10[0-7])\.([1-9])(?!\d)/;
const AM_RE = /(?<!\d)(5[3-9]0|[6-9]\d0|1[0-6]\d0|1700)(?!\d)/;

/** The frequency in a station's name or tags ("KJZZ 91.5", "970 KVWM", "En Familia 740 AM"). Pure. */
export function freqFrom(text: string): { mhz: number; band: 'FM' | 'AM' } | null {
  const f = FM_RE.exec(text);
  if (f) return { mhz: Number(`${f[1]}.${f[2]}`), band: 'FM' };
  const a = AM_RE.exec(text);
  if (a && (/\bAM\b|kHz/i.test(text) || /^\s*\d{3,4}\b/.test(text) || /\b\d{3,4}\s+K[A-Z]{3}\b/.test(text))) return { mhz: Number(a[1]) / 1000, band: 'AM' };
  return null;
}

/**
 * TuneIn local list -> stations. Its "text" is "<freq> | <name>", where the
 * frequency is sometimes cut to whole MHz ("89 | KBACH 89.5 FM"), so the full
 * one is read from the name when it can be. Pure.
 */
export function parseTuneInLocal(json: unknown): AirStation[] {
  const out: AirStation[] = [];
  const body = (json as { body?: unknown[] } | null)?.body;
  if (!Array.isArray(body)) return out;
  for (const group of body as { text?: string; children?: unknown[] }[]) {
    const band = group.text === 'FM' ? 'FM' : group.text === 'AM' ? 'AM' : null;
    if (!band || !Array.isArray(group.children)) continue;
    for (const c of group.children as Record<string, string>[]) {
      if (c.type !== 'audio' || !c.guide_id || typeof c.text !== 'string') continue;
      const [tok, ...rest] = c.text.split(' | ');
      const name = (rest.join(' | ') || tok).trim();
      const hd = /HD(\d)/i.exec(tok)?.[0].toUpperCase() ?? null;
      const head = Number(tok.replace(/HD\d/i, '').trim());
      let mhz: number | null = null;
      if (band === 'AM') mhz = Number.isFinite(head) && head >= 530 && head <= 1710 ? head / 1000 : null;
      else if (/^\d+\.\d$/.test(tok.replace(/HD\d/i, '').trim())) mhz = head;
      else {
        const f = freqFrom(name);
        mhz = f && f.band === 'FM' && Math.floor(f.mhz) === head ? f.mhz : null;
      }
      if (mhz === null) continue;
      out.push({ id: `tunein:${c.guide_id}`, mhz, band, hd, name, slogan: c.subtext || null, image: c.image || null, url: null });
    }
  }
  return out;
}

/** Radio Browser rows -> stations that name a frequency. Pure. */
export function parseRbStations(json: unknown): AirStation[] {
  if (!Array.isArray(json)) return [];
  const out: AirStation[] = [];
  for (const r of json as Record<string, string>[]) {
    const url = r.url_resolved || r.url;
    if (!r.stationuuid || !url || !r.name) continue;
    const f = freqFrom(`${r.name}`) ?? freqFrom(`${r.name} ${r.tags ?? ''}`);
    if (!f) continue;
    out.push({ id: `rb:${r.stationuuid}`, mhz: f.mhz, band: f.band, hd: /HD\d/i.exec(r.name)?.[0].toUpperCase() ?? null, name: r.name.trim(), slogan: null, image: r.favicon || null, url });
  }
  return out;
}

/** One list for the dial: TuneIn first, Radio Browser only for frequencies TuneIn lacks; main channels before HD ones. Pure. */
export function mergeDial(tunein: AirStation[], rb: AirStation[]): AirStation[] {
  const key = (s: AirStation) => `${s.mhz.toFixed(2)}|${s.hd ?? ''}`;
  const seen = new Set(tunein.map(key));
  const all = [...tunein, ...rb.filter((s) => !seen.has(key(s)) && (seen.add(key(s)), true))];
  return all.sort((a, b) => (a.band === b.band ? 0 : a.band === 'FM' ? -1 : 1) || a.mhz - b.mhz || (a.hd ?? '').localeCompare(b.hd ?? ''));
}

/** The best stream from TuneIn's Tune.ashx answer: MP3 first (plays in every browser), then AAC. Pure. */
export function pickTuneInStream(json: unknown): string | null {
  const body = (json as { body?: { url?: string; media_type?: string; reliability?: number }[] } | null)?.body;
  if (!Array.isArray(body)) return null;
  const ok = body.filter((b) => typeof b.url === 'string' && /^https?:/.test(b.url) && !/\.m3u8|\.pls|\.m3u(\?|$)/i.test(b.url));
  const rank = (b: { media_type?: string }) => (b.media_type === 'mp3' ? 0 : b.media_type === 'aac' ? 1 : 2);
  return ok.sort((a, b) => rank(a) - rank(b) || (b.reliability ?? 0) - (a.reliability ?? 0))[0]?.url ?? null;
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class AirStreams {
  private ua: string;
  private fetchFn: Fetch;
  private lists = new Map<string, { at: number; list: AirStation[] }>();
  private urls = new Map<string, { at: number; url: string }>();
  private known = new Map<string, AirStation>();

  constructor(version: string, fetchFn: Fetch = fetch as unknown as Fetch) {
    this.ua = `slate-cockpit/${version}`;
    this.fetchFn = fetchFn;
  }

  private async json(url: string): Promise<unknown> {
    const res = await this.fetchFn(url, { headers: { 'user-agent': this.ua, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return res.json();
  }

  private async rb(path: string): Promise<unknown> {
    let last: Error | null = null;
    for (const h of RB) { try { return await this.json(`https://${h}${path}`); } catch (e) { last = e as Error; } }
    throw last ?? new Error('Radio Browser not reachable');
  }

  private remember(list: AirStation[]) { for (const s of list) this.known.set(s.id, s); return list; }

  /** The local dial around a position (cached per ~25 km square for 12 hours). */
  async dial(pos: { lat: number; lon: number }): Promise<AirStation[]> {
    const cell = `${(Math.round(pos.lat * 4) / 4).toFixed(2)},${(Math.round(pos.lon * 4) / 4).toFixed(2)}`;
    const c = this.lists.get(cell);
    if (c && Date.now() - c.at < LIST_TTL_MS) return c.list;
    const ll = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
    const [ti, rb] = await Promise.allSettled([
      this.json(`${TUNEIN}/Browse.ashx?c=local&render=json&latlon=${ll}`).then(parseTuneInLocal),
      this.rb(`/json/stations/search?geo_lat=${pos.lat.toFixed(4)}&geo_long=${pos.lon.toFixed(4)}&geo_distance=120000&hidebroken=true&limit=300`).then(parseRbStations),
    ]);
    if (ti.status === 'rejected' && rb.status === 'rejected') throw new Error(`station list not reachable (TuneIn ${ti.reason.message})`);
    const list = this.remember(mergeDial(ti.status === 'fulfilled' ? ti.value : [], rb.status === 'fulfilled' ? rb.value : []));
    this.lists.set(cell, { at: Date.now(), list });
    return list;
  }

  /** By call sign or name, for stations missing from the local list. */
  async find(q: string): Promise<AirStation[]> {
    const [ti, rb] = await Promise.allSettled([
      this.json(`${TUNEIN}/Search.ashx?render=json&types=station&query=${encodeURIComponent(q.slice(0, 60))}`),
      this.rb(`/json/stations/search?name=${encodeURIComponent(q.slice(0, 60))}&countrycode=US&hidebroken=true&limit=20&order=clickcount&reverse=true`),
    ]);
    const out: AirStation[] = [];
    if (ti.status === 'fulfilled') {
      for (const c of ((ti.value as { body?: Record<string, string>[] }).body ?? [])) {
        if (c.type !== 'audio' || !c.guide_id || !c.text) continue;
        const f = freqFrom(`${c.text} ${c.subtext ?? ''}`);
        out.push({ id: `tunein:${c.guide_id}`, mhz: f?.mhz ?? 0, band: f?.band ?? 'FM', hd: null, name: c.text, slogan: c.subtext || null, image: c.image || null, url: null });
      }
    }
    if (rb.status === 'fulfilled') {
      for (const r of rb.value as Record<string, string>[]) {
        const url = r.url_resolved || r.url;
        if (!r.stationuuid || !url) continue;
        const f = freqFrom(`${r.name} ${r.tags ?? ''}`);
        out.push({ id: `rb:${r.stationuuid}`, mhz: f?.mhz ?? 0, band: f?.band ?? 'FM', hd: null, name: r.name, slogan: r.state || null, image: r.favicon || null, url });
      }
    }
    return this.remember(out.slice(0, 30));
  }

  /** Accept a station the UI saved in a preset (so it plays after a restart without a fresh list). */
  learn(s: AirStation) { if (/^(tunein:s\d+|rb:[\w-]+)$/.test(s.id)) this.known.set(s.id, s); }

  station(id: string): AirStation | null { return this.known.get(id) ?? null; }

  /** A playable station for RadioService.open(). */
  async playable(id: string): Promise<RadioStation> {
    const s = this.known.get(id);
    let url: string | null = s?.url ?? null;
    if (id.startsWith('tunein:')) {
      const c = this.urls.get(id);
      if (c && Date.now() - c.at < URL_TTL_MS) url = c.url;
      else {
        url = pickTuneInStream(await this.json(`${TUNEIN}/Tune.ashx?render=json&formats=mp3,aac&id=${encodeURIComponent(id.slice(7))}`));
        if (url) this.urls.set(id, { at: Date.now(), url });
      }
    }
    if (!url) throw new Error('no internet stream for this station');
    const name = s ? (s.mhz ? `${s.name}` : s.name) : id;
    return { id, name, url, homepage: null, favicon: s?.image ?? null, tags: [], country: 'US', codec: null, bitrate: null, hls: false };
  }
}
