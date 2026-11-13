import { describe, expect, it } from 'vitest';
import { defaultOps, loadOps } from '../src/ops/config.ts';

describe('update channel: main by default', () => {
  it('a new install is on main', () => {
    expect(defaultOps().updater).toMatchObject({ channel: 'main', channelChosen: false });
    expect(loadOps(undefined).updater.channel).toBe('main');
  });
  it('a file saved with the old default stable moves to main once', () => {
    expect(loadOps({ updater: { repo: 'https://github.com/a/b', channel: 'stable' } }).updater).toMatchObject({ repo: 'https://github.com/a/b', channel: 'main', channelChosen: false });
  });
  it('a channel someone picked in Settings stays', () => {
    expect(loadOps({ updater: { repo: null, channel: 'stable', channelChosen: true } }).updater.channel).toBe('stable');
    expect(loadOps({ updater: { repo: null, channel: 'main', channelChosen: true } }).updater.channel).toBe('main');
  });
});
