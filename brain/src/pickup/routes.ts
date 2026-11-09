// Airport pickup HTTP routes (docs/contract.md "Airport pickup").
import type { FastifyInstance } from 'fastify';
import { PickupError, type PickupService } from './service.ts';

export function registerPickup(app: FastifyInstance, pickup: PickupService) {
  app.get('/api/pickup', async () => pickup.view());
  app.post('/api/pickup', async (req, reply) => {
    const b = (req.body ?? {}) as { flight?: unknown; who?: unknown; bags?: unknown };
    if (typeof b.flight !== 'string' || !b.flight.trim()) return reply.code(400).send({ error: 'flight is required (e.g. AA 1234)' });
    try { return await pickup.start({ flight: b.flight, who: typeof b.who === 'string' ? b.who.slice(0, 40) : null, bags: b.bags === true }); }
    catch (e) { if (e instanceof PickupError) return reply.code(400).send({ error: e.message }); throw e; }
  });
  app.delete('/api/pickup', async () => { pickup.cancel(); return pickup.view(); });
}
