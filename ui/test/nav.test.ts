import { describe, expect, it } from 'vitest';
import { abrpText, androidIntent, comapsLink, isAndroid, organicLink, osmandLink, pickApp, tabletLink, wazeLink } from '../src/lib/nav.ts';

const truck = { lat: 33.49905, lon: -111.97998 };
const charger = { name: 'Electrify America (Scottsdale)', lat: 33.6, lon: -111.9 };
const appt = { name: 'Dentist', query: '1 Main St' };

describe('navigation links', () => {
  it('Waze: exact coordinates, else a search', () => {
    expect(wazeLink(charger)).toBe('https://waze.com/ul?ll=33.600000,-111.900000&navigate=yes');
    expect(wazeLink({ name: 'Dentist', query: '1 Main St, Mesa AZ' })).toBe('https://waze.com/ul?q=1%20Main%20St%2C%20Mesa%20AZ&navigate=yes');
    expect(wazeLink({ name: 'Nowhere' })).toBeNull();
  });
  it('Organic Maps: route from the truck (all five parameters, in order), the point without a fix, a search near the truck', () => {
    expect(organicLink(charger, truck)).toBe('om://route?sll=33.499050,-111.979980&saddr=Truck&dll=33.600000,-111.900000&daddr=Electrify%20America%20(Scottsdale)&type=vehicle');
    expect(organicLink(charger, null)).toBe('om://map?ll=33.600000,-111.900000&n=Electrify%20America%20(Scottsdale)');
    expect(organicLink(appt, truck)).toBe('om://search?query=1%20Main%20St&cll=33.499050,-111.979980&map');
    expect(organicLink({ name: 'x', query: '  ' }, null)).toBeNull();
  });
  it('CoMaps: the same API under its own cm:// scheme (it does not open om://)', () => {
    expect(comapsLink(charger, truck)).toBe('cm://route?sll=33.499050,-111.979980&saddr=Truck&dll=33.600000,-111.900000&daddr=Electrify%20America%20(Scottsdale)&type=vehicle');
    expect(comapsLink(appt, null)).toBe('cm://search?query=1%20Main%20St&map');
  });
  it('OsmAnd: osmand.net/map with end (and start when known), car profile; needs a point', () => {
    expect(osmandLink(charger, truck)).toBe('https://osmand.net/map/?start=33.499050,-111.979980&end=33.600000,-111.900000&profile=car');
    expect(osmandLink(charger, null)).toBe('https://osmand.net/map/?end=33.600000,-111.900000&profile=car');
    expect(osmandLink(appt, truck)).toBeNull();
  });
  it('ABRP gets text to paste', () => {
    expect(abrpText(charger)).toBe('33.600000, -111.900000');
    expect(abrpText(appt)).toBe('1 Main St');
  });
  it('opens on the tablet through Chrome intents: Organic Maps and OsmAnd by package, CoMaps by scheme (both its builds)', () => {
    expect(androidIntent('om://map?ll=1,2&n=X', { package: 'app.organicmaps', fallbackPackage: 'app.organicmaps' }))
      .toBe('intent://map?ll=1,2&n=X#Intent;scheme=om;package=app.organicmaps;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dapp.organicmaps;end');
    expect(tabletLink('comaps', charger, null)).toBe('intent://map?ll=33.600000,-111.900000&n=Electrify%20America%20(Scottsdale)#Intent;scheme=cm;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dapp.comaps.google;end');
    expect(tabletLink('osmand', charger, null, 'net.osmand.plus')).toBe('intent://osmand.net/map/?end=33.600000,-111.900000&profile=car#Intent;scheme=https;package=net.osmand.plus;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dnet.osmand.plus;end');
    expect(tabletLink('waze', charger, null)).toBeNull();
    expect(() => androidIntent('not a link', { fallbackPackage: 'x' })).toThrow();
  });
  it('picks the first app: a fixed choice if shown; automatic goes offline-first without signal', () => {
    const all = ['waze', 'comaps', 'organic', 'osmand', 'abrp'] as const;
    expect(pickApp('auto', false, [...all])).toBe('waze');
    expect(pickApp('auto', true, [...all])).toBe('comaps');
    expect(pickApp('auto', true, ['waze', 'abrp', 'osmand'])).toBe('osmand');
    expect(pickApp('auto', false, ['abrp', 'comaps'])).toBe('abrp');
    expect(pickApp('organic', false, [...all])).toBe('organic');
    expect(pickApp('organic', false, ['waze', 'comaps'])).toBe('waze'); // not shown: falls back
    expect(pickApp('auto', true, [])).toBe('waze');
  });
  it('spots the dash tablet', () => {
    expect(isAndroid('Mozilla/5.0 (Linux; Android 14; SM-T738U) Chrome/131')).toBe(true);
    expect(isAndroid('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe(false);
  });
});
