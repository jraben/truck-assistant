// Pure helpers for the Glass Drive layout (GlassDrive.tsx), kept apart so tests don't load the map.

/** The speed bar under the number: 0..1 of the limit (to 1.25 past it), and its tone. Pure. */
export function speedBar(mph: number | null, limit: number | null, over: boolean): { fill: number; tone: 'ok' | 'warn' | 'bad' | 'dim' } {
  if (mph === null) return { fill: 0, tone: 'dim' };
  if (!limit) return { fill: Math.min(1, mph / 80), tone: 'dim' };
  const f = mph / limit;
  return { fill: Math.min(1.25, f) / 1.25, tone: over ? 'bad' : f > 1 ? 'warn' : 'ok' };
}

/** Lane marks scroll at a pace that follows the speed (seconds per dash; 0 = still). Pure. */
export const laneSeconds = (mph: number | null) => (!mph || mph < 1 ? 0 : Math.max(0.12, Math.min(2.4, 24 / mph)));

