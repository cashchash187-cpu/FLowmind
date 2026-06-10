import { useGetSessionStats, useGetRecentSessions } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Activity, Clock, FileText, Play, Zap, ArrowRight, Mic, TrendingUp, BellRing, BrainCircuit } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/auth";

interface DashReminder { id: number; label: string; dueAt: string; done: boolean }

function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (to === 0) { setDisplay(0); return; }
    const controls = animate(0, to, {
      duration: 1.2,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return controls.stop;
  }, [to]);

  return (
    <span>
      {display}
      {suffix && <span className="text-2xl text-muted-foreground ml-1 font-mono">{suffix}</span>}
    </span>
  );
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 }
  }
};

const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 280, damping: 22 } }
};

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetSessionStats();
  const { data: recentSessions, isLoading: recentLoading } = useGetRecentSessions();
  const queryClient = useQueryClient();

  const { data: reminders = [] } = useQuery<DashReminder[]>({
    queryKey: ["dashboard-reminders"],
    queryFn: async () => {
      const res = await apiFetch("/api/reminders");
      return res.ok ? res.json() : [];
    },
    refetchInterval: 60_000,
  });
  const doneReminder = useMutation({
    mutationFn: async (id: number) => { await apiFetch(`/api/reminders/${id}`, { method: "PATCH", body: JSON.stringify({ done: true }) }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard-reminders"] }),
  });
  // Show only what's due within the next 14 days (or overdue) — keeps the
  // dashboard focused on what needs attention now.
  const soonReminders = reminders
    .filter((r) => !r.done && new Date(r.dueAt).getTime() < Date.now() + 14 * 86400_000)
    .slice(0, 5);

  return (
    <div className="relative overflow-hidden">
      {/* ── Ambient background orbs ─────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-24 -right-24 w-[500px] h-[500px] bg-primary/8 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 -left-32 w-[350px] h-[350px] bg-primary/5 rounded-full blur-[80px]" />
      </div>

      <div className="relative z-10 p-6 md:p-8 lg:p-10 max-w-6xl mx-auto space-y-10">

        {/* ── Hero header ─────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-6"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-6 rounded-full bg-primary" />
              <span className="text-[11px] font-mono uppercase tracking-widest font-bold text-primary">
                Mission Control
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground leading-tight">
              Command Overview
            </h1>
            <p className="text-base text-muted-foreground max-w-md leading-relaxed">
              Your high-stakes conversations, AI intelligence, and session analytics.
            </p>
          </div>
          <Link href="/session/new" data-testid="link-start-session">
            <motion.div whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }}>
              <Button
                size="lg"
                className="h-12 px-7 gap-2.5 shadow-xl shadow-primary/25 rounded-xl font-semibold tracking-wide border border-primary/20 relative overflow-hidden group"
                data-testid="button-start-new-session"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-primary/0 via-white/10 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                <Play className="h-4 w-4 fill-current relative z-10" />
                <span className="relative z-10">Start New Session</span>
              </Button>
            </motion.div>
          </Link>
        </motion.div>

        {/* ── Stat cards ─────────────────────────────────────────────────── */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid gap-4 grid-cols-2 lg:grid-cols-4"
        >
          {[
            { title: "Total Sessions", value: stats?.totalSessions, icon: Activity, loading: statsLoading, suffix: "", color: "text-primary" },
            { title: "Active Now", value: stats?.activeSessions, icon: TrendingUp, loading: statsLoading, suffix: "", color: "text-emerald-500" },
            { title: "Total Minutes", value: stats?.totalMinutes, icon: Clock, loading: statsLoading, suffix: "m", color: "text-amber-500" },
            { title: "AI Requests", value: stats?.totalAiRequests, icon: Zap, loading: statsLoading, suffix: "", color: "text-violet-500" },
          ].map((stat, i) => (
            <motion.div key={i} variants={item} whileHover={{ y: -5, transition: { duration: 0.2 } }}>
              <Card
                className="bg-card border-border/60 shadow-sm overflow-hidden relative group cursor-default"
                data-testid={`card-stat-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {/* Hover glow */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                {/* Top accent line */}
                <div className={`absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-current to-transparent opacity-20 ${stat.color}`} />

                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 pt-5 px-5 relative z-10">
                  <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                    {stat.title}
                  </CardTitle>
                  <div className={`p-1.5 rounded-lg bg-current/10 ${stat.color}`}>
                    <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
                  </div>
                </CardHeader>
                <CardContent className="relative z-10 pb-5 px-5 pt-1">
                  {stat.loading ? (
                    <Skeleton className="h-10 w-20 rounded-lg" />
                  ) : (
                    <div className="text-4xl font-black font-mono tracking-tighter text-foreground">
                      <CountUp to={stat.value || 0} suffix={stat.suffix} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        {/* ── Memory: due reminders ──────────────────────────────────────── */}
        {soonReminders.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28, duration: 0.5, ease: "easeOut" }}
          >
            <Card className="bg-card border-amber-500/25 shadow-sm overflow-hidden">
              <CardHeader className="flex flex-row items-end justify-between border-b border-amber-500/20 pb-3.5 px-6 pt-4 bg-amber-500/5">
                <div className="flex items-center gap-2.5">
                  <BellRing className="h-4 w-4 text-amber-500" />
                  <CardTitle className="text-base font-bold">Anstehende Erinnerungen</CardTitle>
                </div>
                <Link href="/brain">
                  <Button variant="ghost" size="sm" className="gap-1.5 text-amber-600 hover:text-amber-600 hover:bg-amber-500/10 h-8 rounded-lg text-xs font-semibold">
                    Memory <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="p-3 space-y-1">
                {soonReminders.map((r) => {
                  const due = new Date(r.dueAt);
                  const overdue = due.getTime() < Date.now();
                  return (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors">
                      <button
                        type="button"
                        onClick={() => doneReminder.mutate(r.id)}
                        className="h-5 w-5 rounded border border-border hover:border-amber-500 hover:bg-amber-500/10 flex items-center justify-center flex-none transition-colors"
                        aria-label="Erledigt"
                        data-testid={`dash-reminder-${r.id}`}
                      />
                      <span className="text-sm flex-1 min-w-0 truncate">{r.label}</span>
                      <span className={`text-xs font-mono tabular-nums flex-none ${overdue ? "text-red-500 font-bold" : "text-muted-foreground"}`}>
                        {overdue ? "überfällig · " : ""}{due.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ── Recent sessions ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5, ease: "easeOut" }}
        >
          <Card className="bg-card border-border/60 shadow-sm overflow-hidden">
            <CardHeader className="flex flex-row items-end justify-between border-b border-border/50 pb-4 px-6 pt-5 bg-muted/20">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <Mic className="h-4 w-4 text-primary" />
                  <CardTitle className="text-lg font-bold">Recent Sessions</CardTitle>
                </div>
                <p className="text-sm text-muted-foreground">Your latest recorded conversations.</p>
              </div>
              <Link href="/sessions" data-testid="link-view-all">
                <Button variant="ghost" size="sm" className="gap-1.5 text-primary hover:text-primary hover:bg-primary/10 h-9 rounded-lg text-sm font-semibold">
                  View All <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {recentLoading ? (
                <div className="p-6 space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
                  ))}
                </div>
              ) : !recentSessions?.length ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.5 }}
                    className="bg-muted/60 p-5 rounded-2xl mb-5"
                  >
                    <FileText className="h-8 w-8 text-muted-foreground opacity-50" />
                  </motion.div>
                  <h3 className="text-lg font-bold mb-2">No sessions yet</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-sm leading-relaxed">
                    Start your first high-stakes conversation and let FlowMind be your copilot.
                  </p>
                  <Link href="/session/new">
                    <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                      <Button className="rounded-xl shadow-md gap-2 font-semibold px-6">
                        <Play className="h-4 w-4 fill-current" /> Start Session
                      </Button>
                    </motion.div>
                  </Link>
                </div>
              ) : (
                <motion.div
                  variants={container}
                  initial="hidden"
                  animate="show"
                  className="divide-y divide-border/40"
                >
                  {recentSessions.map((session) => (
                    <motion.div key={session.id} variants={item}>
                      <Link href={`/session/${session.id}`} data-testid={`link-session-${session.id}`}>
                        <div className="group flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors cursor-pointer relative overflow-hidden">
                          {/* Left accent bar */}
                          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary scale-y-0 group-hover:scale-y-100 transition-transform origin-center duration-300" />

                          <div className="flex items-center gap-4">
                            <div className={`p-2.5 rounded-xl shrink-0 transition-all duration-300 ${
                              session.status === 'active'
                                ? 'bg-red-500/10 text-red-500'
                                : 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground'
                            }`}>
                              <Mic className="h-4 w-4" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2.5">
                                <span className="font-semibold text-foreground leading-none">{session.title}</span>
                                {session.status === 'active' && (
                                  <Badge className="bg-red-500/10 text-red-500 border-red-500/20 uppercase text-[9px] tracking-widest font-mono font-bold px-2 py-0 h-4">
                                    Live
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {new Date(session.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                </span>
                                <span>{Math.floor(session.durationSeconds / 60)}m {session.durationSeconds % 60}s</span>
                                {session.mode && (
                                  <span className="uppercase text-[10px] tracking-wider text-primary/70 font-semibold">{session.mode}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 sm:mt-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-2">
                            <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs font-semibold bg-background gap-1.5">
                              Open <ArrowRight className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
