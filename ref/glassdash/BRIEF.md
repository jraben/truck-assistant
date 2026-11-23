# GlassDash UI: designer's brief (for the Truck Assistant cockpit)

Source: https://drivedeck-app.vercel.app/ (the landing page, plus Privacy and Support pages, which have no screens). The app is "coming soon"; there is no App Store or TestFlight link, and no interactive demo. All screens come from the app's built-in demo drive.
Reference files are kept locally in `docs/media/glassdash/` and are NOT committed (someone else's product images):
- `drive-day-02s.png`, `drive-day-09s.png`, `drive-day-15s.png`: main driving screen, day (stills from drive-day.mp4)
- `drive-night-03s.png`, `drive-night-09s.png`: main driving screen, night (stills from drive-night.mp4)
- `drive-day.mp4` (16 s), `drive-night.mp4` (12 s): the motion itself
- `route-night.webp`: route preview (destination card + Start)
- `gauges-panel.webp`: tach and speedometer + 8 data tiles + fault-code card
- `performance-panel.webp`: 0-60 timer + G-meter
- `trips-panel.webp`: two trip computers, odometer, service reminders
- `music-panel.webp`: full music screen
- `iphone-home.webp`, `iphone-roadvision.webp`: companion phone app (camera hazard detection)

## 1. Main driving screen layout (iPad, landscape 4:3, 1440x1080 in the videos)
- **Two columns plus a bottom dock.** The left "car column" is about **1/3 of the width** (480 of 1440 px). The map takes the right **2/3**, full bleed to the top and right edges. A dock about **80 px** tall runs full width along the bottom (about 7% of the height).
- **Left column, top to bottom:**
  1. Top row: gear letters `P D` on the left, with the current gear bold and the rest dimmed; heading (`▲ SW`), battery % and a fuel icon on the right.
  2. **Speed number**, centred: about 110-120 px tall, a thin rounded sans font in black or white, with a small spaced-caps `MPH` label under it.
  3. A **thin RPM bar** under the speed: a hairline track with a blue fill, a red tick at redline, `2,910 RPM` small caps on the left and `x1000` or `IDLE` on the right. Not a dial.
  4. **3D car** filling the middle (about 45% of the column height). Parked, it is a 3/4 front "showroom" view on a plain backdrop. Driving, it is a **chase camera from behind** on a rendered road with lane lines from map data, and a soft blue "path" carpet ahead of the car.
  5. "MY CAR" or the current street name as a small caption.
  6. **Three equal stat tiles**: TRIP `0.4 mi` · GEAR `D2` · AVERAGE `28 mph`. Each has a small icon and spaced-caps label above a big value.
  7. A **Now Playing strip**: square artwork, title and artist, ⏮ ⏯ ⏭, and a thin progress line along the bottom edge.
- **Right side (map):** Apple Maps 3D with buildings and POIs, the route as a blue line and traffic as red and amber lines.
  - A **turn card** at the top left of the map: a dark navy header with a big arrow, `800 ft` large and the street name, and a lighter "Then ↰ next turn" sub-row.
  - A **status pill** at the top right: profile "My Car", an OBD-connected eye, a `DEMO` badge, GPS and phone-link icons, and the clock.
  - A **vertical control stack** at the right edge: globe/map type, car/recenter, +, −.
  - An **ETA card** at the bottom left of the map: arrival time · `26 min` (green) · distance · a red `End` pill.
  - When not navigating, the turn card becomes a `Navigate` search field. Choosing a place shows a destination card: name, address, big green `26 min`, distance, "via …", and a wide blue **Start** button.
- **Dock:** car icon (home/vehicle) and weather `☀ 79°` on the left. In the centre, **8 app icons in colour squircles**: Navigate, Music, Video, Browser, Games, Gauges/clock, Trip/race flag, and an all-apps grid. Volume ‹ 🔊 › on the right.
- **Landscape only** is shown for the iPad. The phone app is portrait (a list of cards) and landscape for the camera view.

## 2. Visual style
- **Light by day, dark by night**, switched automatically at sunset. The map restyles to match: a light grey city by day, navy and blue by night.
- **Day:** white or very light grey (#F5F5F7-ish) panels and black type. **Night and secondary screens:** near-black background (#141416) with **charcoal cards** (#232326), white type and grey labels.
- **Not heavy glassmorphism, despite the name.** Mostly flat, solid rounded cards with very soft shadows. The floating map cards (turn, ETA, status pill) are solid with slight translucency at most.
- **One accent colour: iOS blue** (#3478F6-ish) for the route, progress fills, the Start button, the active tab and the play button. **Green** = time/ETA and "OK" service bars. **Red** = redline tick, `End`, traffic jams, the speed-limit ring. **Amber** = slow traffic and "Timing" status.
- **Type:** SF Pro-like. Huge, light-weight numerals for the hero value (speed, trip distance, 0-60 time). **Small, letter-spaced ALL-CAPS labels** above every value (TRIP, GEAR, COOLANT, ODOMETER). Values are always much bigger than their labels.
- **Cards:** big radius (about 16-20 px), generous padding, 2-4 per row, uniform heights. Thin horizontal bars inside a card show level (coolant, fuel, service-due).
- **Density:** low. On the drive screen the left column has about 6 pieces of information plus the car, and the map carries the rest.
- **Motion:** the chase camera leans into bends, follows lane changes and shows the turn signal. The road and lane lines scroll smoothly under a fixed car. The RPM bar fills live. Day and night cross-fade.

## 3. Modes and switching
- **Parked (P):** the 3D car is shown 3/4 front like a showroom, speed reads `0`, and the RPM label reads `IDLE`. Video, browser and games are unlocked.
- **Driving (D):** gear shows D1-D3. The car view flips to a rear chase cam on a live road. Video, browsing and games **pause and hide as soon as the car moves**, and come back when it stops. The trigger is speed or gear, not a manual toggle.
- **Night:** automatic **by sunset time**, not by a switch. The whole UI and map go dark together.
- There is no separate "parked dashboard" layout: the same layout re-skins and the car view changes camera.

## 4. 3D car view
- A generic black sedan (the user picks a model per profile, "My Car"), real-time lit.
- Parked: a front 3/4 view with headlights on.
- Driving: a rear view with **brake and tail lights lit red**, plus **turn signals**. It sits on a 3D road built from the map: real lane count and lane markings, curbs and curves, the road surface, the **speed limit shown as a red-ring roundel** (`30`) beside the road, and **traffic lights drawn in the scene** (red/amber/green) when at a signal. It shows **other vehicles** detected by the phone's camera (Road Vision) in 3D around the car.
- A blue translucent "carpet" ahead of the car shows the path.
- No doors, tyre-pressure or warning overlays on the car are shown in the screenshots. The car is about motion and context, not a vehicle-health diagram.

## 5. Gauges, warnings, fault codes (dark "Gauges" app)
- **Two large analogue dials side by side**: tachometer (0-8, with the red zone at 7-8) and speedometer (0-160). Each has a **blue arc** filling from 0 up to the current value, a short **red needle**, a big **digital value in the centre** (`1790 RPM`, `28 MPH`) and a spaced-caps caption below (`ENGINE`, `DEMO`). The digital number dominates and the needle is secondary.
- Below them, a **4x2 grid of tiles**: COOLANT, BATTERY (V), THROTTLE, ENGINE LOAD, INTAKE AIR, FUEL, GEAR, ACCEL (g). Each tile has an icon, a label, a big value and a thin blue level bar.
- **Fault codes:** a wide card, "⚠ Check engine codes", with a quiet "Read codes" action on the right and one plain-English sentence ("Connect an OBD-II adapter to read stored fault codes and switch off the check-engine light"). The codes are read and cleared from here.
- The screenshots show no active-warning state. The only colour cues seen are the red redline arc and needle. On the drive screen the status pill's green "eye" shows OBD/vision is live.
- **Performance app:** a big 0-60 timer (`9.91 seconds`) with an amber "Timing" chip, a progress bar and "starts and stops on its own". A **G-meter**: a circle with a blue dot, an amber dashed peak ring and ACCEL/BRAKE labels, plus tiles for LONGITUDINAL, LATERAL, PEAK and "Reset peak".
- **Trips app:** two trip cards ("This drive", "Trip B": big distance, TIME/AVERAGE/TOP, a Reset pill), an odometer card, and a **service reminders list** (oil, air filter, tyre rotation, brake fluid, transmission fluid, spark plugs). Each row has an icon, a name, "in 6,213 mi", a thin green progress line and a `Done` pill.

## 6. Music and navigation widgets
- **Music on the drive screen:** a single row with artwork, two text lines and three large transport buttons. The thin progress line runs along the bottom edge of the card. There is no browsing while driving.
- **Music full screen (dark):** a split. On the left, big artwork, title and artist, a scrubber with times, and shuffle / ⏮ / a **big blue circular play** / ⏭ / repeat. On the right, `Playlists | Albums` pill tabs over a **3-column grid of big gradient tiles** with name and song count.
- **Navigation:** Apple Maps with live traffic, search, spoken turn-by-turn and rerouting, and Home/Work/recent places one tap away. Guidance uses the top-left turn card (current maneuver large, the next maneuver small "Then …") and the bottom-left ETA card with End. The 3D car pane mirrors the route and lanes at the same time.

## 7. Stated "calm / glanceable" rules
- Tagline: "a **calm, glanceable** dashboard"; "Made to keep your eyes on the road."
- **Locked while you drive:** video, browsing and games pause and hide when the car moves, and come back when it stops.
- One screen holds everything for the drive, so you never navigate away while moving.
- The hero number is huge, labels are tiny and quiet, and there are few items per screen. Touch targets are large (dock icons about 64 px, transport buttons, the wide Start button, pill buttons).
- Automatic everything: night mode by sunset, the 0-60 timer starts and stops itself, the odometer accrues itself, and the phone GPS is picked up automatically.
- Alerts are **chimes from the phone** (collision warning, light turned green, queue moving off), not screen pop-ups. Road Vision is a "driver aid, not a safety system".
- Privacy as a feature: no account, no ads, no analytics, and camera data stays on the device.

## Ideas worth borrowing for Truck Assistant
1. A 1/3 vehicle column with a 2/3 map, plus a fixed bottom dock of big coloured app icons.
2. A huge speed number with a hairline RPM bar under it, instead of dials on the drive screen. Keep the dials for a dedicated Gauges page.
3. A row of three spaced-caps stat tiles (trip / gear / average) and a one-row now-playing strip.
4. Auto day/night by sunset, with the map restyled to match.
5. Hide entertainment when moving, driven by speed or gear.
6. A turn card (big distance, street, "Then …") and an ETA card with a red End pill as floating cards on the map.
7. A data-tile grid with thin level bars; fault codes as one plain-English card with a "Read codes" action.
8. Service reminders as rows with a progress line and a `Done` pill.
