import { describe, expect, it } from 'vitest';
import { chunk, decodeDirectory, wantedTiles, type Located } from '../src/maps/pmtiles.ts';
import { bboxAround, bboxHasTile, countTiles, latToY, lonToX, parseBbox, tileRange } from '../src/maps/tiles.ts';

const varint = (n: number) => { const out: number[] = []; while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); return out; };

describe('offline map tiles', () => {
  it('turns places into slippy-map tiles', () => {
    // downtown Denver at z14: x = (lon+180)/360·2^14 = 3413.6, y = (1 − ln(tan φ + sec φ)/π)/2·2^14 = 6218.6
    expect([lonToX(-104.9903, 14), latToY(39.7392, 14)]).toEqual([3413, 6218]);
    expect([lonToX(-180, 3), lonToX(180, 3), latToY(90, 3), latToY(-90, 3)]).toEqual([0, 7, 0, 7]);
  });
  it('counts the tiles of an area at every zoom', () => {
    const b = bboxAround(39.7392, -104.9903, 3);
    expect(countTiles(b, 0)).toBe(1);
    expect(countTiles(b, 14)).toBe(76); // what the real download fetched
    expect(countTiles(b, 14)).toBe(Array.from({ length: 15 }, (_, z) => { const r = tileRange(b, z); return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); }).reduce((a, n) => a + n));
  });
  it('checks a bbox from the outside world', () => {
    expect(parseBbox([-105, 39, -104, 40])).toEqual([-105, 39, -104, 40]);
    expect(parseBbox([-104, 39, -105, 40])).toMatch(/west < east/);
    expect(parseBbox([-200, 39, -104, 40])).toMatch(/outside/);
    expect(parseBbox('x')).toMatch(/must be/);
  });
  it('knows which areas hold a tile', () => {
    const b = bboxAround(39.7392, -104.9903, 3);
    expect(bboxHasTile(b, 14, 3413, 6218)).toBe(true);
    expect(bboxHasTile(b, 14, 3500, 6218)).toBe(false);
  });
});

describe('PMTiles extract', () => {
  it('decodes a v3 directory, including run lengths, leaves and "follows the last one" offsets', () => {
    // 3 entries: ids 0, 1, 5; run lengths 1, 2, 0 (leaf); lengths 10, 20, 30; offsets 0 (stored +1), follows (0), 100 (stored +1)
    const bytes = new Uint8Array([...varint(3), ...varint(0), ...varint(1), ...varint(4), ...varint(1), ...varint(2), ...varint(0), ...varint(10), ...varint(20), ...varint(30), ...varint(1), ...varint(0), ...varint(101)]);
    expect(decodeDirectory(bytes)).toEqual([
      { tileId: 0, runLength: 1, length: 10, offset: 0 },
      { tileId: 1, runLength: 2, length: 20, offset: 10 },
      { tileId: 5, runLength: 0, length: 30, offset: 100 },
    ]);
  });
  it('wants each tile once, in tile-ID order, minus what is already stored', () => {
    const b = bboxAround(39.7392, -104.9903, 3);
    const all = wantedTiles(b, 14);
    expect(all.length).toBe(76);
    expect(all.every((t, i) => i === 0 || t.id > all[i - 1].id)).toBe(true);
    expect(wantedTiles(b, 14, (z) => z < 14).every((t) => t.z === 14)).toBe(true);
  });
  it('merges nearby tile ranges into few requests, capped in size', () => {
    const t = (offset: number, length: number): Located => ({ z: 0, x: 0, y: 0, id: offset, offset, length });
    const c = chunk([t(0, 100), t(150, 50), t(10_000_000, 10), t(10_000_000, 10), t(200, 10)], 1000, 5000);
    expect(c.map((x) => [x.offset, x.length, x.tiles.length])).toEqual([[0, 210, 3], [10_000_000, 10, 2]]);
    expect(chunk([t(0, 4000), t(4000, 4000)], 1000, 5000).length).toBe(2);
  });
});
