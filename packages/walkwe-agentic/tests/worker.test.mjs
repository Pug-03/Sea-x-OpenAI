import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentStepHandler } from "../src/worker.mjs";

const env = {
  WALKWE_STEP_TOKEN: "test-worker-bearer-value-with-at-least-thirty-two",
  WALKWE_STEP_STATE_KEY: "separate-test-continuation-key-with-at-least-thirty-two",
  OPENAI_API_KEY: "provider-test-key",
};
const first = {
  agent: "planner",
  trip_id: "trip-1",
  step_index: 0,
  previous_response_id: null,
  input: { text: "Walk to CentralWorld and call 0812345678", lang: "en", profile: {}, now: "2026-11-21T10:00:00+07:00" },
  tool_outputs: [],
};
const planArgs = {
  origin: { kind: "place", place_id: "siam" }, destination_place_id: "central", depart_at: "now",
  mode: "night", preference: "balanced", avoid_stairs: false, night_factors: ["lit"],
};
const final = {
  decision: "ACT", verdict: "shortest_is_best", recommended_route_id: "route-a", depends_on_segment_ids: [],
  claims: [], text: "The walking route is shown.", card_notes: [], unknowns: [], tool_errors_acknowledged: [], language: "en",
};
const providerOutput = (name, callId, args) => Response.json({
  status: "completed",
  output: [{ type: "function_call", name, call_id: callId, arguments: JSON.stringify(args) }],
  usage: { input_tokens: 1_000, output_tokens: 100, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 20 },
    output_tokens_details: { reasoning_tokens: 40 } },
});
const request = (body, bearer = env.WALKWE_STEP_TOKEN, options = {}) => new Request("https://worker.example/agent/step", {
  method: "POST", headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
  body: JSON.stringify(body), ...options,
});
const envelope = data => JSON.stringify({ status: "ok", data, error: null, dataset_version: "siam-sandbox-1" });
const continuation = responseId => ({
  agent: "planner", trip_id: "trip-1", step_index: 1, previous_response_id: responseId,
  tool_outputs: [{ call_id: "call_1", output: envelope({ route_ids: ["route-a"] }) }],
});

test("worker forwards an allowlisted model step and replays only the matching tool output", async () => {
  const calls = [];
  const handler = createAgentStepHandler({ fetchImpl: async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer " + env.OPENAI_API_KEY);
    const body = JSON.parse(options.body);
    calls.push(body);
    return calls.length === 1 ? providerOutput("plan_routes", "call_1", planArgs) : providerOutput("finish_trip", "call_2", final);
  } });
  const response = await handler(request(first), env);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-cost-usd"), "0.00141");
  assert.equal(result.cost_usd, 0.00141);
  assert.equal(result.usage.reasoningTokens, 40);
  assert.equal(result.status, "tool_calls");
  assert.deepEqual(result.tool_calls, [{ call_id: "call_1", name: "plan_routes", arguments: planArgs }]);
  assert.match(result.response_id, /^[A-Za-z0-9_-]{16}\./);
  assert.equal(calls[0].store, false);
  assert.equal(calls[0].parallel_tool_calls, false);
  const evidenceTool = calls[0].tools.find(tool => tool.name === "get_segment_evidence");
  assert.equal(evidenceTool.parameters.properties.segment_ids.maxItems, 40);
  assert.equal(Object.hasOwn(evidenceTool.parameters.properties.segment_ids, "uniqueItems"), false);
  assert.match(calls[0].input[0].content, /\[phone\]/);
  assert.doesNotMatch(calls[0].input[0].content, /0812345678/);

  const continued = await handler(request(continuation(result.response_id)), env);
  const completed = await continued.json();
  assert.equal(continued.status, 200);
  assert.equal(completed.status, "final");
  assert.deepEqual(completed.final, final);
  assert.equal(completed.tool_calls[0].call_id, "call_2");
  assert.equal(Object.hasOwn(calls[1], "previous_response_id"), false);
  assert.deepEqual(calls[1].input.slice(-2).map(({ type, call_id }) => ({ type, call_id })), [
    { type: "function_call", call_id: "call_1" }, { type: "function_call_output", call_id: "call_1" },
  ]);
});

test("worker verifies continuation ownership, exact tool ID, and fresh request shape", async () => {
  let used = 0;
  const handler = createAgentStepHandler({
    authorize: req => req.headers.get("authorization")?.slice(7),
    fetchImpl: async () => { used += 1; return providerOutput("plan_routes", "call_1", planArgs); },
  });
  const { response_id: responseId } = await (await handler(request(first, "w-a"), env)).json();
  const body = continuation(responseId);
  const replaced = responseId[20] === "a" ? "b" : "a";
  const badRows = [
    [body, "w-b"],
    [{ ...body, trip_id: "trip-2" }, "w-a"],
    [{ ...body, step_index: 2 }, "w-a"],
    [{ ...body, previous_response_id: responseId.slice(0, 20) + replaced + responseId.slice(21) }, "w-a"],
    [{ ...body, tool_outputs: [{ call_id: "forged", output: envelope({}) }] }, "w-a"],
    [{ ...body, tool_outputs: [{ call_id: "call_1", output: envelope({ latitude: 13.746 }) }] }, "w-a"],
    [{ ...body, tool_outputs: [{ call_id: "call_1", output: "not JSON" }] }, "w-a"],
    [{ ...body, input: first.input }, "w-a"],
  ];
  for (const [bad, bearer] of badRows) assert.equal((await handler(request(bad, bearer), env)).status, 400);
  assert.equal(used, 1);
});

test("worker prevents unauthenticated, over-budget and oversized requests from reaching the provider", async () => {
  let used = 0;
  const handler = createAgentStepHandler({ fetchImpl: async () => {
    used += 1;
    throw new Error("Unexpected upstream call");
  } });
  assert.equal((await handler(request(first, "incorrect-token"), env)).status, 403);
  assert.equal((await handler(request(first), { ...env, WALKWE_STEP_STATE_KEY: env.WALKWE_STEP_TOKEN })).status, 503);
  assert.equal((await handler(request({ ...first, step_index: 7 }), env)).status, 422);
  assert.equal((await handler(request({ ...first, agent: "critic", step_index: 4 }), env)).status, 422);
  assert.equal((await handler(request({ ...first, model: "custom" }), env)).status, 400);
  assert.equal((await handler(request(first, env.WALKWE_STEP_TOKEN, { body: "x".repeat(172_001) }), env)).status, 413);
  const limited = await handler(request(first), { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } });
  assert.equal(limited.status, 429);
  assert.equal(used, 0);
});

test("worker maps rate limits and invalid model output without leaking upstream error bodies", async () => {
  const fixtures = [
    { provider: () => new Response("private upstream rate limit", { status: 429 }), expected: 429 },
    { provider: () => new Response("invalid upstream JSON"), expected: 422 },
    { provider: () => providerOutput("publish", "call_1", {}), expected: 422 },
    { provider: () => providerOutput("plan_routes", "call_1", { ...planArgs, origin: { latitude: 13 } }), expected: 422 },
    { provider: () => Response.json({ status: "incomplete", output: [] }), expected: 422 },
  ];
  for (const { provider, expected } of fixtures) {
    const handler = createAgentStepHandler({ fetchImpl: async () => provider() });
    const response = await handler(request(first), env);
    assert.equal(response.status, expected);
    assert.equal((await response.json()).status, "error");
  }
});

test("worker validates structured companion and steward drafts without exposing write tools", async () => {
  const fixtures = [
    ["companion", { action: "silent", trigger: "nightfall", replan_ref: null }],
    ["steward", { proposal_ids: [], segments_reviewed: ["segment-a"], trips_changed: [] }],
  ];
  for (const [agent, final] of fixtures) {
    const handler = createAgentStepHandler({ fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(Object.hasOwn(body, "tools"), false);
      assert.equal(body.text.format.strict, true);
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(final) }] }] });
    } });
    const response = await handler(request({ ...first, agent }), env);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).final, final);
  }
});
