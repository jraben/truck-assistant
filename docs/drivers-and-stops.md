# Drivers, stops and phone-history trips

Design for the next build step. Requested 2026-11-05: "use GPS to add my
stops/trips", "add a profile, so you can choose the driver and their settings",
and replay Jeff's own phone history from Home Assistant.

## Driver profiles

Settings split into **truck** settings (one set, whoever drives) and **driver**
settings (one set per person).

| Truck (global) | Driver (per profile) |
|---|---|
| pack kWh, efficiency model | name, initials, color |
| relay names, truck box | theme (incl. auto day/night pair), layout |
| home rate, gas price source | charging prefs (networks, min kW, amenities, arrive SoC) |
| API keys, HA connection | phone tracker (HA `device_tracker.*`) |
| saved places | favourite places, media prefs (later) |

- **Choosing the driver:** a driver picker on the Drive view, big tap targets.
  On ignition, the cockpit suggests a driver:
  1. the person whose phone tracker (HA) is within ~150 m of the truck and was
     there in the last 10 minutes; if exactly one, preselect it;
  2. otherwise the last driver.
  It never switches mid-trip. A **Guest** profile always exists and keeps no
  history beyond the trip itself.
- Trips, stops and charge sessions record `driverId`. Summaries can filter by
  driver.
- Profiles are edited on the `/settings` portal; each driver can be given a
  PIN-less "this is me" link to edit only their own profile from their phone.

## Stops

A **stop** is anywhere the truck (or, for phone history, the phone) stays put.

- **Detection:** ignition off, or speed < 2 mph within a 75 m radius for ≥ 3
  minutes. A stop ends when the vehicle leaves the radius. Stops under 3
  minutes (traffic, drive-thru) are folded into the trip.
- **Naming**, first match wins, within each place's radius (default 120 m):
  1. saved places (named by the driver);
  2. Home Assistant zones (`zone.*`: home, work, etc.);
  3. a places feed: any URL returning `[{name, lat, lon, radiusM?}]` (optional
     Basic auth), e.g. WOPR's client/property records, so a job site shows the
     client's name;
  4. reverse geocode (OpenStreetMap Nominatim, 1 request/second max, cached
     forever, only when online);
  5. "Unnamed stop", tap to name.
- Naming an unnamed stop saves a place; the next visit inside its radius gets
  the name. A spot visited 3+ times with no name is suggested on the Trips view.
- A trip becomes **stop → stop**: "Home → Costco · 12.4 mi · 24 min".

## Replaying phone history (real data before the truck exists)

- The brain reads HA's recorder history for a driver's phone tracker:
  `GET /api/history/period/<start>?filter_entity_id=<tracker>&end_time=<end>`
  (full attributes: latitude, longitude, gps_accuracy, speed, course).
- Points with `gps_accuracy` worse than 100 m are dropped.
- The same trip and stop detection runs over them. Results are stored with
  `source: 'phone'` so they never mix up with truck GPS. Energy and SoC are
  left null for phone trips.
- iPhone companion-app locations are sparse (significant-change updates plus
  zone events), so phone routes are coarse: good for stops and trip counts,
  rough for route shape and distance (straight lines between points, labelled
  as such).
- Triggered from `/settings` ("Import from phone": tracker, date range, default
  last 30 days) and repeatable; re-running replaces that tracker's phone trips
  for the range.

## Brain access to Home Assistant

The brain gets an HA URL and a long-lived token on the settings page (stored
with the other keys, never in files). Used for: tracker history, zones, the
gas-price sensors, the home charger kWh, and driver presence. Over the LAN at
home or Tailscale away; the truck works fine without it.
