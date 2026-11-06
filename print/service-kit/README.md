# Service kit

The parts that keep the install tidy and quick to work on. Each one comes out
by hand or with a single screw.
Source: `service-kit.scad`. STLs and previews: `stl/`.

| STL | Qty | What it does |
|---|---|---|
| `rail` | 1 | Slide-out rail for the brain enclosure. The enclosure's existing ears slide into the two channels, and one 1/4-20 thumbscrew into a heat-set insert locks it. To pull the brain: loosen the thumbscrew, unplug one Deutsch connector, slide it out. |
| `dock` | 1 | Tray for the Carlinkit and the powered USB hub, held with velcro straps. It bolts to the same dash rail as `rail`, so the USB runs stay short. |
| `dt_bracket` | 1 | The service point. Saddles for Deutsch DT 2/4/6/12-pin plugs (12 V, screen, cameras, truck box), zip-tied, with one M5 mount. Every run in the truck meets here, so any one part unplugs without tracing wires. |
| `loom_clip` / `loom_clip_screw` | 6–10 | Snap clips for 13 mm split loom (`loom_d`), on a VHB pad or an M5 screw. Route along the dash rail and kick panel, with no zip ties around Slate's own harness. |
| `assembly.png` | — | Preview of everything together. |

## Check before printing

- **The dash rail is unmeasured**, as it is for the enclosure. The rail and the
  dock both mount on `rail_mount_pitch` (60 mm assumed) with 1/4-20/M6 slots
  and ±5 mm of adjustment.
- **The DT plug widths are estimates** (`dt_w`: 16/19/23/33 mm). Print the
  bracket and test-fit the real plugs first, or measure them.
- **The Carlinkit and hub sizes** (`dock_cl`, `dock_hub`) are listing sizes.
  Measure yours.
- The rail's channel fits the enclosure's 4 mm ears with 0.5 mm clearance
  (`clear`). Tighten it to 0.3 mm if the brain rattles.

## Print settings

ASA, 0.2 mm layers, 4 walls, 30% infill, no supports. Print the rail and dock
flat side down. Print the loom clips base down: the snap ring is the weak
spot, so use 100% infill there or scale `clip_t` up to 3 mm.

## Hardware

- **Rail:** 2× 1/4-20 heat-set inserts (8 mm hole) plus 1–2 thumbscrews, and 2 bolts to the dash rail.
- **Dock:** 2 bolts to the dash rail and 2× 20 mm velcro straps.
- **DT bracket:** 1× M5 screw and 8 zip ties.
- **Loom clips:** 3M VHB 5952 pads (clean the plastic with IPA first), or M5 screws.
