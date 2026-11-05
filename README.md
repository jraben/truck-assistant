# Slate Cockpit

A DIY touchscreen dash for the Slate truck, which ships with no screen, no radio
and no modem. The goal is CarPlay (Waze, music), charging and trip info,
Home Assistant, cameras and aux-switch control on one large, clean screen.
Built for Jeff's truck first, published for other Slate owners later.

## Status

- **Prototype UI:** `prototype/index.html`. Open it in any browser; all data is
  simulated. Views: Drive, CarPlay, Control, Truck, Cams, Plan.
- **Hardware:** not chosen yet. Three paths are being planned independently,
  then compared:
  - `docs/plans/plan-pi5.md`: Raspberry Pi 5 + Carlinkit + 10" touchscreen
  - `docs/plans/plan-android.md`: Android screen + Carlinkit (in progress)
  - `docs/plans/plan-pi-esp32.md`: Pi brain + ESP32 touch display (in progress)
- **Feature ideas from other EVs:** `docs/ev-features.md`

## Wants

1. Charge info and where to charge, ranked by my preferences
2. Waze for navigation
3. Media dashboard
4. Super clean look, customizable
5. Inexpensive yet reliable (Phoenix cab heat)
6. Cameras, ideally a 360° view
7. Web browser
8. Web portal to manage settings, streaming services and accounts
9. Home Assistant integration
10. Route and trip tracking

## Slate accessories to integrate

Five Switch (Upgrade), Bed Light Kit, front L/R and center integrated speakers,
Hands Free Bluetooth Controller, Tablet Mount, Classic Level 2 Wall Charger,
2" hitch receiver, tailgate lock, NEXUS tonneau.

## Layout

| Folder | What |
|---|---|
| `prototype/` | The web UI prototype |
| `docs/` | Plans, research, decisions |
| `print/` | 3D-printed parts: models, print settings |
| `hardware/` | Wiring, parts lists, pinouts (once a path is picked) |

## 3D printing

Anything that mounts in the cab gets printed in **ASA or PETG-CF**, not PLA.
A parked Phoenix dash gets hot enough to warp PLA in an afternoon. See
`print/README.md`.
