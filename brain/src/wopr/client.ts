// Calls to WOPR (Jeff's home AI system). Reached at Settings → WOPR URL with
// HTTP Basic auth (WOPR's APP_PASSWORD gate for API callers, middleware.ts).
// The password stays in the brain: the cockpit and phones only talk to the
// brain's /api/wopr/* routes.

export type WoprConfig = { url: string | null; username: string; password?: string };

export class WoprError extends Error {
  status: number;
  kind: 'not-configured' | 'offline' | 'auth' | 'restarting' | 'http' | 'timeout';
  constructor(kind: WoprError['kind'], message: string, status = 502) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export const NOT_CONFIGURED_MSG = 'Set the WOPR address and login on the settings page (Media and WOPR).';

export function authHeader(c: WoprConfig): string {
  return `Basic ${Buffer.from(`${c.username}:${c.password ?? ''}`).toString('base64')}`;
}

/**
 * fetch() against WOPR with Basic auth and a timeout. Throws WoprError for the
 * cases the cockpit words differently: not set up, can't reach it, wrong
 * login, WOPR mid-deploy (its gate answers an HTML maintenance page), other.
 */
export async function woprFetch(c: WoprConfig, p: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  if (!c.url) throw new WoprError('not-configured', NOT_CONFIGURED_MSG, 503);
  const { timeoutMs = 15_000, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('authorization', authHeader(c));
  let res: Response;
  try {
    res = await fetch(c.url + p, { ...rest, headers, signal: rest.signal ?? AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'TimeoutError') throw new WoprError('timeout', `WOPR didn't answer in ${Math.round(timeoutMs / 1000)} s.`, 504);
    throw new WoprError('offline', `Can't reach WOPR at ${c.url} (${err.message}).`, 502);
  }
  if (res.status === 401 || res.status === 403) throw new WoprError('auth', 'WOPR refused the login: check the username and password on the settings page.', 401);
  if (res.status >= 300 && res.status < 400) throw new WoprError('auth', 'WOPR sent us to its login page: check the username and password on the settings page.', 401);
  if (!res.ok) {
    const html = (res.headers.get('content-type') ?? '').includes('text/html');
    if (html || res.status === 502 || res.status === 503) throw new WoprError('restarting', 'WOPR is restarting (a deploy takes about a minute). Try again shortly.', 503);
    let body = '';
    try { body = (await res.text()).replace(/\s+/g, ' ').slice(0, 160); } catch { /* none */ }
    throw new WoprError('http', `WOPR answered ${res.status}${body ? `: ${body}` : ''}`, res.status >= 500 ? 502 : res.status);
  }
  if ((res.headers.get('content-type') ?? '').includes('text/html') && !p.startsWith('/api/where')) {
    // An API answering HTML is the login page or the gate's maintenance page.
    throw new WoprError('restarting', 'WOPR answered with a web page instead of data (login or maintenance page).', 503);
  }
  return res;
}

export async function woprJson<T>(c: WoprConfig, p: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const r = await woprFetch(c, p, init);
  return await r.json() as T;
}
