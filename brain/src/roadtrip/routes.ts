// Road-trip HTTP routes (docs/contract.md "Road trips").
import type { FastifyInstance } from 'fastify';
import { MAX_VIA, PlanError, type RoadTripService } from './service.ts';
import { STAY_BY_KIND, type TripWaypoint } from './types.ts';
import type { SampleStore } from './samples.ts';

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
function point(v: unknown): { lat: number; lon: number; name?: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const lat = num(o.lat, -90, 90), lon = num(o.lon, -180, 180);
  if (lat === null || lon === null) return null;
  return { lat, lon, ...(typeof o.name === 'string' && o.name.trim() ? { name: o.name.trim().slice(0, 120) } : {}) };
}

export function registerRoadTripRoutes(app: FastifyInstance, trips: RoadTripService, samples: SampleStore) {
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) => {
    if (e instanceof PlanError) return reply.code(409).send({ error: e.message });
    console.error('[roadtrip]', e);
    return reply.code(502).send({ error: `Planning failed: ${(e as Error)?.message ?? e}` });
  };

  app.get('/api/roadtrip', async () => trips.view());

  app.post('/api/roadtrip/plan', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const to = point(b.to);
    if (!to) return reply.code(400).send({ error: 'to must be {lat, lon, name?}' });
    const from = b.from === undefined || b.from === null ? null : point(b.from);
    if (b.from && !from) return reply.code(400).send({ error: 'from must be {lat, lon, name?} or left out (GPS)' });
    let via: TripWaypoint[] = [];
    if (b.via !== undefined && b.via !== null) {
      if (!Array.isArray(b.via) || b.via.length > MAX_VIA) return reply.code(400).send({ error: `via is a list of up to ${MAX_VIA} stops` });
      for (const [i, w] of (b.via as unknown[]).entries()) {
        const p = point(w);
        if (!p) return reply.code(400).send({ error: `via[${i}] needs lat and lon` });
        const o = w as Record<string, unknown>;
        const kind = typeof o.kind === 'string' ? o.kind : null;
        const stay = o.stayMin === undefined || o.stayMin === null ? STAY_BY_KIND[kind ?? 'other'] ?? 30 : num(o.stayMin, 0, 24 * 60);
        if (stay === null) return reply.code(400).send({ error: `via[${i}].stayMin is 0 to 1440 minutes` });
        const kw = o.chargeKw === undefined || o.chargeKw === null || o.chargeKw === 0 ? null : num(o.chargeKw, 0.5, 350);
        via.push({ name: p.name ?? `Stop ${i + 1}`, lat: p.lat, lon: p.lon, placeId: typeof o.placeId === 'number' ? o.placeId : null, kind, stayMin: Math.round(stay), chargeKw: kw });
      }
    }
    const startSoc = b.startSoc === undefined || b.startSoc === null ? null : num(b.startSoc, 0, 100);
    if (b.startSoc !== undefined && b.startSoc !== null && startSoc === null) return reply.code(400).send({ error: 'startSoc must be 0 to 100' });
    try { return await trips.planTrip({ to, from, startSoc, via }); } catch (e) { return fail(reply, e); }
  });

  app.post('/api/roadtrip/start', async (req, reply) => {
    const id = (req.body as { planId?: unknown } | null)?.planId;
    if (typeof id !== 'string') return reply.code(400).send({ error: 'planId required' });
    try { trips.start(id); return trips.view(); } catch (e) { return fail(reply, e); }
  });
  app.post('/api/roadtrip/stop', async () => { trips.stop(); return trips.view(); });
  app.post('/api/roadtrip/discard', async () => { trips.discardDraft(); return trips.view(); });
  app.post('/api/roadtrip/replan', async (_req, reply) => {
    if (!trips.view().active) return reply.code(409).send({ error: 'No trip in progress' });
    trips.replan('Replanned from here.');
    return trips.view();
  });

  // The learned charging curve, and the raw samples behind it.
  app.get('/api/charging/curve', async () => {
    const c = samples.curve();
    return { learnedBins: c.learnedBins, peakKw: c.peakKw, points: c.points };
  });
}
