import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceClientTools } from "../src/integrations/voice-client.mjs";

const spoken = { status: "ok", speak_text: "เปิดหน้าที่ขอแล้วครับ" };

test("the voice tool registry binds navigation, observations and share confirmation to app state", async () => {
  const seen = [];
  const capture = name => data => {
    seen.push([name, data]);
    return spoken;
  };
  const tools = createVoiceClientTools({
    currentTrip: () => "trip-active",
    currentQuestion: () => "segment-active",
    actions: {
      planTrip: capture("plan"),
      startNavigation: capture("nav"),
      answerQuestion: capture("answer"),
      openShareConfirmation: capture("confirm"),
      openSosSheet: capture("sos-sheet"),
    },
  });
  assert.equal(Object.keys(tools).length, 13);
  assert.equal(JSON.parse(await tools.start_navigation({ trip_id: "elsewhere" })).status, "invalid");
  assert.equal(JSON.parse(await tools.answer_question({ segment_ref: "elsewhere", answer: "lit" })).status, "invalid");
  await tools.plan_trip({ utterance: "ไปสยาม", language: "en" });
  await tools.start_navigation({});
  await tools.answer_question({ answer: "dark" });
  await tools.start_live_share({ contact_label: "saved-contact", phone: "ignored" });
  await tools.open_sos_sheet({ reason: "emergency_words" });
  assert.deepEqual(seen, [
    ["plan", { utterance: "ไปสยาม", language: "th" }],
    ["nav", { tripId: "trip-active" }],
    ["answer", { segmentId: "segment-active", answer: "dark" }],
    ["confirm", { tripId: "trip-active", contact_label: "saved-contact" }],
    ["sos-sheet", { reason: "emergency_words" }],
  ]);
});

test("voice output excludes callback internals and filters unsupported safety wording", async () => {
  const tools = createVoiceClientTools({
    actions: {
      setTheme: () => ({ ...spoken, internal: "hidden" }),
      setPreference: () => ({ status: "ok", speak_text: "This route is safe." }),
    },
  });
  assert.deepEqual(JSON.parse(await tools.set_theme({ theme: "dark" })), spoken);
  assert.equal(JSON.parse(await tools.set_preference({ preference: "haptics", value: "on" })).status, "unavailable");
  assert.equal(JSON.parse(await tools.stop_navigation({})).status, "unavailable");
});
