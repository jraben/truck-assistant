// The voice button's assistant: WOPR, an OpenAI-compatible service, Claude or
// Home Assistant Assist answers; speech in and out comes from WOPR, an
// OpenAI-compatible audio API, or (speech out) the tablet itself. WOPR's own
// extras (calendar, gate codes, mailbox) stay on WoprService whatever is picked.
import type { HaClient } from '../ha/client.ts';
import type { MediaSettingsStore } from '../media/settings.ts';
import { WoprError } from '../wopr/client.ts';
import { buildMessages, type ChatMsg } from '../wopr/primer.ts';
import type { BrainView, ChatEvent, WoprService } from '../wopr/service.ts';
import { AssistantError, chatClaude, chatOpenAI, sttOpenAI, ttsOpenAI } from './providers.ts';
import { assistantName, isLocalUrl, OPENAI_PRESETS, type AssistantSettings } from './types.ts';

/** HA keeps an Assist conversation going this long between turns. */
const HA_THREAD_MS = 5 * 60_000;

export type AssistantStatus = {
  provider: AssistantSettings['provider'];
  name: string;
  configured: boolean;
  online: boolean;
  /** Speech out on the tablet (the browser's own voice) instead of an audio service. */
  tabletVoice: boolean;
  message: string | null;
};

export class AssistantService {
  private haThread: { id: string; at: number } | null = null;

  private wopr: WoprService;
  private media: MediaSettingsStore;
  private ha: HaClient;
  private brain: BrainView;

  constructor(wopr: WoprService, media: MediaSettingsStore, ha: HaClient, brain: BrainView) {
    this.wopr = wopr; this.media = media; this.ha = ha; this.brain = brain;
  }

  settings(): AssistantSettings { return this.media.get().assistant; }

  /** Why it can't answer, or null. */
  private chatBlocked(a = this.settings()): string | null {
    switch (a.provider) {
      case 'wopr': return this.wopr.configured() ? null : 'WOPR isn’t set up: add its address and login on the settings page.';
      case 'claude': return a.claude.apiKey ? null : 'Add a Claude API key on the settings page (Assistant).';
      case 'homeassistant': return this.ha.configured() ? null : 'Connect Home Assistant on the settings page to use Assist.';
      case 'openai': {
        const p = OPENAI_PRESETS.find((x) => x.id === a.openai.preset);
        if (!a.openai.baseUrl || !a.openai.model) return 'Pick the AI service and type a model name on the settings page (Assistant).';
        return p?.needsKey && !a.openai.apiKey ? `Add your ${p.name} API key on the settings page (Assistant).` : null;
      }
    }
  }

  /** A service on the home network or this machine still answers with the truck off the internet. */
  private needsInternet(a = this.settings()): boolean {
    if (a.provider === 'openai') return !isLocalUrl(a.openai.baseUrl);
    if (a.provider === 'homeassistant') return false;   // HA's own URL decides; it fails with its own message
    return true;
  }

  private online(): boolean { return this.brain.getState().network?.link !== 'offline'; }

  status(): AssistantStatus {
    const a = this.settings();
    const why = this.chatBlocked(a);
    const off = !this.online() && this.needsInternet(a);
    return {
      provider: a.provider, name: assistantName(a), configured: !why, online: !off, tabletVoice: a.voice.tts === 'tablet',
      message: why ?? (off ? `${assistantName(a)} needs the internet: the truck is offline. Join home Wi-Fi or turn on a phone hotspot.` : null),
    };
  }

  /** Settings page "Test": one short real turn. */
  async test(): Promise<{ ok: boolean; message: string }> {
    const a = this.settings();
    if (a.provider === 'wopr') { const r = await this.wopr.test(); return { ok: r.ok, message: r.message }; }
    const why = this.chatBlocked(a);
    if (why) return { ok: false, message: why };
    let reply = '';
    for await (const ev of this.chat('Reply with just the word OK.', [])) {
      if (ev.t === 'text') reply += ev.v;
      if (ev.t === 'error') return { ok: false, message: ev.message };
    }
    return { ok: true, message: `${assistantName(a)} answered: “${reply.trim().slice(0, 80) || '(nothing)'}”` };
  }

  /** One voice turn, as NDJSON events (same shape as WOPR's). */
  async *chat(question: string, history: ChatMsg[], signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const a = this.settings();
    if (a.provider === 'wopr') { yield* this.wopr.chat(question, history, signal); return; }
    const st = this.status();
    if (st.message) { yield { t: 'error', message: st.message, kind: st.configured ? 'offline' : 'not-configured' }; return; }
    try {
      if (a.provider === 'homeassistant') {
        const thread = this.haThread && Date.now() - this.haThread.at < HA_THREAD_MS ? this.haThread.id : null;
        const r = await this.ha.converse(question, { agentId: a.homeassistant.agentId, conversationId: thread });
        if (r.conversationId) this.haThread = { id: r.conversationId, at: Date.now() };
        yield { t: 'text', v: r.speech || 'Assist had nothing to say.' };
        yield { t: 'done' };
        return;
      }
      // The truck's live state as the system prompt (no WOPR context: that stays with WOPR), then the conversation.
      const system = await this.wopr.primer(this.brain.getState().driver?.name ?? null, true);
      const msgs = buildMessages('', history, question).slice(2);
      const gen = a.provider === 'claude' ? chatClaude(a.claude, system, msgs, signal) : chatOpenAI(a.openai, system, msgs, signal);
      for await (const t of gen) yield { t: 'text', v: t };
      yield { t: 'done' };
    } catch (e) {
      if (signal?.aborted) return;
      yield { t: 'error', message: (e as Error).message, kind: e instanceof AssistantError ? e.kind : 'http' };
    }
  }

  async stt(audio: Buffer, mime: string): Promise<{ text: string }> {
    const v = this.settings().voice;
    if (v.stt === 'wopr') return this.wopr.stt(audio, mime);
    return sttOpenAI(v, audio, mime);
  }

  /** One sentence of speech; with the tablet's voice there is nothing to fetch (the route answers 501 and the page speaks it). */
  async tts(text: string): Promise<Response> {
    const v = this.settings().voice;
    if (v.tts === 'tablet') throw new AssistantError('not-configured', 'Speech is spoken by the tablet.', 501);
    if (v.tts === 'wopr') return this.wopr.tts(text);
    return ttsOpenAI(v, text);
  }
}

export { AssistantError, WoprError };
