// State of charge until CAN is known: a manual anchor (the slider) that decays
// by GPS miles / efficiency / pack size. Unknown stays null; nothing is guessed.

export type SocSource = 'manual' | 'estimate' | 'can';

export const clampSoc = (v: number) => Math.max(0, Math.min(100, v));

/** SoC after driving `miles`: miles / (mi/kWh) is kWh used, as a share of the pack. */
export function socAfterMiles(soc: number, miles: number, effMiPerKwh: number, packKwh: number): number {
  if (!(effMiPerKwh > 0) || !(packKwh > 0) || !(miles > 0)) return soc;
  return clampSoc(soc - (miles / effMiPerKwh / packKwh) * 100);
}

/** Range = soc% x packKwh x efficiency. Null in, null out. */
export function rangeMi(soc: number | null, packKwh: number, effMiPerKwh: number): number | null {
  if (soc === null || !(packKwh > 0) || !(effMiPerKwh > 0)) return null;
  return (soc / 100) * packKwh * effMiPerKwh;
}

/** Percent of pack used to cover `miles` (for reachability). */
export function socForMiles(miles: number, effMiPerKwh: number, packKwh: number): number {
  return (miles / effMiPerKwh / packKwh) * 100;
}

export type SocSnapshot = { value: number | null; source: SocSource | null; updatedAt: string | null };
export type SocChange = { prev: number | null; next: number; source: SocSource; prevAt: string | null; at: string };

export class SocModel {
  value: number | null = null;
  source: SocSource | null = null;
  updatedAt: string | null = null;
  /** When the value last moved by an anchor (manual/CAN) or a whole-percent step. */
  private onAnchor?: (c: SocChange) => void;

  constructor(init?: SocSnapshot, onAnchor?: (c: SocChange) => void) {
    if (init && typeof init.value === 'number' && Number.isFinite(init.value)) {
      this.value = clampSoc(init.value);
      // A value carried over a restart is no longer a fresh reading.
      this.source = init.source === 'can' || init.source === 'manual' || init.source === 'estimate' ? 'estimate' : null;
      this.updatedAt = init.updatedAt;
    }
    this.onAnchor = onAnchor;
  }

  setManual(v: number, now = new Date()) { this.anchor(v, 'manual', now); }
  setCan(v: number, now = new Date()) { this.anchor(v, 'can', now); }

  private anchor(v: number, source: SocSource, now: Date) {
    if (!Number.isFinite(v)) return;
    const prev = this.value, prevAt = this.updatedAt;
    this.value = clampSoc(Math.round(v * 10) / 10);
    this.source = source;
    this.updatedAt = now.toISOString();
    this.onAnchor?.({ prev, next: this.value, source, prevAt, at: this.updatedAt });
  }

  /** Decay by driven miles. A CAN reading is never overridden by the model. */
  addMiles(miles: number, effMiPerKwh: number, packKwh: number, now = new Date()) {
    if (this.value === null || this.source === 'can' || !(miles > 0)) return;
    const next = socAfterMiles(this.value, miles, effMiPerKwh, packKwh);
    if (next === this.value) return;
    this.value = next;
    this.source = 'estimate';
    this.updatedAt = now.toISOString();
  }

  snapshot(): SocSnapshot { return { value: this.value, source: this.source, updatedAt: this.updatedAt }; }
}
