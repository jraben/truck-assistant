// Which PCM format and which output stream a dongle audio packet belongs to,
// and how loud each stream plays. Pure, so vitest covers it.
import { AudioCommand, decodeTypeMap } from './vendor/node-carplay/modules/messages/readable.js';

export type PcmFormat = { sampleRate: number; channels: number };
/** media: music/podcasts. nav: Waze/Maps prompts and alerts. voice: Siri and calls. */
export type Role = 'media' | 'nav' | 'voice';

/** decodeType -> sample rate and channels, per the dongle's table. Null for an unknown type (dropped, not guessed). */
export function pcmFormat(decodeType: number): PcmFormat | null {
  const f = (decodeTypeMap as Record<number, { frequency: number; channel: number; bitrate: number } | undefined>)[decodeType];
  if (!f || f.bitrate !== 16) return null;
  return { sampleRate: f.frequency, channels: f.channel };
}

/**
 * The output stream for a packet. audioType 2 is the dongle's auxiliary
 * channel (navigation, alerts); narrow-band mono (8/16 kHz, decodeType 3 or 5)
 * is telephony: Siri and calls. Everything else is media.
 */
export function roleFor(decodeType: number, audioType: number): Role {
  if (audioType === 2) return 'nav';
  const f = pcmFormat(decodeType);
  if (f && f.channels === 1 && f.sampleRate <= 16000) return 'voice';
  return 'media';
}

/** One player per distinct format+channel: a stream never changes rate mid-flight. */
export const streamKey = (decodeType: number, audioType: number) => `${decodeType}_${audioType}`;

/** What the dongle has said is going on, from AudioData commands and volume hints. */
export type MixState = {
  navActive: boolean;
  voiceActive: boolean;
  /** The dongle's own ducking hint for media (AudioData.volume with volumeDuration), 0..1. */
  mediaHint: number | null;
};

export const initialMix = (): MixState => ({ navActive: false, voiceActive: false, mediaHint: null });

/** Apply an AudioCommand to the mix. Returns whether the mic should be open after it (null = unchanged). */
export function applyAudioCommand(m: MixState, cmd: number): { mix: MixState; mic: boolean | null } {
  switch (cmd) {
    case AudioCommand.AudioNaviStart: return { mix: { ...m, navActive: true }, mic: null };
    case AudioCommand.AudioNaviStop: return { mix: { ...m, navActive: false, mediaHint: null }, mic: null };
    case AudioCommand.AudioSiriStart:
    case AudioCommand.AudioPhonecallStart: return { mix: { ...m, voiceActive: true }, mic: true };
    case AudioCommand.AudioSiriStop:
    case AudioCommand.AudioPhonecallStop: return { mix: { ...m, voiceActive: false }, mic: false };
    default: return { mix: m, mic: null };
  }
}

/** Without a hint from the dongle, nav prompts duck music to this. */
export const NAV_DUCK = 0.4;

/** Target gain per role. Siri and calls silence media; nav ducks it, by the dongle's hint when it sends one. */
export function gains(m: MixState): Record<Role, number> {
  let media = 1;
  if (m.voiceActive) media = 0;
  else if (m.mediaHint !== null) media = Math.max(0, Math.min(1, m.mediaHint));
  else if (m.navActive) media = NAV_DUCK;
  return { media, nav: 1, voice: 1 };
}
