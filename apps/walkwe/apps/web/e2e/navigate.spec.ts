import { SIAM, asReturningUser, expect, test, waitForPageTransition } from './fixtures.ts';

// Phase 3 "Done when": navigation continues after enabling airplane mode
// mid-route. Also: the carousel is reversible, photos load, and a reload
// while offline resumes the walk at the same step.

test.beforeEach(async ({ page, context }) => {
  await asReturningUser(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(SIAM);
  await context.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: { hourly: { time: [], cloud_cover: [] } } }));
  await page.clock.install({ time: new Date('2026-10-15T14:00:00+07:00') });
  await page.clock.resume(); // start at that time, then let it run like a real clock
});

async function startSiamToCentralWorld(page: import('@playwright/test').Page) {
  await page.goto('/plan');
  // Wait until the service worker controls the page, as it would for anyone
  // who has opened the app once.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
  await page.getByTestId('point-from').click();
  await page.getByTestId('use-current').click();
  await expect(page.getByRole('heading', { name: 'ไปที่ไหน' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'ค้นหาสถานที่' }).fill('central');
  await page.getByTestId('search-results').getByRole('button', { name: /centralwOrld/ }).click();
  await page.getByTestId('find-routes').click();
  await page.getByTestId('start-nav').click();
  await expect(page).toHaveURL(/\/navigate$/);
  await waitForPageTransition(page);
}

const photoLoaded = (page: import('@playwright/test').Page) =>
  page.locator('.carousel-slide:not([aria-hidden="true"]) .step-photo-img');

async function recordDeviceSpeech(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const speech: { text: string; lang: string }[] = [];
    Object.defineProperty(window, 'navigationSpeech', { value: speech });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        cancel() {},
        getVoices: () => [],
        speak(utterance: SpeechSynthesisUtterance) {
          speech.push({ text: utterance.text, lang: utterance.lang });
          utterance.dispatchEvent(new Event('end'));
        },
      },
    });
  });
  return () => page.evaluate(() => (window as Window & { navigationSpeech?: { text: string; lang: string }[] }).navigationSpeech ?? []);
}

test('read aloud uses the distance on the current navigation step', async ({ page, context }) => {
  const proxyText: string[] = [];
  await context.route('**/speak', async (route) => {
    proxyText.push(route.request().postDataJSON().text as string);
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  });
  const recorded = await recordDeviceSpeech(page);
  await startSiamToCentralWorld(page);
  const active = page.locator('.carousel-slide:not([aria-hidden="true"])');
  const readings = [
    { metres: 8, display: 'เดินต่อ 10 ม.', speech: 'เดินต่อ 10 เมตร' },
    { metres: 392, display: 'เดินต่อ 390 ม.', speech: 'เดินต่อ 390 เมตร' },
  ];
  for (const [index, { metres, display, speech }] of readings.entries()) {
    if (index > 0) await page.getByTestId('im-here').click();
    await expect(active.getByText(display, { exact: false })).toBeVisible();
    expect(await page.evaluate(() => {
      const session = JSON.parse(localStorage.getItem('ww_nav')!);
      return session.steps[session.index].distanceM;
    })).toBe(metres);
    await page.getByTestId('step-read').click();
    await expect.poll(async () => (await recorded()).at(index)?.text).toContain(speech);
  }
  if (process.env.VITE_AI_PROXY_URL) expect(proxyText).toEqual([expect.stringContaining(readings[0]!.speech)]);
});

test('agent reads English in Thai UI and rejects a changed bilingual distance', async ({ page, context }) => {
  test.skip(!process.env.VITE_AI_PROXY_URL, 'Run with a proxy URL to exercise the agent bootstrap.');
  const recorded = await recordDeviceSpeech(page);
  const toolResults: { status: string; distance_m: number; speak_text: string }[] = [];
  const requests: string[] = [];
  await context.route('**/voice/session', async (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({ json: { agentId: 'agent_demo' } });
  });
  await context.route('**/speak', (route) => route.fulfill({ status: 204 }));
  await page.routeWebSocket(/api\.elevenlabs\.io\/v1\/convai\/conversation/, (socket) => {
    const send = (data: object) => socket.send(JSON.stringify(data));
    socket.onMessage((raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === 'conversation_initiation_client_data') {
        expect(event.conversation_config_override.conversation).toEqual({ text_only: true });
        expect(event.conversation_config_override.agent.language).toBe('th');
        send({ type: 'conversation_initiation_metadata' });
      } else if (event.type === 'user_message') {
        requests.push(event.text);
        send({ type: 'client_tool_call', client_tool_call: {
          tool_name: 'repeat_instruction', tool_call_id: 'repeat', parameters: { which: 'last_instruction' },
        } });
      } else if (event.type === 'client_tool_result') {
        expect(event.is_error).toBe(false);
        const result = JSON.parse(event.result);
        toolResults.push(result);
        const reply = toolResults.length === 1 ? result.speak_text : 'Walk 999 metres';
        send({ type: 'agent_response', agent_response_event: { agent_response: reply } });
      }
    });
  });
  await startSiamToCentralWorld(page);
  const selector = page.getByLabel('ภาษาอ่านขั้นนี้ซ้ำ');
  const agent = page.getByRole('button', { name: 'ให้ Walk We Agent อ่าน' });
  await selector.selectOption('en');
  await agent.click();
  await expect.poll(recorded).toEqual([{ lang: 'en-GB', text: expect.stringContaining('Walk 10 metres') }]);
  expect(requests[0]).toContain('in English');
  expect(toolResults[0]).toMatchObject({ status: 'ok', distance_m: 8, speak_text: expect.stringContaining('Walk 10 metres') });

  await selector.selectOption('both');
  await page.getByTestId('im-here').click();
  await expect(selector).toHaveValue('both');
  await agent.click();
  await expect(page.getByRole('status').filter({ hasText: 'ตรวจคำตอบจาก Agent ไม่ได้' })).toBeVisible();
  await expect.poll(async () => (await recorded()).slice(1)).toEqual([
    { lang: 'th-TH', text: expect.stringContaining('เดินต่อ 390 เมตร') },
    { lang: 'en-GB', text: expect.stringContaining('Walk 390 metres') },
  ]);
  expect(toolResults[1]).toMatchObject({ status: 'ok', distance_m: 392 });
  expect(toolResults[1]!.speak_text).toContain('เดินต่อ 390 เมตร');
  expect(toolResults[1]!.speak_text).toContain('Walk 390 metres');
});

test('airplane mode mid-route: steps, photos, map and reload keep working', async ({ page, context }) => {
  await startSiamToCentralWorld(page);

  // The Siam → CentralWorld photo guide is used.
  await expect(page.getByTestId('step-instruction')).toHaveText(/ลงจากสถานี BTS สยาม/);
  await expect(page.getByTestId('nav-status')).toContainText('ขั้นที่ 1/5');
  await expect(page.getByTestId('offline-ready')).toBeVisible({ timeout: 20_000 });

  // ✈️ Airplane mode.
  await context.setOffline(true);
  await expect(page.getByTestId('offline-chip')).toBeVisible();

  await page.getByTestId('im-here').click();
  await expect(page.getByTestId('nav-status')).toContainText('ขั้นที่ 2/5');
  await expect(page.getByTestId('step-instruction')).toHaveText(/ถนนพระรามที่ 1/);
  await expect(photoLoaded(page)).toHaveAttribute('data-loaded', 'true');
  expect(await photoLoaded(page).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // The map view still opens offline.
  await page.getByTestId('toggle-map').click();
  await expect(page.locator('.nav-map .maplibregl-canvas')).toBeVisible();
  await page.getByTestId('toggle-map').click();

  // Reload while offline: the service worker serves the app; the walk resumes.
  await page.reload();
  await expect(page.getByTestId('nav-status')).toContainText('ขั้นที่ 2/5');
  await expect(photoLoaded(page)).toHaveAttribute('data-loaded', 'true');

  // Steps 4 and 5 were never shown while online: their photos can only come
  // from what navigation prefetched into the service-worker cache.
  for (const n of [3, 4, 5]) {
    await page.getByTestId('im-here').click();
    await expect(page.getByTestId('nav-status')).toContainText(`ขั้นที่ ${n}/5`);
    await expect(photoLoaded(page)).toHaveAttribute('data-loaded', 'true');
    expect(await photoLoaded(page).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByTestId('im-here')).toHaveText('จบการนำทาง');
  await page.getByTestId('im-here').click();
  await expect(page.getByRole('heading', { name: 'ถึงแล้ว' })).toBeVisible();
});

test('the step carousel is reversible by swipe and buttons', async ({ page }) => {
  await startSiamToCentralWorld(page);
  const status = page.getByTestId('nav-status');
  const box = (await page.locator('.carousel').boundingBox())!;
  const y = box.y + box.height / 2;
  const swipe = async (dx: number) => {
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 10 });
    await page.mouse.up();
  };
  await swipe(-box.width * 0.5);
  await expect(status).toContainText('ขั้นที่ 2/5');
  await swipe(box.width * 0.5);
  await expect(status).toContainText('ขั้นที่ 1/5'); // nothing was thrown away
  await page.getByRole('button', { name: 'ขั้นถัดไป' }).click();
  await expect(status).toContainText('ขั้นที่ 2/5');
  await page.getByRole('button', { name: 'ขั้นก่อนหน้า' }).click();
  await expect(status).toContainText('ขั้นที่ 1/5');
});

test('photo opens full screen and closes', async ({ page }) => {
  await startSiamToCentralWorld(page);
  // Tap on the photo itself (not only the expand button).
  await page.locator('.carousel-slide:not([aria-hidden="true"]) .step-photo-img').click();
  await expect(page.getByRole('dialog', { name: 'ทางลงจากสถานี BTS สยาม' })).toBeVisible();
  await page.getByRole('button', { name: 'ปิดรูป' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The keyboard / screen-reader path.
  await page.getByRole('button', { name: /ดูรูปเต็มจอ/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a swipe that starts on the photo moves the carousel and does not open the photo', async ({ page }) => {
  await startSiamToCentralWorld(page);
  const photo = (await page.locator('.carousel-slide:not([aria-hidden="true"]) .step-photo').boundingBox())!;
  const y = photo.y + photo.height / 2;
  await page.mouse.move(photo.x + photo.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(photo.x + photo.width * 0.2, y, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('nav-status')).toContainText('ขั้นที่ 2/5');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('exit asks first and returns to the planner', async ({ page }) => {
  await startSiamToCentralWorld(page);
  await page.getByRole('button', { name: 'ออกจากการนำทาง' }).click();
  await page.getByRole('button', { name: 'นำทางต่อ' }).click();
  await expect(page.getByTestId('nav-status')).toBeVisible();
  await page.getByRole('button', { name: 'ออกจากการนำทาง' }).click();
  await page.getByRole('button', { name: 'ออก', exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/);
});
