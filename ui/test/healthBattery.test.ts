import { describe, expect, it } from 'vitest';
import { TABLET_LOW_PCT, tabletBattery } from '../src/components/health.tsx';

describe('Health bar: tablet battery', () => {
  it('is left out when the browser will not say', () => {
    expect(tabletBattery({ level: null, charging: null })).toBeNull();
  });
  it('shows the percent, green when not low', () => {
    expect(tabletBattery({ level: 64, charging: false })).toEqual({ pct: 64, tone: 'ok', charging: false, say: 'On battery · 64%' });
  });
  it('is red when low, even while charging', () => {
    const b = tabletBattery({ level: TABLET_LOW_PCT - 1, charging: true })!;
    expect(b.tone).toBe('bad');
    expect(b.charging).toBe(true);
    expect(b.say).toBe(`Charging · ${TABLET_LOW_PCT - 1}% (low)`);
  });
  it('the threshold itself is not low', () => {
    expect(tabletBattery({ level: TABLET_LOW_PCT, charging: false })!.tone).toBe('ok');
  });
  it('says plain Battery when charging is unknown', () => {
    expect(tabletBattery({ level: 50, charging: null })!.say).toBe('Battery · 50%');
  });
});
