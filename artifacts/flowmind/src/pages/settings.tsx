import { useState, useEffect } from "react";
import { useGetCurrentUsage, useGetUsageHistory } from "@workspace/api-client-react";
import { Link, useSearch } from "wouter";
import {
  CreditCard, Database, Zap, Activity, CheckCircle2, Settings, TrendingUp, User, KeyRound,
  Mail, Tag, Save, Loader2, LogOut, ShieldAlert, ChevronDown, ChevronUp, Monitor, Globe,
  Link2, Link2Off, RefreshCw, Compass,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckoutDialog } from "@/components/checkout-dialog";
import { BillingPortalDialog } from "@/components/billing-portal-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore, apiFetch } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function AnimatedProgress({ value, colorClass = "bg-primary" }: { value: number; colorClass?: string }) {
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-secondary">
      <motion.div
        className={`h-full rounded-full ${colorClass}`}
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 1.1, ease: "easeOut", delay: 0.3 }}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { data: usage, isLoading: usageLoading } = useGetCurrentUsage();
  const { data: history, isLoading: historyLoading } = useGetUsageHistory();
  const search = useSearch();
  const { user, updateUser, clearAuth } = useAuthStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);

  // Account section state
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [activationCode, setActivationCode] = useState("");

  // Email change flow
  const [emailChangeStep, setEmailChangeStep] = useState<"idle" | "input" | "verify">("idle");
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");

  // Collapsibles
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);

  useEffect(() => {
    if (search.includes("checkout=success")) {
      setCheckoutSuccess(true);
    }
  }, [search]);

  // Active sessions query
  const { data: sessions = [], refetch: refetchSessions } = useQuery<{
    jti: string; deviceLabel: string | null; ip: string | null;
    isCurrent: boolean; lastSeenAt: string | null; createdAt: string;
  }[]>({
    queryKey: ["account", "sessions"],
    queryFn: async () => {
      const res = await apiFetch("/api/account/sessions");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: sessionsOpen,
  });

  // Security events query
  const { data: securityEvents = [] } = useQuery<{
    id: number; eventType: string; detail: string | null; ip: string | null; createdAt: string;
  }[]>({
    queryKey: ["account", "security-events"],
    queryFn: async () => {
      const res = await apiFetch("/api/account/security-events");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: eventsOpen,
  });

  const updateProfile = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/account/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      updateUser({ displayName: data.displayName });
      toast({ title: "Profile updated" });
    },
    onError: () => toast({ title: "Error updating profile", variant: "destructive" }),
  });

  const updateUsername = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/account/username", {
        method: "PATCH",
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      return data;
    },
    onSuccess: (data) => {
      updateUser({ username: data.username });
      toast({ title: "Username updated" });
    },
    onError: (err: unknown) => toast({ title: "Username unavailable", description: (err as Error).message, variant: "destructive" }),
  });

  const requestEmailChange = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/account/email", {
        method: "PATCH",
        body: JSON.stringify({ email: newEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      return data;
    },
    onSuccess: () => {
      setEmailChangeStep("verify");
      toast({ title: "Code sent", description: `Check ${newEmail} for a 6-digit code.` });
    },
    onError: (err: unknown) => toast({ title: "Error", description: (err as Error).message, variant: "destructive" }),
  });

  const verifyEmailChange = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/account/email/confirm", {
        method: "POST",
        body: JSON.stringify({ email: newEmail.trim().toLowerCase(), code: emailCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      return data;
    },
    onSuccess: () => {
      updateUser({ email: newEmail.trim().toLowerCase() });
      setEmailChangeStep("idle");
      setNewEmail("");
      setEmailCode("");
      toast({ title: "Email updated" });
    },
    onError: (err: unknown) => toast({ title: "Invalid code", description: (err as Error).message, variant: "destructive" }),
  });

  const toggleEmailLogin = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiFetch("/api/account/email-login", {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      updateUser({ emailLoginEnabled: data.emailLoginEnabled });
      toast({ title: data.emailLoginEnabled ? "Email login enabled" : "Email login disabled" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const signOutAll = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/auth/logout-all", { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.token) updateUser({});
      queryClient.invalidateQueries({ queryKey: ["account", "sessions"] });
      toast({ title: "Signed out everywhere", description: `${data.revokedCount} other session(s) revoked.` });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const revokeSession = useMutation({
    mutationFn: async (jti: string) => {
      const res = await apiFetch(`/api/account/sessions/${jti}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      refetchSessions();
      toast({ title: "Session ended" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const redeemCode = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/codes/redeem", {
        method: "POST",
        body: JSON.stringify({ code: activationCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      return data;
    },
    onSuccess: (data) => {
      updateUser({ plan: data.plan });
      setActivationCode("");
      toast({ title: "Code redeemed!", description: `Plan upgraded to ${data.plan}.` });
    },
    onError: (err: unknown) => {
      toast({
        title: "Invalid code",
        description: (err as Error).message,
        variant: "destructive",
      });
    },
  });

  const formatPercentage = (used: number, limit: number) => {
    if (limit === 0) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
  };

  return (
    <>
      <div className="relative overflow-hidden">
        {/* Ambient background */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute -top-16 -right-16 w-[350px] h-[350px] bg-primary/6 rounded-full blur-[90px]" />
        </div>

        <div className="relative z-10 p-6 md:p-8 lg:p-10 max-w-5xl mx-auto space-y-8">

          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-4 pb-6 border-b border-border/50"
          >
            <div className="bg-primary/10 p-3 rounded-2xl text-primary">
              <Settings className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">Account Settings</h1>
              <p className="text-muted-foreground font-medium mt-0.5 text-sm">Manage your plan and monitor AI usage.</p>
            </div>
          </motion.div>

          {/* §8 Account section */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="space-y-4"
          >
            {/* ── A: Profile ───────────────────────────────────────────────── */}
            <Card className="bg-card border-border/60 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
                <CardTitle className="text-base flex items-center gap-2.5">
                  <User className="h-4.5 w-4.5 text-primary" />
                  Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.displayName}
                      className="w-16 h-16 rounded-2xl object-cover shrink-0 ring-2 ring-border"
                    />
                  ) : (
                    <div
                      className="w-16 h-16 rounded-2xl shrink-0 flex items-center justify-center text-xl font-bold text-white select-none ring-2 ring-border"
                      style={{
                        background: `hsl(${((user?.id ?? 0) * 47) % 360} 60% 50%)`,
                      }}
                    >
                      {(user?.displayName ?? "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 space-y-3 min-w-0">
                    <div className="space-y-1.5">
                      <Label htmlFor="displayName" className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">
                        Display Name
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="displayName"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className="h-9 rounded-xl flex-1"
                          placeholder="Your name"
                        />
                        <Button
                          size="sm"
                          className="gap-1.5 rounded-xl h-9 shrink-0"
                          onClick={() => updateProfile.mutate()}
                          disabled={updateProfile.isPending || displayName === user?.displayName}
                        >
                          {updateProfile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      {user?.createdAt && (
                        <span>Member since <span className="text-foreground font-medium">{new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span></span>
                      )}
                      {user?.lastLoginAt && (
                        <span>Last login <span className="text-foreground font-medium">{new Date(user.lastLoginAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span></span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── B: Identity ──────────────────────────────────────────────── */}
            <Card className="bg-card border-border/60 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
                <CardTitle className="text-base flex items-center gap-2.5">
                  <Mail className="h-4 w-4 text-primary" />
                  Identity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                {/* Username */}
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">Username</Label>
                  <div className="flex gap-2">
                    <div className="flex items-center rounded-xl border border-border h-9 px-3 text-muted-foreground shrink-0">@</div>
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                      className="h-9 rounded-xl flex-1 font-mono"
                      placeholder="username"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-xl gap-1.5 shrink-0"
                      onClick={() => updateUsername.mutate()}
                      disabled={updateUsername.isPending || username === user?.username || !username.trim()}
                    >
                      {updateUsername.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Update
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Lowercase letters, numbers, underscores, hyphens only.</p>
                </div>

                <div className="border-t border-border/40" />

                {/* Email */}
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">Email</Label>
                  {user?.googleSub && user.email ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-foreground">{user.email}</span>
                      <Badge variant="secondary" className="text-[10px]">Managed by Google</Badge>
                    </div>
                  ) : user?.email ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground font-medium">{user.email}</span>
                        {emailChangeStep === "idle" && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-primary" onClick={() => setEmailChangeStep("input")}>
                            <Mail className="h-3 w-3" /> Change
                          </Button>
                        )}
                      </div>
                      {emailChangeStep === "input" && (
                        <div className="flex gap-2">
                          <Input
                            type="email"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            placeholder="new@email.com"
                            className="h-9 rounded-xl flex-1"
                          />
                          <Button size="sm" className="h-9 rounded-xl" onClick={() => requestEmailChange.mutate()} disabled={requestEmailChange.isPending || !newEmail.trim()}>
                            {requestEmailChange.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send code"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-9 rounded-xl" onClick={() => { setEmailChangeStep("idle"); setNewEmail(""); }}>Cancel</Button>
                        </div>
                      )}
                      {emailChangeStep === "verify" && (
                        <div className="flex gap-2">
                          <Input
                            value={emailCode}
                            onChange={(e) => setEmailCode(e.target.value)}
                            placeholder="6-digit code"
                            className="h-9 rounded-xl w-40 font-mono tracking-widest"
                            maxLength={6}
                          />
                          <Button size="sm" className="h-9 rounded-xl" onClick={() => verifyEmailChange.mutate()} disabled={verifyEmailChange.isPending || emailCode.length < 6}>
                            {verifyEmailChange.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verify"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-9 rounded-xl" onClick={() => { setEmailChangeStep("idle"); setEmailCode(""); }}>Cancel</Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No email set.</p>
                  )}
                </div>

                {/* Email login toggle */}
                {user?.email && user?.authMethods?.password && (
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium">Email magic-code sign-in</p>
                      <p className="text-xs text-muted-foreground">Allow signing in with a one-time code sent to your email.</p>
                    </div>
                    <Switch
                      checked={user.emailLoginEnabled ?? false}
                      onCheckedChange={(v) => toggleEmailLogin.mutate(v)}
                      disabled={toggleEmailLogin.isPending}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── C: Security ──────────────────────────────────────────────── */}
            <Card className="bg-card border-border/60 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
                <CardTitle className="text-base flex items-center gap-2.5">
                  <ShieldAlert className="h-4 w-4 text-primary" />
                  Security
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                {/* Password + sign-out row */}
                <div className="flex flex-wrap gap-3">
                  <Link href="/change-password">
                    <Button variant="outline" size="sm" className="gap-2 rounded-xl h-9">
                      <KeyRound className="h-3.5 w-3.5" />
                      {user?.authMethods?.password ? "Change Password" : "Set Password"}
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 rounded-xl h-9 text-destructive hover:text-destructive"
                    onClick={() => signOutAll.mutate()}
                    disabled={signOutAll.isPending}
                  >
                    {signOutAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                    Sign out everywhere
                  </Button>
                </div>

                {/* Active sessions collapsible */}
                <Collapsible open={sessionsOpen} onOpenChange={setSessionsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between h-9 rounded-xl px-3 text-sm font-medium">
                      <span className="flex items-center gap-2"><Monitor className="h-3.5 w-3.5" /> Active sessions</span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        {sessionsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 space-y-1 rounded-xl border border-border/50 overflow-hidden">
                      {sessions.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3">No active sessions found.</p>
                      ) : sessions.map((s) => (
                        <div key={s.jti} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30">
                          <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{s.deviceLabel ?? "Unknown device"}</p>
                            <p className="text-xs text-muted-foreground">{s.ip ?? "unknown IP"} · {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "never"}</p>
                          </div>
                          {s.isCurrent ? (
                            <Badge variant="secondary" className="text-[10px] shrink-0">This device</Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-destructive hover:text-destructive shrink-0"
                              onClick={() => revokeSession.mutate(s.jti)}
                              disabled={revokeSession.isPending}
                            >
                              End
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    <Button variant="ghost" size="sm" className="mt-1 h-7 text-xs gap-1" onClick={() => refetchSessions()}>
                      <RefreshCw className="h-3 w-3" /> Refresh
                    </Button>
                  </CollapsibleContent>
                </Collapsible>

                {/* Security events collapsible */}
                <Collapsible open={eventsOpen} onOpenChange={setEventsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between h-9 rounded-xl px-3 text-sm font-medium">
                      <span className="flex items-center gap-2"><ShieldAlert className="h-3.5 w-3.5" /> Recent security events</span>
                      {eventsOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 rounded-xl border border-border/50 overflow-hidden">
                      {securityEvents.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3">No recent events.</p>
                      ) : securityEvents.slice(0, 10).map((ev) => (
                        <div key={ev.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 text-xs border-b border-border/30 last:border-0">
                          <span className="font-medium text-foreground shrink-0">{ev.eventType}</span>
                          {ev.detail && <span className="text-muted-foreground truncate">{ev.detail}</span>}
                          <span className="text-muted-foreground shrink-0 ml-auto">{new Date(ev.createdAt).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>

            {/* ── D: Connected accounts ────────────────────────────────────── */}
            <Card className="bg-card border-border/60 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
                <CardTitle className="text-base flex items-center gap-2.5">
                  <Globe className="h-4 w-4 text-primary" />
                  Connected Accounts
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-lg">G</div>
                    <div>
                      <p className="text-sm font-medium">Google</p>
                      <p className="text-xs text-muted-foreground">{user?.googleSub ? "Connected" : "Not connected"}</p>
                    </div>
                  </div>
                  {user?.googleSub ? (
                    <Badge variant="secondary" className="gap-1.5 text-xs">
                      <Link2 className="h-3 w-3" /> Linked
                    </Badge>
                  ) : (
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 rounded-xl">
                      <Link2Off className="h-3.5 w-3.5" /> Connect Google
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ── Activation code + misc ───────────────────────────────────── */}
            <Card className="bg-card border-border/60 shadow-sm rounded-2xl overflow-hidden">
              <CardContent className="p-6 space-y-5">
                {/* Activation code */}
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">
                    Activation Code
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={activationCode}
                      onChange={(e) => setActivationCode(e.target.value)}
                      placeholder="XXXX-XXXX-XXXX"
                      className="h-9 rounded-xl font-mono max-w-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 rounded-xl h-9 shrink-0"
                      onClick={() => redeemCode.mutate()}
                      disabled={redeemCode.isPending || !activationCode.trim()}
                    >
                      {redeemCode.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
                      Redeem
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Enter a code to unlock a plan upgrade.</p>
                </div>

                <div className="border-t border-border/40" />

                {/* Replay tour */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Product tour</p>
                    <p className="text-xs text-muted-foreground">Re-run the guided walkthrough.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5 rounded-xl"
                    onClick={() => {
                      localStorage.removeItem("flowmind-tour-seen");
                      window.location.href = "/dashboard";
                    }}
                  >
                    <Compass className="h-3.5 w-3.5" /> Replay tour
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Success alert */}
          <AnimatePresence>
            {checkoutSuccess && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Alert className="border-emerald-500/40 bg-emerald-500/10 rounded-xl">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <AlertDescription className="text-emerald-700 dark:text-emerald-400 font-medium ml-2">
                    Upgrade successful! Your Pro systems are now online.
                  </AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid md:grid-cols-3 gap-8">

            {/* Main: usage + history */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="md:col-span-2 space-y-6"
            >
              {/* Usage card */}
              <Card className="bg-card border-border/60 shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="bg-muted/20 border-b border-border/40 pb-4">
                  <CardTitle className="text-lg flex items-center gap-2.5">
                    <Activity className="h-5 w-5 text-primary" />
                    Current Cycle Usage
                  </CardTitle>
                  <CardDescription>
                    Resets on{" "}
                    <span className="font-mono text-foreground font-medium">
                      {usage ? new Date(usage.billingPeriodEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : "…"}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-7 p-6">
                  {usageLoading ? (
                    <div className="space-y-6">
                      <Skeleton className="h-12 w-full rounded-xl" />
                      <Skeleton className="h-12 w-full rounded-xl" />
                    </div>
                  ) : usage ? (
                    <>
                      {/* Audio */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold flex items-center gap-2">
                            <Database className="h-4 w-4 text-primary/70" />
                            Audio Processing
                          </span>
                          <span className="font-mono text-muted-foreground">
                            <span className="text-foreground font-bold">{usage.audioMinutesUsed}</span>
                            {" / "}
                            {usage.audioMinutesLimit === -1 ? "∞" : usage.audioMinutesLimit} mins
                          </span>
                        </div>
                        <AnimatedProgress
                          value={usage.audioMinutesLimit === -1 ? 0 : formatPercentage(usage.audioMinutesUsed, usage.audioMinutesLimit)}
                          colorClass="bg-primary"
                        />
                        {usage.audioMinutesLimit !== -1 && (
                          <p className="text-xs text-muted-foreground">
                            {usage.audioMinutesLimit - usage.audioMinutesUsed} mins remaining this cycle
                          </p>
                        )}
                      </div>

                      {/* AI requests */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold flex items-center gap-2">
                            <Zap className="h-4 w-4 text-amber-500/80" />
                            AI Intelligence Requests
                          </span>
                          <span className="font-mono text-muted-foreground">
                            <span className="text-foreground font-bold">{usage.aiRequestsUsed}</span>
                            {" / "}
                            {usage.aiRequestsLimit === -1 ? "∞" : usage.aiRequestsLimit}
                          </span>
                        </div>
                        <AnimatedProgress
                          value={usage.aiRequestsLimit === -1 ? 0 : formatPercentage(usage.aiRequestsUsed, usage.aiRequestsLimit)}
                          colorClass="bg-amber-500"
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">Failed to load usage data.</p>
                  )}
                </CardContent>
              </Card>

              {/* History card */}
              <Card className="bg-card border-border/60 shadow-sm rounded-2xl">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg flex items-center gap-2.5">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Usage History
                  </CardTitle>
                  <CardDescription>Last 30 days of activity</CardDescription>
                </CardHeader>
                <CardContent>
                  {historyLoading ? (
                    <Skeleton className="h-48 w-full rounded-xl" />
                  ) : !history?.length ? (
                    <div className="text-center py-8 bg-muted/20 rounded-xl border border-dashed border-border/50">
                      <p className="text-sm text-muted-foreground">No recent activity found.</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {history.slice(0, 7).map((entry, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.2 + i * 0.04 }}
                          className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 transition-colors"
                          data-testid={`row-history-${i}`}
                        >
                          <span className="text-sm font-mono font-semibold text-muted-foreground">
                            {new Date(entry.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                          <div className="flex items-center gap-3 text-xs font-mono">
                            <span className="bg-muted px-2.5 py-1 rounded-lg border border-border/50 text-foreground/80">
                              {entry.audioMinutes} mins
                            </span>
                            <span className="bg-muted px-2.5 py-1 rounded-lg border border-border/50 text-foreground/80">
                              {entry.aiRequests} reqs
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Sidebar: plan card */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-5"
            >
              <Card className="bg-card border-primary/25 shadow-xl shadow-primary/8 rounded-2xl relative overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary/30 via-primary to-primary/30" />
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />

                <CardHeader className="pb-2 pt-6 px-6 relative z-10">
                  <CardTitle className="text-xs uppercase tracking-widest font-mono text-muted-foreground flex items-center gap-2">
                    <CreditCard className="h-3.5 w-3.5" />
                    Current License
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-7 px-6 pb-6 relative z-10">
                  {usageLoading ? (
                    <Skeleton className="h-10 w-32 rounded-lg" />
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-4xl font-black tracking-tight capitalize text-foreground">
                        {usage?.planName || "Free"}
                      </span>
                      {usage?.planName === 'pro' && (
                        <CheckCircle2 className="h-6 w-6 text-primary" />
                      )}
                    </div>
                  )}

                  <div className="space-y-2.5">
                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                      <Button
                        className="w-full font-semibold tracking-wide h-11 rounded-xl shadow-md gap-2"
                        onClick={() => setCheckoutOpen(true)}
                        data-testid="button-upgrade"
                      >
                        <Zap className="h-4 w-4" />
                        Upgrade Protocol
                      </Button>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                      <Button
                        className="w-full font-medium h-11 rounded-xl"
                        variant="outline"
                        onClick={() => setPortalOpen(true)}
                        data-testid="button-billing-portal"
                      >
                        Manage Billing
                      </Button>
                    </motion.div>
                    <Link href="/pricing">
                      <Button
                        className="w-full h-9 text-primary hover:text-primary hover:bg-primary/8 font-medium"
                        variant="ghost"
                        data-testid="link-compare-plans"
                      >
                        Compare Plans
                      </Button>
                    </Link>
                  </div>

                  <div className="pt-3 border-t border-border/40 text-center">
                    <p className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground/70">
                      Secure by <span className="font-bold text-foreground/60">Stripe</span>
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        planName="Pro"
        price="$29/month"
      />
      <BillingPortalDialog open={portalOpen} onOpenChange={setPortalOpen} />
    </>
  );
}
