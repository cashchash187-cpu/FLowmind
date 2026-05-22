import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Mic, Mail, Lock, Eye, EyeOff, AlertCircle, Timer, Loader2, Chrome } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/lib/auth";
import { apiFetch } from "@/lib/auth";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { setAuth } = useAuthStore();
  const [tab, setTab] = useState<"password" | "email">("password");

  // Password tab state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);

  // Email tab state
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailStep, setEmailStep] = useState<"email" | "code">("email");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Config
  const [googleAvailable, setGoogleAvailable] = useState(false);
  useEffect(() => {
    apiFetch("/api/config")
      .then((r) => r.json())
      .then((c) => setGoogleAvailable(c.googleAuthAvailable ?? false))
      .catch(() => {});
  }, []);

  // Lockout countdown
  useEffect(() => {
    if (lockCountdown <= 0) return;
    const t = setInterval(() => setLockCountdown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [lockCountdown]);

  function handleAuthSuccess(data: { token: string; user: any }) {
    setAuth(data.token, data.user);
    if (data.user.passwordMustChange) {
      setLocation("/change-password");
    } else {
      setLocation("/");
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (lockCountdown > 0) return;
    setPwLoading(true);
    setPwError("");
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        handleAuthSuccess(data);
      } else if (res.status === 423) {
        setLockCountdown(data.secondsLeft ?? 60);
        setPwError(`Too many attempts. Locked for ${data.secondsLeft ?? 60}s.`);
      } else {
        setPwError(data.message ?? data.error ?? "Invalid credentials");
      }
    } catch {
      setPwError("Network error, please try again.");
    } finally {
      setPwLoading(false);
    }
  }

  async function handleEmailRequest(e: React.FormEvent) {
    e.preventDefault();
    setEmailLoading(true);
    setEmailError("");
    try {
      const res = await apiFetch("/api/auth/email/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setEmailStep("code");
        setEmailSent(true);
      } else if (res.status === 403) {
        setEmailError(data.message ?? "Email login not enabled for this account.");
      } else {
        setEmailError(data.message ?? data.error ?? "Failed to send code");
      }
    } catch {
      setEmailError("Network error, please try again.");
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleEmailVerify(e: React.FormEvent) {
    e.preventDefault();
    setEmailLoading(true);
    setEmailError("");
    try {
      const res = await apiFetch("/api/auth/email/verify", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (res.ok) {
        handleAuthSuccess(data);
      } else {
        setEmailError(data.message ?? data.error ?? "Invalid or expired code");
      }
    } catch {
      setEmailError("Network error, please try again.");
    } finally {
      setEmailLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-primary/15 p-3 rounded-2xl text-primary mb-4">
            <Mic className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Flow<span className="text-primary">Mind</span>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">AI Conversation Copilot</p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Welcome back — let's get you in.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
              <TabsList className="w-full mb-6">
                <TabsTrigger value="password" className="flex-1">Password</TabsTrigger>
                <TabsTrigger value="email" className="flex-1">Magic Code</TabsTrigger>
              </TabsList>

              {/* ── Password tab ── */}
              <TabsContent value="password">
                <form onSubmit={handlePasswordLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      placeholder="your_username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPw ? "text" : "password"}
                        placeholder="••••••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPw((s) => !s)}
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {pwError && (
                    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                      {lockCountdown > 0 ? (
                        <Timer className="h-4 w-4 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0" />
                      )}
                      <span>
                        {lockCountdown > 0
                          ? `Account locked. Try again in ${lockCountdown}s.`
                          : pwError}
                      </span>
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={pwLoading || lockCountdown > 0}>
                    {pwLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                    Sign in
                  </Button>
                </form>
              </TabsContent>

              {/* ── Email magic code tab ── */}
              <TabsContent value="email">
                {emailStep === "email" ? (
                  <form onSubmit={handleEmailRequest} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email address</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    {emailError && (
                      <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{emailError}</span>
                      </div>
                    )}
                    <Button type="submit" className="w-full" disabled={emailLoading}>
                      {emailLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
                      Send code
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={handleEmailVerify} className="space-y-4">
                    <div className="rounded-lg bg-muted/50 border border-border/50 px-4 py-3 text-sm text-center">
                      Code sent to <strong>{email}</strong>. Check your inbox.
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="code">6-digit code</Label>
                      <Input
                        id="code"
                        placeholder="123456"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        maxLength={6}
                        className="text-center text-xl tracking-[0.4em] font-mono"
                        required
                      />
                    </div>
                    {emailError && (
                      <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{emailError}</span>
                      </div>
                    )}
                    <Button type="submit" className="w-full" disabled={emailLoading || code.length !== 6}>
                      {emailLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Verify code
                    </Button>
                    <Button variant="ghost" type="button" className="w-full text-muted-foreground" onClick={() => { setEmailStep("email"); setCode(""); setEmailError(""); }}>
                      Back
                    </Button>
                  </form>
                )}
              </TabsContent>
            </Tabs>

            {/* Google sign-in */}
            {googleAvailable && (
              <div className="mt-4">
                <div className="relative mb-4">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or</span></div>
                </div>
                <Button variant="outline" className="w-full" type="button" onClick={() => {
                  (window as any).google?.accounts?.id?.prompt();
                }}>
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Continue with Google
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
