import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { speechParts, type VoiceActions, type VoiceScreen } from '@walkwe/core/voice';
import { env } from '../env.ts';
import { setAccess } from '../store/access.ts';
import { useI18n } from '../store/i18n.tsx';
import { useTheme } from '../store/theme.tsx';
import { OPEN_SOS_VOICE } from '../sos/controller.ts';
import { speakSequence, stopSpeaking } from '../utils/speak.ts';

const preferences = { avoid_stairs: 'stepFree', haptics: 'haptics', big_text: 'bigText', read_aloud: 'voice' } as const;

export function LiveVoice({ screen, actions }: { screen: VoiceScreen; actions: VoiceActions }) {
  const { t, lang } = useI18n();
  const { setPref } = useTheme();
  const [status, setStatus] = useState<'idle' | 'starting' | 'ready' | 'failed' | 'unavailable'>('idle');
  const [companion, setCompanion] = useState(false);
  const endAfterReply = useRef(false);
  const run = useRef<AbortController | null>(null);
  const actionsRef = useRef<VoiceActions>({});
  actionsRef.current = {
    ...actions,
    set_theme: ({ language, theme }) => {
      setPref(theme === 'light' ? 'day' : theme === 'dark' ? 'night' : 'auto');
      return speechParts(language, (locale) => locale === 'th' ? 'เปลี่ยนธีมแล้วครับ' : 'I changed the theme.');
    },
    set_preference: ({ language, preference, value }) => {
      setAccess({ [preferences[preference]]: value === 'on' });
      return speechParts(language, (locale) => locale === 'th' ? 'เปลี่ยนการตั้งค่าแล้วครับ การเลี่ยงบันไดจะใช้เมื่อวางแผนครั้งถัดไป' : 'I updated your settings. Stair preferences apply when you next plan a route.');
    },
    open_sos_sheet: ({ language }) => {
      const request = { opened: false };
      window.dispatchEvent(new CustomEvent(OPEN_SOS_VOICE, { detail: request }));
      if (!request.opened) return [];
      return speechParts(language, (locale) => locale === 'th' ? 'เปิดหน้าช่วยเหลือแล้วครับ กดเลือกการติดต่อที่ต้องการได้เลย' : 'The help screen is open. Choose how you want to get help.');
    },
  };
  if (screen === 'navigate') actionsRef.current.companion_call = ({ language, state }) => {
    setCompanion(state === 'start');
    endAfterReply.current = state === 'stop';
    return speechParts(language, (locale) => state === 'start'
      ? (locale === 'th' ? 'อยู่เป็นเพื่อนในแอปได้ครับ ระหว่างเปิดไมค์ถามเรื่องทางเดินได้เลย' : 'I can keep you company here. Ask about your walk while the microphone is on.')
      : (locale === 'th' ? 'ปิดไมค์ให้แล้วครับ' : 'I am turning off the microphone.'));
  };
  useEffect(() => () => run.current?.abort(), []);

  if (env.voiceProvider !== 'openai' || !env.aiProxyUrl || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return null;
  const proxyUrl = env.aiProxyUrl;
  const isActive = status === 'starting' || status === 'ready' || status === 'unavailable';

  const toggle = async () => {
    if (run.current) return run.current.abort();
    const ctl = new AbortController();
    run.current = ctl;
    setStatus('starting');
    stopSpeaking();
    try {
      const { runLiveVoice } = await import('../voice/live.ts');
      if (ctl.signal.aborted) return;
      await runLiveVoice({ proxyUrl, screen, lang, signal: ctl.signal, actions: () => actionsRef.current,
        ready: () => setStatus('ready'),
        unavailable: () => setStatus('unavailable'),
        speak: async (parts, signal, name) => {
          setStatus('ready');
          await speakSequence(parts, { signal });
          if (endAfterReply.current || name === 'open_sos_sheet' || name === 'start_live_share') ctl.abort();
        },
      });
      setStatus('idle');
    } catch {
      setStatus(ctl.signal.aborted ? 'idle' : 'failed');
    } finally {
      endAfterReply.current = false;
      setCompanion(false);
      run.current = null;
    }
  };

  return (
    <div className="step-voice" data-testid="live-voice">
      <button type="button" className="step-read" aria-pressed={isActive} onClick={() => void toggle()}>
        <Mic size={18} aria-hidden="true" /> {t(isActive ? 'voice.live.stop' : 'voice.live.start')}
      </button>
      <span className="small" role="status" aria-live="polite">{t(status === 'ready' && companion ? 'voice.live.companion' : `voice.live.${status}`)}</span>
    </div>
  );
}
