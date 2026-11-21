import { placeholderNames } from "../../../../verify/index.mjs";
import { objectSchema, stringEnum } from "../../integrations/openai.mjs";

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
