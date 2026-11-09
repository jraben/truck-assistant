// Contacts HTTP routes (docs/contract.md "Contacts").
import type { FastifyInstance } from 'fastify';
import type { Outgoing, Delivery } from '../remote/notify.ts';
import { ContactsError, type ContactService } from './service.ts';
import { SourceError } from './sources.ts';

/** Where Google sends the browser back. On the truck's own screen this reaches the brain; elsewhere the address is pasted back. */
export const googleRedirect = (port: number) => `http://127.0.0.1:${port}/api/contacts/google/callback`;

export function registerContacts(app: FastifyInstance, contacts: ContactService, port: number, push: (o: Outgoing) => Promise<Delivery>) {
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) => {
    if (e instanceof ContactsError) return reply.code(400).send({ error: e.message });
    if (e instanceof SourceError) return reply.code(e.auth ? 401 : 502).send({ error: e.message });
    throw e;
  };
  const redirect = googleRedirect(port);

  app.get<{ Querystring: { q?: string } }>('/api/contacts', async (req) => contacts.list(req.query.q ?? null));
  app.get('/api/contacts/status', async () => ({ ...contacts.view(), googleRedirect: redirect }));
  app.put('/api/contacts/settings', async (req, reply) => { try { contacts.setClients((req.body ?? {}) as Record<string, unknown>); return contacts.view(); } catch (e) { return fail(reply, e); } });
  app.post('/api/contacts/sync', async () => { await contacts.syncAll(); return contacts.view(); });
  app.delete<{ Params: { id: string } }>('/api/contacts/source/:id', async (req, reply) => { try { contacts.remove(decodeURIComponent(req.params.id)); return contacts.view(); } catch (e) { return fail(reply, e); } });

  app.post('/api/contacts/outlook/start', async (_req, reply) => { try { return await contacts.outlookStart(); } catch (e) { return fail(reply, e); } });
  app.post('/api/contacts/google/start', async (_req, reply) => { try { return { url: contacts.googleUrl(redirect), redirect }; } catch (e) { return fail(reply, e); } });
  app.post('/api/contacts/google/finish', async (req, reply) => {
    const pasted = (req.body as { url?: unknown } | null)?.url;
    if (typeof pasted !== 'string' || !pasted.trim()) return reply.code(400).send({ error: 'Paste the address Google sent you to.' });
    try { await contacts.googleFinish(pasted, redirect); return contacts.view(); } catch (e) { return fail(reply, e); }
  });
  // On the truck's own screen Google comes straight back here.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/contacts/google/callback', async (req, reply) => {
    try {
      await contacts.googleFinish(`${redirect}?${new URLSearchParams(req.query as Record<string, string>).toString()}`, redirect);
      return reply.type('text/html').send('<p style="font:18px sans-serif">Google contacts connected. You can close this tab.</p><script>setTimeout(()=>location.href="/settings#contacts",1500)</script>');
    } catch (e) { return reply.code(400).type('text/plain').send((e as Error).message); }
  });
  app.post('/api/contacts/carddav', async (req, reply) => { try { await contacts.addCardDav((req.body ?? {}) as Record<string, unknown>); return contacts.view(); } catch (e) { return fail(reply, e); } });

  /** "Call from my phone": a notification on the phone whose tap opens the dialer with the number. */
  app.post<{ Params: { id: string } }>('/api/contacts/:id/call', async (req, reply) => {
    const c = contacts.get(Number(req.params.id));
    const number = (req.body as { number?: unknown } | null)?.number;
    if (!c) return reply.code(404).send({ error: 'No such contact' });
    const phone = c.phones.find((p) => p.number === number) ?? c.phones[0];
    if (!phone) return reply.code(409).send({ error: `${c.name} has no phone number` });
    const tel = `tel:${phone.number.replace(/[^\d+*#,]/g, '')}`;
    const r = await push({ kind: 'call', title: `Call ${c.name}`, message: `Tap to call ${phone.number} (${phone.label})`, priority: 'high', clickUrl: tel });
    return r.delivered.length ? { ok: true, delivered: r.delivered, tel } : reply.code(502).send({ error: r.error ?? 'Not delivered', tel });
  });
}
