import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { KeyRound, Eye, EyeOff, AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { apiFetch, useAuthStore } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

export default function ChangePasswordPage() {
  const [, setLocation] = useLocation();
  const { user, updateUser } = useAuthStore();
  const { toast } = useToast();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch("/api/account/password", {
        method: "PATCH",
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        updateUser({ passwordMustChange: false });
        toast({ title: "Password set!", description: "You're all set." });
        setLocation("/");
      } else {
        setError(data.message ?? data.error ?? "Failed to update password.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const strength = newPassword.length >= 16 ? "Strong" : newPassword.length >= 12 ? "Good" : "Too short";
  const strengthColor = newPassword.length >= 16 ? "text-green-600" : newPassword.length >= 12 ? "text-amber-600" : "text-destructive";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="bg-amber-500/15 p-3 rounded-2xl text-amber-600 mb-4">
            <KeyRound className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Set your password</h1>
          <p className="text-muted-foreground mt-1 text-sm text-center max-w-xs">
            This is your first login. Please set a permanent password before continuing.
          </p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Create a new password</CardTitle>
            <CardDescription>Minimum 12 characters. Make it strong.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNew ? "text" : "password"}
                    placeholder="at least 12 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowNew((s) => !s)}>
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {newPassword && (
                  <p className={`text-xs ${strengthColor}`}>{strength}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirm ? "text" : "password"}
                    placeholder="repeat your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowConfirm((s) => !s)}>
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                Set password & continue
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
