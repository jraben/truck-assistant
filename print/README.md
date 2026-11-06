# 3D-printed parts

Parts get listed here once the hardware path is picked. Each one gets a folder
with the source model (STEP or OpenSCAD/CadQuery so it can be edited), an STL,
and its print settings.

## Material rule

- **Cab interior, dash, anything in sun:** ASA. Never PLA, and no PETG on the
  dash either: a forum member's PETG part warped there (Polymaker HTPLA,
  annealed, held up for them; see `docs/forum-findings.md`).
- **Under-dash or in-bed enclosures:** ASA, or PETG out of the sun, with vents.
- **Exterior (camera brackets, hitch cam):** ASA, UV-stable.

## Parts

OpenSCAD sources are parametric; each folder's README lists what to measure first. Render a part with
`openscad -D 'part="<name>"' -o <name>.stl <file>.scad` (a 2025+ build with `--backend Manifold` is much faster).

### Likely parts (to confirm against the chosen plan)

| Part | Purpose | Blocked on |
|---|---|---|
| **Dash insert + sun hood for the 12.3" bar** (alternative: the main screen is now the Galaxy Tab S7 FE in Slate's Tablet Mount): [`dash-bar-insert/`](dash-bar-insert/) | Hold a 301.2 × 123.35 × 12.4 mm panel in a 352 × 133 mm opening; driver board and cable exit behind | Modelled; panel checked against Waveshare's drawing. Needs the opening, depth and retention measured on the truck |
| ESP32-P4 panel shell (optional second screen) | Small gauge/switch screen | Where it goes |
| Brain enclosure: [`brain-enclosure/`](brain-enclosure/) | Pi / controller box under the dash, vented | Modelled for a Pi 4/5 + CarPiHAT + USB SSD; dash rail unmeasured |
| Camera brackets ×4: [`cam-bracket/`](cam-bracket/) | 360° cams on mirrors, tailgate, front | Modelled (universal, VHB or M4, locking tilt); camera choice |
| Hitch camera mount: [`hitch-cam-mount/`](hitch-cam-mount/) | Clamps on the 2" receiver | Modelled; receiver delivery to measure |
| Service kit: [`service-kit/`](service-kit/) | Slide-out brain rail, Carlinkit/hub dock, Deutsch connector service bracket, loom clips | Modelled; dash rail and plug sizes to measure |
| Switch / relay panel cover | Upfit relays near the Five Switch | Five Switch wiring |
| Cable clips and grommets | Tidy runs behind the dash | Truck delivery |
