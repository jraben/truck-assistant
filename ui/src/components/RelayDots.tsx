// The Control screen's rail icon: six dots, one per upfit relay, in two rows of
// three (relay_1..3 on top, relay_4..6 below, the same order as the Control
// screen's grid). A dot is filled green while its relay is on, outlined when
// it is off, and faint while the truck box hasn't reported it (offline/unknown).
import type { State } from '../lib/brain.ts';

export const RELAY_DOT_IDS = ['relay_1', 'relay_2', 'relay_3', 'relay_4', 'relay_5', 'relay_6'] as const;

export type DotState = 'on' | 'off' | 'unknown';

/** Pure (tested): each relay's dot state from the brain's state. */
export function relayDotStates(relays: State['relays'] | null | undefined, truckboxOnline: boolean): DotState[] {
  return RELAY_DOT_IDS.map((id) => {
    const on = relays?.[id]?.on;
    if (!truckboxOnline || on === null || on === undefined) return 'unknown';
    return on ? 'on' : 'off';
  });
}

export function RelayDots({ relays, online }: { relays: State['relays'] | null | undefined; online: boolean }) {
  const dots = relayDotStates(relays, online);
  const onCount = dots.filter((d) => d === 'on').length;
  return (
    <svg viewBox="0 0 24 24" class="relaydots" role="img" aria-label={`Relays: ${onCount} of 6 on`}>
      {dots.map((d, i) => (
        <circle
          key={RELAY_DOT_IDS[i]}
          cx={5 + (i % 3) * 7}
          cy={i < 3 ? 8.5 : 15.5}
          r={2.9}
          class={`rd ${d}`}
        />
      ))}
    </svg>
  );
}
