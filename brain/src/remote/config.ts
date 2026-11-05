// Track C process plumbing (env only; everything a person sets is in remote.json via /settings).
import path from 'node:path';
import { config } from '../config.ts';

const flag = (v: string | undefined) => v === '1' || v === 'true' || v === 'yes';

export const remoteConfig = {
  /** go2rtc binary. install.sh puts the pinned release at /usr/local/bin/go2rtc. Missing = desk fallback. */
  go2rtcBin: process.env.GO2RTC_BIN ?? 'go2rtc',
  /** go2rtc's API. Loopback only: browsers reach it through the brain (/api/cams/ws, /go2rtc/*). */
  go2rtcApi: process.env.GO2RTC_API ?? '127.0.0.1:1984',
  go2rtcRtsp: process.env.GO2RTC_RTSP ?? '127.0.0.1:8554',
  /** WebRTC media (ICE). Must be reachable from viewers: LAN and Tailscale. */
  go2rtcWebrtc: process.env.GO2RTC_WEBRTC ?? ':8555',
  /** GO2RTC_EXTERNAL=1: go2rtc is run by someone else (systemd unit): write the config, don't spawn it. */
  go2rtcExternal: flag(process.env.GO2RTC_EXTERNAL),
  ffmpegBin: process.env.FFMPEG_BIN ?? 'ffmpeg',
  /** Loop recording and clips. On the Pi this is the SSD (the data dir lives there). */
  dashcamDir: path.resolve(process.env.DASHCAM_DIR ?? path.join(config.dataDir, 'dashcam')),
  camsDisabled: flag(process.env.CAMS_DISABLED),
  /** How the brain turns the Pi off after a remote wake. Empty = never (log only). SIM never powers off. */
  poweroffCmd: process.env.POWEROFF_CMD ?? (process.platform === 'linux' ? 'systemctl poweroff' : ''),
  /** Networks allowed to use the remote API without the token. Loopback = the cockpit on the bar itself. */
  trustedNets: (process.env.REMOTE_TRUSTED_NETS ?? '127.0.0.0/8,::1').split(',').map((s) => s.trim()).filter(Boolean),
};
