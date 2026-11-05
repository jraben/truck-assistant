import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { findKwh, findTotal, htmlToText, parseDate, parseDuration, parseReceipt, parseTime } from '../src/receipts/parse.ts';
import { matchSession, ReceiptError, ReceiptService } from '../src/receipts/service.ts';
import { openDb } from '../src/db.ts';
import { ChargeService } from '../src/charges/service.ts';
import { ChargeStore } from '../src/charges/store.ts';
import type { ChargeSession } from '../src/types.ts';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'receipts');
const fx = (f: string) => readFileSync(path.join(dir, f), 'utf8');
const local = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m - 1, d, h, mi).toISOString();

describe('receipt parsing', () => {
  it('Electrify America (HTML table, MST)', () => {
    const r = parseReceipt({ html: fx('electrify-america.html'), subject: 'Your Electrify America Receipt' })!;
    expect(r).toMatchObject({
      network: 'Electrify America', kwh: 41.236, cost: 23.09, confidence: 'high',
      stationName: 'Scottsdale Fashion Square - Parking Garage P3', address: '7014 E Camelback Rd, Scottsdale, AZ 85251',
      startedAt: '2026-11-02T22:14:00.000Z', endedAt: '2026-11-02T22:52:00.000Z',
    });
    expect(r.missing).toEqual([]);
  });

  it('ChargePoint (text, separate date and times, balance not mistaken for the total)', () => {
    const r = parseReceipt({ text: fx('chargepoint.txt') })!;
    expect(r).toMatchObject({ network: 'ChargePoint', kwh: 14.882, cost: 4.47, stationName: 'SCOTTSDALE QUARTER / STATION 2', startedAt: local(2026, 11, 3, 9, 5), endedAt: local(2026, 11, 3, 11, 12), confidence: 'high' });
  });

  it('EVgo (label-first kWh, fees summed by the receipt itself)', () => {
    const r = parseReceipt({ text: fx('evgo.txt'), from: 'receipts@evgo.com' })!;
    expect(r).toMatchObject({ network: 'EVgo', kwh: 35.2, cost: 17.89, stationName: "Fry's Food Store", startedAt: local(2026, 10, 28, 18, 41), endedAt: local(2026, 10, 28, 19, 15) });
  });

  it('Tesla Supercharger (one-line session range, kWh with a per-kWh price on the same line)', () => {
    const r = parseReceipt({ html: fx('tesla.html'), subject: 'Your Supercharging receipt' })!;
    expect(r).toMatchObject({ network: 'Tesla', kwh: 38.41, cost: 18.44, stationName: 'Tempe, AZ - Tempe Marketplace', startedAt: local(2026, 10, 30, 12, 2), endedAt: local(2026, 10, 30, 12, 31) });
  });

  it('an announcement with no total or kWh is not a receipt', () => {
    expect(parseReceipt({ text: fx('not-a-receipt.txt') })).toBeNull();
  });

  it('missing time falls back to when the email arrived, marked low confidence', () => {
    const r = parseReceipt({ text: 'ChargePoint\nEnergy: 10 kWh\nTotal: $3.00', receivedAt: '2026-11-04T18:00:00Z' })!;
    expect(r.startedAt).toBe('2026-11-04T18:00:00.000Z');
    expect(r.confidence).toBe('low');
    expect(r.missing).toContain('station');
  });

  it('end time past midnight rolls to the next day; duration fills a missing end', () => {
    const a = parseReceipt({ text: 'EVgo\nDate: 1/5/2027\nStart: 11:50 PM\nEnd: 12:20 AM\nkWh Delivered 20\nTotal Charged $9.00' })!;
    expect(Date.parse(a.endedAt!) - Date.parse(a.startedAt!)).toBe(30 * 60_000);
    const b = parseReceipt({ text: 'Electrify America\nSession Start: 2026-11-01 10:00 AM MST\nDuration: 1h 5m\nEnergy Delivered: 30 kWh\nTotal: $15.00' })!;
    expect(b.startedAt).toBe('2026-11-01T17:00:00.000Z');
    expect(b.endedAt).toBe('2026-11-01T18:05:00.000Z');
  });

  it('helpers', () => {
    expect(htmlToText('<tr><td>Total</td><td>&#36;5.00</td></tr>')).toBe('Total: $5.00');
    expect(findTotal(['Subtotal $9.00', 'Total $10.00'])).toBe(10);
    expect(findTotal(['Price: $0.56/kWh'])).toBeNull();
    expect(findKwh(['Price: $0.56/kWh', 'You added 12.5 kWh'])).toBe(12.5);
    expect(parseDate('Oct 30, 2026')).toEqual({ y: 2026, m: 9, d: 30 });
    expect(parseDate('3 November 2026')).toEqual({ y: 2026, m: 10, d: 3 });
    expect(parseTime('12:05 am')).toEqual({ min: 5, tz: null });
    expect(parseTime('3:14 PM MST')).toEqual({ min: 15 * 60 + 14, tz: 'MST' });
    expect(parseDuration('2 hr 7 min')).toBe(7620);
    expect(parseDuration('none')).toBeNull();
  });
});

describe('receipt drafts', () => {
  let tmp = '';
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); tmp = ''; });
  const setup = () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'slate-receipts-'));
    const db = openDb(tmp);
    const charges = new ChargeService(new ChargeStore(db));
    return { db, charges, svc: new ReceiptService(db, charges, () => 'jeff') };
  };

  it('imports a draft, refuses a repeat, confirms into a receipt session', () => {
    const { svc, charges, db } = setup();
    const a = svc.import({ html: fx('electrify-america.html'), messageId: '<abc@ea>' });
    expect(a.duplicate).toBe(false);
    expect(a.draft.state).toBe('draft');
    expect(svc.import({ html: fx('electrify-america.html'), messageId: '<abc@ea>' }).duplicate).toBe(true);
    expect(svc.list()).toHaveLength(1);
    const { session, draft } = svc.confirm(a.draft.id);
    expect(draft.state).toBe('confirmed');
    expect(session).toMatchObject({ source: 'receipt', costSource: 'receipt', cost: 23.09, kwh: 41.236, network: 'Electrify America', place: 'public', driverId: 'jeff' });
    expect(charges.store.list()).toHaveLength(1);
    expect(() => svc.confirm(a.draft.id)).toThrow(ReceiptError);
    db.close();
  });

  it('fills a detected session from the same charge instead of adding a second one', () => {
    const { svc, charges, db } = setup();
    const det = charges.store.create({ startedAt: '2026-11-02T22:10:00.000Z', endedAt: '2026-11-02T22:55:00.000Z', place: 'public', network: null, stationName: null, lat: 33.5, lon: -111.9, kwh: null, cost: null, costSource: null, startSoc: 20, endSoc: 80, maxKw: 150, note: null, source: 'detected', driverId: 'jeff' });
    const d = svc.import({ html: fx('electrify-america.html') }).draft;
    const { session } = svc.confirm(d.id);
    expect(session.id).toBe(det.id);
    expect(session).toMatchObject({ cost: 23.09, costSource: 'receipt', kwh: 41.236, network: 'Electrify America', startSoc: 20, source: 'detected' });
    expect(charges.store.list()).toHaveLength(1);
    db.close();
  });

  it('a receipt without a total needs one before it is logged; 422 for non-receipts', () => {
    const { svc, db } = setup();
    const d = svc.import({ text: 'Electrify America\nEnergy Delivered: 22 kWh' }).draft;
    expect(() => svc.confirm(d.id)).toThrow(/total/);
    expect(svc.confirm(d.id, { cost: 11.5 }).session.cost).toBe(11.5);
    try { svc.import({ text: fx('not-a-receipt.txt') }); throw new Error('no'); } catch (e) { expect((e as ReceiptError).status).toBe(422); }
    db.close();
  });

  it('dismiss hides a draft', () => {
    const { svc, db } = setup();
    const d = svc.import({ text: fx('evgo.txt') }).draft;
    expect(svc.dismiss(d.id)).toBe(true);
    expect(svc.list()).toHaveLength(0);
    expect(svc.list('dismissed')).toHaveLength(1);
    db.close();
  });

  it('matchSession: only detected, non-home, unpriced sessions within 3 h', () => {
    const base = { endedAt: null, network: null, stationName: null, lat: null, lon: null, kwh: null, costSource: null, startSoc: null, endSoc: null, maxKw: null, note: null, driverId: null } as const;
    const s = (id: number, startedAt: string, extra: Partial<ChargeSession>): ChargeSession => ({ ...base, id, startedAt, place: 'public', cost: null, source: 'detected', ...extra });
    const list = [
      s(1, '2026-11-02T10:00:00Z', { place: 'home' }),
      s(2, '2026-11-02T11:00:00Z', { cost: 5 }),
      s(3, '2026-11-02T09:00:00Z', { source: 'manual' }),
      s(4, '2026-11-02T13:30:00Z', {}),
      s(5, '2026-11-02T16:00:00Z', {}),
    ];
    expect(matchSession({ startedAt: '2026-11-02T12:00:00Z' }, list)?.id).toBe(4);
    expect(matchSession({ startedAt: '2026-11-03T12:00:00Z' }, list)).toBeNull();
  });
});
