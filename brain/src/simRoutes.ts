// The test panel's routes (SIM=1 only): drive the simulated truck by hand,
// fake truck-box events, and reset the desk cameras. On a real truck every
// route here answers 404, so nothing in the panel can reach real hardware.
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Brain } from './brain.ts';
import type { RemoteService } from './remote/service.ts';
import { defaultCameras } from './remote/store.ts';
import { SimError, type SimControl } from './sim.ts';

export function registerSim(app: FastifyInstance, brain: Brain, remote: RemoteService) {
  const off = (reply: FastifyReply) => reply.code(404).send({ error: 'Not a simulated truck (SIM=1 is off)' });
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof SimError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  app.get('/api/sim', async (_req, reply) => {
    const sim = brain.simTruck;
    return sim ? sim.status() : off(reply);
  });

  app.post('/api/sim', async (req, reply) => {
    const sim = brain.simTruck;
    if (!sim) return off(reply);
    try { return sim.control((req.body ?? {}) as Partial<SimControl>); } catch (e) { return fail(reply, e); }
  });

  app.post<{ Body: { leg?: number } }>('/api/sim/jump', async (req, reply) => {
    const sim = brain.simTruck;
    if (!sim) return off(reply);
    try { return sim.jump(Number(req.body?.leg ?? 0)); } catch (e) { return fail(reply, e); }
  });

  app.post<{ Body: { seconds?: number } }>('/api/sim/tow', async (req, reply) => {
    const sim = brain.simTruck;
    if (!sim) return off(reply);
    return sim.tow(Number(req.body?.seconds ?? 90));
  });

  /** A knock on the truck box's vibration sensor (parked-motion alert path). */
  app.post('/api/sim/bump', async (_req, reply) => {
    if (!brain.simTruck) return off(reply);
    const topic = `${brain.settings.get().truckId}/truckbox/binary_sensor/vibration/state`;
    brain.emit('mqtt', topic, 'ON');
    setTimeout(() => brain.emit('mqtt', topic, 'OFF'), 2000);
    return { ok: true };
  });

  /** Back to the desk camera set: rear, front, hitch, bed and 360, all test patterns. */
  app.post('/api/sim/cameras', async (_req, reply) => {
    if (!brain.simTruck) return off(reply);
    remote.store.update({ cams: { cameras: defaultCameras(true) } });
    return remote.camStatus();
  });
}
