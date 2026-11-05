// The CarPlay worker: owns the Carlinkit dongle over WebUSB and runs
// node-carplay's CarplayWeb, so USB reads never wait on the UI thread.
// Video, audio and media go to the main thread with their buffers transferred.
import './polyfills.ts';
import CarplayWeb, { findDevice, isCarplayDongle } from './vendor/node-carplay/web/CarplayWeb.js';
import type { CarplayMessage } from './vendor/node-carplay/web/CarplayWeb.js';
import { CommandMapping, FileAddress, Opened, SendAudio, SendBoolean, SendCommand, SendTouch } from './vendor/node-carplay/modules/index.js';
import type { DongleConfig } from './vendor/node-carplay/modules/DongleDriver.js';
import type { FromWorker, Status, ToWorker } from './protocol.ts';

const scope = self as unknown as {
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  addEventListener(t: 'message', f: (e: MessageEvent<ToWorker>) => void): void;
};

const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 30_000;

let cp: CarplayWeb | null = null;
let config: Partial<DongleConfig> = {};
let wanted = false;      // the page asked for CarPlay (start without a stop since)
let busy = false;        // a start is in progress
let night = false;
let backoff = BACKOFF_MIN;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let micPort: MessagePort | null = null;

const post = (m: FromWorker, transfer?: Transferable[]) => {
  try { scope.postMessage(m, transfer); }
  catch { scope.postMessage(m); } // a buffer that can't be transferred is copied instead
};
const status = (s: Status, reason?: string, retryInMs?: number) => post({ type: 'status', status: s, reason, retryInMs });
const log = (level: 'info' | 'warn' | 'error', message: string) => post({ type: 'log', level, message });

function send(msg: Parameters<CarplayWeb['dongleDriver']['send']>[0]) {
  if (!cp) return;
  void cp.dongleDriver.send(msg).catch(() => {});
}

async function teardown() {
  const c = cp;
  cp = null;
  if (!c) return;
  c.onmessage = null;
  try { c.dongleDriver.removeAllListeners('message'); } catch { /* ignore */ }
  try { await c.stop(); } catch { /* already closed */ }
}

function scheduleRetry(reason: string) {
  if (!wanted) return;
  if (retryTimer) clearTimeout(retryTimer);
  const wait = backoff;
  backoff = Math.min(backoff * 2, BACKOFF_MAX);
  status('failed', reason, wait);
  retryTimer = setTimeout(() => { retryTimer = null; void start(); }, wait);
}

async function fail(reason: string) {
  log('error', `CarPlay: ${reason}`);
  await teardown();
  scheduleRetry(reason);
}

function onMessage(m: CarplayMessage) {
  switch (m.type) {
    case 'plugged':
      backoff = BACKOFF_MIN;
      post({ type: 'plugged', phoneType: (m as { message?: { phoneType?: number } }).message?.phoneType ?? 3 });
      status('connected');
      break;
    case 'unplugged':
      post({ type: 'unplugged' });
      status('waiting-phone');
      break;
    case 'video': {
      const v = m.message;
      const d = v.data as unknown as Uint8Array;
      post({ type: 'video', buf: d.buffer as ArrayBuffer, offset: d.byteOffset, length: d.byteLength, width: v.width, height: v.height }, [d.buffer as ArrayBuffer]);
      break;
    }
    case 'audio': {
      const a = m.message;
      if (a.data) {
        const d = a.data;
        post({ type: 'audio', buf: d.buffer as ArrayBuffer, offset: d.byteOffset, length: d.byteLength, decodeType: a.decodeType, audioType: a.audioType }, [d.buffer as ArrayBuffer]);
      } else {
        post({ type: 'audioCtl', decodeType: a.decodeType, audioType: a.audioType, command: a.command, volume: a.volume, volumeDuration: a.volumeDuration });
      }
      break;
    }
    case 'media':
      post({ type: 'media', payload: m.message.payload });
      break;
    case 'command':
      post({ type: 'command', value: m.message.value });
      break;
    case 'failure':
      void fail('the dongle stopped answering (USB read errors)');
      break;
  }
}

async function start() {
  if (!wanted || cp || busy) return;
  if (!('usb' in navigator) || !navigator.usb) { status('no-webusb'); return; }
  busy = true;
  try {
    const device = await findDevice();
    if (!device) { status('no-dongle'); return; }
    status('connecting');
    const c = new CarplayWeb({ ...config, nightMode: night });
    cp = c;
    c.onmessage = onMessage;
    // CarplayWeb doesn't forward Opened (what the dongle accepted); listen on the driver.
    c.dongleDriver.on('message', (msg: unknown) => {
      if (msg instanceof Opened) post({ type: 'opened', width: msg.width, height: msg.height, fps: msg.fps });
    });
    try {
      await c.start(device);
    } catch (e) {
      const err = e as Error;
      const why = err?.name === 'SecurityError' || /access denied/i.test(err?.message ?? '')
        ? `access to the dongle was refused (${err.message}). On the Pi: the udev rule and Chromium policy from deploy/pi/install.sh`
        : `could not open the dongle: ${err?.message ?? String(e)}`;
      await fail(why);
      return;
    }
    if (cp === c) status('waiting-phone');
  } finally {
    busy = false;
  }
}

async function stop() {
  wanted = false;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  await teardown();
}

// Dongle plugged in or pulled out while the page runs.
if ('usb' in navigator && navigator.usb) {
  navigator.usb.addEventListener('connect', (e: USBConnectionEvent) => {
    if (!isCarplayDongle(e.device) || cp) return;
    backoff = BACKOFF_MIN;
    void start();
  });
  navigator.usb.addEventListener('disconnect', (e: USBConnectionEvent) => {
    if (!isCarplayDongle(e.device)) return;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    void teardown().then(() => { post({ type: 'unplugged' }); status('no-dongle', 'the dongle was unplugged'); });
  });
}

scope.addEventListener('message', (e) => {
  const m = e.data;
  switch (m.type) {
    case 'start':
      config = m.config;
      wanted = true;
      backoff = BACKOFF_MIN;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      // A start with a new config (size, fps) replaces a running session.
      void teardown().then(start);
      break;
    case 'stop':
      void stop();
      break;
    case 'touch':
      send(new SendTouch(Math.round(m.x * 10000) / 10000, Math.round(m.y * 10000) / 10000, m.action));
      break;
    case 'night':
      if (m.on === night) break;
      night = m.on;
      send(new SendBoolean(night, FileAddress.NIGHT_MODE));
      send(new SendCommand(night ? 'enableNightMode' : 'disableNightMode'));
      break;
    case 'frame':
      send(new SendCommand('frame'));
      break;
    case 'key':
      if (m.command in CommandMapping && Number.isNaN(Number(m.command))) send(new SendCommand(m.command as keyof typeof CommandMapping));
      break;
    case 'micPort':
      micPort?.close();
      micPort = m.port;
      micPort.onmessage = (ev: MessageEvent<Int16Array>) => { if (cp && ev.data?.length) send(new SendAudio(ev.data)); };
      break;
  }
});
