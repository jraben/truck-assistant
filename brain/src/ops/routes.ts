// Track D routes and the login gate. Mounted from server.ts before the other
// routes so the gate's hook covers every route (docs/contract.md, Track D).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Brain } from '../brain.ts';
import { config } from '../config.ts';
import { PROJECT } from '../project.ts';
import { AuthError, checkNewPassword, hashPassword, isLocal, needsAuth, parseCookies, SESSION_COOKIE, SESSION_DAYS, verifyPassword } from './auth.ts';
import { RECEIPT_MAX, RECEIPT_TYPES } from './maintenance.ts';
import { localDate, toCsv, toHtml, type MileageFilter } from './mileage.ts';
import { loginPage, safeNext } from './loginPage.ts';
import { OpsInputError, PURPOSES, type Purpose } from './config.ts';
import { targetLabel } from './backup.ts';
import { OpsService } from './service.ts';
import { setAdminSessionCheck } from '../remote/auth.ts';

export const SETUP_STEPS = ['password', 'ap', 'truck', 'home', 'drivers', 'ha', 'hotspot', 'vehicle'] as const;

function dayStart(d: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString() : null;
}
function dayEnd(d: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1).toISOString() : null;
}

type MQ = { from?: string; to?: string; year?: string; driver?: string; purpose?: string };
export function mileageFilter(q: MQ): MileageFilter & { period: string } {
  let from: string | null = null, to: string | null = null, period = 'all trips';
  if (q.year && /^\d{4}$/.test(q.year)) { from = new Date(Number(q.year), 0, 1).toISOString(); to = new Date(Number(q.year) + 1, 0, 1).toISOString(); period = q.year; }
  if (q.from) { from = dayStart(q.from) ?? from; }
  if (q.to) { to = dayEnd(q.to) ?? to; }
  if (q.from || q.to) period = `${q.from ?? '…'} to ${q.to ?? 'now'}`;
  const purpose = q.purpose === 'untagged' ? 'untagged' : (PURPOSES as readonly string[]).includes(q.purpose ?? '') ? (q.purpose as Purpose) : null;
  return { from, to, driver: q.driver?.trim() || null, purpose, period };
}

export async function mountOps(app: FastifyInstance, brain: Brain): Promise<OpsService> {
  const ops = new OpsService(brain);
  app.addHook('onReady', async () => ops.start());
  app.addHook('onClose', async () => ops.stop());

  const sessionOf = (req: FastifyRequest) => parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const trusted = (req: FastifyRequest) => ops.store.get().auth.trustLocal && isLocal(req.ip);
  const authed = (req: FastifyRequest) => !ops.store.get().auth.passwordHash || trusted(req) || ops.sessions.valid(sessionOf(req));
  // A real login (password set + valid session) also opens the remote/camera routes.
  setAdminSessionCheck((req) => !!ops.store.get().auth.passwordHash && ops.sessions.valid(parseCookies(typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined)[SESSION_COOKIE]));

  // ---- the gate ------------------------------------------------------------------
  app.addHook('onRequest', async (req, reply) => {
    const kind = needsAuth(req.method, req.url);
    if (!kind || authed(req)) return;
    if (kind === 'page') return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
    return reply.code(401).send({ error: 'Log in first: open /login on this device' });
  });

  const fail = (e: unknown, reply: FastifyReply) => {
    if (e instanceof OpsInputError) return reply.code(400).send({ error: e.message });
    if (e instanceof AuthError) { if (e.retryAfterS) reply.header('retry-after', String(e.retryAfterS)); return reply.code(e.status).send({ error: e.message }); }
    throw e;
  };
  const setCookie = (reply: FastifyReply, token: string) => reply.header('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`);

  await app.register(async (r) => {
    r.addContentTypeParser(Object.keys(RECEIPT_TYPES), { parseAs: 'buffer', bodyLimit: RECEIPT_MAX }, (_req, body, done) => done(null, body));
    r.addContentTypeParser(['application/gzip', 'application/x-gzip', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: 512 * 1024 * 1024 }, (_req, body, done) => done(null, body));

    // ---- login -------------------------------------------------------------------
    r.get<{ Querystring: { next?: string } }>('/login', async (req, reply) => reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(loginPage(safeNext(req.query.next), !!ops.store.get().auth.passwordHash)));
    r.get('/api/auth/status', async (req) => ({ passwordSet: !!ops.store.get().auth.passwordHash, authed: authed(req), local: isLocal(req.ip), trustLocal: ops.store.get().auth.trustLocal }));
    r.post('/api/auth/login', async (req, reply) => {
      try {
        const key = req.ip || '?';
        const wait = ops.limiter.blockedFor(key);
        if (wait) throw new AuthError(`Too many tries. Wait ${Math.ceil(wait / 60_000)} min.`, 429, Math.ceil(wait / 1000));
        const hash = ops.store.get().auth.passwordHash;
        if (!hash) throw new AuthError('No password set yet', 400);
        const pw = (req.body as { password?: unknown } | null)?.password;
        if (typeof pw !== 'string' || !(await verifyPassword(pw, hash))) { ops.limiter.fail(key); throw new AuthError('Wrong password', 401); }
        ops.limiter.ok(key);
        setCookie(reply, ops.sessions.create(req.ip));
        return { ok: true };
      } catch (e) { return fail(e, reply); }
    });
    r.post('/api/auth/logout', async (req, reply) => { ops.sessions.revoke(sessionOf(req)); reply.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`); return { ok: true }; });
    /** Set or change the password. Changing needs the current one, even on the dash; every other session is logged out. */
    r.post('/api/auth/password', async (req, reply) => {
      try {
        const b = (req.body ?? {}) as { current?: unknown; next?: unknown };
        const cur = ops.store.get().auth;
        if (cur.passwordHash) {
          const key = req.ip || '?';
          const wait = ops.limiter.blockedFor(key);
          if (wait) throw new AuthError(`Too many tries. Wait ${Math.ceil(wait / 60_000)} min.`, 429, Math.ceil(wait / 1000));
          if (typeof b.current !== 'string' || !(await verifyPassword(b.current, cur.passwordHash))) { ops.limiter.fail(key); throw new AuthError('The current password is wrong', 401); }
          ops.limiter.ok(key);
        }
        const hash = await hashPassword(checkNewPassword(b.next));
        ops.store.set('auth', { ...cur, passwordHash: hash });
        ops.sessions.revokeAll();
        setCookie(reply, ops.sessions.create(req.ip));
        return { ok: true };
      } catch (e) { return fail(e, reply); }
    });
    r.put('/api/security/config', async (req, reply) => {
      const b = (req.body ?? {}) as { trustLocal?: unknown };
      if (typeof b.trustLocal !== 'boolean') return reply.code(400).send({ error: 'trustLocal must be true or false' });
      ops.store.set('auth', { ...ops.store.get().auth, trustLocal: b.trustLocal });
      return { trustLocal: b.trustLocal };
    });
    r.post('/api/security/logout-everywhere', async () => { ops.sessions.revokeAll(); return { ok: true }; });

    r.get('/api/about', async () => ({ ...PROJECT, version: config.version, installed: ops.updater.status().installed }));

    // ---- setup wizard --------------------------------------------------------------
    const setupState = () => {
      const s = ops.store.get().setup;
      return { ...s, stepsList: SETUP_STEPS, passwordSet: !!ops.store.get().auth.passwordHash, apInitialPassword: ops.initialApPassword() };
    };
    r.get('/api/setup', async () => setupState());
    r.put('/api/setup', async (req, reply) => {
      const b = (req.body ?? {}) as { step?: unknown; status?: unknown; done?: unknown; reset?: unknown };
      const s = structuredClone(ops.store.get().setup);
      if (b.reset === true) { s.done = false; s.steps = {}; }
      if (b.step !== undefined) {
        if (!(SETUP_STEPS as readonly string[]).includes(b.step as string)) return reply.code(400).send({ error: `step is one of ${SETUP_STEPS.join(', ')}` });
        if (b.status === null) delete s.steps[b.step as string];
        else if (b.status === 'done' || b.status === 'skipped') s.steps[b.step as string] = b.status;
        else return reply.code(400).send({ error: 'status is done, skipped or null' });
      }
      if (typeof b.done === 'boolean') s.done = b.done;
      if (SETUP_STEPS.every((k) => s.steps[k])) s.done = true;
      ops.store.set('setup', s);
      return setupState();
    });
    r.post('/api/setup/ap-password', async (req, reply) => {
      try { return await ops.setApPassword((req.body as { password?: unknown } | null)?.password); } catch (e) { return fail(e, reply); }
    });

    // ---- mileage -------------------------------------------------------------------
    r.get<{ Querystring: MQ }>('/api/mileage', async (req) => {
      const f = mileageFilter(req.query);
      return { ...ops.mileage.list(f), period: f.period, config: ops.store.get().mileage, odometerNow: ops.mileage.odometerNow() };
    });
    r.put('/api/mileage/tags', async (req, reply) => { try { return { changed: ops.mileage.tag(req.body) }; } catch (e) { return fail(e, reply); } });
    r.get('/api/mileage/config', async () => ops.store.get().mileage);
    r.put('/api/mileage/config', async (req, reply) => { try { const c = ops.mileage.updateConfig(req.body); ops.publishSummary(); return c; } catch (e) { return fail(e, reply); } });
    r.get('/api/odometer', async () => ({ estimate: ops.mileage.odometerNow(), anchor: ops.store.get().mileage.odometerAnchor, source: 'estimate' }));
    const exportName = (f: { period: string }, ext: string) => `mileage-${f.period.replace(/[^\w-]+/g, '_')}.${ext}`;
    r.get<{ Querystring: MQ }>('/api/mileage/export.csv', async (req, reply) => {
      const f = mileageFilter(req.query);
      const { rows, totals } = ops.mileage.list(f);
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${exportName(f, 'csv')}"`).send(toCsv(rows.slice().reverse(), totals));
    });
    r.get<{ Querystring: MQ }>('/api/mileage/export.html', async (req, reply) => {
      const f = mileageFilter(req.query);
      const { rows, totals } = ops.mileage.list(f);
      const s = brain.settings.get();
      const html = toHtml(rows.slice().reverse(), totals, { title: 'Vehicle mileage log', period: f.period + (f.driver ? ` · ${s.drivers.find((d) => d.id === f.driver)?.name ?? f.driver}` : '') + (f.purpose ? ` · ${f.purpose}` : ''), truck: `${PROJECT.name} truck "${s.truckId}"`, anchor: ops.store.get().mileage.odometerAnchor, generated: localDate(new Date().toISOString()) });
      return reply.type('text/html; charset=utf-8').send(html);
    });

    // ---- maintenance ---------------------------------------------------------------
    const maintView = () => { const odo = ops.mileage.odometerNow(); return { log: ops.maintenance.log(), reminders: ops.maintenance.statuses(odo), odometer: odo, notifyService: ops.store.get().maintenance.notifyService }; };
    r.get('/api/maintenance', async () => maintView());
    r.get('/api/maintenance/due', async () => {
      const odo = ops.mileage.odometerNow();
      return { odometer: odo, items: ops.maintenance.statuses(odo).filter((x) => x.state === 'due' || x.state === 'soon').sort((a, b) => (a.state === b.state ? 0 : a.state === 'due' ? -1 : 1)) };
    });
    r.post('/api/maintenance/log', async (req, reply) => { try { const e = ops.maintenance.add(req.body); ops.publishSummary(); return reply.code(201).send(e); } catch (e) { return fail(e, reply); } });
    r.put<{ Params: { id: string } }>('/api/maintenance/log/:id', async (req, reply) => { try { const e = ops.maintenance.update(Number(req.params.id), req.body); ops.publishSummary(); return e ?? reply.code(404).send({ error: 'no such entry' }); } catch (e) { return fail(e, reply); } });
    r.delete<{ Params: { id: string } }>('/api/maintenance/log/:id', async (req, reply) => (ops.maintenance.delete(Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'no such entry' })));
    r.post<{ Params: { id: string } }>('/api/maintenance/log/:id/receipt', { bodyLimit: RECEIPT_MAX }, async (req, reply) => {
      try {
        if (!Buffer.isBuffer(req.body)) throw new OpsInputError('send the photo itself as the body, with its content-type (image/jpeg, image/png, application/pdf…)');
        return ops.maintenance.saveReceipt(Number(req.params.id), String(req.headers['content-type'] ?? ''), req.body) ?? reply.code(404).send({ error: 'no such entry' });
      } catch (e) { return fail(e, reply); }
    });
    r.get<{ Params: { name: string } }>('/api/maintenance/receipts/:name', async (req, reply) => {
      const f = ops.maintenance.readReceipt(req.params.name);
      if (!f) return reply.code(404).send({ error: 'no such receipt' });
      return reply.type(f.type).header('x-content-type-options', 'nosniff').header('cache-control', 'private, max-age=3600').header('content-security-policy', "default-src 'none'").send(f.body);
    });
    r.put('/api/maintenance/reminders', async (req, reply) => { try { ops.maintenance.setReminders((req.body as { reminders?: unknown } | null)?.reminders ?? req.body, ops.mileage.odometerNow()); ops.publishSummary(); return maintView(); } catch (e) { return fail(e, reply); } });
    r.post<{ Params: { id: string } }>('/api/maintenance/reminders/:id/done', async (req, reply) => {
      const b = (req.body ?? {}) as { at?: unknown; odometer?: unknown };
      const at = typeof b.at === 'string' && Number.isFinite(Date.parse(b.at)) ? new Date(b.at).toISOString() : new Date().toISOString();
      const odo = b.odometer === undefined || b.odometer === null || b.odometer === '' ? ops.mileage.odometerNow() : Number(b.odometer);
      if (odo !== null && !Number.isFinite(odo)) return reply.code(400).send({ error: 'odometer must be a number' });
      if (!ops.maintenance.markDone(req.params.id, { at, odometer: odo })) return reply.code(404).send({ error: 'no such reminder' });
      ops.publishSummary();
      return maintView();
    });
    r.put('/api/maintenance/notify', async (req, reply) => { try { ops.maintenance.setNotify((req.body as { service?: unknown } | null)?.service); return maintView(); } catch (e) { return fail(e, reply); } });
    r.get<{ Querystring: { days?: string } }>('/api/tpms/history', async (req) => ops.maintenance.tpmsHistory(Number(req.query.days ?? 30) || 30));

    // ---- updates -------------------------------------------------------------------
    r.get('/api/update', async () => ops.updater.status());
    r.get('/api/update/version', async () => ops.updater.status().installed);
    r.post('/api/update/check', async () => ops.updater.check());
    r.post('/api/update/install', async (req, reply) => {
      try { const s = await ops.updater.install(optTag((req.body as { tag?: unknown } | null)?.tag)); ops.followUpdate(); return s; } catch (e) { return fail(e, reply); }
    });
    r.post('/api/update/rollback', async (_req, reply) => { try { const s = await ops.updater.rollback(); ops.followUpdate(); return s; } catch (e) { return fail(e, reply); } });
    r.put('/api/update/config', async (req, reply) => {
      const b = (req.body ?? {}) as { repo?: unknown; channel?: unknown };
      const cur = ops.store.get().updater;
      const repo = b.repo === undefined ? cur.repo : b.repo === null || b.repo === '' ? null : String(b.repo).trim();
      if (repo && !/^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/i.test(repo)) return reply.code(400).send({ error: 'repo must look like https://github.com/owner/name' });
      const channel = b.channel === undefined ? cur.channel : b.channel;
      if (channel !== 'stable' && channel !== 'main') return reply.code(400).send({ error: 'channel is stable or main' });
      ops.store.set('updater', { repo, channel });
      return ops.updater.status();
    });

    // ---- backups -------------------------------------------------------------------
    const maskTarget = () => { const t = structuredClone(ops.store.get().backup.target); if (t.kind === 'http' && t.auth) t.auth = '••••' + t.auth.slice(-2); return t; };
    r.get('/api/backup', async () => ({ config: { ...ops.store.get().backup, target: maskTarget() }, status: ops.backup, targetLabel: targetLabel(ops.store.get().backup.target), local: ops.localBackups() }));
    r.put('/api/backup/config', async (req, reply) => { try { ops.updateBackupConfig(req.body); return { config: { ...ops.store.get().backup, target: maskTarget() }, status: ops.backup }; } catch (e) { return fail(e, reply); } });
    r.post('/api/backup/run', async (_req, reply) => { try { return await ops.runBackup(); } catch (e) { return fail(e, reply); } });
    r.get('/api/backup/list', async () => ({ local: ops.localBackups(), target: await ops.targetBackups() }));
    r.get<{ Params: { name: string } }>('/api/backup/download/:name', async (req, reply) => {
      const b = ops.localBackups().find((x) => x.name === req.params.name);
      if (!b) return reply.code(404).send({ error: 'no such backup on the truck' });
      const { readFileSync } = await import('node:fs');
      const path = await import('node:path');
      return reply.type('application/gzip').header('content-disposition', `attachment; filename="${b.name}"`).send(readFileSync(path.join(ops.dataDir, 'backups', b.name)));
    });
    r.post('/api/backup/restore', async (req, reply) => {
      try {
        const b = (req.body ?? {}) as { name?: unknown; from?: unknown };
        const from = b.from === 'target' ? 'target' : 'local';
        return await ops.restore(String(b.name ?? ''), from);
      } catch (e) { return fail(e, reply); }
    });
    r.post('/api/backup/restore-upload', { bodyLimit: 512 * 1024 * 1024 }, async (req, reply) => {
      try { if (!Buffer.isBuffer(req.body)) throw new OpsInputError('send the .tar.gz as the body (content-type application/gzip)'); return await ops.restore('', 'upload', req.body); } catch (e) { return fail(e, reply); }
    });
  });

  return ops;
}

const optTag = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
