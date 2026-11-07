import { describe, expect, it } from 'vitest';
import { relayDotStates } from '../src/components/RelayDots.tsx';

const relays = (on: (boolean | null)[]) =>
  Object.fromEntries(on.map((v, i) => [`relay_${i + 1}`, { name: `R${i + 1}`, on: v }]));

describe('Control rail icon: relay dots', () => {
  it('lights the relays that are on, in relay order', () => {
    expect(relayDotStates(relays([true, false, false, true, false, true]) as never, true))
      .toEqual(['on', 'off', 'off', 'on', 'off', 'on']);
  });
  it('shows every dot as unknown while the truck box is offline', () => {
    expect(relayDotStates(relays([true, true, true, true, true, true]) as never, false)).toEqual(Array(6).fill('unknown'));
  });
  it('treats a relay with no report yet as unknown', () => {
    expect(relayDotStates(relays([null, false, true]) as never, true)).toEqual(['unknown', 'off', 'on', 'unknown', 'unknown', 'unknown']);
    expect(relayDotStates(null, true)).toEqual(Array(6).fill('unknown'));
  });
});
