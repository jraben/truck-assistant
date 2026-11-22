import { describe, expect, it } from 'vitest';
import { batteryTone, batteryWords, compassPoint, dialAngle, explainCode, tireTone, withGaugesView } from '../src/gauges/logic.ts';

describe('gauges logic', () => {
  it('maps values onto a 240° sweep and clamps', () => {
    expect(dialAngle(0, 0, 100)).toBe(-120);
    expect(dialAngle(50, 0, 100)).toBe(0);
    expect(dialAngle(100, 0, 100)).toBe(120);
    expect(dialAngle(150, 0, 100)).toBe(120);
    expect(dialAngle(null, 0, 100)).toBe(-120);
  });
  it('reads the 12V battery in plain words', () => {
    expect(batteryWords(13.6)).toBe('Charging');
    expect(batteryWords(12.6)).toBe('Healthy');
    expect(batteryTone(12.0)).toBe('warn');
    expect(batteryTone(11.5)).toBe('bad');
    expect(batteryTone(null)).toBe('dim');
  });
  it('colours tyres like the Control screen', () => {
    expect(tireTone(40)).toBe('ok');
    expect(tireTone(30)).toBe('warn');
    expect(tireTone(55)).toBe('warn');
    expect(tireTone(25)).toBe('bad');
  });
  it('names compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(92)).toBe('E');
    expect(compassPoint(-90)).toBe('W');
    expect(compassPoint(null)).toBeNull();
  });
  it('explains fault codes', () => {
    const a = explainCode(' p0420 ');
    expect(a).toMatchObject({ code: 'P0420', valid: true, known: true, generic: true });
    expect(a.area).toContain('Emission');
    const b = explainCode('P1450');
    expect(b).toMatchObject({ valid: true, known: false, generic: false });
    expect(b.meaning).toContain('Maker-specific');
    expect(explainCode('P0999')).toMatchObject({ valid: true, known: false, generic: true });
    expect(explainCode('U0100').area).toContain('Network');
    expect(explainCode('X123').valid).toBe(false);
  });
  it('adds the Gauges view after Map, once', () => {
    const base = { views: [{ id: 'drive', label: 'Drive', widgets: [] }, { id: 'map', label: 'Map', widgets: [] }, { id: 'charge', label: 'Charge', widgets: [] }] };
    const out = withGaugesView(base);
    expect(out.views.map((v) => v.id)).toEqual(['drive', 'map', 'gauges', 'charge']);
    expect(withGaugesView(out)).toBe(out);
  });
});
