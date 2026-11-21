const rejectedSpeech = /ปลอดภัย|ไม่มีอันตราย|ไม่อันตราย|\b(?:safe|safer|safest|secure)\b/i;
const choices = (...allowed) => value => allowed.includes(value);
const textField = max => value => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const language = choices("th", "en");
const reference = textField(100);
const defaults = {
  invalid: { status: "invalid", speak_text: "ขอรายละเอียดอีกครั้งได้ไหมครับ" },
  unavailable: { status: "unavailable", speak_text: "ตอนนี้ยังตรวจคำตอบให้ไม่ได้ครับ" },
};

// Callbacks belong to the app and produce speech from verified UI state.
export function createVoiceClientTools({ actions, currentTrip, currentQuestion }) {
  function tool(action, fields, bind = data => data) {
    return async input => {
      if (!input || typeof input !== "object" || Array.isArray(input)) return JSON.stringify(defaults.invalid);
      const data = {};
      for (const [name, check] of Object.entries(fields)) {
        if (!check(input[name])) return JSON.stringify(defaults.invalid);
        data[name] = input[name];
      }
      if (typeof actions?.[action] !== "function") return JSON.stringify(defaults.unavailable);
      try {
        const bound = bind(data, input);
        if (!bound) return JSON.stringify(defaults.invalid);
        const result = await actions[action](bound);
        if (!result || typeof result.status !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(result.status) || typeof result.speak_text !== "string"
          || !textField(900)(result.speak_text) || rejectedSpeech.test(result.speak_text)) {
          return JSON.stringify(defaults.unavailable);
        }
        const output = { status: result.status, speak_text: result.speak_text };
        if (reference(result.trip_id)) output.trip_id = result.trip_id;
        if (typeof result.watching === "boolean") output.watching = result.watching;
        if (choices("companion", "off")(result.mode)) output.mode = result.mode;
        return JSON.stringify(output);
      } catch {
        return JSON.stringify(defaults.unavailable);
      }
    };
  }

  const withTrip = (data, input) => {
    const tripId = currentTrip?.();
    if (!reference(tripId) || (input.trip_id != null && input.trip_id !== tripId)) return null;
    return { ...data, tripId };
  };
  const withQuestion = (data, input) => {
    const segmentId = currentQuestion?.();
    if (!reference(segmentId) || (input.segment_ref != null && input.segment_ref !== segmentId)) return null;
    return { ...data, segmentId };
  };

  return {
    plan_trip: tool("planTrip", { utterance: textField(500), language }, data => ({
      utterance: data.utterance, language: /[\u0E00-\u0E7F]/u.test(data.utterance) ? "th" : "en",
    })),
    ask_trip: tool("askTrip", { question: textField(500), language }, withTrip),
    change_route: tool("changeRoute", {
      change: choices("avoid_stairs", "prefer_covered", "prefer_lit", "shortest", "accept_offer", "keep_route"),
    }, withTrip),
    select_route: tool("selectRoute", { route_ref: reference }, withTrip),
    start_navigation: tool("startNavigation", {}, withTrip),
    stop_navigation: tool("stopNavigation", {}, withTrip),
    repeat_instruction: tool("repeatInstruction", { which: choices("last_instruction", "next_segment_warning") }, withTrip),
    set_theme: tool("setTheme", { theme: choices("light", "dark", "auto") }),
    open_sos_sheet: tool("openSosSheet", { reason: choices("user_asked", "emergency_words") }),
    answer_question: tool("answerQuestion", { answer: choices("lit", "dim", "dark", "cannot_tell") }, withQuestion),
    set_preference: tool("setPreference", {
      preference: choices("avoid_stairs", "haptics", "big_text", "read_aloud"), value: choices("on", "off"),
    }),
    start_live_share: tool("openShareConfirmation", { contact_label: reference }, withTrip),
    companion_call: tool("companionCall", { state: choices("start", "stop") }, withTrip),
  };
}
