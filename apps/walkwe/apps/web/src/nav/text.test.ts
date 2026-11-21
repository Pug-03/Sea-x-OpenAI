import { describe, expect, it } from 'vitest';
import type { RouteStep } from '@walkwe/core';
import type { NavSession } from './session.ts';
import { repeatNavigationInstruction, stepHints, stepInstruction, verifiedNavigationSpeech } from './text.ts';

const base: RouteStep = {
  maneuver: 'left', name: '', wayClass: 'footway', distanceM: 120, at: { lat: 13.7, lng: 100.5 },
  covered: false, elevated: false, stairs: false, shadeSide: 0, mall: null,
};

describe('generated step wording', () => {
  it('uses the street name, or a walkway description when unnamed', () => {
    expect(stepInstruction({ ...base, name: 'ถนนพระรามที่ 1' }, 'th')).toBe('เลี้ยวซ้ายเข้าถนนพระรามที่ 1');
    expect(stepInstruction(base, 'en')).toBe('Turn left onto the footpath');
    expect(stepInstruction({ ...base, elevated: true }, 'th')).toBe('เลี้ยวซ้ายเข้าสะพานลอย / สกายวอล์ก');
    expect(stepInstruction({ ...base, maneuver: 'arrive' }, 'en')).toBe('You have arrived');
  });
  it('adds distance, cover, stairs and the shady side (day only)', () => {
    const s = { ...base, covered: true, stairs: true, shadeSide: -1 as const };
    expect(stepHints(s, 120, 'th', true)).toEqual(['เดินต่อ 120 ม.', 'ทางมีหลังคา', 'มีบันได', 'เดินชิดฝั่งซ้ายเพื่ออยู่ในร่ม']);
    expect(stepHints(s, 120, 'en', false)).toEqual(['Walk 120 m', 'Covered walkway', 'Stairs']);
  });
});

it('validates the current tool result before speaking the distance shown on the step', () => {
  const session: NavSession = {
    id: 'walk', index: 0, mode: 'day', startedAt: 0, destinationName: 'CentralWorld', guideId: null,
    steps: [
      { step: { ...base, name: 'ถนนพระรามที่ 1' }, distanceM: 8, guide: null, at: base.at },
      { step: base, distanceM: 392, guide: null, at: base.at },
    ],
    route: {} as NavSession['route'], // The speech tool takes its evidence from the active navigation step.
  };
  const tool = repeatNavigationInstruction(session, 'th');
  expect(tool).toMatchObject({ status: 'ok', distance_m: 8, speak_text: 'เลี้ยวซ้ายเข้าถนนพระรามที่ 1. เดินต่อ 10 เมตร' });
  if (tool.status !== 'ok') throw new Error('Expected an instruction');
  expect(verifiedNavigationSpeech(tool, session, 'th')).toBe(tool.speak_text);
  expect(verifiedNavigationSpeech({ ...tool, speak_text: tool.speak_text.replace('10 เมตร', '900 เมตร') }, session, 'th')).toBeNull();
  expect(verifiedNavigationSpeech({ ...tool, distance_m: 900 }, session, 'th')).toBeNull();
  expect(verifiedNavigationSpeech(tool, { ...session, index: 1 }, 'th')).toBeNull();

  const next = { ...session, index: 1 };
  expect(verifiedNavigationSpeech(repeatNavigationInstruction(next, 'en'), next, 'en')).toBe('Turn left onto the footpath. Walk 390 metres');
});
