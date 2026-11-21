import { z } from 'zod';
import { env } from '../env.ts';
import type { Lang } from '../i18n.ts';

export type ReadingLanguage = Lang | 'both';

const prompts: Record<ReadingLanguage, string> = {
  th: 'พูดขั้นที่แอปกำลังแสดงซ้ำเป็นภาษาไทยครับ',
  en: 'Repeat the current walking instruction in English, please.',
  both: 'พูดขั้นปัจจุบันซ้ำทั้งภาษาไทยและภาษาอังกฤษ เรียงตามนี้ครับ',
};

const bootstrap = z.object({ agentId: z.string().regex(/^agent_[a-zA-Z0-9_-]+$/) });
const repeatParams = z.strictObject({ which: z.literal('last_instruction') });
const toolCall = z.object({ tool_name: z.string(), tool_call_id: z.string(), parameters: z.unknown() });
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').replace(/[.。]$/, '');

/** One explicit, text-only turn. Only an echo of the client tool result authorizes playback. */
export async function requestVerifiedRepeat(
  language: ReadingLanguage,
  locale: Lang,
  result: { distance_m: number; speak_text: string },
  signal: AbortSignal,
): Promise<boolean> {
  if (!env.aiProxyUrl || signal.aborted) return false;
  try {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
    const res = await fetch(`${env.aiProxyUrl}/voice/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      credentials: 'omit', signal: bounded,
    });
    if (!res.ok) return false;
    const { agentId } = bootstrap.parse(await res.json());
    if (bounded.aborted) return false;

    return await new Promise<boolean>((resolve) => {
      const url = new URL('wss://api.elevenlabs.io/v1/convai/conversation');
      url.searchParams.set('agent_id', agentId);
      const ws = new WebSocket(url);
      let asked = false;
      let supplied = false;
      const abort = () => finish(false);
      function finish(ok: boolean) {
        bounded.removeEventListener('abort', abort);
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
        resolve(ok);
      }
      const send = (event: object) => ws.send(JSON.stringify(event));
      bounded.addEventListener('abort', abort, { once: true });
      ws.onerror = ws.onclose = abort;
      ws.onopen = () => send({
        type: 'conversation_initiation_client_data',
        conversation_config_override: { conversation: { text_only: true }, agent: { language: locale, first_message: '' } },
        dynamic_variables: { trip_id: 'active', question_segment: 'none' },
      });
      ws.onmessage = ({ data }) => {
        try {
          const event = JSON.parse(data);
          if (event.type === 'conversation_initiation_metadata' && !asked) {
            asked = true;
            send({ type: 'user_message', text: prompts[language] });
          } else if (event.type === 'ping' && typeof event.ping_event?.event_id === 'number') {
            send({ type: 'pong', event_id: event.ping_event.event_id });
          } else if (event.type === 'client_tool_call') {
            const call = toolCall.parse(event.client_tool_call);
            const ok = asked && !supplied && call.tool_name === 'repeat_instruction' && repeatParams.safeParse(call.parameters).success;
            send({ type: 'client_tool_result', tool_call_id: call.tool_call_id, is_error: !ok,
              result: JSON.stringify(ok ? { status: 'ok', ...result } : { status: 'unavailable' }) });
            if (!ok) finish(false);
            supplied = ok;
          } else if (event.type === 'agent_response' && supplied) {
            const response: unknown = event.agent_response_event?.agent_response;
            finish(typeof response === 'string' && normalize(response) === normalize(result.speak_text));
          }
        } catch {
          finish(false);
        }
      };
    });
  } catch {
    return false;
  }
}
