import { describe, expect, it } from 'vitest';
import { batteryPaths } from '../src/settings/TabletBattery.tsx';
import type { BatterySample } from '../../brain/src/tabletBattery.ts';

const T0 = Date.parse('2026-11-20T00:00:00Z');
const s = (min: number, level: number, charging: boolean, screen: boolean): BatterySample => ({ t: new Date(T0 + min * 60_000).toISOString(), level, charging, screen, source: 'page' });

describe('battery graph', () => {
  it('draws the level, breaks it where the reports stop, and marks charging and screen-on', () => {
    const p = batteryPaths([s(0, 80, true, true), s(5, 81, true, true), s(10, 80, false, true), s(15, 79, false, false), s(500, 60, false, false)], T0, T0 + 600 * 60_000);
    expect(p.line).toHaveLength(2);       // before and after the long silence
    expect(p.gaps).toHaveLength(1);       // the silence, dashed
    expect(p.bands.filter((b) => b.kind === 'charging')).toHaveLength(2);
    expect(p.bands.filter((b) => b.kind === 'screen')).toHaveLength(3);
    expect(p.line[0].startsWith('M0 ')).toBe(true);
  });
});
