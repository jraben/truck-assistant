// Jeff's truck as configured, flat SVG, for the tilt gauge (docs/drive-v2.md §2).
// A compact 2-door regular-cab Slate: 174.6 in long on a 108.9 in wheelbase,
// about 68 in tall and 70.6 in wide, short 5 ft bed, upright raked windshield,
// short flat-faced nose with round lamps on plates, squared plastic wheel
// flares and 17" steel wheels. Drawn at 2.3 px per inch. Colours come from
// Settings.truck (the owner's build), the surrounding chrome from the theme.
import type { TruckLook } from '../../../brain/src/drive/types.ts';

const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${100 - pct}%, ${b})`;

function Defs({ id, t }: { id: string; t: TruckLook }) {
  const c = t.colors;
  const sheen = t.finish === 'gloss' ? 26 : t.finish === 'satin' ? 14 : 5;
  return (
    <defs>
      <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color={mix(c.body, c.roof, sheen)} />
        <stop offset=".45" stop-color={c.body} />
        <stop offset="1" stop-color={mix(c.body, c.logo, 22)} />
      </linearGradient>
      <linearGradient id={`${id}-lamp`} x1="0" y1="0" x2="1" y2="1">
        {c.lampPlates === 'synthwave'
          ? <><stop offset="0" stop-color="#ff3fb4" /><stop offset=".55" stop-color="#7b2ff7" /><stop offset="1" stop-color="#2de2e6" /></>
          : <><stop offset="0" stop-color={c.lampPlates} /><stop offset="1" stop-color={mix(c.lampPlates, c.logo, 25)} /></>}
      </linearGradient>
      <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color={mix(c.logo, c.roof, 30)} /><stop offset=".6" stop-color={c.logo} />
      </linearGradient>
    </defs>
  );
}

function Wheel({ cx, cy, t }: { cx: number; cy: number; t: TruckLook }) {
  const c = t.colors;
  const holes = [0, 60, 120, 180, 240, 300].map((a) => {
    const r = (a * Math.PI) / 180;
    return <ellipse cx={cx + 13 * Math.cos(r)} cy={cy + 13 * Math.sin(r)} rx="3.2" ry="4.2" transform={`rotate(${a + 90} ${cx + 13 * Math.cos(r)} ${cy + 13 * Math.sin(r)})`} fill={mix(c.logo, c.trim, 30)} />;
  });
  return (
    <g>
      <circle cx={cx} cy={cy} r="33" fill={mix(c.logo, c.trim, 15)} />
      <circle cx={cx} cy={cy} r="29" fill="none" stroke={mix(c.logo, c.trim, 35)} stroke-width="1.5" />
      <circle cx={cx} cy={cy} r="21" fill={c.wheelDecal} />
      <circle cx={cx} cy={cy} r="21" fill="none" stroke={mix(c.wheelDecal, c.logo, 35)} stroke-width="1.2" />
      {holes}
      <circle cx={cx} cy={cy} r="6.5" fill={mix(c.wheelDecal, c.logo, 30)} />
      <circle cx={cx} cy={cy} r="2.4" fill={c.logo} />
    </g>
  );
}

/** Side view, nose to the right. viewBox 0 0 440 200, ground at y = 186. */
export function TruckSide({ t, id = 'ts', bedLightsOn = false }: { t: TruckLook; id?: string; bedLightsOn?: boolean }) {
  const c = t.colors;
  const RA = 102, FA = 352, WY = 153; // axles at 108.9 in apart
  const arch = (x: number) => `L${x + 46} 160 L${x + 40} 118 Q${x + 37} 112 ${x + 31} 112 L${x - 31} 112 Q${x - 37} 112 ${x - 40} 118 L${x - 46} 160`;
  // Body outline: tailgate, bed rail, cab back, roof, windshield, hood, nose, sill (with arches)
  const body = `M20 90 L214 90 L216 40 Q217 31 226 30 L288 30 Q296 30 300 36 L338 90 L404 96 Q418 98 420 106 L422 150 Q422 160 412 160 ${arch(FA)} L${RA + 46} 160 ${arch(RA)} L24 160 Q18 160 18 152 L18 94 Q18 90 20 90 Z`;
  const flare = (x: number) => <path d={`M${x - 50} 162 L${x - 44} 116 Q${x - 41} 107 ${x - 33} 107 L${x + 33} 107 Q${x + 41} 107 ${x + 44} 116 L${x + 50} 162 L${x + 42} 162 L${x + 37} 119 Q${x + 35} 114 ${x + 30} 114 L${x - 30} 114 Q${x - 35} 114 ${x - 37} 119 L${x - 42} 162 Z`} fill={c.trim} />;
  return (
    <svg class="truck-art" viewBox="0 0 440 200" role="img" aria-label="Truck, side view">
      <Defs id={id} t={t} />
      <path d={body} fill={`url(#${id}-body)`} />
      {/* roof wrap (partial: the roof panel only) */}
      {t.roofWrap && <path d="M216.5 38 Q217 31 226 30 L288 30 Q296 30 300 36 L303 40 L216.4 41 Z" fill={c.roof} />}
      {/* side glass, A-pillar following the windshield */}
      <path d="M228 42 L284 42 Q290 42 293 47 L322 86 L228 86 Z" fill={`url(#${id}-glass)`} />
      <path d="M236 46 L252 46 L240 70 Z" fill={c.roof} opacity=".18" />
      {/* door cut, handle, mirror */}
      <path d="M226 90 L226 152 M334 92 L334 150" stroke={mix(c.body, c.logo, 45)} stroke-width="1.4" fill="none" />
      <path d="M226 90 L330 90" stroke={mix(c.body, c.logo, 30)} stroke-width="1" />
      <rect x="236" y="98" width="16" height="4" rx="2" fill={mix(c.body, c.logo, 45)} />
      <path d="M318 84 L330 80 L334 92 L322 94 Z" fill={c.trim} />
      {/* bed: side panel line, SLATE decal */}
      <path d="M24 98 L210 98" stroke={mix(c.body, c.logo, 30)} stroke-width="1" />
      <text x="266" y="140" text-anchor="middle" class="truck-logo sm" fill={c.logo}>SLATE</text>
      {/* tonneau: NEXUS flip-up hard cover, flush on the bed rails */}
      {t.accessories.tonneau === 'nexus-flip' && <>
        <path d="M19 84 L214 84 L214 91 L19 91 Z" fill={mix(c.logo, c.trim, 20)} />
        <path d="M84 84 L84 91 M149 84 L149 91" stroke={mix(c.trim, c.logo, 10)} stroke-width="1" />
      </>}
      {/* bed lights: a warm strip under the rail, lit when the bed lights relay is on */}
      {t.accessories.bedLights && <path d="M28 94 L208 94" stroke={bedLightsOn ? 'var(--warn)' : mix(c.trim, c.logo, 40)} stroke-width={bedLightsOn ? 2.5 : 1.5} stroke-linecap="round" class={bedLightsOn ? 'bedlit' : undefined} />}
      {/* front: lamp plate with its round lamp, bumper; rear: tail lamp, bumper, hitch */}
      <path d="M409 100 Q418 101 419 108 L420 128 L408 128 Z" fill={`url(#${id}-lamp)`} />
      <circle cx="414" cy="114" r="5" fill={c.roof} opacity=".9" />
      <path d="M402 136 L424 136 Q428 136 428 141 L428 156 Q428 162 422 162 L398 162 Z" fill={c.trim} />
      <rect x="15" y="96" width="5" height="26" rx="1.5" fill="var(--bad)" />
      <path d="M12 140 L30 140 L30 162 L16 162 Q12 162 12 158 Z" fill={c.trim} />
      {t.accessories.hitch && <><rect x="2" y="152" width="14" height="9" rx="1" fill={mix(c.trim, c.logo, 45)} /><circle cx="7" cy="156.5" r="1.6" fill={c.roof} /></>}
      {flare(RA)}{flare(FA)}
      <Wheel cx={RA} cy={WY} t={t} /><Wheel cx={FA} cy={WY} t={t} />
    </svg>
  );
}

/** Rear view (for roll). viewBox 0 0 220 200, ground at y = 186. */
export function TruckRear({ t, id = 'tr' }: { t: TruckLook; id?: string }) {
  const c = t.colors;
  return (
    <svg class="truck-art" viewBox="0 0 220 200" role="img" aria-label="Truck, rear view">
      <Defs id={id} t={t} />
      {/* tyres */}
      <rect x="27" y="124" width="26" height="62" rx="7" fill={mix(c.logo, c.trim, 15)} />
      <rect x="167" y="124" width="26" height="62" rx="7" fill={mix(c.logo, c.trim, 15)} />
      {/* cab behind the bed */}
      <path d="M52 86 L58 36 Q60 29 68 29 L152 29 Q160 29 162 36 L168 86 Z" fill={`url(#${id}-body)`} />
      {t.roofWrap && <path d="M57.5 40 L58 36 Q60 29 68 29 L152 29 Q160 29 162 36 L162.5 40 Z" fill={c.roof} />}
      <path d="M66 44 L154 44 L158 78 L62 78 Z" fill={`url(#${id}-glass)`} />
      <path d="M74 48 L96 48 L80 70 Z" fill={c.roof} opacity=".18" />
      {/* mirrors */}
      <path d="M40 74 L52 72 L52 84 L40 84 Z M180 74 L168 72 L168 84 L180 84 Z" fill={c.trim} />
      {/* bed box and tailgate */}
      <path d="M30 88 L190 88 L192 150 L28 150 Z" fill={`url(#${id}-body)`} />
      {t.accessories.tonneau === 'nexus-flip' && <path d="M28 82 L192 82 L192 90 L28 90 Z" fill={mix(c.logo, c.trim, 20)} />}
      {t.accessories.bedLights && <path d="M34 93 L186 93" stroke={mix(c.trim, c.logo, 40)} stroke-width="1.2" />}
      <path d="M44 96 L176 96 L176 142 L44 142 Z" fill="none" stroke={mix(c.body, c.logo, 30)} stroke-width="1" />
      <text x="110" y="126" text-anchor="middle" class="truck-logo" fill={c.logo}>SLATE</text>
      <rect x="32" y="94" width="9" height="30" rx="2" fill="var(--bad)" />
      <rect x="179" y="94" width="9" height="30" rx="2" fill="var(--bad)" />
      {/* bumper, hitch receiver */}
      <path d="M24 148 L196 148 L196 162 Q196 166 192 166 L28 166 Q24 166 24 162 Z" fill={c.trim} />
      {t.accessories.hitch && <><rect x="101" y="162" width="18" height="14" rx="1.5" fill={mix(c.trim, c.logo, 45)} /><rect x="105" y="166" width="10" height="7" fill={c.logo} /></>}
    </svg>
  );
}
