import { useRef, useState } from 'react';
import { speechParts, type VoiceArguments } from '@walkwe/core/voice';
import { env } from '../../env.ts';
import { useI18n } from '../../store/i18n.tsx';
import { readJson, storage, writeJson } from '../../utils/storage.ts';
import { LiveVoice } from '../LiveVoice.tsx';

const KEY = 'ww_last_lighting';
const answers = ['lit', 'dim', 'dark', 'cannot_tell'] as const;
type Answer = VoiceArguments<'answer_question'>['answer'];

export function ArrivalLighting({ id }: { id: string }) {
  const { t } = useI18n();
  const saved = readJson(storage, KEY) as { id?: string } | null;
  const answered = useRef(saved?.id === id);
  const [done, setDone] = useState(answered.current);
  if (env.voiceProvider !== 'openai') return null;
  const record = (answer: Answer) => {
    if (answered.current) return false;
    writeJson(storage, KEY, { id, answer });
    answered.current = true;
    setDone(true);
    return true;
  };

  return (
    <section className="why" aria-label={t('voice.lighting.title')} data-testid="arrival-lighting">
      <h2 className="section-label">{t('voice.lighting.title')}</h2>
      {done ? <p role="status" className="small">{t('voice.lighting.saved')}</p> : (
        <div className="step-voice">
          {answers.map((answer) => <button key={answer} type="button" className="step-read" onClick={() => record(answer)}>{t(`voice.lighting.${answer}`)}</button>)}
        </div>
      )}
      <LiveVoice screen="arrival" actions={{ answer_question: ({ answer, language }) => record(answer)
        ? speechParts(language, (locale) => locale === 'th' ? 'บันทึกคำตอบไว้บนอุปกรณ์แล้วครับ' : 'I saved the answer on this device.') : [] }} />
    </section>
  );
}
