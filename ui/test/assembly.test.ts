import { describe, expect, it } from 'vitest';
import { BUILT, coatAt, END, lightsAt, PARTS, partPose, phaseAt, PHASES, type PartId } from '../src/drive/Assembly.tsx';
import { shouldPlay } from '../src/drive/StartupAssembly.tsx';

const ids = Object.keys(PARTS) as PartId[];

describe('truck assembly clip', () => {
  it('starts with just the frame: nothing but the ground and rails in the first second', () => {
    const shown = ids.filter((id) => partPose(id, 0.5).opacity > 0);
    expect(shown.sort()).toEqual(['ground', 'rails']);
  });
  it('every part is in place, unmoved, once the truck is built', () => {
    for (const id of ids) expect(partPose(id, BUILT), id).toEqual({ opacity: 1, dx: 0, dy: 0, rot: 0 });
  });
  it('parts arrive from their exploded spot (wheels roll in spinning)', () => {
    const w = partPose('wheelF', PARTS.wheelF.at + 0.05);
    expect(w.dx).toBeGreaterThan(100);
    expect(Math.abs(w.rot)).toBeGreaterThan(100);
    expect(partPose('body', PARTS.body.at + 0.05).dy).toBeLessThan(-80);
  });
  it('body goes on before the paint, and the paint before general assembly', () => {
    expect(PARTS.body.at).toBeLessThan(5.7);
    expect(coatAt(5.6)).toBe(0);
    expect(coatAt(7.5)).toBeGreaterThan(430);
    expect(PARTS.glass.at).toBeGreaterThan(7.4);
  });
  it('phases run in order and end on Ready; the lamps come on at the end only', () => {
    expect(PHASES.map((p) => p.at)).toEqual([...PHASES.map((p) => p.at)].sort((a, b) => a - b));
    expect(PHASES[phaseAt(0)].title).toBe('Frame');
    expect(PHASES[phaseAt(6)].title).toBe('Coating');
    expect(PHASES[phaseAt(END)].title).toBe('Ready');
    expect(lightsAt(11)).toBe(0);
    expect(lightsAt(END)).toBe(1);
  });
});

describe('startup clip', () => {
  it('plays once a session, never while moving, and can be turned off with ?nosplash', () => {
    expect(shouldPlay(false, false, false)).toBe(true);
    expect(shouldPlay(true, false, false)).toBe(false);
    expect(shouldPlay(false, true, false)).toBe(false);
    expect(shouldPlay(false, false, true)).toBe(false);
  });
});
