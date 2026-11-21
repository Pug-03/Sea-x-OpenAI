# Walk We · Agentic workflows

Local integration and evaluation workspace for Walk We. The packages cover route planning and evidence, voice tools, a review queue, SOS practice, and the preview and Worker interfaces.

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
