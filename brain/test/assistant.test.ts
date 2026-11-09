import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistantName, defaultAssistant, isLocalUrl } from '../src/assistant/types.ts';
import { AssistantService } from '../src/assistant/service.ts';
import { AssistantError } from '../src/assistant/providers.ts';
import { MediaSettingsStore, maskMedia, mergeMedia, defaultMediaSettings } from '../src/media/settings.ts';
import { WoprService } from '../src/wopr/service.ts';
import type { HaClient } from '../src/ha/client.ts';
import type { State } from '../src/types.ts';

const state = (link = 'home') => ({ driver: { id: 'jeff', name: 'Jeff', initials: 'J', color: '#000' }, network: { link }, gps: null, place: null, speedMph: 0, soc: 60, socSource: 'can', rangeMi: 120, nowPlaying: null, chargePeak: null } as unknown as State);

function setup(link = 'home', ha: Partial<HaClient> = {}) {
  const media = new MediaSettingsStore(mkdtempSync(path.join(tmpdir(), 'asst-')));
  const brain = { getState: () => state(link), on: () => {}, off: () => {} };
  const wopr = new WoprService(brain, media);
  const haClient = { configured: () => true, converse: async () => ({ speech: 'The garage is closed.', conversationId: 'c1' }), ...ha } as unknown as HaClient;
  return { media, svc: new AssistantService(wopr, media, haClient, brain) };
}

async function collect(gen: AsyncGenerator<{ t: string; v?: string; message?: string }>) {
  let text = ''; let error: string | null = null;
  for await (const ev of gen) { if (ev.t === 'text') text += ev.v; if (ev.t === 'error') error = ev.message ?? 'error'; }
  return { text, error };
}

afterEach(() => vi.unstubAllGlobals());

describe('assistant settings', () => {
  it('defaults to WOPR, and names each choice for the voice button', () => {
    const a = defaultAssistant();
    expect(a.provider).toBe('wopr');
    expect(assistantName(a)).toBe('WOPR');
    expect(assistantName({ ...a, provider: 'claude' })).toBe('Claude');
    expect(assistantName({ ...a, provider: 'openai', openai: { ...a.openai, preset: 'gemini' } })).toBe('Gemini');
    expect(assistantName({ ...a, provider: 'homeassistant' })).toBe('Assist');
  });

  it('keeps keys write-only: masked back, kept on a masked save, removed on empty', () => {
    let s = mergeMedia(defaultMediaSettings(), { assistant: { provider: 'claude', claude: { apiKey: 'sk-ant-secret-1234' } } });
    expect(s.assistant.claude.apiKey).toBe('sk-ant-secret-1234');
    const masked = maskMedia(s).assistant.claude.apiKey!;
    expect(masked).toMatch(/1234$/);
    expect(masked).not.toContain('secret');
    s = mergeMedia(s, { assistant: { claude: { apiKey: masked } } });
    expect(s.assistant.claude.apiKey).toBe('sk-ant-secret-1234');
    s = mergeMedia(s, { assistant: { claude: { apiKey: '' } } });
    expect(s.assistant.claude.apiKey).toBeUndefined();
  });

  it('refuses bad values', () => {
    expect(() => mergeMedia(defaultMediaSettings(), { assistant: { provider: 'siri' } })).toThrow(/provider/);
    expect(() => mergeMedia(defaultMediaSettings(), { assistant: { claude: { model: 'gpt-x' } } })).toThrow(/Claude model id/);
    expect(() => mergeMedia(defaultMediaSettings(), { assistant: { voice: { tts: 'radio' } } })).toThrow(/tts/);
  });

  it('knows a home-network address', () => {
    expect(isLocalUrl('http://192.168.1.30:11434/v1')).toBe(true);
    expect(isLocalUrl('http://localhost:1234/v1')).toBe(true);
    expect(isLocalUrl('https://api.openai.com/v1')).toBe(false);
  });
});

describe('assistant service', () => {
  it('says what is missing before trying', () => {
    const { media, svc } = setup();
    media.update({ assistant: { provider: 'claude' } });
    expect(svc.status()).toMatchObject({ name: 'Claude', configured: false });
    expect(svc.status().message).toMatch(/Claude API key/);
    media.update({ assistant: { provider: 'openai', openai: { preset: 'openai', model: '' } } });
    expect(svc.status().message).toMatch(/model name/);
  });

  it('blocks a cloud service offline, but not a model on the home network', () => {
    const { media, svc } = setup('offline');
    media.update({ assistant: { provider: 'openai', openai: { preset: 'openai', model: 'some-model', apiKey: 'k' } } });
    expect(svc.status().message).toMatch(/needs the internet/);
    media.update({ assistant: { openai: { preset: 'ollama', baseUrl: 'http://192.168.1.30:11434/v1', model: 'llama' } } });
    expect(svc.status()).toMatchObject({ configured: true, online: true, message: null });
  });

  it('streams an OpenAI-compatible answer, with the truck as the system prompt and no WOPR context', async () => {
    const { media, svc } = setup();
    media.update({ assistant: { provider: 'openai', openai: { preset: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'm', apiKey: 'k' } } });
    let sent: { model: string; messages: { role: string; content: string }[] } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      const body = 'data: {"choices":[{"delta":{"content":"About "}}]}\n\ndata: {"choices":[{"delta":{"content":"120 miles."}}]}\n\ndata: [DONE]\n\n';
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }));
    const r = await collect(svc.chat('How far can I go?', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello.' }]));
    expect(r).toEqual({ text: 'About 120 miles.', error: null });
    expect(sent!.messages[0].role).toBe('system');
    expect(sent!.messages[0].content).toMatch(/Slate truck/);
    expect(sent!.messages[0].content).toMatch(/Battery: 60%/);
    expect(sent!.messages[0].content).not.toMatch(/Jeff is talking/);
    expect(sent!.messages.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent!.messages.at(-1)!.content).toBe('How far can I go?');
  });

  it('words a refused key as a settings problem', async () => {
    const { media, svc } = setup();
    media.update({ assistant: { provider: 'openai', openai: { preset: 'openai', model: 'm', apiKey: 'bad' } } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })));
    expect((await collect(svc.chat('hi', []))).error).toMatch(/refused the API key/);
  });

  it('asks Home Assistant Assist and keeps its conversation going', async () => {
    const seen: (string | null | undefined)[] = [];
    const { media, svc } = setup('home', { converse: async (_t: string, o?: { conversationId?: string | null }) => { seen.push(o?.conversationId); return { speech: 'The garage is closed.', conversationId: 'c1' }; } } as Partial<HaClient>);
    media.update({ assistant: { provider: 'homeassistant' } });
    expect((await collect(svc.chat('Is the garage open?', []))).text).toBe('The garage is closed.');
    await collect(svc.chat('And the front door?', []));
    expect(seen).toEqual([null, 'c1']);
  });

  it('leaves speech to the tablet when chosen', async () => {
    const { media, svc } = setup();
    media.update({ assistant: { voice: { tts: 'tablet' } } });
    expect(svc.status().tabletVoice).toBe(true);
    await expect(svc.tts('hello')).rejects.toBeInstanceOf(AssistantError);
    await expect(svc.tts('hello')).rejects.toMatchObject({ status: 501 });
  });
});
