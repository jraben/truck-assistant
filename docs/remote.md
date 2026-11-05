# The truck while you're away

Requested 2026-11-05: status, alerts and camera feeds from the truck when
nobody is in it. The Slate has no modem and the driver's phone leaves with
the driver, so this needs its own small cellular link.

## Two tiers, because of the 12V battery

A Pi draws 3–5 W, about 100 Wh a day. Left on, it flattens a 12V lead-acid
battery in days, and we don't know yet whether the Slate tops its 12V battery
up from the main pack while parked. So:

| Tier | Runs | Power | Link | Does |
|---|---|---|---|---|
| **1. Always-on watch** | ESP32 truck box with an LTE-M/NB-IoT modem (e.g. LilyGO T-SIM7080G, SIM7080G) | well under 0.5 W | Cat-M IoT SIM (e.g. 1NCE prepaid: 500 MB over 10 years, or Hologram pay-as-you-go) | location, cabin temp, 12V voltage, motion/vibration, "truck moved", relay commands, **wake the Pi** |
| **2. On demand** | the Pi, woken by tier 1 | 5–8 W while awake | USB LTE modem (Cat-4, e.g. Quectel EC25/EG25 USB) on a data SIM with real data | live cameras, dashcam clips, the full cockpit remotely, software updates |

Tier 2 sleeps again after 10 minutes with no viewer (settable). The truck box
cuts the Pi's power through the car power board's ignition-sense input.

## How you reach it

- **Alerts** to your phone through Home Assistant's companion app (the
  `wopr_*`/`notify.mobile_app_*` path you already use) or, for owners without
  HA, ntfy.
- **Tier 1 status** goes over MQTT with TLS to the home broker's public
  endpoint (DSM reverse proxy), or to an HA webhook over HTTPS. No inbound
  ports on the truck.
- **Tier 2** joins your Tailscale network, so the cockpit, settings and
  cameras open from your phone exactly as on the dash, with no ports opened
  anywhere. Cameras stream as WebRTC through go2rtc on the Pi (low latency,
  low data), HLS as a fallback.
- **A "Truck" page** for your phone (served by the brain, also embeddable in
  WOPR and HA): map with the truck's last position, battery/12V/cabin temp,
  last seen, alerts, relay buttons, a **Wake & view cameras** button, and
  dashcam clips.

## Alerts (each can be turned off)

- Cabin above a set temperature (pet/kid check), with the temperature.
- 12V below 12.0 V (then relays off, Pi kept asleep).
- Motion or vibration while locked/parked, with a clip if tier 2 is awake.
- Truck moved more than 200 m with no driver phone nearby (theft).
- Left the geofence (home, work) at an unusual hour.
- Charging stopped early / finished / unplugged.
- Tire pressure low.
- Truck box offline for more than 2 hours.

## Cost

Tier 1 hardware ~$45, IoT SIM ~$15 one-off (1NCE) to a few $/month. Tier 2
modem ~$60–90 plus a data plan; watching cameras for 5 minutes is roughly
20–40 MB with WebRTC at 720p.

## Unknowns

- Whether the Slate keeps its 12V battery charged while parked (decides how
  much tier 2 can run). Check at delivery; the truck box logs voltage overnight.
- Cat-M coverage where the truck is parked (T-Mobile/AT&T both carry it in
  Phoenix).
