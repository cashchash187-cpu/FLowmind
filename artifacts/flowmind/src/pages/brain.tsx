import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  BrainCircuit,
  Mic,
  MicOff,
  Loader2,
  Folder,
  FileText,
  ArrowLeft,
  Check,
  Trash2,
  Pencil,
  Save,
  X,
  BellRing,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────

interface PageMeta { id: number; folder: string; title: string; updatedAt: string }
interface PageFull extends PageMeta { content: string; createdAt: string }
interface Reminder { id: number; label: string; dueAt: string; done: boolean }
interface MemoResult {
  memoId: number;
  page: { id: number; folder: string; title: string };
  reminder: { id: number; label: string; dueAt: string } | null;
  summary: string;
}

// ── Tiny markdown renderer ───────────────────────────────────────────────────
// Pages are agent-written simple markdown (headings, bullets, bold). A full
// md library is overkill; this covers what the agent emits.
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((line, i) => {
        const bolded = (s: string) =>
          s.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith("**") && part.endsWith("**")
              ? <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
              : <span key={j}>{part}</span>
          );
        if (line.startsWith("### ")) return <h4 key={i} className="font-bold text-sm mt-3">{bolded(line.slice(4))}</h4>;
        if (line.startsWith("## ")) return <h3 key={i} className="font-bold text-base mt-3">{bolded(line.slice(3))}</h3>;
        if (line.startsWith("# ")) return <h2 key={i} className="font-bold text-lg mt-3">{bolded(line.slice(2))}</h2>;
        if (/^\s*[-*•] /.test(line)) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-primary flex-none">•</span>
              <span className="text-muted-foreground">{bolded(line.replace(/^\s*[-*•] /, ""))}</span>
            </div>
          );
        }
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i} className="text-muted-foreground">{bolded(line)}</p>;
      })}
    </div>
  );
}

// ── Dictation (browser SpeechRecognition, one-shot into the textarea) ───────

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BrainPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Capture state
  const [draft, setDraft] = useState("");
  const [dictating, setDictating] = useState(false);
  const [lastResult, setLastResult] = useState<MemoResult | null>(null);
  const recRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const baseTextRef = useRef("");

  // Browser dictation — appends to the draft so users can mix voice + typing.
  const toggleDictation = useCallback(() => {
    if (dictating) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      toast({ title: "Diktat nicht verfügbar", description: "Dein Browser unterstützt keine Spracheingabe — tippe die Notiz einfach.", variant: "destructive" });
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = localStorage.getItem("fm_stt_lang") ?? "de-DE";
    baseTextRef.current = draft ? draft.trimEnd() + " " : "";
    rec.onresult = (ev) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setDraft(baseTextRef.current + final + interim);
    };
    rec.onend = () => setDictating(false);
    rec.onerror = () => setDictating(false);
    recRef.current = rec;
    rec.start();
    setDictating(true);
  }, [dictating, draft, toast]);

  useEffect(() => () => recRef.current?.stop(), []);

  // Submit memo → agent files it
  const submitMemo = useMutation({
    mutationFn: async (vars: { text: string; source: "voice" | "text" }) => {
      const res = await apiFetch("/api/memos", {
        method: "POST",
        body: JSON.stringify(vars),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(data.message ?? `Fehler ${res.status}`);
      }
      return res.json() as Promise<MemoResult>;
    },
    onSuccess: (result) => {
      setLastResult(result);
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["brain-pages"] });
      queryClient.invalidateQueries({ queryKey: ["brain-reminders"] });
      // Refresh the open page if the memo landed on it
      queryClient.invalidateQueries({ queryKey: ["brain-page", result.page.id] });
    },
    onError: (err: Error) => {
      toast({ title: "Konnte Memo nicht einsortieren", description: err.message, variant: "destructive" });
    },
  });

  // Data
  const { data: pages = [], isLoading: pagesLoading } = useQuery<PageMeta[]>({
    queryKey: ["brain-pages"],
    queryFn: async () => {
      const res = await apiFetch("/api/brain/pages");
      return res.ok ? res.json() : [];
    },
  });

  const { data: reminders = [] } = useQuery<Reminder[]>({
    queryKey: ["brain-reminders"],
    queryFn: async () => {
      const res = await apiFetch("/api/reminders");
      return res.ok ? res.json() : [];
    },
  });

  const [openPageId, setOpenPageId] = useState<number | null>(null);
  const { data: openPage } = useQuery<PageFull | null>({
    queryKey: ["brain-page", openPageId],
    enabled: openPageId !== null,
    queryFn: async () => {
      const res = await apiFetch(`/api/brain/pages/${openPageId}`);
      return res.ok ? res.json() : null;
    },
  });

  // Page editing
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const savePage = useMutation({
    mutationFn: async (vars: { id: number; content: string }) => {
      const res = await apiFetch(`/api/brain/pages/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: vars.content }),
      });
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["brain-page", openPageId] });
      queryClient.invalidateQueries({ queryKey: ["brain-pages"] });
    },
  });
  const deletePage = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/brain/pages/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`Fehler ${res.status}`);
    },
    onSuccess: () => {
      setOpenPageId(null);
      queryClient.invalidateQueries({ queryKey: ["brain-pages"] });
    },
  });

  const toggleReminder = useMutation({
    mutationFn: async (vars: { id: number; done: boolean }) => {
      await apiFetch(`/api/reminders/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: vars.done }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["brain-reminders"] }),
  });

  // Group pages by folder
  const folders = new Map<string, PageMeta[]>();
  for (const p of pages) {
    if (!folders.has(p.folder)) folders.set(p.folder, []);
    folders.get(p.folder)!.push(p);
  }

  const dueReminders = reminders.filter((r) => !r.done);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="bg-primary/15 p-2.5 rounded-xl text-primary">
          <BrainCircuit className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Memory</h1>
          <p className="text-sm text-muted-foreground">
            Sprich oder tippe eine Notiz — die KI sortiert sie automatisch ein und hält alles aktuell.
          </p>
        </div>
      </div>

      {/* Capture card */}
      <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'z.B. "Erinnere mich in 5 Tagen an Kevins Geburtstag" oder "Q3-Zahlen: Umsatz 2,4 Mio, plus 12 %"'}
          className="min-h-[88px] text-sm resize-none bg-background/60"
          data-testid="memo-input"
        />
        <div className="flex items-center gap-2">
          <Button
            variant={dictating ? "destructive" : "outline"}
            size="sm"
            className="gap-2 rounded-xl h-10 px-4"
            onClick={toggleDictation}
            data-testid="memo-mic"
          >
            {dictating ? <><MicOff className="h-4 w-4" /> Stop</> : <><Mic className="h-4 w-4" /> Diktieren</>}
          </Button>
          <Button
            size="sm"
            className="flex-1 sm:flex-none gap-2 rounded-xl h-10 px-5 font-semibold"
            disabled={!draft.trim() || submitMemo.isPending}
            onClick={() => submitMemo.mutate({ text: draft.trim(), source: dictating ? "voice" : "text" })}
            data-testid="memo-submit"
          >
            {submitMemo.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> KI sortiert ein…</>
              : <><Sparkles className="h-4 w-4" /> Einsortieren</>}
          </Button>
        </div>

        {/* Last filing result */}
        {lastResult && !submitMemo.isPending && (
          <button
            type="button"
            onClick={() => { setOpenPageId(lastResult.page.id); setEditing(false); }}
            className="w-full text-left flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-2.5 hover:bg-primary/10 transition-colors"
            data-testid="memo-result"
          >
            <Check className="h-4 w-4 text-primary flex-none mt-0.5" />
            <span className="text-sm">
              <span className="text-foreground">{lastResult.summary}</span>{" "}
              <span className="font-mono text-xs text-primary">→ {lastResult.page.folder} / {lastResult.page.title}</span>
              {lastResult.reminder && (
                <span className="block text-xs text-amber-600 mt-0.5">
                  ⏰ Erinnerung: {lastResult.reminder.label} — {new Date(lastResult.reminder.dueAt).toLocaleDateString("de-DE")}
                </span>
              )}
            </span>
          </button>
        )}
      </div>

      {/* Reminders */}
      {dueReminders.length > 0 && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-amber-600 font-semibold">
            <BellRing className="h-3.5 w-3.5" />
            Erinnerungen
          </div>
          {dueReminders.map((r) => {
            const due = new Date(r.dueAt);
            const overdue = due.getTime() < Date.now();
            return (
              <div key={r.id} className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => toggleReminder.mutate({ id: r.id, done: true })}
                  className="h-5 w-5 rounded border border-border hover:border-primary hover:bg-primary/10 flex items-center justify-center flex-none"
                  aria-label="Erledigt"
                />
                <span className="text-sm flex-1">{r.label}</span>
                <span className={`text-xs font-mono tabular-nums ${overdue ? "text-red-500 font-bold" : "text-muted-foreground"}`}>
                  {due.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Folder tree + page viewer */}
      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        {/* Tree — hidden on mobile when a page is open */}
        <div className={`space-y-4 ${openPageId !== null ? "hidden lg:block" : ""}`}>
          {pagesLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : folders.size === 0 ? (
            <div className="text-center py-10 rounded-2xl border border-dashed border-border/60">
              <BrainCircuit className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground/60">Noch keine Notizen</p>
              <p className="text-xs text-muted-foreground/50 mt-1 px-6">Sprich deine erste Notiz ein — Ordner und Seiten entstehen automatisch.</p>
            </div>
          ) : (
            Array.from(folders.entries()).map(([folder, list]) => (
              <div key={folder}>
                <div className="flex items-center gap-2 mb-1.5 px-1 text-xs font-mono uppercase tracking-widest text-muted-foreground font-semibold">
                  <Folder className="h-3.5 w-3.5 text-primary/60" />
                  {folder}
                </div>
                <div className="space-y-0.5">
                  {list.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setOpenPageId(p.id); setEditing(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-sm transition-colors ${
                        openPageId === p.id ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted/40 text-foreground"
                      }`}
                      data-testid={`brain-page-${p.id}`}
                    >
                      <FileText className="h-3.5 w-3.5 flex-none opacity-60" />
                      <span className="flex-1 truncate">{p.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Viewer */}
        <div className={openPageId === null ? "hidden lg:block" : ""}>
          {openPageId === null ? (
            <div className="h-full min-h-[200px] rounded-2xl border border-dashed border-border/60 flex items-center justify-center">
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground/50">Seite auswählen</p>
            </div>
          ) : !openPage ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : (
            <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/40">
                <div className="flex items-center gap-2 min-w-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden flex-none" onClick={() => setOpenPageId(null)}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">{openPage.title}</div>
                    <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
                      {openPage.folder} · {new Date(openPage.updatedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-none">
                  {editing ? (
                    <>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => savePage.mutate({ id: openPage.id, content: editContent })}
                        disabled={savePage.isPending}
                        aria-label="Speichern"
                      >
                        {savePage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(false)} aria-label="Abbrechen">
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => { setEditContent(openPage.content); setEditing(true); }}
                        aria-label="Bearbeiten"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive"
                        onClick={() => { if (window.confirm(`Seite "${openPage.title}" wirklich löschen?`)) deletePage.mutate(openPage.id); }}
                        aria-label="Löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="p-4">
                {editing ? (
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="min-h-[300px] text-sm font-mono bg-background/60"
                  />
                ) : openPage.content.trim() ? (
                  <MarkdownLite text={openPage.content} />
                ) : (
                  <p className="text-xs text-muted-foreground/50 italic">Leere Seite.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Plan note */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50 justify-center pb-4">
        <Badge variant="outline" className="text-[9px] font-mono uppercase">Beta</Badge>
        Memory lernt mit — je mehr du einsprichst, desto besser organisiert es sich.
      </div>
    </div>
  );
}
