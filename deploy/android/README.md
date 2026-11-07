# The dash tablet (Samsung Galaxy Tab S7 FE)

The main screen is a **Samsung Galaxy Tab S7 FE (SM-T738U)** in Slate's Tablet
Mount, running the cockpit in Chrome. A **Raspberry Pi under the dash stays the
brain** (GPS, cameras, dashcam, the truck box, relays, the database); the tablet
reaches it over the truck's Wi-Fi. The 12.3" bar screen and its printed hood
are dropped (`print/dash-bar-insert/` is kept only as an alternative).

Why this tablet: Chrome on Android can talk to the Carlinkit CarPlay dongle
over USB (Safari on an iPad can't, so the iPads don't work as the main
screen); the real Netflix, YouTube TV, Disney+, Max and Hulu apps; 12.4" at
2560x1600; built-in cellular and GPS.

Nothing here has been tried on the tablet yet. Do the **desk test** (below)
before anything goes in the truck.

## What plugs into what

```
truck 12V (ignition-switched) ── USB-C PD car charger (45 W)
                                        │
                     USB-C hub with PD pass-through (power in + USB-A data)
                          │                       │
                 Galaxy Tab S7 FE         Carlinkit CPC200-CCPA ── iPhone (wireless CarPlay)
                          │
                  truck Wi-Fi (the Pi's access point) ── Raspberry Pi brain under the dash
```

## One-time setup on the tablet

1. **Software update**, then Settings › Battery › **Protect battery** on (stops
   at 85%; matters in a hot cab).
2. **Join the brain's Wi-Fi.** At home on the desk that's the NAS copy
   (`http://192.168.1.20:3950`) over home Wi-Fi; in the truck it's the Pi's
   access point (`http://10.42.0.1:8080`).
3. **Let Chrome treat the brain's address as secure.** CarPlay over USB and the
   WOPR microphone only work on secure pages, and the brain is plain `http` on
   the local network. In Chrome open `chrome://flags`, find
   **"Insecure origins treated as secure"**, enable it, and enter the brain's
   address (both, comma-separated:
   `http://10.42.0.1:8080,http://192.168.1.20:3950`). Relaunch Chrome.
   Without the flag (or in another browser, such as Fully Kiosk) the page has
   no WebCodecs: the CarPlay simulator still plays, from an MP4 (an "MP4
   FALLBACK" chip says so), but the real dongle can't be reached. Fully Kiosk
   runs on Android System WebView, which has no WebUSB at all, so CarPlay
   needs Chrome.
4. **Open the cockpit** at that address, sign in once if asked, then Chrome
   menu › **Add to Home screen › Install**. It runs full screen from its own
   icon, with no address bar. Use that icon from now on.
5. **Streaming and game apps**: install the ones you want from the Play Store
   (Netflix, YouTube TV, Disney+, Max, Hulu, Peacock, Paramount+, Prime Video,
   Moonlight, RetroArch) and sign in to each once. On the Parked screen their
   tiles open the real app.
6. **Tasker** (Play Store, about $3.50): it wakes the tablet with the truck and
   brings the cockpit back when you drive off. Three profiles:

   | Profile | Trigger | Task |
   |---|---|---|
   | Truck on | Event › Power › **Power Connected** | Display › Turn On; App › Launch App: **Slate Cockpit** |
   | Truck off | Event › Power › **Power Disconnected** | Wait 2 minutes; Display › System Lock (or Turn Off) |
   | Cockpit to front | Event › Net › **HTTP Request**, port **1821**, path `/slate/front` | App › Launch App: **Slate Cockpit**; HTTP Response 200 |
   | Open an app | Event › Net › **HTTP Request**, port 1821, path `/slate/launch` | App › Launch App, package `%http_request_query_pkg`; HTTP Response 200 |

   The brain learns the tablet's address by itself (the cockpit checks in every
   minute) and calls `/slate/front` the moment the truck moves while Netflix or
   a game is open. A different port goes on `PUT /api/tablet {taskerPort}`.
   Check it from the brain with `POST /api/tablet/test` (the cockpit should jump
   to the front).
7. Developer options › **Stay awake** (screen stays on while charging), and
   Settings › Display › screen timeout as you like for when it's unplugged.

## Desk test (before the truck)

On the desk, with the NAS copy as the brain:

1. Tablet + hub + Carlinkit dongle + charger, as in the diagram.
2. Open the installed cockpit, go to **CarPlay**, tap **Connect**, pick the
   dongle in Chrome's USB prompt. Pair the iPhone with the dongle (Bluetooth
   name "Carlinkit…"). **Pass:** CarPlay shows and plays audio through the
   tablet, and charging continues (the battery icon shows charging).
3. **WOPR** button: speak a question. **Pass:** it answers out loud.
4. **Parked › Watch › Netflix**: **pass** if the Netflix app opens, and if
   `POST /api/tablet/test` brings the cockpit back.
5. Unplug and replug the charger. **Pass:** the screen sleeps after 2 minutes
   and wakes with the cockpit on top.

If step 2 fails (Chrome doesn't offer the dongle, or the hub can't charge and
carry data at once), the fallback is Carlinkit's own **AutoKit** app for
CarPlay, opened from the CarPlay tab, and a different hub.

## Heat

The tablet has a lithium battery. A parked cab in a Phoenix summer gets well
past what it's rated for. Take it out or cover it on hot days, and keep
Protect battery on. The Pi and the truck box have no batteries.
