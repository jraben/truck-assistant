# Drive screen v2, media, weather, city/highway

Requested 2026-11-05. Builds on driver profiles and stops (docs/drivers-and-stops.md).

## 1. Drive screen, redone

The bar is 1920x720 and seen in glances. Rules:
- **Three zones, fixed:** left = speed (the speedometer style), centre = battery
  and range (with city/highway), right = a stack of 2–3 small cards that
  rotate by context: next turn / now playing / trip since charge / tilt.
- **One number dominates each zone.** Labels are small caps, units muted.
- **No boxes inside boxes.** Zones separated by space and a hairline, not by
  cards with borders; the background carries a very subtle vignette.
- Gear (P R N D) becomes a single quiet strip under the speed, current gear lit.
- Everything at least 60 px tall to touch; secondary text never under 16 px.
- Night themes dim everything except speed and warnings.

## 2. Tilt with my truck

A side view (pitch) and a rear view (roll) of **Jeff's truck as configured**,
drawn as clean flat SVG and rotated live:
- The Blank Slate: compact 2-door regular cab, short bed, flat body panels,
  17" steel wheels.
- **Toolbox Red** satin full wrap, **Clean Slate** satin roof (partial wrap),
  **Tar Pit** satin Slate logo decals, **Clean Slate** satin 17" wheel decals,
  **Synthwave** front lamp plates, NEXUS flip-up hard tonneau, 2" rear hitch
  receiver, bed light kit.
- Colours come from a `truck` block in the driver-independent settings, so
  other owners can match their own build (colour pickers + accessory toggles).
- Warn amber at 20°, red at 30° (both settable). Shows degrees and a level
  line.

## 3. Trip: since last charge

Beside the current trip, a "since charge" block: miles, kWh used (estimate
until CAN), average mi/kWh, % used, and cost of that charge per mile. Resets
when a charge session ends.

## 4 & 8. Weather

- **Top strip next to the clock:** current place name (from stops naming, else
  the nearest town), temperature, condition icon, high/low, and wind. One
  line, glanceable.
- **Drive screen:** outside temperature as a small line in the battery zone,
  since heat and cold change range.
- **Source:** National Weather Service API (`api.weather.gov`, free, no key,
  US only; needs a User-Agent with an app name, no personal email): `points/{lat},{lon}`
  → forecast + nearest observation station. Fallback: Open-Meteo (free, no
  key, worldwide). Refresh every 15 min when online, or after moving 10 km;
  cache the last reading and show its age when offline.
- Weather alerts (excessive heat, dust storm, flash flood) as a banner,
  from NWS `alerts/active?point=`.
- Truck box cabin temp stays separate (inside vs outside).
- **Tapping the weather strip (or the Drive temperature) opens a Weather
  view:** a full-width map centred on the truck with animated radar (RainViewer
  public radar tiles, free, last ~2 hours plus a short nowcast) over a dark or
  light base map matching the theme (OpenStreetMap-based tiles, attribution
  shown), the truck's position and heading, active NWS alert polygons drawn on
  the map, and a side panel with the hourly forecast (next 12 h), sunrise and
  sunset, and wind. Play/pause and a time scrubber for the radar loop. Big
  close button back to Drive. Online only; offline it says so and shows the
  last cached forecast. MapLibre GL or Leaflet, whichever is lighter on a Pi.

## 5. Speedometer styles

A setting per driver; each is a component fed the same speed/limit data:
- **Digital** (current, cleaned up).
- **Sweep**: modern analog arc with a needle and a lit trail.
- **'57**: a 1950s-style horizontal fan speedometer, chrome bezel, cream
  face, red needle sweeping across a wide arc, period numerals. Original art
  in that style, not a copy of any maker's gauge.
- **Ribbon**: a horizontal tape that scrolls behind a fixed pointer.
- **Minimal**: speed only, huge.
Same choice also offered as a theme pairing (e.g. a "Bel Air" theme sets cream
and chrome colours and the '57 speedometer).

## 6. City / highway range

- Efficiency is learned separately for **city** and **highway** driving. A
  segment counts as highway when the rolling 2-minute average speed is
  ≥ 45 mph, otherwise city (threshold settable).
- Each mode keeps its own mi/kWh (exponentially weighted over recent driving,
  seeded from Settings defaults: city 4.0, highway 3.2, to be corrected from
  real trips).
- The Drive screen shows **range in the current mode** large, the other mode
  small, plus a manual override toggle (Auto / City / Highway).
- Trips record miles and kWh per mode; the Trips view shows the split.
- Without CAN, kWh per segment is estimated; the learned numbers are only
  as good as the SoC readings. Labelled that way.

## 7. Media

A **MEDIA** button in the rail opens one screen with source tabs:
| Source | How | Notes |
|---|---|---|
| **CarPlay** | already embedded | Apple Music, Spotify, podcasts on the phone |
| **Spotify** | Spotify Connect on the Pi (librespot/raspotify) so the truck is a speaker; Spotify Web API for browse/now playing/controls | each owner registers a free Spotify developer app (dev apps capped at 5 users) |
| **Apple Music** | through CarPlay only | MusicKit on the web needs a paid Apple developer token; not built |
| **Radio (internet)** | Radio Browser API (free, no key) for stations; favourites; Jeff's own KJEF station preset | streams need data |
| **Radio (AM/FM)** | optional RTL-SDR USB dongle (~$30) + rtl_fm on the Pi | real over-the-air radio with no data; FM first |
| **Plex / Plexamp** | Plex API with a token entered on settings | his own library over Tailscale |
| **Local / USB** | files on the Pi's SSD | offline |

Now playing from whichever source is active feeds the Drive screen card, the
CarPlay strip and HA.
