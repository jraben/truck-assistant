# Roadmap

Everything asked for so far, grouped into build tracks. "Add all now, can
remove later" (Jeff, 2026-11-05). Design docs are linked; a ✓ means built.

## Done
- ✓ Prototype, three hardware plans, comparison, forum findings
- ✓ Brain + cockpit UI, charging finder, charge-cost tracking, 8 themes + editor
- ✓ ESP32 truck box firmware (compiles), printable parts (render)
- ✓ CarPlay embed (simulator verified; dongle untested)

## In progress
- Driver profiles, stops, phone-history import, gas via GasBuddy + EPA
  comparison vehicle, per-driver hotspot ([drivers-and-stops](drivers-and-stops.md), [connectivity](connectivity.md))

## Track A: Drive and the road ([drive-v2](drive-v2.md))
- Drive screen redesign; '57, sweep, ribbon, minimal, digital speedometers
- Tilt with Jeff's truck as configured
- Trip since last charge
- Weather strip, outside temp, weather map with radar
- City / highway range, learned and tracked
- Speed limit (OpenStreetMap `maxspeed`) on the speedometer, optional warning
- Driving lockouts: no video/browser/long lists while moving, bigger targets at speed
- Auto brightness (light sensor on the truck box), night dim
- Heat: screen and Pi temperature shutdown, parked-in-sun warning

## Track B: Media and WOPR ([drive-v2](drive-v2.md) §7)
- MEDIA screen: CarPlay, Spotify Connect + Web API, internet radio (KJEF
  preset), AM/FM via RTL-SDR, Plex, local files
- WOPR voice button (Groq STT → `/api/WOPR` → Cartesia TTS)
- Next calendar appointment → one tap to Waze (via WOPR)
- Gate code on arrival (WOPR `/api/where`)
- Public charging costs from receipt emails (via WOPR's Outlook)

## Track C: Cameras and remote ([remote](remote.md))
- Camera pipeline: go2rtc on the Pi, USB capture / UVC / AHD, Cams view live,
  auto rear view on reverse, 360° kit
- Dashcam loop recording, save-clip button, parked motion clips
- Tier 1 always-on watch (ESP32 + LTE-M), tier 2 on-demand Pi over LTE
- Alerts to the phone; Truck page (map, status, relays, wake & view cams)
- Theft: moved-without-driver alert; AirTag as a cheap backup

## Track D: Logs, ops, publishing (built 2026-11-05; contract: "Track D" in [contract](contract.md))
- ✓ Business mileage log: trips tagged business/personal/commute/other (auto from
  client stops, tagged places, per-driver default; bulk tagging), IRS-style export
  (CSV + printable), estimated odometer from an anchor, IRS rate per year
- ✓ Maintenance log (receipt photos) and reminders (intervals from the owner's
  manual, not guessed); TPMS history; due card on Drive; HA sensor + notify
- ✓ Software updates from GitHub with one-step rollback and automatic rollback
  on a failed health check; nightly backup to the NAS (SMB mount, rsync/SSH, HTTP)
- ✓ Security: settings/truck password, AP password at first boot,
  [security](security.md) (limited HA user, Tailscale ACL, stolen-truck checklist)
- ✓ First-boot setup wizard; flashable Pi image (pi-gen, `deploy/image/`, not yet built)
- ✓ License (MIT), "not affiliated with Slate Auto" note, CONTRIBUTING; **public name TBD**
  (one constant: `brain/src/project.ts`)
- ✓ Hardware parts list: [bom](bom.md)
- ✓ ESP32-P4 second screen firmware (`firmware/p4-screen/`, compiles; no board yet)

## Waiting on the truck (Q2 2027 delivery window)
- CAN/OBD data (SoC, real gear, energy), Five Switch wiring, speaker input,
  dash depth, Tablet Mount, 12V behaviour when parked, reverse/ignition wires
