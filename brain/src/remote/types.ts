// Track C: cameras, dashcam, the always-on watch, alerts, the Truck page.
// Shapes for docs/contract.md "Track C: Cameras and remote". Pure types.

export type CamRole = 'rear' | 'front' | 'bed' | 'hitch' | '360' | 'cabin' | 'other';

/**
 * One camera. `source` says how go2rtc (or the desk fallback) reads it:
 * - uvc: a USB webcam (V4L2), `device` = /dev/v4l/by-id/... (stable) or /dev/videoN
 * - capture: a USB composite/AHD capture stick (also UVC), fed by the 360 kit's
 *   stitched output or the Slate's own analog backup camera through a splitter
 * - rtsp: anything go2rtc can already read (`url`)
 * - test: a moving test pattern (ffmpeg testsrc2), for desks and bench checks
 */
export type CameraConfig = {
  id: string;                       // lowercase, digits, "-" / "_": the go2rtc stream name
  name: string;                     // "Rear"
  role: CamRole;
  source: 'uvc' | 'capture' | 'rtsp' | 'test';
  device: string | null;            // uvc / capture
  url: string | null;               // rtsp
  width: number; height: number; fps: number;
  inputFormat: 'mjpeg' | 'yuyv422' | 'auto';  // what the UVC device delivers (most sticks: yuyv422 at 720x480)
  enabled: boolean;
  record: boolean;                  // dashcam loop
  guides: boolean;                  // draw parking guides on this camera
  mirror: boolean;                  // flip left/right (backup cams are usually mirrored already)
};

export type GuideSettings = {
  /** 0..1 of the frame width: where the lines meet the bottom edge / converge at the top. */
  bottomWidth: number; topWidth: number;
  /** 0..1 of the frame height: the top of the guides, and the three distance bands. */
  top: number; bands: [number, number, number];
  offsetX: number;                  // -0.5..0.5, centre shift for an off-centre camera
};

export type RemoteSettings = {
  cams: {
    cameras: CameraConfig[];
    guides: GuideSettings;
    autoRear: boolean;              // switch to the rear camera on reverse
    defaultLayout: 'grid' | 'single';
  };
  dashcam: {
    enabled: boolean;
    segmentSec: number;             // 10..600, default 60
    capGb: number;                  // loop size on the SSD; oldest unlocked segments go first
    preSec: number;                 // "save clip": seconds before the tap (60)
    postSec: number;                // and after (30)
    parkedMotion: boolean;          // record a clip on motion while parked (Pi awake)
    sceneThreshold: number;         // ffmpeg scene score 0..1 that counts as motion (0.12)
  };
  alerts: AlertSettings;
  power: {
    sleepAfterMin: number;          // Pi goes back to sleep after N minutes with no viewer (remote wake only)
    maxAwakeMin: number;            // hard limit for a remote wake, viewers or not (0 = none)
  };
  lte: { apn: string; user: string | null; password?: string };   // tier 2 Cat-4 modem (password masked)
  watch: { prefix: string };        // tier 1 MQTT prefix, default "<truckId>/watch"
  remote: { token?: string };       // the Truck page / remote API token (masked)
};

export type AlertKind =
  | 'cabinHot' | 'low12v' | 'motionParked' | 'theft' | 'geofence'
  | 'chargeStopped' | 'chargeDone' | 'unplugged' | 'tirePressure' | 'truckboxOffline'
  | 'chargingPeak' | 'peakSoon';     // home charging inside an on-peak (alert) TOU period / plugged in just before one

export type AlertRule = {
  enabled: boolean;
  threshold: number | null;         // °F, V, psi, minutes, metres: see ALERT_META
  holdSec: number;                  // condition must hold this long (debounce)
  cooldownMin: number;              // then no repeat for this long
};

export type AlertSettings = {
  rules: Record<AlertKind, AlertRule>;
  geofence: { zones: { name: string; lat: number; lon: number; radiusM: number }[]; quietStart: string; quietEnd: string };  // "unusual hour" = inside quietStart..quietEnd
  chargeTargetSoc: number;          // a charge that stops below this is "stopped early"
  chargerPlugEntity: string | null; // optional HA binary_sensor: the wall charger's "plugged in" (for Unplugged)
  delivery: {
    ha: { service: string | null }; // e.g. "notify.mobile_app_jeffs_iphone" (HA URL + token come from the main settings)
    ntfy: { server: string; topic: string | null; token?: string };   // fallback for owners without HA
  };
};

export type Alert = {
  id: number;
  at: string;
  kind: AlertKind;
  title: string; message: string;
  source: 'brain' | 'watch';        // watch = tier 1 sent it while the Pi slept
  delivered: string[];              // ["ha", "ntfy"]; [] = nowhere configured or failed
  error: string | null;
};

export type Clip = {
  id: string;                       // "20271104-221503-rear"
  camera: string;
  startedAt: string; durationS: number;
  reason: 'manual' | 'motion';
  bytes: number;
  state: 'recording' | 'ready' | 'error';
  error: string | null;
};

export type CamStatus = {
  backend: 'go2rtc' | 'fallback' | 'off';
  why: string | null;               // e.g. "go2rtc not installed: desk fallback (MJPEG from ffmpeg)"
  ffmpeg: boolean;
  cameras: (CameraConfig & { live: boolean; error: string | null })[];
  recording: { enabled: boolean; cameras: string[]; bytes: number; capBytes: number; segments: number; locked: number; error: string | null };
  guides: GuideSettings;
  autoRear: boolean;
  defaultLayout: 'grid' | 'single';
};

/** Tier 1: what the watch board last said (its own GPS, 12V, the truck box over UART). */
export type WatchStatus = {
  online: boolean;                  // MQTT birth/will
  lastSeen: string | null;
  lat: number | null; lon: number | null; fix: boolean; gpsAt: string | null;
  aux12v: number | null; cabinTempF: number | null;
  vibration: number | null;         // vibration events since the last report
  moved: boolean | null;            // the watch thinks the truck moved while parked
  ignition: boolean | null;
  piAwake: boolean | null;
  rssi: number | null;              // modem signal, dBm
  backupMv: number | null;          // the watch's own 18650, mV
  fw: string | null;
};

export type PowerStatus = {
  awakeReason: 'ignition' | 'remote' | 'unknown';
  viewers: number;
  sleepAt: string | null;           // when the Pi will go back to sleep, if nothing changes
  sleeping: boolean;                // shutdown requested
  why: string;                      // "Driving", "2 viewers", "Sleeps at 22:41 (no viewers)"
};

/** GET /api/truck: everything the Truck page shows, in one call. */
export type TruckSnapshot = {
  ts: string;
  truckId: string;
  position: { lat: number; lon: number; at: string | null; source: 'gps' | 'watch' } | null;
  soc: number | null; rangeMi: number | null;
  aux12v: number | null; cabinTempF: number | null;
  ignition: boolean | null; gear: string | null; speedMph: number | null;
  truckbox: boolean;
  relays: Record<string, { name: string; on: boolean | null }>;
  lastSeen: string;                 // the brain is answering, so: now (the watch's lastSeen is in watch)
  watch: WatchStatus;
  power: PowerStatus;
  alerts: Alert[];
  clips: Clip[];
  place: { name: string | null; since: string } | null;
};
