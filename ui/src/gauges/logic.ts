// Pure helpers for the Gauges screen: dial angles, colour bands, the compass and
// the fault-code reader. No Preact, no Leaflet, so tests import this directly.
import type { Layout } from '../../../brain/src/types.ts';

export type Tone = 'ok' | 'warn' | 'bad' | 'dim';

export const GAUGES_ICON = 'M12 14a2 2 0 1 0 0-4M12 12l4-4M3 15a9 9 0 1 1 18 0M6 15h.01M18 15h.01M12 6v.01';
export const GAUGES_VIEW: Layout['views'][number] = { id: 'gauges', label: 'Gauges', widgets: [{ type: 'gauges', col: 1, row: 1, w: 12, h: 2 }] };

/** Every layout gets the Gauges view, after Map (or Drive), unless it already has one. */
export function withGaugesView(layout: Layout): Layout {
  if (layout.views.some((v) => v.id === 'gauges')) return layout;
  let i = layout.views.findIndex((v) => v.id === 'map');
  if (i < 0) i = layout.views.findIndex((v) => v.id === 'drive');
  const views = [...layout.views];
  views.splice(i >= 0 ? i + 1 : views.length, 0, GAUGES_VIEW);
  return { ...layout, views };
}

/** A dial sweeps 240°, from -120° (min) to +120° (max). Clamped; null stays at min. */
export const SWEEP = 240;
export function dialAngle(v: number | null, min: number, max: number): number {
  if (v === null || !Number.isFinite(v) || max <= min) return -SWEEP / 2;
  const f = Math.min(1, Math.max(0, (v - min) / (max - min)));
  return -SWEEP / 2 + f * SWEEP;
}

/** 12V battery: resting 12.4+ is healthy, 13.2+ is charging, below 12.2 is low, below 11.9 won't start soon. */
export function batteryTone(v: number | null): Tone {
  if (v === null) return 'dim';
  if (v < 11.9) return 'bad';
  if (v < 12.2) return 'warn';
  return 'ok';
}
export function batteryWords(v: number | null): string {
  if (v === null) return 'Not reported';
  if (v >= 13.2) return 'Charging';
  if (v >= 12.4) return 'Healthy';
  if (v >= 12.2) return 'A little low';
  if (v >= 11.9) return 'Low: charge it soon';
  return 'Very low: may not start';
}

/** Tyre pressure, matching the Control screen: under 34 psi is low, under 28 is flat-ish, over 50 is too high. */
export function tireTone(psi: number | null): Tone {
  if (psi === null) return 'dim';
  if (psi < 28) return 'bad';
  if (psi < 34 || psi > 50) return 'warn';
  return 'ok';
}

export function socTone(soc: number | null): Tone {
  if (soc === null) return 'dim';
  return soc < 15 ? 'bad' : soc < 30 ? 'warn' : 'ok';
}

/** Tilt: beyond 15° is worth a look, beyond 25° is steep. */
export function tiltTone(deg: number | null): Tone {
  if (deg === null) return 'dim';
  const a = Math.abs(deg);
  return a > 25 ? 'bad' : a > 15 ? 'warn' : 'ok';
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compassPoint(deg: number | null): string | null {
  if (deg === null || !Number.isFinite(deg)) return null;
  const d = ((deg % 360) + 360) % 360;
  return POINTS[Math.round(d / 45) % 8];
}

// ── Fault codes ──────────────────────────────────────────────────────────────
// The generic SAE J2012 meaning from the code's shape, plus the common codes
// in plain English. Maker-specific codes (P1xxx, …) get their system only.

const LETTER: Record<string, string> = { P: 'Engine and transmission', C: 'Chassis (brakes, steering, suspension)', B: 'Body (airbags, seats, lights)', U: 'Network (modules talking to each other)' };
const P_SYSTEM: Record<string, string> = {
  '0': 'Fuel, air and emissions', '1': 'Fuel and air metering', '2': 'Fuel and air metering (injectors)', '3': 'Ignition or misfire',
  '4': 'Emission controls', '5': 'Speed, idle and inputs', '6': 'Engine computer and outputs', '7': 'Transmission', '8': 'Transmission', '9': 'Transmission',
  A: 'Hybrid or EV drive', B: 'Hybrid or EV drive', C: 'Hybrid or EV drive',
};

export const COMMON_CODES: Record<string, string> = {
  P0011: 'Intake cam timing is more advanced than asked for (often low or dirty oil)',
  P0101: 'Mass airflow sensor reading looks wrong (often a dirty sensor or an air leak)',
  P0113: 'Intake air temperature sensor reads too hot (unplugged or failed)',
  P0128: 'Engine is warming up too slowly (usually a thermostat stuck open)',
  P0131: 'Upstream oxygen sensor voltage low (bank 1)',
  P0135: 'Upstream oxygen sensor heater not working (bank 1)',
  P0141: 'Downstream oxygen sensor heater not working (bank 1)',
  P0171: 'Running lean, bank 1 (an air leak, a weak fuel pump or a dirty airflow sensor)',
  P0172: 'Running rich, bank 1 (a leaking injector or high fuel pressure)',
  P0174: 'Running lean, bank 2 (an air leak, a weak fuel pump or a dirty airflow sensor)',
  P0300: 'Random misfires on several cylinders',
  P0301: 'Cylinder 1 misfire', P0302: 'Cylinder 2 misfire', P0303: 'Cylinder 3 misfire', P0304: 'Cylinder 4 misfire',
  P0305: 'Cylinder 5 misfire', P0306: 'Cylinder 6 misfire', P0307: 'Cylinder 7 misfire', P0308: 'Cylinder 8 misfire',
  P0325: 'Knock sensor circuit fault',
  P0335: 'Crankshaft position sensor circuit fault (can stall or not start)',
  P0340: 'Camshaft position sensor circuit fault',
  P0401: 'Too little exhaust gas recirculation (EGR passages often clogged)',
  P0402: 'Too much exhaust gas recirculation',
  P0420: 'Catalytic converter below threshold, bank 1',
  P0430: 'Catalytic converter below threshold, bank 2',
  P0440: 'Fuel vapour (EVAP) system fault',
  P0442: 'Small EVAP leak (often the gas cap)',
  P0446: 'EVAP vent control fault',
  P0455: 'Large EVAP leak (check the gas cap first)',
  P0456: 'Very small EVAP leak (often the gas cap)',
  P0500: 'Vehicle speed sensor fault',
  P0505: 'Idle control fault (rough or high idle)',
  P0562: 'System voltage low (check the battery and alternator)',
  P0563: 'System voltage high (alternator overcharging)',
  P0601: 'Engine computer memory fault',
  P0700: 'The transmission computer has stored its own fault: read it for the detail',
  P0715: 'Transmission input speed sensor fault',
  P0741: 'Torque converter clutch stuck off',
  P0750: 'Shift solenoid A fault',
  C0035: 'Left front wheel speed sensor fault (ABS light)',
  C0040: 'Right front wheel speed sensor fault (ABS light)',
  B0001: 'Driver front airbag circuit fault',
  U0100: 'Lost communication with the engine computer',
  U0101: 'Lost communication with the transmission computer',
  U0121: 'Lost communication with the ABS module',
  U0140: 'Lost communication with the body control module',
};

export type CodeMeaning = { code: string; valid: boolean; area: string; meaning: string; generic: boolean; known: boolean };

/** Plain English for a fault code like "p0420". Pure. */
export function explainCode(raw: string): CodeMeaning {
  const code = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[PCBU][0-3][0-9A-F]{3}$/.test(code)) return { code, valid: false, area: '', meaning: 'Not a fault code: one letter (P, C, B or U) then four characters, like P0420.', generic: false, known: false };
  const generic = code[1] === '0' || (code[0] === 'P' && code[1] === '2');
  const area = code[0] === 'P' ? `${LETTER.P}: ${P_SYSTEM[code[2]] ?? 'Other'}` : LETTER[code[0]];
  const known = code in COMMON_CODES;
  const meaning = known ? COMMON_CODES[code]
    : generic ? 'A standard code not in this list yet: search the code for its exact wording.'
    : "Maker-specific: the meaning depends on the make. Search the code with the vehicle's make.";
  return { code, valid: true, area, meaning, generic, known };
}
