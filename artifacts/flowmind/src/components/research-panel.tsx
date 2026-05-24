import { useState, useRef, useCallback, useEffect } from "react";
import { Search, X, Lock, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ResearchCard, type ResearchResultData } from "./research-card";
import { apiFetch } from "@/lib/auth";
import { Link } from "wouter";

interface ResearchPanelProps {
  sessionId: number;
  canResearch: boolean; // Pro/Business/admin
  researchAvailable: boolean; // TAVILY_API_KEY present
  researchUsed?: number;
  researchLimit?: number;
  mode: "copilot" | "insight";
  /** Preloaded results (e.g. from initial page load) */
  initialResults?: ResearchResultData[];
  onClose?: () => void;
  /** In insight mode the panel is always visible; in copilot it's a slide-over */
  inline?: boolean;
}

export function ResearchPanel({
  sessionId,
  canResearch,
  researchAvailable,
  researchUsed = 0,
  researchLimit = 0,
  mode,
  initialResults = [],
  onClose,
  inline = false,
}: ResearchPanelProps) {
  const [results, setResults] = useState<ResearchResultData[]>(initialResults);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [queryOpen, setQueryOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  const effectiveLimit = researchLimit === -1 ? Infinity : researchLimit;
  const remaining = effectiveLimit === Infinity ? null : Math.max(0, effectiveLimit - researchUsed);
  const tooltipText = remaining === null ? "Unlimited research" : `${remaining} / ${effectiveLimit} left this month`;

  const submitResearch = useCallback(
    async (customQuery?: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const localId = `loading-${Date.now()}`;
      setLoadingId(localId);
      setErrorMsg(null);

      try {
        const body: Record<string, unknown> = { sessionId, trigger: "manual" };
        if (customQuery?.trim()) body.query = customQuery.trim();

        const res = await apiFetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as Record<string, unknown>;
          if (res.status === 402) {
            setErrorMsg((data.message as string) ?? "Upgrade required to use Live Research.");
          } else {
            setErrorMsg((data.error as string) ?? "Research failed. Please try again.");
          }
          return;
        }

        const newResult: ResearchResultData = await res.json();
        setResults((prev) => [newResult, ...prev]);
        setQuery("");
        setQueryOpen(false);
      } catch {
        setErrorMsg("Network error — please try again.");
      } finally {
        setLoadingId(null);
        inFlightRef.current = false;
      }
    },
    [sessionId]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => submitResearch(query), 200);
  };

  // Auto-fire a transcript-derived search the very first time the panel
  // opens for a session that has no results yet, so users don't have to
  // hunt for the "Search from current transcript →" link.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (!canResearch) return;
    if (results.length > 0) return;
    if (loadingId) return;
    if (errorMsg) return;
    autoFiredRef.current = true;
    submitResearch();
    // submitResearch is stable (useCallback). We intentionally fire only on
    // mount + the gating booleans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canResearch]);

  const wrapperClass = inline
    ? "flex flex-col h-full"
    : "flex flex-col h-full bg-card border-l border-border/40";

  if (!researchAvailable) {
    return (
      <div className={wrapperClass}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            <span className="font-mono font-bold text-sm uppercase tracking-widest">Research</span>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="text-xs text-muted-foreground">Research unavailable — server not configured.</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className={wrapperClass}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 flex-none">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            <span className="font-mono font-bold text-sm uppercase tracking-widest">Research</span>
            {remaining !== null && (
              <span className="text-[10px] text-muted-foreground/60 font-mono">{remaining}/{effectiveLimit}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                {canResearch ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 gap-1 text-xs"
                    onClick={() => setQueryOpen((v) => !v)}
                  >
                    <Search className="h-3 w-3" />
                    {queryOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs opacity-50" disabled>
                    <Lock className="h-3 w-3" />
                    Pro
                  </Button>
                )}
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {canResearch ? tooltipText : "Pro feature — upgrade to research"}
              </TooltipContent>
            </Tooltip>
            {onClose && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Query input */}
        {queryOpen && canResearch && (
          <form onSubmit={handleSubmit} className="flex gap-2 px-4 py-2.5 border-b border-border/30 flex-none">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search query (leave blank to auto-derive)"
              className="h-8 text-xs font-mono"
              autoFocus
            />
            <Button type="submit" size="sm" className="h-8 px-3 text-xs" disabled={!!loadingId}>
              Go
            </Button>
          </form>
        )}

        {/* Not-Pro gate message */}
        {!canResearch && (
          <div className="px-4 py-3 bg-amber-500/5 border-b border-amber-500/20 flex items-center gap-2 flex-none">
            <Lock className="h-3.5 w-3.5 text-amber-500 flex-none" />
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Live Research requires Pro.{" "}
              <Link href="/pricing" className="underline hover:no-underline">Upgrade</Link>
            </span>
          </div>
        )}

        {/* Results scroll area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loadingId && (
            <ResearchCard isLoading />
          )}
          {errorMsg && !loadingId && (
            <ResearchCard error={errorMsg} onRetry={() => submitResearch()} />
          )}
          {!results.length && !loadingId && !errorMsg && (
            <div className="text-center py-12 text-muted-foreground/50">
              <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="text-xs font-mono uppercase tracking-widest">No research yet</p>
              {canResearch && (
                <button
                  onClick={() => submitResearch()}
                  className="mt-3 text-xs text-primary/70 hover:text-primary transition-colors"
                >
                  Search from current transcript →
                </button>
              )}
            </div>
          )}
          {results.map((r) => (
            <ResearchCard key={r.id} result={r} />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
