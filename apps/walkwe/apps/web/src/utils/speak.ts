import { env } from '../env.ts';

// Read text aloud. With the AI proxy configured, the voice comes from
// the configured provider (through the proxy so the key never
// reaches the browser). Without it, or if that fails, the phone's own
// speech engine reads it. One utterance at a time: a new one stops the last.

type Lang = 'th' | 'en';

const audioCache = new Map<string, string>(); // text → object URL
let currentAudio: HTMLAudioElement | null = null;
let ctl: AbortController | null = null;
/** Once the proxy says it has no voice (or fails twice), stop asking this session. */
let remoteOff = !env.aiProxyUrl;
let remoteFails = 0;

export function stopSpeaking(): void {
  ctl?.abort();
  ctl = null;
  currentAudio?.pause();
  currentAudio = null;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function speakLocal(text: string, lang: Lang, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'th' ? 'th-TH' : 'en-GB';
    u.rate = 0.95;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    signal.addEventListener('abort', () => resolve(), { once: true });
    window.speechSynthesis.speak(u);
  });
}

async function remoteUrl(text: string, lang: Lang, signal: AbortSignal): Promise<string | null> {
  const key = `${lang}:${text}`;
  const hit = audioCache.get(key);
  if (hit) return hit;
  if (remoteOff) return null;
  try {
    const path = env.voiceProvider === 'openai' ? '/voice/live/speak' : '/speak';
    const res = await fetch(`${env.aiProxyUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, lang }),
      credentials: 'omit',
      signal: AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(env.voiceProvider === 'openai' ? 11_000 : 8_000)]) : signal,
    });
    if (res.status === 204 || res.status === 503) {
      remoteOff = true; // no voice key on the proxy: use the phone's voice from now on
      return null;
    }
    if (res.status === 409 && env.voiceProvider === 'openai') return null;
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    audioCache.set(key, url);
    remoteFails = 0;
    return url;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' && signal.aborted) throw e;
    if (++remoteFails >= 2) remoteOff = true;
    return null;
  }
}

type SpeechPart = { text: string; lang: Lang };
type SpeakOptions = { local?: boolean; signal?: AbortSignal };

/** Speak each translation with its own voice, stopping the whole request if replaced. */
export async function speakSequence(parts: readonly SpeechPart[], opts: SpeakOptions = {}): Promise<void> {
  if (opts.signal?.aborted) return;
  stopSpeaking();
  const mine = new AbortController();
  ctl = mine;
  const abort = () => { if (ctl === mine) stopSpeaking(); };
  opts.signal?.addEventListener('abort', abort, { once: true });
  try {
    for (const { text, lang } of parts) {
      if (mine.signal.aborted) return;
      const clean = text.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!clean) continue;
      const url = opts.local ? null : await remoteUrl(clean, lang, mine.signal);
      if (mine.signal.aborted) return;
      if (url) {
        const audio = new Audio(url);
        currentAudio = audio;
        const played = await new Promise<boolean>((resolve) => {
          audio.onended = () => resolve(true);
          audio.onerror = () => resolve(false);
          mine.signal.addEventListener('abort', () => resolve(false), { once: true });
          // iOS may block audio that starts after a network wait.
          audio.play().catch(() => resolve(false));
        });
        if (mine.signal.aborted) return;
        if (played) continue;
      }
      await speakLocal(clean, lang, mine.signal);
    }
  } catch {
    /* stopped */
  } finally {
    opts.signal?.removeEventListener('abort', abort);
  }
}

/** Speak one utterance. Short, time-critical words (such as SOS) can skip the network. */
export function speak(text: string, lang: Lang, opts?: SpeakOptions): Promise<void> {
  return text.trim() ? speakSequence([{ text, lang }], opts) : Promise.resolve();
}

export const canSpeak = (): boolean => !!env.aiProxyUrl || 'speechSynthesis' in window;
