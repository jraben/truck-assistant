# Name & logo ideas (ideas round, nothing adopted yet)

Today the app is called "Slate Cockpit" / "The Blank Slate". It's a DIY project, not affiliated with
Slate Auto, so the new name shouldn't use "Slate" or anything that could read as an official Slate Auto product.
**Nothing in the app has been renamed.** The manifest and `ui/public/icon.svg` are unchanged until Jeff picks a name.

## Name ideas

| Angle | Name | Why |
|---|---|---|
| Blank slate (without saying "slate") | **Caliche** | Phoenix's chalk-white desert hardpan: chalk = a blank slate, and very local. Hard to pronounce ("ka-LEE-chee") is a fair worry. |
| | **Chalkline** | A blank surface plus a builder's straight line. Practical and DIY-ish. |
| | **Tabula** | From *tabula rasa*, Latin for "blank slate". Clever but cold, and it sounds like software. |
| | **Clean Sheet** | Engineering slang for designing from scratch. Clear, but generic. |
| Pickup | **Tailgate** | Where people gather around a pickup. Friendly; about the parked/hangout side of the app. Common word, lots of sports and event apps already use it. |
| | **Halfton** | Classic pickup class. Sounds solid, but not much personality. |
| | **Hitch** | Short, and works as a verb ("hitch it up"). Heavily used already: trailer gear, dating apps. |
| Dashboard / instruments | **Binnacle** | The hooded housing that holds a ship's compass, and in British use a car's gauge cluster. Exactly what this app is. |
| | **Needle** | Gauge needle. Short and visual, but generic. |
| | **Dashwise** | Plainly "a smart dash". Easy to understand but forgettable. |
| Phoenix / Sonoran desert | **Saguaro** | Iconic Arizona cactus with a great silhouette. Hard to spell; lots of local businesses use it. |
| | **Javelina** | Playful desert critter. Avoid it: AMC's "Javelin" was a car, which is close enough to cause confusion. |
| | **Haboob** | Phoenix dust storm. Funny, but a dust storm isn't something you want on a dash. |
| | **Monsoon** | The summer storm season. Strong word, but already used by a lot of brands. |
| Playful / utilitarian | **Truckbrain** | Literally what the Pi does. Fun, and clearly a hobby project. |

Avoid: **Roadrunner** (Plymouth/Stellantis model name), **Javelin/Javelina** (AMC), and anything with "Slate".
A quick web search found no car-dashboard app called Caliche, Binnacle, Chalkline or Saguaro. Tailgate turned up only
truck tailgate *features*, not a product. This was a quick check, not a trademark search; run a USPTO TESS search before going public.

## Top 3

1. **Caliche** — the only name that covers both the "blank slate" idea and the Phoenix desert without saying "Slate".
   It's unusual, so it's easy to search for and unlikely to be taken in automotive.
2. **Binnacle** — names exactly what the app is (the housing for the truck's instruments). It sounds crafted and nautical-meets-auto.
   It's an obscure word, but people remember an odd word once they've learned it.
3. **Tailgate** — the warmest of the three. It says "pickup" and "hanging out" (parked screen: streaming, games,
   karaoke, camp). Easiest to say, but the hardest to own because it's a common word.

## Logo concepts

All three are flat, use only the app's tokens (`--bg #0d1114`, `--accent #4fc3d9`, `--fg #e8eef2`,
`--warn #f2b33d`, `--panel #151b20`), sit on a rounded dark tile like the current icon, and have no text,
so they stay readable at 48 px.

- `logo-caliche.svg` — a chalk-white mesa under an amber sun, with a cyan baseline.
- `logo-binnacle.svg` — a cyan hood arc over a dial with an amber-tipped compass needle.
- `logo-tailgate.svg` — a generic pickup profile (deliberately not modeled on any real truck) with the amber tailgate dropped open.

**Preview:** open `preview.html` in a desktop browser (from this folder). It shows each mark at 192/96/48/24 px
on the dark dash background and once on a light background. All three were checked at 24 and 48 px.

---

## Truck Assistant: 10 logo ideas, drawn as Jeff's truck

Files: `truck-assistant/logo-01-…svg` to `logo-10-…svg`. Preview: open `truck-assistant/preview.html`. It's self-contained,
and it shows each logo large and at true 48 px and 24 px, on the dark dash and on a light background.
`truck-assistant/preview.png` is a screenshot of it.

**Matched to Jeff's build.** The truck in these logos is the same build the tilt gauge draws (`ui/src/drive/TruckArt.tsx` +
the `Settings.truck` defaults):
- a compact 2-door regular cab with a short bed, an upright raked windshield and a short flat nose
- **Toolbox Red** body (`#b5272d`) with a **Clean Slate** roof (`#e4e5e0`)
- black NEXUS flip-up tonneau on the bed
- square black wheel flares
- black 17" steel wheels with Clean Slate ring decals
- the round amber lamp on the front lamp plate

The rest of the palette is the app's own: `#0d1114` tile, `#4fc3d9` cyan for the "assistant" cues, `#f2b33d` amber.
Each mark sits on its own dark rounded tile, so it reads the same on the dark dash and on the light "day" theme.

**Kept off on purpose:** the SLATE logo decals and any Slate wordmark or badge. These logos show *your* truck, but they
mustn't read as an official Slate Auto product. If you show this publicly, a recognisable silhouette in Toolbox Red is
fine, but don't add Slate's name or logo to it.

| # | Idea | Notes |
|---|---|---|
| 01 | **Pickup**: Jeff's build in profile | The most literal option; it is the truck. |
| 02 | **Monogram**: T and A share a Clean Slate roof bar; the A in Toolbox Red, with an amber crossbar | Works without a truck drawing; looks a bit corporate. |
| 03 | **Gauge**: dash dial with a Toolbox Red needle over a road line | Says "dashboard", but not "truck" or "assistant" on its own. |
| 04 | **Talking truck**: Jeff's build inside a cyan speech bubble | Shows both halves of the name in one shape. |
| 05 | **Badge**: hexagon emblem around the truck | Classic grille-badge feel; the truck gets small at 24 px. |
| 06 | **Glyph**: one Toolbox Red line tracing Jeff's profile, with Clean Slate wheel rings | The most minimal; also the mark in 07. |
| 07 | **Lockup**: glyph plus TRUCK (red) / ASSISTANT (Clean Slate) wordmark | For the splash screen and docs. Use the 06 glyph alone below about 96 px. |
| 07b | **Lockup with the voice truck** (Jeff's pick): the 08 truck, with the cab and the bed turned into a sound wave, next to TRUCK (red) / ASSISTANT (Clean Slate) | `logo-07b-lockup-voice.svg`. For the splash screen, docs and About page. Use 08 on its own as the app icon below about 96 px. |
| 08 | **Voice**: Jeff's cab with the bed turned into a sound wave | Clever, but the bars get thin at 24 px. |
| 09 | **Spark**: Jeff's build with an amber "assistant" sparkle over the bed | Reads as "smart truck". |
| 10 | **Front view**: flat face, round amber lamps on dark plates, Clean Slate roof, typing dots (•••) in the windshield | Has the most character: it's his truck's face, "talking". |

### Top 3

1. **04 Talking truck**: unmistakably his truck *and* clearly an assistant, still readable at 24 px. The red truck on the
   cyan bubble stands out on the dark dash and on the light theme.
2. **10 Front view**: the most personal. The flat face and round amber lamps are this truck's look, and the ••• in the
   windshield makes it feel like it's talking. It would also animate nicely as a "thinking" state.
3. **01 Pickup**: the plainest option, and it is his truck: red body, light roof, tonneau, ringed steel wheels. As an
   app icon it says "my truck's app" with no explanation.
