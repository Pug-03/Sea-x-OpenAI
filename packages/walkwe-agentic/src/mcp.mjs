import { createInterface } from "node:readline";
import { compareDepartureTimes, replay, segmentEvidence } from "./core.mjs";
import { version } from "./fixture.mjs";
import { objectSchema } from "./model.mjs";

const annotation = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const tools = [
  {
    name: "get_segment_evidence", description: "Read one synthetic segment for the named Walk We dataset.",
    inputSchema: objectSchema({ segment_id: { type: "string" }, dataset_version: { const: version } }), annotations: annotation,
  },
  {
    name: "replay_demo_trip", description: "Compute the fixed Siam–CentralWorld fixture in day or night mode.",
    inputSchema: objectSchema({ mode: { enum: ["day", "night"] }, dataset_version: { const: version } }), annotations: annotation,
  },
  {
    name: "compare_departure_times", description: "Compare two to six local Bangkok times against the fixed fixture.",
    inputSchema: objectSchema({
      times: { type: "array", minItems: 2, maxItems: 6, items: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" } },
      dataset_version: { const: version },
    }), annotations: annotation,
  },
];

const current = "2025-11-25";
const supported = new Set([current, "2025-06-18", "2025-03-26"]);
const serialize = result => ({ content: [{ type: "text", text: JSON.stringify(result) }] });
const toolError = status => ({ ...serialize({ status }), isError: true });

function callTool(params) {
  const input = params?.arguments;
  if (!input || typeof input !== "object" || Object.keys(input).length !== 2 || input.dataset_version !== version) {
    return toolError("invalid_arguments_or_dataset");
  }
  if (params.name === "get_segment_evidence" && typeof input.segment_id === "string") {
    const result = segmentEvidence(input.segment_id);
    return result ? serialize({ fixture: true, datasetVersion: version, evidence: result }) : toolError("no_data");
  }
  if (params.name === "replay_demo_trip" && ["day", "night"].includes(input.mode)) {
    return serialize({ fixture: true, ...replay(input.mode) });
  }
  if (params.name === "compare_departure_times") {
    const result = compareDepartureTimes({ from: "siam", to: "central" }, input.times);
    return result.status === "ok" ? serialize({ fixture: true, ...result }) : toolError(result.status);
  }
  return toolError("unknown_tool_or_invalid_arguments");
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let initialized = false;
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
for await (const line of lines) {
  let req;
  try { req = JSON.parse(line); } catch { send({ id: null, error: { code: -32700, message: "Parse error" } }); continue; }
  if (req?.jsonrpc !== "2.0" || typeof req.method !== "string") {
    send({ id: req?.id ?? null, error: { code: -32600, message: "Invalid Request" } });
    continue;
  }
  if (req.method === "notifications/initialized") { initialized = true; continue; }
  if (!Object.hasOwn(req, "id")) continue;
  const { id, method, params } = req;
  let result;
  switch (method) {
    case "initialize":
      result = { protocolVersion: supported.has(params?.protocolVersion) ? params.protocolVersion : current,
        serverInfo: { name: "walkwe-evidence", version: "0.1.0" }, capabilities: { tools: {} } };
      break;
    case "ping": result = {}; break;
    case "tools/list": if (initialized) result = { tools }; break;
    case "tools/call": if (initialized) result = callTool(params); break;
  }
  if (result) send({ id, result });
  else send({ id, error: { code: -32601, message: "Method not found or server not initialized" } });
}
