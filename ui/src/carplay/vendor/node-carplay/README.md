# node-carplay (vendored)

- **Package:** `node-carplay` **4.1.0** (npm, published December 2023), MIT, by Rhys Morgan.
- **Source:** https://github.com/rhysmorgan134/node-CarPlay (npm tarball `dist/`).
- **Why vendored:** the npm package depends on the native `usb` module and on
  `node-microphone` from a git URL. The cockpit only needs the browser half
  (WebUSB), so the build pulls in none of that.

## What is here

Copied unchanged from the package's `dist/`, except:

- source-map comments removed (the maps are not shipped);
- `/// <reference types="node" />` and `/// <reference types="w3c-web-usb" />`
  removed from the `.d.ts` files; the UI's type check gets those types once,
  from `@types/node` (via `vite.config.ts`) and `ui/src/carplay/globals.d.ts`;
- `web/recorder.worklet.d.ts` dropped (it needs AudioWorklet global types and
  nothing imports it);
- `modules/messages.js` (an older duplicate of `modules/messages/`) and the
  Node half (`dist/node/`) left out.

| Path | Upstream |
|---|---|
| `modules/DongleDriver.js` | USB transport, `DEFAULT_CONFIG`, `knownDevices` (vendor 0x1314, products 0x1520 / 0x1521) |
| `modules/messages/*` | protocol: `VideoData`, `AudioData` + `decodeTypeMap` + `AudioCommand`, `MediaData`, `SendTouch` / `TouchAction`, `SendAudio`, `SendCommand`, `SendBoolean` / `FileAddress` |
| `web/CarplayWeb.js` | WebUSB wrapper (`findDevice`, `requestDevice`, `CarplayWeb`) |
| `web/WebMicrophone.js`, `web/recorder.worklet.js` | 16 kHz mic capture, Int16 PCM to a `MessagePort` |

The library uses the Node globals `Buffer` and `events`; the npm packages
`buffer` and `events` stand in (`ui/src/carplay/polyfills.ts`).

## Known upstream quirks (left as is)

- `CarplayWeb.clearFrameInterval()` clears the interval but nulls
  `_pairTimeout` instead of `_frameInterval`. Harmless: a stale id is cleared
  again later.
- `CarplayWeb` forwards only plugged / unplugged / video / audio / media /
  command / failure. The dongle's `Opened` reply (negotiated size and fps),
  `BoxInfo`, `SoftwareVersion` and `Phase` are read from `dongleDriver`'s own
  `message` event in our worker.
- `DongleDriver.readLoop` gives up after 5 consecutive read errors and emits
  `failure`; it never recovers by itself. Our worker restarts it with backoff.
- `SendTouch` writes `10000 * x` unrounded; our worker rounds to 1/10000 first.
- Night mode is only sent at start (`/tmp/night_mode`). Our worker re-sends the
  file and the `enableNightMode` / `disableNightMode` command when the theme
  flips.

To update: replace these files from a newer `dist/`, redo the edits above, and
re-run `npm test -w ui`.
