# Slate Cockpit

A DIY touchscreen dash for the Slate truck, which ships with no screen, no radio
and no modem. The goal is CarPlay (Waze, music), charging and trip info,
Home Assistant, cameras and aux-switch control on one large, clean screen.
Built for Jeff's truck first, published for other Slate owners later.

## Status

- **Prototype UI:** `prototype/index.html`. Open it in any browser; all data is
  simulated. Views: Drive, CarPlay, Control, Truck, Cams, Plan.
- **Hardware (decided 2026-11-05):** one Pi brain under the dash, driving a
  10.1" HDMI touch panel (CarPlay, cameras, browser) and/or a cheap ESP32-P4
  panel (gauges, switches). Android head unit ruled out. Pi 4 vs Pi 5 is
  settled on the bench. Comparison: `docs/options.html`.
  - `docs/plans/plan-pi5.md`: the main-screen half
  - `docs/plans/plan-pi-esp32.md`: the small-screen half
  - `docs/plans/plan-android.md`: not chosen, kept for the record
- **Feature ideas from other EVs:** `docs/ev-features.md`
- **What the Slate forums say** (truck data, speakers, Five Switch, dash
  sizes, backup camera): `docs/forum-findings.md`. Mostly claims from
  prototypes; production deliveries for most reservations look like Q2 2027.

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
