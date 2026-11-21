# Walk We · Agentic workflows

Local integration and evaluation workspace for Walk We. The packages cover route planning and evidence, voice tools, a review queue, SOS practice, and the preview and Worker interfaces.

## Hackathon declaration

[Pug-03/Walk_We](https://github.com/Pug-03/Walk_We/tree/93fd1e20da35634a5289aaa50c5e2f09088fd96b) is the existing personal project. Its PWA, walking graph, route guides, map UI and AI proxy are the baseline vendored under `apps/walkwe`. Original map and asset credits are in the [baseline README](apps/walkwe/README.md#license--attribution).

Work in this hackathon repo includes the agentic routing and evidence workflows, review and practice flows under `packages/`, and the bilingual navigation replay in the PWA. Codex implemented and tested the Thai/English replay, explicit ElevenLabs session bootstrap through the existing proxy, and the app-side check against the active navigation step. [Bilingual replay and demo notes](docs/VOICE_DEMO.md)

## Run locally

Requires Node.js 22 or later. The offline tests, fixture eval and preview do not require npm dependencies or API credentials.

```sh
npm test
npm run eval
npm start
```

The preview listens on `127.0.0.1:4178`. Check `GET /api/status` or try a fixed fictional night route.

```sh
curl -sS http://127.0.0.1:4178/api/plan \
  -H 'Content-Type: application/json' \
  -d '{"request":{"from":"siam","to":"central","mode":"night","time":"21:00"}}'
```

## Environment

| File | Used by | Values |
| --- | --- | --- |
| [`.env.example`](.env.example) → `.env` | Node preview | `WALKWE_PORT`, optional `WALKWE_OPENAI_API_KEY`, `WALKWE_ELEVENLABS_API_KEY`, `WALKWE_ELEVENLABS_AGENT_ID` |
| `.env` | Opt-in OpenAI eval | `WALKWE_OPENAI_EVAL_API_KEY` from the eval project. The runner can also read `WALKWE_OPENAI_API_KEY`. |
| [`.dev.vars.example`](packages/walkwe-agentic/.dev.vars.example) → `.dev.vars` in the Agentic package | Local Workers preview | `OPENAI_API_KEY`, `WALKWE_STEP_TOKEN`, `WALKWE_STEP_STATE_KEY`. Use two independent local random values of at least 32 characters for the last two. |

```sh
cp .env.example .env
node --env-file=.env packages/walkwe-agentic/src/workers/preview.mjs
node --env-file=.env packages/walkwe-agentic/evals/run.mjs --live --out live-report.json
```

For local Wrangler development, copy the package's `.dev.vars.example` to `.dev.vars` and run `npx wrangler dev` from `packages/walkwe-agentic`. The Worker fetch interface also has credential-free Node tests. Real keys remain in the local environment or the service's secret store.

## Read the workflow

- [Architecture and integration status](docs/ARCHITECTURE.md)
- [Agentic package](packages/walkwe-agentic/README.md) and [offline and live evaluation](packages/walkwe-agentic/evaluate.md)
- [Voice research and its human review path](packages/voice-research/README.md)
