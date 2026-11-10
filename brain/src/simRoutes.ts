// The test panel's routes (SIM=1 only): drive the simulated truck by hand,
// fake truck-box events, and reset the desk cameras. On a real truck every
// route here answers 404, so nothing in the panel can reach real hardware.
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Brain } from './brain.ts';
import type { RemoteService } from './remote/service.ts';
import { defaultCameras } from './remote/store.ts';
import { config } from './config.ts';
import { SimError, type ChargeKind, type SimControl, type SimStatus } from './sim.ts';

export function registerSim(app: FastifyInstance, brain: Brain, remote: RemoteService) {
  const off = (reply: FastifyReply) => reply.code(404).send({ error: 'Not a simulated truck (SIM=1 is off)' });
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof SimError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  /** Every answer carries the charge level, so the panel can show it beside the plug. */
  const withSoc = (st: SimStatus) => ({ ...st, ...brain.socNow });

  app.get('/api/sim', async (_req, reply) => {
    const sim = brain.simTruck;
    return sim ? { ...withSoc(sim.status()), demo: config.demo } : off(reply);
  });

  app.post('/api/sim', async (req, reply) => {
    const sim = brain.simTruck;
    if (!sim) return off(reply);
    try { return withSoc(sim.control((req.body ?? {}) as Partial<SimControl>)); } catch (e) { return fail(reply, e); }
  });

  app.post<{ Body: { leg?: number } }>('/api/sim/jump', async (req, reply) => {
    const sim = brain.simTruck;
    if (!sim) return off(reply);
    try { return withSoc(sim.jump(Number(req.body?.leg ?? 0))); } catch (e) { return fail(reply, e); }
  });

  app.post<{ Body: { seconds?: number } }>('/api/sim/tow', async (req, reply) => {
    const sim = brain.simTruck;
    if (!sim) return off(reply);
    return withSoc(sim.tow(Number(req.body?.seconds ?? 90)));
  });

  /** Plug in: home wall charger or DC fast, up to `target` percent. */
  app.post<{ Body: { kind?: ChargeKind; target?: number } }>('/api/sim/charge', async (req, reply) => {
    const sim = brain.simTruck;
    if (!sim) return off(reply);
    try { return withSoc(sim.plugIn(req.body?.kind ?? 'home', Number(req.body?.target ?? 80))); } catch (e) { return fail(reply, e); }
  });

  app.post('/api/sim/unplug', async (_req, reply) => {
    const sim = brain.simTruck;
    return sim ? withSoc(sim.unplug()) : off(reply);
  });

  /** Set the charge level outright (the same as the cockpit's slider: a rise while parked logs a charge). */
  app.post<{ Body: { value?: number } }>('/api/sim/soc', async (req, reply) => {
    const sim = brain.simTruck;
    if (!sim) return off(reply);
    const v = Number(req.body?.value);
    if (!Number.isFinite(v) || v < 0 || v > 100) return reply.code(400).send({ error: 'value: 0 to 100' });
    brain.setManualSoc(v);
    return withSoc(sim.status());
  });

  /** A knock on the truck box's vibration sensor (parked-motion alert path). */
  app.post('/api/sim/bump', async (_req, reply) => {
    if (!brain.simTruck) return off(reply);
    const topic = `${brain.settings.get().truckId}/truckbox/binary_sensor/vibration/state`;
    brain.emit('mqtt', topic, 'ON');
    setTimeout(() => brain.emit('mqtt', topic, 'OFF'), 2000);
    return { ok: true };
  });

  /** Desk test of the tablet-as-GPS path: positions come from this browser's location, not the simulated drive. */
  app.post('/api/sim/gps-device', async (req, reply) => {
    if (!brain.simTruck) return off(reply);
    brain.setSimGpsFromDevice((req.body as { on?: unknown } | null)?.on === true);
    return { on: brain.simGpsFromDevice };
  });

  /** A made-up flight into Phoenix (lands in ~25 min), so the whole airport pickup flow runs at a desk. No flight-tracking calls go out. */
  app.post('/api/sim/flight', async (req, reply) => {
    if (!brain.simTruck) return off(reply);
    const b = (req.body ?? {}) as { flight?: unknown; who?: unknown };
    try { return await brain.pickup.simInbound(typeof b.flight === 'string' && b.flight.trim() ? b.flight : 'AA 1234', typeof b.who === 'string' ? b.who.slice(0, 40) : 'Test passenger'); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  /** Back to the desk camera set: rear, front, hitch, bed and 360, all test patterns. */
  app.post('/api/sim/cameras', async (_req, reply) => {
    if (!brain.simTruck) return off(reply);
    remote.store.update({ cams: { cameras: defaultCameras(true) } });
    return remote.camStatus();
  });
}
