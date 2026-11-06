# Cameras for the Slate: what to buy, where it goes, how it's powered

Research of 2026-11-05 for Track C (`docs/remote.md` § Cameras, `docs/bom.md`
§ 5). The pipeline is unchanged: every camera ends up as a V4L2 device on the
Pi, go2rtc reads it, the brain records and serves it.

**How sure is each figure?**
- **Verified**: read on a maker, datasheet or retailer page on 2026-11-05, linked in Sources.
- **Listing**: a marketplace listing's claim. Cheap cameras and kits are rebadged constantly, so a listing describes one batch, not a product line.
- **Unverified**: an estimate, or a figure Amazon wouldn't show (Amazon answered 503 to every fetch today). Prices marked "~" are street estimates. Check the live listing before buying.

---

## The short version

1. **Outside the truck, use AHD cameras, not USB webcams.** Automotive AHD
   cameras are sealed (IP68/IP69K), run on 12 V, come with 5–10 m cables, and
   cost $15–30. USB webcams that are both waterproof and wide-angle barely
   exist (ELP's IP67 USB camera is a 92° dome), and USB 2.0 stops at 5 m of
   passive cable, about the run from the hitch to the dash.
2. **Each AHD camera becomes a UVC device through a small AHD-to-USB
   module** ("AHD to Type-C/USB, UVC, driver-free", ~$25). Its chipset isn't
   published. **Check `v4l2-ctl --list-formats-ext` for MJPEG**: a module
   that only offers YUY2 manages ~6 fps at 1080p over USB 2.0.
3. **The factory backup camera stays as it is.** It's the legal (FMVSS 111)
   reverse view on the cluster. Feed a copy through a powered 1-in-2-out
   video distribution amp into an EasyCAP-type UTV007 stick (Linux `usbtv`
   driver, 720×480 at 29.97 fps). **That stick is V4L2 but not UVC**:
   `docs/remote.md` calls all the composite sticks UVC, which is true of the
   AHD modules and not of the UTV007.
4. **A real stitched 360 kit costs $350–700 and isn't Jeff's first buy.**
   Its single output is CVBS (480i) or AHD, and it needs a calibration
   session. On the Slate's door-mounted mirrors there's nowhere obvious for
   the side cameras. Wait for a delivered truck.
5. **Phoenix sets the parts list.** Most cheap cameras are rated −20…+70 °C,
   and the capture modules −10…+60 °C. A dark surface in July sun is hotter
   than that (unverified, but typical: 80 °C+). So mount cameras in shade,
   print hoods in light-coloured ASA, and keep the capture modules and hub in
   the truck box under the dash, not on the dash top.

---

## 1. Three setups

### Signal paths at a glance

| Path | Chip / driver | Res. on the Pi | Linux | Added latency (capture only) | Notes |
|---|---|---|---|---|---|
| AHD camera → **AHD-to-USB module** (UVC) | not published; UVC class driver | up to 1080p (camera's AHD rate, often **25 fps**) | Listed as driver-free on Linux and Android (listing) | ~1–3 frames (unverified) | Needs MJPEG for 1080p. Rated −10…+60 °C (listing). |
| CVBS (factory cam, 360 kit) → **UTV007 "EasyCAP"** | Fushicai UTV007, `usbtv` (mainline since 3.19) | 720×480i, 29.97 fps NTSC | Verified (LinuxTV / BATC wiki) | ~1–2 frames + deinterlace (unverified) | Not UVC. YUYV only, so it has to be encoded. `v4l2-ctl --set-standard=0` for NTSC. Check `lsusb` for `1b71:3002`, since "EasyCAP" boxes ship with other chips. |
| CVBS → **EM2860/EM28xx** stick | Empia, `em28xx` | 720×480i | Mainline, works | similar | Fallback if a UTV007 isn't available. |
| AHD/VGA/CVBS → **AHD-to-HDMI box** → **MS2109 HDMI stick** | Macrosilicon MS2109, UVC | 1080p30 MJPEG | Verified (UVC; a kernel quirk for `534d:2109` since 2021) | **~124–130 ms measured** for the stick alone | Two boxes, and the HDMI box wants 5 V. Use it only for a 360 ECU whose only good output is AHD or VGA. |
| **USB UVC webcam** | its own | 1080p30 MJPEG (ELP OV2710) | Native UVC | lowest (~1 frame) | Use inside the cab or bed only. 5 V 150 mA. ELP rates it −20…+70. |

Analog cameras themselves add almost nothing. What you see on the dash is
capture plus go2rtc: a WebRTC jitter buffer over loopback, roughly
100–250 ms in all (unverified, and the cockpit's latency badge will give
the real figure). That's fine for parking and hitching, and it's why the
cluster keeps the reverse view.

### (a) Rear + front, ~$100

| Camera | Model (example) | Interface | Res / fps | Low light | IP | Op. temp | FOV | Price | Link |
|---|---|---|---|---|---|---|---|---|---|
| Front, grille/lower fascia | PixelMan PMD2A-S, or any "AHD 1080P 170° IP69K" bullet/cube cam | AHD 1080p (switchable to CVBS by cutting a loop) | 1080p25 typical | Starlight or IR LEDs, per listing | IP68–IP69K (listing; one GreenYi manual says IP68 where its listing says IP69K) | **not published on most listings**; −20…+70 °C typical | 170° claimed | ~$20–30 | Walmart range $14–30 (listing) |
| Hitch (printed collar) | same type, cube body with 1/4-20 or 2-hole foot | AHD 1080p | 1080p25 | IR | IP68–69K | as above | 170° | ~$20–30 | as above |
| Capture ×2 | "AHD to USB/Type-C capture, UVC, driver-free" module | USB 2.0 UVC | to 1080p | — | none (keep inside) | −10…+60 °C (listing) | — | ~£20 (≈$25) each | OnBuy listing |

**Total ≈ $100** (2 × $25 camera + 2 × $25 module), plus 12 V wiring from
the existing BOM. Add the factory-cam tap from Jeff's pick later.

### (b) Four cameras for a near-360 view, ~$250

Four separate views in a 2×2 grid. Nothing is stitched, but it covers
everything around a 4.4 m truck.

| Position | Camera | Interface | Notes |
|---|---|---|---|
| Front | AHD 1080p 170° IP69K (as above) | AHD | Lower fascia centre, tilted 20–30° down. |
| Rear / hitch | AHD 1080p 170° on the hitch collar | AHD | Sees the ball, and still works with the tailgate down, when the factory camera can't see anything. |
| Bed (under the NEXUS tonneau) | AHD 1080p with **IR LEDs** (it's dark under a closed lid) | AHD | Top of the bed's front wall, looking aft. |
| Left + right | two AHD 170° cams | AHD | Front fender tops by the A-pillar, looking out and down (§ 2). |
| Capture | 4 × AHD-to-USB UVC modules | USB 2.0 | Two on each Pi 5 USB controller (§ 3). |
| Hub | Powered USB hub fed from its own 12 V→5 V buck | — | The four modules alone exceed the Pi's default 600 mA. |

| Item | Est. |
|---|---|
| 4 × AHD 170° cameras | ~$100 |
| 4 × AHD-to-USB modules | ~$100 |
| Powered USB 2/3 hub | ~$25 |
| Extension leads (4-pin "aviation" vehicle camera cables, 5–10 m) where a kit cable is short | ~$25 |
| **Total** | **≈ $250** |

Pi load: four 1080p feeds into go2rtc on a Pi 5 with no hardware encoder
is the known worry (`docs/remote.md`, Unknowns). Run the modules at **720p
MJPEG**. For the in-cab grid, think about serving MJPEG straight through,
which needs no encode, and spending x264 only on what's recorded or sent
remotely.

### (c) Real stitched 360° (bird's-eye) kit, ~$350–700

You want a **standalone ECU** (control box) with a video *output*, not a
"360 kit for Android head units": those are four bare cameras that rely on
the head unit's own stitching software. The Fockety B0CKNSB499 (~$56) is
one of those, and won't do.

| Kit | Output | Cameras | Op. temp | Voltage | Price | Status |
|---|---|---|---|---|---|---|
| **Weivision 1080P FHD 360 kit** (Amazon B0994GJSSS, 9" monitor; B010I2QBF2 is the 7" one) | **CVBS NTSC/PAL** | 4 × 1080p, 190° fisheye | not found | 12/24 V | not shown (Amazon blocked); ~$350–450 estimated | Listing. One buyer called it terrible, another installed it fine. |
| **DRATSZTECH 360** (Amazon B0CFGT2PM4) | **CVBS / AHD / VGA**, set in the menu | 4 cams; recorder 720p | not found | — | not shown | Listing. AHD output → AHD-to-USB at up to 720p/1080p, the best fit for the Pi. |
| **Carsanbo DV360-3DC-A** (eBay) | CVBS / AHD / VGA | 4 × 1080p AHD | −40…+70 °C (the DV360-3DB-M sibling, Alibaba) | 12 V | ~$710 with a 10.25" monitor | Listing. One installer reported ~5 hours. |
| *Reference, pro:* Rear View Safety **inView 360 HD** (RVS-02-360) | 2 × 1080p/CVBS | 2.9 MP, 190° × 130°, IP69K, 65 mA @ 12 V | ECU −20…+70 °C | 8–32 V | $2,162 with a 7" monitor | Verified (maker page). The quality bar, at 4× the budget. |
| *Reference:* Brandmotion SurroundVUE FLTW-3600/3601 | CVBS/AHD/HDMI 1080p60 (one listing) or AHD | 4 AHD | — | — | $1,214–1,586 | Retailer listings disagree on the outputs. |

**How it reaches the Pi:** AHD out → AHD-to-USB module (best, 720p/1080p).
VGA or AHD out → HDMI box → MS2109 (1080p, about 130 ms more). CVBS out →
UTV007 (480i, soft). **Total ≈ $380–730.** You also need a calibration
mat or cloth (most kits include one) and a flat, level spot to calibrate
on.

**Why not now:** a 360 stitch is calibrated to where the cameras sit, and
the Slate's side-camera spot is unknown (§ 2). The cheap kits' operating
temperatures are mostly unpublished, so in Phoenix that's a gamble. And the
CVBS output most of them offer is 480i, which looks soft next to native AHD
feeds.

---

## 2. Where the cameras go on a Slate

The body is **unpainted, glass-filled polypropylene composite**, moulded in
colour, over a steel frame (verified). That means flat panels, and plastic
that's hard to bond to (low surface energy).

| Position | Where exactly | Bracket | Cable route | Notes |
|---|---|---|---|---|
| **Front** | Centre of the lower front fascia, under the frunk lip, ~0.5 m up, tilted 20–30° down | `cam-bracket` (VHB LSE, or 2 × M4 into the fascia), or the camera's own foot | Behind the fascia → frunk → firewall grommet → under-dash truck box | The lip shades it from overhead sun. Keep it out of the direct tyre-spray line. |
| **Rear, factory** | On the tailgate, pointing down (forum). Sees nothing with the tailgate down. | Leave it | Tap its composite signal (§ 4) | The legal reverse view stays on the cluster. |
| **Rear, hitch** | On the 2" receiver, on the printed collar, looking aft and down at the ball | `hitch-cam-mount` + `cam-bracket` (34 mm M4 pitch) | Along the frame rail with the trailer harness → body grommet → cab | Independent of the tailgate. It also gives the hitch-ball guide lines (`docs/ev-features.md`). Check the hitch-pin length (+13 mm). |
| **Bed** | Top centre of the bed's front wall (cab side), just below the bed rail, looking aft | `cam-bracket`, M4 into the bed wall, or VHB | Down the front wall → under the bed → frame rail → cab-floor grommet | It sits under the NEXUS lid when closed, so it needs IR or the bed light kit. Keep it below the rail so the flip-up panels and their seals don't foul it. |
| **Left / right (360 or setup b)** | Top rear corner of each front fender, by the A-pillar base, looking out and 45° down. The mirror underside, where 360 kits expect them, is on the **door**. | `cam-bracket` on VHB LSE | Fender → cowl/frunk side → firewall | A cable through a door hinge boot isn't worth it. The fender corner keeps the cable out of the door. Unverified until we can measure a delivered truck. |
| **Cab (optional)** | Headliner or behind the rear-view mirror | UVC webcam, USB | Short run to the Pi | Here a USB webcam beats AHD. |

MOLLE panels in the bed are another solid, bolt-on place for a bed or work
camera (M5 or M6 through the MOLLE slots into a printed adapter). That
needs no adhesive.

---

## 3. Power

### Budgets

| Load | Supply | Each (typical) | Source |
|---|---|---|---|
| AHD camera | 12 V | 65 mA (RVS pro cam) to ~150 mA with IR on, ≈ 0.8–2 W | RVS verified; IR figure unverified |
| AHD-to-USB module | 5 V USB | ~150–250 mA ≈ 1 W | unverified |
| UTV007 stick | 5 V USB | ~200 mA | unverified |
| ELP UVC cam | 5 V USB | 150 mA | verified (ELP dome) |
| 360 ECU | 12 V | ~3–6 W | unverified |
| Distribution amp | 12 V | <1 W | unverified |
| Pi 5 extra CPU for x264 | via the Pi | +2–5 W at 4 × 720p | unverified |

| Setup | Added draw (awake) |
|---|---|
| (a) 2 AHD + 2 modules | ≈ 4–6 W (+ Pi encode) |
| (b) 4 AHD + 4 modules + hub | ≈ 9–13 W |
| (c) 360 kit + 1 capture | ≈ 8–14 W |
| Jeff's pick (3 AHD + 3 modules + amp + UTV007) | ≈ 7–10 W |

### Rules

- **Pi 5 USB current**: 600 mA in total across all four ports by default;
  **1.6 A** when the Pi negotiates 5 V/5 A over USB-PD, or with
  `usb_max_current_enable=1` (verified, Raspberry Pi white paper). The CarPiHAT
  supplies the Pi, so set it if that supply can really deliver it. Either
  way, **cameras go on a powered hub**: the SSD (~0.5 A+) and the Carlinkit
  (~1 A) already use most of 1.6 A. The BOM's second hub (§ 5) is that hub.
- **Bandwidth**: the Pi 5's RP1 has two USB controllers, each with one USB 3
  and one USB 2 port. Put no more than two MJPEG cameras on each, at 720p.
  UVC reserves isochronous bandwidth on opening a stream, so a third camera
  on one controller can fail with `No space left on device` (a common UVC
  behaviour, not tested on this hardware).
- **AHD cameras on 12 V, switched:** one fused circuit from the cockpit's
  6-way fuse block through a relay the brain controls (cameras off when the
  Pi sleeps). Fuse it at **2 A for up to four cameras**. Use 20 AWG or the kit
  cable's own power pair, and add ground at the fuse block's negative bus.
- **12 V→5 V for the hub**: a Pololu **D36V28F5** (5.3–50 V in, 3.2 A,
  reverse protection to 40 V, verified). It has no transient rating above
  50 V, so put a **TVS diode** (e.g. SMBJ24A or SMDJ26A class) and a
  reverse-blocking or ideal diode in front of it, as the truck box already
  does. An EV's DC-DC is gentler than an alternator's load dump, but don't
  rely on that. Give the hub its own buck, not the Pi's rail or the panel's
  buck.
- **Parked**: don't stream or record continuously. Four cameras plus the Pi
  draw ~15 W ≈ 1.25 A, and a small lead-acid 12 V in an EV that may not
  top itself up while asleep would be flat overnight. Keep to the two-tier
  design in `docs/remote.md`: the tier-1 watch's vibration or ignition
  sense wakes the Pi, the cameras' relay closes, a 30 s + 30 s clip is
  saved, and everything sleeps again. The Pi stays down below ~12.2 V
  (needs a resting-voltage check on a delivered truck).

---

## 4. Wiring and routing

| Run | Length (est., 4.4 m truck) | Medium | Notes |
|---|---|---|---|
| Front fascia → dash | 2.5–4 m | AHD (camera's own cable) | Easy. Through the firewall grommet. |
| Hitch → dash | 5–7 m | AHD, 6–10 m extension | **Beyond passive USB 2.0 (5 m).** AHD over coax or 4-pin cable is good to tens of metres. |
| Bed wall → dash | 3–5 m | AHD | Under the body, not through the cab back. |
| Fenders → dash | 2–3 m | AHD | Cowl and firewall. |
| Cab camera → Pi | <2 m | USB | Passive is fine. |

- **USB over 5 m** needs an **active repeater** (StarTech USB2AAEXT5M class,
  5 m each, at most 2–4 chained depending on the maker). Each repeater is
  another hub tier and another electronic part in the heat. That's another
  reason exterior cameras should be AHD.
- **Bed to cab without drilling the cab:** run along the frame rail beside
  the hitch wiring, then up through an **existing floor-pan body plug or
  grommet** under the seat or in the footwell, swapping the plug for a
  **PG7/PG9 cable gland** or a split rubber grommet. Use the tailgate's
  existing harness grommet if the factory camera tap is made at the
  tailgate. That a usable plug exists on a Slate is unverified, so look on
  a delivered truck. A pickup's rear-cab gap (cab to bed) is fine for a
  run along the frame, but don't leave a loose loop there: the bed and cab
  move relative to each other.
- **Seal every outside joint**: use heat-shrink with adhesive lining on
  splices, dielectric grease in the 4-pin connectors, and drip loops before
  each grommet. Run it in split corrugated loom under the body (no exhaust,
  but road heat and stone strikes), and fix it every 30 cm.
- **Tapping the factory backup camera (non-destructive):** find the
  composite pair between the tailgate and the cluster, ideally at a
  connector. A Y-harness built from a matching mating-connector pigtail
  leaves the factory harness uncut, and the same goes for the reverse
  trigger (the camera's own power wire comes on in reverse, or tap the
  backup light). A **passive Y on 75 Ω video double-terminates the line**
  (two 75 Ω loads ≈ 37.5 Ω), so both pictures dim by about a third. Use a
  **powered 1-in-2-out composite distribution amp** (~$25, unverified) so the
  cluster gets full level. The connector type and signal are forum claims
  (NTSC, 75 Ω, TVP5150 in the cluster): **verify on a delivered truck
  before cutting anything** (warranty).

---

## 5. Mounting, lenses and heat

| Surface | Fixing | Temperature (long term / short term) |
|---|---|---|
| **PP body panels (fascia, fenders, bed wall)** | **3M VHB LSE-110WF** (for low-surface-energy plastics, no primer). Or 5952 with **3M Primer 94** (primer: unverified for this pairing). Or M4 screws with backing washers where you can reach behind. | LSE: 90–100 °C / 150 °C (3M; its two sheets differ). Holds 500 g static shear at 66 °C on PP (verified). |
| Painted / powder-coated metal (hitch, steel brackets, MOLLE) | **3M VHB 5952** | 93 °C (one 3M sheet) or 121 °C (another) / 149 °C |
| Glass | VHB 4910 (as in `cam-bracket`) | — |

- Clean with IPA and press hard for 30 s. Apply at **10–38 °C**, which in
  Phoenix means a morning in the garage, not July noon. Full strength
  takes ~72 h.
- **Screws over tape** wherever a cable can pull on the camera: the hitch
  (vibration, road strikes) and the fender cameras.
- **Hitch cam**: the printed collar is the right mount. The hitch is the
  dirtiest spot on the truck (the air behind a pickup's tailgate pulls
  dust onto it), so plan on wiping the lens.
- **Bed cam under the tonneau**: mount below the rail and away from the
  NEXUS hinge and its seals. Use IR, or have the cockpit switch the bed
  lights on (relay 1) while that camera is viewed. Expect condensation
  after a cold night, which a lens hood helps with.
- **Lens care**: a hydrophobic glass coating (Rain-X type) on the lens
  every few months. Tilt each lens ≥15° down so water runs off. Add a
  small printed visor (ASA) that shades the lens from overhead sun without
  entering a 170° field of view: trim it until it doesn't show in frame.
- **Heat**: print every exterior part in **light grey or white ASA**. ASA's
  glass transition is ~100 °C, so black ASA in the sun gets uncomfortably
  close. Fit cameras in shade (under the fascia lip, under the bed rail,
  under the receiver). Buy cameras with a published range up to **+80 °C**
  or better where you can find one. Treat "IP69K, −20…+70" as the minimum.
  **The capture modules (rated −10…+60 °C) and the hub go in the truck
  box under the dash**, not on the dash top, where a parked Phoenix cabin
  gets hotter than 60 °C.

---

## 6. Jeff's pick

Three AHD cameras where the truck needs them (front, hitch, bed), the
factory camera mirrored to the dash, and room for a fourth. Skip the 360
kit until a delivered truck shows where side cameras can go.

| # | Item | Est. $ |
|---|---|---|
| 3 | AHD 1080p 170° IP69K cameras (front, hitch; the bed one **with IR**). Prefer listings that publish an operating range to ≥ +70 °C, and +80 °C if you can find it. | 75 |
| 3 | AHD-to-USB UVC modules. Check for **MJPEG** on arrival with `v4l2-ctl --list-formats-ext`. | 75 |
| 1 | UTV007 EasyCAP stick (`lsusb` → `1b71:3002`) for the factory camera | 12 |
| 1 | 12 V composite distribution amp, 1 in / 2 out | 25 |
| 1 | Mating-connector pigtail for the factory camera's Y-harness (find the part on a delivered truck) | 15 |
| 1 | Powered USB hub + Pololu D36V28F5 buck + TVS (the hub is BOM § 5's second hub) | 41 |
| 1 | 10 m AHD extension for the hitch run | 12 |
| — | VHB LSE-110WF roll, PG7 glands, split grommets, loom, 2 A fuse, relay (partly in BOM § 7) | 30 |
| — | Printed: `hitch-cam-mount` + 3 × `cam-bracket` in light ASA | filament |
| | **Total** | **≈ $285** |

That's about $20 over BOM § 5's $265 line, with the factory-camera tap
included. A fourth AHD camera and module (+$50) gives setup (b) later. A
360 kit with AHD output (DRATSZTECH-type) can replace the front and side
cameras once a calibration spot and mounting points are known.

**Check on arrival / on the truck:**
- The modules' formats and frame rate (AHD 1080p**25** cameras need modules that accept 25 Hz).
- The real cabin and under-dash temperatures in July.
- The factory camera's connector and its level with the amp in the line.
- Whether a floor-pan body plug exists for the bed and hitch runs.
- The 12 V resting voltage before turning on any parked recording.

---

## Sources

Cameras and kits
- ELP USB dome camera ELP-USBFHD01M-DL36 (OV2710, MJPEG 1080p30 / YUY2 6 fps, IP67, −20…70, 5 V 150 mA, $47.25): https://www.svpro.cc/?p=1354
- Entaniya IP67 ASA housing for ELP boards: https://e-products.entaniya.co.jp/en/list/cube-case/waterproof-camera-cases-items/housing-set-for-elp-cameras/
- Walmart AHD 1080P 170° cams, $14–30 (listing): https://www.walmart.com/ip/17517166105
- PixelMan PMD2A-S (listing): https://www.neweggbusiness.com/p/9B-3C6-02X3-027V0
- GreenYi AHD manual (cut a loop for CVBS; IP68): https://manuals.plus/m/634d52b77e6c62fa3e743c3d161fd3035468043e18fcbc102ae5b331cdc2fb87
- AHD 1080p**25** default (listing): https://www.newegg.com/p/3C6-02X3-02833
- Rear View Safety inView 360 HD (ECU −20…70, IP69K cams, 65 mA, $2,161.76): https://www.rearviewsafety.com/inview-360-hd-around-vehicle-monitoring-systems-rvs-01-360.html
- Weivision 360, CVBS out (Amazon): https://www.amazon.com/Weivision-Surround-Panoramic-Vihicle-Semi-Trailer/dp/B0994GJSSS and https://www.amazon.com/Weivision-Surround-Panoramic-Vihicle-Semi-Trailer/dp/B010I2QBF2
- DRATSZTECH 360, CVBS/AHD/VGA out (Amazon): https://www.amazon.com/Camera-360%C2%B0Degree-Recording-Panoramic-Reversing/dp/B0CFGT2PM4
- Carsanbo DV360 (eBay listing, ~$710): https://www.ebay.com/itm/366134412659 ; DV360-3DB-M −40…70 °C: https://carsanbo.en.alibaba.com/product/62583552574-802712089/SONY225_chips_360_Surrounded_View_system_model_used_for_Maserati.html
- Brandmotion FLTW-3600 ($1,586): https://jbspowercentre.com/products/dksf-fltw-3600 ; FLTW-3601 ($1,214): https://vividracing.com/brandmotion-surroundvue-360degrees-system-p-156683087.html
- Fockety "360 for Android radio" (no ECU, $56): https://pricehistory.app/p/fockety-360-degree-bird-view-surround-system-hJe5jpG5
- 360-kit buyer notes: https://carinterior.alibaba.com/question/360-camera-kit-for-car-what-you-need-to-know

Capture
- AHD-to-USB/Type-C UVC module (1080p, 5 V, −10…60 °C): https://docs.cirkitdesigner.com/component/ecf4d35b-cb01-441c-896a-86bddb8fa7c8/ahd-to-type-c-usb-capture-analog-signal-to-digital-usb-camera-module-uvc-free ; price ~£20: https://www.onbuy.com/gb/p/ahd-to-usb-capture-analog-signal-ahd-to-type-c-module-for-androidb~p141077938/
- UTV007 / `usbtv`: https://wiki.batc.org.uk/Fushicai_USBTV007 , https://linuxtv.org/wiki/index.php/Easycap , https://forum.batc.org.uk/viewtopic.php?p=11976
- MS2109 (UVC, MJPEG 1080p30, ~130 ms): https://www.cnx-software.com/2020/06/05/11-hdmi-to-usb-2-0-video-capture-dongle-supports-up-to-1080p30-grabbing/ , https://fluxcoil.net/wiki/hardware/camlink_hdmi_converter , https://www.lkml.org/lkml/2021/6/22/180
- AHD/TVI/CVI-to-HDMI converters ($32–60): https://www.newegg.com/p/1J8-00PD-008J8

Power, wiring, adhesives
- Raspberry Pi 5 USB-PD white paper (600 mA / 1.6 A, `usb_max_current_enable`): https://pip-assets.raspberrypi.com/categories/685-app-notes-guides-whitepapers/documents/RP-009856-WP-1-USB%20Power%20delivery%20on%20Raspberry%20Pi%205.pdf
- Pololu D36V28F5: https://www.pololu.com/product/3782/specs
- USB 2.0 5 m limit and active repeaters: https://markertek.com/product/st-usb2aaext5m/startech-usb2aaext5m-usb-2-0-active-extension-cable-m-f-5-meter-16-feet
- 3M VHB 5952 datasheet: https://tbpconverting.com/wp-content/uploads/2026/01/Data-Sheet_3M™-VHB™-Tape-5952.pdf ; 3M VHB LSE datasheet: https://multimedia.3m.com/mws/media/1746365O/3m-vhb-tape-lse-tds.pdf ; LSE-110WF: https://www.3m.com/3M/en_US/p/d/b5005036160/ ; VHB 5925 (application temperature): https://multimedia.3m.com/mws/media/2366505O/3m-vhb-tape-5925.pdf
- Slate panels, PP composite: https://compositesworld.com/news/the-new-slate-truck-costs-less-than-20000-uses-pp-composite-body-panels , https://www.edmunds.com/slate/truck/
- Factory camera (NTSC 75 Ω, forum claim): `docs/forum-findings.md` § 6
