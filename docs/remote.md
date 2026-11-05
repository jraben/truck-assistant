# The truck while you're away (and its cameras)

Requested 2026-11-05: status, alerts and camera feeds from the truck when
nobody is in it. The Slate has no modem and the driver's phone leaves with
the driver, so this needs its own small cellular link. Built as Track C
(2026-11-05): `brain/src/cams/`, `brain/src/remote/`, `ui/src/components/cams.tsx`,
the Truck page (`/truck`), `firmware/watch/`, and `deploy/pi/{cams,lte,tailscale,power}/`.
Interfaces: `docs/contract.md`, "Track C: Cameras and remote".

## Two tiers, because of the 12V battery

A Pi draws 3–5 W, about 100 Wh a day. Left on, it flattens a 12V lead-acid
battery in days, and we don't know yet whether the Slate tops its 12V battery
up from the main pack while parked. So:

| Tier | Runs | Power | Link | Does |
|---|---|---|---|---|
| **1. Always-on watch** | its own small board next to the truck box: LilyGO T-SIM7080G-S3 (ESP32-S3 + SIM7080G LTE-M/NB-IoT + GNSS), `firmware/watch` | ~30 mW average at a 10-minute check-in | Cat-M IoT SIM (1NCE prepaid, or Hologram pay-as-you-go) | location, cabin temp, 12V, vibration, "truck moved", relay commands, **wake the Pi** |
| **2. On demand** | the Pi, woken by tier 1 | 5–8 W while awake | USB LTE modem (Cat-4, Quectel EC25/EG25-G class) on a data SIM | live cameras, dashcam clips, the full cockpit remotely, software updates |

Tier 2 goes back to sleep after 10 minutes with no viewer (settable, plus a
60-minute ceiling). The watch holds the car power board's ignition-sense input
high while the Pi should be up and drops it when the brain says so.

### Why tier 1 is a second board (decided 2026-11-05)

- **ESPHome can't do it.** ESPHome 2026.10.2 has no cellular-data component
  (only `sim800l`: 2G SMS). The out-of-tree esp_modem "modem" component targets
  PPP on SIM7600/SIM800-class modems and isn't in ESPHome. So the watch is a
  PlatformIO/Arduino sketch (TinyGSM plus the SIM7080G's own MQTT and HTTPS
  clients, so TLS runs on the modem) and builds clean; see `firmware/watch/README.md`.
- **Deep sleep and relays don't mix.** The truck box must hold the bed fridge on
  and run the low-voltage and compressor interlocks continuously; the watch must
  be off >99 % of the time.
- **Transmit bursts** (~2 A) stay off the relay board's 5 V rail.

Three wires join them (GND, TX, RX at 9600 baud): the watch asks `S?` for
relays, ignition, 12V and cabin temperature and sends `R3=1`/`R3=0`, which pass
the truck box's own safety gate. The truck box also turns its Wi-Fi off after
15 minutes parked (its biggest draw; the Pi's access point is off then anyway)
and back on with the ignition or when the watch wakes the Pi (`W1`).

## How you reach it

- **Alerts** to your phone through Home Assistant's companion app
  (`notify.mobile_app_*`) or, for owners without HA, ntfy.
- **Tier 1** has no inbound ports: it connects out over TLS to an MQTT broker
  reachable from the internet. Raw MQTT can't go through the DSM reverse proxy
  (that is HTTP only), so pick one:
  1. **A free cloud broker, bridged from home (recommended).** HiveMQ Cloud
     Serverless (free tier, TLS on 8883) or similar. The home Mosquitto opens
     an *outgoing* bridge to it for `slate/watch/#`, so HA sees the watch and
     nothing at home is exposed:
     ```
     # /mosquitto/config: home broker, bridge out to the cloud broker
     connection slate-cloud
     address xxxxxxxx.s1.eu.hivemq.cloud:8883
     bridge_capath /etc/ssl/certs
     remote_username slate-home
     remote_password …
     cleansession false
     topic slate/watch/# both 1
     topic homeassistant/+/slate_watch/# in 1
     ```
  2. **Your own Mosquitto on 8883 with a Let's Encrypt certificate and a port
     forward.** One fewer service, but it is a new open port on the router:
     Jeff's call, and read the forwarding table before adding it.
- **Tier 2** joins your Tailscale network (`deploy/pi/tailscale/setup-tailscale.sh`;
  the auth key is typed at setup and never stored), so the cockpit, settings,
  `/truck` and the cameras open from your phone exactly as on the dash, with
  no ports opened anywhere. Cameras stream as WebRTC through go2rtc on the Pi
  (low latency, low data), MSE as the fallback.
- **The Truck page** `/truck` (served by the brain; also embeddable in WOPR and
  HA as an iframe): map with the truck's last position, charge/12V/cabin, last
  seen, alerts, relay buttons, **Wake & view cameras**, dashcam clips. It needs
  the remote token: open the link from `/settings > Remote` once per phone (it
  sets a cookie), or keep `?token=…` in an iframe URL. The cockpit on the bar
  itself (loopback) needs no token. `REMOTE_TRUSTED_NETS` adds networks.
- **While the Pi sleeps** the Truck page can't load (it is served by the Pi).
  HA's **Slate Watch** device (MQTT discovery from the watch) shows the last
  position, 12V, cabin and the **Wake Pi** button; wake it there, wait for the
  next check-in and the boot, then open `/truck`.

### Wake & view, end to end

1. HA's *Wake Pi* button publishes `{"pi":"wake"}` to `slate/watch/command` (QoS 1).
2. The watch gets it at its next check-in (≤ the interval, 10 min by default;
   send `{"interval_s":120}` beforehand if you'll want it fast), raises the
   wake line and tells the truck box `W1`.
3. The power board powers the Pi; the brain starts (~30–60 s), sees ignition
   off, and counts the wake as **remote**.
4. Tailscale comes up over the LTE modem (or home Wi-Fi); open `/truck`, tap
   **Wake & view cameras**. Each open stream and each page heartbeat counts as
   a viewer.
5. With no viewer for `sleepAfterMin` (or after `maxAwakeMin` in all), the
   brain publishes `{"pi":"sleep"}`, then runs `systemctl poweroff` (allowed by
   `deploy/pi/power/51-slate-power.rules`). The watch drops the line; the power
   board cuts 5 V after its own delay. Never while the ignition is on, never
   while a clip is still being cut.

### Tier 1 alerts into phone pushes (HA automation)

The watch publishes its alerts to `slate/watch/alert`; HA turns them into pushes:

```yaml
automation:
  - alias: Slate watch alert
    trigger:
      - platform: mqtt
        topic: slate/watch/alert
    action:
      - service: notify.mobile_app_jeffs_iphone
        data:
          title: "{{ trigger.payload_json.title }}"
          message: "{{ trigger.payload_json.message }}"
          data:
            tag: "slate-{{ trigger.payload_json.kind }}"
            push: { interruption-level: time-sensitive }
```

Owners without HA set `NTFY_HOST`/`NTFY_TOPIC` in the watch's `secrets.h`: it
then posts each alert to ntfy over HTTPS itself.

## Cameras

- **Pipeline (Pi):** go2rtc reads each camera once (`ffmpeg:device?video=…`,
  H.264; the Pi 4 encodes in hardware, the Pi 5 has no encoder and uses x264)
  and serves WebRTC/MSE to every viewer; the brain records from go2rtc's RTSP.
  The brain writes `go2rtc.yaml` from `/settings > Cameras` and runs go2rtc
  itself (pinned 1.9.9, installed by `deploy/pi/install.sh`). Browsers never
  reach go2rtc's API: the brain proxies its WebSocket (`/api/cams/ws`) and
  player scripts (`/go2rtc/*`), so the remote token covers them. WebRTC media
  goes to go2rtc's port 8555 directly (LAN and Tailscale).
- **Sources:** USB UVC webcams, and USB composite/AHD capture sticks (UVC too):
  the 360° kit's stitched output, and the Slate's own analog backup camera
  through a passive splitter before the cluster (`docs/forum-findings.md` §6:
  reportedly NTSC, 75 Ω). Up to 4 plus the 360 view. Name devices by
  `/dev/v4l/by-id/…` so they keep their place.
- **Cams view:** grid or one camera (tap a tile); the rear camera alone, with
  parking guides, while in reverse, back to where you were 3 s after; guides
  per camera, adjustable in settings; a latency badge on each tile (WebRTC:
  jitter buffer + half the round trip; MJPEG: frame time against the brain's clock).
- **Desk mode:** `SIM=1` gives four moving test patterns. With go2rtc on the
  PATH they are `exec:ffmpeg` streams; without it (this Windows desk) the brain
  runs one ffmpeg per camera itself and serves MJPEG that the page draws on a
  canvas (`backend: "fallback"` in `/api/cams`, a "DESK MJPEG" tag in the view).
  The same fallback runs on a Pi where go2rtc isn't installed (no WebRTC, no
  parked motion detection; dashcam still records).

## Dashcam

- Loop recording of the cameras ticked "Dashcam" (default front and rear) into
  one-minute fragmented-MP4 segments on the SSD (`DASHCAM_DIR`, default
  `DATA_DIR/dashcam/loop/<camera>/YYYYMMDD-HHMMSS.mp4`): a segment cut by a
  power loss still plays. Over the size cap (default 64 GB), the oldest
  unlocked segments go first.
- **Save clip:** the last 60 s and the next 30 s of each recorded camera.
  Those segments are locked until the clip is cut (`ffmpeg -c copy`, no
  re-encode) into `clips/`, where nothing is ever deleted automatically.
  Clips list, playback and download on the Cams view and the Truck page.
- **Parked motion:** with the Pi awake and the ignition off, a vibration from
  the truck box's MPU-6050 (`binary_sensor/vibration`), a vibration count from
  the watch, or a scene change on a recorded camera (ffmpeg `scene` score,
  go2rtc backend) saves a 30 s + 30 s clip (at most one every 2 minutes) and
  raises the motion alert.

## Alerts (each can be turned off; threshold, hold and cooldown are settable)

| Alert | Default | Source |
|---|---|---|
| Cabin above a set temperature (pet/kid check) | 95 °F for 60 s, every 30 min | truck box (brain), watch |
| 12V low (parked only) | below 12.0 V for 2 min, every 4 h | truck box / watch; the watch also says when 12V is gone |
| Motion or vibration while parked | every 15 min, with a clip if tier 2 is awake | truck box vibration, watch, camera scene change |
| Moved with no driver phone nearby (theft) | 200 m | brain (HA presence), watch (ignition off) |
| Left a geofence at an unusual hour | off; zones + quiet hours 22:00–06:00 | brain |
| Charging stopped early / finished | target 80 %, stall 10 min | charge level (an estimate until CAN) |
| Unplugged | on | an HA "plugged in" entity, if you name one |
| Tire pressure low | below 30 psi for 60 s | BLE TPMS |
| Truck box offline | 120 min | brain |

Delivery: HA `notify.<service>` first (picked on `/settings > Alerts`), ntfy as
the fallback when HA isn't set up or doesn't answer. Every alert is kept
(`GET /api/alerts`) with where it went or why it didn't. **Send a test alert**
is on the settings page.

## Theft

- **Moved without a driver:** where the truck parks (ignition off) is
  remembered. If it is later more than 200 m away and no driver's phone is at
  the truck (Home Assistant presence: the driver's `person.*`/`device_tracker.*`
  within 150 m, heard in the last 10 minutes, the same test as the driver
  suggestion), that's an alert. With a driver's phone there it is just a drive.
  Without HA, it alerts only when the ignition is off. While the Pi sleeps the
  watch runs the ignition-off half by itself from its own GNSS.
- **AirTag as a cheap backup:** an AirTag (~$29) or a Samsung SmartTag hidden in
  the cab or frunk keeps working if the watch is found and unplugged or its
  antenna is shielded. It reports through any nearby iPhone, needs no power
  from the truck, and lasts a year on a CR2032. Limits: iOS warns a thief's
  iPhone about an unknown AirTag travelling with them after a while, and the
  location is only as fresh as the last passing iPhone. Hide it away from
  metal; note its serial with the truck's papers.

## Parts for this track (prices approximate, Nov 2026)

| Part | Use | ~USD |
|---|---|---|
| **Cameras and capture** | | |
| USB composite/AHD to UVC capture stick ("EasyCAP"-style UVC, or an AHD-to-USB converter that lists UVC/no driver) | the 360 kit's output, or the Slate backup camera via a splitter | 15–40 |
| Passive composite video splitter (BNC/RCA Y, 75 Ω) or a powered 1-in-2-out video distribution amp | share the Slate's backup camera with the cluster; the amp keeps both images at full level | 5 / 25 |
| USB UVC webcam, wide angle, 1080p MJPEG (Arducam/ELP "USB camera module" class), weatherproof housing | front, bed, hitch | 30–60 each |
| AHD 1080p rear/hitch camera (CVBS/AHD switchable) | a second rear view | 20–40 |
| Budget 360° bird-view kit (4 fisheye AHD cams + stitching ECU with AHD/CVBS out) | 360 view, one stitched feed | 300–500 |
| Powered USB 3 hub (5 V 3 A) | cameras + CarPlay dongle without browning out the Pi | 25 |
| SSD space for the dashcam loop | 64 GB of the Pi's SSD by default | 0 (existing) |
| **Tier 1 watch** | | |
| LilyGO T-SIM7080G-S3 | the watch | 40–45 |
| LTE-M/GNSS antennas (the board's, or a combined puck with u.FL leads) | signal from inside the cab | 0–20 |
| 18650 cell, protected | backup if 12V is cut | 8 |
| Low-Iq 12→5 V buck (Pololu D24V5F5) + 1 A fuse tap | power | 8 |
| PC817 opto (wake line), SW-18010P vibration switch, 47k/10k/100 nF | wake, vibration, 12V sense | 3 |
| 1NCE IoT Lite SIM (500 MB over 10 years, prepaid) **or** Hologram Hyper (pay as you go, ~$1/month + data) | Cat-M data | 15 once / ~$1–3 a month |
| Car power board with an ignition input and delayed shutoff (Mausberry Car Supply class) | Pi power, IGN = truck ignition OR watch | 25–45 |
| **Tier 2 Pi over LTE** | | |
| Quectel EG25-G (or EC25-AF) USB dongle/mini-PCIe + USB adapter, with two LTE antennas | Cat-4 data for the cameras | 60–90 |
| Data SIM with real data (T-Mobile/AT&T prepaid data, or a data-only MVNO) | 5 minutes of 720p WebRTC ≈ 20–40 MB | 10–25 a month |
| Tailscale (personal plan) | remote access, no open ports | 0 |
| **Backup** | | |
| Apple AirTag (or Samsung SmartTag2) | hidden tracker if the watch is found | 29 |

## Cost

Tier 1 ~$100 with the power board and parts (~$45 for the board), IoT SIM ~$15
one-off (1NCE) to a few $/month. Tier 2 modem ~$60–90 plus a data plan.
Cameras: ~$120 for rear + hitch, ~$350–550 with a budget 360 kit.

## Unknowns

- Whether the Slate keeps its 12V battery charged while parked (decides how
  much tier 2 can run). Check at delivery; the truck box and the watch log
  voltage overnight.
- Cat-M coverage where the truck is parked (T-Mobile/AT&T both carry it in Phoenix).
- The Slate backup camera's signal (NTSC composite per one forum dataminer) and
  whether a passive splitter leaves the cluster's image intact: verify on a
  delivered truck before cutting anything.
- Every SIM7080G AT sequence in the watch, and the parked current, until the
  board is on the bench.
- Whether go2rtc's x264 on a Pi 5 keeps up with four 720p cameras plus
  recording (a Pi 4 has the hardware encoder; lower resolution or fewer
  recorded cameras are the levers).
