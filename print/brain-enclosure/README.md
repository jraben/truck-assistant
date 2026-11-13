# Brain enclosure

A vented box for a Raspberry Pi 4 or 5 with a CarPiHAT-style car power HAT on
top. A bay beside the Pi takes a USB SSD; it is sized for a Samsung T7, or use
an M.2-in-USB caddy. Mounting ears with slots go to the lower dash rail.
Source: `brain-enclosure.scad`. STLs and previews: `stl/` (`lid.png` is the lid from above, as fitted).

## Parts (print orientation)

| STL | Size (mm) | Notes |
|---|---|---|
| `box` | 130 × 139 × 50 (93 × 126 body, plus ears and lugs) | Floor down. |
| `lid` | 103 × 139 × 5.5 | Top face down, lip up. Mount for a 40 mm fan over the Pi. The Truck Assistant glyph and name are engraved 0.6 mm into the top face (`logo = false` in the `.scad` leaves it plain). |
| `logo_red` | 0.6 mm thick | The truck's profile line: fills its part of the lid's engraving. |
| `logo_white` | 0.6 mm thick | The wheel rings, the roof line and TRUCK ASSISTANT. |

### The logo in colour

The two logo parts fill the engraving exactly, flush with the top face (checked:
no gap and no overlap). They share the lid's origin, so they line up by
themselves:

- **Multi-colour printer (AMS, MMU, toolchanger):** load `lid.stl`, then add
  `logo_red.stl` and `logo_white.stl` *as parts of the same object* (Bambu and
  Orca: right-click the lid, Add part, Load; Prusa: Add part). Answer "no" if it
  asks to treat them as separate objects. Filaments, from the brand colours:
  lid in **Tar Pit** black (#1c1d1f), `logo_red` in **Toolbox Red** (#b5272d),
  `logo_white` in **Clean Slate** off-white (#e4e5e0). Use ASA in all three for
  a hot cab. The logo is the first 3 layers, so colour swaps happen only there.
- **One colour only:** print the lid alone. The logo reads as an engraving. For
  colour, fill the recess with acrylic paint or a paint pen and wipe the face
  clean before it dries.

`stl/lid.png` shows the lid from above as fitted, in those colours.

The openings:
- **+X end:** a window for the USB-A ports and Ethernet.
- **−Y side:** a window for USB-C and both micro-HDMI ports (HDMI to the dash screen).
- **−X end:** a microSD slot, plus 2× 12.5 mm gland holes (PG7) for 12 V and CAN.
- **+Y side:** one spare gland.

Vents are in the floor under the Pi and the SSD, high on both long sides, and in the lid.

## Print settings

- **ASA.** PETG is acceptable only if the box is truly out of the sun. A
  parked Phoenix cab gets close to PETG's ~80 °C softening point.
- 0.2 mm layers, 4 walls, 25% infill.
- No supports. The ear gussets carry the flanges, and the glands are round holes in vertical walls.

## Hardware

- 4× M2.5 heat-set inserts (3.6 mm hole) in the Pi standoffs.
  - M2.5 male-female standoffs, sized to your HAT's required height, run from the Pi up to the HAT.
  - Use M2.5 × 6 screws on top.
- 4× M3 heat-set inserts (4.0 mm hole) in the corner lugs, plus 4× M3 × 8 lid screws.
- 3× PG7 cable glands (12.5 mm hole): 12 V in, CAN, spare. M12 glands also fit at 12.2–12.5 mm.
- Optional 40 × 40 × 10 mm fan (5 V from the Pi header), with 4× M3 × 16 or the fan's own screws.
- 1× 20 mm velcro strap through the floor slots, over the SSD.
- Ear bolts to suit the rail: the slots take 1/4-20 or M6 (`ear_slot_d`) and allow ±4 mm of adjustment.

## Measure before printing

1. **The assembled stack height** (`stack_h`, assumed 38 mm): from the Pi's
   underside to the top of the tallest part of the HAT. That includes the
   cooler and the screw terminals.
2. **The CarPiHAT's terminal positions** for 12 V and CAN. Move
   `glands_x_end` and `glands_y_side` so the wires reach without a sharp bend.
3. **The SSD** you actually use (`ssd_l`, `ssd_w`, `ssd_t`).
4. **The lower dash rail** (unmeasured: profile, slot width, bolt or T-nut
   size), and where on it the box can hang. The ears are generic slotted
   flanges until the rail is known. Set `ear_hole_pitch` and `ear_slot_d` then.
5. **The space under the dash** for a 130 × 139 × 50 mm box, with room for
   the cables at both ends and for air to reach the vents.
