# Universal camera bracket

A small tilting bracket for cheap 360° and AHD cube cameras. It sticks down with
3M VHB or bolts down with 2× M4. The hinge locks with serrated faces (24
teeth, 15° steps) and one M5 bolt, so it holds its angle on a vibrating truck
instead of relying on friction.
Source: `cam-bracket.scad`. STLs and previews: `stl/`.

## Parts (print orientation)

| STL | Size (mm) | Notes |
|---|---|---|
| `base` | 56 × 34 × 29 | Base and fork. M4 holes are countersunk from the top; the bottom is flat for VHB. |
| `arm` | 46 × 30 × 35 | Knuckle, arm and camera plate. Prints plate-down. |

Camera holes are set with `cam_holes` (a list of [x, y] points about the plate
centre) and `cam_hole_d`:
- The default is one 1/4-20 tripod hole, slotted ±3 mm.
- For an M3 three-hole pattern on a 20 mm circle, set
  `cam_holes = [[10,0],[-5,8.66],[-5,-8.66]]` and `cam_hole_d = 3.4`.

The base's 34 mm M4 pitch matches the hitch mount's top plate.

## Print settings

- **ASA** (outdoors, UV). 0.2 mm layers.
- **5 walls** for strength in the hinge, 40% infill.
- No supports:
  - The serrations are on vertical faces in both parts.
  - The arm's knuckle sits on a 45° skirt.
- Base: bottom face down. Arm: camera plate down.

## Hardware

- 1× M5 × 25 socket-head bolt.
- 1× M5 nut, pressed into the hex trap on the fork.
- 2× M4 flat-head screws, or 3M VHB.
  - Use 5952 on painted or powder-coated surfaces, or 4910 on clear or glass.
  - Clean with IPA first and press hard for 30 s.
  - VHB needs ~72 h to reach full strength, and should be applied above 15 °C.
- 1× 1/4-20 × 1/2" screw, or the screws your camera takes.

## Measure before printing

- The camera's mount: the tripod thread or the hole pattern, the screw size,
  and the footprint (`plate_l`/`plate_w`).
- The mounting surface: it needs to be flat over 56 × 34 mm. On a curved
  mirror housing or tailgate, VHB needs full contact, so measure the curve first.
- Whether the camera's weight and cable pull call for the M4 screws rather than VHB on that spot.
