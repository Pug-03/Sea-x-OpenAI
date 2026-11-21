const HOLD_MS = 1000;
const CANCEL_MS = 5000;

export function newSos(id, mode = "practice") {
  if (typeof id !== "string" || !id || !["practice", "live"].includes(mode)) throw new TypeError("Invalid SOS session");
  return { id, mode, phase: "idle" };
}

export function transitionSos(state, event, now) {
  if (!Number.isFinite(now)) return state;
  if (event === "cancel" && ["holding", "countdown", "confirm"].includes(state.phase)) {
    return { id: state.id, mode: state.mode, phase: "cancelled" };
  }
  if (event === "press" && state.phase === "idle") return { ...state, phase: "holding", pressedAt: now };
  if (state.phase === "holding" && ["release", "hold_elapsed"].includes(event) && now >= state.pressedAt) {
    if (now - state.pressedAt >= HOLD_MS) return { ...state, phase: "countdown", deadline: now + CANCEL_MS };
    if (event === "release") return newSos(state.id, state.mode);
  }
  if (state.phase === "idle" && event === "accessible_confirm") {
    return { ...state, phase: "countdown", deadline: now + CANCEL_MS };
  }
  if (state.phase === "countdown" && event === "countdown_elapsed" && now >= state.deadline) {
    return { ...state, phase: "confirm" };
  }
  if (state.mode === "practice" && state.phase === "confirm" && event === "simulate_send") {
    return { ...state, phase: "simulated_sent" };
  }
  if (state.mode === "practice" && state.phase === "simulated_sent" && event === "simulate_ack") {
    return { ...state, phase: "simulated_ack" };
  }
  return state;
}

export async function submitSos({ mode, id, recipientId, location }, { actor, outbox, transport } = {}) {
  if (mode === "practice") return { status: "practice_only" };
  if (mode !== "live" || !actor?.id || !outbox || !transport || !id || !recipientId) return { status: "unavailable" };
  if (location !== null && (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
    || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180 || !Number.isFinite(location.observedAt))) {
    return { status: "invalid_location" };
  }
  // The durable host must atomically check the server-side gesture/confirmation, owner, recipient consent, expiry and idempotency.
  const claimed = await outbox.claimConfirmed({ ownerId: actor.id, id, recipientId });
  if (claimed?.status !== "claimed") return { status: claimed?.status ?? "unavailable" };
  let status = "delivery_unknown";
  try {
    const result = await transport.send({ idempotencyKey: id, verifiedDestination: claimed.verifiedDestination, location });
    if (["provider_accepted", "failed"].includes(result?.status)) status = result.status;
  } catch {
    // A transport timeout does not tell us whether the provider accepted the message.
  }
  await outbox.recordResult({ id, status });
  return { status };
}

export async function acknowledgeSos({ id }, { actor, outbox }) {
  if (!actor?.id || !id) return { status: "forbidden" };
  return outbox.confirmRecipientReceipt({ id, recipientId: actor.id });
}
