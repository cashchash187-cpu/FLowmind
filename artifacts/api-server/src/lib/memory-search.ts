import { db, memoPagesTable, sessionsTable, transcriptsTable } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

/**
 * "Ask your Memory" — natural-language Q&A across the user's entire
 * knowledge base: every Memory page PLUS every meeting transcript.
 *
 * This is the feature the market leaders can't do — Otter/Fireflies search
 * is meeting-content-only and doesn't synthesize across sources. Here the
 * user asks "Was war nochmal mit Funding Port und dem Term Sheet?" and gets
 * a direct answer grounded in whatever they captured, with citations back
 * to the source page/meeting.
 *
 * Retrieval is keyword-overlap scoring (no embedding infra needed for a
 * personal-scale corpus) → top sources go into an LLM synthesis call.
 */

export interface MemorySource {
  kind: "page" | "meeting";
  id: number;
  label: string; // "Privat / Geburtstage" or meeting title
  snippet: string;
}

export interface MemoryAnswer {
  answer: string;
  sources: MemorySource[];
  usedSources: number;
}

interface Candidate {
  kind: "page" | "meeting";
  id: number;
  label: string;
  text: string;
  recency: number; // epoch ms, for tie-breaking
}

const STOPWORDS = new Set([
  "der", "die", "das", "und", "ist", "ein", "eine", "von", "mit", "für", "auf", "den", "dem", "im", "was", "wer", "wie", "wo", "wann", "warum",
  "the", "and", "is", "a", "an", "of", "to", "for", "on", "in", "what", "who", "how", "where", "when", "why", "was", "were", "about",
]);

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function scoreOverlap(queryTokens: Set<string>, text: string): number {
  const t = tokens(text);
  if (t.length === 0) return 0;
  let hits = 0;
  const seen = new Set<string>();
  for (const w of t) {
    if (queryTokens.has(w) && !seen.has(w)) { hits++; seen.add(w); }
  }
  return hits;
}

export async function answerFromMemory(userId: number, question: string): Promise<MemoryAnswer> {
  if (!llmConfigured) throw new Error("LLM not configured");
  const q = question.trim();
  if (!q) throw new Error("Empty question");

  // Gather candidates: all pages + recent meeting transcripts (cap to keep
  // retrieval cheap on large histories).
  const pages = await db.select().from(memoPagesTable).where(eq(memoPagesTable.userId, userId)).orderBy(desc(memoPagesTable.updatedAt)).limit(200);

  const sessions = await db
    .select({ id: sessionsTable.id, title: sessionsTable.title, createdAt: sessionsTable.createdAt })
    .from(sessionsTable)
    .where(eq(sessionsTable.userId, userId))
    .orderBy(desc(sessionsTable.createdAt))
    .limit(60);

  const candidates: Candidate[] = [];
  for (const p of pages) {
    candidates.push({
      kind: "page",
      id: p.id,
      label: `${p.folder} / ${p.title}`,
      text: `${p.title}\n${p.content}`,
      recency: new Date(p.updatedAt).getTime(),
    });
  }
  // Pull transcripts for the recent sessions in one grouped read.
  for (const s of sessions) {
    const rows = await db
      .select({ text: transcriptsTable.text, speakerLabel: transcriptsTable.speakerLabel })
      .from(transcriptsTable)
      .where(eq(transcriptsTable.sessionId, s.id))
      .orderBy(asc(transcriptsTable.startMs));
    if (!rows.length) continue;
    candidates.push({
      kind: "meeting",
      id: s.id,
      label: s.title,
      text: `${s.title}\n` + rows.map((r) => `${r.speakerLabel}: ${r.text}`).join("\n"),
      recency: s.createdAt ? new Date(s.createdAt).getTime() : 0,
    });
  }

  if (candidates.length === 0) {
    return { answer: "Dein Memory ist noch leer — sprich oder tippe ein paar Notizen ein, dann kann ich Fragen dazu beantworten.", sources: [], usedSources: 0 };
  }

  // Rank by keyword overlap, recency as tie-break.
  const qTokens = new Set(tokens(q));
  const ranked = candidates
    .map((c) => ({ c, score: scoreOverlap(qTokens, c.text) }))
    .sort((a, b) => (b.score - a.score) || (b.c.recency - a.c.recency));

  // Keep sources with any overlap; if NOTHING overlaps (vague question),
  // fall back to the most recent handful so the model still has context.
  let top = ranked.filter((r) => r.score > 0).slice(0, 6).map((r) => r.c);
  if (top.length === 0) top = ranked.slice(0, 4).map((r) => r.c);

  // Cap the context fed to the model so a few huge meetings don't blow it.
  const sourcesBlock = top.map((c, i) => {
    const body = c.text.replace(/\s+/g, " ").slice(0, 2500);
    return `[Quelle ${i + 1} — ${c.kind === "page" ? "Notiz" : "Meeting"}: ${c.label}]\n${body}`;
  }).join("\n\n");

  const SYSTEM = `Du bist das Gedächtnis des Nutzers. Beantworte seine Frage NUR auf Basis der bereitgestellten Quellen (seine Notizen und Meeting-Transkripte).

Regeln:
- Antworte direkt und konkret in der Sprache der Frage.
- Stütze dich ausschließlich auf die Quellen. Erfinde nichts.
- Wenn die Quellen die Antwort nicht enthalten, sage das ehrlich ("Dazu habe ich nichts gespeichert") und schlage vor, was der Nutzer einsprechen könnte.
- Verweise am Ende relevanter Aussagen knapp auf die Quelle in Klammern, z.B. "(Meeting: Müller GmbH)" oder "(Notiz: Privat/Geburtstage)".
- Halte dich kurz: 1-4 Sätze, außer die Frage verlangt mehr.`;

  let answer: string;
  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 800,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Frage: ${q}\n\nQuellen:\n${sourcesBlock}` },
      ],
    });
    answer = completion.choices[0]?.message?.content?.trim() || "Ich konnte dazu keine Antwort bilden.";
  } catch (err) {
    logger.error({ err, userId }, "[MEMORY-SEARCH] synthesis failed");
    throw err;
  }

  return {
    answer,
    sources: top.map((c) => ({ kind: c.kind, id: c.id, label: c.label, snippet: c.text.replace(/\s+/g, " ").slice(0, 160) })),
    usedSources: top.length,
  };
}
