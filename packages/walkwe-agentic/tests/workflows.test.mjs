import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { verifyFinish } from "../../verify/index.mjs";
import { plannerContext } from "../src/context.mjs";
import { compareDepartureTimes, normalizeSun, planRoute, replay, segmentEvidence, shadowLength } from "../src/core.mjs";
import { auditPhoto, draftLightingProposal, draftNews, reviewProposal, stewardReview } from "../src/evidence.mjs";
import { createModelClient } from "../src/model.mjs";
import { createPreviewServer } from "../src/server.mjs";
import { acknowledgeSos, newSos, submitSos, transitionSos } from "../src/sos.mjs";
import { createVoiceTools, getSignedVoiceUrl } from "../src/voice.mjs";
import { askTrip, createWorkflows } from "../src/workflows.mjs";

const night = { from: "siam", to: "central", time: "21:00", mode: "night" };
const toolCall = (name, args, id) => [{ type: "function_call", name, arguments: JSON.stringify(args), call_id: id }];
const finish = result => ({
  recommended_route_id: result.recommendedId, decision: result.decision, verdict: "recommend_with_caveat",
  depends_on_segment_ids: result.stress.evidenceIds,
  claims: [{ claim_id: "light", kind: "lighting_unknown", evidence_ids: ["lane-gap"], placeholders: [] },
    { claim_id: "time", kind: "other", evidence_ids: [`route:${result.recommendedId}`], placeholders: ["{duration_min}"] }],
  text: "บางช่วงยังไม่มีข้อมูลไฟ เดินประมาณ {duration_min} นาที",
  card_notes: result.routes.map(route => ({
    route_id: route.id,
    trust: route.segments.some(segment => result.stress.evidenceIds.includes(segment.id)) ? "depends_on" : "stable",
    note: "ดูข้อมูลรายช่วงได้",
  })),
  unknowns: ["lighting"], tool_errors_acknowledged: [], language: "th",
});
const nightCalls = result => [
  toolCall("plan_routes", { origin: { kind: "place", place_id: "siam" }, destination_place_id: "central", depart_at: "now",
    mode: "night", preference: "balanced", avoid_stairs: false, night_factors: ["lit"] }, "plan"),
  toolCall("stress_test_route", { route_ids: result.routes.map(route => route.id) }, "stress"),
  toolCall("ask_user", { kind: "preference", text: "อยากเดินทางตรงหรือเลือกทางที่มีข้อมูลไฟครบกว่า",
    options: [{ label: "เดินตรง", ref: result.stress.optimisticId }, { label: "มีข้อมูลไฟครบกว่า", ref: result.stress.pessimisticId }] }, "ask"),
  toolCall("get_segment_evidence", { segment_ids: ["lane-gap"], factor: "lighting" }, "evidence"),
];
const reviewed = (draft, verdict = "accept") => toolCall("finish_review", {
  claim_checks: draft.claims.map(claim => ({ claim_id: claim.claim_id, result: verdict === "accept" ? "supported" : "unsupported",
    reason: verdict === "accept" ? "ok" : "unsupported_claim", evidence_ids: claim.evidence_ids })),
  wording_flags: [], verdict,
}, "report");

test("fixture night stress test flips and never fills in unknown", () => {
  const result = replay();
  assert.equal(result.decision, "VERIFY");
  assert.notEqual(result.stress.optimisticId, result.stress.pessimisticId);
  assert.deepEqual(result.stress.evidenceIds, ["lane-gap"]);
  assert.equal(segmentEvidence("lane-gap").light, "unknown");
  assert.equal(result.routes.find(route => route.id === result.shortestId).unknown, 180);
  assert.deepEqual(askTrip("ข้อมูลไฟ", result).segmentIds, ["lane-gap"]);
  assert.equal(replay("night", { "lane-gap": "lit" }).stress.flipped, false);
});

test("uses Bangkok times, same access constraints, and normalized sun bearings", () => {
  assert.deepEqual(normalizeSun({ altitude: Math.PI / 4, azimuth: -Math.PI / 2 }, 1), { altitude: 45, azimuth: 90 });
  assert.deepEqual(normalizeSun({ altitude: 45, azimuth: 90 }, 2), { altitude: 45, azimuth: 90 });
  assert.equal(shadowLength(30, 40).toFixed(1), "35.8");
  const comparison = compareDepartureTimes({ from: "siam", to: "central" }, ["12:00", "15:00", "21:00"]);
  assert.notEqual(comparison.options[0].sunMinutes, comparison.options[1].sunMinutes);
  assert.equal(comparison.options[2].status, "night");
  assert.equal(planRoute({ ...night, arriveBy: "21:03" }).status, "no_path");
  assert.equal(planRoute({ ...night, date: "2026-02-30" }).status, "invalid");
  assert.ok(planRoute({ ...night, noStairs: true }).routes.every(route => !route.id.includes("cover-west")));
  assert.ok(planRoute({ ...night, from: "paragon" }).routes.every(route => !route.id.includes("mall-link")));
});

test("Intent returns confirmable local draft when a model invents a place", async () => {
  const engine = createWorkflows({ model: { structured: async () => ({ from: "invented" }) } });
  const response = await engine.intent({ text: "จากสยามไปเซ็นทรัลเวิลด์สามทุ่ม เลี่ยงบันได", useModel: true });
  assert.equal(response.status, "confirm");
  assert.equal(response.source, "system");
  assert.deepEqual(response.draft, { from: "siam", to: "central", time: "21:00", mode: "night", noStairs: true });
});

test("Planner must read stress evidence and get a Critic verdict before verified finish", async () => {
  const result = replay();
  const calls = nightCalls(result);
  const engine = createWorkflows({ model: {
    async turn(role, { input, tools }) {
      if (role === "critic") {
        assert.deepEqual(tools.map(tool => tool.name), ["get_segment_evidence", "finish_review"]);
        if (input.length === 1) return toolCall("get_segment_evidence", { segment_ids: ["lane-gap"], factor: "lighting" }, "critic-read");
        assert.equal(JSON.parse(input.at(-1).output).data.rows[0].value, null);
        return reviewed(finish(result));
      }
      assert.ok(tools.every(definition => definition.strict));
      if (calls.length) return calls.shift();
      assert.equal(JSON.parse(input.at(-1).output).data.rows[0].value, null);
      return toolCall("finish_trip", finish(result), "finish");
    },
  } });
  const verified = await engine.plan(night, { useModel: true });
  assert.equal(verified.source, "verified_planner");
  assert.deepEqual(verified.trace.map(entry => entry.step),
    ["plan_routes", "stress_test_route", "ask_user", "get_segment_evidence", "verify", "critic", "finish_trip"]);
  assert.equal(verified.loop.goalState, "needs_user");
  assert.equal(verified.clarification.options.length, 2);
  assert.match(verified.final.text, /เดินประมาณ \d+ นาที/);
  assert.match(verified.text, /ไม่มีข้อมูลไฟ/);
});

test("Critic feedback is returned to the Planner for one bounded rewrite", async () => {
  const result = replay();
  const calls = nightCalls(result);
  const draft = finish(result);
  const revision = { ...draft, text: "บางช่วงยังไม่มีข้อมูลไฟ ประมาณ {duration_min} นาที" };
  const engine = createWorkflows({ model: {
    async turn(role, { input }) {
      if (role === "critic") {
        if (input.length === 1) return toolCall("get_segment_evidence", { segment_ids: ["lane-gap"], factor: "lighting" }, "critic-read");
        const opened = JSON.parse(input[0].content).draft;
        return reviewed(opened, opened.text === draft.text ? "reject" : "accept");
      }
      if (calls.length) return calls.shift();
      const last = JSON.parse(input.at(-1).output);
      if (last.status === "ok") return toolCall("finish_trip", draft, "first");
      assert.equal(last.data.critic_report.verdict, "reject");
      assert.equal(last.dataset_version, result.datasetVersion);
      return toolCall("finish_trip", revision, "second");
    },
  } });
  const response = await engine.plan(night, { useModel: true });
  assert.equal(response.source, "verified_planner");
  assert.equal(response.loop.rejectedFinishes, 1);
  assert.equal(response.loop.criticCalls, 2);
  assert.doesNotMatch(response.final.text, /เดินประมาณ/);
});

test("V7 requires explicit stair-free segments when the user asks to avoid stairs", () => {
  const result = replay();
  const routeId = result.recommendedId;
  const trace = ["plan_routes", "stress_test_route", "ask_user"].map(step => ({ step, status: "ok" }));
  const seenEvidence = new Map([
    ["lane-gap", { factor: "lighting", segment_id: "lane-gap", value: null, dataset_version: result.datasetVersion }],
    [`route:${routeId}`, { factor: "route", route_id: routeId, dataset_version: result.datasetVersion }],
  ]);
  const request = plannerContext({ ...night, noStairs: true }, result).request;
  const checkStairs = stairs => {
    const routes = result.routes.map(route => route.id === routeId
      ? { ...route, segments: route.segments.map((segment, index) => ({ ...segment, stairs: index === 0 ? stairs : false })) }
      : route);
    return verifyFinish(finish(result), trace, { result: { ...result, routes }, request, seenEvidence, needsQuestion: true });
  };
  assert.equal(checkStairs(false).passed, true);
  for (const stairs of [true, undefined]) {
    assert.deepEqual(checkStairs(stairs).checks.filter(check => !check.passed).map(check => check.id), ["V7"]);
  }
});

test("Planner falls back on wrong evidence and conflicting metrics stay out", async () => {
  const result = replay();
  let attempt = 0;
  const engine = createWorkflows({ model: {
    async turn() { return toolCall("finish_trip", { ...finish(result), decision: "ACT" }, `wrong-${++attempt}`); },
  } });
  const response = await engine.plan(night, { useModel: true });
  assert.equal(response.source, "worker");
  assert.equal(response.decision, "VERIFY");
  assert.equal(response.fallback, "verification_failed");
  const corrupted = createWorkflows({ route: () => ({ ...result, routes: [{ ...result.routes[0], lit: 9000 }, result.routes[1]] }) });
  assert.equal((await corrupted.plan(night)).status, "worker_error");
});

test("Responses client sends strict output shape and never stores model state", async () => {
  const usage = [];
  const client = createModelClient({ apiKey: "mock-key", onUsage: item => usage.push(item), fetchImpl: async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-6.1-sol");
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    return new Response(JSON.stringify({ status: "completed", usage: {
      input_tokens: 1300, input_tokens_details: { cached_tokens: 1024, cache_write_tokens: 128 },
      output_tokens: 120, output_tokens_details: { reasoning_tokens: 105 },
    }, output: [
      { type: "message", content: [{ type: "output_text", text: '{"verdict":"accept"}' }] },
    ] }));
  } });
  assert.deepEqual(await client.structured("critic", { input: "x", schema: { type: "object" } }), { verdict: "accept" });
  assert.deepEqual(usage, [{
    role: "critic", model: "gpt-6.1-sol", inputTokens: 1300, outputTokens: 120,
    cachedInputTokens: 1024, cacheWriteTokens: 128, reasoningTokens: 105, status: "completed",
  }]);
});

test("Responses diagnostics record rejected HTTP status without returning the provider body", async () => {
  const requests = [];
  const client = createModelClient({
    apiKey: "mock-key",
    fetchImpl: () => new Response("private error body", { status: 401 }),
    onRequest: event => requests.push(event),
  });
  await assert.rejects(client.structured("intent", { input: "fixture", schema: { type: "object" } }),
    { message: "Model request failed (401)" });
  assert.deepEqual(requests.map(({ elapsedMs, ...request }) => request), [
    { role: "intent", model: "gpt-6.1-terra", outcome: "http_error", httpStatus: 401 },
  ]);
});

test("Companion requires an application event and enforces one event and two notices", async () => {
  const engine = createWorkflows();
  const route = replay().routes.find(option => option.unknown > 0);
  const first = await engine.companion({ event: "unknown", route });
  assert.equal(first.action, "warn");
  assert.equal((await engine.companion({ ...first, event: "unknown", route })).action, "silent");
  const second = await engine.companion({ ...first, event: "closing", route });
  assert.equal(second.action, "offer_replan");
  assert.equal((await engine.companion({ ...second, event: "rain", route })).action, "silent");
});

test("Steward and newsroom outputs stay pending; reviewer identity is separate", async () => {
  const observations = ["a", "b", "c"].map(reporterId => ({
    segmentId: "lane-gap", reporterId, timeBand: "night", value: "lit",
  }));
  const proposal = draftLightingProposal({ segmentId: "lane-gap", timeBand: "night", observations });
  assert.equal(proposal.status, "pending_review");
  const advice = await stewardReview({ proposal, model: { structured: async () => ({ recommendation: "approve" }) } });
  assert.equal(advice.status, "pending_review");
  const duplicate = draftLightingProposal({ segmentId: "lane-gap", timeBand: "night", observations: [observations[0], observations[0], observations[1]] });
  assert.equal(duplicate.status, "insufficient_evidence");
  const news = await draftNews({ text: "There was a temporary closure", sourceUrl: "https://example.org/news?token=demo",
    allowedSegmentIds: ["lane-gap"] }, { structured: async () => ({ category: "closure", happened_on: "2026-02-30",
    published_on: "2026-11-21", segment_id: "private-location" }) });
  assert.equal(news.status, "pending_review");
  assert.equal(news.happenedOn, null);
  assert.equal(news.segmentId, null);
  assert.equal(news.sourceUrl, "https://example.org/news");
  const request = { proposalId: "draft-1", decision: "approve", expectedVersion: "one" };
  assert.equal((await reviewProposal(request, { actor: { id: "model", role: "steward" } })).status, "forbidden");
  const result = await reviewProposal(request, {
    actor: { id: "owner", role: "reviewer" },
    store: { decidePending: async payload => ({ status: "approved", ...payload }) },
  });
  assert.equal(result.reviewerId, "owner");
  assert.equal((await auditPhoto({ consentGranted: false }, { structured: assert.fail })).status, "cannot_tell");
});

test("SOS release, cancel, practice, deduplication, and separate acknowledgement", async () => {
  const started = transitionSos(newSos("test"), "press", 0);
  assert.equal(transitionSos(started, "release", 999).phase, "idle");
  const countdown = transitionSos(started, "hold_elapsed", 1000);
  assert.equal(transitionSos(countdown, "countdown_elapsed", 5999).phase, "countdown");
  assert.equal(transitionSos(countdown, "cancel", 6000).phase, "cancelled");
  const ready = transitionSos(countdown, "countdown_elapsed", 6000);
  assert.equal(transitionSos(transitionSos(ready, "simulate_send", 6000), "simulate_ack", 6100).phase, "simulated_ack");
  assert.equal((await submitSos(ready, { transport: { send: assert.fail } })).status, "practice_only");

  let claimed = false;
  const outbox = {
    async claimConfirmed() {
      if (claimed) return { status: "duplicate" };
      claimed = true;
      return { status: "claimed", verifiedDestination: "test-destination" };
    },
    async recordResult({ status }) { assert.equal(status, "provider_accepted"); },
    async confirmRecipientReceipt({ recipientId }) { return { status: recipientId === "person" ? "acknowledged" : "forbidden" }; },
  };
  const input = { mode: "live", id: "test", recipientId: "person", location: null };
  const deps = { actor: { id: "walker" }, outbox, transport: { send: async () => ({ status: "provider_accepted" }) } };
  const values = await Promise.all([submitSos(input, deps), submitSos(input, deps)]);
  assert.deepEqual(values.map(result => result.status).sort(), ["duplicate", "provider_accepted"]);
  assert.equal((await acknowledgeSos(input, { actor: { id: "person" }, outbox })).status, "acknowledged");
});

test("ElevenLabs client tools expose only open form, ask, and open SOS sheet", async () => {
  let opened = 0;
  const tools = createVoiceTools({ resolveIntent: async ({ text }) => ({ text }),
    askTrip: async question => ({ question }), openSosSheet: () => { opened += 1; } });
  assert.deepEqual(Object.keys(tools), ["plan_trip", "ask_trip", "open_sos_sheet"]);
  assert.equal((await tools.open_sos_sheet({ reason: "emergency_words", send: true })).status, "invalid");
  assert.equal((await tools.open_sos_sheet({ reason: "emergency_words" })).status, "opened");
  assert.equal(opened, 1);
  assert.equal((await getSignedVoiceUrl({})).status, "unavailable");
  const signed = await getSignedVoiceUrl({ apiKey: "test", agentId: "agent_test", fetchImpl: async url => {
    assert.equal(url.searchParams.get("agent_id"), "agent_test");
    return new Response('{"signed_url":"wss://api.elevenlabs.io/v1/convai/conversation?test"}');
  } });
  assert.equal(signed.status, "ok");
});

test("MCP exposes read-only tools for the named fixture and rejects unknown versions", () => {
  const commands = [
    { id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "eval", version: "1" } } },
    { method: "notifications/initialized" },
    { id: 2, method: "tools/list" },
    { id: 3, method: "tools/call", params: { name: "replay_demo_trip", arguments: { mode: "night", dataset_version: "siam-sandbox-1" } } },
    { id: 4, method: "tools/call", params: { name: "get_segment_evidence", arguments: { segment_id: "lane-gap", dataset_version: "live" } } },
  ];
  const proc = spawnSync(process.execPath, ["src/mcp.mjs"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8",
    input: commands.map(cmd => JSON.stringify({ jsonrpc: "2.0", ...cmd })).join("\n") + "\n",
  });
  assert.equal(proc.status, 0, proc.stderr);
  const responses = proc.stdout.trim().split("\n").map(line => JSON.parse(line).result);
  assert.equal(responses[0].serverInfo.name, "walkwe-evidence");
  assert.equal(responses[1].tools.length, 3);
  assert.ok(responses[1].tools.every(tool => tool.annotations.readOnlyHint));
  assert.equal(JSON.parse(responses[2].content[0].text).decision, "VERIFY");
  assert.equal(responses[3].isError, true);
});

test("HTTP API routes validate the request and default to fixture, no provider", async () => {
  const server = createPreviewServer();
  const handler = server.listeners("request")[0];
  async function request(path, method = "GET", payload, origin) {
    let value;
    let code;
    const req = { method, url: path, headers: { host: "127.0.0.1:4178", "content-type": "application/json", origin },
      setEncoding: () => [JSON.stringify(payload)] };
    await handler(req, { writeHead(status) { code = status; }, end(body) { value = JSON.parse(body); } });
    return { code, value };
  }
  assert.equal((await request("/api/status")).value.modelConfigured, false);
  assert.equal((await request("/api/plan", "POST", { request: night })).value.decision, "VERIFY");
  assert.equal((await request("/api/voice/session", "POST", { consent: false })).value.status, "unavailable");
  assert.equal((await request("/api/intent", "POST", { text: "x" }, "https://example.org")).code, 403);
});
