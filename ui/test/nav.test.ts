import { describe, expect, it } from 'vitest';
import { androidIntent, isAndroid, organicLink, pickApp, wazeLink } from '../src/lib/nav.ts';

const truck = { lat: 33.49905, lon: -111.97998 };
const charger = { name: 'Electrify America (Scottsdale)', lat: 33.6, lon: -111.9 };

describe('navigation links', () => {
  it('Waze: exact coordinates, else a search', () => {
    expect(wazeLink(charger)).toBe('https://waze.com/ul?ll=33.600000,-111.900000&navigate=yes');
    expect(wazeLink({ name: 'Dentist', query: '1 Main St, Mesa AZ' })).toBe('https://waze.com/ul?q=1%20Main%20St%2C%20Mesa%20AZ&navigate=yes');
    expect(wazeLink({ name: 'Nowhere' })).toBeNull();
  });
  it('Organic Maps: a driving route from the truck, the point without a fix, a search for an address', () => {
    expect(organicLink(charger, truck)).toBe('om://route?sll=33.499050,-111.979980&saddr=Truck&dll=33.600000,-111.900000&daddr=Electrify%20America%20(Scottsdale)&type=vehicle');
    expect(organicLink(charger, null)).toBe('om://map?ll=33.600000,-111.900000&n=Electrify%20America%20(Scottsdale)');
    expect(organicLink({ name: 'Dentist', query: '1 Main St' }, truck)).toBe('om://search?query=1%20Main%20St&ll=33.499050,-111.979980&map');
    expect(organicLink({ name: 'x', query: '  ' }, null)).toBeNull();
  });
  it('opens on Android through an intent naming the app, falling back to Google Play', () => {
    expect(androidIntent('om://map?ll=1.000000,2.000000&n=X')).toBe('intent://map?ll=1.000000,2.000000&n=X#Intent;scheme=om;package=app.organicmaps;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dapp.organicmaps;end');
    expect(() => androidIntent('https://x')).toThrow();
  });
  it('automatic picks the offline app only when the truck has no internet', () => {
    expect(pickApp('auto', false)).toBe('waze');
    expect(pickApp('auto', true)).toBe('organic');
    expect(pickApp('waze', true)).toBe('waze');
    expect(pickApp('organic', false)).toBe('organic');
  });
  it('spots the dash tablet', () => {
    expect(isAndroid('Mozilla/5.0 (Linux; Android 13; SM-T738U) Chrome/131')).toBe(true);
    expect(isAndroid('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe(false);
  });
});
