export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchResult {
  answer: string;
  sources: ResearchSource[];
}

/** Returns true if the TAVILY_API_KEY is configured. */
export function isResearchAvailable(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

/**
 * Performs a web research query via Tavily.
 * Only the derived query is sent — never a raw transcript dump.
 */
export async function research(query: string): Promise<ResearchResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not configured");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      include_answer: true,
      max_results: 5,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    answer?: string;
    results?: { title?: string; url?: string; content?: string }[];
  };

  const sources: ResearchSource[] = (data.results ?? []).slice(0, 5).map((r) => ({
    title: r.title ?? "Untitled",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));

  return {
    answer: data.answer ?? "No direct answer found — see sources below.",
    sources,
  };
}
