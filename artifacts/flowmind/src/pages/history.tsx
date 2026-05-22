import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListSessions,
  getListSessionsQueryKey,
  useDeleteSession
} from "@workspace/api-client-react";
import {
  Search,
  Trash2,
  Mic,
  FileText,
  Play,
  CalendarDays,
  Clock,
  Filter,
  ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

export default function HistoryPage() {
  const { data: sessions, isLoading } = useListSessions();
  const deleteSession = useDeleteSession();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this session?")) {
      deleteSession.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        }
      });
    }
  };

  const filteredSessions = sessions?.filter((session) => {
    const matchesSearch = session.title.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === 'all') return true;
    if (filter === 'active') return session.status === 'active';
    if (filter === 'copilot') return session.mode === 'copilot';
    if (filter === 'notes') return session.mode === 'notes';
    return true;
  });

  return (
    <div className="relative overflow-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-20 -right-20 w-[400px] h-[400px] bg-primary/6 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 p-6 md:p-8 lg:p-10 max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-4"
        >
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-6 rounded-full bg-primary" />
              <span className="text-[11px] font-mono uppercase tracking-widest font-bold text-primary">Intelligence Archive</span>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight">Session History</h1>
            <p className="text-base text-muted-foreground">Review and extract intelligence from past conversations.</p>
          </div>
          <Link href="/session/new" data-testid="link-new-session">
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button className="shrink-0 h-11 px-6 gap-2 rounded-xl shadow-md border border-primary/20 font-semibold" data-testid="button-new-session">
                <Play className="h-4 w-4 fill-current" />
                New Session
              </Button>
            </motion.div>
          </Link>
        </motion.div>

        {/* Search + filter bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col sm:flex-row gap-3 p-2 bg-card border border-border/60 rounded-2xl shadow-sm"
        >
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search sessions..."
              className="pl-11 h-11 bg-transparent border-none shadow-none rounded-xl text-sm focus-visible:ring-primary/30"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <div className="w-full sm:w-[190px]">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="h-11 bg-muted/60 border-none rounded-xl font-medium text-sm" data-testid="select-filter">
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Filter" />
                </div>
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border/50 shadow-xl">
                <SelectItem value="all">All Sessions</SelectItem>
                <SelectItem value="active">Active Only</SelectItem>
                <SelectItem value="copilot">Copilot Mode</SelectItem>
                <SelectItem value="notes">Notes Mode</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </motion.div>

        {/* Session list */}
        <div>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-[100px] w-full rounded-2xl" />
              ))}
            </div>
          ) : !filteredSessions?.length ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-20 border border-dashed border-border/60 rounded-2xl bg-card/40"
            >
              <div className="bg-muted/60 p-4 rounded-2xl w-fit mx-auto mb-4">
                <FileText className="h-7 w-7 text-muted-foreground opacity-50" />
              </div>
              <h3 className="text-xl font-bold mb-2">No sessions found</h3>
              <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                {search || filter !== 'all' ? "Try adjusting your filters." : "Start a new session to build your history."}
              </p>
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
                {filteredSessions.map((session) => (
                  <motion.div
                    key={session.id}
                    variants={item}
                    exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
                    layout
                  >
                    <div
                      className="group flex flex-col sm:flex-row sm:items-center justify-between p-5 rounded-2xl border border-border/60 bg-card hover:bg-muted/20 hover:border-primary/25 hover:shadow-md transition-all cursor-pointer gap-4 relative overflow-hidden"
                      onClick={() => navigate(`/session/${session.id}`)}
                      data-testid={`row-session-${session.id}`}
                    >
                      {/* Left accent bar */}
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary scale-y-0 group-hover:scale-y-100 transition-transform origin-center rounded-r-sm" />

                      <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-xl shrink-0 transition-all duration-300 ${
                          session.mode === 'copilot'
                            ? 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground'
                            : 'bg-blue-500/10 text-blue-500 dark:text-blue-400 group-hover:bg-blue-500 group-hover:text-white'
                        }`}>
                          {session.mode === 'copilot' ? <Mic className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                        </div>

                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2.5">
                            <h3 className="font-bold text-base text-foreground leading-none">{session.title}</h3>
                            {session.status === 'active' && (
                              <Badge className="bg-red-500 text-white hover:bg-red-600 text-[9px] uppercase font-mono tracking-widest px-2 py-0 h-4">Live</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-mono text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <CalendarDays className="h-3 w-3 opacity-70" />
                              {new Date(session.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3 w-3 opacity-70" />
                              {Math.floor(session.durationSeconds / 60)}m {session.durationSeconds % 60}s
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Play className="h-3 w-3 opacity-70" />
                              {session.speakerCount} speakers
                            </div>
                            {session.mode && (
                              <span className="uppercase text-[10px] tracking-wider text-primary/70 font-semibold">{session.mode}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 shrink-0 mt-1 sm:mt-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg font-semibold text-xs bg-background gap-1"
                          onClick={(e) => { e.stopPropagation(); navigate(`/session/${session.id}/notes`); }}
                          data-testid={`button-notes-${session.id}`}
                        >
                          Notes <ArrowRight className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                          onClick={(e) => handleDelete(session.id, e)}
                          disabled={deleteSession.isPending}
                          data-testid={`button-delete-${session.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
