import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useLocation } from "wouter";
import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import {
  Mic, Sparkles, ArrowRight, Clock, Play, Compass,
  ChevronRight, BarChart3, Lightbulb, TrendingUp, AlertTriangle,
  HelpCircle, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/lib/auth";
import { apiFetch } from "@/lib/auth";
import { useAppTour } from "@/components/app-tour";
import { formatDistanceToNow } from "date-fns";

interface RecentSession {
  id: number;
  title: string;
  status: string;
  mode: string | null;
  durationSeconds: number;
  transcriptCount: number;
  lastLine: string | null;
  createdAt: string;
}

// ── Animated live session demo ─────────────────────────────────────────────

const DEMO_LINES = [
  "I'm concerned about the pricing and the timeline for Q4.",
  "We're comparing you against two other vendors right now.",
  "The budget decision is with our CFO — she's the final sign-off.",
  "Can you give us a concrete ROI number we can take to the board?",
  "What does implementation typically look like in the first 30 days?",
  "We'd need this fully live before the end of the fiscal year.",
];

const DEMO_INSIGHTS = [
  {
    icon: TrendingUp,
    label: "Opportunity",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/25",
    text: "Pivot to ROI — anchor value before addressing the price concern.",
  },
  {
    icon: AlertTriangle,
    label: "Risk",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/25",
    text: "CFO is the real DM — current contact may lack authority to close.",
  },
  {
    icon: HelpCircle,
    label: "Question",
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/25",
    text: "Which vendors are they comparing against? Ask directly.",
  },
];

const DEMO_RESEARCH_STATES = [
  { phase: "loading", text: "Searching the web for Q4 SaaS ROI benchmarks…" },
  {
    phase: "done",
    answer: "SaaS platforms typically deliver 287% ROI over 3 years, with payback periods under 14 months (Forrester, 2024).",
    sources: [
      { title: "Forrester Total Economic Impact Study", domain: "forrester.com" },
      { title: "SaaS ROI Benchmarks 2024", domain: "gartner.com" },
      { title: "B2B Software Value Analysis", domain: "g2.com" },
    ],
  },
];

const LOOP_MS = 18_000;

function LiveSessionDemo({ reduced }: { reduced: boolean }) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [visibleInsights, setVisibleInsights] = useState(0);
  const [researchPhase, setResearchPhase] = useState<"idle" | "loading" | "done">("idle");
  const [liveText, setLiveText] = useState("So the key concern here is…");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = (fn: () => void, ms: number) => {
    timerRef.current = setTimeout(fn, ms);
  };

  useEffect(() => {
    if (reduced) {
      setVisibleLines(DEMO_LINES.length);
      setVisibleInsights(DEMO_INSIGHTS.length);
      setResearchPhase("done");
      return;
    }

    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      setVisibleLines(0);
      setVisibleInsights(0);
      setResearchPhase("idle");
      setLiveText("So the key concern here is…");

      // Animate transcript lines in one by one
      DEMO_LINES.forEach((_, i) => {
        schedule(() => {
          if (!cancelled) setVisibleLines(i + 1);
        }, 600 + i * 1_100);
      });

      // Insight cards stagger in after some lines
      DEMO_INSIGHTS.forEach((_, i) => {
        schedule(() => {
          if (!cancelled) setVisibleInsights(i + 1);
        }, 4_000 + i * 1_200);
      });

      // Research shimmer then resolved
      schedule(() => { if (!cancelled) setResearchPhase("loading"); }, 8_500);
      schedule(() => { if (!cancelled) setResearchPhase("done"); }, 10_200);

      // Live interim text cycling
      const liveLines = [
        "So the key concern here is…",
        "We need to validate the ROI before…",
        "Timeline is critical for Q4 so…",
      ];
      liveLines.forEach((t, i) => {
        schedule(() => { if (!cancelled) setLiveText(t); }, 3_500 + i * 2_800);
      });

      // Loop
      schedule(() => { if (!cancelled) run(); }, LOOP_MS);
    };

    run();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <div className="w-full max-w-5xl mx-auto rounded-2xl border border-border/50 bg-card/80 backdrop-blur shadow-2xl overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border/40 bg-muted/30">
        <span className="relative flex h-2 w-2">
          <span className={`${reduced ? "" : "animate-ping"} absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75`} />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground font-semibold">
          Live Session
        </span>
        <div className="ml-auto flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-border" />
          <div className="h-2.5 w-2.5 rounded-full bg-border" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border/30">
        {/* LEFT — transcript stream */}
        <div className="p-5 space-y-2.5 min-h-[320px]">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-3">Transcript</p>
          {DEMO_LINES.slice(0, visibleLines).map((line, i) => (
            <motion.div
              key={i}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="px-3.5 py-2 rounded-2xl rounded-tl-sm bg-muted/40 border border-border/30 text-sm leading-relaxed text-foreground/90 max-w-[92%]"
            >
              {line}
            </motion.div>
          ))}
          {/* Live interim */}
          {visibleLines >= 2 && (
            <div className="flex flex-col items-start opacity-50">
              <span className="text-[9px] font-mono text-primary/60 animate-pulse mb-1 ml-1">● live</span>
              <div className="px-3.5 py-2 rounded-2xl rounded-tl-sm bg-muted/30 border border-border/30 text-sm italic text-muted-foreground max-w-[92%]">
                {liveText}
                <span className="ml-1 inline-block w-0.5 h-3.5 bg-primary/70 animate-pulse rounded-sm align-middle" />
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — insights + research */}
        <div className="p-5 space-y-3 min-h-[320px]">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-3">AI Insights</p>

          {DEMO_INSIGHTS.slice(0, visibleInsights).map((ins, i) => (
            <motion.div
              key={i}
              initial={reduced ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35 }}
              className={`flex items-start gap-2.5 p-3 rounded-xl border ${ins.bg}`}
            >
              <ins.icon className={`h-3.5 w-3.5 mt-0.5 flex-none ${ins.color}`} />
              <div>
                <span className={`text-[10px] font-bold uppercase tracking-wide ${ins.color}`}>{ins.label}</span>
                <p className="text-xs text-foreground/85 mt-0.5 leading-relaxed">{ins.text}</p>
              </div>
            </motion.div>
          ))}

          {/* Research card */}
          <AnimatePresence>
            {researchPhase !== "idle" && (
              <motion.div
                initial={reduced ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
                className="rounded-xl border border-border/50 bg-card/60 overflow-hidden"
              >
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/30">
                  <Search className={`h-3 w-3 text-primary ${researchPhase === "loading" ? "animate-pulse" : ""}`} />
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {researchPhase === "loading"
                      ? DEMO_RESEARCH_STATES[0].text
                      : "Q4 SaaS ROI benchmarks"}
                  </span>
                </div>
                {researchPhase === "loading" ? (
                  <div className="p-3 space-y-2">
                    <div className="h-2.5 bg-muted animate-pulse rounded w-full" />
                    <div className="h-2.5 bg-muted animate-pulse rounded w-4/5" />
                    <div className="h-2.5 bg-muted animate-pulse rounded w-3/5" />
                  </div>
                ) : (
                  <div className="p-3">
                    <p className="text-xs leading-relaxed text-foreground/90 mb-2">
                      {DEMO_RESEARCH_STATES[1].answer}
                    </p>
                    <div className="space-y-1">
                      {DEMO_RESEARCH_STATES[1].sources?.map((src, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border/30 bg-background/50 cursor-default"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/60 flex-none" />
                          <span className="text-[10px] text-foreground/80 truncate flex-1">{src.title}</span>
                          <span className="text-[9px] text-muted-foreground/60 font-mono flex-none">{src.domain}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function WelcomePage() {
  const { user } = useAuthStore();
  const [, setLocation] = useLocation();
  const { startTour } = useAppTour();
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const prefersReduced = useReducedMotion() ?? false;

  const firstName = user?.displayName?.split(" ")[0] ?? user?.username ?? "there";
  const isFirstTime = !localStorage.getItem("fm_tour_done");

  useEffect(() => {
    apiFetch("/api/sessions/recent")
      .then((r) => r.json())
      .then((data) => setRecentSessions(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isFirstTime && !loading) {
      const t = setTimeout(() => startTour(), 900);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isFirstTime, loading, startTour]);

  const lastSession = recentSessions[0];
  const hasHistory = recentSessions.length > 0;

  function formatDuration(secs: number) {
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m`;
  }

  return (
    <div className="relative">
      {/* Ambient background — pointer-events-none to never block clicks */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-primary/4 rounded-full blur-[80px]" />
      </div>

      <div className="relative z-10 p-6 md:p-8 lg:p-10 max-w-5xl mx-auto space-y-14">

        {/* ── HERO ───────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="space-y-6 max-w-3xl"
        >
          {!hasHistory && (
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-sm font-medium">
              <Sparkles className="h-4 w-4" aria-hidden />
              You're set up — let's go
            </div>
          )}

          <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-none">
            {hasHistory ? (
              <>Welcome back, <span className="text-primary">{firstName}</span></>
            ) : (
              <>Hey <span className="text-primary">{firstName}</span>,{" "}
                <span className="block">welcome to FlowMind</span>
              </>
            )}
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed">
            {hasHistory
              ? "Ready for your next session?"
              : "Your AI conversation copilot. Listen to any meeting or call and get real-time strategic help."}
          </p>

          {/* CTAs — pointer-events-auto + z-10 to sit on top of everything */}
          <div
            className="relative z-10 flex flex-col sm:flex-row gap-3 pointer-events-auto"
            data-tour="new-session"
          >
            <Link href="/session/new">
              <Button
                size="lg"
                className="gap-2 h-12 px-7 rounded-xl font-semibold shadow-lg shadow-primary/20 pointer-events-auto"
              >
                <Mic className="h-5 w-5" aria-hidden />
                New Session
                <ArrowRight className="h-4 w-4 ml-1" aria-hidden />
              </Button>
            </Link>
            {!hasHistory && (
              <Button
                variant="ghost"
                size="lg"
                className="gap-2 h-12 px-7 rounded-xl pointer-events-auto"
                onClick={() => {
                  try { localStorage.setItem("fm_tour_done", ""); } catch {}
                  startTour();
                }}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Take the 60-second tour
              </Button>
            )}
            {hasHistory && (
              <Link href="/history">
                <Button variant="outline" size="lg" className="gap-2 h-12 px-6 rounded-xl pointer-events-auto">
                  <BarChart3 className="h-4 w-4" aria-hidden />
                  View History
                </Button>
              </Link>
            )}
          </div>
        </motion.div>

        {/* ── LAST SESSION (returning users) ─────────────────────────────── */}
        {lastSession && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-3">
              Last session
            </h2>
            <Card className="border-border/40 bg-card/60 backdrop-blur hover:border-primary/30 transition-colors max-w-2xl">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-semibold text-base truncate">{lastSession.title}</span>
                      {lastSession.mode && (
                        <Badge variant="secondary" className="shrink-0 text-xs capitalize">
                          {lastSession.mode}
                        </Badge>
                      )}
                      {lastSession.status === "active" && (
                        <Badge className="shrink-0 bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20 text-xs">
                          Live
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(lastSession.createdAt), { addSuffix: true })}
                      </span>
                      <span>{formatDuration(lastSession.durationSeconds)}</span>
                      <span>{lastSession.transcriptCount} lines</span>
                    </div>
                    {lastSession.lastLine && (
                      <p className="text-sm text-muted-foreground mt-2 truncate italic">
                        "{lastSession.lastLine}"
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {lastSession.status === "active" || lastSession.status === "idle" ? (
                      <Link href={`/session/${lastSession.id}`}>
                        <Button size="sm" className="gap-1.5 rounded-lg">
                          <Play className="h-3.5 w-3.5" />
                          Resume
                        </Button>
                      </Link>
                    ) : (
                      <Link href={`/session/${lastSession.id}/notes`}>
                        <Button variant="outline" size="sm" className="gap-1.5 rounded-lg">
                          <ChevronRight className="h-3.5 w-3.5" />
                          Notes
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ── MODE CARDS ─────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
            {[
              {
                icon: Mic,
                title: "Live Copilot",
                desc: "Real-time transcription with instant AI responses for objections, answers, and logic checks.",
              },
              {
                icon: Compass,
                title: "Insight Mode",
                desc: "AI surfaces live strategic insights — opportunities, risks, connections, questions — as you talk.",
                pro: true,
              },
            ].map((f) => (
              <Card key={f.title} className="border-border/40 bg-muted/30 hover:border-primary/20 transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 p-2 rounded-lg text-primary shrink-0">
                      <f.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{f.title}</span>
                        {f.pro && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/30">
                            Pro
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <button
            onClick={startTour}
            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 pointer-events-auto"
            data-tour="replay-tour"
          >
            <Sparkles className="h-3 w-3" aria-hidden />
            Replay product tour
          </button>
        </motion.div>

        {/* ── ANIMATED LIVE SESSION DEMO ──────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">
              See it in action
            </h2>
            <div className="flex-1 h-px bg-border/40" />
          </div>
          {/* pointer-events-none on the demo so it never blocks the CTAs above it */}
          <div className="pointer-events-none" aria-hidden>
            <LiveSessionDemo reduced={prefersReduced} />
          </div>
        </motion.div>

      </div>
    </div>
  );
}
