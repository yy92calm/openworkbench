/** Offline Text-to-Speech via the Web Speech API (speechSynthesis).
 *  Electron's Chromium engine delegates to the OS speech engine — zero
 *  dependencies, fully offline. */

export interface TtsOptions {
  voiceURI?: string;
  rate?: number; // 0.5–2.0, default 1.0
  pitch?: number; // 0–2.0, default 1.0
  volume?: number; // 0–1.0, default 1.0
}

export interface VoiceConfig {
  ttsEnabled: boolean;
  voiceURI: string | null;
  rate: number;
  pitch: number;
  sttEnabled: boolean;
}

const DEFAULT_CONFIG: VoiceConfig = {
  ttsEnabled: false,
  voiceURI: null,
  rate: 1.0,
  pitch: 1.0,
  sttEnabled: true,
};

const CONFIG_KEY = 'voice-config';

/** Load voice config from electron-store (async) or fall back to defaults. */
export async function loadVoiceConfig(): Promise<VoiceConfig> {
  try {
    const raw = await window.electronAPI?.storeGet(CONFIG_KEY);
    if (raw && typeof raw === 'object') {
      return { ...DEFAULT_CONFIG, ...(raw as Partial<VoiceConfig>) };
    }
  } catch {
    /* not in Electron yet */
  }
  return DEFAULT_CONFIG;
}

/** Persist voice config to electron-store. */
export async function saveVoiceConfig(cfg: VoiceConfig): Promise<void> {
  await window.electronAPI?.storeSet(CONFIG_KEY, cfg);
}

/** Get available system voices. Returns empty array if API unavailable. */
export function getVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

/** Some platforms load voices asynchronously. This resolves once they're ready. */
export function onVoicesReady(cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return () => {};
  const synth = window.speechSynthesis;
  // If already populated, fire immediately.
  if (synth.getVoices().length > 0) {
    cb();
    return () => {};
  }
  const handler = () => cb();
  synth.addEventListener('voiceschanged', handler, { once: true });
  return () => synth.removeEventListener('voiceschanged', handler);
}

/** Speak text with the given options. Cancels any ongoing speech. */
export function speak(text: string, opts: TtsOptions = {}): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  if (opts.voiceURI) {
    const v = voices.find((v) => v.voiceURI === opts.voiceURI);
    if (v) u.voice = v;
  }
  u.rate = opts.rate ?? 1.0;
  u.pitch = opts.pitch ?? 1.0;
  u.volume = opts.volume ?? 1.0;
  window.speechSynthesis.speak(u);
}

/** Stop any ongoing speech. */
export function cancelSpeak(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

/** Whether speech is currently in progress. */
export function isSpeaking(): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  return window.speechSynthesis.speaking;
}
