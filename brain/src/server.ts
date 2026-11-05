// HTTP + WebSocket per docs/contract.md.
import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { Brain } from './brain.ts';
import { config } from './config.ts';
import { maskSettings, SettingsError } from './settings.ts';
import { summarize, type Period } from './charges/summary.ts';
import { ChargeInputError, parseSessionInput, toCsv } from './charges/store.ts';
import { parseMediaMessage } from './media.ts';

/** Header carrying a human-readable note with GET /api/chargers (e.g. "no API keys yet"). */
export const CHARGER_MESSAGE_HEADER = 'x-slate-message';

export async function buildServer(brain: Brain): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  // ---- WebSocket ------------------------------------------------------------
  const clients = new Set<WebSocket>();
  let wsTimer: NodeJS.Timeout | null = null;
  let lastWs = 0;
  const broadcast = () => {
    if (wsTimer) return;
    wsTimer = setTimeout(() => {
      wsTimer = null; lastWs = Date.now();
      if (!clients.size) return;
      const msg = JSON.stringify({ type: 'state', data: brain.getState() });
      for (const c of clients) if (c.readyState === 1) c.send(msg);
    }, Math.max(0, 100 - (Date.now() - lastWs))); // at most 10/s
  };
  brain.on('change', broadcast);

  // The cockpit whose CarPlay reported now playing; when it goes away, so does the report.
  let mediaFrom: WebSocket | null = null;

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: 'state', data: brain.getState() }));
    socket.on('message', (raw: Buffer) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'relay' && typeof m.id === 'string' && typeof m.on === 'boolean') {
        const r = brain.setRelay(m.id, m.on);
        if (!r.ok) socket.send(JSON.stringify({ type: 'error', message: r.error }));
      } else if (m.type === 'soc' && typeof m.value === 'number' && m.value >= 0 && m.value <= 100) {
        brain.setManualSoc(m.value);
      } else if (m.type === 'media') {
        const np = parseMediaMessage(m);
        if (np === undefined) return;
        if (np === null && mediaFrom !== null && mediaFrom !== socket) return; // another screen with no CarPlay doesn't clear it
        mediaFrom = np ? socket : null;
        brain.setNowPlaying(np);
      }
    });
    const gone = () => {
      clients.delete(socket);
      if (mediaFrom === socket) { mediaFrom = null; brain.setNowPlaying(null); }
    };
    socket.on('close', gone);
    socket.on('error', gone);
  });

  // ---- API -------------------------------------------------------------------
  app.get('/api/health', async () => brain.health());
  app.get('/api/state', async () => brain.getState());

  app.get('/api/settings', async () => maskSettings(brain.settings.get()));
  app.put('/api/settings', async (req, reply) => {
    try { return maskSettings(brain.settings.update(req.body)); }
    catch (e) {
      if (e instanceof SettingsError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  app.get<{ Querystring: { lat?: string; lon?: string; soc?: string } }>('/api/chargers', async (req, reply) => {
    const st = brain.getState();
    const lat = req.query.lat !== undefined && req.query.lat !== '' ? Number(req.query.lat) : st.gps?.lat;
    const lon = req.query.lon !== undefined && req.query.lon !== '' ? Number(req.query.lon) : st.gps?.lon;
    const soc = req.query.soc !== undefined && req.query.soc !== '' ? Number(req.query.soc) : st.soc;
    if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      reply.header(CHARGER_MESSAGE_HEADER, 'No location yet: waiting for a GPS fix.');
      return [];
    }
    const r = await brain.finder.find(lat, lon, soc === null || soc === undefined || !Number.isFinite(soc) ? null : soc, brain.settings.get());
    if (r.message) reply.header(CHARGER_MESSAGE_HEADER, encodeURIComponent(r.message));
    return r.chargers;
  });

  app.get<{ Querystring: { limit?: string } }>('/api/trips', async (req) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50) || 50));
    return brain.trips.list(limit);
  });
  app.get<{ Params: { id: string } }>('/api/trips/:id', async (req, reply) => {
    const t = brain.trips.get(Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'no such trip' });
    return { ...t, points: brain.trips.points(t.id) };
  });

  // Charge sessions.
  const range = (q: { from?: string; to?: string }) => {
    const p = (v?: string) => (v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
    return [p(q.from), p(q.to)] as const;
  };
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/charges', async (req) => brain.charges.store.list(...range(req.query)));
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/charges.csv', async (req, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="charges.csv"');
    return toCsv(brain.charges.store.list(...range(req.query)).reverse());
  });
  app.get<{ Querystring: { period?: string } }>('/api/charges/summary', async (req) => {
    const period: Period = req.query.period === 'year' ? 'year' : 'month';
    return summarize(brain.charges.store.list(), brain.trips.between(null, null), period, brain.settings.get());
  });
  const gpsNow = () => { const g = brain.getState().gps; return g?.fix ? { lat: g.lat, lon: g.lon } : null; };
  app.post('/api/charges', async (req, reply) => {
    try { return reply.code(201).send(brain.charges.createManual(parseSessionInput(req.body ?? {}), brain.settings.get(), gpsNow())); }
    catch (e) { if (e instanceof ChargeInputError) return reply.code(400).send({ error: e.message }); throw e; }
  });
  app.put<{ Params: { id: string } }>('/api/charges/:id', async (req, reply) => {
    try {
      const s = brain.charges.update(Number(req.params.id), parseSessionInput(req.body ?? {}));
      return s ?? reply.code(404).send({ error: 'no such session' });
    } catch (e) { if (e instanceof ChargeInputError) return reply.code(400).send({ error: e.message }); throw e; }
  });
  app.delete<{ Params: { id: string } }>('/api/charges/:id', async (req, reply) => {
    return brain.charges.delete(Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'no such session' });
  });

  // ---- UI --------------------------------------------------------------------
  const uiBuilt = existsSync(path.join(config.uiDir, 'index.html'));
  if (uiBuilt) {
    await app.register(fastifyStatic, { root: config.uiDir, index: ['index.html'], wildcard: true });
    const settingsPage = (_: unknown, reply: { sendFile: (f: string) => unknown }) => reply.sendFile('settings.html');
    app.get('/settings', settingsPage as never);
    app.get('/settings/', settingsPage as never);
  } else {
    const msg = `Cockpit UI not built (looked in ${config.uiDir}). Run "npm run build" at the repo root, or use "npm run dev".`;
    app.get('/', async (_req, reply) => reply.code(503).type('text/plain').send(msg));
    app.get('/settings', async (_req, reply) => reply.code(503).type('text/plain').send(msg));
    console.warn(`[ui] ${msg}`);
  }

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    console.error('[http]', err);
    const code = (err as { statusCode?: number }).statusCode ?? 500;
    reply.code(code).send({ error: code >= 500 ? 'internal error' : err.message });
  });

  return app;
}
