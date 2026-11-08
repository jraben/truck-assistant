import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoFootage, testInput } from '../src/cams/go2rtc.ts';
import { defaultCameras } from '../src/remote/store.ts';

describe('demo footage', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'footage-'));
  writeFileSync(path.join(dir, 'front.mp4'), '');
  const [rear, front] = defaultCameras(true);

  it('plays <dir>/<camera id>.mp4 on a loop when it exists, else the test pattern', () => {
    expect(demoFootage(front, dir)).toBe(path.join(dir, 'front.mp4'));
    expect(demoFootage(rear, dir)).toBeNull();
    expect(demoFootage(front, undefined)).toBeNull();
    expect(testInput(rear, 0)).toContain('lavfi');
  });

  it('with DEMO_FOOTAGE set, only cameras that have a clip are listed', () => {
    const prev = process.env.DEMO_FOOTAGE;
    process.env.DEMO_FOOTAGE = dir;
    try {
      expect(defaultCameras(true).map((c) => c.id)).toEqual(['front']);
      expect(testInput(front, 0)).toEqual(['-re', '-stream_loop', '-1', '-i', path.join(dir, 'front.mp4')]);
    } finally {
      if (prev === undefined) delete process.env.DEMO_FOOTAGE; else process.env.DEMO_FOOTAGE = prev;
    }
  });
});
