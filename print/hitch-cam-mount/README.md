# Hitch receiver camera mount

A two-piece collar that clamps round the **outside** of a 2" square hitch
receiver, so a ball mount or bike rack still goes in. The side walls are
slotted so the hitch pin passes through, and the collar can slide ±7 mm. The
top plate takes the cam bracket (2× M4 at 34 mm) or a cube cam's 1/4-20
directly; both use captive nuts on the underside.
Source: `hitch-cam-mount.scad`. STLs and previews: `stl/`.

## Parts (print orientation)

| STL | Size (mm) | Notes |
|---|---|---|
| `collar` | 70 × 103 × 72 | Top plate and side walls. Prints plate-down; chamfers carry the ears. |
| `strap` | 70 × 103 × 7 | Bottom bar, with nut pockets underneath and a drain hole. |

## Print settings

- **ASA** (outdoors, UV, road salt). 0.2 mm layers, 5 walls, 40% infill.
- No supports. The pin slot's roof is a 30 mm bridge, which ASA handles; tidy it with a file if it sags.

## Hardware

- 4× M5 × 20 bolts, with washers and nuts. The nuts sit in the strap's pockets.
- 2× M4 nuts in the top plate's traps (for the cam bracket), plus 2× M4 × 12 bolts.
- 1× 1/4-20 nut (7/16" across flats), if you mount a cube cam directly.
- Liner: 1.5 mm rubber (a strip of old bike inner tube) or a TPU sleeve inside the collar.
  It stops rattle and paint damage. Set `liner` to 0.3 if you use none.
- **A longer hitch pin may be needed.** The collar adds 13 mm to the width the
  pin has to cross: 76.5 mm instead of 63.5 mm. Check your pin's usable length.

## Measure on the truck before printing

1. The outside size of the receiver tube (`tube_w`, `tube_h`, assumed 2.5" / 63.5 mm) and its corner radius (`tube_r`).
2. From the mouth face to the centre of the pin hole (`pin_from_mouth`, assumed 38 mm), and the pin diameter.
3. Anything welded on within 70 mm of the mouth: a reinforcing ring, safety-chain loops or gussets.
   - A mouth ring can be cleared with `mouth_collar_len`/`mouth_collar_w`.
   - Chain loops on the sides need `clamp_len` shortened, or the collar moved.
4. Clearance above the receiver to the bumper and tailgate, and where the camera needs to sit to see past the ball mount.
5. That the clamp ears don't foul the hitch-pin clip or the wiring connector.
