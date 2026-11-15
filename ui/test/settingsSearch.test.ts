import { describe, expect, it } from 'vitest';
import { chipLabel, searchSections, type SectionEntry } from '../src/settings/search.ts';

const e = (o: Partial<SectionEntry> & { title: string; tab: string }): SectionEntry =>
  ({ id: o.title.toLowerCase().replace(/\W+/g, '-'), key: '', help: '', keywords: '', labels: [], text: '', ...o });

const SECTIONS = [
  e({ id: 'import', tab: 'connections', title: 'Import trips (phone & Google Timeline)', help: "Real drives before the truck arrives: a Google Maps Timeline export, or a driver's phone locations from Home Assistant.", keywords: 'google maps timeline takeout location history export json upload', labels: ['Driver', 'Import Timeline for Jeff', 'From', 'To'] }),
  e({ id: 'charger-keys', tab: 'charging', title: 'Charger API keys', help: 'Free keys: developer.nlr.gov/signup. Google Places is optional and billed.', labels: ['Google Places key (live stalls, optional)'] }),
  e({ id: 'network', tab: 'connections', title: 'Getting online', help: "Joins home Wi-Fi in the driveway, else the driver's phone hotspot.", keywords: 'wifi wi-fi hotspot', labels: ['Home Wi-Fi name (SSID)', 'Home Wi-Fi password'] }),
  e({ id: 'security', tab: 'system', title: 'Security', help: 'The password guards Settings and the Truck page.', labels: ['New password'] }),
  e({ id: 'spotify', tab: 'media', title: 'Spotify', help: 'The truck becomes a Spotify Connect speaker.', text: 'Client ID Premium' }),
];
const ids = (q: string) => searchSections(SECTIONS, q).map((h) => h.entry.id);

describe('settings search', () => {
  it('finds the Google Timeline import by what people would type', () => {
    expect(ids('timeline')[0]).toBe('import');
    expect(ids('import')[0]).toBe('import');
    expect(ids('google')).toContain('import');
    expect(ids('google')[0]).toBe('import');
    expect(ids('Google Timeline')).toEqual(['import']);
    expect(ids('takeout')).toEqual(['import']);
  });
  it('needs every word, ignores case and accents', () => {
    expect(ids('wifi password')).toEqual(['network']);
    expect(ids('WI-FI')).toEqual(['network']);
    expect(ids('spotify premium')).toEqual(['spotify']);
    expect(ids('spotify nonsense')).toEqual([]);
    expect(ids('sécurity')).toEqual(['security']);
  });
  it('ranks a title match above a help or label match', () => {
    expect(ids('password')[0]).toBe('security');
    expect(ids('password')).toContain('network');
  });
  it('shows the matching field label when only a label matched', () => {
    const [hit] = searchSections(SECTIONS, 'ssid');
    expect(hit.entry.id).toBe('network');
    expect(hit.snippet).toBe('Home Wi-Fi name (SSID)');
  });
  it('ignores an empty or one-letter query', () => {
    expect(ids('')).toEqual([]);
    expect(ids('  ')).toEqual([]);
    expect(ids('g')).toEqual([]);
  });
});

describe('status chips', () => {
  it('says it short and keeps the raw text out', () => {
    expect(chipLabel('mqtt', 'disconnected (connect ECONNREFUSED 127.0.0.1:1883)')).toEqual({ text: 'MQTT offline', level: 'warn' });
    expect(chipLabel('mqtt', 'connected')).toEqual({ text: 'MQTT', level: 'ok' });
    expect(chipLabel('gps', 'sim').level).toBe('ok');
    expect(chipLabel('gps', 'no fix')).toEqual({ text: 'GPS no fix', level: 'warn' });
    expect(chipLabel('ha', 'not configured').text).toBe('HA not set up');
    expect(chipLabel('ha', 'error: 401 Unauthorized')).toEqual({ text: 'HA offline', level: 'warn' });
  });
});
