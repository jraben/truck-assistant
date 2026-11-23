# drivedeck-app.vercel.app: reference notes

Captured 2026-11-22 at 1280×800 with Playwright. The site is the GlassDash marketing page (title "GlassDash: the car display for iPad"). It is a static site with no app screens you can click through. The app UI only appears inside device mockups (images and video). The only interactive control is a Day/Night toggle on the drive section.

## Files
- `00-landing-viewport.png`: hero section, 1280×800
- `01-landing-day-full.png`: whole landing page, Day toggle on
- `02-drive-section-night.png`: "Clear by day. Calm by night." section with Night on (iPad drive screen, dark map)
- `03-support-full.png`: /support page
- `04-privacy-full.png`: /privacy page

## Page structure (landing)
Sticky header (logo + Features / iPhone / Privacy / Support), then:
1. Hero: big headline left, iPad mockup right with a drive screen, blue pill "See it drive" button
2. Drive: Day/Night segmented toggle above a large iPad mockup
3. Features grid: Navigation, Gauges, Performance, Trips and service, Music/video/games (cards, each with a screenshot)
4. iPhone: Road Vision list with icons + two phone mockups
5. Safety/privacy: four short cards
6. App icon + "coming to the App Store" call to action, then footer

## The app screen shown in the mockups (what matters for the TA UI)
- Landscape iPad split into two parts: a **left column ~1/3** with a 3D chase-cam car on the road, and a **right ~2/3** 3D Apple Map.
- Left column top: gear "P D", big centred speed number with "MPH" under it, thin blue RPM bar (with "x1000" scale), heading + battery % top right. A speed-limit roundel (red ring, "30") sits at the right edge.
- Left column bottom: three small tiles (TRIP / GEAR / AVERAGE, small caps label + value), then a now-playing music bar (album art square, title/artist, prev/pause/next).
- Map top-left: dark turn card (arrow, "200 ft", street, then a "Then …" row). Top-right: "My Car" pill with a DEMO badge and clock, and a vertical stack of round map buttons (recentre, car view, +, −).
- Map bottom-left: ETA card ("11:06 pm" white, "25 min" green, distance) with a red "End" pill.
- Bottom dock across the full width: car icon + weather (sun, 79°) on the left, row of rounded-square app icons centred (Maps green, Music red, Video, Browser blue, Games purple, orange timer, red flag, grid), and back / volume / forward on the right.
- Night: dark slate map (#2a3140-ish blues), black dock, white text; Day: light map, white/grey panels.

## Colours (CSS custom properties from the site's :root)
| var | value |
|---|---|
| --bg | #fbfbfd |
| --bg-2 | #f2f3f6 |
| --text | #16171a |
| --text-2 | #55585f |
| --text-3 | #8a8d94 |
| --line | rgb(22 23 26 / 0.09) |
| --accent | #2f6bff |
| --accent-ink | #ffffff |
| --frame (device bezel) | #0d0e10 |
| --shadow | 0 30px 80px -30px rgb(30 45 90 / 0.35) |
| --radius | 22px |

Colours inside the app screenshots, read by eye: ETA green ~#34c759, End/limit red ~#ff3b30, route blue ~#2f6bff/#3478f6, turn-card background very dark translucent navy.

## Fonts
- Body: -apple-system / "SF Pro Text" / Helvetica Neue / system-ui
- Headings: "SF Pro Display"; h1 is 64px, weight 700
- Icons: Phosphor Icons web 2.1.1 (regular/thin/light/bold/fill/duotone) from unpkg

## Assets loaded
- CSS: https://drivedeck-app.vercel.app/styles.css, plus the Phosphor icon stylesheets on unpkg
- JS: https://unpkg.com/@phosphor-icons/web@2.1.1 (no app bundle; the page is static)
