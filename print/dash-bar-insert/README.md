# Dash bar insert + sun hood (12.3" main screen)

Holds the Waveshare 12.3" 1920×720 HDMI capacitive touch LCD in one of the
two large dash panel openings, with a vented rear cover and a bolt-on sun hood.
Source: `dash-bar-insert.scad`. STLs and previews: `stl/`.

## Where the numbers come from

- **Screen: checked against Waveshare's own data** (wiki `12.3inch_1920x720_LCD`,
  its size drawing, and the STEP file in its download zip):
  - Outline: 301.20 × 123.35 mm, 12.40 mm deep with the driver board. The
    panel itself is 3.00 mm thick.
  - Active area: 293.10 × 110.20 mm, 4.05 mm in from each end, 10.00 mm up
    from the **bottom** edge. That leaves only 3.15 mm at the top.
  - Driver board: 86.5 × 56 mm. It sits on the panel back about 26–112 mm
    in from the left end, seen from the front. All its connectors face left:
    full-size HDMI, USB-C touch, USB-C power and a 3.5 mm jack.
  - **The panel has no mounting holes.** The insert clamps it by its edges.
  - Watch out: Waveshare's other 12.3" model (`12.3inch_HDMI_LCD`, with a
    cover-glass bezel) is 322.63 × 142.11 mm and will **not** fit this design.
- **Opening: forum-measured only.** 13 7/8 × 5 1/4 in (352.4 × 133.35 mm),
  from EV Trek on Slate's prototypes.
- **Assumed:** the depth behind the dash face (`insert_depth`, 40 mm), the
  dash skin thickness (`dash_skin_t`, 3 mm), square-ish corners on the
  opening, and everything about how the factory panel is held in.

## Parts (all fit a 256 mm bed, already in print orientation)

| STL | Qty | Size (mm) | Notes |
|---|---|---|---|
| `bezel_left` / `bezel_right` | 1 each | 187 × 149 × 40 / 184 × 149 × 40 | Flange plus sleeve, split down the middle. Tongue and groove plus two butterfly keys at the joint. |
| `cover_left` / `cover_right` | 1 each | 232 × 132 × 34 / 132 × 132 × 34 | Rear cover. Split 50 mm off-centre so it bridges the bezel joint. Lap joint with 2× M3. |
| `tab` | 4 | 21 × 10 × 3 | Clamp the glass ends from behind. |
| `key` | 2 | 16 × 6 × 1.8 | Butterfly keys across the bezel split. |
| `hood_left` / `hood_right` | 1 each | 183 × 126 × 63 | Sun hood halves, joined by `hood_splice`. |
| `hood_splice` | 1 | 60 × 36 × 2.5 | Bolts under the canopy across the split. |
| `fit_test` | 1 | 79 × 70 × 16 | One top-left corner of the bezel. **Print this first** and try it in the opening. |

The hood sets: `hood_depth` (60 mm), `hood_tilt` (8°) and `hood_side_front`
(20 mm). The panel can be shifted with `panel_dx`/`panel_dy`; moving it right
gives the left-side cables more room.

## Print settings

- **Material: ASA.** Never PLA, and no PETG either, since this sits on the dash in the sun.
- 0.2 mm layers, 4 walls, 5 top and bottom layers, 25–30% gyroid infill.
- Use an enclosed printer and a 5 mm brim on the long bezel and cover halves.
  ASA warps on long thin parts.
- **No supports needed:**
  - Bezel halves print flange face down; a textured plate gives a nice face.
  - Cover halves print outside face down, with the press posts pointing up.
  - Hood halves print with their mounting pads down.
  - The snap-hook catch faces are 45° on purpose so they print without support.
- Before you scale anything, measure your ASA shrink on the fit test. Then
  tune `fit_clear` and `panel_clear` rather than scaling the model.

## Hardware

- 12× M3 heat-set inserts (4.0 mm hole, ≤4.5 mm long): 4 for the cover corners, 4 for the tabs, 4 for the hood.
- 12× M3 × 8 button-head screws: 4 cover, 4 tabs, 4 hood.
- 6× M3 × 8 + nyloc nuts: 2 for the cover lap, 4 for the hood splice.
- Foam:
  - 0.5 mm EVA or neoprene strip under each tab.
  - 6× 3 mm closed-cell foam pads on the cover's press posts.
- Right-angle cables. The connectors point left and sit about 26 mm from the
  panel end, so straight plugs will not fit:
  - full-size HDMI, 90°
  - USB-C, 90° (touch)
  - USB-C, 90° (power)
- Two zip ties through the bridges inside the cover, beside the cable exit, for strain relief.
- To glue the bezel halves, use ASA/ABS slurry or acetone weld on the tongue and keys, or slow epoxy.

## Assembly order

1. Press the inserts in.
2. Glue the bezel halves with the keys in.
3. Drop the panel in from the back, face first, and fit the 4 tabs with foam.
4. Plug in the cables and zip-tie them to the cover.
5. Screw the cover on. Its posts and foam hold the middle of the panel against the bezel.
6. Push the insert into the dash until the snap hooks click.
7. Screw the hood on (or leave it off).

## Measure on the truck before printing

1. **The opening:** width and height at both ends and in the middle, and the corner radii.
2. **The depth behind the dash face** at the screen position (`insert_depth`).
   Check whether it is a through-hole into the dash cavity or a closed pocket.
3. **How the factory panel is held:** clips, screws or a lip. Also measure the
   skin thickness at the edge where the snap hooks catch (`dash_skin_t`). If
   the opening has a return flange, the hooks will need moving.
4. **The cable path** from the left end of the opening down to the brain box.
5. **Hood clearance** to the windshield, the wheel rim and your sight line.
   Also check whether it shades the top of the picture at your seating position.
6. Print `fit_test` and try it before you print the 6+ hours of bezel halves.
