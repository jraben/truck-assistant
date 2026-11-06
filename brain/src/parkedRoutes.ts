// Routes for the Parked screen (video, games, karaoke), camp/pet modes,
// trailer profiles and the light show. See parked.ts and modes.ts.
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Brain } from './brain.ts';
import type { Db } from './db.ts';
import { Modes, ModesError } from './modes.ts';
import { Parked, ParkedError } from './parked.ts';
import { PlexError, type PlexService } from './media/plex.ts';
import { PlexVideo } from './media/plexVideo.ts';
import type { RemoteService } from './remote/service.ts';
import { Tablet } from './tablet.ts';

export function registerParked(app: FastifyInstance, brain: Brain, db: Db, remote: RemoteService, plex: PlexService) {
  const parked = new Parked();
  const tablet = new Tablet(db);
  parked.onAndroidClose = () => { void tablet.front().then((r) => { if (!r.ok) console.warn('[tablet] front:', r.error); }); };
  const isAndroid = (req: { headers: Record<string, unknown> }) => /Android/i.test(String(req.headers['user-agent'] ?? ''));
  const video = new PlexVideo(plex);
  const modes = new Modes(db, brain, (kind, title, message) => remote.notify({ kind, title, message, priority: 'high' }));
  /** Moving = the drive lockout is on (over Settings' lockout speed), or over 2 mph when that isn't known. */
  const moving = () => { const s = brain.getState(); return s.drive?.lockout.locked ?? (s.speedMph ?? 0) >= 2; };
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof ParkedError || e instanceof ModesError || e instanceof PlexError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  // Driving closes app windows, ends camp/pet mode, and turns the light strip off.
  let wasMoving = false;
  const timer = setInterval(() => {
    const m = moving();
    parked.guard(m);
    try { modes.tick(); } catch (e) { console.error('[modes] tick', e); }
    if (m && !wasMoving) void modes.lightGuard();
    wasMoving = m;
  }, 3000);
  app.addHook('onClose', async () => clearInterval(timer));

  // ---- apps, games, karaoke --------------------------------------------------
  app.get('/api/parked/apps', async (req) => ({ apps: parked.apps(isAndroid(req)), ...parked.status(), moving: moving() }));
  app.post('/api/parked/launch', async (req, reply) => {
    const b = (req.body ?? {}) as { id?: unknown; q?: unknown };
    try {
      const r = parked.launch(String(b.id ?? ''), moving(), { q: typeof b.q === 'string' ? b.q : undefined, android: isAndroid(req) });
      if (r.tasker) {   // an Android app with no web address: Tasker on the tablet opens it
        const t = await tablet.launch(r.tasker);
        if (!t.ok) return reply.code(502).send({ error: t.error });
        return { opened: true, label: r.label };
      }
      return r;
    } catch (e) { return fail(reply, e); }
  });
  app.post('/api/parked/close', async () => ({ closed: parked.close() }));
  // The launcher in the Pi's desktop session (deploy/pi/parked-launcher.sh). Local only.
  app.get<{ Querystring: { have?: string } }>('/api/parked/next', async (req, reply) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)) return reply.code(403).send({ error: 'local only' });
    return parked.next(String(req.query.have ?? '').split(',').filter(Boolean)) ?? {};
  });

  // ---- the dash tablet (tablet.ts) ----------------------------------------------
  app.post('/api/tablet/hello', async (req) => tablet.hello(req.ip, String(req.headers['user-agent'] ?? '')));
  app.get('/api/tablet', async () => tablet.get());
  app.put('/api/tablet', async (req, reply) => { try { return tablet.setPort((req.body as { taskerPort?: unknown } | null)?.taskerPort); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); } });
  app.post('/api/tablet/test', async () => tablet.front());

  // ---- Plex video ----------------------------------------------------------------
  const pv = <Q>(p: string, f: (q: Q) => Promise<unknown>) => app.get<{ Querystring: Q }>(p, async (req, reply) => { try { return await f(req.query as Q); } catch (e) { return fail(reply, e); } });
  pv('/api/media/plex/video/sections', () => video.sections());
  pv<{ section?: string }>('/api/media/plex/video/all', (q) => video.all(String(q.section ?? '')));
  pv<{ section?: string }>('/api/media/plex/video/recent', (q) => video.recent(String(q.section ?? '')));
  pv('/api/media/plex/video/ondeck', () => video.onDeck());
  pv<{ key?: string }>('/api/media/plex/video/children', (q) => video.children(String(q.key ?? '')));
  pv<{ q?: string }>('/api/media/plex/video/search', (q) => video.search(String(q.q ?? '')));
  app.post('/api/media/plex/video/start', async (req, reply) => {
    if (moving()) return reply.code(409).send({ error: 'Video is parked only.' });
    const b = (req.body ?? {}) as { key?: unknown; offsetMs?: unknown; maxKbps?: unknown };
    try { return video.start(String(b.key ?? ''), Number(b.offsetMs) || 0, Math.min(20_000, Math.max(720, Number(b.maxKbps) || 4000))); } catch (e) { return fail(reply, e); }
  });
  app.post('/api/media/plex/video/timeline', async (req) => {
    const b = (req.body ?? {}) as { key?: string; state?: 'playing' | 'paused' | 'stopped'; timeMs?: number; durationMs?: number; session?: string };
    if (b.key && /^\d+$/.test(b.key) && b.session && /^[\w-]{8,64}$/.test(b.session) && ['playing', 'paused', 'stopped'].includes(String(b.state))) {
      await video.timeline(b.key, b.state!, Number(b.timeMs) || 0, Number(b.durationMs) || 0, b.session);
    }
    return { ok: true };
  });
  app.get<{ Params: { '*': string } }>('/api/media/plex/hls/*', async (req, reply) => {
    if (moving()) return reply.code(409).send({ error: 'Video is parked only.' });
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    try {
      const r = await video.hls(req.params['*'], qs);
      reply.code(r.status);
      for (const h of ['content-type', 'content-length', 'cache-control']) { const v = r.headers.get(h); if (v) reply.header(h, v); }
      return reply.send(r.body ? Readable.fromWeb(r.body as never) : '');
    } catch (e) { return fail(reply, e); }
  });

  // ---- camp / pet / trailers / light ------------------------------------------------
  app.get('/api/modes', async () => modes.get());
  app.patch('/api/modes', async (req, reply) => { try { return modes.patch(req.body); } catch (e) { return fail(reply, e); } });
  app.post('/api/modes/camp', async (req, reply) => { try { return modes.camp((req.body as { on?: unknown } | null)?.on === true); } catch (e) { return fail(reply, e); } });
  app.post('/api/modes/pet', async (req, reply) => { try { return modes.pet((req.body as { on?: unknown } | null)?.on === true); } catch (e) { return fail(reply, e); } });
  app.get('/api/light', async (_req, reply) => { try { return await modes.lightState(); } catch (e) { return fail(reply, e); } });
  app.post('/api/light', async (req, reply) => { try { return await modes.lightSet((req.body ?? {}) as Record<string, never>); } catch (e) { return fail(reply, e); } });

  return { parked, modes, video };
}
