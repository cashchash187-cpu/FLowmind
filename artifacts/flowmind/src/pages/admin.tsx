import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Users, Activity, Search, RefreshCw, ChevronDown, ChevronUp, KeyRound, LogOut, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/auth";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  plan: string;
  isAdmin: boolean;
  sessionCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

interface SecurityEvent {
  id: number;
  userId: number | null;
  username: string | null;
  eventType: string;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

const PLAN_COLORS: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  pro: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  business: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
};

export default function AdminPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [expandedUser, setExpandedUser] = useState<number | null>(null);

  const { data: users = [], isLoading: usersLoading, refetch: refetchUsers } = useQuery<AdminUser[]>({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await apiFetch("/api/admin/users");
      if (!res.ok) throw new Error("Forbidden");
      return res.json();
    },
  });

  const { data: events = [], isLoading: eventsLoading, refetch: refetchEvents } = useQuery<SecurityEvent[]>({
    queryKey: ["admin", "events"],
    queryFn: async () => {
      const res = await apiFetch("/api/admin/events");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const setPlan = useMutation({
    mutationFn: async ({ userId, plan }: { userId: number; plan: string }) => {
      const res = await apiFetch(`/api/admin/users/${userId}/set-plan`, {
        method: "POST",
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast({ title: "Plan updated", description: `User ${vars.userId} → ${vars.plan}` });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not update plan.", variant: "destructive" });
    },
  });

  const resetPassword = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiFetch(`/api/admin/users/${userId}/reset-password`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Password reset", description: `Temporary: ${data.temporaryPassword}` });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not reset password.", variant: "destructive" });
    },
  });

  const revokeSessions = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiFetch(`/api/admin/users/${userId}/revoke-sessions`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sessions revoked" });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not revoke sessions.", variant: "destructive" });
    },
  });

  const generateCodes = useMutation({
    mutationFn: async ({ plan, count }: { plan: string; count: number }) => {
      const res = await apiFetch("/api/admin/codes/generate", {
        method: "POST",
        body: JSON.stringify({ plan, count }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<string[]>;
    },
    onSuccess: (codes) => {
      toast({
        title: `${codes.length} activation code(s) generated`,
        description: codes.slice(0, 3).join(", ") + (codes.length > 3 ? "…" : ""),
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not generate codes.", variant: "destructive" });
    },
  });

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.displayName.toLowerCase().includes(search.toLowerCase()) ||
      (u.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const eventTypeColor: Record<string, string> = {
    login_success: "text-green-600",
    login_failed: "text-red-600",
    lockout: "text-red-700",
    password_changed: "text-blue-600",
    logout_all: "text-amber-600",
    google_auth: "text-blue-500",
  };

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-6xl mx-auto space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 pb-6 border-b border-border/50"
      >
        <div className="bg-primary/10 p-2.5 rounded-xl text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Manage users, plans, and security events.</p>
        </div>
      </motion.div>

      {/* Quick stats */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="border-border/40">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">{users.length}</div>
                <div className="text-xs text-muted-foreground">Total users</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">
                  {users.filter((u) => u.plan === "pro" || u.plan === "business").length}
                </div>
                <div className="text-xs text-muted-foreground">Paid users</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-amber-500" />
              <div>
                <div className="text-2xl font-bold">{events.length}</div>
                <div className="text-xs text-muted-foreground">Security events (24h)</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activation code generator */}
      <Card className="border-border/40">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Generate Activation Codes</CardTitle>
          <CardDescription>Create one-time codes for plan upgrades.</CardDescription>
        </CardHeader>
        <CardContent>
          <GenerateCodes onGenerate={(plan, count) => generateCodes.mutate({ plan, count })} isPending={generateCodes.isPending} />
        </CardContent>
      </Card>

      {/* Users table */}
      <Card className="border-border/40">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Users</CardTitle>
              <CardDescription>{filteredUsers.length} of {users.length}</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchUsers()} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 rounded-xl"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {usersLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="hidden md:table-cell">Sessions</TableHead>
                  <TableHead className="hidden lg:table-cell">Last login</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <>
                    <TableRow key={user.id} className="cursor-pointer" onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                            {user.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-sm">{user.displayName}</div>
                            <div className="text-xs text-muted-foreground">@{user.username}</div>
                          </div>
                          {user.isAdmin && <Badge variant="secondary" className="text-xs">Admin</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs capitalize ${PLAN_COLORS[user.plan] ?? ""}`}>
                          {user.plan}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">{user.sessionCount}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {user.lastLoginAt ? formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true }) : "Never"}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          {expandedUser === user.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedUser === user.id && (
                      <TableRow key={`${user.id}-expanded`}>
                        <TableCell colSpan={5} className="bg-muted/20 px-6 py-4">
                          <div className="flex flex-wrap items-center gap-4">
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Email</p>
                              <p className="text-sm">{user.email ?? "—"}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Joined</p>
                              <p className="text-sm">{formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Change plan</p>
                              <Select
                                defaultValue={user.plan}
                                onValueChange={(v) => setPlan.mutate({ userId: user.id, plan: v })}
                              >
                                <SelectTrigger className="h-8 w-32 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="free">Free</SelectItem>
                                  <SelectItem value="pro">Pro</SelectItem>
                                  <SelectItem value="business">Business</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Actions</p>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 text-xs gap-1.5"
                                  onClick={(e) => { e.stopPropagation(); resetPassword.mutate(user.id); }}
                                  disabled={resetPassword.isPending}
                                >
                                  {resetPassword.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                                  Reset Password
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); revokeSessions.mutate(user.id); }}
                                  disabled={revokeSessions.isPending}
                                >
                                  {revokeSessions.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                                  Revoke Sessions
                                </Button>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Security events feed */}
      <Card className="border-border/40">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Security Events</CardTitle>
              <CardDescription>Recent auth activity across all users.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchEvents()} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No recent events.</p>
          ) : (
            <div className="space-y-1">
              {events.slice(0, 50).map((ev) => (
                <div key={ev.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors">
                  <Activity className={`h-3.5 w-3.5 shrink-0 ${eventTypeColor[ev.eventType] ?? "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <span className={`text-xs font-medium ${eventTypeColor[ev.eventType] ?? "text-foreground"}`}>{ev.eventType}</span>
                    {ev.username && <span className="text-xs text-muted-foreground ml-2">@{ev.username}</span>}
                    {ev.detail && <span className="text-xs text-muted-foreground ml-2 truncate">{ev.detail}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GenerateCodes({ onGenerate, isPending }: { onGenerate: (plan: string, count: number) => void; isPending: boolean }) {
  const [plan, setPlan] = useState("pro");
  const [count, setCount] = useState(5);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={plan} onValueChange={setPlan}>
        <SelectTrigger className="w-28 h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pro">Pro</SelectItem>
          <SelectItem value="business">Business</SelectItem>
        </SelectContent>
      </Select>
      <Input
        type="number"
        min={1}
        max={50}
        value={count}
        onChange={(e) => setCount(Number(e.target.value))}
        className="w-20 h-9 text-sm"
      />
      <Button size="sm" className="h-9" onClick={() => onGenerate(plan, count)} disabled={isPending}>
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
        Generate
      </Button>
    </div>
  );
}
