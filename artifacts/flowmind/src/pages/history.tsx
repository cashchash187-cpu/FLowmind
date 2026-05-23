import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListSessions,
  getListSessionsQueryKey,
  useDeleteSession,
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
  ArrowRight,
  Folder,
  FolderPlus,
  FolderOpen,
  Inbox,
  Pencil,
  MoreHorizontal,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch } from "@/lib/auth";

interface Folder {
  id: number;
  name: string;
  position: number;
}

// Local folders query — folders aren't in the OpenAPI spec; we use apiFetch.
function useFolders() {
  return useQuery<Folder[]>({
    queryKey: ["folders"],
    queryFn: async () => {
      const r = await apiFetch("/api/folders");
      if (!r.ok) throw new Error("Failed to load folders");
      return r.json();
    },
  });
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } },
};

export default function HistoryPage() {
  const { data: sessions, isLoading } = useListSessions();
  const { data: folders } = useFolders();
  const deleteSession = useDeleteSession();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState("");
  // null = root / "Inbox". "all" = every session. number = folder id.
  const [activeFolder, setActiveFolder] = useState<"all" | null | number>("all");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<number | null>(null);
  const [renameSessionValue, setRenameSessionValue] = useState("");
  const [dragSessionId, setDragSessionId] = useState<number | null>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<number | "root" | null>(null);

  // ─── Mutations ─────────────────────────────────────────────────────────────
  const createFolder = useMutation({
    mutationFn: async (name: string) => {
      const r = await apiFetch("/api/folders", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error("Failed to create folder");
      return r.json() as Promise<Folder>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      setCreatingFolder(false);
      setNewFolderName("");
    },
  });

  const renameFolder = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const r = await apiFetch(`/api/folders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error("Failed to rename folder");
      return r.json() as Promise<Folder>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      setRenamingFolderId(null);
    },
  });

  const removeFolder = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiFetch(`/api/folders/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete folder");
    },
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      if (activeFolder === id) setActiveFolder("all");
    },
  });

  const renameSession = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const r = await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      if (!r.ok) throw new Error("Failed to rename session");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      setRenamingSessionId(null);
    },
  });

  const moveSession = useMutation({
    mutationFn: async ({ id, folderId }: { id: number; folderId: number | null }) => {
      const r = await apiFetch(`/api/sessions/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ folderId }),
      });
      if (!r.ok) throw new Error("Failed to move session");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
    },
  });

  const handleDelete = (id: number, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!window.confirm("Delete this session? This can't be undone.")) return;
    deleteSession.mutate(
      { id },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() }),
      },
    );
  };

  // ─── Derived data ──────────────────────────────────────────────────────────
  type Session = NonNullable<typeof sessions>[number] & { folderId?: number | null };

  const filteredSessions = useMemo(() => {
    const all = (sessions ?? []) as Session[];
    const lower = search.toLowerCase();
    return all
      .filter((s) => s.title.toLowerCase().includes(lower))
      .filter((s) => {
        if (activeFolder === "all") return true;
        if (activeFolder === null) return !s.folderId;
        return s.folderId === activeFolder;
      });
  }, [sessions, search, activeFolder]);

  // Per-folder counts for the sidebar badges.
  const counts = useMemo(() => {
    const all = (sessions ?? []) as Session[];
    const c: Record<string, number> = { all: all.length, root: 0 };
    for (const f of folders ?? []) c[`f${f.id}`] = 0;
    for (const s of all) {
      if (!s.folderId) c.root += 1;
      else c[`f${s.folderId}`] = (c[`f${s.folderId}`] ?? 0) + 1;
    }
    return c;
  }, [sessions, folders]);

  // ─── Drag-drop helpers (HTML5 — works on desktop; mobile uses the menu) ──
  function onDragStart(e: React.DragEvent, id: number) {
    setDragSessionId(id);
    e.dataTransfer.setData("text/plain", String(id));
    e.dataTransfer.effectAllowed = "move";
  }
  function onFolderDragOver(e: React.DragEvent, target: number | "root") {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetFolder(target);
  }
  function onFolderDrop(e: React.DragEvent, target: number | "root") {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain") || dragSessionId);
    setDragSessionId(null);
    setDropTargetFolder(null);
    if (!id) return;
    moveSession.mutate({ id, folderId: target === "root" ? null : target });
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  function formatDate(d: string) {
    const date = new Date(d);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function formatDuration(secs: number) {
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  }

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-20 -right-20 w-[400px] h-[400px] bg-primary/6 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 p-6 md:p-8 lg:p-10 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-4"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-6 rounded-full bg-primary" />
              <span className="text-[11px] font-mono uppercase tracking-widest font-bold text-primary">
                Sessions
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Your sessions</h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Organize meetings into folders. Click a title to rename. Drag to a folder, or use the menu.
            </p>
          </div>
          <Link href="/session/new">
            <Button className="shrink-0 h-11 px-6 gap-2 rounded-xl shadow-md border border-primary/20 font-semibold">
              <Play className="h-4 w-4 fill-current" />
              New Session
            </Button>
          </Link>
        </motion.div>

        {/* Search */}
        <div className="flex items-center gap-2 p-2 bg-card border border-border/60 rounded-2xl shadow-sm">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search sessions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 h-11 bg-transparent border-none shadow-none rounded-xl text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
          {/* Folders sidebar */}
          <aside className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 font-semibold px-2 pb-1">
              Folders
            </div>

            <FolderRow
              icon={<Filter className="h-3.5 w-3.5" />}
              label="All sessions"
              count={counts.all ?? 0}
              active={activeFolder === "all"}
              onClick={() => setActiveFolder("all")}
            />

            <FolderRow
              icon={<Inbox className="h-3.5 w-3.5" />}
              label="Inbox"
              count={counts.root ?? 0}
              active={activeFolder === null}
              onClick={() => setActiveFolder(null)}
              onDragOver={(e) => onFolderDragOver(e, "root")}
              onDragLeave={() => setDropTargetFolder(null)}
              onDrop={(e) => onFolderDrop(e, "root")}
              dropActive={dropTargetFolder === "root"}
            />

            {(folders ?? []).map((f) => (
              <div key={f.id} className="group">
                {renamingFolderId === f.id ? (
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={renameFolderValue}
                      onChange={(e) => setRenameFolderValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          renameFolder.mutate({ id: f.id, name: renameFolderValue });
                        } else if (e.key === "Escape") {
                          setRenamingFolderId(null);
                        }
                      }}
                      className="h-7 px-2 text-xs"
                    />
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => renameFolder.mutate({ id: f.id, name: renameFolderValue })}>
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setRenamingFolderId(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <FolderRow
                    icon={activeFolder === f.id ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
                    label={f.name}
                    count={counts[`f${f.id}`] ?? 0}
                    active={activeFolder === f.id}
                    onClick={() => setActiveFolder(f.id)}
                    onDragOver={(e) => onFolderDragOver(e, f.id)}
                    onDragLeave={() => setDropTargetFolder(null)}
                    onDrop={(e) => onFolderDrop(e, f.id)}
                    dropActive={dropTargetFolder === f.id}
                    actions={
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="opacity-0 group-hover:opacity-100 hover:bg-muted/50 rounded p-1"
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="text-xs">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenamingFolderId(f.id);
                              setRenameFolderValue(f.name);
                            }}
                          >
                            <Pencil className="h-3 w-3 mr-2" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              if (window.confirm(`Delete folder "${f.name}"? Sessions inside will move back to Inbox.`)) {
                                removeFolder.mutate(f.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    }
                  />
                )}
              </div>
            ))}

            {/* New folder */}
            {creatingFolder ? (
              <div className="flex items-center gap-1 px-2 py-1.5">
                <FolderPlus className="h-3.5 w-3.5 text-primary" />
                <Input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newFolderName.trim()) {
                      createFolder.mutate(newFolderName.trim());
                    } else if (e.key === "Escape") {
                      setCreatingFolder(false);
                      setNewFolderName("");
                    }
                  }}
                  className="h-7 px-2 text-xs"
                />
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => newFolderName.trim() && createFolder.mutate(newFolderName.trim())}>
                  <Check className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setCreatingFolder(false); setNewFolderName(""); }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreatingFolder(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                <span>New folder</span>
              </button>
            )}
          </aside>

          {/* Session list */}
          <div>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-xl" />
                ))}
              </div>
            ) : !filteredSessions.length ? (
              <div className="text-center py-16 border border-dashed border-border/60 rounded-2xl bg-card/30">
                <FileText className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {search ? "No sessions match your search." : "No sessions in this folder yet."}
                </p>
              </div>
            ) : (
              <motion.div variants={container} initial="hidden" animate="show" className="space-y-2">
                <AnimatePresence>
                  {filteredSessions.map((s) => {
                    const sess = s as Session;
                    const isRenaming = renamingSessionId === sess.id;
                    return (
                      <motion.div
                        key={sess.id}
                        variants={item}
                        layout
                        draggable={!isRenaming}
                        onDragStart={(e) => onDragStart(e as unknown as React.DragEvent, sess.id)}
                        onDragEnd={() => { setDragSessionId(null); setDropTargetFolder(null); }}
                        className={`group flex items-center gap-3 p-3 sm:p-4 rounded-xl border border-border/60 bg-card hover:border-primary/30 hover:bg-card/80 transition cursor-grab active:cursor-grabbing ${dragSessionId === sess.id ? "opacity-50" : ""}`}
                      >
                        <div
                          className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-none cursor-pointer"
                          onClick={() => navigate(`/session/${sess.id}`)}
                        >
                          {sess.mode === "insight" ? <Search className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          {isRenaming ? (
                            <div className="flex items-center gap-2">
                              <Input
                                autoFocus
                                value={renameSessionValue}
                                onChange={(e) => setRenameSessionValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && renameSessionValue.trim()) {
                                    renameSession.mutate({ id: sess.id, title: renameSessionValue.trim() });
                                  } else if (e.key === "Escape") {
                                    setRenamingSessionId(null);
                                  }
                                }}
                                className="h-8 px-2 text-sm"
                              />
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => renameSession.mutate({ id: sess.id, title: renameSessionValue.trim() })}>
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRenamingSessionId(null)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingSessionId(sess.id);
                                setRenameSessionValue(sess.title);
                              }}
                              className="text-left w-full"
                              title="Click to rename"
                            >
                              <div className="font-semibold text-sm truncate hover:text-primary transition-colors">
                                {sess.title}
                              </div>
                            </button>
                          )}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-muted-foreground font-mono">
                            <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {formatDate(sess.createdAt)}</span>
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDuration(sess.durationSeconds)}</span>
                            {sess.mode && (
                              <Badge variant="outline" className={`text-[9px] uppercase ${sess.mode === "insight" ? "text-amber-600 border-amber-500/30 bg-amber-500/5" : ""}`}>
                                {sess.mode}
                              </Badge>
                            )}
                            <Badge variant="outline" className={`text-[9px] uppercase ${
                              sess.status === "active" ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/5" : ""
                            }`}>
                              {sess.status}
                            </Badge>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 flex-none">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="text-xs">
                              <DropdownMenuItem
                                onClick={() => {
                                  setRenamingSessionId(sess.id);
                                  setRenameSessionValue(sess.title);
                                }}
                              >
                                <Pencil className="h-3 w-3 mr-2" /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Move to
                              </DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => moveSession.mutate({ id: sess.id, folderId: null })}
                                disabled={!sess.folderId}
                              >
                                <Inbox className="h-3 w-3 mr-2" /> Inbox (root)
                              </DropdownMenuItem>
                              {(folders ?? []).map((f) => (
                                <DropdownMenuItem
                                  key={f.id}
                                  onClick={() => moveSession.mutate({ id: sess.id, folderId: f.id })}
                                  disabled={sess.folderId === f.id}
                                >
                                  <Folder className="h-3 w-3 mr-2" /> {f.name}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => handleDelete(sess.id, e)}
                                className="text-destructive"
                              >
                                <Trash2 className="h-3 w-3 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Link href={`/session/${sess.id}`}>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Local components ─────────────────────────────────────────────────────────

interface FolderRowProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  dropActive?: boolean;
  actions?: React.ReactNode;
}

function FolderRow({
  icon, label, count, active, onClick, onDragOver, onDragLeave, onDrop, dropActive, actions,
}: FolderRowProps) {
  return (
    <div
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition select-none
        ${active ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}
        ${dropActive ? "ring-2 ring-primary/60 bg-primary/15" : ""}
      `}
    >
      <span className={active ? "text-primary" : ""}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[10px] text-muted-foreground/60 font-mono">{count}</span>
      {actions}
    </div>
  );
}
