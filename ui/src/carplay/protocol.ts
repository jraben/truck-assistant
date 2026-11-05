// Messages between the main thread and the CarPlay worker (carplay.worker.ts).
import type { DongleConfig } from './vendor/node-carplay/modules/DongleDriver.js';

export type Status =
  | 'no-webusb'      // this browser has no WebUSB (not Chromium, or not a secure context)
  | 'no-dongle'      // WebUSB works, no Carlinkit dongle granted / plugged in
  | 'connecting'     // opening the dongle
  | 'waiting-phone'  // dongle up, phone not connected yet
  | 'connected'      // CarPlay session running
  | 'failed';        // see reason; the worker retries with backoff

export type ToWorker =
  | { type: 'start'; config: Partial<DongleConfig> }
  | { type: 'stop' }
  | { type: 'touch'; x: number; y: number; action: number }
  | { type: 'night'; on: boolean }
  | { type: 'frame' }                       // ask the phone for a keyframe
  | { type: 'key'; command: string }         // a SendCommand name, e.g. 'home', 'siri'
  | { type: 'micPort'; port: MessagePort };  // Int16 16 kHz PCM from WebMicrophone arrives here

export type FromWorker =
  | { type: 'status'; status: Status; reason?: string; retryInMs?: number }
  | { type: 'opened'; width: number; height: number; fps: number }
  | { type: 'plugged'; phoneType: number }
  | { type: 'unplugged' }
  /** One H.264 Annex-B access unit: bytes [offset, offset + length) of buf. */
  | { type: 'video'; buf: ArrayBuffer; offset: number; length: number; width: number; height: number }
  /** Interleaved Int16 PCM: samples [offset/2, offset/2 + length/2) of buf. */
  | { type: 'audio'; buf: ArrayBuffer; offset: number; length: number; decodeType: number; audioType: number }
  | { type: 'audioCtl'; decodeType: number; audioType: number; command?: number; volume?: number; volumeDuration?: number }
  | { type: 'media'; payload: unknown }
  | { type: 'command'; value: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };
