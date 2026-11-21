# Walk We bilingual replay

Start a walk from BTS Siam to CentralWorld. On the current step, choose **ไทย**, **English**, or **ไทยและอังกฤษ**. The selection applies to replay throughout the walk. The app can read the step directly. **ให้ Walk We Agent อ่าน** asks the agent to read the same step.

The proxy returns the public agent ID only for the configured origin. The browser opens one bounded text-only turn with ElevenLabs and sends a fixed replay request. Its `repeat_instruction` client tool returns the active step's distance and localized wording. The app accepts a verbatim echo and sends the original wording to speech. If the reply differs or the agent is unavailable, the device reads the same app wording. Advancing the route cancels a pending replay. The text session sends no microphone audio, coordinates, or unique trip ID. [ElevenLabs WebSocket API](https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket)

The published Walk We Voice Main version is `agtvrsn_2101m7yg86vwfwqv0cj9pty41b6w`. Thai is the default, English is enabled, and Detect language may run after the opening turns. A full request or an explicit language choice changes the language. A place name such as CentralWorld keeps the surrounding language. The prompt requires verbatim `speak_text` and both languages only on request. ElevenLabs exports its native custom guardrail with tool-call history disabled. The PWA compares the actual client tool result before playback.

## Rehearse without credits

Run the app without a proxy URL and use **อ่านขั้นนี้ออกเสียง**. The device must have the selected voices available. Route distances remain visible if the device cannot speak.

```sh
cd apps/walkwe
npm ci
npm test
VITE_AI_PROXY_URL='' npm run dev
```

Use Siam → CentralWorld for both rounds. Step 1 shows **10 m** (8 raw metres), then step 2 shows **390 m** (392 raw metres). Read step 1 in English while the interface is in Thai, then read step 2 in both languages. The mocked browser test also checks that an agent reply claiming 999 metres is discarded and the device reads 390 in both languages.

The competition PDF allocates six minutes for each round's pitch/demo, with separate Q&A. The ElevenLabs workspace showed 5,439 credits before this work. The tests use mocked services. Budget at most two minutes of live conversation per round based on the team's prior estimate of about 690 credits per voice minute. That estimates 2,760 credits for four minutes and leaves room for variation. Keep the device-reading path ready for both rounds.

## Demo deployment

Use the existing Cloudflare Worker account and approved `https://walkwe-web2.walkwe.workers.dev` origin. The proxy Worker needs `ELEVENLABS_AGENT_ID` set to the ID from the new ElevenLabs workspace. The worker will return 503 for this endpoint until it is set. The ElevenLabs agent must retain its host allowlist and the text-only, language and first-message overrides. The direct `/speak` path can use the device voice or ElevenLabs when `ELEVENLABS_API_KEY` is set as a Worker secret. Its default models are Eleven v3 for Thai and Flash v2.5 for English. Keep provider credentials in Cloudflare. [ElevenLabs models](https://elevenlabs.io/docs/overview/models)

From `apps/walkwe` in a Cloudflare-authenticated shell, apply the approved configuration and deploy the demo app by name.

```sh
(cd apps/ai-proxy && npm exec -- wrangler deploy --var "ELEVENLABS_AGENT_ID:$WALKWE_DEMO_AGENT_ID")
VITE_AI_PROXY_URL=https://walkwe-ai-proxy.walkwe.workers.dev npm run build
(cd apps/web && npm exec -- wrangler deploy --name walkwe-web2)
```

The installed agent handles the current-step replay in this PWA. The remaining tool handlers in `packages/walkwe-agentic` have their own offline workflow tests. The PWA replay does not expose route changes, sharing, or SOS actions to the agent.
