// Which AI answers the dash's voice button, and how speech gets in and out.
// Pure (no Node APIs): the settings page imports the presets and names too.
//
// WOPR stays the default and keeps its extras (calendar, gate codes, mailbox)
// whatever answers the voice turn: those are WOPR features, not chat.

export type AssistantProvider = 'wopr' | 'openai' | 'claude' | 'homeassistant';

export type AssistantSettings = {
  provider: AssistantProvider;
  /** Any OpenAI-compatible chat API: ChatGPT, Gemini, Groq, OpenRouter, Ollama, LM Studio... */
  openai: { preset: string; baseUrl: string; model: string; apiKey?: string };
  /** Claude, through Anthropic's API. */
  claude: { model: string; apiKey?: string };
  /** Home Assistant Assist (uses the HA URL and token already on the settings page). */
  homeassistant: { agentId: string | null };
  /** Speech in and out: WOPR's (Groq Whisper + Cartesia), any OpenAI-compatible audio API, or the tablet's own voice for speech out. */
  voice: { stt: 'wopr' | 'openai'; tts: 'wopr' | 'openai' | 'tablet'; baseUrl: string; apiKey?: string; sttModel: string; ttsModel: string; ttsVoice: string };
};

export type OpenAiPreset = { id: string; name: string; short: string; baseUrl: string; needsKey: boolean; keyUrl: string | null; note: string };

/** Base URLs for the common OpenAI-compatible services. The model is typed on the settings page (names change too often to list). */
export const OPENAI_PRESETS: OpenAiPreset[] = [
  { id: 'openai', name: 'ChatGPT (OpenAI)', short: 'ChatGPT', baseUrl: 'https://api.openai.com/v1', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys', note: 'An API key from the OpenAI platform (separate from a ChatGPT subscription).' },
  { id: 'gemini', name: 'Google Gemini', short: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey', note: "Google's OpenAI-compatible endpoint; a key from Google AI Studio." },
  { id: 'groq', name: 'Groq', short: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, keyUrl: 'https://console.groq.com/keys', note: 'Very fast open models. Groq also does speech-to-text (Whisper).' },
  { id: 'openrouter', name: 'OpenRouter', short: 'AI', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, keyUrl: 'https://openrouter.ai/keys', note: 'One key for hundreds of models from many companies.' },
  { id: 'ollama', name: 'Ollama (your own computer)', short: 'Ollama', baseUrl: 'http://localhost:11434/v1', needsKey: false, keyUrl: null, note: 'A model running on your own machine. From the truck it has to be reachable (home Wi-Fi, or a VPN).' },
  { id: 'lmstudio', name: 'LM Studio (your own computer)', short: 'AI', baseUrl: 'http://localhost:1234/v1', needsKey: false, keyUrl: null, note: 'Same idea as Ollama, with LM Studio’s server turned on.' },
  { id: 'custom', name: 'Other (OpenAI-compatible)', short: 'AI', baseUrl: '', needsKey: false, keyUrl: null, note: 'Any service with an OpenAI-style /chat/completions endpoint.' },
];

/** Claude's default: the current Opus. Change it on the settings page (e.g. claude-haiku-5-5 for quicker, cheaper answers). */
export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5';

export function defaultAssistant(): AssistantSettings {
  return {
    provider: 'wopr',
    openai: { preset: 'openai', baseUrl: 'https://api.openai.com/v1', model: '' },
    claude: { model: CLAUDE_DEFAULT_MODEL },
    homeassistant: { agentId: null },
    voice: { stt: 'wopr', tts: 'wopr', baseUrl: 'https://api.openai.com/v1', sttModel: 'whisper-1', ttsModel: 'tts-1', ttsVoice: 'alloy' },
  };
}

/** The word on the voice button. */
export function assistantName(a: AssistantSettings): string {
  if (a.provider === 'wopr') return 'WOPR';
  if (a.provider === 'claude') return 'Claude';
  if (a.provider === 'homeassistant') return 'Assist';
  return OPENAI_PRESETS.find((p) => p.id === a.openai.preset)?.short ?? 'AI';
}

/** A base URL on this machine or the home LAN: reachable without the internet when the truck is on home Wi-Fi. */
export function isLocalUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h.endsWith('.local') || h.endsWith('.home.arpa') || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  } catch { return false; }
}
