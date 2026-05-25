import { useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import {
  useGetSessionNotes,
  useGetSession,
  getGetSessionQueryKey,
  useListTranscripts,
  getListTranscriptsQueryKey,
  getGetSessionNotesQueryKey,
  useGenerateAiSummary,
} from "@workspace/api-client-react";
import {
  FileText,
  ArrowLeft,
  RefreshCw,
  CheckSquare,
  Target,
  HelpCircle,
  Lightbulb,
  Download,
  Clock,
  Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";

async function exportPDF(
  sessionTitle: string,
  notes: {
    summary?: string;
    actionItems?: string[];
    decisions?: string[];
    openQuestions?: string[];
    keyInsights?: string[];
  },
  transcripts: { speakerLabel: string; text: string; startMs: number }[],
  includeTranscript: boolean
) {
  const { default: jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginL = 20;
  const marginR = 20;
  const contentWidth = pageWidth - marginL - marginR;
  let y = 20;

  const checkPage = (needed = 10) => {
    if (y + needed > pageHeight - 15) {
      doc.addPage();
      y = 20;
    }
  };

  const addText = (
    text: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: [number, number, number];
      indent?: number;
      lineHeight?: number;
    } = {}
  ) => {
    const { size = 10, bold = false, color = [30, 30, 30], indent = 0, lineHeight = 6 } = opts;
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, contentWidth - indent);
    lines.forEach((line: string) => {
      checkPage(lineHeight);
      doc.text(line, marginL + indent, y);
      y += lineHeight;
    });
  };

  const addDivider = () => {
    checkPage(6);
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(marginL, y, pageWidth - marginR, y);
    y += 5;
  };

  const addSectionHeader = (title: string, iconColor: [number, number, number]) => {
    checkPage(14);
    y += 4;
    doc.setFillColor(...iconColor);
    doc.roundedRect(marginL, y - 4, 3, 8, 1, 1, "F");
    addText(title, { size: 11, bold: true, color: [20, 20, 20], indent: 6 });
    y += 1;
  };

  // ─── Header ────────────────────────────────────────────────────────────────
  doc.setFillColor(79, 70, 229); // indigo
  doc.rect(0, 0, pageWidth, 18, "F");
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("FlowMind — Meeting Notes", marginL, 12);

  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(dateStr, pageWidth - marginR, 12, { align: "right" });

  y = 26;
  addText(sessionTitle, { size: 14, bold: true, color: [20, 20, 20] });
  y += 2;
  addDivider();

  // ─── Summary ────────────────────────────────────────────────────────────────
  if (notes.summary) {
    addSectionHeader("Executive Summary", [79, 70, 229]);
    addText(notes.summary, { size: 10, color: [50, 50, 50], lineHeight: 5.5 });
    y += 4;
  }

  // ─── Action Items ───────────────────────────────────────────────────────────
  if (notes.actionItems?.length) {
    addDivider();
    addSectionHeader("Action Items", [16, 185, 129]);
    notes.actionItems.forEach((item) => {
      checkPage(8);
      doc.setFillColor(16, 185, 129);
      doc.circle(marginL + 4, y - 1.5, 1.2, "F");
      addText(item, { size: 10, color: [50, 50, 50], indent: 8, lineHeight: 5.5 });
    });
    y += 2;
  }

  // ─── Decisions ──────────────────────────────────────────────────────────────
  if (notes.decisions?.length) {
    addDivider();
    addSectionHeader("Decisions Made", [59, 130, 246]);
    notes.decisions.forEach((item) => {
      checkPage(8);
      doc.setFillColor(59, 130, 246);
      doc.circle(marginL + 4, y - 1.5, 1.2, "F");
      addText(item, { size: 10, color: [50, 50, 50], indent: 8, lineHeight: 5.5 });
    });
    y += 2;
  }

  // ─── Open Questions ─────────────────────────────────────────────────────────
  if (notes.openQuestions?.length) {
    addDivider();
    addSectionHeader("Open Questions", [245, 158, 11]);
    notes.openQuestions.forEach((item) => {
      checkPage(8);
      doc.setTextColor(245, 158, 11);
      doc.setFontSize(10);
      doc.text("?", marginL + 3.5, y);
      addText(item, { size: 10, color: [50, 50, 50], indent: 8, lineHeight: 5.5 });
    });
    y += 2;
  }

  // ─── Key Insights ───────────────────────────────────────────────────────────
  if (notes.keyInsights?.length) {
    addDivider();
    addSectionHeader("Key Insights", [168, 85, 247]);
    notes.keyInsights.forEach((item) => {
      checkPage(8);
      doc.setFillColor(168, 85, 247);
      doc.circle(marginL + 4, y - 1.5, 1.2, "F");
      addText(item, { size: 10, color: [50, 50, 50], indent: 8, lineHeight: 5.5 });
    });
    y += 2;
  }

  // ─── Transcript ─────────────────────────────────────────────────────────────
  if (includeTranscript && transcripts.length > 0) {
    doc.addPage();
    y = 20;
    addText("Full Transcript", { size: 13, bold: true, color: [20, 20, 20] });
    y += 2;
    addDivider();

    // If diarization was off the server stamps every line as the generic
    // "Speaker". In that case (or when only one distinct label exists) it
    // is misleading to print speaker labels — collapse to timestamp-only.
    const uniqueSpeakers = new Set(transcripts.map((t) => t.speakerLabel));
    const hasMeaningfulSpeakers =
      uniqueSpeakers.size > 1 || (uniqueSpeakers.size === 1 && !uniqueSpeakers.has("Speaker"));

    transcripts.forEach((t) => {
      checkPage(12);
      const mins = Math.floor(t.startMs / 60000);
      const secs = Math.floor((t.startMs % 60000) / 1000);
      const timestamp = `${mins}:${secs.toString().padStart(2, "0")}`;
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(100, 100, 100);
      doc.text(
        hasMeaningfulSpeakers ? `${t.speakerLabel}  ${timestamp}` : timestamp,
        marginL,
        y,
      );
      y += 4.5;
      addText(t.text, { size: 10, color: [40, 40, 40], lineHeight: 5.2 });
      y += 2;
    });
  }

  // ─── Footer on all pages ────────────────────────────────────────────────────
  const totalPages = (doc as any).internal.getNumberOfPages();
  const deployedUrl = typeof window !== "undefined" ? (window.location.origin || "flowmind.app") : "flowmind.app";
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    // Thin rule above footer
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(marginL, pageHeight - 13, pageWidth - marginR, pageHeight - 13);
    // Footer text
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(160, 160, 160);
    doc.text("Generated with FlowMind", marginL, pageHeight - 9);
    doc.text(`${p} / ${totalPages}`, pageWidth / 2, pageHeight - 9, { align: "center" });
    doc.text(deployedUrl, pageWidth - marginR, pageHeight - 9, { align: "right" });
  }

  const slug = sessionTitle.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
  doc.save(`flowmind-notes-${slug}.pdf`);
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

export default function SessionNotes() {
  const params = useParams();
  const sessionId = Number(params.id);
  const queryClient = useQueryClient();

  const { data: session } = useGetSession(sessionId, { query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId) } });
  const { data: notes, isLoading: notesLoading } = useGetSessionNotes(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionNotesQueryKey(sessionId) },
  });
  const { data: transcripts } = useListTranscripts(sessionId, {
    query: { enabled: !!sessionId, staleTime: 60_000, queryKey: getListTranscriptsQueryKey(sessionId) },
  });

  const generateSummary = useGenerateAiSummary();

  const handleRegenerate = () => {
    generateSummary.mutate(
      { id: sessionId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSessionNotesQueryKey(sessionId) });
        },
      }
    );
  };

  // Auto-generate ONCE when the notes page is opened for a session that
  // doesn't have notes yet AND has some transcript content to summarise.
  // The ref guard makes sure we never re-fire — even if the user clears
  // notes manually, subsequent visits stay on-demand.
  const autoGenAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoGenAttemptedRef.current) return;
    if (notesLoading) return;
    if (notes) return;
    if (!transcripts || transcripts.length === 0) return;
    if (generateSummary.isPending) return;
    autoGenAttemptedRef.current = true;
    handleRegenerate();
    // handleRegenerate references generateSummary which is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesLoading, notes, transcripts]);

  const handleExport = async (includeTranscript: boolean) => {
    if (!notes) return;
    await exportPDF(
      session?.title ?? "Meeting",
      notes,
      (transcripts ?? []).map((t) => ({
        speakerLabel: t.speakerLabel,
        text: t.text,
        startMs: t.startMs,
      })),
      includeTranscript
    );
  };

  return (
    <div className="h-full min-h-full bg-background flex flex-col">
      {/* Header */}
      <header className="flex-none h-16 border-b border-border/40 bg-card/60 backdrop-blur-2xl px-6 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <Link href={`/session/${sessionId}`}>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full bg-muted/50 hover:bg-muted">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex flex-col">
            <h1 className="font-bold font-mono tracking-tight text-sm">
              {session?.title || "Loading…"}
            </h1>
            <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground font-semibold">Intelligence Briefing</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
            disabled={generateSummary.isPending}
            className="gap-2 font-mono text-xs uppercase tracking-widest rounded-lg h-9 border-primary/20 hover:bg-primary/5 text-primary"
          >
            <RefreshCw className={`h-3 w-3 ${generateSummary.isPending ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Regenerate</span>
          </Button>

          {notes && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport(false)}
                className="gap-2 font-mono text-xs uppercase tracking-widest rounded-lg h-9 bg-card"
                title="Export summary only"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">PDF</span>
              </Button>
              {(transcripts?.length ?? 0) > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport(true)}
                  className="gap-2 font-mono text-xs uppercase tracking-widest rounded-lg h-9 bg-card"
                  title="Export summary + full transcript"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">+ Transcript</span>
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 md:p-8 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-8 pb-12">
          
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-4 border-b border-border/40 pb-8"
          >
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground font-serif leading-tight">
              {session?.title || "Intelligence Briefing"}
            </h2>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-mono text-muted-foreground">
              {session && (
                <>
                  <span className="flex items-center gap-2"><Clock className="h-4 w-4 opacity-50" /> {new Date(session.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                  <span className="flex items-center gap-2"><Users className="h-4 w-4 opacity-50" /> {session.speakerCount} Speakers</span>
                  <span className="flex items-center gap-2"><FileText className="h-4 w-4 opacity-50" /> {Math.floor(session.durationSeconds / 60)}m {session.durationSeconds % 60}s</span>
                </>
              )}
            </div>
          </motion.div>

          {notesLoading ? (
            <div className="space-y-8">
              <Skeleton className="h-40 w-full rounded-2xl" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Skeleton className="h-64 w-full rounded-2xl" />
                <Skeleton className="h-64 w-full rounded-2xl" />
              </div>
            </div>
          ) : !notes ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-24 border border-dashed border-border/50 rounded-3xl bg-card/20"
            >
              <div className="bg-muted/50 p-4 rounded-full w-fit mx-auto mb-6">
                <FileText className="h-10 w-10 text-muted-foreground opacity-50" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No intelligence generated</h3>
              <p className="text-muted-foreground font-medium mb-8 max-w-sm mx-auto">
                Generate AI notes to extract actionable intelligence from this conversation.
              </p>
              <Button onClick={handleRegenerate} disabled={generateSummary.isPending} className="gap-2 h-12 px-6 rounded-xl shadow-md">
                {generateSummary.isPending ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Lightbulb className="h-5 w-5 fill-current" />}
                Generate Intelligence
              </Button>
            </motion.div>
          ) : (
            <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
              {/* Summary */}
              <motion.div variants={item}>
                <Card className="border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm overflow-hidden">
                  <div className="h-1 w-full bg-gradient-to-r from-primary/50 to-transparent" />
                  <CardHeader className="pb-4 pt-6">
                    <CardTitle className="text-xs font-mono uppercase tracking-widest text-primary flex items-center gap-2 font-bold">
                      <FileText className="h-4 w-4" />
                      Executive Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-8">
                    <p className="text-base md:text-lg leading-relaxed text-foreground/90 font-medium">
                      {notes.summary || "No summary available."}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Action Items */}
                <motion.div variants={item} className="h-full">
                  <Card className="h-full border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-xs font-mono uppercase tracking-widest flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold">
                        <CheckSquare className="h-4 w-4" />
                        Action Items
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {notes.actionItems?.length ? (
                        <ul className="space-y-4">
                          {notes.actionItems.map((item, i) => (
                            <li key={i} className="flex gap-3 text-base font-medium">
                              <span className="text-emerald-500 mt-1 flex-none bg-emerald-500/10 p-0.5 rounded-sm">
                                <CheckSquare className="h-3.5 w-3.5" />
                              </span>
                              <span className="text-foreground/90">{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground font-medium italic">No action items identified.</p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>

                {/* Decisions */}
                <motion.div variants={item} className="h-full">
                  <Card className="h-full border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-xs font-mono uppercase tracking-widest flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold">
                        <Target className="h-4 w-4" />
                        Decisions Made
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {notes.decisions?.length ? (
                        <ul className="space-y-4">
                          {notes.decisions.map((item, i) => (
                            <li key={i} className="flex gap-3 text-base font-medium">
                              <span className="text-blue-500 mt-1 flex-none bg-blue-500/10 p-0.5 rounded-sm">
                                <Target className="h-3.5 w-3.5" />
                              </span>
                              <span className="text-foreground/90">{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground font-medium italic">No decisions recorded.</p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>

                {/* Open Questions */}
                <motion.div variants={item} className="h-full">
                  <Card className="h-full border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-xs font-mono uppercase tracking-widest flex items-center gap-2 text-amber-600 dark:text-amber-500 font-bold">
                        <HelpCircle className="h-4 w-4" />
                        Open Questions
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {notes.openQuestions?.length ? (
                        <ul className="space-y-4">
                          {notes.openQuestions.map((item, i) => (
                            <li key={i} className="flex gap-3 text-base font-medium">
                              <span className="text-amber-500 mt-1 flex-none bg-amber-500/10 p-0.5 rounded-sm font-bold w-5 h-5 flex items-center justify-center text-xs">
                                ?
                              </span>
                              <span className="text-foreground/90">{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground font-medium italic">No open questions.</p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>

                {/* Key Insights */}
                <motion.div variants={item} className="h-full">
                  <Card className="h-full border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-xs font-mono uppercase tracking-widest flex items-center gap-2 text-purple-600 dark:text-purple-400 font-bold">
                        <Lightbulb className="h-4 w-4" />
                        Key Insights
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {notes.keyInsights?.length ? (
                        <ul className="space-y-4">
                          {notes.keyInsights.map((item, i) => (
                            <li key={i} className="flex gap-3 text-base font-medium">
                              <span className="text-purple-500 mt-1 flex-none bg-purple-500/10 p-0.5 rounded-sm">
                                <Lightbulb className="h-3.5 w-3.5" />
                              </span>
                              <span className="text-foreground/90">{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground font-medium italic">No key insights.</p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </div>

              {/* Full transcript preview */}
              {(transcripts?.length ?? 0) > 0 && (() => {
                // Hide speaker column when diarization didn't run (server
                // tagged every line as the generic "Speaker") or when there's
                // only one distinct speaker — saves a useless column.
                const uniqueSpeakers = new Set(transcripts!.map((t) => t.speakerLabel));
                const showSpeakers =
                  uniqueSpeakers.size > 1 || (uniqueSpeakers.size === 1 && !uniqueSpeakers.has("Speaker"));
                return (
                <motion.div variants={item}>
                  <Card className="border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-xs font-mono uppercase tracking-widest flex items-center gap-2 text-muted-foreground font-bold">
                        <FileText className="h-4 w-4" />
                        Raw Transcript ({transcripts!.length} entries)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4 max-h-96 overflow-y-auto pr-2 scrollbar-thin">
                        {transcripts!.map((t) => (
                          <div key={t.id} className="flex gap-4 text-sm bg-muted/20 p-3 rounded-xl border border-border/20">
                            {showSpeakers && (
                              <span className="font-mono text-[10px] uppercase font-bold text-muted-foreground min-w-[70px] pt-0.5 flex-none text-right">
                                {t.speakerLabel}
                              </span>
                            )}
                            <span className="text-foreground/80 font-medium leading-relaxed">{t.text}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
                );
              })()}
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
}
