import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BrainCircuit, Mic, MicOff, Loader2, Sparkles, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

// ── Browser dictation shim (shared shape with brain.tsx) ────────────────────
type SpeechRecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};
function getSpeechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as SpeechRecognitionCtor) ?? (w.webkitSpeechRecognition as SpeechRecognitionCtor) ?? null;
}

interface FilingResult {
  summary: string;
  page: { folder: string; title: string };
  reminder: { label: string; dueAt: string } | null;
}

/**
 * Floating quick-capture button + popover, mounted app-wide. Lets the user
 * drop a thought into Memory from ANY page without navigating away — the
 * "capture friction is the enemy of a second brain" principle. Voice or
 * text; the memo agent files it and a toast confirms where it landed.
 */
export function QuickCapture() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [dictating, setDictating] = useState(false);
  const recRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const baseRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) setTimeout(() => textareaRef.current?.focus(), 50); }, [open]);
  useEffect(() => () => recRef.current?.stop(), []);

  const toggleDictation = useCallback(() => {
    if (dictating) { recRef.current?.stop(); return; }
    const Ctor = getSpeechCtor();
    if (!Ctor) { toast({ title: "Diktat nicht verfügbar", description: "Tippe die Notiz einfach.", variant: "destructive" }); return; }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = localStorage.getItem("fm_stt_lang") ?? "de-DE";
    baseRef.current = draft ? draft.trimEnd() + " " : "";
    rec.onresult = (ev) => {
      let final = "", interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript + " "; else interim += r[0].transcript;
      }
      setDraft(baseRef.current + final + interim);
    };
    rec.onend = () => setDictating(false);
    rec.onerror = () => setDictating(false);
    recRef.current = rec;
    rec.start();
    setDictating(true);
  }, [dictating, draft, toast]);

  const submit = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/memos", { method: "POST", body: JSON.stringify({ text: draft.trim(), source: dictating ? "voice" : "text" }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(data.message ?? `Fehler ${res.status}`);
      }
      return res.json() as Promise<FilingResult>;
    },
    onSuccess: (r) => {
      recRef.current?.stop();
      setDraft("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["brain-pages"] });
      queryClient.invalidateQueries({ queryKey: ["brain-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-reminders"] });
      toast({
        title: "Gemerkt ✓",
        description: `${r.summary} → ${r.page.folder} / ${r.page.title}${r.reminder ? ` · ⏰ ${new Date(r.reminder.dueAt).toLocaleDateString("de-DE")}` : ""}`,
      });
    },
    onError: (err: Error) => toast({ title: "Konnte nicht merken", description: err.message, variant: "destructive" }),
  });

  return (
    <>
      {/* Floating button — bottom-right, above mobile chrome via safe-area. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed z-40 bottom-5 right-5 h-13 w-13 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.25rem)", height: "3.25rem", width: "3.25rem" }}
        aria-label="Schnell merken"
        data-testid="quick-capture-button"
      >
        {open ? <X className="h-5 w-5" /> : <BrainCircuit className="h-5 w-5" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="fixed z-40 right-5 bottom-20 w-[min(92vw,380px)] rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-2xl p-3.5 space-y-3"
            style={{ bottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
            data-testid="quick-capture-popover"
          >
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
              <BrainCircuit className="h-3.5 w-3.5 text-primary" />
              Schnell merken
            </div>
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) submit.mutate(); }}
              placeholder={'"Erinnere mich Freitag an den Anruf mit Kevin"'}
              className="min-h-[72px] text-sm resize-none bg-background/60"
            />
            <div className="flex items-center gap-2">
              <Button variant={dictating ? "destructive" : "outline"} size="sm" className="gap-2 rounded-xl h-9 px-3" onClick={toggleDictation}>
                {dictating ? <><MicOff className="h-4 w-4" /> Stop</> : <><Mic className="h-4 w-4" /></>}
              </Button>
              <Button
                size="sm"
                className="flex-1 gap-2 rounded-xl h-9 font-semibold"
                disabled={!draft.trim() || submit.isPending}
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sortiert ein…</> : <><Sparkles className="h-4 w-4" /> Einsortieren</>}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
