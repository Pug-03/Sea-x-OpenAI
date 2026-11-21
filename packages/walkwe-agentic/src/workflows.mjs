import { collectEvidence, instructions, intentContext, plannerContext } from "./context.mjs";
import { companionNotice, formatDecision, hasRouteMarkers, parseIntent, planRoute, voiceText } from "./core.mjs";
import { places as fixturePlaces } from "./fixture.mjs";
import { runPlannerHarness } from "./harness.mjs";
import { modelProfiles, objectSchema, stringEnum } from "./model.mjs";

const allowedModes = ["day", "night", "auto"];
const timeFormat = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const placeValue = { type: ["string", "null"] };
const intentSchema = objectSchema({
  from: placeValue, to: placeValue, mode: { type: ["string", "null"], enum: [...allowedModes, null] },
  time: placeValue, noStairs: { type: "boolean" },
});
const companionSchema = objectSchema({ action: stringEnum("silent", "warn", "offer_replan") });
const noticeLimit = 2;
const stateError = reason => ({ status: reason, decision: "ABSTAIN", routes: [] });

export function createWorkflows({ model = null, route = planRoute, localIntent = parseIntent, places = fixturePlaces } = {}) {
  const placeIds = new Set(places.map(place => place.id));

  async function intent({ text, useModel = false }) {
    if (typeof text !== "string" || !text.trim() || text.length > 500) return { status: "invalid" };
    const localDraft = localIntent(text);
    const context = useModel && model ? intentContext(text, places) : null;
    if (context) {
      try {
        const draft = await model.structured("intent", {
          instructions: instructions.intent, input: JSON.stringify(context),
          schema: intentSchema, signal: AbortSignal.timeout(5000),
        });
        const explicitPlaceConflict = localIntent === parseIntent && hasRouteMarkers(text)
          && (draft?.from !== localDraft.from || draft?.to !== localDraft.to);
        if (validIntent(draft, placeIds) && !explicitPlaceConflict) {
          return { status: "confirm", source: modelProfiles.intent.model, draft };
        }
      } catch {
        // The same form can still confirm a locally parsed draft.
      }
    }
    return {
      status: "confirm", source: "system",
      draft: { ...localDraft, from: placeIds.has(localDraft.from) ? localDraft.from : null, to: placeIds.has(localDraft.to) ? localDraft.to : null },
    };
  }

  async function plan(request, { useModel = false, snapshot, expectedDatasetVersion = snapshot?.datasetVersion, signal } = {}) {
    if (!request || !placeIds.has(request.from) || !placeIds.has(request.to)) return stateError("out_of_coverage");
    let result;
    try {
      result = await route(request, snapshot);
    } catch {
      return stateError("worker_error");
    }
    if (!validateResult(result)) return stateError("worker_error");
    if (result.status !== "ok") return { ...result, routes: [] };
    const evidence = collectEvidence(result);
    if (!evidence || (expectedDatasetVersion && result.datasetVersion !== expectedDatasetVersion)) {
      return stateError("stale_snapshot");
    }
    const clarification = result.stress.flipped && !["direct", "prefer_evidence"].includes(request.preference)
      ? { id: "night_lighting_preference", choices: ["direct", "prefer_evidence"] }
      : null;
    const evidenceWarnings = routeEvidenceWarnings(result, evidence);
    const fallback = { ...result, source: "worker", text: formatDecision(result) + evidenceCaveat(evidenceWarnings),
      trace: [], clarification, evidenceWarnings };
    if (!useModel || !model) return fallback;
    const facts = plannerContext(request, result);
    if (!facts) return { ...fallback, fallback: "context_budget" };
    const { verified, trace, loop, fallback: reason } = await runPlannerHarness({ model, result, facts, evidence, signal });
    return verified
      ? { ...fallback, source: "verified_planner", model: modelProfiles.planner.model, trace, loop }
      : { ...fallback, trace, loop, fallback: reason };
  }

  async function companion({ event, route, warnings = 0, handled = [], useModel = false }) {
    const text = companionNotice(event, route);
    if (!text || !Number.isInteger(warnings) || warnings < 0 || warnings >= noticeLimit
      || !Array.isArray(handled) || handled.includes(event)) {
      return { action: "silent", warnings, handled };
    }
    let action = event === "unknown" ? "warn" : "offer_replan";
    let source = "system";
    if (useModel && model) {
      try {
        const result = await model.structured("companion", {
          instructions: instructions.companion,
          input: JSON.stringify({ event, route: { unknown: route.unknown }, warnings }),
          schema: companionSchema, signal: AbortSignal.timeout(4000),
        });
        if (["warn", "offer_replan"].includes(result?.action)) {
          action = result.action;
          source = modelProfiles.companion.model;
        }
      } catch {
        // A provider outage does not remove app-triggered guidance.
      }
    }
    return { action, source, text, warnings: warnings + 1, handled: [...handled, event] };
  }

  return { intent, plan, companion };
}

function validIntent(value, placeIds) {
  return value && Object.keys(value).length === intentSchema.required.length
    && intentSchema.required.every(key => Object.hasOwn(value, key))
    && [value.from, value.to].every(place => place === null || placeIds.has(place))
    && (value.time === null || (typeof value.time === "string" && timeFormat.test(value.time)))
    && (value.mode === null || allowedModes.includes(value.mode)) && typeof value.noStairs === "boolean";
}

function validateResult(result) {
  if (!result || !["ok", "no_path", "out_of_coverage", "invalid"].includes(result.status)) return false;
  if (result.status !== "ok") return result.decision === "ABSTAIN";
  if (!["day", "night"].includes(result.mode) || typeof result.time !== "string" || !timeFormat.test(result.time)
    || typeof result.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(result.date)
    || typeof result.datasetVersion !== "string" || !Array.isArray(result.routes) || !result.routes.length
    || typeof result.stress?.flipped !== "boolean") return false;
  const metrics = ["minutes", "meters", "lit", "dark", "unknown"];
  if (!result.routes.every(item => typeof item.id === "string" && metrics.every(key => Number.isFinite(item[key]) && item[key] >= 0)
    && (result.mode === "night" || (Number.isFinite(item.sunMinutes) && item.sunMinutes >= 0
      && Number.isFinite(item.shade) && item.shade >= 0 && item.shade <= 100))
    && Array.isArray(item.segments) && item.segments.every(segment => typeof segment.id === "string"
      && Number.isFinite(segment.length) && segment.length > 0 && ["lit", "dark", "unknown"].includes(segment.light))
    && ["lit", "dark", "unknown"].every(status =>
      Math.abs(item[status] - item.segments.reduce((sum, segment) => sum + (segment.light === status ? segment.length : 0), 0)) < 0.5
    ) && Math.abs(item.meters - item.lit - item.dark - item.unknown) < 0.5)) return false;
  const ids = new Set(result.routes.map(item => item.id));
  if (ids.size !== result.routes.length || !ids.has(result.recommendedId) || !ids.has(result.shortestId)) return false;
  if (result.stress.flipped) {
    const unknown = new Set(result.routes.flatMap(item => item.segments.filter(segment => segment.light === "unknown").map(segment => segment.id)));
    return result.mode === "night" && result.decision === "VERIFY" && Array.isArray(result.stress.evidenceIds)
      && result.stress.evidenceIds.length > 0 && result.stress.evidenceIds.length <= 3
      && new Set(result.stress.evidenceIds).size === result.stress.evidenceIds.length
      && result.stress.evidenceIds.every(id => unknown.has(id))
      && ids.has(result.stress.optimisticId) && ids.has(result.stress.pessimisticId)
      && result.stress.optimisticId !== result.stress.pessimisticId;
  }
  return result.decision === "ACT";
}

export function askTrip(question, result) {
  if (typeof question !== "string" || !validateResult(result) || result.status !== "ok") return { status: "no_trip" };
  const evidence = collectEvidence(result);
  if (!evidence) return { status: "no_trip" };
  const route = result.routes.find(item => item.id === result.recommendedId);
  const unknown = route.segments.filter(segment => segment.light === "unknown").map(({ id }) => id);
  const segmentIds = result.mode === "night" ? [...new Set([...unknown, ...(result.stress.evidenceIds ?? [])])] : [];
  return { status: "ok", segmentIds, speak_text: voiceText(result) + evidenceCaveat(routeEvidenceWarnings(result, evidence)) };
}

function routeEvidenceWarnings(result, evidence) {
  if (result.mode !== "night") return [];
  const selected = result.routes.find(route => route.id === result.recommendedId);
  const ids = new Set([...selected.segments.map(segment => segment.id), ...(result.stress.evidenceIds ?? [])]);
  return [...ids].map(id => evidence.get(id)).filter(record => ["stale", "future"].includes(record?.ageStatus))
    .map(({ id, ageStatus }) => ({ segmentId: id, ageStatus }));
}

function evidenceCaveat(warnings) {
  return warnings.length ? " บางช่วงยังยืนยันสถานะไฟไม่ได้ เพราะหลักฐานเก่าหรือวันที่ไม่ตรงกับเวลาเดิน" : "";
}
