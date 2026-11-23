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
3. **Use a secure address.** Best: the truck's own `https://truck.jeffraben.com`
   (deploy/pi/https/README.md); at home, the NAS copy's `https://ta.jeffraben.com`.
   Then there's nothing to set here, and step 4 makes a real full-screen app.
   **Fallback without one:** let Chrome treat the brain's address as secure. CarPlay over USB and the
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
   menu › **Install app** (or **Add to Home screen › Install**). On an `https`
   address it runs full screen from its own icon, with no address bar; on a
   plain `http` address Chrome may only make a shortcut that opens a tab. Use
   that icon from now on, and point Tasker's power-on task at it with **App ›
   Launch App** (step 6). Fully Kiosk isn't needed, and it can't run CarPlay.
5. **Streaming and game apps**: install the ones you want from the Play Store
   (Netflix, YouTube TV, Disney+, Max, Hulu, Peacock, Paramount+, Prime Video,
   Moonlight, RetroArch) and sign in to each once. On the Parked screen their
   tiles open the real app.
6. **Tasker** (Play Store, about $3.50): it wakes the tablet with the truck and
   brings the cockpit back when you drive off. Three profiles:

   | Profile | Trigger | Task |
   |---|---|---|
   | Truck on (on the tablet: **Power Any**) | Event › Power › **Power Connected** | Task › Stop: **Truck off**; Display › Turn On; App › Launch App: the cockpit app installed from the `https://` address. In the profile's settings untick **Enforce Task Order**, or the cockpit can take 2 minutes to appear. |
   | Truck off | Event › Power › **Power Disconnected** | the **Truck off** task below |
   | Cockpit to front | Event › Net › **HTTP Request**, port **1821**, path `/slate/front` | App › Launch App: the cockpit app installed from the `https://` address (not an older `http://` shortcut); Net › HTTP Response, status 200 |
   | Open an app | Event › Net › **HTTP Request**, port 1821, path `/slate/launch*` (the `*` matters: Tasker matches the path *with* its `?pkg=…` query) | Variables › **Variable Split** `%http_request_path`, splitter `pkg=`; App › Launch App, package `%http_request_path2` (tap the variable icon to type it); Net › HTTP Response, status 200 (body `pkg=%http_request_path2` echoes what it opened). There is no `%http_request_query_pkg`. |

   The **Truck off** task follows Settings › Truck › *Dash tablet when the
   truck turns off* (sleep after N minutes, or stay on until the battery is
   down to N %), read from the brain each time the power drops:

   1. Net › **HTTP Request**: GET `http://10.42.0.1:8080/api/tablet/sleep` (on the desk: `https://ta.jeffraben.com/api/tablet/sleep`; an old address here means the blind 2-minute fallback),
      timeout 5 s, Structure Output on. (No login needed for this one address.)
   2. Variables › Variable Set `%wait` to `120`; then, If `%http_data.waitSec`
      is set, Variable Set `%wait` to `%http_data.waitSec`.
   3. If `%http_data.keepOn` eq `1`: Task › **Wait Until** `%BATT` < `%http_data.minBattery`
      (check every 5 minutes); Else: Task › **Wait** `%wait` seconds; End If.
   4. Display › **System Lock** (or Turn Off). **Needs Tasker as a device admin**
      (Settings › Security › Device admin apps › Tasker › Activate); without it the
      lock silently does nothing and the screen can stay on until the battery is flat.

   It answers `{minutes, waitSec, never, keepOn, minBattery}`. Plugging back
   in (truck on) stops the task, so a short stop never locks the screen. If
   the brain doesn't answer, the tablet sleeps after 2 minutes as before.

 (the cockpit checks in every
   minute) and calls `/slate/front` the moment the truck moves while Netflix or
   a game is open. A different port goes on `PUT /api/tablet {taskerPort}`.
   Check it from the brain with `POST /api/tablet/test` (the cockpit should jump
   to the front).

   **Music apps on the tablet** (Pandora, YouTube Music, Amazon Music, Spotify).
   Media's *Play on the tablet* plays the app **behind the cockpit**: the brain
   asks Tasker to open it (*Open an app*, above), press Play (*Music buttons*,
   below) and bring the cockpit back (*Cockpit to front*), so the driver never
   leaves the cockpit. These profiles also let the cockpit show what it plays
   and work its ⏮ ⏯ ⏭ buttons. Same port 1821. Check it from the brain with
   `POST /api/tablet/play {"pkg":"com.pandora.android"}`.

   | Profile | Trigger | Task |
   |---|---|---|
   | Music buttons | Event › Net › **HTTP Request**, port 1821, path **`/slate/media*`** (with the `*`: the brain adds `?cmd=…`) | see 1 below; then Net › HTTP Response 200 |
   | Music to the cockpit | Event › Media › **Music Track Changed** | see 2 below |

   1. **Music buttons**: five Media › **Media Control** actions, each with
      *Use Notification If Available* ticked (so it reaches the app that is
      playing), each under an If on **`%http_request_path`** (this Tasker has no
      `%http_request_query_cmd`): `~ *toggle*` › Cmd **Toggle Pause**;
      `~ *play*` › **Play**; `~ *pause*` › **Pause** (the cockpit's Pause button);
      `~ *next*` › **Next**; `~ *prev*` › **Previous**.
      (*Play* is what starts an app after *Play on the tablet* opens it.)
      Two more branches for the dock's volume buttons ‹ 🔊 › (Glass themes):
      `~ *volup*` › Audio › **Media Volume** `%VOLM+1`, and `~ *voldown*` ›
      **Media Volume** `%VOLM-1` (tick *Do Maths*). Put them above the others:
      the matches use wildcards, and neither word contains another's.
   2. **Music to the cockpit**: Net › **HTTP Request**, POST to the brain's
      `/api/tablet/nowplaying` (in the truck `http://10.42.0.1:8080/api/tablet/nowplaying`;
      on the desk the NAS copy, `https://ta.jeffraben.com/api/tablet/nowplaying`),
      Content Type `application/json`, timeout 5 s. Body: the event's title,
      artist, app and playing/paused, picked from its variables in the HTTP
      Request's variable list, as `{"title":"…","artist":"…","app":"…","playing":"…"}`.
      It fires on every new song and on play/pause, so pausing keeps the song
      and a Play button.

   (Tested on the tablet 2026-11-20. The older `%MTRACK` State and "Music
   Active" don't fire on every song, or don't exist in current Tasker; a
   second profile posting `%MTRACK` can overwrite the artist, so leave it off.)

   The brain takes these only from the tablet's own address (no login), so the
   cockpit must have been opened on it. **If an app never shows a song**, use the
   **AutoNotification** plugin instead of profile 2: Event › Plugin ›
   AutoNotification › **Intercept**, Apps: the four music apps, then the HTTP
   Request with Body
   `{"title":"%antitle","artist":"%antext","pkg":"%anpackage","playing":"true"}`.
   Unset Tasker variables are ignored, so any field may be left out. Check the
   buttons from the brain with `POST /api/tablet/media {"cmd":"toggle"}`, and
   what it heard with `GET /api/tablet/media`.

   **Battery log (optional).** The cockpit reports the tablet's battery with its
   minute check-in, so Settings › Truck can graph it and show the charge and
   drain rates (does the charger keep up with CarPlay? did the screen stay on?).
   A page can't report while the screen sleeps; to fill that in, add a profile:
   Event › Power › **Battery Changed** → Net › HTTP Request, POST the brain's
   `/api/tablet/battery` (desk: `https://ta.jeffraben.com/api/tablet/battery`),
   Content Type `application/json`, Body
   `{"level":"%BATT","screen":"%SCREEN","charging":"%charging"}`, where
   `%charging` is set from Power › **Power** state (or leave it out).

7. Developer options › **Stay awake** (screen stays on while charging), and
   Settings › Display › screen timeout as you like for when it's unplugged.
8. **The tablet as the truck's GPS** (optional: skip it if a USB GPS puck is
   on the Pi). The dash page sends the tablet's own location to the brain,
   which uses it whenever no puck has a fix (`brain/src/tabletGps.ts`).
   Browsers only share location with secure pages, and the dash is plain http
   on the truck's Wi-Fi, so once in Chrome on the tablet:
   - open `chrome://flags`, search **Insecure origins treated as secure**,
     add `http://10.42.0.1:8080` (the dash address you use), Enable, Relaunch;
   - open the dash and **Allow** location when Chrome asks (Android Settings ›
     Location must be on, with Chrome allowed **precise** location).

   Settings › Truck shows "Using the tablet's GPS now" and the header's GPS
   pill reads `tablet`. The Wi-Fi Galaxy Tab S7 FE has its own GNSS receiver;
   check another tablet with a GPS test app first. The tablet sleeps when the
   truck is off, so parked features (theft and tow alerts, where the truck is)
   need a puck or the LTE-M watch. Turn it off in Settings › Truck.

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
5. Unplug and replug the charger. **Pass:** the screen sleeps after the time set in Settings › Truck (2 minutes unless changed)
   and wakes with the cockpit on top.

If step 2 fails (Chrome doesn't offer the dongle, or the hub can't charge and
carry data at once), the fallback is Carlinkit's own **AutoKit** app for
CarPlay, opened from the CarPlay tab, and a different hub.

## Heat

The tablet has a lithium battery. A parked cab in a Phoenix summer gets well
past what it's rated for. Take it out or cover it on hot days, and keep
Protect battery on. The Pi and the truck box have no batteries.
