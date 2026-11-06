// /api/goal: the truck payoff goal (docs/contract.md, "Payoff goal"). Behind
// the Track D login like every other /api route (ops needsAuth).
import type { FastifyInstance } from 'fastify';
import { isDay } from '../settings.ts';
import { ledgerCsv } from './ledger.ts';
import { GoalInputError, type GoalService } from './service.ts';

const dayOrNull = (v: unknown) => (isDay(v) ? v : null);

export function registerGoalRoutes(app: FastifyInstance, goal: GoalService, changed: () => void) {
  app.get('/api/goal', async () => { goal.fresh(); return goal.summary(); });
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/goal/ledger', async (req) => {
    goal.fresh();
    return goal.ledger(dayOrNull(req.query.from), dayOrNull(req.query.to));
  });
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/goal/ledger.csv', async (req, reply) => {
    goal.fresh();
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="truck-payoff-ledger.csv"');
    return ledgerCsv(goal.ledger(dayOrNull(req.query.from), dayOrNull(req.query.to)));
  });
  app.post('/api/goal/recalc', async (req, reply) => {
    if ((req.body as { confirm?: unknown } | null)?.confirm !== true) return reply.code(400).send({ error: 'Recalculating rewrites every frozen month with today\'s vehicle and gas prices. Send {"confirm": true} to do it.' });
    goal.recalc();
    changed();
    return goal.summary();
  });

  const bad = (e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (e instanceof GoalInputError) return reply.code(400).send({ error: e.message });
    throw e;
  };
  app.get('/api/goal/adjustments', async () => goal.adjustments());
  app.post('/api/goal/adjustments', async (req, reply) => {
    try { const a = goal.addAdjustment(req.body ?? {}); changed(); return reply.code(201).send(a); } catch (e) { return bad(e, reply); }
  });
  app.put<{ Params: { id: string } }>('/api/goal/adjustments/:id', async (req, reply) => {
    try { const a = goal.updateAdjustment(Number(req.params.id), req.body ?? {}); if (a) changed(); return a ?? reply.code(404).send({ error: 'no such adjustment' }); } catch (e) { return bad(e, reply); }
  });
  app.delete<{ Params: { id: string } }>('/api/goal/adjustments/:id', async (req, reply) => {
    if (!goal.deleteAdjustment(Number(req.params.id))) return reply.code(404).send({ error: 'no such adjustment' });
    changed();
    return reply.code(204).send();
  });
}
