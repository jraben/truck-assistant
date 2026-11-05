// Internet radio: Radio Browser (radio-browser.info, free, no key) for
// station search, plus presets (KJEF) and per-driver favourites. The brain
// relays the stream to the cockpit's <audio> so it can read ICY titles and so
// an http:// stream plays from any page. Only stations it has handed out
// (presets, favourites, search results) can be relayed: no open proxy.
import { promises as dns } from 'node:dns';
import { IcyParser, splitStreamTitle } from './icy.ts';
import { validStation, type MediaSettings, type RadioStation } from './settings.ts';

/** Used only when DNS can't list the servers (the API asks clients to discover them). */
export const FALLBACK_SERVERS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];

/** One station from Radio Browser's JSON (stations/search etc.) -> RadioStation, or null when it can't be played. */
export function mapStation(r: unknown): RadioStation | null {
  if (!r || typeof r !== 'object') return null;
  const x = r as Record<string, unknown>;
  const url = typeof x.url_resolved === 'string' && x.url_resolved.trim() ? x.url_resolved : x.url;
  if (typeof x.stationuuid !== 'string' || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return null;
  if (x.lastcheckok === 0) return null;
  const tags = typeof x.tags === 'string' ? x.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8) : [];
  return validStation({
    id: x.stationuuid, name: typeof x.name === 'string' ? x.name.replace(/\s+/g, ' ') : 'Station', url: url.trim(),
    homepage: x.homepage, favicon: typeof x.favicon === 'string' && /^https?:\/\//i.test(x.favicon) ? x.favicon : null, tags,
    country: x.countrycode, codec: x.codec, bitrate: typeof x.bitrate === 'number' ? x.bitrate : null, hls: x.hls === 1 || x.hls === true,
  });
}

export function mapStations(json: unknown): RadioStation[] {
  if (!Array.isArray(json)) return [];
  const seen = new Set<string>();
  const out: RadioStation[] = [];
  for (const r of json) {
    const s = mapStation(r);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id); out.push(s);
  }
  return out;
}

export function kjefPreset(url: string): RadioStation {
  return { id: 'preset:kjef', name: 'KJEF · SUB/WAVE', url, homepage: 'https://radio.jeffraben.com', favicon: null, tags: ['jeff', 'ai dj'], country: 'US', codec: 'MP3', bitrate: null, hls: false };
}

/** Rough data use per hour of a stream, for the "on a phone hotspot" warning. Unknown bitrate: assume 128 kbps. */
export const mbPerHour = (kbps: number | null) => Math.round(((kbps ?? 128) * 1000 / 8) * 3600 / 1e6);

import type { RadioNow } from './types.ts';
export type { RadioNow } from './types.ts';

export class RadioService {
  private version: string;
  private servers: { list: string[]; at: number } | null = null;
  private seen = new Map<string, RadioStation>();  // stations handed out by search, newest last
  private nowPlaying: RadioNow | null = null;
  private media: () => MediaSettings;

  constructor(version: string, media: () => MediaSettings) {
    this.version = version;
    this.media = media;
  }

  presets(): RadioStation[] { return [kjefPreset(this.media().radio.kjefUrl)]; }

  private ua() { return { 'user-agent': `slate-cockpit/${this.version}` }; }

  async serverList(): Promise<string[]> {
    if (this.servers && Date.now() - this.servers.at < 3600_000) return this.servers.list;
    let list: string[] = [];
    try {
      const srv = await dns.resolveSrv('_api._tcp.radio-browser.info');
      list = srv.map((r) => r.name).filter(Boolean);
    } catch { /* offline or blocked: fall back */ }
    if (!list.length) list = [...FALLBACK_SERVERS];
    list.sort(() => Math.random() - 0.5); // spread the load, as the API asks
    this.servers = { list, at: Date.now() };
    return list;
  }

  private async api(p: string): Promise<unknown> {
    let last: Error | null = null;
    for (const host of (await this.serverList()).slice(0, 3)) {
      try {
        const r = await fetch(`https://${host}${p}`, { headers: this.ua(), signal: AbortSignal.timeout(8000) });
        if (r.ok) return await r.json();
        last = new Error(`${host} answered ${r.status}`);
      } catch (e) { last = e as Error; }
    }
    throw new Error(`Radio Browser didn't answer (${last?.message ?? 'no servers'})`);
  }

  async search(q: { name?: string; tag?: string; country?: string; limit?: number }): Promise<RadioStation[]> {
    const p = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(Math.max(1, Math.min(60, q.limit ?? 40))) });
    if (q.name) p.set('name', q.name.slice(0, 80));
    if (q.tag) p.set('tag', q.tag.slice(0, 40));
    if (q.country) p.set('countrycode', q.country.slice(0, 2).toUpperCase());
    const list = mapStations(await this.api(`/json/stations/search?${p}`));
    for (const s of list) { this.seen.delete(s.id); this.seen.set(s.id, s); }
    while (this.seen.size > 600) this.seen.delete(this.seen.keys().next().value!);
    return list;
  }

  /** The station with this id, if the brain has handed it out (preset, any driver's favourite, a search). */
  find(id: string): RadioStation | null {
    const p = this.presets().find((s) => s.id === id);
    if (p) return p;
    for (const list of Object.values(this.media().radio.favourites)) { const f = list.find((s) => s.id === id); if (f) return f; }
    return this.seen.get(id) ?? null;
  }

  /** Radio Browser asks clients to count a play (GET /json/url/<uuid>). Best effort. */
  click(id: string) {
    if (id.startsWith('preset:')) return;
    void this.api(`/json/url/${encodeURIComponent(id)}`).catch(() => {});
  }

  now(): RadioNow | null { return this.nowPlaying; }

  /**
   * Open the station upstream (asking for ICY metadata) and return the audio
   * with the metadata taken out, plus its content type. Titles update now().
   */
  async open(st: RadioStation, signal: AbortSignal): Promise<{ type: string; body: AsyncIterable<Buffer> }> {
    const res = await fetch(st.url, { headers: { ...this.ua(), 'icy-metadata': '1', accept: 'audio/*,*/*' }, signal });
    if (!res.ok || !res.body) throw new Error(`the station answered ${res.status}`);
    const type = (res.headers.get('content-type') ?? 'audio/mpeg').split(';')[0].trim();
    if (/mpegurl|x-scpls|text\/html/i.test(type)) throw new Error(`the station sent a ${type} page, not audio (try another stream of it)`);
    const metaint = Number(res.headers.get('icy-metaint') ?? 0);
    const now: RadioNow = { stationId: st.id, name: st.name, title: null, artist: null, since: new Date().toISOString() };
    this.nowPlaying = now;
    const parser = new IcyParser(metaint, (t) => { const p = splitStreamTitle(t); if (this.nowPlaying === now) { now.title = p.title; now.artist = p.artist; } });
    const src = res.body as unknown as AsyncIterable<Uint8Array>;
    const self = this;
    async function* body() {
      try {
        for await (const c of src) {
          const a = parser.push(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
          if (a.length) yield a;
        }
      } finally { if (self.nowPlaying === now) self.nowPlaying = null; }
    }
    return { type: type === 'audio/aacp' ? 'audio/aac' : type, body: body() };
  }
}
