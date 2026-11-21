# Walk We · Workflow architecture

```text
packages/
  walkwe-agentic/
    src/
      agentic-workflow/   Intent, Planner, Critic, Companion and context
        harness/         Tool registry, budget, verification and replay
      routing/          Fixture graph and deterministic route metrics
      evidence/         Steward, news and human approval rules
      integrations/     Responses client, ElevenLabs tools and MCP
      workers/          Node preview and local Workers /agent/step
    evals/              Test cases, offline/mock reports and opt-in live runner
  verify/               Code checks for a draft against the route and evidence
  voice-research/        Asynchronous research and pending human review
```

## Plan a walk

The app resolves a Thai or English request to a draft and lets the user confirm the places. Routing evaluates an immutable snapshot for the chosen departure, walk constraints and opening hours. Code computes ETA, distance, shade and evidence coverage. At night the stress test varies the treatment of unknown lighting and records whether the recommendation changes. Daytime departure suggestions check the same deadline and compare walking exposure at five-minute intervals. Unknown lighting remains an explicitly missing value.

Planner asks for route metrics, stress results and evidence through tools. The verifier checks draft claims against that snapshot and the trip constraints. Critic can read the associated evidence and return a reasoned rejection for a bounded retry. The app fills the final text from checked route metrics. When the model times out, exhausts its budget or returns an invalid proposal, deterministic routing and templates remain available.

## During and after the trip

| Workflow | Responsibility |
| --- | --- |
| Companion | Reacts to a recorded trip event, opens a warning or a replan offer, and leaves route selection with the user. |
| SOS | The app opens an SOS sheet for the user. The local state machine covers hold, cancel, practice, outbox deduplication and acknowledgement with a mock transport. |
| ElevenLabs | The backend requests a signed URL and the app binds the 13 client tools to verified trip state and app callbacks. The share tool opens the app's confirmation step. |
| Steward and news | Observations and public sources enter drafts for review. Publishing and audit use the app owner's authenticated storage interface. |
| Research | The app selects a public segment, starts or reuses a research job and announces the source count after polling. Results enter `pending_review` before any potential route data update. |
| MCP | Read-only adapters expose evidence and scenario replay against the labeled fixture. |

## Deployment and integration status

The source audit found a public app, browser routing worker, and legacy AI proxy in `Pug-03/Walk_We` on `main` at `93fd1e2`. Compiling that snapshot with its documented proxy URL reproduced the observed legacy `walkwe-web` HTML, `index-B8MLZxYv.js` and `worker-C7s3Wk7d.js` byte-for-byte. A second local build with an empty proxy URL produced different bundles from the observed `walkwe-web2` pair, `index-DYn_g4TT.js` and `worker-BqFbNug9.js`. Confirm that build's commit and the running legacy proxy version against the owning workspace's deployment records. [App source at 93fd1e2](https://github.com/Pug-03/Walk_We/commit/93fd1e20da35634a5289aaa50c5e2f09088fd96b)

This repository contains the Agentic workflow and its local adapters. Production mounting requires the app's routing snapshot, trusted trip and reviewer identity, a provider-backed voice session from the app, and durable review and SOS adapters. Real provider usage and one full voice-and-routing trip require separate verification. This change is for code review and local evaluation.

### Local Worker contract

Start `POST /agent/step` with `agent`, `trip_id`, `step_index: 0`, `input` containing `text`, `lang`, `profile`, and `now`, `previous_response_id: null`, and an empty `tool_outputs` array. For a follow-up, increment the index, omit `input`, echo `response_id` as `previous_response_id`, and provide the expected `call_id` and a JSON-encoded tool envelope with `status`, `data`, `error`, and `dataset_version`.

The response ID is an expiring encrypted continuation bound to the authenticated principal, trip, role, step, and tool call. Responses requests retain `store: false` and execute one model tool call at a time. The host runs and verifies tools and terminal drafts. The endpoint reports usage and estimated cost where available and maps upstream rate limiting and invalid output to HTTP 429 and 422. A production adapter also needs host authorization, rate limiting, and replay idempotency.
