import type { RouteStep } from '@walkwe/core';
import { translate, type Lang } from '../i18n.ts';
import { formatDistance } from '../utils/format.ts';
import type { NavSession, NavStep } from './session.ts';

// Wording for generated steps, Thai and English. Kept here (not in the
// router) so core stays language-free and the phrasing can be tuned with
// native speakers without touching routing.

const PLACE: Record<Lang, Record<string, string>> = {
  th: {
    footway: 'ทางเดินเท้า', pedestrian: 'ถนนคนเดิน', path: 'ทางเดิน', steps: 'บันได', corridor: 'ทางเดินในอาคาร',
    service: 'ทางเข้าออก', living_street: 'ซอย', residential: 'ซอย', track: 'ทางเดิน', cycleway: 'ทางจักรยาน',
    default: 'ถนน', elevated: 'สะพานลอย / สกายวอล์ก',
  },
  en: {
    footway: 'the footpath', pedestrian: 'the pedestrian street', path: 'the path', steps: 'the stairs',
    corridor: 'the indoor walkway', service: 'the service lane', living_street: 'the soi', residential: 'the soi',
    track: 'the track', cycleway: 'the cycle path', default: 'the road', elevated: 'the footbridge / skywalk',
  },
};

const ACTION: Record<Lang, Record<RouteStep['maneuver'], string>> = {
  th: {
    depart: 'เริ่มเดินไปตาม{p}', straight: 'เดินตรงไปตาม{p}', 'slight-left': 'เบี่ยงซ้ายเข้า{p}', left: 'เลี้ยวซ้ายเข้า{p}',
    'sharp-left': 'เลี้ยวซ้ายหักศอกเข้า{p}', 'slight-right': 'เบี่ยงขวาเข้า{p}', right: 'เลี้ยวขวาเข้า{p}',
    'sharp-right': 'เลี้ยวขวาหักศอกเข้า{p}', uturn: 'กลับหลังหัน แล้วเดินตาม{p}', arrive: 'ถึงจุดหมายแล้ว',
  },
  en: {
    depart: 'Head along {p}', straight: 'Continue along {p}', 'slight-left': 'Bear left onto {p}', left: 'Turn left onto {p}',
    'sharp-left': 'Turn sharp left onto {p}', 'slight-right': 'Bear right onto {p}', right: 'Turn right onto {p}',
    'sharp-right': 'Turn sharp right onto {p}', uturn: 'Turn around and follow {p}', arrive: 'You have arrived',
  },
};

export function placeName(s: RouteStep, lang: Lang): string {
  if (s.name) return s.name;
  if (s.elevated) return PLACE[lang].elevated!;
  return PLACE[lang][s.wayClass ?? ''] ?? PLACE[lang].default!;
}

export function stepInstruction(s: RouteStep, lang: Lang): string {
  return ACTION[lang][s.maneuver].replace('{p}', placeName(s, lang));
}

/** Short extra hints: distance, cover, stairs, shady side, mall. */
export function stepHints(s: RouteStep, distanceM: number, lang: Lang, day: boolean): string[] {
  const th = lang === 'th';
  const out: string[] = [];
  if (s.maneuver !== 'arrive' && distanceM > 0) out.push(th ? `เดินต่อ ${formatDistance(distanceM, lang)}` : `Walk ${formatDistance(distanceM, lang)}`);
  if (s.covered) out.push(th ? 'ทางมีหลังคา' : 'Covered walkway');
  if (s.stairs) out.push(th ? 'มีบันได' : 'Stairs');
  if (day && s.shadeSide !== 0) {
    out.push(th ? `เดินชิดฝั่ง${s.shadeSide < 0 ? 'ซ้าย' : 'ขวา'}เพื่ออยู่ในร่ม` : `Keep ${s.shadeSide < 0 ? 'left' : 'right'} for shade`);
  }
  if (s.mall) out.push(th ? `ผ่าน ${s.mall}` : `Through ${s.mall}`);
  return out;
}

export function navigationStepWords(step: NavStep, lang: Lang, day: boolean) {
  if (!step.guide) {
    return { instruction: stepInstruction(step.step, lang), hints: stepHints(step.step, step.distanceM, lang, day) };
  }
  const hints = stepHints(step.step, 0, lang, day);
  if (step.distanceM > 0) {
    const distance = formatDistance(step.distanceM, lang);
    hints.unshift(lang === 'th' ? `เดินต่อ ${distance}` : `Walk ${distance}`);
  }
  return { instruction: step.guide.instruction[lang], hints };
}

/** The read-step tool responds from the active route, without taking a distance from its caller. */
export function repeatNavigationInstruction(session: NavSession, lang: Lang) {
  const step = session.steps[session.index];
  if (!step || !Number.isFinite(step.distanceM) || step.distanceM < 0) {
    return { status: 'unavailable' } as const;
  }
  const { instruction, hints } = navigationStepWords(step, lang, session.mode === 'day');
  const landmark = step.guide ? translate(lang, 'nav.landmark', { l: step.guide.landmark[lang] }) : '';
  const speakText = [instruction, ...hints, landmark]
    .filter(Boolean)
    .map((part) => part
      .replace(/(\d)\s*กม\./g, '$1 กิโลเมตร')
      .replace(/(\d)\s*ม\./g, '$1 เมตร')
      .replace(/(\d)\s*km\b/g, '$1 kilometres')
      .replace(/(\d)\s*m\b/g, '$1 metres')
      .replace(/[.\s]+$/, ''))
    .join('. ')
    .replace(/\s+/g, ' ')
    .trim();
  return { status: 'ok', trip_id: session.id, step_index: session.index, distance_m: step.distanceM, speak_text: speakText } as const;
}

/** Validate the tool result against the current step before either TTS backend sees it. */
export function verifiedNavigationSpeech(
  result: unknown, session: NavSession, lang: Lang,
): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const expected = repeatNavigationInstruction(session, lang);
  const candidate = result as Record<string, unknown>;
  if (expected.status !== 'ok' || candidate.status !== 'ok'
    || candidate.trip_id !== expected.trip_id || candidate.step_index !== expected.step_index
    || candidate.distance_m !== expected.distance_m || candidate.speak_text !== expected.speak_text
    || expected.speak_text.length > 300) return null;
  return expected.speak_text;
}
