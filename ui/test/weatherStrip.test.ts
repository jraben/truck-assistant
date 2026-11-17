import { describe, expect, it } from 'vitest';
import { shortWhy } from '../src/drive/WeatherStrip.tsx';

describe('header weather with no weather', () => {
  it('says "Weather offline" instead of the raw network errors', () => {
    expect(shortWhy('NWS: fetch failed; Open-Meteo: fetch failed')).toBe('Weather offline');
    expect(shortWhy('Offline: no weather yet')).toBe('Weather offline');
    expect(shortWhy('getaddrinfo ENOTFOUND api.weather.gov')).toBe('Weather offline');
  });
  it('keeps short reasons and shortens long ones', () => {
    expect(shortWhy('Waiting for a GPS fix')).toBe('Waiting for a GPS fix');
    expect(shortWhy('Fetching weather…')).toBe('Fetching weather…');
    expect(shortWhy('Open-Meteo answered 500 Internal Server Error twice')).toBe('No weather yet');
  });
});
