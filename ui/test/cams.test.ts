import { describe, expect, it } from 'vitest';
import { fmtBytes, guideX, parseMultipart, rearCamera, tileView, type CamInfo } from '../src/lib/cams.ts';

const enc = (s: string) => new TextEncoder().encode(s);
function part(jpeg: number[], at: number) {
  const head = enc(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\nX-Frame-Time: ${at}\r\n\r\n`);
  const out = new Uint8Array(head.length + jpeg.length + 2);
  out.set(head); out.set(jpeg, head.length); out.set([13, 10], head.length + jpeg.length);
  return out;
}
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

describe('MJPEG multipart parsing (desk fallback player)', () => {
  it('finds whole frames with their server time and keeps the partial rest', () => {
    const a = part([0xff, 0xd8, 1, 0xff, 0xd9], 1000), b = part([0xff, 0xd8, 2, 2, 0xff, 0xd9], 1066);
    const all = cat(a, b);
    const first = parseMultipart(all.subarray(0, a.length + 20));
    expect(first.frames).toHaveLength(1);
    expect(first.frames[0]).toEqual({ jpeg: new Uint8Array([0xff, 0xd8, 1, 0xff, 0xd9]), at: 1000 });
    const second = parseMultipart(cat(first.rest, all.subarray(a.length + 20)));
    expect(second.frames.map((f) => [f.jpeg[2], f.at])).toEqual([[2, 1066]]);
    expect(second.rest.length).toBeLessThan(4);
  });

  it('a JPEG that happens to contain CRLFCRLF is cut by Content-Length, not by the bytes', () => {
    const tricky = [0xff, 0xd8, 13, 10, 13, 10, 7, 0xff, 0xd9];
    const r = parseMultipart(cat(part(tricky, 5), part([0xff, 0xd8, 9, 0xff, 0xd9], 6)));
    expect(r.frames.map((f) => Array.from(f.jpeg))).toEqual([tricky, [0xff, 0xd8, 9, 0xff, 0xd9]]);
  });
});

describe('parking guides', () => {
  const g = { bottomWidth: 0.8, topWidth: 0.3, top: 0.4, offsetX: 0 };
  it('wide at the bottom, narrow at the top, symmetric', () => {
    expect(guideX(g, 1, -1)).toBeCloseTo(10);
    expect(guideX(g, 1, 1)).toBeCloseTo(90);
    expect(guideX(g, 0.4, -1)).toBeCloseTo(35);
    expect(guideX(g, 0.4, 1)).toBeCloseTo(65);
    expect(guideX(g, 0.7, -1)).toBeCloseTo(22.5);
  });
  it('offset moves both lines', () => {
    expect(guideX({ ...g, offsetX: 0.1 }, 1, -1)).toBeCloseTo(20);
  });
});

describe('rear camera pick (reverse)', () => {
  const cam = (id: string, name: string, role: CamInfo['role'], enabled = true) => ({ id, name, role, enabled } as CamInfo);
  it('role rear first, then a name, then the first one on', () => {
    expect(rearCamera([cam('a', 'Front', 'front'), cam('b', 'Rear', 'rear')])?.id).toBe('b');
    expect(rearCamera([cam('a', 'Front', 'front'), cam('b', 'Backup', 'other')])?.id).toBe('b');
    expect(rearCamera([cam('a', 'Rear', 'rear', false), cam('b', 'Bed', 'bed')])?.id).toBe('b');
    expect(rearCamera([])).toBeNull();
  });
});

describe('Truck page helpers', () => {
  it('map tiles: 3x3 around the truck, pin offset inside the middle tile', () => {
    const t = tileView(33.4990, -111.9800, 15);
    expect(t.tiles).toHaveLength(9);
    expect(t.tiles[4]).toMatch(/^https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png$/);
    expect(t.offX).toBeGreaterThanOrEqual(256);
    expect(t.offX).toBeLessThan(512);
    expect(t.offY).toBeGreaterThanOrEqual(256);
    expect(t.offY).toBeLessThan(512);
  });
  it('sizes', () => {
    expect(fmtBytes(512)).toBe('1 KB');
    expect(fmtBytes(5 * 1024 ** 2)).toBe('5 MB');
    expect(fmtBytes(3.25 * 1024 ** 3)).toBe('3.3 GB');
  });
});
