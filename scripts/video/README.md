# God's Eye drive video

How `truck-gods-eye-dash.mp4` is made: the simulated truck's trip in 3D on
God's Eye View, with the real Drive screen in the corner, synced by where the
truck is on the route, plus a short arrival and fast-charge section.

Needs Node, `ffmpeg` on PATH, Google Chrome, and Playwright's library
(`npm i --no-save playwright-core`). Work files go to `./video-work`
(`WORK=` to change); it is gitignored.

## 1. Export the chase scene

On the Trips screen, open the trip and press **Replay in God's Eye**
(`/api/trips/<id>/scene.gevbundle.json`). That file holds the route line and
the chase camera's shots. The demo uses the Home → Tempe trip.

## 2. Render the globe (`globe-chase.mjs`)

```
GEV_URL=https://<your God's Eye host> node scripts/video/globe-chase.mjs trip.gevbundle.json
```

A visible Chrome window, a throwaway profile, `?embed=1`, every data layer off.
The camera is stepped one frame at a time and each frame waits for the 3D
tiles, so the 30 s clip is smooth however slow the PC (about 15 minutes here).
Writes `video-work/globe.mp4`. God's Eye is not changed.

## 3. Record the dash (`record-dash.mjs`)

Start a **demo** truck with fresh data in another shell, then record:

```
DEMO=1 SIM=1 SIM_SPEEDUP=3 PORT=8096 DATA_DIR=<empty dir> node brain/src/index.ts
node scripts/video/record-dash.mjs trip.gevbundle.json
```

It drives leg 0 (Home → Tempe) and, at set miles: changes to a saved FM
station, starts an airport pickup, opens Traffic, then parks, fast-charges and
shows the Charge screen. It refuses a truck that isn't a demo. About 8 minutes.

## 4. Put them together (`compose.mjs`)

```
node scripts/video/compose.mjs trip.gevbundle.json
```

Writes `video-work/truck-gods-eye-dash.mp4` and a `-720p` copy. The captions'
miles in `compose.mjs` must match the steps in `record-dash.mjs`.

## Before posting it publicly

The 3D city is Google's Photorealistic 3D Tiles. Keep the Google and route
credits visible (the bottom corners stay clear for them) and check Google's
terms for 3D Tiles in public video before putting it on a forum.
