// Alert delivery: Home Assistant's notify service first (the companion app on
// the phone), ntfy as the fallback (owners without HA, or HA unreachable).
// HA URL + token come from the main settings; the notify service, ntfy server,
// topic and token from remote.json. Tokens are never logged.
import type { Settings } from '../types.ts';
import type { AlertSettings } from './types.ts';

export type Delivery = { delivered: string[]; error: string | null };
export type PostFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export type Outgoing = { kind: string; title: string; message: string; priority: 'default' | 'high'; clickUrl: string | null };

/** The body for POST /api/services/notify/<service>. Pure. */
export function haNotifyBody(a: Outgoing): Record<string, unknown> {
  return {
    title: a.title,
    message: a.message,
    data: {
      tag: `slate-${a.kind}`,                       // a new alert of the same kind replaces the old one on the phone
      group: 'slate-truck',
      ...(a.clickUrl ? { url: a.clickUrl, clickAction: a.clickUrl } : {}),   // iOS / Android companion app
      ...(a.priority === 'high' ? { push: { 'interruption-level': 'time-sensitive' }, priority: 'high', ttl: 0 } : {}),
    },
  };
}

/** Headers for an ntfy publish. Pure. */
export function ntfyHeaders(a: Outgoing, token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'text/plain; charset=utf-8',
    // Headers are ASCII; ntfy decodes RFC 2047 for anything else ("Cabin 98°F").
    title: /^[\x20-\x7e]*$/.test(a.title) ? a.title : `=?UTF-8?B?${Buffer.from(a.title).toString('base64')}?=`,
    tags: a.priority === 'high' ? 'warning,truck' : 'truck',
    priority: a.priority === 'high' ? '4' : '3',
  };
  if (a.clickUrl) h.click = a.clickUrl;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

export class Notifier {
  private post: PostFn;
  constructor(post: PostFn = fetch as unknown as PostFn) { this.post = post; }

  configured(main: Settings, a: AlertSettings): string[] {
    const out: string[] = [];
    if (a.delivery.ha.service && main.homeAssistant.url && main.homeAssistant.token) out.push('ha');
    if (a.delivery.ntfy.topic) out.push('ntfy');
    return out;
  }

  async send(a: Outgoing, main: Settings, alerts: AlertSettings): Promise<Delivery> {
    const errs: string[] = [];
    const ha = main.homeAssistant, svc = alerts.delivery.ha.service;
    if (svc && ha.url && ha.token) {
      try {
        const res = await this.post(`${ha.url}/api/services/notify/${encodeURIComponent(svc.replace(/^notify\./, ''))}`, {
          method: 'POST', headers: { authorization: `Bearer ${ha.token}`, 'content-type': 'application/json' }, body: JSON.stringify(haNotifyBody(a)), signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return { delivered: ['ha'], error: null };
        errs.push(res.status === 401 ? 'Home Assistant refused the token' : res.status === 400 || res.status === 404 ? `Home Assistant has no ${svc}` : `Home Assistant answered ${res.status}`);
      } catch (e) { errs.push(`Home Assistant not reachable (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message})`); }
    }
    const nt = alerts.delivery.ntfy;
    if (nt.topic) {
      try {
        const res = await this.post(`${nt.server}/${encodeURIComponent(nt.topic)}`, { method: 'POST', headers: ntfyHeaders(a, nt.token), body: a.message, signal: AbortSignal.timeout(10_000) });
        if (res.ok) return { delivered: ['ntfy'], error: errs.length ? errs.join('; ') : null };
        errs.push(`ntfy answered ${res.status}`);
      } catch (e) { errs.push(`ntfy not reachable (${(e as Error).message})`); }
    }
    if (!svc && !nt.topic) errs.push('no delivery set up: pick a Home Assistant notify service or an ntfy topic in /settings > Alerts');
    else if (svc && !(ha.url && ha.token) && !nt.topic) errs.push('connect Home Assistant on the settings page (URL and token) to use its notify service');
    return { delivered: [], error: errs.join('; ') };
  }
}
