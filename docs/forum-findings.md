# Slate forum findings for the in-dash touchscreen build

Researched 2026-11-05 from slateforums.com (an independent forum with no official tie to Slate Auto), slate.auto, and press coverage.

**How to read the tags:**
- **OFFICIAL**: Slate's own site or store text, or a press article quoting Slate.
- **SECONDHAND-OFFICIAL**: a forum member relaying what a Slate rep or support said.
- **FORUM-CLAIM**: an owner's observation or speculation.

No production trucks have been delivered yet, so every hands-on observation comes from prototypes and event trucks. Treat all of it as subject to change.

Gaps in the research:
- The slate.auto store and spec pages render client-side, and the fetch tool could not read their product text or the spec-chart image.
- Some forum pages (the `goto/post` links) returned 403 Forbidden.
- Long threads were sampled (first page, last page, one middle page), not read in full.

---

## 1. Truck data: OBD-II, CAN, app link

**What we found:**
- **OFFICIAL (press):** Design News (Feb 2026) says owners read OBD-II error codes through the Slate app rather than plugging in a separate code reader. That implies a standard OBD-II diagnostic system, but nothing gives the port's location or pinout.
- **FORUM-CLAIM:** A ranger6g mirror of the "Robust electronics" thread has a poster saying Slate told them OBD-II is required (unverified). Members otherwise just debate whether an EV needs the port.
- **How the app talks to the truck (OFFICIAL, Engadget via the OTA thread, Oct 19, 2026):** over a wired USB connection, not Bluetooth.
  - The app downloads an update to the phone.
  - The phone is plugged into the dash USB port for about a minute to transfer it.
  - The truck then installs it by itself in about 45 minutes.
  - The truck has no built-in cellular. The optional Telematics Module ($275, subscription) adds remote features.
- **FORUM-CLAIM (Moe, Sep 24, 2026, "Slate app info from Google"):**
  - There are two USB data ports behind a hub: one for the phone, and one hidden port for the Telematics Module.
  - Without the module the truck has no Bluetooth, GPS, Wi-Fi or cellular.
  - Another member (VigilKnotEagle14) remembers Slate saying the phone connects over Bluetooth. That conflicts with Moe, and no one has resolved it.
  - Kopsis, relaying Slate support (SECONDHAND-OFFICIAL): all app features work without the Telematics Module, except long-range remote preconditioning.
- **Telematics hardware (FORUM-CLAIM, kotaKat and kvermeer, Aug 31, 2026, "Info on ECU, telematics, secure gateway"):** the electronics appear to come from CyberCogs.
  - Parts named: the CC-TELM100 telematics module, the secure gateway / key-fob insertion unit, the CC-FOB200 fob, and the instrument cluster (cybercogs_ipc_rev0c.pdf).
  - The CyberCogs product page lists LTE-M/NB-IoT, GPS, Wi-Fi/BT and USB 2.0. It does not mention CAN.
  - kotaKat implies the secure gateway uses an authentication scheme called "AutoAuth".
- **CAN bus:** no DBC files, sniffing logs or pinouts were found anywhere.
  - Members have asked Slate not to encrypt CAN (corvolt) and to publish IDs (whasupjohn). Both are requests, not facts.
  - kvermeer expects "most of what you want will be on the OBD-II port" (speculation).
- **Third-party data access:** no Slate statement found.

**What this changes for the build:**
- Plan the data feed around a generic OBD-II reader (ELM327 or CAN-to-USB) once a truck is in hand.
- A secure gateway probably filters the OBD-II port, so plan for standard diagnostic queries only, not raw bus traffic.
- The Slate app's link is wired USB (possibly a proprietary protocol over the phone port), which makes the app a poor target for reverse engineering. Don't design around it.
- Reverse engineering only becomes possible once a delivered truck is available to test.

## 2. Integrated speakers (Front Center, Front L/R)

**What we found:**
- **OFFICIAL (press, Aug 2026):** Front Center Integrated Speaker $249.99. Left + Right pair $149.99, which requires the center unit.
  - Manufacturer per the configurator code: Tymphany (Ocean Neighbor, Aug 29, 2026).
  - Slate's FAQ says the accessory speakers "turn the dash into a sound bar".
  - No official spec covers inputs, amplifier power or speaker sizes. E90400K (Jun 26, 2026) notes Slate published no specs at all.
- **FORUM-CLAIM (Jun–Jul 2026):**
  - The center unit carries the volume and controls (ack154) and looks like a powered Bluetooth speaker, "a bespoke version of a portable Bluetooth speaker" on 12V (AZFox).
  - It may draw power from a dash USB-C port (ack154, Moe).
  - The side speakers may be DC-powered and mid/high only, fed from the center unit (Moe, Nov 2026).
  - A grille photo suggests one driver plus a rear port in the center unit (Moe).
- **SECONDHAND-OFFICIAL:**
  - Gozer heard an unnamed engineer say the center unit alone handles podcasts and navigation prompts, and the side pair adds "premium sound".
  - Luxrage says the CEO, in a reservation-holder Q&A, said 6-inch round speakers fit in the doors.
- **No factory head unit or amplifier.** Slate's FAQ: "no built-in infotainment"; use your phone or tablet. Nobody has confirmed an AUX, line-level or speaker-level input on the sound bar.

**What this changes for the build:**
- Treat the factory sound bar as a Bluetooth sink at best. Plan on Bluetooth audio from the head unit until someone shows a wired input.
- For a wired system, run your own amp (Juvelez used a HiFiBerry at 60 W × 2) to door speakers or DIY panel speakers.
- Several members plan to buy only the perforated panel covers and fit their own drivers.

## 3. Five Switch (Upgrade Version) and the Accessory Console

**What we found:**
- **OFFICIAL (store):** "The Five Switch | Upgrade Version", $39.99.
  - Includes one Accessory Console-specific switch plate and five covers.
  - Designed for the Accessory Console upgrade (sold separately; the armrest console). A separate base-console version exists.
  - DIY difficulty is rated "Advanced".
- **OFFICIAL (press, Engadget, Oct 19, 2026):** the switches are "required for the fog lights".
- **FORUM-CLAIM:**
  - The configurator code names Diode Dynamics as the maker (identifier `the_five_switch`, type "multibutton", ACCIT008_BC).
  - The "Advanced" rating implies wiring runs and a power tap at a "Slate Access Point". A Slate job posting mentions "Slate Access Points (SAPs)" for accessory interfaces (tubes, Jul 5, 2026).
  - A CAN-style data bus is speculated, not confirmed (revnelson and kvermeer, Jul 2026).
- **Not found:**
  - Which circuits it controls beyond the fog lights.
  - Fuse ratings, current limits or connector type.
  - Whether the Bed Light Kit wires into it. Only a hypothetical Diode Dynamics bed-light example came up. No Slate bed light kit appeared in the leaked accessory list.

**What this changes for the build:**
- Don't plan on driving the switch bank from the touchscreen. Its electrical interface is unknown and may be a "multibutton" bus device rather than plain switched 12V.
- Keep the switch bank physical, and wait for an upfitter guide or a teardown of a delivered truck.

## 4. Tablet Mount

**What we found:**
- **OFFICIAL:**
  - The FAQ says an "accessory bracket fits a large tablet".
  - Press reports it as unpriced and "listed as coming" (Engadget Aug 31 and Oct 19, 2026; buildpriceoption Aug 7, 2026).
  - Manufacturer per the configurator code: Cord/RealTruck (IT009).
- **FORUM-CLAIM:**
  - Landscape orientation, based on renders.
  - An early prototype appeared to fit one size and no cases.
  - It blocks two of the three right-side dash panels (FlyHappy, Jul 5, 2026) and the dash drawer.
  - It hangs on the dash T-rail, the same rail the phone holder uses.
  - FlyHappy (Aug 8, 2026) expects the Slate holder and T-Track to work poorly for a tablet used as a dedicated screen.
- **Not found:** size range, clamp dimensions, and whether the mount carries power (USB-C PD). The dash USB-C ports show power icons, but PD isn't confirmed (Moe, tubes, Jul 24, 2026).

**What this changes for the build:**
- Design your own mount against the dash T-rail or the panel openings. The factory mount gives no dimensions to copy.
- Power the screen from your own supply, and don't assume the factory ports provide PD.

## 5. Hands Free Bluetooth Controller

**What we found:**
- **OFFICIAL (press):**
  - Engadget (Aug 31, 2026): "a steering-wheel Bluetooth control button" that connects to your device and "can be programmed to control exterior lights and other add-ons". Price not listed.
  - Engadget (Oct 19, 2026): "Bluetooth steering wheel controls ... to skip songs and answer calls".
- It pairs with your phone or tablet, not with the truck; the truck has no Bluetooth radio. One forum member's understanding is that the truck has no wireless besides the fob, with a possible exception for the steering-wheel Bluetooth controls.
- It is not in the leaked manufacturer list, and no forum thread covers it.

**What this changes for the build:**
- It's probably a standard Bluetooth media remote (HID/AVRCP) and should pair with an Android or Pi head unit just as it would with a phone.
- The "control exterior lights" claim suggests it can relay commands through the app, which is unverified.

## 6. Backup camera

**What we found:**
- **OFFICIAL:** the FAQ lists "Backup Camera" among the safety features. Press says the 4-inch LCD cluster behind the wheel shows it, and it "activates as soon as you shift into reverse" (Engadget, Aug 31, 2026).
- **FORUM-CLAIM (kotaKat, "unofficial Slate dataminer", Oct 23, 2026, "Camera and Android/CarPlay Head Unit thread"):**
  - The camera sits on the tailgate and is "a normal analog NTSC video camera, 75 ohm".
  - The cluster decodes it with a TVP5150M1 chip.
  - To use it you only need a reverse trigger.
  - Beans'n'Taters (Oct 25, 2026) says it points down and can't see anything with the tailgate down.
- **App mirroring:** no evidence the Slate app shows the camera image.
  - The "Slate app mirroring backup camera" thread (Feb 2026) is wishes and speculation.
  - beatle expects the image to stay on the cluster only, for NHTSA reasons, and suggests splitting the composite feed to RCA before the cluster.

**What this changes for the build:**
- This is the most useful finding. If kotaKat is right, a composite-input head unit, or a USB composite capture dongle on a Pi or Android unit, can show the factory camera from a passive splitter.
- You still need a reverse signal, and its source is unknown (see section 7).
- Verify on a delivered truck before cutting anything, since the warranty is a concern.

## 7. 12V system, outlets, USB, switched vs constant, reverse wire

**What we found:**
- **12V battery:** lead-acid, in the frunk (passenger side, prototype).
  - AKrietzer says Slate confirmed the battery (SECONDHAND-OFFICIAL, Jul 16, 2025).
  - Imhotep and Letas give the location and chemistry (Jul 2025).
- **Frunk outlet:** a rep at the Detroit event said there's a 12V outlet in the frunk, and that a 120 VAC frunk outlet was being worked on (SECONDHAND-OFFICIAL, RetiredOnPaper, Jul 17, 2025).
- **Dash ports (FORUM-CLAIM):**
  - A 12V socket rated 120 W, to the right of the AC controls (tubes, Jul 24, 2026).
  - Two USB-C ports in a center-left compartment, both showing power icons (KevinRS, FlyHappy, tubes, Jul 2026).
  - Some prototypes showed USB-A instead (Imhotep, 2025).
- **Switched vs constant (FORUM-CLAIM):**
  - Dash power is expected to be ignition-switched, and there may be no always-on power in the dash (AZFox, 007, FloppaEnjoyer8067).
  - The door locks and dome light are claimed to be unswitched (Slatester89, Oct 20, 2026), but no source is given.
- **"Double DIN Radio Fits + Power Source (confirmed by Slate)":** the confirmation is a reply on Slate's official X account (Oct 20, 2026). It appears only as a screenshot the fetch tool couldn't read, and the original poster says it doesn't specify switched or constant.
- **Not found:** fuse box location (a rep declined to show it), fuse ratings, and a reverse-signal wire.

**What this changes for the build:**
- For constant power with ignition sense, plan a fused feed from the frunk battery plus an ignition-sense lead from the switched 12V socket or a dash USB port.
- For reverse, tap the backup light circuit or the tailgate camera's power feed. Both need verifying on a real truck.

## 8. Existing DIY infotainment projects

**What we found (all FORUM-CLAIM):**
- **OliverW17, Oct 16–18, 2025 ("Working Infotainment Prototype (Wired + Wireless CarPlay)"):**
  - A custom processing box takes power plus an optional wired phone, and runs one cable to a 10-inch-plus OLED with built-in speakers.
  - Supports CarPlay (wired and wireless) and Android Auto.
  - Mounts with a rail strip on the bottom rear of the screen onto the cabin rail.
  - He promised a GitHub repo; none was found.
- **Juvelez, Aug 28, 2026 ("CarPlay / Android Auto screen aftermarket display" thread):**
  - Raspberry Pi 4B, a frameless 10-inch touchscreen, a 256 GB SSD, a HiFiBerry amp (60 W × 2), GPS and a powered USB hub.
  - Pi OS in kiosk mode, OpenMaps and Kodi, coded with Claude.
  - The computer sits in a cooler spot in a vented 3D-printed box, with a PETG frame planned.
- **KevinRS, Aug 28, 2026:** PETG test swatches warped on a dash. Polymaker HTPLA held up much better, with no difference between plain and glass-filled.
- **Others:**
  - Joying, DUDU7 or Teyes Android head units for 360° cameras, which need 8–12 GB RAM; Atoto is also recommended (mikehell and highland, Oct 23, 2026).
  - A Galaxy Tab Active running Headunit Reloaded (Bayfire2441).
  - CarPlay on an Android tablet without a dongle (Chucker77, Oct 4, 2026).
  - An ESP32 Android Auto project (github.com/koenieee/esp32-android-auto-nav), reportedly abandoned.
- **Recurring lessons:** heat is the main killer of tablets and electronics; no factory harness or CAN adapter exists; and a bracket has to be fabricated.

**What this changes for the build:**
- Prior art supports a Pi plus 10-inch screen with a separate, vented compute box.
- Print in HTPLA, ASA or PC rather than PETG.
- A rail-strip mount on the cabin T-rail is a workable approach.

## 9. Delivery timing, dash dimensions, heat, mounting

**What we found:**
- **Delivery:**
  - **OFFICIAL:** the FAQ says "First deliveries are slated for late 2026".
  - **FORUM-CLAIM (early Nov 2026):** first ship was "about 3 weeks" away. kotaKat expects production to ramp within one to two weeks, with production tires at the Warsaw plant.
  - Members' own delivery windows: Q2 2027 and Apr–Jun 2027.
  - A Slate tech rep reportedly said the molds are final (SECONDHAND-OFFICIAL).
- **Dash panel openings (FORUM-CLAIM, EV Trek, Nov 2026):**
  - Left and right panels: 6 7/8 in wide × 5 1/4 in tall.
  - Two large panels: 13 7/8 in × 5 1/4 in.
  - Depth is estimated at over 3 inches, unmeasured.
  - mikehell: the opening is 5.25 inches tall, a shallow double-DIN fits, and a 9–10 inch screen could sit flush. There are no known mounting points.
  - The compartments are said to be removable, and earlier Slate language described them as "double DIN sized".
  - The tablet mount blocks the right-side panels.
- **Mounting:**
  - The dash has a T-rail along its lower edge, used by the phone and tablet holders and possibly a standard profile. EV Trek asked but got no answer.
  - The leaked accessory list includes Diode Dynamics and Ranger Design interior T-rails.
- **Heat:** recurring warnings about tablets in a parked cab. No measured cab temperatures were found.

**What this changes for the build:**
- Design a bezel for a 13 7/8 × 5 1/4 in panel opening; that is the cleanest flush-mount target.
- Make the first print a measuring jig, since depth and the panel retention method are unknown.
- Use a rail-mount fallback.
- Choose a high-temperature screen, or one that is easy to remove.
- Expect no hands-on access before Q2 2027 for most reservation holders.

---

## Sources

**Forum threads (slateforums.com):**
- Working Infotainment Prototype (Wired + Wireless CarPlay): https://www.slateforums.com/forum/threads/working-infotainment-prototype-wired-wireless-carplay.13559/ (and /page-2)
- CarPlay / Android Auto screen aftermarket display (Juvelez's Pi build): https://www.slateforums.com/forum/threads/carplay-android-auto-screen-aftermarket-display.15675/post-279373
- Camera and Android/CarPlay Head Unit thread: https://www.slateforums.com/forum/threads/camera-and-android-carplay-head-unit-thread.17096/
- I want two backup cameras: https://www.slateforums.com/forum/threads/i-want-two-backup-cameras.17135/
- Slate app mirroring backup camera: https://www.slateforums.com/forum/threads/slate-app-mirroring-backup-camera.14289/
- Video: Free OpenSource CarPlay and Android Auto Style Head Unit: https://www.slateforums.com/forum/threads/video-free-opensource-carplay-and-android-auto-style-head-unit.17189/
- Double Din Radio Fits + Power Source (confirmed by Slate): https://www.slateforums.com/forum/threads/double-din-radio-fits-power-source-confirmed-by-slate.16918/ (pages 1, 5, 11)
- Does anyone have dash measurements for speaker placement?: https://www.slateforums.com/forum/threads/does-anyone-have-dash-measurements-for-speaker-placement.17222/
- What drives the speakers - amplifier or phone/tablet?: https://www.slateforums.com/forum/threads/what-drives-the-speakers-amplifier-or-phone-tablet.15689/ (and /page-2)
- Slate Bluetooth Dash Audio Speakers - Thoughts?: https://www.slateforums.com/forum/threads/slate-bluetooth-dash-audio-speakers-thoughts.15205/ (pages 1 and 8)
- Dashboard speakers come standard and more audio options [confirmed]: https://www.slateforums.com/forum/threads/dashboard-speakers-come-standard-and-more-audio-options-in-the-works-confirmed.13104/
- Info on ECU, telematics, secure gateway, etc. (CyberCogs): https://www.slateforums.com/forum/threads/info-on-ecu-telematics-secure-gateway-etc-cybercogs-power-architecture.16304/
- Software updates will push via OTA to the Slate App: https://www.slateforums.com/forum/threads/software-updates-will-push-via-ota-to-the-slate-app-on-your-phone-tablet.16893/
- Slate App info from Google: https://www.slateforums.com/forum/threads/slate-app-info-from-google.16592/
- Accessory power and data bus: https://www.slateforums.com/forum/threads/accessory-power-and-data-bus.15763/
- Mounting points physical only?: https://www.slateforums.com/forum/threads/mounting-points-physical-only.15395/
- Some Slate accessories manufacturers revealed: https://www.slateforums.com/forum/threads/some-accessory-manufacturers.16284/
- What do you think are the Best Tablets for the Tablet Mount?: https://www.slateforums.com/forum/threads/what-do-you-think-are-the-best-tablets-for-the-tablet-mount.16012/
- 12v accessory battery: https://www.slateforums.com/forum/threads/12v-accessory-battery.16755/
- Is there a 12v volt source in the frunk?: https://www.slateforums.com/forum/threads/is-there-a-12v-volt-source-in-the-frunk.13316/
- For a company slated to ship their first vehicle in 3 weeks...: https://www.slateforums.com/forum/threads/for-a-company-slated-to-ship-their-first-vehicle-in-3-weeks-virtually-zero-news-posts-videos-or-anything-of-substance.17257/
- Subforum index: https://www.slateforums.com/forum/forums/software-app-audio-nav-bluetooth-electronics-cameras-comms.64/

**Official Slate pages:**
- FAQ: https://www.slate.auto/en/faq
- Store, Five Switch: https://www.slate.auto/en/store/ACCIT008-AC (client-rendered; the text reached us through search snippets)

**Press and third-party pages:**
- Engadget, "bring your own tech" (Aug 31, 2026): https://www.engadget.com/2244162/the-slate-truck-is-affordable-because-you-have-to-bring-your-own-tech/
- Engadget, "perfect modular Slate build" (Oct 19, 2026): https://www.engadget.com/2289274/heres-how-we-would-build-out-the-perfect-modular-electric-slate-truck/
- buildpriceoption accessories price list (Aug 7, 2026): https://www.buildpriceoption.com/slate-truck-accessories/
- Design News, Slate OBD-II via app (Feb 2026): https://www.designnews.com/automotive-engineering/inside-slate-s-ev-pickup-exploring-affordable-innovation-and-diy-repairs
- CyberCogs CC-TELM100 telematics module: https://www.cybercogs.com/our_product/cybercogs-cc-telm100-telematics-module/
