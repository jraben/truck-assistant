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
| Dash panel insert for a 12.3" bar screen | Mount a wide screen in a dash opening (13 7/8 × 5 1/4 in, forum-measured) | Depth behind the panel |
| Screen shell for the Slate Tablet Mount | Hold a bare touch panel where a tablet would go | Measuring the mount |
| Brain enclosure | Pi / controller box under the dash, vented | Final board choice |
| Camera brackets ×4 | 360° cams on mirrors, tailgate, front | Camera choice |
| Hitch camera mount | Clips to the 2" receiver | Receiver delivery |
| Switch / relay panel cover | Upfit relays near the Five Switch | Five Switch wiring |
| Cable clips and grommets | Tidy runs behind the dash | Truck delivery |
