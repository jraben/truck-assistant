// Track A HTTP routes (docs/contract.md "Track A: Drive").
import type { FastifyInstance } from 'fastify';
import type { DriveService } from './service.ts';

export function registerDriveRoutes(app: FastifyInstance, drive: DriveService) {
  app.get('/api/drive', async () => drive.state());
  app.post('/api/drive/range-mode', async (req, reply) => {
    const mode = (req.body as { mode?: unknown } | null)?.mode;
    if (mode !== 'auto' && mode !== 'city' && mode !== 'highway') return reply.code(400).send({ error: 'mode must be auto, city or highway' });
    drive.setOverride(mode);
    return drive.state();
  });
  app.get('/api/weather', async (_req, reply) => {
    const r = drive.weather.report;
    if (!r) return reply.code(503).send({ error: drive.state().weatherWhy ?? 'No weather yet' });
    return { ...r, error: drive.weather.error };
  });
  app.get('/api/brightness', async () => drive.state().brightness);
  app.post('/api/brightness', async (req, reply) => {
    const b = (req.body ?? {}) as { auto?: unknown; pct?: unknown };
    if (b.pct !== undefined && (typeof b.pct !== 'number' || !(b.pct >= 1 && b.pct <= 100))) return reply.code(400).send({ error: 'pct must be 1 to 100' });
    if (b.auto !== undefined && typeof b.auto !== 'boolean') return reply.code(400).send({ error: 'auto must be true or false' });
    drive.setBrightness(b);
    return drive.state().brightness;
  });
}
