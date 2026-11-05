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
- ✓ MEDIA screen: CarPlay, Spotify Connect + Web API, internet radio (KJEF
  preset), AM/FM via RTL-SDR, Plex, local files (desk-tested in SIM; Spotify,
  Plex and the tuner untested on real hardware/accounts)
- ✓ WOPR voice button (Groq STT → `/api/WOPR` → Cartesia TTS), tested against a mock WOPR
- ✓ Next calendar appointment → one tap to Waze (via WOPR)
- ✓ Gate code on arrival (WOPR `/api/where`)
- ✓ Public charging costs from receipt emails: parser, drafts, one-tap
  confirm; automatic import waits on a WOPR mail-search route (contract, Track B)

## Track C: Cameras and remote ([remote](remote.md))
- Camera pipeline: go2rtc on the Pi, USB capture / UVC / AHD, Cams view live,
  auto rear view on reverse, 360° kit
- Dashcam loop recording, save-clip button, parked motion clips
- Tier 1 always-on watch (ESP32 + LTE-M), tier 2 on-demand Pi over LTE
- Alerts to the phone; Truck page (map, status, relays, wake & view cams)
- Theft: moved-without-driver alert; AirTag as a cheap backup

## Track D: Logs, ops, publishing
- Business mileage log: trips tagged business/personal (auto from client
  stops), IRS-style export (date, purpose, from/to, miles, odometer)
- Maintenance log and reminders; TPMS history
- Software updates from GitHub with one-step rollback; nightly backup to the NAS
- Security: settings/AP password, limited HA user + Tailscale ACL guidance,
  secrets stay on the truck
- First-boot setup wizard; flashable Pi image
- License (MIT), "not affiliated with Slate Auto" note, **public name TBD**
- Hardware parts list (BOM) with links: USB mic, light sensor, GPS, USB Wi-Fi,
  RTL-SDR, capture stick, LTE modems, amp if needed
- ESP32-P4 second screen firmware

## Waiting on the truck (Q2 2027 delivery window)
- CAN/OBD data (SoC, real gear, energy), Five Switch wiring, speaker input,
  dash depth, Tablet Mount, 12V behaviour when parked, reverse/ignition wires
