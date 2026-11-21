import { placeholderNames, safeDraftText, verifyFinish } from "../../verify/index.mjs";
import { agentConfig } from "./config.mjs";
import { byteLength, instructions } from "./context.mjs";
import { worthwhileDetour } from "./core.mjs";
import { objectSchema, stringEnum } from "./model.mjs";

export const loopLimits = Object.freeze({
  plannerSteps: agentConfig.plannerMaxSteps, toolCalls: agentConfig.plannerMaxTools,
  rejectedFinishes: agentConfig.plannerMaxRetries, deadlineMs: agentConfig.plannerTimeoutMs,
});
const replayByteLimit = 96_000;
const string = (maxLength = 150) => ({ type: "string", minLength: 1, maxLength });
const nullableId = { ...string(), type: ["string", "null"] };
const array = (items, maxItems, minItems = 0) => ({ type: "array", items, minItems, maxItems });
const ids = (maxItems, minItems = 0) => ({ ...array(string(), maxItems, minItems), uniqueItems: true });
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const tool = (name, description, properties) => ({
  type: "function", strict: true, name, description, parameters: objectSchema(properties),
});
const segmentFactors = ["shade", "lighting", "covered", "stairs", "crossing", "access_hours"];
const claimKinds = ["shade", "sun_minutes", "extra_time", "lighting_known", "lighting_unknown", "covered",
  "stairs", "heat", "rain", "departure_tip", "data_gap", "other"];
const finishProperties = {
  decision: stringEnum("ACT", "VERIFY", "ABSTAIN"),
  verdict: stringEnum("recommend", "recommend_with_caveat", "shortest_is_best", "not_enough_data"),
  recommended_route_id: nullableId,
  depends_on_segment_ids: ids(3),
  claims: array(objectSchema({ claim_id: string(), kind: stringEnum(...claimKinds),
    evidence_ids: ids(40, 1), placeholders: array(stringEnum(...placeholderNames), 10) }), 8),
  text: string(400),
  card_notes: array(objectSchema({ route_id: string(), trust: stringEnum("stable", "depends_on"), note: string(90) }), 6),
  unknowns: array(stringEnum(...segmentFactors), 6),
  tool_errors_acknowledged: ids(8),
  language: stringEnum("th", "en"),
};
const reportProperties = {
  claim_checks: array(objectSchema({
    claim_id: string(),
    result: stringEnum("supported", "unsupported", "contradicts", "not_checkable"),
    reason: stringEnum("ok", "unsupported_claim", "number_mismatch", "imputed_unknown", "stale_data", "out_of_coverage",
      "user_reported_as_fact", "ignored_constraint", "injected_instruction"),
    evidence_ids: ids(40),
  }), 8),
  wording_flags: array(stringEnum("absolute_claim", "number_in_words", "night_shade_claim", "none"), 3),
  verdict: stringEnum("accept", "reject"),
};
const readEvidence = tool("get_segment_evidence", "Read facts about segments returned by the trip routing worker.", {
  segment_ids: ids(40, 1), factor: stringEnum(...segmentFactors),
});
const routeIds = ids(6, 1);
export const plannerTools = [
  tool("find_place", "Look up a confirmed place in the pilot catalogue.", { query: string(80), near_place_id: nullableId }),
  tool("plan_routes", "Get candidate routes for the confirmed origin, destination, departure and constraints.", {
    origin: objectSchema({ kind: stringEnum("place", "current_location"), place_id: nullableId }),
    destination_place_id: string(),
    depart_at: string(40),
    mode: stringEnum("day", "night", "auto"),
    preference: stringEnum("shade_first", "lit_first", "short_first", "balanced"),
    avoid_stairs: { type: "boolean" },
    night_factors: array(stringEnum("lit", "cctv", "crowded"), 3),
  }),
  tool("compare_routes", "Compare Worker candidates against the given route.", { route_ids: routeIds, baseline_route_id: string() }),
  tool("stress_test_route", "Check all returned candidates under optimistic and pessimistic assumptions.", { route_ids: routeIds }),
  tool("rank_unknowns", "Rank unknown factors on previously returned routes.", {
    route_ids: routeIds, factor: stringEnum("lighting", "shade", "covered"), limit: integer(1, 5),
  }),
  tool("suggest_departure", "Check whether leaving later reduces direct sun on the same route.", {
    route_id: string(), max_delay_min: integer(5, 30),
  }),
  tool("get_weather", "Check for trusted weather evidence attached to the trip snapshot.", { time: string(40) }),
  readEvidence,
  tool("ask_user", "Ask for one walking preference when the result flips and another route has known lighting.", {
    kind: stringEnum("place", "preference"), text: string(160),
    options: array(objectSchema({ label: string(60), ref: string() }), 3, 2),
  }),
  tool("critic_review", "Ask the independent Critic to review this draft against the same routing evidence.", {
    draft: objectSchema(finishProperties), focus_claim_ids: ids(8),
  }),
  tool("create_collection_task", "Request data collection for an unknown segment when a task service is available.", {
    segment_id: string(), attribute: stringEnum("lighting_night", "covered"), reason: stringEnum("changes_route", "no_detour", "stale"),
  }),
  tool("finish_trip", "Submit a supported answer after routing, stress testing and reading any deciding evidence.", finishProperties),
];
export const criticTools = [
  readEvidence,
  tool("finish_review", "Give a structured verdict after checking every claim against its cited evidence.", reportProperties),
];

export function validToolArgs(value, schema) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (Array.isArray(schema.type) && value === null) return schema.type.includes("null");
  const type = Array.isArray(schema.type) ? schema.type.find(candidate => candidate !== "null") : schema.type;
  switch (type) {
    case "object":
      return Boolean(value && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).length === schema.required.length
        && schema.required.every(key => Object.hasOwn(value, key) && validToolArgs(value[key], schema.properties[key])));
    case "array":
      return Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Infinity)
        && (!schema.uniqueItems || new Set(value).size === value.length)
        && value.every(item => validToolArgs(item, schema.items));
    case "string":
      return typeof value === "string" && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity);
    case "integer":
      return Number.isInteger(value) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
}

async function beforeDeadline(work, signal) {
  signal.throwIfAborted();
  let abort;
  const deadline = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    const value = await Promise.race([Promise.resolve().then(work), deadline]);
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function parseCall(output, tools, callIds) {
  if (!Array.isArray(output)) return { reason: "invalid_provider_output" };
  const actions = output.filter(item => item?.type === "function_call");
  if (actions.length !== 1) return { reason: "planner_tool_limit" };
  const [action] = actions;
  const definition = tools.find(item => item.name === action.name);
  if (!definition) return { reason: "tool_outside_allowlist" };
  if (typeof action.call_id !== "string" || !/^[\w-]{1,150}$/.test(action.call_id)
    || typeof action.arguments !== "string" || action.arguments.length > 12_000) return { reason: "invalid_tool_call" };
  if (callIds.has(action.call_id)) return { reason: "duplicate_call_id" };
  let args;
  try { args = JSON.parse(action.arguments); } catch { return { reason: "invalid_tool_arguments" }; }
  if (!validToolArgs(args, definition.parameters)) return { reason: "invalid_tool_arguments" };
  callIds.add(action.call_id);
  return { action, args };
}

function replayCall(input, output, action, response) {
  const reasoning = output.filter(item => item?.type === "reasoning" && typeof item.id === "string"
    && typeof item.encrypted_content === "string")
    .map(({ id, encrypted_content }) => ({ type: "reasoning", id, encrypted_content, summary: [] }));
  input.push(...reasoning,
    { type: "function_call", name: action.name, call_id: action.call_id, arguments: action.arguments },
    { type: "function_call_output", call_id: action.call_id, output: JSON.stringify(response) });
}

const signature = (name, args) => JSON.stringify([name, args], (_, value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
const sameIds = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));
const itineraryRef = route => `route:${route.id}`;
const routeMetrics = route => ({
  duration_min: route.minutes, length_m: route.meters, shade_pct: route.shade, sun_minutes: route.sunMinutes,
  known_lit_m: route.lit, unknown_m: route.unknown, longest_unknown_m: route.longestUnknown,
  covered_m: route.covered, stairs_count: route.segments.every(segment => typeof segment.stairs === "boolean")
    ? route.segments.filter(segment => segment.stairs).length : null,
});
const cardTrust = (route, depends) => route.segments.some(segment => depends.includes(segment.id)) ? "depends_on" : "stable";

function evidenceRows(routes, records, ids, factor, version) {
  return ids.flatMap(id => {
    const record = records.get(id);
    const common = {
      segment_id: id, factor, method: record.method, observed_at: record.observedAt,
      trust: record.trust, stale: ["stale", "future"].includes(record.ageStatus), dataset_version: version,
    };
    if (factor === "lighting") {
      return [{ ...common, evidence_id: id, value: record.light === "unknown" ? null : record.light }];
    }
    return routes.flatMap(route => route.segments.filter(segment => segment.id === id).map(segment => {
      const value = segment[factor === "shade" ? "shaded" : factor === "access_hours" ? "hours" : factor];
      const available = ["shade", "covered"].includes(factor) ? Number.isFinite(value) && value >= 0 && value <= 1
        : ["stairs", "crossing"].includes(factor) ? typeof value === "boolean"
          : Array.isArray(value) && value.length === 2 && value.every(hour => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hour));
      return {
        ...common, evidence_id: `${factor}:${route.id}:${id}`, route_id: route.id,
        value: !available ? null : factor === "access_hours" ? { open: value[0], close: value[1] } : value,
        method: available ? "computed" : "no_data", observed_at: null, trust: "source", stale: false,
      };
    }));
  });
}

async function reviewDraft({ model, final, focus, seenEvidence, request, signal, envelope }) {
  const claims = final.claims.filter(claim => !focus.length || focus.includes(claim.claim_id));
  const records = new Map(claims.flatMap(claim => claim.evidence_ids)
    .map(id => [id, seenEvidence.get(id)]).filter(([, record]) => Boolean(record)));
  const segmentIds = new Set([...records.values()].map(record => record.segment_id).filter(Boolean));
  const initial = {
    draft: final, mode: request.mode, focus_claim_ids: focus,
    segment_evidence: [...records.values()].filter(record => record.segment_id)
      .map(({ segment_id, evidence_id, factor }) => ({ segment_id, evidence_id, factor })),
    trip_facts: [...records.values()].filter(record => !record.segment_id),
  };
  const input = [{ role: "user", content: JSON.stringify(initial) }];
  const read = new Set();
  const calls = new Set();
  for (let step = 0; step < 3 && byteLength(input) <= replayByteLimit; step += 1) {
    const output = await beforeDeadline(() => model.turn("critic", { instructions: instructions.critic, input, tools: criticTools, signal }), signal);
    const { action, args, reason } = parseCall(output, criticTools, calls);
    if (reason) return { verdict: "reject", reason };
    if (action.name === "finish_review") {
      const checked = new Map(args.claim_checks.map(check => [check.claim_id, check]));
      const complete = args.claim_checks.length === claims.length && checked.size === claims.length && claims.every(claim => {
        const check = checked.get(claim.claim_id);
        return check?.result === "supported" && check.reason === "ok"
          && sameIds(check.evidence_ids, claim.evidence_ids)
          && check.evidence_ids.every(id => records.has(id) && (!records.get(id).segment_id || read.has(id)));
      });
      return { ...args, verdict: complete && args.wording_flags.every(flag => flag === "none") ? args.verdict : "reject" };
    }
    if (args.segment_ids.some(id => !segmentIds.has(id))) break;
    const found = [...records.values()].filter(record => args.segment_ids.includes(record.segment_id) && record.factor === args.factor);
    if (!found.some(record => !read.has(record.evidence_id))) break;
    for (const record of found) read.add(record.evidence_id);
    replayCall(input, output, action, envelope("ok", { rows: found }));
  }
  return { verdict: "reject", reason: "critic_evidence_missing" };
}

export async function runPlannerHarness({
  model, result, facts, evidence, places = [], rankUnknowns, suggestDeparture,
  signal: parentSignal, deadlineMs = loopLimits.deadlineMs,
}) {
  const timeout = AbortSignal.timeout(Math.min(deadlineMs, loopLimits.deadlineMs));
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
  const trace = [];
  const loop = { plannerSteps: 0, toolCalls: 0, evidenceReads: 0, rejectedFinishes: 0, criticCalls: 0 };
  const started = performance.now();
  const request = facts.request;
  const routeSet = new Map(result.routes.map(route => [route.id, route]));
  const depends = result.stress.evidenceIds ?? [];
  const questionNeeded = result.stress.flipped && !request.preference && result.routes.some(item => item.unknown === 0);
  const input = [{ role: "user", content: JSON.stringify(facts) }];
  const seenEvidence = new Map();
  const seen = new Set();
  const callIds = new Set();
  let question = null;
  let revision = null;
  let noProgress = 0;

  const envelope = (status, data = {}, error = null) => ({ status, data, error, dataset_version: result.datasetVersion });
  const problem = code => envelope("error", {}, { code, message: code });
  const finish = (status, fallback, final) => ({
    verified: status === "verified", trace, question,
    loop: {
      ...loop, status, elapsedMs: Math.round(performance.now() - started),
      goalState: status === "verified" ? question ? "needs_user" : "completed_verified"
        : /limit|deadline|budget/.test(fallback) ? "budget_limited" : "failed",
    },
    ...(fallback ? { fallback } : {}),
    ...(final ? { final } : {}),
  });
  const routed = () => trace.some(entry => entry.step === "plan_routes" && entry.status === "ok");
  const stressTested = () => trace.some(entry => entry.step === "stress_test_route" && entry.status === "ok");
  const checkDraft = args => verifyFinish(args, trace, { result, request, seenEvidence, needsQuestion: questionNeeded, worthwhileDetour });
  const criticNeeded = result.stress.flipped || result.routes.some(route => route.id !== result.recommendedId
    && Math.abs(route.minutes - routeSet.get(result.recommendedId).minutes) <= agentConfig.closeCallMinutes);
  const checkWithCritic = async (draft, focus) => {
    loop.criticCalls += 1;
    const report = await reviewDraft({ model, final: draft, focus, seenEvidence, request, signal, envelope });
    trace.push({ step: "critic", passed: report.verdict === "accept" });
    return report;
  };
  const remember = record => { seenEvidence.set(record.evidence_id, record); };
  const routeArgs = args => args.route_ids.every(id => routeSet.has(id));
  const runTool = async (name, args) => {
    if (name === "find_place") {
      const query = args.query.trim().toLocaleLowerCase("en");
      const candidates = places.filter(place => query && [place.id, place.name, place.en].some(value => value.toLocaleLowerCase("en").includes(query)))
        .slice(0, 8).map(place => ({ place_id: place.id, name_th: place.name, name_en: place.en, in_pilot: true }));
      return envelope(candidates.length ? "ok" : "no_data", { candidates });
    }
    if (name === "plan_routes") {
      if (args.origin.place_id !== request.from || args.destination_place_id !== request.to
        || !["now", request.depart_at].includes(args.depart_at) || ![request.mode, "auto"].includes(args.mode)
        || args.avoid_stairs !== request.noStairs) return problem("confirmed_request_mismatch");
      const routes = result.routes.map(route => {
        const row = {
          route_id: route.id, evidence_id: itineraryRef(route), metrics: routeMetrics(route),
          segment_ids: route.segments.map(segment => segment.id),
          trust: cardTrust(route, depends),
        };
        remember({ evidence_id: row.evidence_id, route_id: route.id, factor: "route", value: row.metrics, dataset_version: result.datasetVersion });
        return row;
      });
      return envelope("ok", { routes, shortest_route_id: result.shortestId });
    }
    if (name === "get_weather" || name === "create_collection_task") return envelope("no_data");
    if (!routed()) return problem("plan_routes_first");
    if (args.route_ids && !routeArgs(args)) return problem("unknown_route");
    if (name === "compare_routes") {
      const baseline = routeSet.get(args.baseline_route_id);
      if (!baseline) return problem("unknown_route");
      return envelope("ok", { routes: args.route_ids.map(id => {
        const route = routeSet.get(id);
        return {
          route_id: id, extra_min: route.minutes - baseline.minutes,
          profile: route.segments.map(segment => ({
            segment_id: segment.id,
            state: result.mode === "night" ? segment.light : segment.shaded == null ? "unknown" : segment.shaded >= 0.5 ? "shade" : "sun",
          })),
        };
      }) });
    }
    if (name === "stress_test_route") {
      if (!sameIds(args.route_ids, [...routeSet.keys()])) return problem("use_all_returned_routes");
      return envelope("ok", {
        mode: result.mode, flips: result.stress.flipped, decision: result.decision, verdict: result.stress.flipped ? "recommend_with_caveat"
          : result.recommendedId === result.shortestId ? "shortest_is_best" : "recommend",
        recommended_route_id: result.recommendedId,
        winner_if_unknown_lit: result.stress.optimisticId ?? result.recommendedId,
        winner_if_unknown_dark: result.stress.pessimisticId ?? result.recommendedId,
        depends_on: depends.map(segment_id => ({ segment_id })),
        ask_preference: questionNeeded,
      });
    }
    if (name === "rank_unknowns") {
      const items = rankUnknowns?.(args.route_ids.map(id => routeSet.get(id)), args.factor, args.limit) ?? [];
      return envelope(items.length ? "ok" : "no_data", { items });
    }
    if (name === "suggest_departure") {
      if (!routeSet.has(args.route_id)) return problem("unknown_route");
      const proposed = await suggestDeparture?.(args.route_id, args.max_delay_min);
      if (!proposed) return envelope("no_data");
      const record = { evidence_id: `departure:${args.route_id}`, factor: "departure", value: proposed, dataset_version: result.datasetVersion };
      remember(record);
      return envelope("ok", { ...proposed, evidence_id: record.evidence_id });
    }
    if (name === "get_segment_evidence") {
      const rows = evidenceRows(result.routes, evidence, args.segment_ids, args.factor, result.datasetVersion);
      for (const row of rows) remember(row);
      loop.evidenceReads += rows.length;
      return envelope("ok", { rows });
    }
    if (name === "ask_user") {
      if (!stressTested() || args.kind !== "preference" || !questionNeeded || question
        || !safeDraftText(args.text, 160) || !sameIds(args.options.map(option => option.ref), [result.stress.optimisticId, result.stress.pessimisticId])
        || args.options.some(option => !safeDraftText(option.label, 60))) return problem("invalid_clarification");
      const english = request.language === "en";
      question = {
        id: "night_lighting_preference", choices: ["direct", "prefer_evidence"],
        text: english ? "Take the direct route or prefer the route with more lighting evidence?"
          : "ต้องการเดินทางตรงหรือเลือกทางที่มีข้อมูลไฟมากกว่า?",
        options: [
          { label: english ? "Direct route" : "เดินทางตรง", ref: result.stress.optimisticId },
          { label: english ? "More lighting evidence" : "มีข้อมูลไฟมากกว่า", ref: result.stress.pessimisticId },
        ],
      };
      return envelope("no_data", { chosen_ref: null, waiting_for_user: true });
    }
    if (name === "critic_review") {
      const checks = checkDraft(args.draft);
      if (!checks.passed || args.focus_claim_ids.some(id => !args.draft.claims.some(claim => claim.claim_id === id))) {
        return problem("draft_failed_verification");
      }
      const report = await checkWithCritic(args.draft, args.focus_claim_ids);
      if (!args.focus_claim_ids.length) revision = { draft: signature("finish_trip", args.draft), report };
      return envelope("ok", report);
    }
    return problem("unsupported_tool");
  };

  try {
    while (loop.plannerSteps < loopLimits.plannerSteps) {
      if (byteLength(input) > replayByteLimit) return finish("fallback", "context_budget");
      loop.plannerSteps += 1;
      const output = await beforeDeadline(() => model.turn("planner", { instructions: instructions.planner, input, tools: plannerTools, signal }), signal);
      const { action, args, reason } = parseCall(output, plannerTools, callIds);
      if (reason) return finish("fallback", reason);
      if (++loop.toolCalls > loopLimits.toolCalls) return finish("fallback", "planner_tool_limit");
      const key = signature(action.name, args);
      if (seen.has(key)) return finish("fallback", action.name === "finish_trip" ? "verification_failed" : "repeated_tool_call");
      seen.add(key);
      if (action.name === "get_segment_evidence" && args.segment_ids.some(id => !evidence.has(id))) {
        return finish("fallback", "evidence_outside_snapshot");
      }
      if (action.name === "finish_trip") {
        const verification = checkDraft(args);
        const failed = verification.checks.filter(check => !check.passed);
        trace.push({ step: "verify", passed: verification.passed, checks: verification.checks });
        if (!verification.passed) {
          loop.rejectedFinishes += 1;
          if (loop.rejectedFinishes >= loopLimits.rejectedFinishes) return finish("fallback", "verification_failed");
          replayCall(input, output, action, envelope("error", {}, {
            checks_failed: failed.map(check => check.id), detail: failed.map(check => check.detail).join(", "),
          }));
          continue;
        }
        if (criticNeeded) {
          const report = revision?.draft === key ? revision.report : await checkWithCritic(args, []);
          if (report.verdict !== "accept") {
            loop.rejectedFinishes += 1;
            if (loop.rejectedFinishes >= loopLimits.rejectedFinishes || loop.plannerSteps >= loopLimits.plannerSteps) {
              return finish("fallback", "critic_rejected");
            }
            replayCall(input, output, action, envelope("error", { critic_report: report }, {
              checks_failed: ["critic"], detail: "revise_claims_against_observed_evidence",
            }));
            continue;
          }
        }
        trace.push({ step: "finish_trip", callId: action.call_id, status: "ok" });
        return finish("verified", null, { ...args, text: verification.text });
      }

      const priorEvidence = seenEvidence.size;
      let response;
      try {
        response = await beforeDeadline(() => runTool(action.name, args), signal);
      } catch (error) {
        if (signal.aborted) throw error;
        response = problem("tool_failed");
      }
      trace.push({
        step: action.name, callId: action.call_id, status: response.status,
        ...(action.name === "get_segment_evidence" ? { evidenceIds: response.data.rows?.map(row => row.evidence_id) ?? [] } : {}),
      });
      const progress = (response.status === "ok" && action.name !== "get_segment_evidence")
        || seenEvidence.size > priorEvidence || (action.name === "ask_user" && question);
      noProgress = progress ? 0 : noProgress + 1;
      if (noProgress >= 2) return finish("fallback", "no_tool_progress");
      replayCall(input, output, action, response);
    }
    return finish("fallback", "planner_step_limit");
  } catch {
    return finish("fallback", signal.aborted ? parentSignal?.aborted ? "cancelled" : "deadline" : "model_unavailable");
  }
}
