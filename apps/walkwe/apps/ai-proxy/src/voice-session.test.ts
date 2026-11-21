import { expect, it, vi } from 'vitest';
import worker from './index.ts';

const origin = 'https://walkwe-web2.walkwe.workers.dev';
const original = 'https://walkwe-web.walkwe.workers.dev';
const env = {
  ANTHROPIC_API_KEY: '', ALLOWED_ORIGINS: `${origin},${original}`,
  ELEVENLABS_AGENT_ID: 'agent_demo', ELEVENLABS_AGENT_ORIGIN: origin,
};
const request = (from: string, body = '{}') => new Request('https://proxy.test/voice/session', {
  method: 'POST', body,
  headers: { origin: from, 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site' },
});

it('returns only the public agent ID to the configured demo origin', async () => {
  const response = await worker.fetch(request(origin), env);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(await response.json()).toEqual({ agentId: 'agent_demo' });
  expect((await worker.fetch(request('https://invalid.test'), env)).status).toBe(403);
  expect((await worker.fetch(request(original), env)).status).toBe(503);
  expect((await worker.fetch(request(origin, '{"text":"do not send"}'), env)).status).toBe(400);
  expect((await worker.fetch(request(origin), { ...env, ELEVENLABS_AGENT_ID: undefined })).status).toBe(503);
});

it('uses a Thai-capable speech model and the cheaper Flash model for English', async () => {
  const upstream = vi.fn(async (_url: string, _options: RequestInit) => new Response('audio'));
  vi.stubGlobal('fetch', upstream);
  try {
    for (const [lang, text, model] of [
      ['th', 'เดินต่อ 10 เมตร', 'eleven_v3'],
      ['en', 'Walk 10 metres', 'eleven_flash_v2_5'],
    ]) {
      const response = await worker.fetch(new Request('https://proxy.test/speak', {
        method: 'POST', body: JSON.stringify({ text, lang }), headers: request(origin).headers,
      }), { ...env, ELEVENLABS_API_KEY: 'mock-key' });
      expect(response.headers.get('content-type')).toBe('audio/mpeg');
      expect(JSON.parse(upstream.mock.lastCall![1].body as string)).toEqual({ text, model_id: model, language_code: lang });
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
