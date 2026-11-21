# Walk We voice providers

`VITE_VOICE_PROVIDER=elevenlabs` keeps the existing ElevenLabs build. Its agent, workspace configuration, trained voice selection, and text-only step replay remain available. `VITE_VOICE_PROVIDER=openai` enables the microphone on the planner, route results, navigation, and the night arrival question. Manual controls and device speech are available in either build.

## GPT-Live flow

1. The user taps **Talk to Walk We**. The existing proxy validates the approved origin and WebRTC offer, then requests a GPT‑Live‑1.1 session with storage disabled. WebRTC carries the microphone directly to OpenAI. The application does not save audio or transcripts. [OpenAI WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
2. GPT‑6.1 Terra handles Responses delegation and can request the Walk We tools selected for the current screen. The app validates the arguments, rejects duplicate actions, supplies tool facts, and returns the verified result to the model. Thai and English are supported in the same session. Bilingual readings require a request for both. [OpenAI delegation guide](https://developers.openai.com/api/docs/guides/live-delegation)
3. The app chooses the wording it will speak from verified tool results. The proxy buffers Realtime speech and returns audio only when the complete transcript matches the input, including distance and units. It uses `gpt-realtime-2.1-mini` with the OpenAI `marin` voice. A mismatch or connection failure falls back to the device voice. [OpenAI speech generation](https://developers.openai.com/api/docs/guides/custom-voices#using-a-voice-from-a-recording-during-speech-generation)

The microphone closes when the route step changes, the user leaves, or the one-minute session ends. SOS and sharing close it after the confirmation message.

## Tool contract

| Tools | GPT‑Live behavior |
| --- | --- |
| `plan_trip` | Prefills places from the spoken request using the existing local place lookup and planner. The user reviews them and asks the app to find a route. |
| `ask_trip`, `select_route`, `change_route`, `start_navigation` | Explain measured distance, estimated shade and lighting coverage, and use routes and preferences available in the app. A route-change offer requires an actual offer to accept. |
| `repeat_instruction`, `stop_navigation` | Read the current or next verified step. Stopping opens the existing exit confirmation. |
| `set_theme`, `set_preference` | Update existing device settings. The stair preference applies at the next calculation. |
| `open_sos_sheet`, `start_live_share` | Open the existing help or share screen. Calls, messages, and recipients require a user action on the device. |
| `answer_question` | Save a response to the night-arrival lighting question on the device. The answer stays local. |
| `companion_call` | Start an in-app walk companion within the bounded microphone session. The user can ask about the active walk and close the microphone by voice. |

The ElevenLabs voice IDs, native guardrail models and historical call data are specific to that provider. GPT‑Live uses the app's guardrails to enforce speech and action rules. The Bangkok-wide route-evidence work is separate from this provider change.

## Run or deploy

Install from `apps/walkwe`. For a real local voice session, start the AI Worker on port 8787 with its `.dev.vars` set to `ALLOWED_ORIGINS=http://localhost:5173`, `OPENAI_LIVE_ORIGIN=http://localhost:5173`, and your `OPENAI_API_KEY`. The existing text-based Ask Box still uses `ANTHROPIC_API_KEY`. On the demo deployment, set `OPENAI_LIVE_ORIGIN` to the approved app origin in the Worker environment and keep the API key as a Worker secret. Use this opt-in only for a controlled demo origin until the deployment has authenticated access for paid session creation.

```sh
VITE_AI_PROXY_URL=http://localhost:8787 VITE_VOICE_PROVIDER=openai npm run dev
```

For rehearsal without provider credits, run the route tools and browser acceptance checks with the provider mocked. The browser test exercises Thai UI, English and bilingual step playback, a rejected distance, the help screen and the local arrival question.

```sh
npm run typecheck
npm test
VITE_AI_PROXY_URL=http://localhost:4173 VITE_VOICE_PROVIDER=openai npm run test:e2e -- e2e/navigate.spec.ts --grep 'GPT Live'
```
