import { describe, expect, it } from 'vitest';
import { clientIp, trustedProxies } from '../src/clientIp.ts';

const req = (ip: string, headers: Record<string, string> = {}) => ({ ip, headers });
const NAS = ['172.17.0.1'];

describe('the client address behind the NAS proxy', () => {
  it('reads the forwarded address when the request comes from the proxy', () => {
    expect(clientIp(req('172.17.0.1', { 'x-forwarded-for': '192.168.1.26' }), NAS)).toBe('192.168.1.26');
    expect(clientIp(req('::ffff:172.17.0.1', { 'x-forwarded-for': '::ffff:192.168.1.26' }), NAS)).toBe('192.168.1.26');
  });

  it("takes the proxy's own entry, not what the client wrote further left", () => {
    expect(clientIp(req('172.17.0.1', { 'x-forwarded-for': '10.42.0.5, 192.168.1.26' }), NAS)).toBe('192.168.1.26');
  });

  it('skips proxies in the chain', () => {
    expect(clientIp(req('172.17.0.1', { 'x-forwarded-for': '192.168.1.26, 172.17.0.1' }), NAS)).toBe('192.168.1.26');
  });

  it('falls back to X-Real-IP, then the socket', () => {
    expect(clientIp(req('172.17.0.1', { 'x-real-ip': '192.168.1.26' }), NAS)).toBe('192.168.1.26');
    expect(clientIp(req('172.17.0.1'), NAS)).toBe('172.17.0.1');
  });

  it('ignores the headers from anyone who is not a listed proxy', () => {
    expect(clientIp(req('192.168.1.50', { 'x-forwarded-for': '192.168.1.26' }), NAS)).toBe('192.168.1.50');
    expect(clientIp(req('10.42.0.7', { 'x-forwarded-for': '127.0.0.1' }), [])).toBe('10.42.0.7');
  });

  it('reads the list from TRUSTED_PROXIES', () => {
    expect(trustedProxies(' 172.17.0.1 , 10.0.0.0/8,')).toEqual(['172.17.0.1', '10.0.0.0/8']);
    expect(trustedProxies(undefined)).toEqual([]);
  });
});
