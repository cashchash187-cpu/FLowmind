import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateSession } from "@workspace/api-client-react";
import { Mic, Compass, ArrowRight, Loader2, Sparkles, Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { useAuthStore } from "@/lib/auth";
import { toast } from "@/hooks/use-toast";

export default function NewSession() {
  const [, setLocation] = useLocation();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"copilot" | "insight">("copilot");
  const { user } = useAuthStore();

  const createSession = useCreateSession();

  const canUseInsight = user?.plan === "pro" || user?.plan === "business" || user?.isAdmin;

  const handleCreate = () => {
    if (createSession.isPending) return;
    const sessionTitle = title.trim() || `Session ${new Date().toLocaleString()}`;

    createSession.mutate(
      {
        data: {
          title: sessionTitle,
          mode: mode,
        },
      },
      {
        onSuccess: (session) => {
          setLocation(`/session/${session.id}`);
        },
        onError: (err: unknown) => {
          const message =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "Failed to create session. Please try again.";
          toast({ title: "Error", description: message, variant: "destructive" });
        },
      }
    );
  };

  return (
    // Wave 18: Layout now owns the viewport-height shell, so use min-h-full
    // to fill the scrollable <main> instead of an obsolete vh calc that
    // assumed the old shell's chrome heights.
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-10 flex flex-col items-center justify-center min-h-full">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center space-y-3 mb-4 w-full"
      >
        <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-2xl mb-2 text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">New Session</h1>
        <p className="text-lg text-muted-foreground max-w-md mx-auto">Configure your AI copilot mode before starting.</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.1, type: "spring" }}
        className="w-full"
      >
        <Card className="w-full bg-card/60 backdrop-blur-2xl border-border/40 shadow-2xl overflow-hidden rounded-3xl relative">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary/0 via-primary/50 to-primary/0" />
          <CardHeader className="pt-8 pb-6 px-8 text-center bg-muted/20 border-b border-border/30">
            <CardTitle className="text-2xl">Session Parameters</CardTitle>
            <CardDescription className="text-base">Choose a title and your assistance mode.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 p-8">
            <div className="space-y-3">
              <Label htmlFor="title" className="text-xs uppercase tracking-widest font-semibold text-muted-foreground font-mono">
                Session Title
              </Label>
              <Input
                id="title"
                placeholder="e.g. Q3 Roadmap Planning"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="bg-background/80 font-mono text-base h-12 rounded-xl border-border/60 focus-visible:ring-primary/30"
                data-testid="input-session-title"
              />
            </div>

            <div className="space-y-4">
              <Label className="text-xs uppercase tracking-widest font-semibold text-muted-foreground font-mono">
                Assistance Mode
              </Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => {
                  if (v === "insight" && !canUseInsight) return;
                  setMode(v as "copilot" | "insight");
                }}
                className="grid sm:grid-cols-2 gap-4"
              >
                {/* Live Copilot */}
                <Label
                  htmlFor="mode-copilot"
                  className={`relative flex flex-col items-start rounded-2xl border-2 p-6 cursor-pointer transition-all duration-300 ${
                    mode === "copilot"
                      ? "border-primary bg-primary/5 shadow-lg shadow-primary/5"
                      : "border-border/60 bg-background/50 hover:bg-muted/80 hover:border-border"
                  }`}
                >
                  <RadioGroupItem value="copilot" id="mode-copilot" className="sr-only" />
                  <div
                    className={`p-3 rounded-xl mb-4 ${
                      mode === "copilot"
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Mic className="h-6 w-6" />
                  </div>
                  <div className="font-bold text-lg mb-1">Live Copilot</div>
                  <div className="text-sm text-muted-foreground font-medium leading-relaxed">
                    Real-time transcripts with instant AI responses for objections, answers, and logic checks.
                  </div>
                  {mode === "copilot" && (
                    <motion.div
                      layoutId="mode-indicator"
                      className="absolute top-4 right-4 h-3 w-3 rounded-full bg-primary shadow-[0_0_10px_rgba(var(--primary),0.8)]"
                    />
                  )}
                </Label>

                {/* Insight Mode */}
                <Label
                  htmlFor="mode-insight"
                  className={`relative flex flex-col items-start rounded-2xl border-2 p-6 transition-all duration-300 ${
                    !canUseInsight ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                  } ${
                    mode === "insight"
                      ? "border-primary bg-primary/5 shadow-lg shadow-primary/5"
                      : "border-border/60 bg-background/50 hover:bg-muted/80 hover:border-border"
                  }`}
                >
                  <RadioGroupItem value="insight" id="mode-insight" className="sr-only" disabled={!canUseInsight} />
                  <div className="flex items-start justify-between w-full mb-4">
                    <div
                      className={`p-3 rounded-xl ${
                        mode === "insight"
                          ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Compass className="h-6 w-6" />
                    </div>
                    {/* Always show the Pro badge so the premium feature is
                        visible to everyone — locked for free, plain gold
                        for Pro users (so they see the value they're using). */}
                    <Badge
                      variant="outline"
                      className="text-xs text-amber-600 border-amber-500/30 bg-amber-500/5 gap-1"
                    >
                      {!canUseInsight && <Lock className="h-2.5 w-2.5" />}
                      Pro
                    </Badge>
                  </div>
                  <div className="font-bold text-lg mb-1">Insight Mode</div>
                  <div className="text-sm text-muted-foreground font-medium leading-relaxed">
                    AI surfaces live strategic insights — opportunities, risks, connections, and open questions — as you talk.
                  </div>
                  {!canUseInsight && (
                    <p className="text-xs text-amber-600 mt-2">Upgrade to Pro or Business to unlock.</p>
                  )}
                  {mode === "insight" && (
                    <motion.div
                      layoutId="mode-indicator"
                      className="absolute top-4 right-4 h-3 w-3 rounded-full bg-primary shadow-[0_0_10px_rgba(var(--primary),0.8)]"
                    />
                  )}
                </Label>
              </RadioGroup>
            </div>
          </CardContent>
          <CardFooter className="p-8 pt-0">
            <Button
              className="w-full font-mono font-bold tracking-widest text-sm h-14 rounded-xl uppercase shadow-xl shadow-primary/20"
              size="lg"
              onClick={handleCreate}
              disabled={createSession.isPending}
              data-testid="button-start-session"
            >
              {createSession.isPending ? (
                <Loader2 className="mr-3 h-5 w-5 animate-spin" />
              ) : (
                <ArrowRight className="mr-3 h-5 w-5" />
              )}
              Start Session
            </Button>
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
}
