// The owner's truck as configured (Settings.truck), flat SVG, for the tilt gauge (docs/drive-v2.md §2).
// A compact 2-door regular-cab Slate: 174.6 in long on a 108.9 in wheelbase,
// about 68 in tall and 70.6 in wide, short 5 ft bed, upright raked windshield,
// short flat-faced nose with round lamps on plates, squared plastic wheel
// flares and 17" steel wheels. Drawn at 2.3 px per inch. Colours come from
// Settings.truck (the owner's build), the surrounding chrome from the theme.
import type { ComponentChildren } from 'preact';
import type { TruckLook } from '../../../brain/src/drive/types.ts';

const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${100 - pct}%, ${b})`;
/** Tar Pit: glass, tyres, the steel wheels, shading. Fixed, so a "none" logo leaves nothing undrawn. */
const INK = '#1c1d1f';
/** The round amber lamps on Slate's Synthwave front lamp plates. */
const AMBER = '#f0a21a';
const hasLogo = (t: TruckLook) => t.colors.logo !== 'none';

function Defs({ id, t }: { id: string; t: TruckLook }) {
  const c = t.colors;
  const sheen = t.finish === 'gloss' ? 30 : t.finish === 'satin' ? 18 : 6;
  const refl = t.finish === 'gloss' ? 0.5 : t.finish === 'satin' ? 0.3 : 0.1;
  return (
    <defs>
      {/* Paint: a lit shoulder, the body colour, then a darker rocker in the shade under it. */}
      <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color={mix(c.body, '#ffffff', sheen)} />
        <stop offset=".28" stop-color={c.body} />
        <stop offset=".62" stop-color={mix(c.body, INK, 10)} />
        <stop offset=".66" stop-color={mix(c.body, '#ffffff', sheen * 0.6)} />
        <stop offset=".72" stop-color={mix(c.body, INK, 14)} />
        <stop offset="1" stop-color={mix(c.body, INK, 42)} />
      </linearGradient>
      {/* Front-to-back light fall-off, laid over the paint. */}
      <linearGradient id={`${id}-fall`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity=".22" /><stop offset=".45" stop-color="#000" stop-opacity="0" />
        <stop offset=".8" stop-color="#fff" stop-opacity={refl * 0.25} /><stop offset="1" stop-color="#000" stop-opacity=".12" />
      </linearGradient>
      <linearGradient id={`${id}-lamp`} x1="0" y1="0" x2="1" y2="1">
        {c.lampPlates === 'synthwave'
          ? <><stop offset="0" stop-color={mix(INK, '#ffffff', 16)} /><stop offset="1" stop-color={INK} /></>
          : <><stop offset="0" stop-color={mix(c.lampPlates, '#ffffff', 12)} /><stop offset="1" stop-color={mix(c.lampPlates, INK, 30)} /></>}
      </linearGradient>
      {/* Tinted glass: sky at the top fading to the dark cabin. */}
      <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5d6b78" /><stop offset=".35" stop-color="#26303a" /><stop offset="1" stop-color="#0d1014" />
      </linearGradient>
      <linearGradient id={`${id}-trim`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color={mix(c.trim, '#ffffff', 10)} /><stop offset="1" stop-color={mix(c.trim, INK, 35)} />
      </linearGradient>
      <radialGradient id={`${id}-tyre`} cx=".5" cy=".5" r=".5">
        <stop offset=".62" stop-color="#2a2b2e" /><stop offset=".8" stop-color="#1a1b1d" /><stop offset=".93" stop-color="#232427" /><stop offset="1" stop-color="#0e0f10" />
      </radialGradient>
      {/* Black painted steel: near-black with a soft satin sheen, never silver. */}
      <radialGradient id={`${id}-rim`} cx=".4" cy=".35" r=".8">
        <stop offset="0" stop-color="#3a3c40" /><stop offset=".5" stop-color="#1e1f22" /><stop offset="1" stop-color="#101113" />
      </radialGradient>
      <radialGradient id={`${id}-well`} cx=".5" cy=".75" r=".7">
        <stop offset="0" stop-color="#050506" /><stop offset="1" stop-color="#1a1b1d" />
      </radialGradient>
      <radialGradient id={`${id}-shadow`} cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#000" stop-opacity=".55" /><stop offset=".7" stop-color="#000" stop-opacity=".18" /><stop offset="1" stop-color="#000" stop-opacity="0" />
      </radialGradient>
      <radialGradient id={`${id}-head`} cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#ffffff" /><stop offset=".55" stop-color="#fdf7e4" /><stop offset="1" stop-color="#cfc8b4" />
      </radialGradient>
      <linearGradient id={`${id}-tail`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ff6a5c" /><stop offset=".5" stop-color="#d71f1f" /><stop offset="1" stop-color="#7c0d0d" />
      </linearGradient>
      <filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" /></filter>
    </defs>
  );
}

/** Slate's stock 17" black steel wheel (no hubcap): a stamped face with a raised outer
 *  barrel, a ring of round vent holes, the dished centre with exposed lug nuts, and the
 *  owner's single-colour ring decal (wheelDecal) on the face. */
function Wheel({ cx, cy, t, id }: { cx: number; cy: number; t: TruckLook; id: string }) {
  const c = t.colors;
  const at = (n: number, r: number, off = 0) => Array.from({ length: n }, (_, i) => {
    const a = ((i * 360) / n + off) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });
  return (
    <g>
      {/* tyre: rubber with a sidewall, and the tread's edge */}
      <circle cx={cx} cy={cy} r="33" fill={`url(#${id}-tyre)`} />
      <circle cx={cx} cy={cy} r="30.5" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="1" />
      <path d={`M${cx - 26} ${cy - 16} A30 30 0 0 1 ${cx + 6} ${cy - 30}`} fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="3" stroke-linecap="round" />
      {/* steel barrel lip and the stamped face */}
      <circle cx={cx} cy={cy} r="23" fill="#0c0d0e" />
      <circle cx={cx} cy={cy} r="22" fill={`url(#${id}-rim)`} />
      <circle cx={cx} cy={cy} r="21.2" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="1" />
      <circle cx={cx} cy={cy} r="20.2" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1" />
      {/* the ring decal */}
      <circle cx={cx} cy={cy} r="18" fill="none" stroke={c.wheelDecal} stroke-width="2.6" />
      {/* round vent holes stamped through the face */}
      {at(8, 13.2, 22.5).map(([x, y]) => <><circle cx={x} cy={y} r="2.9" fill="#030304" /><path d={`M${x - 2.2} ${y - 1.4} A2.9 2.9 0 0 1 ${x + 1.6} ${y - 2.4}`} fill="none" stroke="#fff" stroke-opacity=".12" stroke-width=".6" /></>)}
      {/* dished centre: a raised ring, the hub, and exposed lug nuts */}
      <circle cx={cx} cy={cy} r="9" fill="#17181a" stroke="#000" stroke-opacity=".6" stroke-width=".8" />
      <circle cx={cx} cy={cy} r="8.2" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width=".6" />
      {at(6, 5.8, 0).map(([x, y]) => <><circle cx={x} cy={y} r="1.35" fill="#5b5e63" /><circle cx={x - .35} cy={y - .35} r=".45" fill="#b9bcc0" /></>)}
      <circle cx={cx} cy={cy} r="2.6" fill="#0a0a0b" stroke="#3a3c40" stroke-width=".6" />
      {/* the satin catch-light across the top of the face */}
      <path d={`M${cx - 16} ${cy - 13} A20.5 20.5 0 0 1 ${cx + 3} ${cy - 20.3}`} fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="1.6" stroke-linecap="round" />
    </g>
  );
}

/** Side view, nose to the right. viewBox 0 0 440 200, ground at y = 186. */
export function TruckSide({ t, id = 'ts', bedLightsOn = false, children }: { t: TruckLook; id?: string; bedLightsOn?: boolean; children?: ComponentChildren }) {
  const c = t.colors;
  const RA = 102, FA = 352, WY = 153; // axles at 108.9 in apart
  const arch = (x: number) => `L${x + 46} 160 L${x + 40} 118 Q${x + 37} 112 ${x + 31} 112 L${x - 31} 112 Q${x - 37} 112 ${x - 40} 118 L${x - 46} 160`;
  // Body outline: tailgate, bed rail, cab back, roof, windshield, hood, nose, sill (with arches)
  const body = `M20 90 L214 90 L216 40 Q217 31 226 30 L288 30 Q296 30 300 36 L338 90 L404 96 Q418 98 420 106 L422 150 Q422 160 412 160 ${arch(FA)} L${RA + 46} 160 ${arch(RA)} L24 160 Q18 160 18 152 L18 94 Q18 90 20 90 Z`;
  const flare = (x: number) => <path d={`M${x - 50} 162 L${x - 44} 116 Q${x - 41} 107 ${x - 33} 107 L${x + 33} 107 Q${x + 41} 107 ${x + 44} 116 L${x + 50} 162 L${x + 42} 162 L${x + 37} 119 Q${x + 35} 114 ${x + 30} 114 L${x - 30} 114 Q${x - 35} 114 ${x - 37} 119 L${x - 42} 162 Z`} fill={`url(#${id}-trim)`} />;
  return (
    <svg class="truck-art" viewBox="0 0 440 200" role="img" aria-label="Truck, side view">
      <Defs id={id} t={t} />
      {/* contact shadow on the ground */}
      <ellipse cx="222" cy="188" rx="214" ry="9" fill={`url(#${id}-shadow)`} />
      {/* dark wheel wells behind the tyres */}
      <path d={`M${RA - 44} 160 L${RA - 39} 117 Q${RA - 36} 111 ${RA - 30} 111 L${RA + 30} 111 Q${RA + 36} 111 ${RA + 39} 117 L${RA + 44} 160 Z M${FA - 44} 160 L${FA - 39} 117 Q${FA - 36} 111 ${FA - 30} 111 L${FA + 30} 111 Q${FA + 36} 111 ${FA + 39} 117 L${FA + 44} 160 Z`} fill={`url(#${id}-well)`} />
      <path d={body} fill={`url(#${id}-body)`} />
      <path d={body} fill={`url(#${id}-fall)`} />
      {/* shoulder highlight: the sky caught along the belt line */}
      <path d="M22 93 L212 93 M338 93 L402 99" stroke="#fff" stroke-opacity={t.finish === 'matte' ? 0.08 : 0.28} stroke-width="1.6" stroke-linecap="round" />
      {/* the rocker in shadow */}
      <path d="M24 155 L56 155 M148 155 L306 155 M398 155 L414 155" stroke="#000" stroke-opacity=".22" stroke-width="6" />
      {/* roof wrap (partial: the roof panel only) */}
      {t.roofWrap && <path d="M216.5 38 Q217 31 226 30 L288 30 Q296 30 300 36 L303 40 L216.4 41 Z" fill={c.roof} />}
      {/* side glass, A-pillar following the windshield */}
      <path d="M225 39 L286 39 Q293 39 297 45 L327 89 L225 89 Z" fill="#0b0c0d" />
      <path d="M228 42 L284 42 Q290 42 293 47 L322 86 L228 86 Z" fill={`url(#${id}-glass)`} />
      <path d="M240 42 L262 42 L246 86 L226 86 Z" fill="#fff" opacity=".07" />
      <path d="M270 42 L278 42 L262 86 L256 86 Z" fill="#fff" opacity=".1" />
      <path d="M228 66 Q270 60 318 80" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1" />
      {/* door cut, handle, mirror */}
      <path d="M226 90 L226 152 M334 92 L334 150" stroke={mix(c.body, INK, 45)} stroke-width="1.4" fill="none" />
      <path d="M226 90 L330 90" stroke={mix(c.body, INK, 30)} stroke-width="1" />
      <rect x="236" y="98" width="16" height="4.5" rx="2.2" fill={mix(c.body, INK, 55)} />
      <rect x="237" y="98.4" width="14" height="1.4" rx=".7" fill="#fff" opacity=".25" />
      <path d="M318 84 L330 80 L334 92 L322 94 Z" fill={`url(#${id}-trim)`} />
      <path d="M321 85 L329 82 L331 89 L323 91 Z" fill="#1c2630" />
      {/* bed: side panel line, SLATE decal */}
      <path d="M24 98 L210 98" stroke={mix(c.body, INK, 30)} stroke-width="1" />
      {hasLogo(t) && <text x="266" y="140" text-anchor="middle" class="truck-logo sm" fill={c.logo}>SLATE</text>}
      {/* tonneau: NEXUS flip-up hard cover, flush on the bed rails */}
      {t.accessories.tonneau === 'nexus-flip' && <>
        <path d="M19 84 L214 84 L214 91 L19 91 Z" fill={mix(INK, c.trim, 20)} />
        <path d="M84 84 L84 91 M149 84 L149 91" stroke={mix(c.trim, INK, 10)} stroke-width="1" />
      </>}
      {/* bed lights: a warm strip under the rail, lit when the bed lights relay is on */}
      {t.accessories.bedLights && <path d="M28 94 L208 94" stroke={bedLightsOn ? 'var(--warn)' : mix(c.trim, INK, 40)} stroke-width={bedLightsOn ? 2.5 : 1.5} stroke-linecap="round" class={bedLightsOn ? 'bedlit' : undefined} />}
      {/* front: lamp plate with its round lamp, bumper; rear: tail lamp, bumper, hitch */}
      <path d="M409 100 Q418 101 419 108 L420 128 L408 128 Z" fill={`url(#${id}-lamp)`} />
      <circle cx="414" cy="114" r="9" fill={c.lampPlates === 'synthwave' ? AMBER : '#fff6dc'} opacity=".35" filter={`url(#${id}-glow)`} />
      <circle cx="414" cy="114" r="5.2" fill={c.lampPlates === 'synthwave' ? AMBER : `url(#${id}-head)`} />
      <circle cx="414" cy="114" r="5.2" fill="none" stroke={INK} stroke-width="1" />
      <circle cx="412.6" cy="112.4" r="1.4" fill="#fff" opacity=".85" />
      <path d="M402 136 L424 136 Q428 136 428 141 L428 156 Q428 162 422 162 L398 162 Z" fill={`url(#${id}-trim)`} />
      <rect x="15" y="96" width="5" height="26" rx="1.5" fill={`url(#${id}-tail)`} />
      <rect x="15.6" y="98" width="1.6" height="22" rx=".8" fill="#fff" opacity=".35" />
      <path d="M12 140 L30 140 L30 162 L16 162 Q12 162 12 158 Z" fill={`url(#${id}-trim)`} />
      {t.accessories.hitch && <><rect x="2" y="152" width="14" height="9" rx="1" fill={mix(c.trim, INK, 45)} /><circle cx="7" cy="156.5" r="1.6" fill={c.roof} /></>}
      {flare(RA)}{flare(FA)}
      <Wheel cx={RA} cy={WY} t={t} id={id} /><Wheel cx={FA} cy={WY} t={t} id={id} />
      {children}
    </svg>
  );
}

/** Rear view (for roll, and the chase view while driving). viewBox 0 0 220 200, ground at y = 186.
 *  braking: the tail lamps lit bright, as when the truck slows. */
export function TruckRear({ t, id = 'tr', braking = false }: { t: TruckLook; id?: string; braking?: boolean }) {
  const c = t.colors;
  // Tail and brake lamps in the tailgate itself: a wide lamp across each upper corner.
  const tail = (x: number) => (
    <g>
      {braking && <rect x={x - 5} y="96" width="40" height="18" rx="6" fill="#ff2a1f" opacity=".55" filter={`url(#${id}-glow)`} />}
      <rect x={x} y="100" width="30" height="10" rx="2.5" fill={`url(#${id}-tail)`} />
      <rect x={x + 2} y="101.5" width="26" height="2" rx="1" fill="#fff" opacity={braking ? 0.5 : 0.25} />
      <rect x={x + 14.5} y="100" width="1" height="10" fill="#000" opacity=".3" />
    </g>
  );
  return (
    <svg class="truck-art" viewBox="0 0 220 200" role="img" aria-label="Truck, rear view">
      <Defs id={id} t={t} />
      <ellipse cx="110" cy="187" rx="104" ry="8" fill={`url(#${id}-shadow)`} />
      {/* tyres, with the dark underside between them */}
      <rect x="40" y="150" width="140" height="28" fill="#08090a" />
      <rect x="27" y="124" width="26" height="62" rx="7" fill="#1b1c1e" />
      <rect x="167" y="124" width="26" height="62" rx="7" fill="#1b1c1e" />
      <path d="M31 132 L31 178 M189 132 L189 178" stroke="#fff" stroke-opacity=".07" stroke-width="3" stroke-linecap="round" />
      <path d="M27 140 L53 140 M27 150 L53 150 M27 160 L53 160 M27 170 L53 170 M167 140 L193 140 M167 150 L193 150 M167 160 L193 160 M167 170 L193 170" stroke="#000" stroke-opacity=".35" stroke-width="1" />
      {/* cab behind the bed */}
      <path d="M52 86 L58 36 Q60 29 68 29 L152 29 Q160 29 162 36 L168 86 Z" fill={`url(#${id}-body)`} />
      {t.roofWrap && <path d="M57.5 40 L58 36 Q60 29 68 29 L152 29 Q160 29 162 36 L162.5 40 Z" fill={c.roof} />}
      <path d="M63 41 L157 41 L161 81 L59 81 Z" fill="#0b0c0d" />
      <path d="M66 44 L154 44 L158 78 L62 78 Z" fill={`url(#${id}-glass)`} />
      <path d="M76 44 L100 44 L84 78 L64 78 Z" fill="#fff" opacity=".07" />
      <path d="M108 44 L114 44 L98 78 L93 78 Z" fill="#fff" opacity=".09" />
      {/* third brake lamp */}
      <rect x="98" y="31.5" width="24" height="3" rx="1.5" fill={braking ? '#ff3b30' : '#6b1414'} />
      {/* mirrors */}
      <path d="M38 73 L52 71 L52 85 L38 85 Q36 85 36 83 L36 75 Q36 73 38 73 Z M182 73 L168 71 L168 85 L182 85 Q184 85 184 83 L184 75 Q184 73 182 73 Z" fill={`url(#${id}-trim)`} />
      {/* bed box and tailgate */}
      <path d="M30 88 L190 88 L192 150 L28 150 Z" fill={`url(#${id}-body)`} />
      <path d="M30 88 L190 88 L190.3 92 L29.8 92 Z" fill="#fff" opacity={t.finish === 'matte' ? 0.06 : 0.2} />
      {t.accessories.tonneau === 'nexus-flip' && <path d="M28 82 L192 82 L192 90 L28 90 Z" fill={mix(INK, c.trim, 20)} />}
      {t.accessories.bedLights && <path d="M34 93 L186 93" stroke={mix(c.trim, INK, 40)} stroke-width="1.2" />}
      <path d="M44 96 L176 96 L176 142 L44 142 Z" fill="none" stroke={mix(c.body, INK, 35)} stroke-width="1" />
      <path d="M44 96 L176 96" stroke="#fff" stroke-opacity=".15" stroke-width="1" transform="translate(0 1)" />
      <rect x="100" y="100" width="20" height="5" rx="2.5" fill={mix(c.body, INK, 55)} />
      {hasLogo(t) && <text x="110" y="126" text-anchor="middle" class="truck-logo" fill={c.logo}>SLATE</text>}
      {tail(48)}{tail(142)}
      {/* bumper with its step, the licence plate, hitch receiver */}
      <path d="M24 148 L196 148 L196 162 Q196 166 192 166 L28 166 Q24 166 24 162 Z" fill={`url(#${id}-trim)`} />
      <path d="M26 149.5 L194 149.5" stroke="#fff" stroke-opacity=".18" stroke-width="1" />
      <rect x="92" y="131" width="36" height="16" rx="1.5" fill="#e9ecef" stroke="#55585f" stroke-width=".8" />
      <rect x="95" y="135" width="30" height="8" rx="1" fill="none" stroke="#9aa0a6" stroke-width=".6" />
      {t.accessories.hitch && <><rect x="101" y="162" width="18" height="14" rx="1.5" fill={mix(c.trim, INK, 45)} /><rect x="105" y="166" width="10" height="7" fill={INK} /></>}
    </svg>
  );
}
