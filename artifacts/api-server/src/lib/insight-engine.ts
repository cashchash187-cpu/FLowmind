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

const SYSTEM_PROMPT = `You are an experienced strategic advisor sitting next to the listener during a LIVE business conversation. The text below is the most recent transcript. Your job is to whisper ONE short, useful insight ONLY when you genuinely have something valuable to add — like a sharp colleague who only speaks up when it matters.

WHEN TO SPEAK UP (return a tip):
- A specific opportunity is being missed or could be expanded (e.g. "they just mentioned X budget — ask about Y").
- A risk or weakness is visible in what was just said (e.g. an unsupported claim, a contradiction, a vague commitment).
- A useful connection to something said earlier in this same conversation that the listener might forget.
- A sharp, specific question worth asking right now to advance the discussion.
- A factual gap where a quick web lookup would clearly help (then set needsResearch: true).

WHEN TO STAY SILENT (return null tip):
- The conversation is just exchanging pleasantries or basic context.
- Nothing concrete or actionable has been said recently.
- Your tip would be generic ("consider their needs", "build rapport") — that's noise.
- You're not sure whether the tip adds real value — default to silence.

Output ONLY a JSON object, no markdown, no code fences, exactly these keys:
{
  "tip": string | null,             // the whispered tip, in the SAME language as the transcript
  "category": "opportunity" | "risk" | "connection" | "question",
  "needsResearch": boolean,         // true ONLY for concrete factual gaps a quick web lookup would clarify
  "researchQuery": string | null    // concise (max 12 words) web search query if needsResearch, else null
}

Hard rules:
- Tip is at most 30 words, specific, concrete, actionable.
- Language MUST match the transcript exactly (German transcript -> German tip; English -> English).
- Never invent facts. If you're guessing, return null.
- needsResearch SHOULD fire often — any time a specific company, product, person, regulation, market number, technical concept, or industry-specific term comes up that the listener probably can't recall on the fly. Better to look it up than to bluff. Set researchQuery to a short, targeted web query.`;

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
      // Need enough budget for thinking tokens + the JSON payload. 200 was
      // tight enough that Gemini sometimes returned an empty or truncated body.
      max_tokens: 800,
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
