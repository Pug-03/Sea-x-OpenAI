import { byteLength, instructions } from "./context.mjs";
import { verifyDecision } from "./core.mjs";
import { objectSchema, stringEnum } from "./model.mjs";

export const loopLimits = Object.freeze({ plannerSteps: 6, toolCalls: 8, rejectedFinishes: 2, deadlineMs: 20_000 });
const replayByteLimit = 96_000;
const finishSchema = objectSchema({
  route_id: { type: "string" },
  decision: stringEnum("ACT", "VERIFY", "ABSTAIN"),
  evidence_ids: { type: "array", maxItems: 3, items: { type: "string" } },
  reason: stringEnum("shade", "lighting_unknown", "shortest", "lighting_known"),
});
const plannerTools = [
  { type: "function", strict: true, name: "get_segment_evidence",
    description: "Read one segment in the current Worker snapshot.", parameters: objectSchema({ segment_id: { type: "string" } }) },
  { type: "function", strict: true, name: "finish_trip",
    description: "Propose the Worker decision for deterministic verification.", parameters: finishSchema },
];
const criticSchema = objectSchema({ verdict: stringEnum("accept", "reject") });

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

export async function runPlannerHarness({ model, result, facts, evidence, signal: parentSignal, deadlineMs = loopLimits.deadlineMs }) {
  const timeout = AbortSignal.timeout(Math.min(deadlineMs, loopLimits.deadlineMs));
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
  const trace = [];
  const loop = { plannerSteps: 0, toolCalls: 0, evidenceReads: 0, rejectedFinishes: 0, criticCalls: 0 };
  const started = performance.now();
  const summary = (status, fallback) => ({
    verified: status === "verified", trace,
    loop: { ...loop, status, elapsedMs: Math.round(performance.now() - started) },
    ...(fallback ? { fallback } : {}),
  });
  const requiredIds = result.stress.evidenceIds ?? [];
  const readRecords = new Map();
  const seen = new Set();
  const callIds = new Set();
  const input = [{ role: "user", content: JSON.stringify(facts) }];

  try {
    while (loop.plannerSteps < loopLimits.plannerSteps) {
      if (byteLength(input) > replayByteLimit) return summary("fallback", "context_budget");
      loop.plannerSteps += 1;
      const output = await beforeDeadline(() => model.turn("planner", {
        instructions: instructions.planner, input, tools: plannerTools, signal,
      }), signal);
      if (!Array.isArray(output)) return summary("fallback", "invalid_provider_output");
      const actions = output.filter(item => item?.type === "function_call");
      loop.toolCalls += actions.length;
      if (actions.length !== 1 || loop.toolCalls > loopLimits.toolCalls) return summary("fallback", "planner_tool_limit");
      const [action] = actions;
      if (!plannerTools.some(tool => tool.name === action.name)) return summary("fallback", "tool_outside_allowlist");
      if (typeof action.call_id !== "string" || !action.call_id || action.call_id.length > 150
        || typeof action.arguments !== "string" || action.arguments.length > 2_000) return summary("fallback", "invalid_tool_call");

      let args;
      try { args = JSON.parse(action.arguments); } catch { return summary("fallback", "invalid_tool_arguments"); }
      if (!args || Array.isArray(args) || typeof args !== "object") return summary("fallback", "invalid_tool_arguments");
      const reading = action.name === "get_segment_evidence";
      const keys = Object.keys(reading ? plannerTools[0].parameters.properties : finishSchema.properties);
      if (Object.keys(args).length !== keys.length || keys.some(key => !Object.hasOwn(args, key))
        || (reading ? typeof args.segment_id !== "string" : !Array.isArray(args.evidence_ids))) {
        return summary("fallback", "invalid_tool_arguments");
      }
      const signature = JSON.stringify([action.name, reading ? 0 : readRecords.size,
        ...keys.map(key => key === "evidence_ids" ? [...args[key]].sort() : args[key])]);
      if (seen.has(signature)) {
        if (reading) return summary("fallback", "repeated_tool_call");
        loop.rejectedFinishes += 1;
        return summary("fallback", "verification_failed");
      }
      if (callIds.has(action.call_id)) return summary("fallback", "duplicate_call_id");
      seen.add(signature);
      callIds.add(action.call_id);

      if (reading && !evidence.has(args.segment_id)) return summary("fallback", "evidence_outside_snapshot");
      const replay = output.filter(item => item?.type === "reasoning" && typeof item.id === "string"
        && typeof item.encrypted_content === "string")
        .map(({ id, encrypted_content }) => ({ type: "reasoning", id, encrypted_content, summary: [] }));
      input.push(...replay, { type: "function_call", name: action.name, call_id: action.call_id, arguments: action.arguments });
      if (reading) {
        const record = evidence.get(args.segment_id);
        readRecords.set(record.id, record);
        loop.evidenceReads += 1;
        trace.push({ step: action.name, evidenceId: record.id });
        input.push({ type: "function_call_output", call_id: action.call_id, output: JSON.stringify(record) });
        continue;
      }

      const passed = verifyDecision(args, result) && requiredIds.every(id => readRecords.has(id));
      trace.push({ step: "verify", passed });
      if (!passed) {
        loop.rejectedFinishes += 1;
        if (loop.rejectedFinishes >= loopLimits.rejectedFinishes) return summary("fallback", "verification_failed");
        input.push({ type: "function_call_output", call_id: action.call_id,
          output: JSON.stringify({ status: "rejected_by_verifier", unread_evidence_ids: requiredIds.filter(id => !readRecords.has(id)) }) });
        continue;
      }

      const selected = result.routes.find(route => route.id === result.recommendedId);
      const closeCall = result.routes.some(route => route.id !== selected.id && Math.abs(route.minutes - selected.minutes) <= 2);
      if (result.stress.flipped || closeCall) {
        loop.criticCalls += 1;
        const verdict = await beforeDeadline(() => model.structured("critic", {
          instructions: instructions.critic,
          input: JSON.stringify({ facts, proposal: args, evidence: [...readRecords.values()] }),
          schema: criticSchema, signal,
        }), signal);
        const accepted = verdict?.verdict === "accept";
        trace.push({ step: "critic", passed: accepted });
        if (!accepted) return summary("fallback", "critic_rejected");
      }
      return summary("verified");
    }
    return summary("fallback", "planner_step_limit");
  } catch {
    return summary("fallback", signal.aborted ? parentSignal?.aborted ? "cancelled" : "deadline" : "model_unavailable");
  }
}
