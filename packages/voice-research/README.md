# Walk We voice research

`research_segment` uses the segment selected in the app. The client acknowledges an accepted job, polls the proxy, and announces a count from the proxy when the draft is ready. `announce` should use the app's speech path, such as its Web Speech fallback. ElevenLabs `sendContextualUpdate` does not start a spoken turn.

The proxy has two mountable routes. `POST /agents/research` accepts only `{ "segmentId": "…" }`. `GET /agents/research/:id` exposes status and the source count to sessions that claimed the job. Use the existing proxy's session authentication, request limits and same-origin protections. `resolvePublicSegment(owner, segmentId)` must resolve an eligible segment against the public route graph and return its unambiguous street name or intersection. The provider receives this public label alone.

`src/worker.mjs` returns `null` for other paths. Pass the Worker execution context for `waitUntil`. `src/store.mjs` implements cache and job claims against transactional storage with the Durable Object async KV interface. It reuses a completed result for 24 hours and expires pending jobs after five minutes. Completion commits a `research:review:<id>` draft with `pending_review` in the same transaction as the result. Feature 5 can read these drafts with stable IDs, render their text as untrusted data, and use its authorized approval flow. This package contains no route or evidence publishing operation. Completion is collected on the status request, so if the app stops polling, a completed provider turn is collected only if polling resumes before expiry.

This package can be tested without credentials or network calls. The host injects its Agents API secret into `createAgentsResearch({ apiKey })` on the server. The deployed app and its proxy must mount these modules and connect the review inbox and announcement callback before the feature is live.

```sh
node --test packages/voice-research/tests/research.test.mjs
```
