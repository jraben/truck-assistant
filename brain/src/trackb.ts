// Track B: the Media view's sources, WOPR from the truck, and charging
// receipts. One call from server.ts; everything else lives in media/,
// wopr/ and receipts/. Routes are listed in docs/contract.md under
// "Track B: Media and WOPR".
import path from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Brain } from './brain.ts';
import { config } from './config.ts';
import { kvGet, kvSet } from './db.ts';
import type { NowPlayingHub } from './media.ts';
import { fmLabel, maskMedia, MediaSettingsError, MediaSettingsStore, validFm, validStation } from './media/settings.ts';
import { RadioService } from './media/radio.ts';
import { SpotifyError } from './media/spotify.ts';
import { SpotifyService } from './media/spotifyService.ts';
import { PlexError, PlexService } from './media/plex.ts';
import { LocalError, LocalService } from './media/local.ts';
import { FmService } from './media/fm.ts';
import { AirStreams, type AirStation } from './media/airstreams.ts';
import { WoprError, woprJson } from './wopr/client.ts';
import { WoprService } from './wopr/service.ts';
import type { ChatMsg } from './wopr/primer.ts';
import { ReceiptError, ReceiptService } from './receipts/service.ts';

const RECEIPT_POLL_MS = 6 * 3600_000;
const RECEIPT_RETRY_404_MS = 24 * 3600_000;

type Reply = FastifyReply;
/** Known errors -> their status and message; anything else is rethrown for the generic handler. */
function fail(reply: Reply, e: unknown) {
  if (e instanceof WoprError) return reply.code(e.status).send({ error: e.message, kind: e.kind });
  if (e instanceof SpotifyError || e instanceof PlexError || e instanceof LocalError || e instanceof ReceiptError) return reply.code(e.status).send({ error: e.message });
  if (e instanceof MediaSettingsError) return reply.code(400).send({ error: e.message });
  const st = (e as { status?: number }).status;
  if (typeof st === 'number' && st >= 400 && st < 600) return reply.code(st).send({ error: (e as Error).message });
  throw e;
}

const q = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export async function registerTrackB(app: FastifyInstance, brain: Brain, hub: NowPlayingHub) {
  const media = new MediaSettingsStore(config.dataDir);
  const online = () => brain.getState().network?.link !== 'offline';
  const driverId = () => brain.activeDriver().id;
  const radio = new RadioService(config.version, () => media.get());
  const spotify = new SpotifyService({ media, driver: driverId, online, report: (np) => hub.report('brain:spotify', np), sim: config.sim, demo: config.demo });
  const plex = new PlexService(() => media.get(), () => `slate-cockpit-${brain.settings.get().truckId}`);
  const local = new LocalService(() => media.get().local.folder ?? path.join(config.dataDir, 'music'));
  const fm = new FmService(config.sim, () => media.get());
  const air = new AirStreams(config.version);
  /** Where the dial is built for: the truck's GPS, else the home place, else Phoenix. */
  const dialPos = () => brain.getState().gps ?? brain.stops.places.all().find((p) => /home/i.test(p.name)) ?? { lat: 33.4484, lon: -112.074 };
  /** Tuner or internet streams, for this request. */
  const fmSource = async (): Promise<'tuner' | 'internet'> => {
    const s = media.get().fm.source;
    if (s !== 'auto') return s;
    const t = await fm.detect();
    return t.state === 'present' || t.state === 'busy' ? 'tuner' : 'internet';
  };
  const wopr = new WoprService(brain, media);
  const receipts = new ReceiptService(brain.db, brain.charges, driverId);

  // ---- background ---------------------------------------------------------------
  spotify.start();
  wopr.start();
  local.root();
  let receiptTimer: NodeJS.Timeout | null = null;
  const receiptRun = async (manual = false) => {
    const m = media.get();
    if ((!m.receipts.autoImport && !manual) || !wopr.configured() || !online()) return;
    if (!manual && receipts.mail.available === false && receipts.mail.lastRun && Date.now() - Date.parse(receipts.mail.lastRun) < RECEIPT_RETRY_404_MS) return;
    const since = kvGet<string>(brain.db, 'receiptsMailSince') ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    const started = new Date().toISOString();
    try { await receipts.importFromWopr(m.wopr, since); if (receipts.mail.available) kvSet(brain.db, 'receiptsMailSince', started); }
    catch (e) { console.error('[receipts] mail', (e as Error).message); }
  };
  const firstRun = setTimeout(() => void receiptRun(), 60_000);
  receiptTimer = setInterval(() => void receiptRun(), RECEIPT_POLL_MS);
  app.addHook('onClose', async () => {
    spotify.stop(); wopr.stop(); fm.stopStream();
    clearTimeout(firstRun); if (receiptTimer) clearInterval(receiptTimer);
  });

  // ---- settings ------------------------------------------------------------------
  app.get('/api/media/settings', async () => maskMedia(media.get()));
  app.put('/api/media/settings', async (req, reply) => { try { return maskMedia(media.update(req.body)); } catch (e) { return fail(reply, e); } });

  app.get('/api/media/status', async () => {
    const st = brain.getState();
    return {
      saveData: st.network?.saveData ?? false, link: st.network?.link ?? 'offline', nowPlaying: st.nowPlaying,
      spotify: spotify.status(), radio: { now: radio.now() }, fm: { tuner: await fm.detect(), tuned: fm.current() },
      plex: { configured: plex.configured() }, local: { root: local.root() },
      wopr: wopr.status(),
    };
  });

  // ---- internet radio --------------------------------------------------------------
  const favs = () => media.get().radio.favourites[driverId()] ?? [];
  app.get('/api/media/radio/presets', async () => (config.demo ? [] : radio.presets())); // DEMO: no owner's station
  app.get<{ Querystring: { q?: string; tag?: string; country?: string } }>('/api/media/radio/search', async (req, reply) => {
    if (!online()) return reply.code(503).send({ error: 'Offline: station search needs the internet.' });
    try { return await radio.search({ name: q(req.query.q), tag: q(req.query.tag), country: q(req.query.country) }); }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });
  app.get('/api/media/radio/favourites', async () => favs());
  app.post('/api/media/radio/favourites', async (req, reply) => {
    const d = brain.activeDriver();
    if (d.guest) return reply.code(400).send({ error: 'The Guest profile keeps no favourites: pick a driver first.' });
    const st = validStation((req.body as { station?: unknown } | null)?.station);
    if (!st) return reply.code(400).send({ error: 'station must be {id, name, url, …} from a search' });
    media.mutate((s) => { const list = (s.radio.favourites[d.id] ?? []).filter((x) => x.id !== st.id); s.radio.favourites[d.id] = [...list, st].slice(-50); });
    return reply.code(201).send(favs());
  });
  app.delete<{ Params: { id: string } }>('/api/media/radio/favourites/:id', async (req) => {
    const d = brain.activeDriver();
    media.mutate((s) => { s.radio.favourites[d.id] = (s.radio.favourites[d.id] ?? []).filter((x) => x.id !== req.params.id); });
    return favs();
  });
  app.get('/api/media/radio/now', async () => radio.now());
  app.get<{ Params: { id: string } }>('/api/media/radio/stream/:id', async (req, reply) => {
    const st = radio.find(req.params.id);
    if (!st) return reply.code(404).send({ error: 'Unknown station: search for it again or pick a favourite.' });
    if (!online() && !st.url.startsWith('http://192.168.')) return reply.code(503).send({ error: 'Offline: internet radio needs home Wi-Fi or a hotspot.' });
    const ac = new AbortController();
    reply.raw.on('close', () => ac.abort());
    try {
      const s = await radio.open(st, ac.signal);
      radio.click(st.id);
      reply.header('content-type', s.type).header('cache-control', 'no-store').header('x-station', encodeURIComponent(st.name));
      return reply.send(Readable.from(s.body));
    } catch (e) {
      if (ac.signal.aborted) return reply;
      return reply.code(502).send({ error: `${st.name}: ${(e as Error).message}` });
    }
  });

  // ---- AM/FM -------------------------------------------------------------------------
  app.get('/api/media/fm/status', async () => ({ tuner: await fm.detect(true), tuned: fm.current(), presets: media.get().fm.presets, source: await fmSource(), setting: media.get().fm.source }));
  // Internet streams of the local AM/FM stations (no tuner needed; uses data).
  app.get('/api/media/fm/stations', async (_req, reply) => {
    if (!online()) return reply.code(503).send({ error: 'Offline: station streams need the internet.' });
    try { return { stations: await air.dial(dialPos()) }; } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });
  app.get<{ Querystring: { q?: string } }>('/api/media/fm/find', async (req, reply) => {
    const s = q(req.query.q);
    if (s.length < 2) return reply.code(400).send({ error: 'type a call sign or name, e.g. KTAR' });
    if (!online()) return reply.code(503).send({ error: 'Offline: search needs the internet.' });
    return { stations: await air.find(s) };
  });
  app.get<{ Params: { id: string } }>('/api/media/fm/net/:id', async (req, reply) => {
    const id = req.params.id;
    if (!air.station(id)) {
      const p = media.get().fm.presets.find((x) => x.streamId === id);
      if (p) air.learn({ id, mhz: p.mhz, band: p.mhz < 2 ? 'AM' : 'FM', hd: null, name: p.name, slogan: null, image: null, url: null });
      else return reply.code(404).send({ error: 'Unknown station: open the AM/FM list again.' });
    }
    if (!online()) return reply.code(503).send({ error: 'Offline: station streams need the internet.' });
    const ac = new AbortController();
    reply.raw.on('close', () => ac.abort());
    try {
      const st = await air.playable(id);
      const s = await radio.open(st, ac.signal);
      reply.header('content-type', s.type).header('cache-control', 'no-store').header('x-station', encodeURIComponent(st.name));
      return reply.send(Readable.from(s.body));
    } catch (e) {
      if (ac.signal.aborted) return reply;
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
  app.get<{ Querystring: { mhz?: string } }>('/api/media/fm/stream', async (req, reply) => {
    const mhz = Number(req.query.mhz);
    if (!validFm(mhz)) return reply.code(400).send({ error: 'mhz must be 87.5-108.0 (FM) or 0.53-1.71 (AM)' });
    try {
      const s = await fm.stream(mhz);
      reply.raw.on('close', () => { if (fm.current() === mhz) fm.stopStream(); });
      reply.header('content-type', 'audio/mpeg').header('cache-control', 'no-store').header('x-station', encodeURIComponent(fmLabel(mhz)));
      return reply.send(s);
    } catch (e) { return fail(reply, e); }
  });
  app.post('/api/media/fm/stop', async () => { fm.stopStream(); return { ok: true }; });
  app.post('/api/media/fm/seek', async (req, reply) => {
    const b = (req.body ?? {}) as { from?: number; dir?: number };
    const from = Number(b.from ?? 87.9), dir = b.dir === -1 ? -1 : 1;
    try { return { mhz: await fm.seek(from, dir) }; } catch (e) { return fail(reply, e); }
  });

  // ---- Plex ----------------------------------------------------------------------------
  const plexGet = <Q>(p: string, f: (qs: Q) => Promise<unknown>) => app.get<{ Querystring: Q }>(p, async (req, reply) => { try { return await f(req.query as Q); } catch (e) { return fail(reply, e); } });
  plexGet('/api/media/plex/sections', () => plex.sections());
  plexGet<{ section?: string }>('/api/media/plex/artists', (x) => plex.artists(q(x.section)));
  plexGet<{ section?: string }>('/api/media/plex/recent', (x) => plex.recent(q(x.section)));
  plexGet('/api/media/plex/playlists', () => plex.playlists());
  plexGet<{ key?: string; type?: string }>('/api/media/plex/children', (x) => plex.children(q(x.key), q(x.type)));
  plexGet<{ q?: string }>('/api/media/plex/search', (x) => plex.search(q(x.q)));
  const relay = async (reply: Reply, r: Response) => {
    reply.code(r.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) { const v = r.headers.get(h); if (v) reply.header(h, v); }
    return reply.send(r.body ? Readable.fromWeb(r.body as never) : '');
  };
  app.get<{ Params: { key: string } }>('/api/media/plex/track/:key', async (req, reply) => {
    try { return await relay(reply, await plex.stream(req.params.key, req.headers.range)); } catch (e) { return fail(reply, e); }
  });
  app.get<{ Querystring: { path?: string } }>('/api/media/plex/thumb', async (req, reply) => {
    try { return await relay(reply, await plex.thumb(q(req.query.path))); } catch (e) { return fail(reply, e); }
  });

  // ---- local files -----------------------------------------------------------------------
  app.get<{ Querystring: { path?: string } }>('/api/media/local', async (req, reply) => { try { return await local.list(q(req.query.path)); } catch (e) { return fail(reply, e); } });
  app.get<{ Querystring: { path?: string } }>('/api/media/local/file', async (req, reply) => {
    try {
      const f = await local.open(q(req.query.path), req.headers.range);
      reply.header('accept-ranges', 'bytes').header('content-type', f.type);
      if (f.status === 416) return reply.code(416).header('content-range', `bytes */${f.size}`).send();
      reply.code(f.status).header('content-length', String(f.end - f.start + 1));
      if (f.status === 206) reply.header('content-range', `bytes ${f.start}-${f.end}/${f.size}`);
      return reply.send(f.stream);
    } catch (e) { return fail(reply, e); }
  });

  // ---- Spotify ------------------------------------------------------------------------------
  app.get('/api/spotify/status', async () => { await spotify.poll(); return spotify.status(); });
  app.post('/api/spotify/auth/start', async (req, reply) => {
    const b = (req.body ?? {}) as { driverId?: string; redirectUri?: string };
    const d = brain.settings.driver(b.driverId ?? driverId());
    if (!d || d.guest) return reply.code(400).send({ error: 'Pick a named driver (not Guest) to connect Spotify for.' });
    try { return spotify.beginAuth(d.id, q(b.redirectUri)); } catch (e) { return fail(reply, e); }
  });
  app.post('/api/spotify/auth/finish', async (req, reply) => {
    try { return await spotify.finishAuth({ url: q((req.body as { url?: string } | null)?.url) }); } catch (e) { return fail(reply, e); }
  });
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/spotify/callback', async (req, reply) => {
    const page = (title: string, msg: string) => reply.type('text/html; charset=utf-8').send(`<!doctype html><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font-family:system-ui;background:#0d1114;color:#e8eef2;padding:24px"><h2>${title}</h2><p>${msg.replace(/</g, '&lt;')}</p><p><a style="color:#4fc3d9" href="/settings#media">Back to settings</a></p></body>`);
    if (req.query.error) return page('Spotify not connected', req.query.error === 'access_denied' ? 'Access was declined.' : req.query.error);
    try { const r = await spotify.finishAuth({ code: q(req.query.code), state: q(req.query.state) }); return page('Spotify connected', `Connected${r.user ? ` as ${r.user}` : ''} for ${brain.settings.driver(r.driver)?.name ?? r.driver}. You can close this page.`); }
    catch (e) { return page('Spotify not connected', (e as Error).message); }
  });
  app.delete<{ Params: { driver: string } }>('/api/spotify/auth/:driver', async (req) => { spotify.disconnect(req.params.driver); return { ok: true }; });
  app.get('/api/spotify/playlists', async (_req, reply) => { try { return await spotify.api.playlists(driverId()); } catch (e) { return fail(reply, e); } });
  app.get('/api/spotify/devices', async (_req, reply) => { try { return await spotify.api.devices(driverId()); } catch (e) { return fail(reply, e); } });
  app.post<{ Params: { cmd: string } }>('/api/spotify/:cmd', async (req, reply) => {
    if (!online()) return reply.code(503).send({ error: 'Offline: Spotify needs the internet.' });
    try { await spotify.command(req.params.cmd, (req.body ?? {}) as Record<string, unknown>); return spotify.status(); } catch (e) { return fail(reply, e); }
  });

  // ---- WOPR ------------------------------------------------------------------------------------
  app.get('/api/wopr/status', async () => wopr.status());
  app.post('/api/wopr/test', async () => wopr.test());
  app.get('/api/wopr/next', async () => wopr.getNext());
  app.post('/api/wopr/next/refresh', async () => wopr.refreshNext());
  app.get('/api/wopr/gate', async (_req, reply) => { reply.header('cache-control', 'no-store'); return wopr.getGate(); });
  app.post('/api/wopr/gate/check', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    try { return await wopr.checkGate(brain.getState().place?.stopId ?? null, true); } catch (e) { return fail(reply, e); }
  });
  app.post('/api/wopr/gate/dismiss', async () => { wopr.dismissGate(); return { ok: true }; });
  // The mailbox (WOPR's USPS Informed Delivery read): delivered / coming today / collected.
  app.get('/api/wopr/usps', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    try { return await woprJson(media.get().wopr, '/api/usps', { timeoutMs: 10_000 }); } catch (e) { return fail(reply, e); }
  });
  app.post('/api/wopr/usps/collected', async (_req, reply) => {
    try { return await woprJson(media.get().wopr, '/api/usps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ack: true }), timeoutMs: 10_000 }); } catch (e) { return fail(reply, e); }
  });
  app.post('/api/wopr/tts', async (req, reply) => {
    const text = q((req.body as { text?: string } | null)?.text);
    if (!text) return reply.code(400).send({ error: 'text is required' });
    try { const r = await wopr.tts(text); reply.header('content-type', r.headers.get('content-type') ?? 'audio/mpeg'); return reply.send(r.body ? Readable.fromWeb(r.body as never) : ''); }
    catch (e) { return fail(reply, e); }
  });
  app.post('/api/wopr/chat', async (req, reply) => {
    const b = (req.body ?? {}) as { text?: unknown; history?: unknown };
    const text = q(b.text);
    if (!text) return reply.code(400).send({ error: 'text is required' });
    const history = Array.isArray(b.history) ? b.history.filter((m): m is ChatMsg => !!m && typeof m === 'object' && ((m as ChatMsg).role === 'user' || (m as ChatMsg).role === 'assistant') && typeof (m as ChatMsg).content === 'string') : [];
    const ac = new AbortController();
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) ac.abort(); });
    const gen = wopr.chat(text, history, ac.signal);
    async function* ndjson() { for await (const ev of gen) yield JSON.stringify(ev) + '\n'; }
    reply.header('content-type', 'application/x-ndjson; charset=utf-8').header('cache-control', 'no-store').header('x-accel-buffering', 'no');
    return reply.send(Readable.from(ndjson()));
  });
  // Audio from the cockpit's mic, as recorded (webm/opus, mp4 or ogg), up to 8 MB.
  await app.register(async (scope) => {
    scope.addContentTypeParser(/^(audio\/|application\/octet-stream)/, { parseAs: 'buffer', bodyLimit: 8 * 1024 * 1024 }, (_req, body, done) => done(null, body));
    scope.post('/api/wopr/stt', async (req, reply) => {
      const buf = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(buf) || buf.length < 200) return reply.code(400).send({ error: 'No audio: send the recording as the body (Content-Type audio/webm).' });
      try { return await wopr.stt(buf, String(req.headers['content-type'] ?? 'audio/webm')); } catch (e) { return fail(reply, e); }
    });
  });

  // ---- charging receipts ---------------------------------------------------------------------
  app.post('/api/charges/import-receipt', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof b[k] === 'string' ? b[k] as string : undefined);
    try {
      const r = receipts.import({ text: s('text'), html: s('html'), subject: s('subject'), from: s('from'), receivedAt: s('receivedAt'), messageId: s('messageId') });
      return reply.code(r.duplicate ? 200 : 201).send(r);
    } catch (e) { return fail(reply, e); }
  });
  app.get<{ Querystring: { state?: string } }>('/api/charges/drafts', async (req) => {
    const st = req.query.state;
    return receipts.list(st === 'all' || st === 'confirmed' || st === 'dismissed' ? st : 'draft');
  });
  app.post<{ Params: { id: string } }>('/api/charges/drafts/:id/confirm', async (req, reply) => {
    try { return receipts.confirm(Number(req.params.id), (req.body ?? {}) as never); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/api/charges/drafts/:id/dismiss', async (req, reply) =>
    receipts.dismiss(Number(req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'no such draft' }));
  app.get('/api/charges/receipts/mail', async () => ({ ...receipts.mail, autoImport: media.get().receipts.autoImport, woprConfigured: wopr.configured() }));
  app.post('/api/charges/receipts/mail', async () => {
    await receiptRun(true);
    return { ...receipts.mail, autoImport: media.get().receipts.autoImport, woprConfigured: wopr.configured() };
  });

  return { media, wopr, receipts, spotify, radio, fm, plex, local };
}
