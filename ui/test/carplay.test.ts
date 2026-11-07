import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codecFromSps, findNal, isKeyFrame, joinAnnexB, NAL, nalType, splitAccessUnits, splitNals } from '../src/carplay/h264.ts';
import { dongleDpi, dongleSize, fitRect, mapTouch, mapTouchClamped, panelPpi } from '../src/carplay/geometry.ts';
import { applyAudioCommand, gains, initialMix, NAV_DUCK, pcmFormat, roleFor, streamKey } from '../src/carplay/pcm.ts';
import { brainMedia, emptyNowPlaying, livePosition, mergeMedia } from '../src/carplay/media.ts';
import { noDecoderReason } from '../src/carplay/video.ts';
import { AudioCommand } from '../src/carplay/vendor/node-carplay/modules/messages/readable.js';

const u8 = (...b: number[]) => new Uint8Array(b);

describe('H.264 NAL splitting', () => {
  it('splits 3- and 4-byte start codes and drops leading garbage', () => {
    const s = u8(0xff, 0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4, 5, 6);
    const n = splitNals(s);
    expect(n.map((x) => [...x])).toEqual([[0x67, 1, 2], [0x68, 3], [0x65, 4, 5, 6]]);
    expect(n.map(nalType)).toEqual([NAL.SPS, NAL.PPS, NAL.IDR]);
  });

  it('keeps emulation-prevention bytes (00 00 03) inside a NAL', () => {
    const s = u8(0, 0, 0, 1, 0x67, 0, 0, 3, 1, 9, 0, 0, 1, 0x41, 7);
    expect(splitNals(s).map((x) => [...x])).toEqual([[0x67, 0, 0, 3, 1, 9], [0x41, 7]]);
  });

  it('handles empty and start-code-less input', () => {
    expect(splitNals(new Uint8Array())).toEqual([]);
    expect(splitNals(u8(1, 2, 3))).toEqual([]);
  });

  it('knows a keyframe', () => {
    expect(isKeyFrame(u8(0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x65, 1))).toBe(true);
    expect(isKeyFrame(u8(0, 0, 0, 1, 0x41, 1))).toBe(false);
  });

  it('joins NALs back to Annex-B', () => {
    const j = joinAnnexB([u8(0x09, 0x10), u8(0x41, 1)]);
    expect([...j]).toEqual([0, 0, 0, 1, 0x09, 0x10, 0, 0, 0, 1, 0x41, 1]);
    expect(splitNals(j).length).toBe(2);
  });
});

describe('SPS -> codec string', () => {
  it('reads profile, constraints and level as hex', () => {
    expect(codecFromSps(u8(0x67, 0x64, 0x00, 0x28, 0xac))).toBe('avc1.640028'); // High 4.0
    expect(codecFromSps(u8(0x27, 0x42, 0xe0, 0x1f))).toBe('avc1.42e01f');       // Constrained Baseline 3.1 (nal_ref_idc 1)
    expect(codecFromSps(u8(0x67, 0x4d, 0x40, 0x33, 1))).toBe('avc1.4d4033');    // Main 5.1
  });
  it('refuses a non-SPS or a truncated one', () => {
    expect(codecFromSps(u8(0x68, 0x64, 0, 0x28))).toBeNull();
    expect(codecFromSps(u8(0x67, 0x64))).toBeNull();
  });
});

describe('the simulator clip', () => {
  const clip = new Uint8Array(readFileSync(resolve(__dirname, '../public/carplay-sim/test.h264')));
  const units = splitAccessUnits(clip);
  it('is under 2 MB and splits into 300 frames (10 s at 30 fps)', () => {
    expect(clip.length).toBeLessThan(2 * 1024 * 1024);
    expect(units.length).toBe(300);
  });
  it('starts with a keyframe carrying an SPS the decoder can be configured from', () => {
    expect(isKeyFrame(units[0])).toBe(true);
    const sps = findNal(units[0], NAL.SPS);
    expect(sps && codecFromSps(sps)).toBe('avc1.640028');
  });
  it('has a keyframe every second', () => {
    const keys = units.map((u, i) => (isKeyFrame(u) ? i : -1)).filter((i) => i >= 0);
    expect(keys).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270]);
  });
  it('splits on first slices when there are no AUDs, keeping multi-slice frames whole', () => {
    const three = units.slice(0, 3);
    const slices = splitNals(three[1]).filter((n) => nalType(n) === NAL.SLICE).length;
    expect(slices).toBeGreaterThan(1); // x264 zerolatency: sliced threads, several slices per frame
    const noAud = joinAnnexB(three.flatMap((u) => splitNals(u)).filter((n) => nalType(n) !== NAL.AUD));
    const again = splitAccessUnits(noAud);
    expect(again.length).toBe(3);
    expect(splitNals(again[1]).length).toBe(slices);
  });
});

describe('touch mapping', () => {
  const video = { w: 1600, h: 600 };
  it('maps straight through when the aspect matches', () => {
    expect(mapTouch(800, 300, { w: 1600, h: 600 }, video)).toEqual({ x: 0.5, y: 0.5 });
    expect(mapTouch(0, 0, { w: 800, h: 300 }, video)).toEqual({ x: 0, y: 0 });
    expect(mapTouch(800, 300, { w: 800, h: 300 }, video)).toEqual({ x: 1, y: 1 });
  });
  it('accounts for letterbox bars and ignores touches on them', () => {
    // A 1600x900 box shows 1600x600 video with 150 px bars top and bottom.
    const box = { w: 1600, h: 900 };
    expect(fitRect(box, video)).toEqual({ x: 0, y: 150, w: 1600, h: 600 });
    expect(mapTouch(400, 150, box, video)).toEqual({ x: 0.25, y: 0 });
    expect(mapTouch(400, 100, box, video)).toBeNull();
    expect(mapTouch(1600, 750, box, video)).toEqual({ x: 1, y: 1 });
  });
  it('pillarboxes too, and clamps a drag that slides onto a bar', () => {
    const box = { w: 2000, h: 600 }; // 200 px bars left and right
    expect(mapTouch(1000, 300, box, video)).toEqual({ x: 0.5, y: 0.5 });
    expect(mapTouch(100, 300, box, video)).toBeNull();
    expect(mapTouchClamped(100, 300, box, video)).toEqual({ x: 0, y: 0.5 });
    expect(mapTouchClamped(1950, -20, box, video)).toEqual({ x: 1, y: 0 });
  });
  it('rounds to the dongle\'s 1/10000 steps', () => {
    const p = mapTouch(1, 1, { w: 3, h: 3 }, { w: 3, h: 3 })!;
    expect(p.x * 10000).toBe(Math.round(p.x * 10000));
  });
});

describe('dongle size and dpi', () => {
  it('uses device pixels, rounded down to even', () => {
    expect(dongleSize(1441, 641, 1)).toEqual({ w: 1440, h: 640 });
    expect(dongleSize(800, 300, 2)).toEqual({ w: 1600, h: 600 });
  });
  it('caps at 1920x1080 keeping the aspect', () => {
    const s = dongleSize(1600, 600, 2);
    expect(s.w).toBe(1920);
    expect(s.h).toBe(720);
  });
  it('dpi for the 12.3-inch 1920x720 bar is 160', () => {
    expect(panelPpi()).toBeCloseTo(166.7, 0);
    expect(dongleDpi()).toBe(160);
  });
});

describe('PCM format selection', () => {
  it('follows the dongle\'s decodeType table', () => {
    expect(pcmFormat(1)).toEqual({ sampleRate: 44100, channels: 2 });
    expect(pcmFormat(2)).toEqual({ sampleRate: 44100, channels: 2 });
    expect(pcmFormat(3)).toEqual({ sampleRate: 8000, channels: 1 });
    expect(pcmFormat(4)).toEqual({ sampleRate: 48000, channels: 2 });
    expect(pcmFormat(5)).toEqual({ sampleRate: 16000, channels: 1 });
    expect(pcmFormat(6)).toEqual({ sampleRate: 24000, channels: 1 });
    expect(pcmFormat(7)).toEqual({ sampleRate: 16000, channels: 2 });
  });
  it('drops unknown types instead of guessing', () => {
    expect(pcmFormat(0)).toBeNull();
    expect(pcmFormat(99)).toBeNull();
  });
  it('sorts streams into media, nav and voice', () => {
    expect(roleFor(1, 1)).toBe('media');
    expect(roleFor(4, 1)).toBe('media');
    expect(roleFor(1, 2)).toBe('nav');
    expect(roleFor(5, 1)).toBe('voice');
    expect(roleFor(3, 1)).toBe('voice');
    expect(roleFor(6, 1)).toBe('media'); // 24 kHz mono is not telephony
    expect(streamKey(1, 2)).not.toBe(streamKey(1, 1));
  });
  it('ducks media for nav (by the dongle\'s hint when given) and mutes it for Siri and calls', () => {
    let m = initialMix();
    expect(gains(m).media).toBe(1);
    m = applyAudioCommand(m, AudioCommand.AudioNaviStart).mix;
    expect(gains(m).media).toBe(NAV_DUCK);
    m = { ...m, mediaHint: 0.2 };
    expect(gains(m).media).toBe(0.2);
    m = applyAudioCommand(m, AudioCommand.AudioNaviStop).mix;
    expect(gains(m).media).toBe(1);
    const siri = applyAudioCommand(m, AudioCommand.AudioSiriStart);
    expect(siri.mic).toBe(true);
    expect(gains(siri.mix).media).toBe(0);
    expect(gains(siri.mix).voice).toBe(1);
    const done = applyAudioCommand(siri.mix, AudioCommand.AudioSiriStop);
    expect(done.mic).toBe(false);
    expect(applyAudioCommand(m, AudioCommand.AudioPhonecallStart).mic).toBe(true);
    expect(applyAudioCommand(m, AudioCommand.AudioPhonecallStop).mic).toBe(false);
    expect(applyAudioCommand(m, AudioCommand.AudioMediaStart).mic).toBeNull();
  });
});

describe('now playing', () => {
  it('merges partial MediaData updates', () => {
    let np = mergeMedia(emptyNowPlaying(), { type: 1, media: { MediaSongName: 'Song', MediaArtistName: 'Artist', MediaAlbumName: 'Album', MediaAPPName: 'Music', MediaSongDuration: 200000 } }, 1000);
    np = mergeMedia(np, { type: 1, media: { MediaSongPlayTime: 5000 } }, 2000);
    expect(np).toMatchObject({ title: 'Song', artist: 'Artist', album: 'Album', app: 'Music', durationMs: 200000, positionMs: 5000, positionAt: 2000 });
    expect(livePosition(np, 4000)).toBe(7000);
    np = mergeMedia(np, { type: 3, base64Image: '/9j/4AAQ' });
    expect(np.art).toBe('data:image/jpeg;base64,/9j/4AAQ');
    // A new song clears the old position and cover.
    np = mergeMedia(np, { type: 1, media: { MediaSongName: 'Next' } }, 5000);
    expect(np).toMatchObject({ title: 'Next', artist: 'Artist', positionMs: null, art: null, durationMs: null });
  });
  it('ignores junk', () => {
    const e = emptyNowPlaying();
    expect(mergeMedia(e, null)).toBe(e);
    expect(mergeMedia(e, { type: 7 })).toBe(e);
  });
  it('sends the brain text only, never album art', () => {
    const np = { ...emptyNowPlaying(), title: 'T', artist: 'A', album: null, art: 'data:image/png;base64,xx' };
    expect(brainMedia(np)).toEqual({ type: 'media', title: 'T', artist: 'A', album: null });
    expect(brainMedia(null)).toEqual({ type: 'media', title: null, artist: null, album: null });
  });
});

describe('no WebCodecs (the tablet on http://<LAN IP>)', () => {
  it('names the insecure origin as the reason, not a generic decoder error', () => {
    const r = noDecoderReason({ secure: false, origin: 'http://192.168.1.20:3950' });
    expect(r).toContain('http://192.168.1.20:3950');
    expect(r).toMatch(/secure origin/);
    expect(r).toMatch(/https or on localhost/);
  });

  it('blames the browser when the context is secure', () => {
    expect(noDecoderReason({ secure: true, origin: 'http://localhost:3950' })).toMatch(/Chromium 94/);
  });

  it('ships the simulator clip as an MP4 too, for the <video> fallback', () => {
    const mp4 = readFileSync(resolve(__dirname, '../public/carplay-sim/test.mp4'));
    expect(mp4.subarray(4, 8).toString('latin1')).toBe('ftyp');
    // faststart: the moov box (the index) comes before the media data, so playback starts at once.
    const moov = mp4.indexOf('moov', 0, 'latin1'), mdat = mp4.indexOf('mdat', 0, 'latin1');
    expect(moov).toBeGreaterThan(0);
    expect(moov).toBeLessThan(mdat);
    expect(mp4.indexOf('avc1', 0, 'latin1')).toBeGreaterThan(0);
  });
});
