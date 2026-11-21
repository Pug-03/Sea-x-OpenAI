import { z } from 'zod/v4';
import { routeIntentSchema } from './ai/adapter.ts';

export const replyLanguage = z.enum(['th', 'en', 'both']);
export type ReplyLanguage = z.infer<typeof replyLanguage>;
export type SpeechPart = { lang: 'th' | 'en'; text: string };
const short = (max: number) => z.string().trim().min(1).max(max);
const withLanguage = <T extends z.ZodRawShape>(fields: T) => z.strictObject({ ...fields, language: replyLanguage });

// The Walk We Voice catalog. The app binds trip, segment and contact data to the active screen.
export const voiceTools = {
  plan_trip: { description: 'Prefill a walking plan from the exact, complete request. Extract intent from the utterance without inventing or translating any place name. Leave the points for the user to confirm.',
    schema: withLanguage({ utterance: short(300), intent: routeIntentSchema }) },
  ask_trip: { description: 'Explain the active route or compare it to alternatives using verified app data.',
    schema: withLanguage({ question: short(300) }) },
  change_route: { description: 'Ask the app for a different existing route or route preference. Never invent an alternative.',
    schema: withLanguage({ change: z.enum(['avoid_stairs', 'prefer_covered', 'prefer_lit', 'shortest', 'accept_offer', 'keep_route']) }) },
  select_route: { description: 'Select an offered route by a one-based card number (1, 2, 3), or shortest, shadiest, safest, balanced.',
    schema: withLanguage({ route_ref: short(20) }) },
  start_navigation: { description: 'Start navigation only for the route already selected by the user.', schema: withLanguage({}) },
  stop_navigation: { description: 'Open the existing confirmation to stop navigation.', schema: withLanguage({}) },
  repeat_instruction: { description: 'Read the current step or the next segment from the active route. The app owns distances and directions.',
    schema: withLanguage({ which: z.enum(['last_instruction', 'next_segment_warning']) }) },
  set_theme: { description: 'Change the theme only when the user requests light, dark or automatic.',
    schema: withLanguage({ theme: z.enum(['light', 'dark', 'auto']) }) },
  open_sos_sheet: { description: 'Open the help screen if the user asks for help or mentions immediate danger. Never call, dispatch help or share data.',
    schema: withLanguage({ reason: z.enum(['user_asked', 'emergency_words']) }) },
  answer_question: { description: 'Record the answer to the active app question about lighting on the final walking segment.',
    schema: withLanguage({ answer: z.enum(['lit', 'dim', 'dark', 'cannot_tell']) }) },
  set_preference: { description: 'Change one accessibility preference when the user requests it.',
    schema: withLanguage({ preference: z.enum(['avoid_stairs', 'haptics', 'big_text', 'read_aloud']), value: z.enum(['on', 'off']) }) },
  start_live_share: { description: 'Open the app share confirmation. Never disclose saved contact information or send anything yourself.',
    schema: withLanguage({ contact_label: short(100) }) },
  companion_call: { description: 'Request a companion mode only when the app supports it. Never claim someone is watching a route without app confirmation.',
    schema: withLanguage({ state: z.enum(['start', 'stop']) }) },
};

export type VoiceToolName = keyof typeof voiceTools;
export type VoiceArguments<K extends VoiceToolName> = z.infer<(typeof voiceTools)[K]['schema']>;
export type VoiceActions = { [K in VoiceToolName]?: (args: VoiceArguments<K>, signal: AbortSignal) => SpeechPart[] | Promise<SpeechPart[]> };

export const voiceScreen = z.enum(['plan', 'results', 'navigate', 'arrival']);
export type VoiceScreen = z.infer<typeof voiceScreen>;
const common = ['set_theme', 'set_preference', 'open_sos_sheet'] as const;
export const screenTools = {
  plan: ['plan_trip', ...common],
  results: ['ask_trip', 'select_route', 'change_route', 'start_navigation', ...common],
  navigate: ['ask_trip', 'repeat_instruction', 'stop_navigation', 'start_live_share', 'companion_call', ...common],
  arrival: ['answer_question', ...common],
} satisfies Record<VoiceScreen, VoiceToolName[]>;

export function isVoiceTool(name: string): name is VoiceToolName {
  return Object.hasOwn(voiceTools, name);
}

export function speechParts(language: ReplyLanguage, template: (locale: 'th' | 'en') => string): SpeechPart[] {
  const langs = language === 'both' ? ['th', 'en'] as const : [language];
  return langs.map((lang) => ({ lang, text: template(lang) }));
}

export async function executeVoiceTool<K extends VoiceToolName>(name: K, input: unknown, actions: VoiceActions, signal: AbortSignal) {
  const empty = { status: 'unavailable', parts: [] as SpeechPart[] } as const;
  if (signal.aborted) return empty;
  const parsed = voiceTools[name].schema.safeParse(input);
  if (!parsed.success) return { status: 'invalid', parts: [] as SpeechPart[] } as const;
  try {
    const parts = await actions[name]?.(parsed.data as VoiceArguments<K>, signal);
    if (signal.aborted || !parts?.length || parts.some(({ lang, text }) => !['th', 'en'].includes(lang) || !text.trim()
      || text.length > 300 || /ปลอดภัย|ไม่มีอันตราย|ไม่อันตราย|\b(?:safe|safer|safest|secure)\b/i.test(text))) return empty;
    return { status: 'ok', parts } as const;
  } catch {
    return empty;
  }
}
