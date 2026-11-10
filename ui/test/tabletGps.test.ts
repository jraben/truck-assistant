import { describe, expect, it } from 'vitest';
import { gpsMessage, wantsTabletGps } from '../src/lib/tabletGps.ts';

describe('the dash tablet as GPS', () => {
  it('sends only from an Android tablet (or the desk test), with the setting on', () => {
    const android = 'Mozilla/5.0 (Linux; Android 14; SM-T733) Chrome/130';
    expect(wantsTabletGps({ setting: undefined, ua: android, deskTest: false, hasGeo: true })).toBe(true);
    expect(wantsTabletGps({ setting: false, ua: android, deskTest: false, hasGeo: true })).toBe(false);
    expect(wantsTabletGps({ setting: true, ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', deskTest: false, hasGeo: true })).toBe(false);
    expect(wantsTabletGps({ setting: true, ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', deskTest: true, hasGeo: true })).toBe(true);
    expect(wantsTabletGps({ setting: true, ua: android, deskTest: false, hasGeo: false })).toBe(false);
  });

  it('sends the position, accuracy, speed and heading the brain expects', () => {
    expect(gpsMessage({ latitude: 33.4, longitude: -111.9, accuracy: 5, speed: 20, heading: NaN, altitude: null }))
      .toEqual({ type: 'gps', lat: 33.4, lon: -111.9, accM: 5, speedMps: 20, headingDeg: null, altM: null });
  });
});
