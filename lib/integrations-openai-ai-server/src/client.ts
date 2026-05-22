import OpenAI from "openai";

const apiKey =
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
  process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error(
    "No OpenAI API key found. Set OPENAI_API_KEY or provision the OpenAI AI integration.",
  );
}

const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };

if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  clientOptions.baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
}

export const openai = new OpenAI(clientOptions);
