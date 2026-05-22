import OpenAI from "openai";

/**
 * Provider-agnostic LLM client.
 *
 * Works with any OpenAI-compatible endpoint. Switch providers with env vars only:
 *
 *   Gemini (recommended free tier):
 *     LLM_BASE_URL = https://generativelanguage.googleapis.com/v1beta/openai/
 *     LLM_API_KEY  = <your Google AI Studio key>
 *     LLM_MODEL    = gemini-2.5-flash
 *
 *   Groq:
 *     LLM_BASE_URL = https://api.groq.com/openai/v1
 *     LLM_API_KEY  = <groq key>
 *     LLM_MODEL    = llama-3.3-70b-versatile
 *
 *   OpenRouter:
 *     LLM_BASE_URL = https://openrouter.ai/api/v1
 *     LLM_API_KEY  = <openrouter key>
 *     LLM_MODEL    = google/gemini-2.5-flash
 *
 *   OpenAI direct (no base URL needed):
 *     LLM_API_KEY  = <openai key>
 *     LLM_MODEL    = gpt-5.4
 *
 * Falls back to the old Replit AI-integration env vars for backward compatibility.
 */

const apiKey =
  process.env.LLM_API_KEY ||
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
  process.env.OPENAI_API_KEY;

const baseURL =
  process.env.LLM_BASE_URL ||
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
  undefined;

/** Default chat model. Override with LLM_MODEL. */
export const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";

/** True when an API key is configured. Lets callers fail gracefully instead of crashing the server at boot. */
export const llmConfigured = !!apiKey;

if (!apiKey) {
  // Do NOT throw — a missing key must not take down the whole API server.
  // Individual LLM calls will surface a clear error instead.
  console.warn(
    "[LLM] No API key found. Set LLM_API_KEY (+ LLM_BASE_URL, LLM_MODEL). AI features will return an explicit error until configured.",
  );
}

const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
  apiKey: apiKey ?? "missing-key",
};
if (baseURL) clientOptions.baseURL = baseURL;

export const openai = new OpenAI(clientOptions);
