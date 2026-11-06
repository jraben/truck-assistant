import { describe, expect, it } from 'vitest';
import { freqFrom, mergeDial, parseRbStations, parseTuneInLocal, pickTuneInStream } from '../src/media/airstreams.ts';

const local = { head: { status: '200' }, body: [
  { text: 'FM', children: [
    { type: 'audio', text: '89 | KBACH 89.5 FM (Classical)', guide_id: 's31621', subtext: 'Your Classical Companion' },
    { type: 'audio', text: '91 HD2 | Jazz PHX - KJZZ-HD2 (Jazz)', guide_id: 's189051' },
    { type: 'audio', text: '93.3 | Alt AZ 93.3 (Alternative Rock)', guide_id: 's32312' },
    { type: 'audio', text: '101 | KOPA 101.3FM (Variety)', guide_id: 's289635' },
  ] },
  { text: 'AM', children: [{ type: 'audio', text: '1060 | KDUS AM 1060 (Sports Talk & News)', guide_id: 's32383' }] },
  { text: 'Internet Only', children: [{ type: 'audio', text: 'sky 105 (Adult Hits)', guide_id: 's301320' }] },
] };

describe('AM/FM over the internet', () => {
  it('reads frequencies off TuneIn, using the name when the dial number is cut short', () => {
    const s = parseTuneInLocal(local);
    expect(s.map((x) => [x.mhz, x.band, x.hd])).toEqual([[89.5, 'FM', null], [93.3, 'FM', null], [101.3, 'FM', null], [1.06, 'AM', null]]);
    expect(s[0].id).toBe('tunein:s31621');
  });
  it('finds a frequency in a station name', () => {
    expect(freqFrom('KJZZ 91.5 Phoenix, AZ')).toEqual({ mhz: 91.5, band: 'FM' });
    expect(freqFrom('970 KVWM')).toEqual({ mhz: 0.97, band: 'AM' });
    expect(freqFrom('En Familia Radio 740 AM')).toEqual({ mhz: 0.74, band: 'AM' });
    expect(freqFrom('Progressive Rock AZUSA')).toBeNull();
  });
  it('Radio Browser only fills frequencies TuneIn lacks', () => {
    const rb = parseRbStations([
      { stationuuid: 'a', name: 'KBAQ 89.5 Phoenix', url_resolved: 'http://x/a' },
      { stationuuid: 'b', name: 'KWSS 93.9 - Scottsdale', url_resolved: 'http://x/b' },
    ]);
    const dial = mergeDial(parseTuneInLocal(local), rb);
    expect(dial.filter((s) => s.mhz === 89.5)).toHaveLength(1);
    expect(dial.find((s) => s.mhz === 93.9)?.id).toBe('rb:b');
    expect(dial.at(-1)?.band).toBe('AM');
  });
  it('picks an MP3 stream before AAC, and never a playlist', () => {
    expect(pickTuneInStream({ body: [{ url: 'https://h/x.m3u8', media_type: 'hls' }, { url: 'https://h/a.aac', media_type: 'aac', reliability: 98 }, { url: 'https://h/b.mp3', media_type: 'mp3', reliability: 99 }] })).toBe('https://h/b.mp3');
    expect(pickTuneInStream({ body: [] })).toBeNull();
  });
});
