import { expect, it, vi } from 'vitest';
import { speechParts } from '@walkwe/core/voice';
import { createLiveToolHandler } from './live.ts';

const call = (name: string, args: object, id = '1', delegation = '1') => ({
  type: 'response.event', delegation_id: delegation, event: { type: 'response.output_item.done',
    item: { type: 'function_call', name, arguments: JSON.stringify(args), call_id: id } },
});

it('checks the direct tool result, rejects supplied distances, and dispatches help only once', async () => {
  const repeat = vi.fn(() => speechParts('both', (lang) => lang === 'th' ? 'เดินต่อ 10 เมตร' : 'Walk 10 metres'));
  const help = vi.fn(() => speechParts('en', () => 'The help sheet is open.'));
  const send = vi.fn(), speak = vi.fn(async () => {}), unavailable = vi.fn();
  const ctl = new AbortController();
  const handle = createLiveToolHandler({ screen: 'navigate', signal: ctl.signal, actions: () => ({ repeat_instruction: repeat, open_sos_sheet: help }), send, speak, unavailable });
  await handle(call('repeat_instruction', { language: 'en', which: 'last_instruction', distance_m: 999 }));
  expect(repeat).not.toHaveBeenCalled();
  expect(unavailable).toHaveBeenCalledOnce();
  await handle(call('repeat_instruction', { language: 'both', which: 'last_instruction' }, '2', '2'));
  expect(speak).toHaveBeenCalledWith([{ lang: 'th', text: 'เดินต่อ 10 เมตร' }, { lang: 'en', text: 'Walk 10 metres' }], 'repeat_instruction');
  expect(send).toHaveBeenCalledWith({ type: 'response.item.create', item: { type: 'function_call_output', call_id: '2', output: '{"status":"ok","speak_text":"เดินต่อ 10 เมตร Walk 10 metres"}' } });
  const requested = call('open_sos_sheet', { language: 'en', reason: 'user_asked' }, '3', '3');
  await handle(requested);
  await handle(requested);
  await handle(call('open_sos_sheet', { language: 'en', reason: 'user_asked' }, '4', '3'));
  expect(help).toHaveBeenCalledOnce();
  ctl.abort();
  await handle(call('open_sos_sheet', { language: 'en', reason: 'user_asked' }, '5', '5'));
  expect(help).toHaveBeenCalledOnce();
});
