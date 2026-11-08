// The Inverter relay's charge readout. The inverter runs off the truck: its
// 12V system, which the DC-DC tops up from the main pack. So what it has left
// is the main pack's charge, and the 12V reading says whether the DC-DC is
// keeping up. A relay counts as the inverter by its name, because relay names
// are the driver's to edit ("Inverter", "Bed inverter", "120V inverter").
import type { State } from './brain.ts';

export const INVERTER_NAME = /inverter/i;
/** At or below this the tile goes amber: time to think about turning it off. */
export const INVERTER_LOW_SOC = 20;

export type InverterReadout = {
  soc: number | null;
  rangeMi: number | null;
  volts: number | null;
  low: boolean;
};

export function isInverter(name: string | null | undefined): boolean {
  return !!name && INVERTER_NAME.test(name);
}

/** Pure (tested): what the inverter tile shows. */
export function inverterReadout(s: Pick<State, 'soc' | 'rangeMi' | 'aux12v'> | null | undefined): InverterReadout {
  const soc = s?.soc ?? null;
  const rangeMi = s?.rangeMi ?? null;
  const volts = s?.aux12v ?? null;
  return {
    soc: soc === null ? null : Math.round(soc),
    rangeMi: rangeMi === null ? null : Math.round(rangeMi),
    volts: volts === null ? null : Math.round(volts * 10) / 10,
    low: soc !== null && soc <= INVERTER_LOW_SOC,
  };
}
