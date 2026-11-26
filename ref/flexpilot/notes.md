# Wolfbox FlexPilot — Kickstarter campaign notes (reference only)

Source: https://www.kickstarter.com/projects/wolfbox/wolfbox-flexpilot-multi-angle-monitoring-with-dash-cam
Read: 2026-11-25 (US evening), headless Chromium (Playwright). Story, Rewards, FAQ and Updates tabs.
Most of the specs on the page are **images, not text**. Figures marked *(image)* were read off the
spec graphics; the screenshots in this folder are those graphics.

Tagline (page subtitle, exact):
> "Custom Views | 1500-Nit Adaptive Display™ | QuadFlex™4-Channel Recording | Dual 4K Front & Rear | Blind-Spot Coverage | Adventure Ready"

Story banner calls it "The World's First Custom-View Dash Cam" *(image)*. The page says the demo
videos were "filmed with our prototype unit" and "The image quality and colors haven't been fully tuned yet."

---

## Funding status (as read)

| | |
|---|---|
| Pledged | **$810,099** of a **$10,000** goal |
| Backers | **1,263** |
| Time left | 35 days |
| Deadline | "Thu, December 31 2026 8:59 AM MST" (all or nothing) |
| Launched | November 17, 2026 (Update #2) |
| Creator | Wolfbox, Highlands Ranch, CO; "Founded in 2019 in Colorado, USA" |
| Badges | "Project We Love", category Gadgets |
| Estimated delivery | **Mar 2027** on every tier. The timeline graphic says "Feb 2027 Mass Production" and "Spring 2027 Shipping" *(image)* |
| Warranty | "18-Month Hassle-Free Warranty" (12-month manufacturer + 6-month extended) |

Timeline *(image, not saved here)*: Jun 2025 Concept & Research → Jan 2026 Working Prototype →
Mar 2026 Engineering Prototype Test → Jun 2026 Design Validation Test → Aug 2026 Production Validation
Test → Nov 2026 Kickstarter Launch → Feb 2027 Mass Production → Spring 2027 Shipping.

## Mirror display

From the "Specs" table *(image → `specs-main-unit.png`)*:

| Spec | Value |
|---|---|
| Screen size | **12"** |
| Control | **Touchscreen** |
| Brightness | **1500 nits** ("1500-Nit Adaptive Display™") |
| Auto brightness | "Light sensor auto-adjustment" |
| Operating temperature | −4°F ~ 158°F |
| Installation method | "OEM Bracket / Long Strap / Center Console Base Bracket" |

- Mounting: rubber straps over the existing mirror ("Mounting Straps", "Rubber Straps x 4" in the box),
  or the OEM-style bracket. Story *(image)*: "OEM-Integrated Bracket + Reinforced Backplate Built to
  integrate seamlessly with your vehicle's original mounting points". The bracket is a **$29 add-on**:
  "A universal mounting bracket with a base adapter, compatible with most vehicle models."
  A "Center Console Base Bracket" is listed in the spec table but not shown anywhere else on the page.
- Voice control: "Touchscreen control and voice commands". Example commands shown *(image)*:
  "Take picture", "Turn on Wi-Fi", "Turn on screen".
- **Not stated:** the panel's pixel resolution, aspect ratio, panel type (IPS/LCD), whether the mirror
  works as an optical mirror when the screen is off, or touch type (capacitive/resistive).

## What it runs

- Spec table: Processor "**Ambarella**", DDR "LPDDR5 32GB", Flash "NAND Flash 2Gb" *(image)*.
  (Ambarella is a dash-cam video SoC, which points to closed firmware, but that is my inference, not the page's.)
- After-sales graphic lists "**Free Firmware Updates**" *(image)*.
- **Not stated:** the operating system. The page never says Android, never mentions an app store,
  Google Play, CarPlay or Android Auto, and never says third-party apps can be installed.

## Camera modules

From the camera spec tables *(image → `specs-cameras.png`)* plus the add-on descriptions (text):

| | 4K Front | 4K Flex | 1080P Exterior | 1080P Side | 1080P Cabin |
|---|---|---|---|---|---|
| Resolution | 8MP | 8MP | 2MP | 2MP | 2MP |
| Sensor | Sony IMX678 (STARVIS 2), 1/1.8" | Sony IMX678, 1/1.8" | 1/2.9" | 1/2.9" | 1/3.05" |
| FOV | 129.8° | 129.8° | 124° | 155° | 117° |
| Aperture | F1.8 | F1.8 | F2.0 | F2.0 | F2.0 |
| HDR | yes | yes | yes | yes | no |
| IR night vision | no | no | no | no | **yes** |
| Video interface | **LVDS** | **LVDS** | **AHD** | **AHD** | **AHD** |
| Waterproof | none | **IP67** | **IP67** | **IP67** | none |
| Cable (add-on text) | "built-in 0.35m cable" | "a 9.5m extension cable" | "a built-in 3m cable" | "a built-in 3m cable" | "a built-in 0.5m cable" |
| Add-on price | $69 (MSRP $99) | $69 (MSRP $99) | $39 (MSRP $49) | $39 (MSRP $49) | $39 (MSRP $49) |

- The Flex Cam is the camera in **every** pack. It is the rear camera by default ("The 4K Flex Cam helps
  eliminate rear-view blind spots") but is meant to be mounted anywhere outside (fender, bumper, rear).
- Exterior cams in the Trail Vision Pack come with "1080P Exterior Cam Cable x 2" (extension cables);
  their length is not given.
- Side cams: "Designed for Side Installation ... with sleek flat cable design" *(image)*.
- The 1080P cameras plug into a "3-in-1 Hub Cable Management Box" (in the 4-camera packs).
- Mounting: the camera diagram *(image)* numbers 9 positions (roof/rear, front fender, side, bumper,
  cabin, underbody...). Fixings shown are adhesive pad, rubber straps and cable clips. No bracket
  hardware for the exterior cams is described.
- **Not stated:** connector type/pinout on any camera cable (only "LVDS"/"AHD" as the signal type),
  cable length for the 4K Front other than 0.35m, whether the front cam sits on the windshield or the
  mirror body, mirror-image/guideline settings for the rear view, or low-light lux figures.
- CPL filters: Front Camera CPL Filter $25, Flex Cam CPL Filter $25 ("Also compatible with the 1080P Exterior Cam").

## How many cameras show at once, and layouts

- "4-channel" recording and display. "Mix and match up to 2×4K and 2×1080P cameras" — i.e. the two LVDS
  4K inputs (Front + Flex) plus two AHD 1080P inputs (via the hub). "Up to 5 Camera Types" to choose from.
  Recording resolution (spec table): "4K25fps + 1080P25fps + 1080P25fps + 4K25fps".
- Layout picker UI *(image → `layout-picker.png`)*: tabs **Dual / Three / Four**; sources named
  **Front, Extra 1, Extra 2, Rear**; you tap "Screen 1 >", "Screen 2 >" ... and assign a source, then "Confirm".
  Shown four-up layout is one big pane on the left plus three smaller panes.
- "Instead of a fixed layout, you get full control over how every camera view is arranged on screen."
- Overview tile mentions "Clean View" *(image)*; not explained further.

## Triggers

- **Reverse:** not mentioned anywhere on the page.
- **Turn signals:** not mentioned. Nothing says it wires to the turn-signal circuits or switches view on
  a blinker. The side-camera pitch relies on "**ADAS/BSD alerts** for safer lane changes" instead.
- Other: spec table lists "Driver Assistance: ADAS + BSD", "Fatigue Driving Alert: Supported",
  "G-sensor: Auto-lock on collision detection". No trigger inputs or wire leads are described.

## Recording and storage

- 4 channels simultaneously, 25fps each (above).
- Storage: "Max Capacity: Up to 1TB" (microSD). **No card is included** in any tier; cards are add-ons:
  256GB $123 ("approximately 3.5 hours of storage for simultaneous 4-camera recording"),
  512GB $189 ("approximately 6.8 hours"), both "Industrial-grade ... Class 10 U3".
- Parking mode: "Time-lapse recording + G-sensor trigger"; story: "Parking protection keeps an eye on
  your car 24/7" with a "24 Hours" graphic. The hardwire kits say "Enables Parking Mode when connected".
- Power storage: "Super Capacitor" (no battery).
- GPS module included in every pack ("GPS Player: Supported").

## App, Wi-Fi and outputs

- Wi-Fi: "2.4GHz & 5.8GHz Wi-Fi 6", "Max Wi-Fi Speed 60 MB/s". "WIFI/APP Control: Supported".
- Story: "Open the app. Preview instantly. Download fast. No removing SD cards." Shown sharing clips from a phone.
- **Not stated:** the app's name, platforms, live view over the app (only "Preview"), any video output,
  HDMI, RTSP/network stream, API, SDK, or third-party integration. None of those words appear.

## Power

- Main unit "Power Port: **Type-C**".
- In the box: "Power Supply Cable with in-car Charger" (cigarette-lighter plug).
- Hardwire is an add-on ($29 each, MSRP $39):
  - "6A ACC Hardwire Kit": "5V/6A output with ACC power connection, 12–24V wide voltage input,
    overvoltage and overcurrent protection. Includes a 3.5m cable, digital display, and 3-level
    low-voltage protection adjustment."
  - "6A OBD Hardwire Kit": same, but OBD connection.
- **Not stated:** fuse-tap / add-a-fuse pieces in the ACC kit, current draw, or a direct 12/24V input on the unit.

## Reward tiers (all "Ships to Anywhere in the world", "Estimated delivery Mar 2027")

| Tier | Price | MSRP | Backers | Remaining | Contents (besides the common kit) |
|---|---|---|---|---|---|
| Early Bird – DIY Basic Pack | **$479** | $737 | 10 | 190 left of 200 | Flex Camera, GPS Adapter Cable (no front cam) |
| Early Bird – Essential Pack | **$509** | $783 | 34 | 166 left of 200 | Front Camera, Flex Camera |
| Early Bird – Trail Vision Pack | **$569** | $875 | 313 | 187 left of 500 | Front, Flex, Exterior Camera ×2, 3-in-1 Hub |
| Early Bird – Side Vision Pack | **$569** | $875 | 300 | 200 left of 500 | Front, Flex, Side Camera ×2, 3-in-1 Hub |
| KS Special – DIY Basic Pack | **$519** | $737 | 3 | 997 left of 1000 | as DIY Basic |
| KS Special – Essential Pack | **$549** | $783 | 4 | 996 left of 1000 | as Essential |
| KS Special – Trail Vision Pack | **$599** | $875 | 17 | 1983 left of 2000 | as Trail Vision |
| KS Special – Side Vision Pack | **$599** | $875 | 31 | 469 left of 500 | as Side Vision |

Common kit in every tier: Dash Cam Main Unit, GPS Module, Car Charger, Cable Clips (×5 in the graphic),
Mounting Straps (rubber straps ×4), Front Camera CPL Adapter Slider, Tool, Adhesive Pad, User Manual.
The "Included in Every Pack" graphic *(image → `whats-in-the-box.png`)* also shows the 4K Flex Camera as common.

Each tier lists: "Free Shipping to the US, UK, CA, AU, HK, JP, SG & KR", "Customs Duties Covered",
"18-Month Hassle-Free Warranty". Shipping graphic: $20 flat to EU & New Zealand, $35 other countries.

Add-ons: extra packs (DIY Basic +$459, Essential +$489, Trail Vision +$549, Side Vision +$549),
cameras, bracket, hardwire kits, CPL filters and SD cards as priced above.

## FAQ and updates

- FAQ tab: "The creator hasn't listed any questions".
- Update #1 (Nov 15, 2026): pre-launch $10 deposit perk. Update #2 (Nov 17, 2026): launch + 72-hour giveaway.
  Neither adds technical detail.
- Comments: 231 (not read).
- Page discloses AI use "only to assist with some visual materials ... such as backgrounds and presentation scenes."

## What the page does NOT say (plainly)

- Screen pixel resolution / aspect ratio / panel type.
- Operating system; whether it is Android; whether apps can be installed. No CarPlay/Android Auto.
- Any reverse-gear trigger, turn-signal trigger, or trigger wires at all.
- Any video output, HDMI, RTSP stream, API/SDK, or third-party integration.
- Camera connector types, and cable lengths for the exterior-cam extension cables.
- Whether the mirror is still a reflective mirror with the screen off.
- Fuse-box kit contents; power draw; native 12/24V input on the main unit (it's USB-C, fed by a 5V/6A kit).
- Exact ship date beyond "Mar 2027" / "Spring 2027".

## Screenshots in this folder

- `specs-main-unit.png` — Chipset & Recording / Display / Connectivity / Features table.
- `specs-cameras.png` — Front, Flex, Exterior, Side, Cabin camera table.
- `whats-in-the-box.png` — "Included in Every Pack" and pack-specific accessories.
- `layout-picker.png` — Dual/Three/Four layout picker UI.
