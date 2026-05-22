import { useState } from "react";
import { ExternalLink, Search, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchResultData {
  id: number;
  sessionId: number;
  query: string;
  answer: string;
  sources: ResearchSource[];
  trigger: string;
  createdAt: string;
}

interface ResearchCardProps {
  result?: ResearchResultData | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ResearchCard({ result, isLoading, error, onRetry }: ResearchCardProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-primary animate-pulse" />
          <span className="text-xs font-mono text-muted-foreground animate-pulse">Searching the web…</span>
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
        <div className="space-y-2 pt-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
          <span className="text-xs font-semibold text-destructive">Couldn't fetch results</span>
        </div>
        <p className="text-xs text-muted-foreground">{error}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5 text-xs h-7">
            <RefreshCw className="h-3 w-3" />
            Try again
          </Button>
        )}
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      {/* Query header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border/40">
        <Search className="h-3.5 w-3.5 text-primary flex-none" />
        <span className="text-[11px] font-mono text-muted-foreground truncate flex-1">{result.query}</span>
      </div>

      {/* Answer */}
      <div className="px-4 py-3">
        <p className="text-sm leading-relaxed text-foreground">{result.answer}</p>
      </div>

      {/* Sources */}
      {result.sources.length > 0 && (
        <div className="px-4 pb-3 space-y-1.5">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Sources</p>
          {result.sources.map((src, i) => (
            <div key={i}>
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-colors group"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary/60 flex-none" />
                <span className="text-xs text-foreground/90 truncate flex-1 group-hover:text-primary transition-colors">
                  {src.title}
                </span>
                <span className="text-[10px] text-muted-foreground/60 font-mono flex-none">{getDomain(src.url)}</span>
                <ExternalLink className="h-3 w-3 text-muted-foreground/40 flex-none group-hover:text-primary transition-colors" />
              </a>
              {src.snippet && expanded === i && (
                <p className="text-xs text-muted-foreground mt-1 px-3 pb-1 leading-relaxed">{src.snippet}</p>
              )}
              {src.snippet && (
                <button
                  onClick={() => setExpanded(expanded === i ? null : i)}
                  className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground ml-3 transition-colors"
                >
                  {expanded === i ? "hide" : "snippet"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border/30 bg-muted/20">
        <span className="text-[10px] text-muted-foreground/50 font-mono">
          via web · {result.trigger === "auto" ? "auto" : "manual"} ·{" "}
          {formatDistanceToNow(new Date(result.createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}
