import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuthStore, apiFetch } from "@/lib/auth";
import { Loader2 } from "lucide-react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuthStore();
  const [location, setLocation] = useLocation();
  const [settled, setSettled] = useState(false);
  // Track where we redirected so we don't loop
  const redirectedRef = useRef<string | null>(null);

  // Boot-time session validation. The persisted Zustand state can outlive
  // the 7-day JWT — without this check a returning user looks "logged in"
  // while every API call 401s ("failed to start session"). One /auth/me
  // round-trip settles it: 401 clears the stale state (and the redirect
  // effect below sends them to /login); network errors leave the state
  // alone so offline users aren't logged out spuriously.
  useEffect(() => {
    const stored = useAuthStore.getState();
    if (!stored.token && !stored.user) {
      setSettled(true);
      return;
    }
    let cancelled = false;
    apiFetch("/api/auth/me")
      .then((res) => {
        // apiFetch already broadcasts fm:unauthorized on 401, which clears
        // the store — nothing else to do here.
        if (!cancelled && res.status === 401) {
          useAuthStore.getState().clearAuth();
        }
      })
      .catch(() => { /* network hiccup — keep local state */ })
      .finally(() => { if (!cancelled) setSettled(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settled) return;

    if (!token || !user) {
      if (redirectedRef.current !== "/login") {
        redirectedRef.current = "/login";
        setLocation("/login");
      }
      return;
    }

    if (user.passwordMustChange && location !== "/change-password") {
      if (redirectedRef.current !== "/change-password") {
        redirectedRef.current = "/change-password";
        setLocation("/change-password");
      }
      return;
    }

    // Auth is settled and valid — clear redirect tracker
    redirectedRef.current = null;
  }, [settled, token, user, location, setLocation]);

  if (!settled) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
      </div>
    );
  }

  // Not authed or needs password change → render nothing (redirect effect handles navigation)
  if (!token || !user) return null;
  if (user.passwordMustChange && location !== "/change-password") return null;

  return <>{children}</>;
}
