import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "wouter";
import {
  useGetSession,
  getGetSessionQueryKey,
  useListTranscripts,
  getListTranscriptsQueryKey,
  useEndSession,
  useRequestAiAssist,
  useUpdateSession,
  useAddTranscript,
  useGenerateAiSummary,
  getGetSessionNotesQueryKey,
  useGetCurrentUsage,
  getGetCurrentUsageQueryKey,
  useGetConfig,
} from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/auth";
import { InsightStream } from "@/components/insight-stream";
import { BrowserSupportCheck } from "@/components/browser-support-check";
import { ResearchPanel } from "@/components/research-panel";
import type { ResearchResultData } from "@/components/research-card";
import {
  Mic,
  MicOff,
  Square,
  MessageSquare,
  Zap,
  CheckCircle2,
  HelpCircle,
  AlertTriangle,
  Loader2,
  FileText,
  AlertCircle,
  Globe,
  Play,
  PanelRight,
  Search,
  Lock,
  ToggleLeft,
  ToggleRight,
  Settings2,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQueryClient } from "@tanstack/react-query";
import {
  type LiveTranscriptChunk,
  LANGUAGE_OPTIONS,
  type LanguageCode,
} from "@/hooks/use-speech-recognition";
import { useTranscription } from "@/lib/transcription";
import { useSessionTimer } from "@/hooks/use-session-timer";
import { MicVisualizer } from "@/components/mic-visualizer";
import { UsageLimitBanner } from "@/components/usage-limit-banner";
import {
  writeToBuffer,
  markSaved,
  pendingEntries,
} from "@/hooks/use-transcript-buffer";
import { useAuthStore } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

// A locally-confirmed transcript entry (optimistic — not yet from DB)
interface OptimisticEntry {
  _optimisticId: string;
  speakerLabel: string;
  text: string;
  startMs: number;
}

function formatTime(ms: number) {
  const secs = Math.floor(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Shared AI assist mode definitions so the desktop bottom bar and the mobile
// 4-up grid stay in sync.
const AI_MODES = [
  { mode: "objection", label: "Counter", icon: AlertTriangle },
  { mode: "answer", label: "Answer", icon: MessageSquare },
  { mode: "explain", label: "Explain", icon: HelpCircle },
  { mode: "logic_check", label: "Logic", icon: CheckCircle2 },
] as const;

export default function SessionLive() {
  const params = useParams();
  const sessionId = Number(params.id);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { toast } = useToast();

  const { data: session, isLoading: sessionLoading } = useGetSession(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId) },
  });

  const { data: dbTranscripts, isLoading: transcriptsLoading } = useListTranscripts(sessionId, {
    query: {
      enabled: !!sessionId,
      queryKey: getListTranscriptsQueryKey(sessionId),
      refetchInterval: session?.status === "active" ? 6000 : false,
      staleTime: 30_000,
    },
  });

  const endSession = useEndSession();
  const requestAi = useRequestAiAssist();
  const updateSession = useUpdateSession();
  const addTranscript = useAddTranscript();
  const generateSummary = useGenerateAiSummary();

  // Config — tells us if research is available (TAVILY_API_KEY set)
  const { data: config } = useGetConfig();
  const researchAvailable = config?.researchAvailable ?? false;

  // Usage data — poll every 30s during active sessions to keep banner current
  const { data: usage } = useGetCurrentUsage({
    query: { refetchInterval: 30_000, queryKey: getGetCurrentUsageQueryKey() },
  });

  // Plan checks
  const canResearch =
    user?.isAdmin ||
    user?.plan === "pro" ||
    user?.plan === "business" ||
    user?.plan === "admin";

  const isInsightMode = session?.mode === "insight";

  // Language selection (browser STT only) — persisted to localStorage
  const [language, setLanguage] = useState<LanguageCode>(
    () => (localStorage.getItem("fm_stt_lang") as LanguageCode) ?? "de-DE"
  );

  // Engine override — Pro users can manually force "browser" STT
  // "auto" = plan-determined (default), "browser" = force browser even for Pro
  const [engineOverride, setEngineOverride] = useState<"auto" | "browser">(
    () => (localStorage.getItem("fm_stt_engine") as "auto" | "browser") ?? "auto"
  );
  const isPro = user?.isAdmin || user?.plan === "pro" || user?.plan === "business" || user?.plan === "admin";
  const forceEngine = isPro && engineOverride === "browser" ? "browser" : undefined;

  // Optimistic transcript list: chunks spoken but not yet confirmed from DB
  const [optimistic, setOptimistic] = useState<OptimisticEntry[]>([]);
  const confirmedIdsRef = useRef<Set<string>>(new Set());

  // On mount: recover any pending entries from sessionStorage (survive navigation)
  useEffect(() => {
    if (!sessionId) return;
    const pending = pendingEntries(sessionId);
    if (pending.length > 0) {
      setOptimistic(
        pending.map((e) => ({
          _optimisticId: e.localId,
          speakerLabel: e.speakerLabel,
          text: e.text,
          startMs: e.startMs,
        }))
      );
      pending.forEach((entry) => {
        addTranscript.mutate(
          {
            id: sessionId,
            data: {
              speakerLabel: entry.speakerLabel,
              text: entry.text,
              startMs: entry.startMs,
            },
          },
          {
            onSuccess: () => {
              markSaved(sessionId, entry.localId);
              queryClient.invalidateQueries({ queryKey: getListTranscriptsQueryKey(sessionId) });
            },
          }
        );
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // When DB transcripts update, retire optimistic entries that are now persisted
  useEffect(() => {
    if (!dbTranscripts?.length || !optimistic.length) return;
    const dbTexts = new Set(dbTranscripts.map((t) => `${t.speakerLabel}|${t.text}`));
    const nowConfirmed = optimistic
      .filter((o) => dbTexts.has(`${o.speakerLabel}|${o.text}`))
      .map((o) => o._optimisticId);
    if (nowConfirmed.length > 0) {
      nowConfirmed.forEach((id) => {
        confirmedIdsRef.current.add(id);
        markSaved(sessionId, id);
      });
      setOptimistic((prev) => prev.filter((o) => !confirmedIdsRef.current.has(o._optimisticId)));
    }
  }, [dbTranscripts, optimistic, sessionId]);

  // Merged view: DB entries + still-pending optimistic ones
  const pendingOptimistic = optimistic.filter((o) => !confirmedIdsRef.current.has(o._optimisticId));
  const allTranscripts = [
    ...(dbTranscripts ?? []).map((t) => ({
      id: String(t.id),
      speakerLabel: t.speakerLabel,
      text: t.text,
      startMs: t.startMs,
      isOptimistic: false,
    })),
    ...pendingOptimistic.map((o) => ({
      id: o._optimisticId,
      speakerLabel: o.speakerLabel,
      text: o.text,
      startMs: o.startMs,
      isOptimistic: true,
    })),
  ].sort((a, b) => a.startMs - b.startMs);

  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiResponse, setAiResponse] = useState<{
    mode: string;
    suggestion: string;
    reasoning?: string | null;
  } | null>(null);
  const [aiLimitExceeded, setAiLimitExceeded] = useState(false);
  // Insights are now always visible in insight mode (no toggle), so this
  // state only exists for back-compat with any leftover references.
  const [insightPanelOpen] = useState(true);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);

  // Research panel state
  const [researchPanelOpen, setResearchPanelOpen] = useState(false);
  const [researchResults, setResearchResults] = useState<ResearchResultData[]>([]);

  // Mobile settings sheet — bundles STT, language, research, diarization.
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);

  // Speaker diarization toggle — persisted per browser. When OFF, the server
  // skips Deepgram's diarize flag AND the frontend hides Speaker labels in
  // both the live view and the exported PDF.
  const [diarize, setDiarize] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("fm_diarize") === "1";
  });
  function toggleDiarize(next: boolean) {
    setDiarize(next);
    try { localStorage.setItem("fm_diarize", next ? "1" : "0"); } catch {}
    // The new flag takes effect on the next mic restart (the user can stop
    // + start the mic to apply it mid-session).
  }

  // Auto-research is now driven entirely server-side by the insight engine
  // — no client-side toggle or loop. These stubs stay only because other
  // code still references the names (they get stripped on the next pass).

  // Heartbeat — ping server every 30s while mic is running
  const heartbeat = useMutation({
    mutationFn: async () => {
      await apiFetch(`/api/sessions/${sessionId}/heartbeat`, { method: "POST" });
    },
  });

  const resumeSession = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/sessions/${sessionId}/resume`, { method: "POST" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
      setResumeModalOpen(false);
    },
  });

  const scrollBottomRef = useRef<HTMLDivElement>(null);
  const notesTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Manually scroll the nearest scrollable ancestor instead of using
    // element.scrollIntoView — the latter walks up ALL scroll ancestors,
    // which on iOS Safari pulls the document itself down and hides the
    // mobile top bar with the FlowMind logo each time a new transcript
    // chunk arrives. We only want to scroll the transcript viewport.
    const el = scrollBottomRef.current;
    if (!el) return;
    let parent: HTMLElement | null = el.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      const overflowY = style.overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
        parent.scrollTo({ top: parent.scrollHeight, behavior: "smooth" });
        return;
      }
      parent = parent.parentElement;
    }
  }, [allTranscripts.length]);

  // Handle a finalised speech chunk.
  //
  // Browser STT runs entirely client-side, so the client must POST every
  // final to /api/sessions/:id/transcripts. Deepgram runs through the
  // server WS bridge which ALREADY persists each final to the DB — POSTing
  // again from the client created duplicate (and on mobile reconnects
  // triple) transcript rows. We detect the source via the chunk-id prefix
  // (Deepgram chunks are minted with "dg-" by useTranscription) and skip
  // the REST POST in that case.
  const handleFinalChunk = useCallback(
    (chunk: LiveTranscriptChunk) => {
      const isDeepgram = chunk.id.startsWith("dg-");

      writeToBuffer(sessionId, {
        localId: chunk.id,
        sessionId,
        speakerLabel: chunk.speakerLabel,
        text: chunk.text,
        startMs: chunk.startMs,
      });

      setOptimistic((prev) => [
        ...prev,
        {
          _optimisticId: chunk.id,
          speakerLabel: chunk.speakerLabel,
          text: chunk.text,
          startMs: chunk.startMs,
        },
      ]);

      if (isDeepgram) {
        // Server already persisted via the WS bridge. Just nudge the cache.
        markSaved(sessionId, chunk.id);
        queryClient.invalidateQueries({ queryKey: getListTranscriptsQueryKey(sessionId) });
        return;
      }

      addTranscript.mutate(
        {
          id: sessionId,
          data: {
            speakerLabel: chunk.speakerLabel,
            text: chunk.text,
            startMs: chunk.startMs,
          },
        },
        {
          onSuccess: () => {
            markSaved(sessionId, chunk.id);
            queryClient.invalidateQueries({ queryKey: getListTranscriptsQueryKey(sessionId) });
          },
        }
      );
    },
    [sessionId, addTranscript, queryClient]
  );

  const speech = useTranscription({
    sessionId,
    // Pass the user's choice through to both engines. Deepgram maps "auto" to
    // its multilingual model; browser STT falls back to the system default
    // when "auto" is picked.
    language,
    onFinalChunk: handleFinalChunk,
    sessionBaseTime: session?.createdAt ? new Date(session.createdAt).getTime() : undefined,
    forceEngine,
    diarize,
  });

  // Timer — sync duration to server every 10s
  const { formatted: timerFormatted } = useSessionTimer({
    initialSeconds: session?.durationSeconds ?? 0,
    active: session?.status === "active" && speech.isListening,
    syncIntervalSeconds: 10,
    onTick: (s) => {
      updateSession.mutate({ id: sessionId, data: { durationSeconds: s } });
    },
  });

  // Notes-mode: auto-regenerate AI summary every 30s while active and listening
  useEffect(() => {
    if (session?.mode === "notes" && session?.status === "active" && speech.isListening) {
      notesTimerRef.current = setInterval(() => {
        generateSummary.mutate(
          { id: sessionId },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getGetSessionNotesQueryKey(sessionId) });
            },
          }
        );
      }, 30000);
    }
    return () => {
      if (notesTimerRef.current) clearInterval(notesTimerRef.current);
    };
  }, [session?.mode, session?.status, speech.isListening, sessionId, generateSummary, queryClient]);

  // Heartbeat — ping every 30s while mic is running
  useEffect(() => {
    if (speech.isListening && session?.status === "active") {
      heartbeatRef.current = setInterval(() => heartbeat.mutate(), 30_000);
    } else {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    }
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.isListening, session?.status]);

  // Auto-research is now handled entirely server-side by the insight ticker
  // (agentic flow: decide → research → synthesize). No client loop required —
  // the React Query subscription on the research panel picks up new rows
  // automatically.

  // Show resume modal when session goes idle
  useEffect(() => {
    if (session?.status === "idle") {
      setResumeModalOpen(true);
    }
  }, [session?.status]);

  // Toast on Deepgram errors so they are never invisible
  useEffect(() => {
    if (speech.engine === "deepgram" && speech.error && !speech.error.startsWith("Connection dropped")) {
      toast({ title: "Transcription error", description: speech.error, variant: "destructive" });
    }
  }, [speech.error, speech.engine]);

  const handleEndSession = () => {
    speech.stop();
    endSession.mutate(
      { id: sessionId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
        },
      }
    );
  };

  // Build rolling context for AI — include all confirmed + pending
  const buildContext = useCallback(() => {
    if (!allTranscripts.length) return "";
    return allTranscripts
      .slice(-12)
      .map((t) => `${t.speakerLabel}: ${t.text}`)
      .join("\n");
  }, [allTranscripts]);

  const handleAiAssist = (mode: "objection" | "answer" | "explain" | "logic_check") => {
    setAiResponse(null);
    setAiLimitExceeded(false);
    setAiPanelOpen(true);
    requestAi.mutate(
      { id: sessionId, data: { mode, context: buildContext() } },
      {
        onSuccess: (res) => setAiResponse(res),
        onError: (err: unknown) => {
          const apiErr = err as { status?: number; data?: { error?: string; limitExceeded?: boolean } };
          const status = apiErr?.status;
          if (status === 429 || apiErr?.data?.limitExceeded) {
            setAiLimitExceeded(true);
          } else if (status === 403) {
            setAiPanelOpen(false);
            toast({ title: "Request blocked", description: "CSRF validation failed — try refreshing the page.", variant: "destructive" });
          } else if (status === 402) {
            setAiPanelOpen(false);
            toast({ title: "Plan limit reached", description: "Upgrade your plan to use more AI requests.", variant: "destructive" });
          } else {
            setAiPanelOpen(false);
            toast({ title: "AI request failed", description: `Error ${status ?? "unknown"} — please try again.`, variant: "destructive" });
          }
        },
      }
    );
  };

  if (sessionLoading) {
    return (
      <div className="p-6 h-full flex flex-col gap-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="flex-1 w-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6 text-muted-foreground font-mono text-sm">Session not found.</div>
    );
  }

  const isSessionActive = session.status === "active";
  const currentLang = LANGUAGE_OPTIONS.find((l) => l.code === language);

  // Research quota display
  const researchUsed = (usage as Record<string, number> | undefined)?.researchRequestsUsed ?? 0;
  const researchLimit = (usage as Record<string, number> | undefined)?.researchRequestsLimit ?? 0;

  return (
    <TooltipProvider delayDuration={300}>
    {/* Wave 18c: h-full + max-h-full + min-h-0 belt-and-suspenders so the
        session NEVER grows beyond the parent <main>. Earlier the transcript
        ScrollArea's internal content sometimes forced the session to grow,
        and because <main> is overflow-y-auto, that growth scrolled the
        whole session including the sticky header out of view. max-h-full
        is the hard ceiling. */}
    <div className="flex flex-col w-full max-w-full h-full max-h-full min-h-0 bg-background overflow-hidden" data-testid="session-live-view">
      {/* Header */}
      <header className="flex-none h-16 border-b border-border/50 bg-card/50 backdrop-blur px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          {isSessionActive ? (
            <span className="relative flex-none flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
          ) : (
            <span className="flex-none inline-flex rounded-full h-2.5 w-2.5 bg-muted-foreground/40" />
          )}
          <h1
            className="font-bold font-mono tracking-tight truncate text-sm sm:text-base"
            data-testid="text-session-title"
          >
            {session.title}
          </h1>
          <Badge
            variant="outline"
            className={`flex-none font-mono text-[10px] uppercase hidden sm:flex ${
              session.mode === "insight"
                ? "text-amber-600 border-amber-500/40 bg-amber-500/5"
                : ""
            }`}
          >
            {session.mode}
          </Badge>
          <span className="flex-none text-xs text-muted-foreground font-mono tabular-nums">
            {timerFormatted}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-none">
          {/* Settings gear — ALWAYS visible (active OR idle OR ended) so
              users can adjust language / engine / diarization at any time
              and on any device. */}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-9 px-2.5 border border-border/50"
            onClick={() => setSettingsSheetOpen(true)}
            data-testid="button-session-settings"
            aria-label="Session settings"
          >
            <Settings2 className="h-4 w-4" />
            <span className="text-[10px] uppercase tracking-wider font-mono font-bold hidden sm:inline">Settings</span>
          </Button>

          {/* STT engine — desktop only; mobile users reach it via Settings. */}
          {isSessionActive && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`hidden lg:inline-flex gap-1.5 h-8 px-2 font-mono text-xs ${
                    speech.engine === "deepgram"
                      ? "text-amber-600 border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
                      : "text-muted-foreground border border-border/50 hover:bg-muted/30"
                  }`}
                  title={speech.engine === "deepgram" ? "Pro AI (Deepgram) — tap to switch" : "Browser STT — tap to switch"}
                >
                  {speech.engine === "deepgram" ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                  )}
                  <span className="uppercase tracking-wider font-semibold">
                    {speech.engine === "deepgram" ? "Pro AI" : "Browser"}
                  </span>
                  <span className="text-[9px] opacity-60">STT ▾</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="font-mono text-xs w-52">
                <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
                  Transcription Engine
                </div>
                <DropdownMenuSeparator />
                {isPro && (
                  <DropdownMenuItem
                    onClick={() => {
                      const wasListening = speech.isListening;
                      if (wasListening) speech.stop();
                      setEngineOverride("auto");
                      localStorage.setItem("fm_stt_engine", "auto");
                      if (wasListening) setTimeout(() => speech.start(), 400);
                    }}
                    className={engineOverride === "auto" ? "text-primary font-semibold" : ""}
                  >
                    <span className="flex items-center gap-2 w-full">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary flex-none" />
                      <span className="flex-1">Pro AI (Deepgram)</span>
                      {engineOverride === "auto" && <span className="text-primary">✓</span>}
                    </span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    if (!isPro) return;
                    const wasListening = speech.isListening;
                    if (wasListening) speech.stop();
                    setEngineOverride("browser");
                    localStorage.setItem("fm_stt_engine", "browser");
                    if (wasListening) setTimeout(() => speech.start(), 400);
                  }}
                  className={!isPro || engineOverride === "browser" ? (engineOverride === "browser" ? "text-primary font-semibold" : "") : ""}
                  disabled={!isPro && speech.engine === "browser"}
                >
                  <span className="flex items-center gap-2 w-full">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 flex-none" />
                    <span className="flex-1">Browser built-in</span>
                    {(!isPro || engineOverride === "browser") && <span className="text-primary">{!isPro ? "✓" : "✓"}</span>}
                  </span>
                </DropdownMenuItem>
                {!isPro && (
                  <>
                    <DropdownMenuSeparator />
                    <Link href="/pricing">
                      <DropdownMenuItem className="text-amber-600 hover:text-amber-600 cursor-pointer">
                        ✦ Upgrade to Pro for AI transcription
                      </DropdownMenuItem>
                    </Link>
                  </>
                )}
                <DropdownMenuSeparator />
                <div className="px-2 py-1 text-[10px] text-muted-foreground/50 leading-relaxed">
                  {speech.engine === "deepgram"
                    ? "Deepgram nova-3 · multilingual"
                    : "Browser speech API · system default"}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Language selector — desktop only; mobile users reach it via Settings. */}
          {isSessionActive && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="hidden lg:inline-flex gap-1.5 font-mono text-xs h-8 px-2" title="Language">
                  <Globe className="h-3.5 w-3.5" />
                  <span>{currentLang?.label ?? language}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="font-mono text-xs">
                {LANGUAGE_OPTIONS.map((l) => (
                  <DropdownMenuItem
                    key={l.code}
                    onClick={() => {
                      const wasListening = speech.isListening;
                      if (wasListening) speech.stop();
                      setLanguage(l.code);
                      localStorage.setItem("fm_stt_lang", l.code);
                      if (wasListening) setTimeout(() => speech.start(), 300);
                    }}
                    className={language === l.code ? "text-primary font-semibold" : ""}
                  >
                    {l.code === language ? "✓ " : "  "}{l.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Research button moved out of the header — now rendered next to
              the AI mode buttons in the bottom bar (both mobile + desktop). */}

          {/* Auto-research toggle removed — the server-side insight engine
              now decides on its own when to fire a lookup (agentic flow).
              The client-side toggle never worked reliably and confused users. */}

          {/* Insight toggle removed — the panel is always visible in insight
              mode (mobile = bottom dock, desktop = right column). */}
          {false && isInsightMode && (
            <Button
              size="sm"
              className="gap-2"
              data-testid="button-insight-panel"
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          )}

          <Link href={`/session/${sessionId}/notes`}>
            <Button variant="ghost" size="sm" className="gap-1.5 h-9 px-2.5 border border-border/50" data-testid="link-session-notes">
              <FileText className="h-4 w-4" />
              <span className="text-xs font-mono uppercase tracking-wider font-bold hidden sm:inline">Notes</span>
            </Button>
          </Link>

          {isSessionActive && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleEndSession}
              disabled={endSession.isPending}
              className="gap-1.5 font-mono uppercase tracking-wider text-xs h-9 px-2.5"
              data-testid="button-end-session"
            >
              {endSession.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5 fill-current" />
              )}
              <span className="hidden sm:inline">End</span>
            </Button>
          )}
        </div>
      </header>

      {/* Usage limit banner */}
      {usage && (
        <UsageLimitBanner
          used={usage.aiRequestsUsed}
          limit={usage.aiRequestsLimit}
          planName={usage.planName}
        />
      )}

      {/* Error / browser support banner */}
      {speech.error && (
        <div className="flex-none px-4 pt-3">
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{speech.error}</AlertDescription>
          </Alert>
        </div>
      )}

      {!speech.isSupported && isSessionActive && (
        <div className="flex-none px-4 pt-3">
          <Alert className="py-2 border-amber-500/40 bg-amber-500/10">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-xs text-amber-400">
              Browser transcription requires Chrome or Edge.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Main scroll area — flex-col on mobile + iPad portrait so the insight
          dock can sit below the transcript without a modal backdrop. Switches
          to flex-row only at lg+ (≥1024px) where there's enough horizontal
          room for a real side column. Wave 18 raised this from md to lg
          because iPad mini portrait at 768px gave the transcript only
          ~512-320=192px of width once sidebar + insight column took theirs.
          Wave 18c: paddingBottom reserves ~208 px on mobile for the now-
          position-fixed bottom bar (AI grid + mic + safe-area). Children
          (transcript wrapper, MobileDock) stack within main minus that
          padding, so they never get hidden by the fixed bar. */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 pb-[calc(208px+env(safe-area-inset-bottom))] lg:pb-0">
        {/* min-h-[160px] guarantees the transcript area always shows a few
            readable lines even when the insight dock + bottom bar try to
            steal more space on tiny phones. min-h-0 + max-h-full force
            flex-shrinkage when the inner ScrollArea content would otherwise
            push the wrapper past the parent — fixes the bug where a long
            transcript scrolled the entire session out of view including
            the sticky settings header. */}
        <div className="flex-1 flex overflow-hidden min-h-[160px] max-h-full relative">
          <div className="flex-1 flex flex-col overflow-hidden min-h-0 relative">
            <ScrollArea className="flex-1 min-h-0 px-4 sm:px-6 py-4">
              {/* Wave 18c: the main flex area itself reserves space for the
                  position-fixed mobile bar via paddingBottom, so the inner
                  content keeps a small pb-4 like normal scroll padding. */}
              <div className="max-w-3xl mx-auto space-y-3 pb-4 lg:pb-44">
                {transcriptsLoading && !optimistic.length ? (
                  <div className="space-y-4 pt-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className={`h-14 w-2/3 ${i % 2 === 0 ? "ml-auto" : ""}`} />
                    ))}
                  </div>
                ) : !allTranscripts.length && !speech.livePartial ? (
                  <div className="text-center py-24 flex flex-col items-center gap-4">
                    <Mic className="h-9 w-9 text-muted-foreground/30" />
                    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground/50">
                      {isSessionActive ? "Press Start Mic to begin recording" : "No transcript recorded"}
                    </p>
                    {isSessionActive && (
                      <div className="flex items-center gap-2 mt-1 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5">
                        <Globe className="h-3.5 w-3.5 text-primary" />
                        <span className="font-mono text-xs uppercase tracking-wider font-bold text-primary">
                          {currentLang?.label ?? language}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {(() => {
                      // Only show speaker labels in the live view when
                      // diarization actually produced distinct speakers.
                      // A single label of "Speaker" means diarize was off.
                      const distinct = new Set(allTranscripts.map((t) => t.speakerLabel));
                      const showSpeakers =
                        distinct.size > 1 || (distinct.size === 1 && !distinct.has("Speaker"));
                      // Stable colour per speaker so the eye can follow.
                      const speakerColors: Record<string, string> = {
                        "Speaker A": "text-primary",
                        "Speaker B": "text-amber-500",
                        "Speaker C": "text-emerald-500",
                        "Speaker D": "text-rose-500",
                        "Speaker E": "text-violet-500",
                      };
                      return allTranscripts.map((t) => (
                        <div
                          key={t.id}
                          className="flex flex-col items-start animate-in fade-in slide-in-from-bottom-1 duration-150"
                          data-testid={`transcript-entry-${t.id}`}
                        >
                          <div className="flex items-baseline gap-2 mb-1 ml-1">
                            {showSpeakers && (
                              <span
                                className={`text-[10px] font-mono font-bold uppercase tracking-wider ${
                                  speakerColors[t.speakerLabel] ?? "text-primary"
                                }`}
                              >
                                {t.speakerLabel}
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground/40 font-mono tabular-nums">
                              {formatTime(t.startMs)}
                            </span>
                            {t.isOptimistic && (
                              <span className="text-[9px] font-mono text-muted-foreground/30 uppercase tracking-wider animate-pulse">
                                saving…
                              </span>
                            )}
                          </div>
                          <div
                            className={`px-4 py-2.5 rounded-2xl rounded-tl-sm max-w-[88%] text-sm leading-relaxed border bg-muted/40 border-border/30 text-foreground ${
                              t.isOptimistic ? "opacity-75" : "opacity-100"
                            }`}
                          >
                            {t.text}
                          </div>
                        </div>
                      ));
                    })()}

                    {/* Live interim chunk */}
                    {speech.livePartial && (
                      <div className="flex flex-col items-start opacity-55">
                        <div className="flex items-baseline gap-2 mb-1 ml-1">
                          <span className="text-[10px] font-mono text-primary/50 animate-pulse">
                            ● live
                          </span>
                        </div>
                        <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm max-w-[88%] text-sm leading-relaxed bg-muted/30 border border-border/30 italic text-muted-foreground">
                          {speech.livePartial}
                          <span className="ml-1 inline-block w-0.5 h-3.5 bg-primary/70 animate-pulse rounded-sm align-middle" />
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div ref={scrollBottomRef} />
              </div>
            </ScrollArea>
          </div>

          {/* Bottom control bar — DESKTOP ONLY (lg+) here. Mobile / iPad
              portrait bar lives further down as a sibling of the insight
              dock so they don't overlap. */}
          {(isSessionActive || session.status === "idle") && (
            <>
              <div className="hidden lg:flex absolute bottom-5 left-0 right-0 flex-col items-center gap-2 px-4">
                <div className="flex items-center gap-2 bg-background/90 backdrop-blur-xl border border-border rounded-2xl px-3 py-2 shadow-lg shadow-black/5">
                  {/* Mic toggle */}
                  <Button
                    variant={speech.isListening ? "destructive" : "default"}
                    size="sm"
                    className="rounded-xl h-9 px-4 gap-2 font-mono text-xs font-bold uppercase tracking-wider"
                    onClick={async () => {
                      if (speech.isListening) { speech.stop(); return; }
                      if (speech.isConnecting) return;
                      if (session.status === "idle") {
                        try { await resumeSession.mutateAsync(); } catch { /* surface via mutation state */ }
                      }
                      speech.start();
                    }}
                    disabled={speech.isConnecting || resumeSession.isPending}
                  >
                    {speech.isListening ? (
                      <><MicOff className="h-3.5 w-3.5" />Stop</>
                    ) : speech.isConnecting ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" />Connecting…</>
                    ) : (
                      <><Mic className="h-3.5 w-3.5" />Start Mic</>
                    )}
                  </Button>

                  {speech.isListening && <MicVisualizer isListening />}

                  <div className="h-5 w-px bg-border mx-1" />

                  <div className="flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-primary/50 flex-none" />
                    {AI_MODES.map(({ mode, label, icon: Icon }) => (
                      <Button
                        key={mode}
                        variant="ghost"
                        size="sm"
                        className="rounded-xl h-8 px-3 text-xs gap-1.5 hover:bg-primary/10 hover:text-primary"
                        onClick={() => handleAiAssist(mode)}
                        disabled={requestAi.isPending}
                      >
                        <Icon className="h-3 w-3" />
                        <span>{label}</span>
                      </Button>
                    ))}
                    {requestAi.isPending && (
                      <Loader2 className="h-4 w-4 animate-spin text-primary ml-1" />
                    )}
                  </div>

                  {/* Research lives next to the AI modes now (same row). */}
                  {researchAvailable && (
                    <>
                      <div className="h-5 w-px bg-border mx-1" />
                      {canResearch ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`rounded-xl h-8 px-3 text-xs gap-1.5 ${
                            researchPanelOpen
                              ? "text-amber-700 bg-amber-500/10"
                              : "text-amber-600 hover:text-amber-600 hover:bg-amber-500/10 border border-amber-500/30"
                          }`}
                          onClick={() => setResearchPanelOpen((v) => !v)}
                          data-testid="button-research-panel"
                        >
                          <Search className="h-3 w-3" />
                          <span>Research</span>
                        </Button>
                      ) : (
                        <Link href="/pricing">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="rounded-xl h-8 px-3 text-xs gap-1.5 text-amber-600/60 border border-amber-500/20"
                          >
                            <Lock className="h-3 w-3" />
                            <span>Research</span>
                            <span className="text-[9px] font-mono bg-amber-500/15 text-amber-600 px-1 py-0.5 rounded">Pro</span>
                          </Button>
                        </Link>
                      )}
                    </>
                  )}
                </div>

                {allTranscripts.length > 0 && (
                  <span className="text-[10px] font-mono text-muted-foreground/40 tracking-wider uppercase">
                    {allTranscripts.length} entr{allTranscripts.length === 1 ? "y" : "ies"} · {currentLang?.label}
                  </span>
                )}
              </div>
            </>
          )}

          {/* Ended state — only show on truly ended sessions (idle sessions
              now keep the bottom bar so users can resume). Desktop floats
              it; mobile renders it as a normal flex item so the insight
              dock can't sit on top of it. */}
          {session.status === "ended" && (dbTranscripts?.length ?? 0) > 0 && (
            <>
              {/* Desktop floating CTA (lg+) */}
              <div className="hidden lg:flex absolute bottom-6 left-0 right-0 justify-center px-4">
                <Link href={`/session/${sessionId}/notes`}>
                  <Button className="gap-2 font-mono text-xs uppercase tracking-wider rounded-full shadow-xl">
                    <FileText className="h-4 w-4" />
                    View Meeting Notes
                  </Button>
                </Link>
              </div>
              {/* Mobile / iPad portrait in-flow CTA — lives at the bottom of
                  the transcript column, ABOVE the insight dock if present. */}
              <div className="lg:hidden flex-none px-4 py-3 border-t border-border/40 bg-card/40">
                <Link href={`/session/${sessionId}/notes`}>
                  <Button className="w-full gap-2 font-mono text-sm uppercase tracking-wider rounded-xl h-12">
                    <FileText className="h-4 w-4" />
                    View Meeting Notes
                  </Button>
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Desktop (lg+) insight side column. Below lg the unified MobileDock
            handles insights so the iPad-portrait viewport doesn't get
            squeezed to a sliver. */}
        {isInsightMode && (
          <div className="hidden lg:flex flex-col w-80 xl:w-96 border-l border-border/40 bg-card/50 backdrop-blur overflow-y-auto p-4 shrink-0">
            <InsightStream sessionId={sessionId} />
          </div>
        )}

        {/* ── Mobile dock — unified Insights / Research with a tab switch ──
            One panel at a time (max ~30vh) so the transcript stays usable.
            Shows when at least one of (insight mode, research panel open)
            is active. */}
        {(isInsightMode || researchPanelOpen) && (
          <MobileDock
            sessionId={sessionId}
            showInsights={isInsightMode}
            showResearch={researchPanelOpen}
            researchAvailable={researchAvailable}
            canResearch={canResearch}
            researchUsed={researchUsed}
            researchLimit={researchLimit}
            researchResults={researchResults}
            onCloseResearch={() => setResearchPanelOpen(false)}
          />
        )}

        {/* ─── MOBILE + iPad-portrait bottom bar ────────────────────────────
             Wave 18c used `position: fixed bottom-0` so the bar glues to
             the visible viewport bottom irrespective of iOS svh/dvh quirks.
             Wave 19: rendered through a PORTAL into document.body. The app
             router wraps every page in a framer-motion div with
             `willChange: transform`, which makes that div the containing
             block for position:fixed — the bar was anchoring to the
             motion-div's bottom edge (~130 px BELOW the real viewport) and
             also stretched <main>'s scrollHeight, which let the whole
             session scroll away under the top bar. Portaling out of the
             transformed ancestor restores true viewport anchoring. */}
        {(isSessionActive || session.status === "idle") && createPortal(
          <div
            className="lg:hidden fixed bottom-0 left-0 right-0 z-30 px-3 pt-2 pb-3 border-t border-border/40 bg-background/95 backdrop-blur"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
          >
            <div className="flex flex-col gap-2 max-w-md mx-auto">
              {/* AI mode grid — 4 modes + Research as the 5th cell (when
                  research is available) so it sits with the other on-demand
                  AI actions instead of being buried in Settings. */}
              <div className={`grid ${researchAvailable ? "grid-cols-5" : "grid-cols-4"} gap-1.5 bg-card/90 backdrop-blur-xl border border-border rounded-2xl p-2 shadow-sm`}>
                {AI_MODES.map(({ mode, label, icon: Icon }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleAiAssist(mode)}
                    disabled={requestAi.isPending}
                    className="flex flex-col items-center gap-1 py-2 rounded-xl hover:bg-primary/10 active:bg-primary/15 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    data-testid={`button-ai-${mode}`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">
                      {label}
                    </span>
                  </button>
                ))}
                {researchAvailable && (
                  canResearch ? (
                    <button
                      type="button"
                      onClick={() => setResearchPanelOpen((v) => !v)}
                      className={`flex flex-col items-center gap-1 py-2 rounded-xl transition-colors ${
                        researchPanelOpen
                          ? "bg-amber-500/15 text-amber-600"
                          : "text-amber-600 hover:bg-amber-500/10 active:bg-amber-500/15 border border-amber-500/30"
                      }`}
                      data-testid="button-research-panel"
                    >
                      <Search className="h-5 w-5" />
                      <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">
                        Research
                      </span>
                    </button>
                  ) : (
                    <Link href="/pricing">
                      <button
                        type="button"
                        className="w-full flex flex-col items-center gap-1 py-2 rounded-xl text-amber-600/70 border border-amber-500/20 hover:bg-amber-500/5"
                      >
                        <Lock className="h-5 w-5" />
                        <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">
                          Research
                        </span>
                      </button>
                    </Link>
                  )
                )}
              </div>

              {/* Big mic + visualizer */}
              <div className="flex items-center gap-3 bg-card/90 backdrop-blur-xl border border-border rounded-2xl px-3 py-2 shadow-sm">
                <Button
                  variant={speech.isListening ? "destructive" : "default"}
                  className="flex-1 h-14 rounded-xl gap-2 font-mono text-base font-bold uppercase tracking-wider"
                  onClick={async () => {
                    if (speech.isListening) { speech.stop(); return; }
                    if (speech.isConnecting) return;
                    if (session.status === "idle") {
                      try { await resumeSession.mutateAsync(); } catch { /* state surfaced by mutation */ }
                    }
                    speech.start();
                  }}
                  disabled={speech.isConnecting || resumeSession.isPending}
                  data-testid="button-mic-toggle"
                >
                  {speech.isListening ? (
                    <><MicOff className="h-5 w-5" />Stop</>
                  ) : speech.isConnecting ? (
                    <><Loader2 className="h-5 w-5 animate-spin" />Connecting…</>
                  ) : (
                    <><Mic className="h-5 w-5" />Start Mic</>
                  )}
                </Button>
                {speech.isListening && (
                  <div className="flex-none">
                    <MicVisualizer isListening />
                  </div>
                )}
                {requestAi.isPending && (
                  <Loader2 className="h-5 w-5 animate-spin text-primary flex-none" />
                )}
              </div>

              {/* Status hint */}
              {allTranscripts.length > 0 && (
                <div className="text-center text-[10px] font-mono text-muted-foreground/50 tracking-wider uppercase">
                  {allTranscripts.length} entr{allTranscripts.length === 1 ? "y" : "ies"} · {currentLang?.label}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

        {/* Research panel — copilot mode: desktop (lg+) Sheet slide-over.
            Mobile / iPad-portrait users get the unified MobileDock above
            instead, which avoids the dark Sheet backdrop on small screens. */}
        {researchPanelOpen && !isInsightMode && (
          <div className="hidden lg:contents">
            <Sheet open={researchPanelOpen} onOpenChange={setResearchPanelOpen}>
              <SheetContent
                side="right"
                className="w-[360px] sm:w-[420px] p-0 border-l border-primary/20 bg-card/95 backdrop-blur-xl"
              >
                <SheetTitle className="sr-only">Research Panel</SheetTitle>
                <ResearchPanel
                  sessionId={sessionId}
                  canResearch={canResearch}
                  researchAvailable={researchAvailable}
                  researchUsed={researchUsed}
                  researchLimit={researchLimit}
                  mode="copilot"
                  initialResults={researchResults}
                  onClose={() => setResearchPanelOpen(false)}
                />
              </SheetContent>
            </Sheet>
          </div>
        )}

        {researchPanelOpen && isInsightMode && (
          <div className="hidden lg:flex flex-col w-80 border-l border-border/40 bg-card/50 backdrop-blur shrink-0">
            <ResearchPanel
              sessionId={sessionId}
              canResearch={canResearch}
              researchAvailable={researchAvailable}
              researchUsed={researchUsed}
              researchLimit={researchLimit}
              mode="insight"
              initialResults={researchResults}
              onClose={() => setResearchPanelOpen(false)}
              inline
            />
          </div>
        )}
      </div>

      {/* Resume modal */}
      <Dialog open={resumeModalOpen} onOpenChange={setResumeModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Session paused</DialogTitle>
            <DialogDescription>
              This session went idle. Resume it to continue transcribing and recording insights.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setResumeModalOpen(false)}>
              Keep paused
            </Button>
            <Button
              onClick={() => resumeSession.mutate()}
              disabled={resumeSession.isPending}
              className="gap-2"
            >
              {resumeSession.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Resume session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Mobile session settings sheet ──────────────────────────────────
          Bundles every per-session preference so the mobile header can stay
          minimal. Desktop users have the same controls inline in the header. */}
      <Sheet open={settingsSheetOpen} onOpenChange={setSettingsSheetOpen}>
        <SheetContent
          side="right"
          className="w-[88vw] max-w-sm p-0 border-l border-border/40 bg-card/95 backdrop-blur-xl flex flex-col"
        >
          <SheetTitle className="sr-only">Session settings</SheetTitle>
          <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            <span className="font-mono font-bold uppercase tracking-widest text-sm">Settings</span>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* ── Language ─────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center gap-2 mb-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <Globe className="h-3.5 w-3.5" />
                Language
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {LANGUAGE_OPTIONS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => {
                      const wasListening = speech.isListening;
                      if (wasListening) speech.stop();
                      setLanguage(l.code);
                      localStorage.setItem("fm_stt_lang", l.code);
                      if (wasListening) setTimeout(() => speech.start(), 300);
                    }}
                    className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-sm font-mono ${
                      language === l.code
                        ? "border-primary/40 bg-primary/10 text-primary font-semibold"
                        : "border-border/50 hover:bg-muted/40"
                    }`}
                  >
                    <span>{l.label}</span>
                    {language === l.code && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Transcription engine ─────────────────────────────────── */}
            <div>
              <div className="flex items-center gap-2 mb-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <Mic className="h-3.5 w-3.5" />
                Transcription engine
              </div>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (!isPro) return;
                    const wasListening = speech.isListening;
                    if (wasListening) speech.stop();
                    setEngineOverride("auto");
                    localStorage.setItem("fm_stt_engine", "auto");
                    if (wasListening) setTimeout(() => speech.start(), 400);
                  }}
                  disabled={!isPro}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-sm ${
                    engineOverride === "auto" && isPro
                      ? "border-amber-500/40 bg-amber-500/5 text-amber-600 font-semibold"
                      : "border-border/50 hover:bg-muted/40 disabled:opacity-50"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-amber-500 flex-none" />
                  <span className="flex-1 text-left">
                    <span className="block font-mono uppercase tracking-wider text-xs">Pro AI · Deepgram</span>
                    <span className="block text-[11px] text-muted-foreground font-normal">nova-3 · multilingual</span>
                  </span>
                  {!isPro && (
                    <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30 bg-amber-500/5 gap-1">
                      <Lock className="h-2.5 w-2.5" />Pro
                    </Badge>
                  )}
                  {engineOverride === "auto" && isPro && <Check className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const wasListening = speech.isListening;
                    if (wasListening) speech.stop();
                    setEngineOverride("browser");
                    localStorage.setItem("fm_stt_engine", "browser");
                    if (wasListening) setTimeout(() => speech.start(), 400);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-sm ${
                    engineOverride === "browser" || !isPro
                      ? "border-primary/30 bg-primary/5 text-primary font-semibold"
                      : "border-border/50 hover:bg-muted/40"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/60 flex-none" />
                  <span className="flex-1 text-left">
                    <span className="block font-mono uppercase tracking-wider text-xs">Browser STT</span>
                    <span className="block text-[11px] text-muted-foreground font-normal">free · in-browser</span>
                  </span>
                  {(engineOverride === "browser" || !isPro) && <Check className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* ── Speaker diarization (placeholder until Wave 4-B wires the
                  server side; the toggle persists but won't take effect yet) */}
            <div>
              <div className="flex items-center gap-2 mb-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                Speaker detection
              </div>
              <button
                type="button"
                onClick={() => toggleDiarize(!diarize)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-3 rounded-xl border text-sm ${
                  diarize ? "border-primary/30 bg-primary/5 text-primary" : "border-border/50 hover:bg-muted/40"
                }`}
              >
                <span className="flex-1 text-left">
                  <span className="block font-mono uppercase tracking-wider text-xs">Distinguish speakers</span>
                  <span className="block text-[11px] text-muted-foreground font-normal">
                    {diarize ? "Speaker A / B / C will be shown" : "All speech grouped together"}
                  </span>
                </span>
                {diarize ? <ToggleRight className="h-6 w-6 text-primary" /> : <ToggleLeft className="h-6 w-6 text-muted-foreground" />}
              </button>
            </div>

            {/* Research lives in the bottom AI bar now, not here. */}

          </div>
        </SheetContent>
      </Sheet>

      {/* AI Response panel — Wave 18: w-[92vw] floor so even 320px phones
          show the full content area without horizontal cut-off; capped at
          the sm:480px breakpoint so it doesn't take more than ~half a tablet. */}
      <Sheet open={aiPanelOpen} onOpenChange={setAiPanelOpen}>
        <SheetContent
          side="right"
          className="w-[92vw] sm:w-[460px] max-w-md border-l border-primary/20 bg-card/95 backdrop-blur-xl flex flex-col p-0"
        >
          <SheetHeader className="p-6 border-b border-border/50">
            <SheetTitle className="sr-only">AI Copilot</SheetTitle>
            <div className="flex items-center gap-3">
              <Zap className="h-4 w-4 text-primary" />
              <span className="font-mono font-bold uppercase tracking-widest text-sm">AI Copilot</span>
              {aiResponse && (
                <Badge variant="outline" className="ml-auto font-mono text-[10px] uppercase border-primary/40 text-primary">
                  {aiResponse.mode.replace("_", " ")}
                </Badge>
              )}
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-auto p-6">
            {aiLimitExceeded ? (
              <div className="flex flex-col items-center justify-center h-48 gap-5 text-center">
                <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <Zap className="h-6 w-6 text-destructive" />
                </div>
                <div className="space-y-1.5">
                  <p className="font-bold text-sm">AI request limit reached</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    You've used all your AI requests this month on the{" "}
                    <span className="capitalize">{usage?.planName ?? "free"}</span> plan.
                  </p>
                </div>
                <Button
                  className="gap-2 font-mono uppercase tracking-wider text-xs w-full"
                  onClick={() => setAiPanelOpen(false)}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Upgrade to Pro — Unlimited Requests
                </Button>
                <p className="text-[10px] text-muted-foreground/50">
                  Resets at the end of your billing period.
                </p>
              </div>
            ) : !aiResponse ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-xs font-mono uppercase tracking-wider">Analysing context…</span>
              </div>
            ) : (
              <div className="space-y-6">
                <p className="text-base leading-relaxed font-medium">{aiResponse.suggestion}</p>

                {aiResponse.reasoning && (
                  <div className="p-4 rounded-lg bg-muted/40 border border-border/40">
                    <h4 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                      Reasoning
                    </h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">{aiResponse.reasoning}</p>
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full font-mono text-xs uppercase tracking-wider gap-2"
                  onClick={() => {
                    if (aiResponse) {
                      handleAiAssist(aiResponse.mode as "objection" | "answer" | "explain" | "logic_check");
                    }
                  }}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
    </TooltipProvider>
  );
}

// ─── Mobile dock ────────────────────────────────────────────────────────────
// Tabbed bottom panel that hosts Insights and Research on phone screens.
// Only one is visible at a time (max ~30 vh) so the transcript stays usable.
// When both are active (insight mode + research panel open) a tab bar lets
// the user flip without losing state.
interface MobileDockProps {
  sessionId: number;
  showInsights: boolean;
  showResearch: boolean;
  researchAvailable: boolean;
  canResearch: boolean;
  researchUsed: number;
  researchLimit: number;
  researchResults: ResearchResultData[];
  onCloseResearch: () => void;
}

function MobileDock({
  sessionId,
  showInsights,
  showResearch,
  researchAvailable,
  canResearch,
  researchUsed,
  researchLimit,
  researchResults,
  onCloseResearch,
}: MobileDockProps) {
  // Default to whichever was opened most recently — research wins when the
  // user just toggled it on, insights are the steady-state for insight mode.
  const [activeTab, setActiveTab] = useState<"insights" | "research">(
    showResearch ? "research" : "insights",
  );
  useEffect(() => {
    if (showResearch && !showInsights) setActiveTab("research");
    if (showInsights && !showResearch) setActiveTab("insights");
    if (showResearch) setActiveTab("research"); // research just opened → switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResearch]);

  // Wave 18: per-user persistent collapse state. When collapsed the dock
  // shrinks to just its header (44 px) so the transcript reclaims the rest
  // of the screen — critical on iPhone SE-class devices where the default
  // dock height eats most of the viewport.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("fm_dock_collapsed") === "1";
  });
  useEffect(() => {
    try { localStorage.setItem("fm_dock_collapsed", collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  const showTabs = showInsights && showResearch;
  const current: "insights" | "research" = showTabs ? activeTab : (showInsights ? "insights" : "research");

  // Adaptive height: 150 px floor for small phones, ~30 vh middle, 280 px
  // cap so big phones / iPads in portrait don't waste screen real estate.
  // On lg+ this component is hidden — desktop has its own side column.
  const dockHeight = collapsed ? "44px" : "clamp(150px, 30vh, 280px)";

  return (
    <div
      className="lg:hidden flex-none border-t border-border/40 bg-card/60 backdrop-blur flex flex-col transition-[height] duration-200"
      style={{ height: dockHeight }}
    >
      {/* Tab strip — only when BOTH panels are active. Otherwise the header
          just shows the current panel name + close. */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/40 flex-none">
        <div className="flex items-center gap-1 min-w-0">
          {/* Collapse / expand toggle — always available so the user can
              reclaim space at any time. */}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/40"
            aria-label={collapsed ? "Expand panel" : "Collapse panel"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {/* Inline chevron — flips with state */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-3.5 w-3.5 transition-transform ${collapsed ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showTabs ? (
            <>
              <button
                type="button"
                onClick={() => { setActiveTab("insights"); if (collapsed) setCollapsed(false); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono uppercase tracking-wider font-semibold ${
                  current === "insights" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                Insights
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab("research"); if (collapsed) setCollapsed(false); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono uppercase tracking-wider font-semibold ${
                  current === "research" ? "bg-amber-500/15 text-amber-600" : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                Research
              </button>
            </>
          ) : (
            <span className="px-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-semibold truncate">
              {current === "insights" ? "Live Insights" : "Research"}
            </span>
          )}
        </div>
        {showResearch && (
          <button
            type="button"
            onClick={onCloseResearch}
            className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground flex-none"
          >
            close
          </button>
        )}
      </div>

      {/* Body — hidden when collapsed so the dock genuinely shrinks. */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {current === "insights" ? (
            <InsightStream sessionId={sessionId} />
          ) : (
            <ResearchPanel
              sessionId={sessionId}
              canResearch={canResearch}
              researchAvailable={researchAvailable}
              researchUsed={researchUsed}
              researchLimit={researchLimit}
              mode="copilot"
              initialResults={researchResults}
              inline
            />
          )}
        </div>
      )}
    </div>
  );
}
