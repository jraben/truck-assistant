// HTTP + WebSocket per docs/contract.md.
import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { Brain } from './brain.ts';
import { config } from './config.ts';
import { maskDriver, maskSettings, SettingsError } from './settings.ts';
import { summarize, type Period } from './charges/summary.ts';
import { ChargeInputError, parseSessionInput, toCsv } from './charges/store.ts';
import { parseMediaMessage } from './media.ts';
import { PlaceInputError } from './stops/service.ts';
import { ImportError } from './import/phone.ts';
import { VehicleError, type MenuLevel } from './gas/vehicles.ts';
import { NOT_CONFIGURED } from './ha/client.ts';
import type { TimelineItem } from './types.ts';

const optStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const srcOf = (v: unknown) => (v === 'phone' || v === 'truck' ? v : null);

/** Local day "YYYY-MM-DD" -> [start, end) ISO; null when not a date. */
export function dayBounds(day: string): [string, string] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const a = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const b = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1);
  return [a.toISOString(), b.toISOString()];
}

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
    const r = await brain.finder.find(lat, lon, soc === null || soc === undefined || !Number.isFinite(soc) ? null : soc, brain.finderSettings());
    if (r.message) reply.header(CHARGER_MESSAGE_HEADER, encodeURIComponent(r.message));
    return r.chargers;
  });

  app.get<{ Querystring: { limit?: string; driver?: string; source?: string } }>('/api/trips', async (req) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50) || 50));
    return brain.trips.list(limit, { driver: optStr(req.query.driver), source: srcOf(req.query.source) });
  });
  app.get<{ Params: { id: string } }>('/api/trips/:id', async (req, reply) => {
    const t = brain.trips.get(Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'no such trip' });
    return { ...t, points: brain.trips.points(t.id) };
  });

  // ---- drivers ---------------------------------------------------------------
  const settingsErr = (e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (e instanceof SettingsError) return reply.code(400).send({ error: e.message });
    throw e;
  };
  app.get('/api/drivers', async () => brain.settings.get().drivers.map(maskDriver));
  app.post('/api/drivers', async (req, reply) => {
    try { return reply.code(201).send(maskDriver(brain.settings.addDriver(req.body ?? {}))); } catch (e) { return settingsErr(e, reply); }
  });
  app.put<{ Params: { id: string } }>('/api/drivers/:id', async (req, reply) => {
    try { const d = brain.settings.updateDriver(req.params.id, req.body ?? {}); return d ? maskDriver(d) : reply.code(404).send({ error: 'no such driver' }); } catch (e) { return settingsErr(e, reply); }
  });
  app.delete<{ Params: { id: string } }>('/api/drivers/:id', async (req, reply) => {
    try { return brain.settings.deleteDriver(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'no such driver' }); } catch (e) { return settingsErr(e, reply); }
  });
  app.post('/api/driver', async (req, reply) => {
    const id = (req.body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string') return reply.code(400).send({ error: 'id is required' });
    const r = brain.setDriver(id);
    return r.ok ? brain.getState().driver : reply.code(404).send({ error: r.error });
  });
  app.post('/api/driver/dismiss', async () => { brain.dismissSuggestion(); return { ok: true }; });

  // ---- network ---------------------------------------------------------------
  app.get('/api/network', async () => ({ status: brain.net.status, candidates: brain.net.cands }));
  app.post('/api/network/connect', async (req, reply) => {
    const id = (req.body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string') return reply.code(400).send({ error: 'id is required (e.g. "hotspot:jeff")' });
    if (!brain.net.pick(id)) return reply.code(404).send({ error: `no network "${id}" (GET /api/network lists them)` });
    await brain.net.tick();
    return { status: brain.net.status, candidates: brain.net.cands };
  });
  app.post('/api/network/auto', async () => { brain.net.pick(null); await brain.net.tick(); return { status: brain.net.status, candidates: brain.net.cands }; });

  // ---- stops, places, timeline -------------------------------------------------
  const isoOrNull = (v?: string) => (v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
  app.get<{ Querystring: { from?: string; to?: string; driver?: string; source?: string; limit?: string } }>('/api/stops', async (req) =>
    brain.stops.stops.list({ from: isoOrNull(req.query.from), to: isoOrNull(req.query.to), driver: optStr(req.query.driver), source: srcOf(req.query.source), limit: Math.max(1, Math.min(2000, Number(req.query.limit ?? 200) || 200)) }));
  app.put<{ Params: { id: string } }>('/api/stops/:id/name', async (req, reply) => {
    try {
      const r = brain.stops.nameFromStop(Number(req.params.id), req.body ?? {}, brain.activeDriver().id);
      return r ?? reply.code(404).send({ error: 'no such stop' });
    } catch (e) { if (e instanceof PlaceInputError) return reply.code(400).send({ error: e.message }); throw e; }
  });
  app.get<{ Querystring: { date?: string; driver?: string } }>('/api/timeline', async (req, reply) => {
    const date = req.query.date ?? new Date().toLocaleDateString('en-CA');
    const b = dayBounds(date);
    if (!b) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    const driver = optStr(req.query.driver);
    const items: TimelineItem[] = [
      ...brain.stops.stops.overlapping(b[0], b[1], driver).map((s) => ({ kind: 'stop' as const, ...s })),
      ...brain.trips.overlapping(b[0], b[1], { driver }).map((t) => ({ kind: 'trip' as const, ...t })),
    ].sort((x, y) => Date.parse(x.kind === 'stop' ? x.arrivedAt : x.startedAt) - Date.parse(y.kind === 'stop' ? y.arrivedAt : y.startedAt) || (x.kind === 'stop' ? -1 : 1));
    return { date, items };
  });
  app.get<{ Querystring: { driver?: string } }>('/api/places', async (req) => brain.stops.placesWithVisits(optStr(req.query.driver)));
  app.get<{ Querystring: { driver?: string } }>('/api/places/suggestions', async (req) => brain.stops.suggestions(optStr(req.query.driver)));
  app.post('/api/places', async (req, reply) => {
    try { return reply.code(201).send(brain.stops.createPlace(req.body ?? {}, brain.activeDriver().id).place); }
    catch (e) { if (e instanceof PlaceInputError) return reply.code(400).send({ error: e.message }); throw e; }
  });
  app.put<{ Params: { id: string } }>('/api/places/:id', async (req, reply) => {
    try { return brain.stops.updatePlace(Number(req.params.id), req.body ?? {}) ?? reply.code(404).send({ error: 'no such place' }); }
    catch (e) { if (e instanceof PlaceInputError) return reply.code(400).send({ error: e.message }); throw e; }
  });
  app.delete<{ Params: { id: string } }>('/api/places/:id', async (req, reply) =>
    brain.stops.deletePlace(Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'no such place' }));

  // ---- phone history import ----------------------------------------------------
  app.get('/api/import/phone', async () => brain.importer.status());
  app.post('/api/import/phone', async (req, reply) => {
    try { return reply.code(202).send(brain.importer.start(req.body ?? {})); }
    catch (e) { if (e instanceof ImportError) return reply.code(e.status).send({ error: e.message }); throw e; }
  });

  // ---- Home Assistant, gas, compare vehicle --------------------------------------
  app.get('/api/ha/status', async () => {
    if (!brain.ha.configured()) return { configured: false, reachable: false, message: NOT_CONFIGURED };
    try { await brain.ha.get('/api/'); return { configured: true, reachable: true, message: null }; }
    catch (e) { return { configured: true, reachable: false, message: (e as Error).message }; }
  });
  app.get('/api/ha/gasbuddy', async () => brain.gas.find());
  app.get<{ Querystring: { driver?: string } }>('/api/gas', async (req) => brain.gas.status(brain.compareVehicle(optStr(req.query.driver) ?? brain.activeDriver().id).fuel));
  app.post('/api/gas/refresh', async () => { await brain.gas.poll(); return brain.gas.status(brain.compareVehicle(brain.activeDriver().id).fuel); });
  const vehErr = (e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (e instanceof VehicleError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };
  app.get<{ Params: { level: string }; Querystring: { year?: string; make?: string; model?: string } }>('/api/vehicles/menu/:level', async (req, reply) => {
    const level = req.params.level as MenuLevel;
    if (!['year', 'make', 'model', 'options'].includes(level)) return reply.code(404).send({ error: 'level is year, make, model or options' });
    try { return await brain.vehicles.menu(level, req.query); } catch (e) { return vehErr(e, reply); }
  });
  app.get<{ Params: { id: string } }>('/api/vehicles/:id', async (req, reply) => {
    try { return await brain.vehicles.vehicle(Number(req.params.id)); } catch (e) { return vehErr(e, reply); }
  });

  // ---- charge sessions -----------------------------------------------------------
  const range = (q: { from?: string; to?: string }) => [isoOrNull(q.from), isoOrNull(q.to)] as const;
  app.get<{ Querystring: { from?: string; to?: string; driver?: string } }>('/api/charges', async (req) => brain.charges.store.list(...range(req.query), optStr(req.query.driver)));
  app.get<{ Querystring: { from?: string; to?: string; driver?: string } }>('/api/charges.csv', async (req, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="charges.csv"');
    return toCsv(brain.charges.store.list(...range(req.query), optStr(req.query.driver)).reverse());
  });
  app.get<{ Querystring: { period?: string; driver?: string } }>('/api/charges/summary', async (req) => {
    const period: Period = req.query.period === 'year' ? 'year' : 'month';
    const driver = optStr(req.query.driver);
    const vehicle = brain.compareVehicle(driver);
    // Phone trips are someone's phone, not the truck: they never count here.
    return summarize(brain.charges.store.list(null, null, driver), brain.trips.between(null, null, { driver, source: 'truck' }), period, { vehicle, priceFor: brain.gas.priceFor(vehicle.fuel) });
  });
  const gpsNow = () => { const g = brain.getState().gps; return g?.fix ? { lat: g.lat, lon: g.lon } : null; };
  app.post('/api/charges', async (req, reply) => {
    try { return reply.code(201).send(brain.charges.createManual(parseSessionInput(req.body ?? {}), brain.settings.get(), gpsNow(), brain.activeDriver().id)); }
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
