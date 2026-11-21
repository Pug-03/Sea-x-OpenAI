const banned = /ปลอดภัย|ไม่มีอันตราย|ไม่อันตราย|\b(?:safe|safer|safest|secure)\b/iu;
const numeric = /\p{Decimal_Number}/u;
const shadeAtNight = /ร่มเงา|เงาอาคาร|แดด|\b(?:shade[ds]?|sun(?:light|ny)?)\b/iu;
const toolProblem = /เครื่องมือ.*(?:ขัดข้อง|ล้มเหลว|ใช้ไม่ได้|ไม่สำเร็จ)|\btool\b.*\b(?:failed|error|unavailable)\b/iu;
const oldEvidence = /เก่า|ล้าสมัย|ไม่ตรงกับเวลา|\b(?:stale|outdated|old)\b/iu;
const reported = /ผู้ใช้รายงาน|รายงานจากผู้ใช้|user.reported|reported by (?:a |the )?user/iu;
const missingLight = /ไม่(?:มี|ทราบ|รู้)ข้อมูล(?:ไฟ|แสง)|(?:ไฟ|แสง).*(?:ไม่ทราบ|ไม่ชัดเจน)|\b(?:unknown|unverified|missing)\b/iu;
const timeMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const sameIds = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));

const factors = {
  shade: ["shade"], sun_minutes: ["shade", "route"], extra_time: ["route"],
  lighting_known: ["lighting"], lighting_unknown: ["lighting"],
  covered: ["covered"], stairs: ["stairs"], heat: ["weather"], rain: ["weather"],
  departure_tip: ["departure"], data_gap: ["lighting", "shade", "covered", "stairs", "crossing", "access_hours"],
  other: ["route", "crossing", "access_hours"],
};
const placeholders = {
  duration_min: ["route"], length_m: ["route"], shade_pct: ["shade", "route"], sun_min: ["shade", "route"],
  extra_min: ["route"], unknown_m: ["lighting", "route"], known_lit_m: ["lighting", "route"],
  depart_time: ["route", "departure"], close_time: ["access_hours"], heat_tier: ["weather"],
};
export const placeholderNames = Object.keys(placeholders).map(key => `{${key}}`);

export function safeDraftText(value, limit) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit
    && !numeric.test(value.normalize("NFKC")) && !banned.test(value.normalize("NFKC"));
}

function routeConstraints(route, request, result) {
  return (!request.noStairs || route.segments.every(segment => segment.stairs === false))
    && (request.maxMinutes === null || route.minutes <= request.maxMinutes)
    && (request.arriveBy === null || timeMinutes(result.time) + route.minutes <= timeMinutes(request.arriveBy));
}

function verifiedValues(selected, result, records) {
  const shortest = result.routes.find(route => route.id === result.shortestId);
  const weather = records.find(record => record.factor === "weather")?.value;
  const departure = records.find(record => record.factor === "departure")?.value;
  const closingValues = new Set(records.filter(record => record.factor === "access_hours").map(record => record.value?.close));
  return {
    duration_min: selected.minutes, length_m: selected.meters, shade_pct: selected.shade,
    sun_min: selected.sunMinutes, extra_min: selected.minutes - shortest.minutes, unknown_m: selected.unknown,
    known_lit_m: selected.lit, depart_time: departure?.depart_at?.slice(11, 16) || result.time,
    close_time: closingValues.size === 1 ? [...closingValues][0] : null, heat_tier: weather?.heat_tier,
  };
}

export function verifyFinish(final, trace, { result, request, seenEvidence, needsQuestion, worthwhileDetour }) {
  const checks = [];
  const check = (id, passed, detail) => checks.push({ id, passed: Boolean(passed), detail: passed ? null : detail });
  const route = result.routes.find(item => item.id === final.recommended_route_id);
  const cards = final.card_notes;
  const texts = [final.text, ...cards.map(card => card.note)];
  const allClaimIds = final.claims.flatMap(claim => claim.evidence_ids);
  const records = allClaimIds.map(id => seenEvidence.get(id)).filter(Boolean);
  const values = route ? verifiedValues(route, result, records) : {};
  const usedSlots = [...final.text.matchAll(/\{([a-z_]+)\}/g)].map(match => match[0]);
  const chosenSlots = new Set(final.claims.flatMap(claim => claim.placeholders));
  const slotValues = usedSlots.every(slot => chosenSlots.has(slot) && values[slot.slice(1, -1)] != null);
  const unresolved = /[{}]/.test(final.text.replace(/\{[a-z_]+\}/g, ""));
  const flagText = texts.map(value => value.normalize("NFKC"));
  check("V1", !unresolved && slotValues && flagText.every(value => !numeric.test(value))
    && cards.every(card => !/[{}]/.test(card.note)), "use_worker_placeholders_only");
  check("V2", flagText.every(value => !banned.test(value)), "remove_absolute_safety_wording");
  const nightLightingUnknown = result.mode === "night" && Boolean(route?.unknown || result.stress.flipped);
  check("V3", (!nightLightingUnknown || (final.unknowns.includes("lighting") && missingLight.test(final.text)))
    && records.filter(record => record.segment_id && record.value === null).every(record => final.unknowns.includes(record.factor))
    && final.claims.every(claim => claim.kind !== "lighting_known" || claim.evidence_ids.some(id => {
      const record = seenEvidence.get(id);
      return record?.factor === "lighting" && ["lit", "dark"].includes(record.value);
    })), "acknowledge_unknown_lighting");
  check("V4", result.mode !== "night" || (!flagText.some(value => shadeAtNight.test(value))
    && !final.claims.some(claim => ["shade", "sun_minutes"].includes(claim.kind))
    && ![...chosenSlots].some(slot => ["{shade_pct}", "{sun_min}"].includes(slot))), "omit_shade_at_night");
  check("V5", final.claims.length > 0 && new Set(final.claims.map(claim => claim.claim_id)).size === final.claims.length
    && final.claims.every(claim => {
      const claimed = claim.evidence_ids.map(id => seenEvidence.get(id));
      const relevant = factors[claim.kind];
      return claimed.every(Boolean) && claimed.some(record => relevant.includes(record.factor))
        && claimed.every(record => relevant.includes(record.factor) || record.factor === "route")
        && (claim.kind === "data_gap" ? claimed.some(record => record.value === null)
          : claim.kind !== "lighting_unknown" || claimed.some(record => record.value === null))
        && (claim.kind !== "lighting_known" || claimed.filter(record => record.factor === "lighting")
          .every(record => ["lit", "dark"].includes(record.value) && route?.segments.some(segment => segment.id === record.segment_id)))
        && (claim.kind !== "lighting_unknown" || claimed.filter(record => record.factor === "lighting").every(record => record.value === null))
        && claim.placeholders.every(slot => claimed.some(record => placeholders[slot.slice(1, -1)].includes(record.factor)
          && (record.factor !== "route" || record.route_id === final.recommended_route_id)));
    }), "cite_matching_tool_evidence");
  check("V6", records.every(record => record.dataset_version === result.datasetVersion)
    && (!records.some(record => record.stale) || oldEvidence.test(final.text))
    && (!records.some(record => record.trust === "user_reported") || reported.test(final.text)),
  "label_stale_and_user_reported_evidence");
  check("V7", route && routeConstraints(route, request, result) && final.language === request.language,
    "respect_confirmed_trip_constraints");
  const planned = trace.some(entry => entry.step === "plan_routes" && entry.status === "ok");
  const tested = trace.some(entry => entry.step === "stress_test_route" && entry.status === "ok");
  const asked = trace.some(entry => entry.step === "ask_user" && ["ok", "no_data"].includes(entry.status));
  const depends = result.stress.evidenceIds ?? [];
  const usedDepends = depends.every(id => seenEvidence.has(id) && final.claims.some(claim =>
    ["lighting_unknown", "data_gap"].includes(claim.kind) && claim.evidence_ids.includes(id)));
  const caveatFirst = missingLight.test(final.text.split(/[.!?\n]/u, 1)[0]);
  const allowedDetour = result.mode !== "day" || route?.id === result.shortestId
    || (route && worthwhileDetour(route, result.routes.find(item => item.id === result.shortestId)));
  const verdict = result.stress.flipped ? "recommend_with_caveat"
    : result.recommendedId === result.shortestId ? "shortest_is_best" : "recommend";
  check("V8", planned && tested && (!needsQuestion || asked) && usedDepends && allowedDetour
    && final.decision === result.decision && final.recommended_route_id === result.recommendedId
    && final.verdict === verdict && sameIds(final.depends_on_segment_ids, depends)
    && (!result.stress.flipped || caveatFirst)
    && sameIds(cards.map(card => card.route_id), result.routes.map(item => item.id))
    && cards.every(card => {
      const candidate = result.routes.find(item => item.id === card.route_id);
      return candidate && card.trust === (candidate.segments.some(segment => depends.includes(segment.id)) ? "depends_on" : "stable");
    }), "follow_worker_stress_test_and_disclose_the_caveat");
  const errors = trace.filter(entry => entry.status === "error").map(entry => entry.callId);
  check("G-tool", sameIds(final.tool_errors_acknowledged, errors) && (!errors.length || toolProblem.test(final.text)),
    "acknowledge_tool_errors");
  const passed = checks.every(result => result.passed);
  return {
    passed, checks,
    ...(passed ? { text: final.text.replace(/\{([a-z_]+)\}/g, (_, key) => String(values[key])) } : {}),
  };
}
