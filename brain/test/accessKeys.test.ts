import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AccessKeys, bearerKey, keyMayRead } from '../src/ops/auth.ts';

describe('read-only access keys', () => {
  it('read the diagnostic paths, and nothing else', () => {
    for (const p of ['/api/state', '/api/drive', '/api/charges?from=2000-01-01', '/api/update/version', '/api/sim', '/api/maps/areas']) expect(keyMayRead('GET', p), p).toBe(true);
    for (const p of ['/api/settings', '/api/backup', '/api/security/keys', '/api/logs', '/api/charges/receipts/mail', '/ws', '/api/cams']) expect(keyMayRead('GET', p), p).toBe(false);
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) expect(keyMayRead(m, '/api/sim')).toBe(false);
    expect(keyMayRead('GET', '/api/statefoo')).toBe(false);
  });
  it('take only a Bearer ta_ro_ key from the header', () => {
    expect(bearerKey('Bearer ta_ro_abc')).toBe('ta_ro_abc');
    expect(bearerKey('bearer   ta_ro_abc ')).toBe('ta_ro_abc');
    expect(bearerKey('Bearer something')).toBeNull();
    expect(bearerKey(undefined)).toBeNull();
    expect(bearerKey('Bearer ta_ro_' + 'x'.repeat(200))).toBeNull();
  });
  it('are stored hashed, shown once, checked, marked used, and revoked', () => {
    const k = new AccessKeys(new DatabaseSync(':memory:'));
    const made = k.create('  Claude  ', 1_000);
    expect(made.key).toMatch(/^ta_ro_[\w-]{40,}$/);
    expect(k.list()).toEqual([{ id: made.id, name: 'Claude', createdAt: new Date(1_000).toISOString(), lastUsedAt: null }]);
    expect(JSON.stringify(k.list())).not.toContain(made.key);
    expect(k.valid(made.key, 5_000)).toBe(true);
    expect(k.list()[0].lastUsedAt).toBe(new Date(5_000).toISOString());
    expect(k.valid('ta_ro_wrong')).toBe(false);
    expect(k.valid(null)).toBe(false);
    expect(k.revoke(made.id)).toBe(true);
    expect(k.valid(made.key)).toBe(false);
  });
});
