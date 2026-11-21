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

const standardPricesPerMillion = {
  "gpt-6-luna": { input: 0.10, cachedInput: 0.01, output: 0.50 },
  "gpt-6.1-terra": { input: 1, cachedInput: 0.05, output: 5 },
  "gpt-6.1-sol": { input: 2, cachedInput: 0.10, output: 10 },
};

export function estimateModelCost(usage) {
  const price = usage && Object.hasOwn(standardPricesPerMillion, usage.model) ? standardPricesPerMillion[usage.model] : null;
  if (!price) return null;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens);
  return (uncached * price.input + usage.cachedInputTokens * price.cachedInput
    + usage.cacheWriteTokens * price.input * 1.25 + usage.outputTokens * price.output) / 1_000_000;
}

export class ModelResponseError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function providerSchema(schema) {
  // The local validator enforces these limits beyond the provider's schema subset.
  const { minLength, maxLength, uniqueItems, properties, items, ...shape } = schema;
  if (properties) shape.properties = Object.fromEntries(Object.entries(properties)
    .map(([key, child]) => [key, providerSchema(child)]));
  if (items) shape.items = providerSchema(items);
  return shape;
}

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
          ...(tools ? {
            tools: tools.map(tool => ({ ...tool, parameters: providerSchema(tool.parameters) })),
            parallel_tool_calls: false, tool_choice: "required", include: ["reasoning.encrypted_content"],
          } : {}),
          ...(schema ? { text: { format: { type: "json_schema", name: role, schema: providerSchema(schema), strict: true } } } : {}),
        }),
        signal,
      });
    } catch (error) {
      recordRequest(signal?.aborted ? "aborted" : "network_error", null);
      throw error;
    }
    recordRequest(response.ok ? "http_ok" : "http_error", response.status);
    if (!response.ok) throw new ModelResponseError(`Model request failed (${response.status})`, response.status);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new ModelResponseError("Invalid model response", 422);
    }
    if (result?.usage && onUsage) {
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
    if (result?.status !== "completed" || !Array.isArray(result.output)) {
      throw new ModelResponseError("Model output incomplete", 422);
    }
    return result.output;
  }

  return {
    turn: request,
    async structured(role, options) {
      const output = await request(role, options);
      const text = output.filter(item => item?.type === "message" && Array.isArray(item.content))
        .flatMap(item => item.content).find(item => item?.type === "output_text");
      if (!text) throw new ModelResponseError("Model output unavailable", 422);
      try {
        return JSON.parse(text.text);
      } catch {
        throw new ModelResponseError("Invalid model output", 422);
      }
    },
  };
}
