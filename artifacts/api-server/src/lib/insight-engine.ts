import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

export type InsightCategory = "opportunity" | "risk" | "connection" | "question";

export interface GeneratedInsight {
  tip: string;
  category: InsightCategory;
  needsResearch: boolean;
  researchQuery: string | null;
}

const VALID_CATEGORIES: InsightCategory[] = ["opportunity", "risk", "connection", "question"];

const SYSTEM_PROMPT = `You are a real-time conversation copilot listening to a LIVE transcript of an ongoing conversation. Based on the most recent snippet, decide whether ONE short, high-value live tip is genuinely warranted RIGHT NOW.

Stay silent most of the time. Only produce a tip when there is a clear, specific opportunity, risk, useful connection to something said earlier, or a sharp question worth asking. Generic or obvious observations are NOT worth surfacing — when in doubt, return null.

Respond with ONLY a JSON object (no markdown, no code fences), with exactly these keys:
{
  "tip": string | null,        // the live tip for the listener, in the SAME language as the transcript; null if nothing is worth saying
  "category": "opportunity" | "risk" | "connection" | "question",
  "needsResearch": boolean,    // true ONLY if a concrete factual claim, name, number, or question came up that a quick web lookup would meaningfully clarify
  "researchQuery": string | null  // a concise (max 12 words) web search query if needsResearch is true, otherwise null
}

Rules:
- The tip MUST be under 30 words, specific, and immediately actionable.
- Match the transcript's language exactly (German transcript -> German tip).
- Never invent facts. If unsure whether a tip adds value, return "tip": null.
- needsResearch should be true rarely — only for genuine factual gaps, not for opinions or strategy.`;

/**
 * Ask the LLM whether a live tip is warranted for the current transcript context.
 * Returns null when no tip should be shown (silence) or when the LLM is unavailable.
 */
export async function generateInsight(recentText: string): Promise<GeneratedInsight | null> {
  if (!llmConfigured) return null;
  const text = recentText.trim();
  if (text.length < 40) return null; // not enough context yet

  let raw: string;
  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 200,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Recent transcript:\n\n${text}\n\nDecide now.` },
      ],
    });
    raw = completion.choices[0]?.message?.content?.trim() || "";
  } catch (err) {
    logger.error({ err }, "[INSIGHT-ENGINE] LLM call failed");
    return null;
  }

  if (!raw) return null;

  let parsed: Partial<GeneratedInsight>;
  try {
    // Strip accidental code fences just in case
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    logger.warn({ raw: raw.slice(0, 200) }, "[INSIGHT-ENGINE] Non-JSON LLM output");
    return null;
  }

  const tip = typeof parsed.tip === "string" ? parsed.tip.trim() : "";
  if (!tip) return null; // explicit silence

  const category: InsightCategory = VALID_CATEGORIES.includes(parsed.category as InsightCategory)
    ? (parsed.category as InsightCategory)
    : "question";

  const needsResearch = parsed.needsResearch === true;
  const researchQuery =
    needsResearch && typeof parsed.researchQuery === "string" && parsed.researchQuery.trim()
      ? parsed.researchQuery.trim().slice(0, 200)
      : null;

  return { tip, category, needsResearch, researchQuery: needsResearch ? researchQuery : null };
}
