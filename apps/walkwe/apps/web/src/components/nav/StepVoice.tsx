import { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { env } from '../../env.ts';
import type { Lang } from '../../i18n.ts';
import type { NavSession } from '../../nav/session.ts';
import { repeatNavigationInstruction, verifiedNavigationSpeech } from '../../nav/text.ts';
import { requestVerifiedRepeat, type ReadingLanguage } from '../../nav/voiceAgent.ts';
import { useI18n } from '../../store/i18n.tsx';
import { speakSequence } from '../../utils/speak.ts';

export function StepVoice({ session, online, selected, onLanguage }: {
  session: NavSession;
  online: boolean;
  selected: ReadingLanguage;
  onLanguage: (language: ReadingLanguage) => void;
}) {
  const { lang, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(false);
  const playing = useRef<AbortController | null>(null);
  useEffect(() => () => playing.current?.abort(), []);

  const read = async (viaAgent: boolean) => {
    playing.current?.abort();
    const languages: Lang[] = selected === 'both' ? ['th', 'en'] : [selected];
    const readings = languages.map((locale) => {
      const result = repeatNavigationInstruction(session, locale);
      const text = verifiedNavigationSpeech(result, session, locale);
      return result.status === 'ok' && text ? { lang: locale, text, distance: result.distance_m } : null;
    });
    if (readings.some((part) => !part)) return;
    const parts = readings.filter((part) => part !== null);
    const request = new AbortController();
    playing.current = request;
    setBusy(viaAgent);
    setFallback(false);

    const confirmed = !viaAgent || await requestVerifiedRepeat(selected, lang, {
      distance_m: parts[0]!.distance,
      speak_text: parts.map((part) => part.text).join('. '),
    }, request.signal);
    if (request.signal.aborted) return;
    setBusy(false);
    setFallback(!confirmed);
    await speakSequence(parts, { signal: request.signal, local: !confirmed });
  };

  return (
    <>
      <div className="step-voice">
        <select className="step-read" aria-label={t('nav.voiceLanguage')} value={selected}
          onChange={(event) => onLanguage(event.target.value as ReadingLanguage)}>
          <option value="th" lang="th">ไทย</option>
          <option value="en" lang="en">English</option>
          <option value="both">{t('nav.voiceBoth')}</option>
        </select>
        <button type="button" className="step-read" onClick={() => void read(false)} data-testid="step-read">
          <Volume2 size={18} aria-hidden="true" />
          {t('access.read')}
        </button>
        {env.aiProxyUrl && online && (
          <button type="button" className="step-read" disabled={busy} onClick={() => void read(true)}>
            {t(busy ? 'nav.voiceWaiting' : 'nav.voiceAgent')}
          </button>
        )}
      </div>
      {fallback && <p role="status" className="small">{t('nav.voiceFallback')}</p>}
    </>
  );
}
