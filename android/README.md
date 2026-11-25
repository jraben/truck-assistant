# TA Companion (Android)

A small app for the dash tablet that does what Tasker did, with no Tasker to set up:

- **The truck turns on** (power comes on): wakes the screen and brings the cockpit to the front.
- **The truck turns off**: asks the brain how long to wait (Settings › Truck › *When the truck
  turns off*), then turns the screen off for real (device admin, lock screen only). This is the
  step Tasker couldn't do reliably.
- **Music keys and volume** from the cockpit: play/pause, next, previous, volume up/down, sent
  to whichever app is playing.
- **Now playing**: the song in Spotify, Pandora, YouTube Music and the rest shows in the cockpit.
- **Opens apps** the cockpit asks for (Moonlight, RetroArch).
- Starts by itself when the tablet boots.

It answers on port **1821** with the same paths Tasker used (`/slate/front`, `/slate/launch`,
`/slate/media`), so the brain needs no change. Only devices on a private network (the truck's
Wi-Fi, home, Tailscale) are answered.

## Install

1. On the tablet, open **https://github.com/jraben/truck-assistant/releases/tag/android-latest**
   and download **ta-companion.apk** (signed in to GitHub, since the repo is private). Or download
   it on a computer and copy it over.
2. Open it and allow *Install unknown apps* for the browser when Android asks.
3. Open **TA Companion** and tap **Turn on** for each item until all four are ticked:
   *Screen off*, *Bring the cockpit back*, *Now playing* and *Keep running*.
4. **Pick the cockpit app**: the installed *Slate Cockpit*.
5. **Brain address**: `http://10.42.0.1:8080` in the truck. At home, for testing,
   `https://ta.jeffraben.com`.
6. In **Tasker**, turn off the profiles TA Companion replaces (the two can't both listen on port
   1821): *Music buttons*, *Music to the cockpit*, *Power Any* and the HTTP Request ones. Tasker
   can be uninstalled once this works.
7. Test: the **Test** buttons in the app, then unplug and plug in the tablet.

Updates: each change to `android/` publishes a new APK to the same link, and it installs over the
old one (one fixed signing key, `android/keystore/companion.jks`; it's a sideload key, not a Play
Store one, and its password is in `app/build.gradle.kts`).
