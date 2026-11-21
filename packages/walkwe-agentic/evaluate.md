# Walk We · Agentic evaluation

## Results

| Lane | Result | What it establishes |
| --- | --- | --- |
| Node tests across both packages | 33/33 | Routing, tool order and retry, deterministic checks, Worker continuation and authorization, voice bindings, SOS practice and research queue |
| Fixture eval | 34/34 | Parsing, route metrics, evidence snapshots, and safeguards with the Siam scenario graph |
| Mock Responses eval | 18/18 | Structured outputs, tool replay, fallback and 14 regression traps |
| Live OpenAI | 0 | Token usage, latency and actual cost still require a provider run |

The saved [offline report](evals/eval_report.json) uses fixture dataset version `siam-sandbox-1`.

## Run the checks

From the repository root:

```sh
npm test
npm run eval -- --out packages/walkwe-agentic/evals/eval_report.json
```

To opt in to live evaluation, load a local `.env` that contains `WALKWE_OPENAI_EVAL_API_KEY` and run:

```sh
node --env-file=.env packages/walkwe-agentic/evals/run.mjs --live --out live-report.json
```

Add `--case <id>` to limit the provider calls. Live cases report results and latency per case, including failed requests and their HTTP statuses. Usage lists input, cached input, cache write, output and reasoning tokens. The estimate uses the same standard pricing table as the Worker. Reasoning contributes to output tokens. A response without usage carries no cost estimate.

## Core expectations

- Intent treats the user request as data, supports Thai and English, and falls back to the confirmable local draft on conflicting place IDs.
- A night flip requires the planner to call routing and stress tools, read the deciding evidence, and request clarification under the configured question budget. Numbers come from the checked Worker snapshot.
- The verifier checks V1–V8 and tool errors against fixture evidence. Critic reads the cited segment, returns a structured verdict, and can trigger a bounded rewrite. Stair status must be explicitly clear for a step-free route.
- Duplicate calls, unsupported outputs, provider errors and time limits keep the deterministic route response available. The mock lane exercises these outcomes without credentials.

Model settings are in [the Responses client](src/integrations/openai.mjs). Routing evidence and weather availability are limited by the connected adapter. The local suites do not establish production route quality or live model behavior.
