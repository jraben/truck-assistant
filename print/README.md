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

## Likely parts (to confirm against the chosen plan)

| Part | Purpose | Blocked on |
|---|---|---|
| **Dash insert + sun hood for the 12.3" bar (main screen)** | Hold a 301.2 × 123.35 × 12.4 mm panel in a 352 × 133 mm opening; driver board and cable exit behind | Depth behind the panel, panel drawing |
| ESP32-P4 panel shell (optional second screen) | Small gauge/switch screen | Where it goes |
| Brain enclosure | Pi / controller box under the dash, vented | Final board choice |
| Camera brackets ×4 | 360° cams on mirrors, tailgate, front | Camera choice |
| Hitch camera mount | Clips to the 2" receiver | Receiver delivery |
| Switch / relay panel cover | Upfit relays near the Five Switch | Five Switch wiring |
| Cable clips and grommets | Tidy runs behind the dash | Truck delivery |
