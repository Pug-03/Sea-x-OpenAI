export const modelProfiles = Object.freeze({
  intent: Object.freeze({ model: "gpt-6.1-terra", effort: "none" }),
  planner: Object.freeze({ model: "gpt-6.1-terra", effort: "high", maxOutputTokens: 4096 }),
  critic: Object.freeze({ model: "gpt-6.1-sol", effort: "high", maxOutputTokens: 6144 }),
  companion: Object.freeze({ model: "gpt-6.1-terra", effort: "none" }),
  steward: Object.freeze({ model: "gpt-6.1-terra", effort: "low" }),
  news: Object.freeze({ model: "gpt-6.2-sol", effort: "medium" }),
});

export const objectSchema = properties => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
export const stringEnum = (...values) => ({ type: "string", enum: values });

export function createModelClient({ apiKey, fetchImpl = fetch, onUsage, onRequest } = {}) {
  if (!apiKey) return null;

  async function request(role, { instructions, input, tools, schema, signal }) {
    if (!Object.hasOwn(modelProfiles, role)) throw new TypeError("Unknown model role");
    const { model, effort, maxOutputTokens = 900 } = modelProfiles[role];
    const started = performance.now();
    const recordRequest = (outcome, httpStatus) => {
      onRequest?.({ role, model, outcome, httpStatus, elapsedMs: Math.round(performance.now() - started) });
    };
    let response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, instructions, input, store: false, reasoning: { effort }, max_output_tokens: maxOutputTokens,
          ...(tools ? { tools, parallel_tool_calls: false, tool_choice: "required", include: ["reasoning.encrypted_content"] } : {}),
          ...(schema ? { text: { format: { type: "json_schema", name: role, schema, strict: true } } } : {}),
        }),
        signal,
      });
    } catch (error) {
      recordRequest(signal?.aborted ? "aborted" : "network_error", null);
      throw error;
    }
    recordRequest(response.ok ? "http_ok" : "http_error", response.status);
    if (!response.ok) throw new Error(`Model request failed (${response.status})`);
    const result = await response.json();
    if (result.usage && onUsage) {
      const { input_tokens, output_tokens, input_tokens_details, output_tokens_details } = result.usage;
      onUsage({
        role, model,
        inputTokens: Number(input_tokens) || 0,
        outputTokens: Number(output_tokens) || 0,
        cachedInputTokens: Number(input_tokens_details?.cached_tokens) || 0,
        cacheWriteTokens: Number(input_tokens_details?.cache_write_tokens) || 0,
        reasoningTokens: Number(output_tokens_details?.reasoning_tokens) || 0,
        status: result.incomplete_details?.reason ?? result.status,
      });
    }
    if (result.status !== "completed" || !Array.isArray(result.output)) throw new Error("Model output incomplete");
    return result.output;
  }

  return {
    turn: request,
    async structured(role, options) {
      const output = await request(role, options);
      const text = output.filter(item => item.type === "message")
        .flatMap(item => item.content ?? []).find(item => item.type === "output_text");
      if (!text) throw new Error("Model output unavailable");
      return JSON.parse(text.text);
    },
  };
}
