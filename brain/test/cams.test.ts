import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { go2rtcConfig, streamSource } from '../src/cams/go2rtc.ts';
import { clipWindow, Dashcam, listSegments, newestPerCamera, parseSegmentName, planRetention, stamp, windowClosed, type Segment } from '../src/cams/dashcam.ts';
import { inputArgs, MjpegSplitter, sceneScores, segmentOutput } from '../src/cams/ffmpeg.ts';
import { camera, defaultCameras } from '../src/remote/store.ts';

const ports = { api: '127.0.0.1:1984', rtsp: '127.0.0.1:8554', webrtc: ':8555' };

describe('go2rtc config', () => {
  it('desk: test patterns as exec:ffmpeg streams, on demand', () => {
    const y = go2rtcConfig(defaultCameras(true), ports);
    expect(y).toContain('api:\n  listen: "127.0.0.1:1984"');
    expect(y).toContain('rtsp:\n  listen: "127.0.0.1:8554"');
    expect(y).toContain('webrtc:\n  listen: ":8555"');
    expect(y).toContain('  rear:\n    - "exec:ffmpeg -hide_banner -loglevel error -re -f lavfi -i testsrc=size=640x360:rate=15,hue=h=0 -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 30 -f rtsp {output}"');
    expect(y).toContain('  surround:\n    - "exec:ffmpeg');
    expect(y.split('streams:')[1].match(/^ {2}[a-z]+:$/gm)).toHaveLength(5);
  });

  it('a capture stick and a UVC webcam: ffmpeg device sources, H.264 with hardware if there is any', () => {
    const cams = defaultCameras(false);
    cams[1].enabled = true;
    expect(streamSource(cams[0], 0)).toBe('ffmpeg:device?video=/dev/video0&input_format=yuyv422&video_size=720x480&framerate=30#video=h264#hardware');
    expect(streamSource(cams[1], 1)).toBe('ffmpeg:device?video=/dev/video2&input_format=mjpeg&video_size=1280x720&framerate=30#video=h264#hardware');
    const auto = camera('hitch', 'Hitch', 'hitch', 'uvc', { device: '/dev/v4l/by-id/usb-cam-index0', inputFormat: 'auto', width: 640, height: 480, fps: 15 });
    expect(streamSource(auto, 2)).toBe('ffmpeg:device?video=/dev/v4l/by-id/usb-cam-index0&video_size=640x480&framerate=15#video=h264#hardware');
    expect(streamSource(camera('pi', 'Net', 'other', 'rtsp', { url: 'rtsp://10.0.0.5/live' }), 3)).toBe('rtsp://10.0.0.5/live');
  });

  it('disabled cameras are left out; none at all is still valid YAML', () => {
    const cams = defaultCameras(false);   // front is disabled by default
    const y = go2rtcConfig(cams, ports);
    expect(y).toContain('  rear:');
    expect(y).not.toContain('  front:');
    expect(go2rtcConfig([], ports)).toMatch(/streams:\n {2}\{\}\n$/);
  });

  it('quotes keep YAML happy with odd characters', () => {
    const c = camera('net', 'Net', 'other', 'rtsp', { url: 'rtsp://u:p#1@10.0.0.5/live?x="y"' });
    const line = go2rtcConfig([c], ports).split('\n').find((l) => l.includes('rtsp://u'))!;
    expect(JSON.parse(line.trim().slice(2))).toBe('rtsp://u:p#1@10.0.0.5/live?x="y"');
  });
});

describe('ffmpeg pieces', () => {
  it('direct inputs (desk fallback)', () => {
    const [rear] = defaultCameras(false);
    expect(inputArgs(rear, 0)).toEqual(['-f', 'v4l2', '-input_format', 'yuyv422', '-video_size', '720x480', '-framerate', '30', '-i', '/dev/video0']);
    expect(inputArgs(defaultCameras(true)[1], 1).slice(0, 4)).toEqual(['-re', '-f', 'lavfi', '-i']);
  });

  it('segments: fragmented MP4 named by start time; copy from go2rtc, x264 otherwise', () => {
    const o = segmentOutput('/d/rear', 60, true, 30);
    expect(o).toContain('copy');
    expect(o.join(' ')).toContain('-f segment -segment_time 60 -segment_format mp4 -segment_format_options movflags=+frag_keyframe+empty_moov+default_base_moof -reset_timestamps 1 -strftime 1');
    expect(o[o.length - 1]).toBe(path.join('/d/rear', '%Y%m%d-%H%M%S.mp4'));
    expect(segmentOutput('/d', 30, false, 15)).toEqual(expect.arrayContaining(['libx264', '-g', '30']));
  });

  it('splits an MJPEG stream into frames across chunk boundaries', () => {
    const frames: Buffer[] = [];
    const sp = new MjpegSplitter((f) => frames.push(f));
    const jpg = (n: number) => Buffer.from([0xff, 0xd8, n, n, 0xff, 0x00, n, 0xff, 0xd9]);
    const all = Buffer.concat([jpg(1), jpg(2), jpg(3)]);
    sp.push(all.subarray(0, 5)); sp.push(all.subarray(5, 13)); sp.push(all.subarray(13));
    expect(frames.map((f) => f[2])).toEqual([1, 2, 3]);
    expect(frames[1]).toEqual(jpg(2));
  });

  it('reads scene scores from metadata=print', () => {
    expect(sceneScores('frame:3 pts:6 pts_time:3\nlavfi.scene_score=0.231\nframe:9\nlavfi.scene_score=0.5\n')).toEqual([0.231, 0.5]);
  });
});

describe('dashcam retention and clips', () => {
  const t0 = new Date(2027, 4, 1, 12, 0, 0).getTime();
  const seg = (camera: string, i: number, bytes = 100): Segment => ({ camera, path: `/loop/${camera}/${stamp(t0 + i * 60_000)}.mp4`, start: t0 + i * 60_000, bytes });

  it('names round-trip', () => {
    expect(stamp(t0)).toBe('20270501-120000');
    expect(parseSegmentName('20270501-120000.mp4')).toBe(t0);
    expect(parseSegmentName('20270501-120000.mp4.part')).toBeNull();
    expect(parseSegmentName('notes.txt')).toBeNull();
  });

  it('deletes the oldest first until under the cap, skipping locked and active segments', () => {
    const segs = [seg('rear', 0), seg('front', 0), seg('rear', 1), seg('front', 1), seg('rear', 2), seg('front', 2)];
    const active = newestPerCamera(segs);
    expect([...active].sort()).toEqual([segs[4].path, segs[5].path].sort());
    expect(planRetention(segs, 600, new Set(), active)).toEqual([]);
    expect(planRetention(segs, 350, new Set(), active)).toEqual([segs[0].path, segs[1].path, segs[2].path]);
    expect(planRetention(segs, 350, new Set([segs[0].path]), active)).toEqual([segs[1].path, segs[2].path, segs[3].path]);
    // Everything locked or active: nothing to delete, even over the cap.
    expect(planRetention(segs, 0, new Set(segs.slice(0, 4).map((s) => s.path)), active)).toEqual([]);
  });

  it('a clip window: 60 s before the tap and 30 s after, across segments', () => {
    const segs = [seg('rear', 0), seg('rear', 1), seg('rear', 2), seg('rear', 3)];
    const tap = t0 + 150_000;   // 12:02:30
    const w = clipWindow(segs, tap - 60_000, tap + 30_000, 60)!;
    // 12:01:30 .. 12:03:00 lies in the 12:01 and 12:02 segments.
    expect(w.segments.map((s) => s.start)).toEqual([t0 + 60_000, t0 + 120_000]);
    expect(w.offsetS).toBe(30);
    expect(w.durationS).toBe(90);
    // Cut once the 12:03 segment has started (so 12:02 is closed).
    expect(windowClosed(segs.slice(0, 3), tap + 30_000)).toBe(false);
    expect(windowClosed(segs, tap + 30_000)).toBe(true);
  });

  it('a window before the loop began starts at the first segment; nothing recorded = null', () => {
    const segs = [seg('rear', 5), seg('rear', 6)];
    const w = clipWindow(segs, t0, t0 + 6 * 60_000 + 10_000, 60)!;
    expect(w.offsetS).toBe(0);
    expect(w.durationS).toBe(70);
    expect(clipWindow([], t0, t0 + 1000, 60)).toBeNull();
  });

  describe('on disk', () => {
    let dir = '';
    afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

    it('locks the segments a pending clip needs, and the loop cap never deletes them', async () => {
      dir = mkdtempSync(path.join(tmpdir(), 'dashcam-'));
      const d = new Dashcam(dir, 'ffmpeg-not-called-here');
      d.segmentSec = 60; d.capBytes = 250;
      d.isRecording = () => true;
      const now = Date.now();
      const write = (i: number) => { const p = path.join(d.cameraDir('rear'), `${stamp(now + i * 60_000)}.mp4`); writeFileSync(p, Buffer.alloc(100)); return p; };
      const old = [write(-5), write(-4), write(-3)];
      const kept = [write(-1), write(0)];
      d.saveClip(['rear'], 60, 30, 'manual', now);
      await d.tick(now);   // window not closed yet: nothing built, retention runs
      const left = listSegments(d.loopDir).map((s) => s.path);
      for (const p of kept) expect(left).toContain(p);
      for (const p of old) expect(left).not.toContain(p);
      expect([...d.lockedPaths()].sort()).toEqual(kept.sort());
      expect(d.clips()[0]).toMatchObject({ camera: 'rear', state: 'recording', reason: 'manual', durationS: 90 });
    });

    it('lists clips newest first and refuses odd ids', () => {
      dir = mkdtempSync(path.join(tmpdir(), 'dashcam-'));
      const d = new Dashcam(dir, 'ffmpeg');
      mkdirSync(d.clipDir, { recursive: true });
      for (const id of ['20270501-120000-rear', '20270502-090000-front']) writeFileSync(path.join(d.clipDir, `${id}.json`), JSON.stringify({ id, camera: id.split('-')[2], startedAt: `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T00:00:00Z`, durationS: 90, reason: 'manual', bytes: 1, state: 'ready', error: null, from: 0, to: 0 }));
      expect(d.clips().map((c) => c.id)).toEqual(['20270502-090000-front', '20270501-120000-rear']);
      expect(d.clipFile('../../etc/passwd')).toBeNull();
      expect(d.deleteClip('20270501-120000-rear')).toBe(true);
      expect(d.clips().map((c) => c.id)).toEqual(['20270502-090000-front']);
    });
  });
});
