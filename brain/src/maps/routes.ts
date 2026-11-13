// Offline maps HTTP routes (docs/contract.md "Offline maps").
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { MapsError, MapsService } from './service.ts';
import { bboxAround, countTiles, MAX_ZOOM, parseBbox } from './tiles.ts';

export function registerMapsRoutes(app: FastifyInstance, dataDir: string, db: Db, truckAt: () => { lat: number; lon: number } | null): MapsService {
  const maps = new MapsService(dataDir, db);
  maps.start();
  app.addHook('onClose', async () => maps.close());
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) => {
    if (e instanceof MapsError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  app.get('/api/maps', async () => maps.view());
  app.put('/api/maps', async (req, reply) => {
    const on = (req.body as { enabled?: unknown } | null)?.enabled;
    if (typeof on !== 'boolean') return reply.code(400).send({ error: 'enabled must be true or false' });
    maps.setEnabled(on);
    return maps.view();
  });

  /** {bbox} or {aroundTruckMi}: the box, and how many tiles each detail level would be. */
  app.post('/api/maps/estimate', async (req, reply) => {
    const b = (req.body ?? {}) as { bbox?: unknown; aroundTruckMi?: unknown };
    const bbox = boxOf(b, truckAt);
    if (typeof bbox === 'string') return reply.code(400).send({ error: bbox });
    const zooms: Record<number, number> = {};
    for (let z = 10; z <= MAX_ZOOM; z++) zooms[z] = countTiles(bbox, z);
    return { bbox, tiles: zooms };
  });

  app.post('/api/maps/areas', async (req, reply) => {
    const b = (req.body ?? {}) as { name?: unknown; bbox?: unknown; aroundTruckMi?: unknown; maxZoom?: unknown };
    const bbox = boxOf(b, truckAt);
    if (typeof bbox === 'string') return reply.code(400).send({ error: bbox });
    try { return maps.add(typeof b.name === 'string' ? b.name : '', bbox, Number(b.maxZoom ?? 14)); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/api/maps/areas/:id/download', async (req, reply) => {
    try { return maps.download(Number(req.params.id), (req.body as { fresh?: unknown } | null)?.fresh === true); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string } }>('/api/maps/areas/:id', async (req, reply) => (maps.remove(Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'no such area' })));

  // Vector tiles for the cockpit's maps, stored gzip-compressed exactly as Protomaps serves them.
  app.get<{ Params: { z: string; x: string; file: string } }>('/api/maps/tiles/:z/:x/:file', async (req, reply) => {
    const m = /^(\d+)\.mvt$/.exec(req.params.file);
    const z = Number(req.params.z), x = Number(req.params.x), y = m ? Number(m[1]) : NaN;
    if (!m || !Number.isInteger(z) || !Number.isInteger(x) || z < 0 || z > MAX_ZOOM) return reply.code(400).send({ error: 'bad tile' });
    const t = maps.tile(z, x, y);
    // 404, not 204: the map layer leaves a missing tile transparent, so the online map shows through.
    if (!t) return reply.code(404).send();
    return reply.header('Content-Type', 'application/vnd.mapbox-vector-tile').header('Content-Encoding', 'gzip').header('Cache-Control', 'public, max-age=3600').send(Buffer.from(t));
  });
  return maps;
}

function boxOf(b: { bbox?: unknown; aroundTruckMi?: unknown }, truckAt: () => { lat: number; lon: number } | null) {
  if (b.aroundTruckMi !== undefined) {
    const mi = Number(b.aroundTruckMi);
    if (!(mi >= 1 && mi <= 300)) return 'aroundTruckMi must be 1 to 300';
    const p = truckAt();
    if (!p) return 'No GPS fix: the truck’s position isn’t known yet';
    return bboxAround(p.lat, p.lon, mi);
  }
  return parseBbox(b.bbox);
}
