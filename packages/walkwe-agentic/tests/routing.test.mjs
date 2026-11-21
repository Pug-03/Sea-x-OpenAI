import assert from "node:assert/strict";
import test from "node:test";
import { planRoute, rankUnknowns, segmentEvidence, suggestDeparture, worthwhileDetour } from "../src/core.mjs";
import { edges } from "../src/fixture.mjs";

const trip = { from: "siam", to: "central", time: "13:12", mode: "day" };

test("considers every feasible option when the weighted winner fails the detour rule", () => {
  const result = planRoute(trip);
  const shortest = result.routes.find(route => route.id === result.shortestId);
  const detour = result.routes.find(route => route.id === result.recommendedId);
  assert.equal(shortest.meters, 640);
  assert.equal(detour.meters, 766);
  assert.equal(worthwhileDetour(detour, shortest), true);
  assert.equal(worthwhileDetour({ ...detour, sunMinutes: null }, shortest), false);

  const capped = planRoute({ ...trip, maxMinutes: 8 });
  assert.equal(capped.recommendedId, shortest.id);
  assert.equal(capped.routes[0].minutes, 8);
  assert.equal(planRoute({ ...trip, maxMinutes: 7.5 }).status, "no_path");
});

test("only enforces a maximum walking time when the caller specifies one", t => {
  const edge = edges.find(segment => segment.id === "chitlom-east");
  const originalLength = edge.length;
  t.after(() => { edge.length = originalLength; });
  edge.length = 6000;
  const request = { ...trip, from: "central", to: "chitlom" };
  assert.equal(planRoute(request).routes[0].minutes, 74);
  assert.equal(planRoute({ ...request, maxMinutes: 60 }).status, "no_path");
});

test("ranks a route-changing unknown above a longer unknown shared by both options", () => {
  const result = planRoute({ ...trip, to: "chitlom", time: "21:00", mode: "night" });
  assert.deepEqual(result.stress.evidenceIds, ["lane-gap"]);
  assert.deepEqual(rankUnknowns(result.routes, "lighting", 2).map(({ segment_id, flips, priority }) =>
    [segment_id, flips, priority]), [["lane-gap", true, 1], ["chitlom-east", false, 2]]);
  assert.deepEqual(rankUnknowns(result.routes, "shade", 2), []);
  assert.equal(segmentEvidence("lane-gap").light, "unknown");
});

test("checks later daylight on the same route in five-minute increments against the original deadline", () => {
  const request = { ...trip, time: "14:30" };
  const routeId = planRoute(request).recommendedId;
  assert.deepEqual(suggestDeparture(request, routeId, 30), {
    better: true, depart_at: "2026-11-21T15:00:00+07:00", shade_pct_at_new_time: 89, still_meets_deadline: true,
  });
  assert.deepEqual(suggestDeparture({ ...request, arriveBy: "14:45" }, routeId, 30), {
    better: true, depart_at: "2026-11-21T14:35:00+07:00", shade_pct_at_new_time: 85, still_meets_deadline: true,
  });
  assert.equal(suggestDeparture({ ...request, arriveBy: "14:40" }, routeId, 30).better, false);
  assert.equal(suggestDeparture({ ...request, time: "23:55", arriveBy: "23:59" }, routeId, 30), null);
  assert.equal(suggestDeparture(request, routeId, 4), null);
});
