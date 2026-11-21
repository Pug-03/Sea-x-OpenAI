import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { contextVersion } from "../src/agentic-workflow/context.mjs";
import { version } from "../src/routing/fixture.mjs";
import { createModelClient, estimateModelCost, modelProfiles } from "../src/integrations/openai.mjs";
import { liveCases, localCases } from "./cases.mjs";

const { values } = parseArgs({ options: {
  live: { type: "boolean" }, out: { type: "string" }, case: { type: "string", multiple: true },
} });
const calls = [];
const requests = [];
const model = values.live ? createModelClient({
  apiKey: process.env.WALKWE_OPENAI_EVAL_API_KEY || process.env.WALKWE_OPENAI_API_KEY,
  onUsage: item => calls.push({ ...item, estimatedUsd: estimateModelCost(item) }),
  onRequest: request => requests.push(request),
}) : null;

function summarizeUsage(items) {
  const total = field => items.reduce((sum, item) => sum + item[field], 0);
  const inputTokens = total("inputTokens");
  const outputTokens = total("outputTokens");
  return {
    responsesWithUsage: items.length, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
    cachedInputTokens: total("cachedInputTokens"), cacheWriteTokens: total("cacheWriteTokens"),
    reasoningTokens: total("reasoningTokens"),
    estimatedUsd: items.length && items.every(item => item.estimatedUsd !== null)
      ? Number(total("estimatedUsd").toFixed(9)) : null,
  };
}

const records = [];
const checkName = /^[a-zA-Z][a-zA-Z_.]{0,55}$/;
const statusValue = value => value === null || typeof value === "boolean"
  || (typeof value === "string" && /^[a-z0-9_:.\-]{1,45}$/i.test(value));
const live = model ? liveCases(model) : [];
const selected = values.case ? live.filter(test => values.case.includes(test.id)) : live;
if (values.case && (!values.live || (model && selected.length !== new Set(values.case).size))) {
  throw new Error("--case requires --live and valid live case IDs");
}
for (const test of [...localCases, ...selected]) {
  const started = performance.now();
  const firstCall = calls.length;
  const firstRequest = requests.length;
  const row = { id: test.id, lane: test.lane, group: test.group, trap: Boolean(test.trap) };
  try {
    const result = await test.run();
    records.push({ ...row, passed: true, elapsedMs: Math.round(performance.now() - started),
      ...(result?.fallback ? { fallback: result.fallback } : {}),
      ...(result?.loop ? { loop: result.loop } : {}),
    });
  } catch (error) {
    records.push({ ...row, passed: false, elapsedMs: Math.round(performance.now() - started),
      failure: error.code ?? error.name,
      ...(test.lane === "live" && error.code === "ERR_ASSERTION" ? {
        check: checkName.test(error.message) ? error.message : "assertion",
        ...(statusValue(error.actual) ? { actual: error.actual } : {}),
        ...(statusValue(error.expected) ? { expected: error.expected } : {}),
      } : {}) });
    process.stderr.write(`${test.id} ${test.name ?? test.group}: ${error.message}\n`);
  }
  if (test.lane === "live") {
    const round = calls.slice(firstCall);
    records.at(-1).usage = { ...summarizeUsage(round), calls: round };
    records.at(-1).requests = requests.slice(firstRequest);
  }
}

const percentile = (sorted, value) => sorted.length ? sorted[Math.ceil(value * sorted.length) - 1] : null;
const summarizeCases = rows => {
  const elapsed = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
  const passed = rows.filter(record => record.passed).length;
  return {
    executed: rows.length, passed,
    accuracyPct: rows.length ? Number((100 * passed / rows.length).toFixed(2)) : null,
    p50Ms: percentile(elapsed, 0.5), p95Ms: percentile(elapsed, 0.95), maxMs: elapsed.at(-1) ?? null,
  };
};
const summary = Object.fromEntries(["fixture", "mock", "live"].map(lane => [lane,
  summarizeCases(records.filter(record => record.lane === lane))]));
const liveByGroup = Object.fromEntries(["intent", "harness"].map(group => [group,
  summarizeCases(records.filter(record => record.lane === "live" && record.group === group))]));
const traps = records.filter(record => record.trap);
const report = {
  fixture: version, contextVersion, models: modelProfiles, summary,
  trapsCaught: traps.filter(record => record.passed && record.fallback).length, trapsExecuted: traps.length,
  liveRun: model ? "executed" : values.live ? "skipped_missing_key" : "not_requested",
  ...(model ? { liveByGroup, liveUsage: summarizeUsage(calls) } : {}),
  records,
};
const output = JSON.stringify(report, null, 2) + "\n";
if (values.out) await writeFile(values.out, output);
else process.stdout.write(output);
if (records.some(record => !record.passed)) process.exitCode = 1;
else if (values.live && !model) process.exitCode = 2;
