import { evidenceAge } from "./context.mjs";
import { agentConfig } from "./config.mjs";
import { edges, outsidePilotNames, places, referenceDate, version } from "./fixture.mjs";

const radians = Math.PI / 180;
const speed = agentConfig.walkSpeedMetersPerSecond;
const bkk = 7 * 60 * 60 * 1000;
const banned = /ปลอดภัย|ไม่มีอันตราย|ไม่อันตราย|\b(?:safe|safer|safest|secure)\b/i;
const statuses = new Set(["lit", "dark", "unknown"]);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const lightingPenalty = 2;
const normalize = text => text.toLowerCase().normalize("NFKC").replace(/[\s.-]/g, "");
const round = (value, decimals = 0) => Number(value.toFixed(decimals));
const bearing = value => ((value % 360) + 360) % 360;
const routeMarkers = /จาก|ไป(?:ยัง)?|\b(?:from|to)\b/giu;
export const hasRouteMarkers = text => [...text.matchAll(routeMarkers)].length > 0;

function bangkokTime(date, time) {
  return Date.parse(`${date}T${time}:00+07:00`);
}

function bangkokDateTime(instant) {
  return new Date(instant + bkk).toISOString().slice(0, 19) + "+07:00";
}

export function normalizeSun(position, major) {
  if (major === 1) return { altitude: position.altitude / radians, azimuth: bearing(position.azimuth / radians + 180) };
  if (major === 2) return { altitude: position.altitude, azimuth: bearing(position.azimuth) };
  throw new Error("Unsupported SunCalc version");
}

export function shadowLength(height, altitude) {
  return altitude > 0 ? height / Math.tan(Math.max(5, altitude) * radians) : 0;
}

// Compact solar approximation for the fixture. The production adapter can supply SunCalc instead.
export function pilotSun(instant) {
  const day = new Date(instant);
  const annualAngle = (Math.PI * 2 / 365) * ((instant - Date.UTC(day.getUTCFullYear(), 0, 1)) / 86400000);
  const declination = 0.006918 - 0.399912 * Math.cos(annualAngle) + 0.070257 * Math.sin(annualAngle)
    - 0.006758 * Math.cos(2 * annualAngle) + 0.000907 * Math.sin(2 * annualAngle)
    - 0.002697 * Math.cos(3 * annualAngle) + 0.00148 * Math.sin(3 * annualAngle);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(annualAngle) - 0.032077 * Math.sin(annualAngle)
    - 0.014615 * Math.cos(2 * annualAngle) - 0.040849 * Math.sin(2 * annualAngle));
  const minute = day.getUTCHours() * 60 + day.getUTCMinutes();
  const hourAngle = ((minute + equationOfTime + 4 * 100.535) / 4 - 180) * radians;
  const latitude = 13.746 * radians;
  const elevation = Math.asin(Math.sin(latitude) * Math.sin(declination)
    + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
  const azimuth = Math.atan2(Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude));
  return { altitude: elevation / radians, azimuth: bearing(azimuth / radians + 180) };
}

export function findPlace(name) {
  const query = normalize(String(name ?? ""));
  if (!query) return [];
  return places.filter(place => [place.name, place.en, ...place.aliases].some(alias => normalize(alias) === query));
}

function placeMatches(fragment) {
  const query = normalize(fragment);
  const candidates = [];
  for (const place of places) {
    for (const name of [place.name, place.en, ...place.aliases]) {
      const alias = normalize(name);
      for (let index = query.indexOf(alias); index >= 0; index = query.indexOf(alias, index + alias.length)) {
        candidates.push({ id: place.id, index, size: alias.length });
      }
    }
  }
  for (const name of outsidePilotNames) {
    const alias = normalize(name);
    for (let index = query.indexOf(alias); index >= 0; index = query.indexOf(alias, index + alias.length)) {
      candidates.push({ id: null, index, size: alias.length });
    }
  }
  candidates.sort((a, b) => a.index - b.index || b.size - a.size);
  let end = 0;
  const ids = new Set();
  for (const candidate of candidates) {
    if (candidate.index < end) continue;
    ids.add(candidate.id);
    end = candidate.index + candidate.size;
  }
  return [...ids];
}

export function parseIntent(text) {
  const query = String(text).trim().replace(/[๐-๙]/gu, digit => String(digit.charCodeAt(0) - 0x0E50));
  const markers = [...query.matchAll(routeMarkers)];
  const fields = { from: [], to: [] };
  for (const [index, marker] of markers.entries()) {
    const field = /^(?:จาก|from)$/i.test(marker[0]) ? "from" : "to";
    fields[field].push(query.slice(marker.index + marker[0].length, markers[index + 1]?.index));
  }
  const onePlace = fragments => {
    const fragment = fragments.join(" ");
    if (/หรือ|\bor\b/i.test(fragment)) return null;
    const ids = placeMatches(fragment);
    return ids.length === 1 ? ids[0] : null;
  };
  const prefix = markers[0] ? query.slice(0, markers[0].index) : "";
  const unmarked = markers.length ? [] : placeMatches(query);
  const time = query.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  const night = /กลางคืน|ตอนค่ำ|ตอนดึก|ช่วงค่ำ|ตอนเย็น|night|tonight|ทุ่ม/.test(query);
  const hours = { "หนึ่ง": 19, "สอง": 20, "สาม": 21, "สี่": 22, "ห้า": 23 };
  const thaiTime = query.match(/(หนึ่ง|สอง|สาม|สี่|ห้า)ทุ่ม\s*(ครึ่ง)?/);
  return {
    from: markers.length ? onePlace(fields.from.length ? fields.from : [prefix]) : unmarked.length === 2 ? unmarked[0] : null,
    to: markers.length ? onePlace(fields.to) : unmarked.length === 2 && !/หรือ|\bor\b/i.test(query) ? unmarked[1] : null,
    mode: night ? "night" : /กลางวัน|ตอนเที่ยง|\bday\b/i.test(query) ? "day" : null,
    time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : thaiTime ? `${hours[thaiTime[1]]}:${thaiTime[2] ? "30" : "00"}`
      : /(?:หก|6)โมงเย็น/.test(query) ? "18:00" : null,
    noStairs: /เลี่ยงบันได|ไม่ขึ้นบันได|รถเข็น|wheelchair|no stairs/i.test(query),
  };
}

function localHours(time) {
  const day = new Date(time + bkk);
  return day.getUTCHours() + day.getUTCMinutes() / 60;
}

function routesFrom(from, to, start, request, previous = [from], path = [], meters = 0) {
  if (from === to) return [path];
  return edges.flatMap(edge => {
    const next = edge.from === from ? edge.to : edge.to === from ? edge.from : null;
    if (!next || previous.includes(next) || (request.noStairs && edge.stairs)) return [];
    const eta = start + meters / speed * 1000;
    const end = eta + edge.length / speed * 1000;
    if (edge.hours && (localHours(eta) < edge.hours[0] || localHours(end) >= edge.hours[1]
      || Math.floor((eta + bkk) / 86400000) !== Math.floor((end + bkk) / 86400000))) return [];
    if (edge.length + meters > request.maxMinutes * 60 * speed || end > request.deadline) return [];
    return routesFrom(next, to, start, request, [...previous, next], [...path, { ...edge, from, to: next, eta }], meters + edge.length);
  });
}

export function segmentEvidence(id, overlays = {}, asOf = referenceDate) {
  const edge = edges.find(candidate => candidate.id === id);
  if (!edge) return null;
  const override = Object.hasOwn(overlays, id) ? overlays[id] : null;
  const reviewed = statuses.has(override?.light ?? override);
  const sourceLight = reviewed ? override?.light ?? override : edge.light;
  const age = evidenceAge(sourceLight === "unknown" ? null : override?.observedAt ?? referenceDate, asOf);
  const light = ["stale", "future"].includes(age.ageStatus) ? "unknown" : sourceLight;
  return {
    id, title: edge.title, light, length: edge.length, source: "ข้อมูลจำลอง Walk We",
    method: reviewed ? "practice_review" : light === "unknown" ? "no_data" : "scenario_assumption", ...age,
    hours: edge.hours ?? null,
  };
}

function measure(path, mode, overlays, date) {
  let meters = 0;
  let shade = 0;
  let covered = 0;
  let lit = 0;
  let dark = 0;
  let unknown = 0;
  let longestUnknown = 0;
  let unknownRun = 0;
  const segments = path.map(edge => {
    meters += edge.length;
    const evidence = segmentEvidence(edge.id, overlays, date);
    let shaded = null;
    if (mode === "day") {
      const { altitude, azimuth } = pilotSun(edge.eta + edge.length / speed * 500);
      const projection = Math.max(0, Math.cos((azimuth - edge.wallBearing) * radians));
      const fraction = Math.min(0.75, projection * shadowLength(edge.wallHeight, altitude) / 42);
      shaded = edge.cover + (1 - edge.cover) * fraction;
      shade += edge.length * shaded;
      covered += edge.length * edge.cover;
    }
    if (evidence.light === "lit") lit += edge.length;
    if (evidence.light === "dark") dark += edge.length;
    if (evidence.light === "unknown") {
      unknown += edge.length;
      unknownRun += edge.length;
      longestUnknown = Math.max(unknownRun, longestUnknown);
    } else {
      unknownRun = 0;
    }
    return { ...evidence, from: edge.from, to: edge.to, shaded, covered: edge.cover, stairs: edge.stairs === true };
  });
  return {
    id: path.map(edge => edge.id).join("."),
    minutes: Math.ceil(meters / speed / 60), meters, lit, dark, unknown, longestUnknown,
    shade: mode === "day" ? round(100 * shade / meters) : null,
    sunMinutes: mode === "day" ? round((meters - shade) / (speed * 60), 1) : null,
    covered: round(covered), segments,
  };
}

function prepareTrip(input) {
  if (!input || typeof input !== "object") return { status: "invalid" };
  const { from, to, time, arriveBy, maxMinutes } = input;
  const date = input.date ?? referenceDate;
  if (!places.some(p => p.id === from) || !places.some(p => p.id === to)) return { status: "out_of_coverage" };
  if (from === to || !timePattern.test(time) || !datePattern.test(date)
    || (arriveBy && !timePattern.test(arriveBy))
    || (maxMinutes != null && (!Number.isFinite(maxMinutes) || maxMinutes <= 0))) {
    return { status: "invalid" };
  }
  const instant = bangkokTime(date, time);
  if (!Number.isFinite(instant) || !bangkokDateTime(instant).startsWith(date)) return { status: "invalid" };
  const mode = ["day", "night"].includes(input.mode) ? input.mode
    : pilotSun(instant).altitude >= agentConfig.nightRoutingAltitude ? "day" : "night";
  return { status: "ok", date, instant, mode, access: {
    noStairs: input.noStairs, maxMinutes: maxMinutes ?? Infinity, deadline: arriveBy ? bangkokTime(date, arriveBy) : Infinity,
  } };
}

function pickRoute(routes, score) {
  return [...routes].sort((a, b) => score(a) - score(b) || a.meters - b.meters
    || a.id.localeCompare(b.id, "en"))[0];
}

const optimisticCost = route => route.meters + route.dark * lightingPenalty;
const pessimisticCost = route => optimisticCost(route) + route.unknown * lightingPenalty;

export function worthwhileDetour(route, shortest) {
  return Number.isFinite(route.sunMinutes) && Number.isFinite(shortest.sunMinutes)
    && route.meters <= shortest.meters * agentConfig.maxDetourRatio
    && route.sunMinutes < shortest.sunMinutes
    && route.sunMinutes <= shortest.sunMinutes * agentConfig.maxDetourSunRatio;
}

export function rankUnknowns(routes, factor, limit) {
  // The fixture measures shade and cover. Only missing lighting evidence is represented.
  if (factor !== "lighting" || !Array.isArray(routes) || !routes.length
    || !Number.isInteger(limit) || limit < 1 || limit > 5) return [];
  const unknownByRoute = new Map(routes.map(route => [route.id,
    new Map(route.segments.filter(segment => segment.light === "unknown").map(segment => [segment.id, segment]))]));
  const unknown = new Map([...unknownByRoute.values()].flatMap(segments => [...segments]));
  const optimisticId = pickRoute(routes, optimisticCost).id;
  const pessimisticId = pickRoute(routes, pessimisticCost).id;
  return [...unknown.values()].map(segment => {
    const penalty = route => (unknownByRoute.get(route.id).get(segment.id)?.length ?? 0) * lightingPenalty;
    const flips = pickRoute(routes, route => optimisticCost(route) + penalty(route)).id !== optimisticId
      || pickRoute(routes, route => pessimisticCost(route) - penalty(route)).id !== pessimisticId;
    return { segment, flips };
  }).sort((a, b) => Number(b.flips) - Number(a.flips) || b.segment.length - a.segment.length
    || a.segment.id.localeCompare(b.segment.id, "en"))
    .slice(0, limit)
    .map(({ segment, flips }, index) => ({ segment_id: segment.id, name_th: segment.title ?? segment.id, flips, priority: index + 1 }));
}

export function planRoute(input, overlays = {}) {
  const trip = prepareTrip(input);
  if (trip.status !== "ok") return { status: trip.status, decision: "ABSTAIN" };
  const { from, to, time, preference } = input;
  const { date, instant, mode, access } = trip;
  const paths = routesFrom(from, to, instant, access);
  const routes = paths.map(path => measure(path, mode, overlays, date));
  if (!routes.length) return { status: "no_path", decision: "ABSTAIN", mode };
  const shortest = pickRoute(routes, route => route.meters);
  const optimistic = pickRoute(routes, optimisticCost);
  const pessimistic = pickRoute(routes, pessimisticCost);
  const shade = pickRoute(routes, route => route.sunMinutes);
  const usefulShade = pickRoute(routes.filter(route => worthwhileDetour(route, shortest)),
    route => route.meters + route.sunMinutes * 65);
  const flipped = mode === "night" && optimistic.id !== pessimistic.id;
  let evidenceIds = [];
  if (flipped) {
    const opposite = new Set(pessimistic.segments.map(segment => segment.id));
    const shared = new Set(optimistic.segments.filter(segment => opposite.has(segment.id)).map(segment => segment.id));
    evidenceIds = rankUnknowns([optimistic, pessimistic].map(route => ({
      ...route, segments: route.segments.filter(segment => !shared.has(segment.id)),
    })), "lighting", 3).map(item => item.segment_id);
  }
  const recommended = mode === "night" ? (preference === "direct" ? optimistic : pessimistic) : (usefulShade ?? shortest);
  const pool = mode === "night" ? [recommended, shortest, optimistic, pessimistic] : [recommended, shortest, shade];
  const displayed = [...new Map(pool.map(route => [route.id, route])).values()];
  return {
    status: "ok", decision: flipped ? "VERIFY" : "ACT", mode, time, date,
    datasetVersion: version, routes: displayed, recommendedId: recommended.id, shortestId: shortest.id,
    stress: flipped ? { flipped, optimisticId: optimistic.id, pessimisticId: pessimistic.id, evidenceIds } : { flipped: false },
  };
}

export function formatDecision(result, routeId = result.recommendedId) {
  const route = result.routes?.find(candidate => candidate.id === routeId);
  if (!route) return "ยังคำนวณเส้นทางตามเงื่อนไขนี้ไม่ได้ ลองแก้ต้นทาง ปลายทาง หรือเวลาเดิน";
  if (result.mode === "day") return `เดินประมาณ ${route.minutes} นาที คาดว่าโดนแดด ${route.sunMinutes} นาทีที่เวลา ${result.time} น.`;
  const prefix = result.stress.flipped ? "ผลแนะนำขึ้นอยู่กับช่วงที่ยังไม่มีข้อมูลไฟ " : "";
  return `${prefix}เดินประมาณ ${route.minutes} นาที ช่วงมีข้อมูลว่ามีไฟ ${route.lit} ม. ช่วงไม่มีข้อมูลไฟ ${route.unknown} ม.`;
}

export function verifyDecision(proposal, result) {
  if (!proposal || result.status !== "ok" || proposal.route_id !== result.recommendedId || proposal.decision !== result.decision) return false;
  if (!Array.isArray(proposal.evidence_ids) || !proposal.evidence_ids.every(id => typeof id === "string")) return false;
  const expected = new Set(result.stress.evidenceIds ?? []);
  if (proposal.evidence_ids.length !== expected.size || [...expected].some(id => !proposal.evidence_ids.includes(id))) return false;
  if (result.stress.flipped) return proposal.reason === "lighting_unknown";
  const selected = result.routes.find(route => route.id === result.recommendedId);
  if (proposal.reason === "shortest") return selected.id === result.shortestId;
  if (proposal.reason === "shade") return result.mode === "day" && Number.isFinite(selected.shade) && selected.shade > 0;
  if (proposal.reason === "lighting_known") return result.mode === "night" && selected.lit > 0;
  return proposal.reason === "lighting_unknown" && result.mode === "night" && selected.unknown > 0;
}

export function companionNotice(event, route) {
  if (!route) return null;
  if (event === "rain") return "มีฝนในสถานการณ์ซ้อม หยุดในที่เหมาะสมหรือกลับไปเลือกทางมีหลังคาได้";
  if (event === "unknown" && route.unknown) return "ช่วงข้างหน้ามีส่วนที่ยังไม่มีข้อมูลไฟ เปิดหลักฐานหรือกลับไปเลือกทางอื่นได้";
  if (event === "nightfall") return "ทริปจะเข้าช่วงกลางคืน กลับไปเทียบเส้นทางด้วยข้อมูลช่วงกลางคืนได้";
  if (event === "closing") return "ทางเชื่อมอาจปิดก่อนถึง ช่วยตรวจเวลาและเลือกเส้นทางใหม่";
  if (event === "off_route") return "ตำแหน่งอยู่นอกเส้นทางที่เลือก ตรวจแผนก่อนเดินต่อ";
  return null;
}

export function voiceText(result) {
  const speech = formatDecision(result);
  return banned.test(speech) ? "เปิดดูหลักฐานบนการ์ดเส้นทางได้" : speech;
}

export const replay = (mode = "night", overlays = {}) => planRoute({
  from: "siam", to: "central", date: referenceDate, time: mode === "day" ? "12:00" : "21:00", mode,
}, overlays);

export function compareDepartureTimes(request, times, overlays = {}) {
  if (!Array.isArray(times) || times.length < 2 || times.length > 6 || new Set(times).size !== times.length
    || times.some(time => typeof time !== "string" || !timePattern.test(time))) {
    return { status: "invalid" };
  }
  const options = times.map(time => {
    const result = planRoute({ ...request, time, mode: "auto" }, overlays);
    if (result.status !== "ok" || result.mode !== "day") return { time, status: result.status === "ok" ? "night" : result.status };
    const { id, minutes, sunMinutes, shade, meters } = result.routes.find(route => route.id === result.recommendedId);
    return { time, status: "ok", routeId: id, minutes, sunMinutes, shade, meters };
  });
  return { status: "ok", datasetVersion: version, options };
}

export function suggestDeparture(request, routeId, maxDelayMin, overlays = {}) {
  const { departureShiftStepMinutes: step, maxDepartureShiftMinutes: max } = agentConfig;
  if (typeof routeId !== "string" || !routeId || !Number.isInteger(maxDelayMin) || maxDelayMin < step || maxDelayMin > max) return null;
  const trip = prepareTrip(request);
  if (trip.status !== "ok" || trip.mode !== "day") return null;

  const at = instant => {
    if (pilotSun(instant).altitude < agentConfig.nightRoutingAltitude) return null;
    const path = routesFrom(request.from, request.to, instant, trip.access)
      .find(candidate => candidate.map(segment => segment.id).join(".") === routeId);
    return path ? measure(path, "day", overlays, bangkokDateTime(instant).slice(0, 10)) : null;
  };
  const baseline = at(trip.instant);
  if (!baseline) return null;
  let best = baseline;
  let depart = trip.instant;
  for (let delay = step; delay <= maxDelayMin; delay += step) {
    const instant = trip.instant + delay * 60_000;
    const candidate = at(instant);
    if (candidate && candidate.shade > best.shade) {
      best = candidate;
      depart = instant;
    }
  }
  return { better: best !== baseline, depart_at: bangkokDateTime(depart),
    shade_pct_at_new_time: best.shade, still_meets_deadline: true };
}
