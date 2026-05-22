import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, AlertTriangle, Link2, HelpCircle, Check, X, BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/auth";
import { formatDistanceToNow } from "date-fns";

interface InsightRow {
  id: number;
  sessionId: number;
  category: "opportunity" | "risk" | "connection" | "question";
  suggestion: string;
  status: "new" | "used" | "dismissed";
  createdAt: string;
}

const CATEGORY_CONFIG = {
  opportunity: {
    icon: Lightbulb,
    accent: "border-l-green-500",
    badge: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
    label: "Opportunity",
  },
  risk: {
    icon: AlertTriangle,
    accent: "border-l-amber-500",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    label: "Risk",
  },
  connection: {
    icon: Link2,
    accent: "border-l-blue-500",
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    label: "Connection",
  },
  question: {
    icon: HelpCircle,
    accent: "border-l-violet-500",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
    label: "Question",
  },
} as const;

interface Props {
  sessionId: number;
}

export function InsightStream({ sessionId }: Props) {
  const queryClient = useQueryClient();

  const { data: insights = [] } = useQuery<InsightRow[]>({
    queryKey: ["insights", sessionId],
    queryFn: async () => {
      const res = await apiFetch(`/api/ai/insights?sessionId=${sessionId}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 8000,
  });

  const updateInsight = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "used" | "dismissed" }) => {
      const res = await apiFetch(`/api/ai/insights/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insights", sessionId] });
    },
  });

  const visible = insights.filter((i) => i.status === "new" || i.status === "used");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Lightbulb className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Live Insights</span>
        {visible.length > 0 && (
          <Badge variant="secondary" className="text-xs">{visible.length}</Badge>
        )}
      </div>

      {visible.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3 py-8 px-4 text-center"
        >
          <div className="rounded-full bg-muted/60 p-3">
            <BrainCircuit className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <p className="text-sm text-muted-foreground italic leading-relaxed max-w-xs">
            Insights appear when the conversation gives the AI something to work with.
          </p>
        </motion.div>
      )}

      <AnimatePresence mode="popLayout">
        {visible.map((insight) => {
          const cfg = CATEGORY_CONFIG[insight.category] ?? CATEGORY_CONFIG.question;
          const Icon = cfg.icon;

          return (
            <motion.div
              key={insight.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className={`border-l-4 ${cfg.accent} bg-card/60 rounded-r-xl px-4 py-3 border border-l-0 border-border/40 shadow-sm`}
            >
              <div className="flex items-start gap-3">
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-xs ${cfg.badge} border`}>
                      {cfg.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(insight.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{insight.suggestion}</p>
                  {insight.status === "new" && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1.5 text-green-700 dark:text-green-400 border-green-500/30 hover:bg-green-500/10"
                        onClick={() => updateInsight.mutate({ id: insight.id, status: "used" })}
                      >
                        <Check className="h-3 w-3" />
                        Use
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1.5 text-muted-foreground"
                        onClick={() => updateInsight.mutate({ id: insight.id, status: "dismissed" })}
                      >
                        <X className="h-3 w-3" />
                        Dismiss
                      </Button>
                    </div>
                  )}
                  {insight.status === "used" && (
                    <Badge variant="outline" className="text-xs text-green-700 dark:text-green-400 border-green-500/20">
                      ✓ Used
                    </Badge>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
