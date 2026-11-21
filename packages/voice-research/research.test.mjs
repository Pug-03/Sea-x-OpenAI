import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentsResearch } from "./agents.mjs";
import { createResearchClientTool } from "./browser.mjs";
import { createResearchStore } from "./store.mjs";
import { createResearchRoutes } from "./worker.mjs";

const route = "/agents/research";
const publicName = "ซอยเกษมสันต์ 1 ช่วงปากซอยฝั่งถนนพระรามที่ 1";
const sources = [{ url: "https://example.org/report", note: "บันทึกการติดตั้งไฟ มีนาคม 2569" }];

function mockStorage() {
  let data = new Map();
  let tail = Promise.resolve();
  return {
    async get(key) {
      await tail;
      return data.get(key);
    },
    transaction(callback) {
      const operation = tail.then(async () => {
        const next = new Map(data);
        const result = await callback({ get: key => next.get(key), put: (key, value) => next.set(key, value) });
        data = next;
        return result;
      });
      tail = operation.catch(() => {});
      return operation;
    },
  };
}

function setup(agents, now) {
  const storage = mockStorage();
  const store = createResearchStore(storage, now);
  const tasks = [];
  const handle = createResearchRoutes({
    authenticate: req => req.headers.get("x-test-owner"),
    resolvePublicSegment: (_, id) => id === "segment-1" ? publicName : null,
    store,
    agents,
  });
  const fetch = (path, { owner = "walker-1", ...init } = {}) => {
    const headers = new Headers(init.headers);
    if (owner) headers.set("x-test-owner", owner);
    return handle(new Request(`https://walkwe.test${path}`, { ...init, headers }), {
      waitUntil: promise => tasks.push(promise),
    });
  };
  const post = (body, owner) => fetch(route, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), owner,
  });
  return { fetch, post, storage, tasks };
}

test("voice starts immediately with the app's segment, then speaks only the queued source count", { timeout: 1500 }, async () => {
  const provider = Promise.withResolvers();
  const spoken = Promise.withResolvers();
  let polls = 0;
  const mock = setup({
    start: name => { assert.equal(name, publicName); return provider.promise; },
    poll: id => {
      assert.equal(id, "openai-session");
      if (++polls === 1) throw new Error("Temporary network error");
      return polls === 2 ? { status: "researching" } : { status: "complete", sources };
    },
  });
  const tool = createResearchClientTool({
    getSelectedSegmentId: () => "segment-1", announce: spoken.resolve, proxyFetch: mock.fetch, pollMs: 1,
  });
  const result = await tool({ segmentId: "model-picked-id", lat: 13.7, lon: 100.5 });
  assert.deepEqual(JSON.parse(result), { status: "started", speak_text: "เริ่มค้นแล้ว" });
  provider.resolve("openai-session");
  await Promise.all(mock.tasks);
  assert.equal(await spoken.promise, "ได้ข้อมูลเพิ่ม 1 แหล่ง รอผู้ตรวจ");
  assert.equal(polls, 3);
  assert.deepEqual(JSON.parse(await tool()), { status: "pending_review", speak_text: "ได้ข้อมูลเพิ่ม 1 แหล่ง รอผู้ตรวจ" });
  assert.equal(mock.tasks.length, 1);
});

test("concurrent starts and polls share one search and one review record, with authorized status reads", async () => {
  const mock = setup({ start: () => "session-1", poll: () => ({ status: "complete", sources }) });
  const first = { segmentId: "segment-1" };
  const [left, right] = await Promise.all([mock.post(first), mock.post(first, "walker-2")]);
  const { id } = await left.json();
  assert.equal((await right.json()).id, id);
  assert.equal(mock.tasks.length, 1);
  assert.equal((await mock.fetch(`${route}/${id}`, { owner: "other" })).status, 404);
  assert.equal((await mock.fetch(`${route}/${id}`, { owner: null })).status, 401);
  await Promise.all(mock.tasks);
  const responses = await Promise.all([mock.fetch(`${route}/${id}`), mock.fetch(`${route}/${id}`, { owner: "walker-2" })]);
  for (const response of responses) {
    const { status, sourceCount, providerId } = await response.json();
    assert.deepEqual({ status, sourceCount, providerId }, { status: "pending_review", sourceCount: 1, providerId: undefined });
  }
  const record = await mock.storage.get(`research:review:${id}`);
  assert.deepEqual(record, { id, segmentId: "segment-1", kind: "web_research", status: "pending_review", sources,
    createdAt: record.createdAt });
  const cached = await mock.post(first, "walker-3");
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).cached, true);
  assert.equal(mock.tasks.length, 1);
});

test("request only accepts a known segment id and the browser requires a selected segment", async () => {
  const mock = setup({ start: () => assert.fail("provider invoked") });
  for (const input of [null, ["segment-1"], { segmentId: "13.7,100.5" }, { segmentId: "segment-1", lat: 13.7 },
    { segmentId: "x".repeat(257) }]) {
    assert.equal((await mock.post(input)).status, 422);
  }
  assert.equal((await mock.post({ segmentId: "missing" })).status, 404);
  assert.equal(mock.tasks.length, 0);
  const tool = createResearchClientTool({ getSelectedSegmentId: () => null, proxyFetch: () => assert.fail("proxy invoked") });
  assert.equal(JSON.parse(await tool()).status, "no_segment");
});

test("empty searches have no review entry and the cached result expires", async () => {
  let now = 1000;
  const mock = setup({ start: () => "no-results", poll: () => ({ status: "complete", sources: [] }) }, () => now);
  const payload = { segmentId: "segment-1" };
  const { id } = await (await mock.post(payload)).json();
  await Promise.all(mock.tasks);
  const result = await (await mock.fetch(`${route}/${id}`)).json();
  assert.equal(result.status, "no_sources");
  assert.equal(result.sourceCount, 0);
  assert.equal(await mock.storage.get(`research:review:${id}`), undefined);
  assert.equal((await (await mock.post(payload)).json()).cached, true);
  now += 24 * 60 * 60 * 1000;
  assert.notEqual((await (await mock.post(payload)).json()).id, id);
  await Promise.all(mock.tasks);
  assert.equal(mock.tasks.length, 2);
});

test("provider launch failure remains visible and creates no review record", async () => {
  const mock = setup({ start: () => { throw new Error("Unavailable"); } });
  const { id } = await (await mock.post({ segmentId: "segment-1" })).json();
  await Promise.all(mock.tasks);
  assert.equal((await (await mock.fetch(`${route}/${id}`)).json()).status, "failed");
  assert.equal(await mock.storage.get(`research:review:${id}`), undefined);
});

test("ending the walk session cancels polling and its announcement", async () => {
  const lifetime = new AbortController();
  const requests = [];
  const announcements = [];
  const tool = createResearchClientTool({
    getSelectedSegmentId: () => "segment-1",
    announce: text => announcements.push(text),
    signal: lifetime.signal,
    pollMs: 0,
    proxyFetch: (path, init) => {
      requests.push({ path, method: init.method });
      return Response.json({ id: crypto.randomUUID(), status: "starting" }, { status: 202 });
    },
  });
  assert.equal(JSON.parse(await tool()).status, "started");
  lifetime.abort();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(requests, [{ path: route, method: "POST" }]);
  assert.deepEqual(announcements, []);
});

test("Agents request allows only web search without a sandbox and counts inspected unique HTTPS links", async () => {
  const seen = [];
  const agents = createAgentsResearch({ apiKey: "mock-key", fetchImpl: (url, init) => {
    seen.push(url);
    assert.equal(init.headers["OpenAI-Beta"], "agents=v1");
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.environment, { type: "none" });
      assert.deepEqual(body.agent.tools, [{ type: "web_search", mode: "live" }]);
      assert.equal(body.agent.text.format.type, "json_schema");
      assert.equal(body.stream, false);
      assert.deepEqual(JSON.parse(body.input), { public_segment: publicName });
      return Response.json({ id: "session-1", status: "in_progress" });
    }
    if (url.endsWith("/turns?limit=1")) return Response.json({ data: [{ id: "turn-1", status: "completed" }] });
    return Response.json({ data: [{
      type: "message", role: "assistant", phase: "final_answer", status: "completed", content: [{
        type: "output_text", text: JSON.stringify({ sources: [
          { ...sources[0], url: `${sources[0].url}?utm_source=mock#section` }, sources[0],
          { url: "https://example.org/invented", note: "No tool result" },
        ] }),
      }],
    }, {
      type: "web_search_call", status: "completed", action: { type: "open_page", url: sources[0].url },
    }] });
  } });
  assert.deepEqual(await agents.poll(await agents.start(publicName)), { status: "complete", sources });
  assert.deepEqual(seen.map(url => new URL(url).pathname), [
    "/v1/agents/sessions", "/v1/agents/sessions/session-1/turns", "/v1/agents/sessions/session-1/turns/turn-1/items",
  ]);
});
