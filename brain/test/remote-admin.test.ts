import { afterEach, describe, expect, it } from 'vitest';
import { allowed, setAdminSessionCheck } from '../src/remote/auth.ts';

const req = (cookie?: string) => ({ ip: '192.168.1.50', headers: cookie ? { cookie } : {} });

describe('remote routes and the /settings login', () => {
  afterEach(() => setAdminSessionCheck(null));
  it('a LAN browser without the token is refused', () => {
    expect(allowed(req(), 'tok', ['127.0.0.0/8'])).toBe(false);
  });
  it('a valid admin session opens them', () => {
    setAdminSessionCheck((r) => String(r.headers.cookie ?? '').includes('session=good'));
    expect(allowed(req('session=good'), 'tok', ['127.0.0.0/8'])).toBe(true);
    expect(allowed(req('session=bad'), 'tok', ['127.0.0.0/8'])).toBe(false);
  });
  it('the token still works', () => {
    expect(allowed({ ip: '10.0.0.9', headers: { 'x-slate-token': 'tok' } }, 'tok', [])).toBe(true);
  });
});
