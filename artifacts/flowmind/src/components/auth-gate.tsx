import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuthStore } from "@/lib/auth";
import { Loader2 } from "lucide-react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuthStore();
  const [location, setLocation] = useLocation();
  const [settled, setSettled] = useState(false);
  // Track where we redirected so we don't loop
  const redirectedRef = useRef<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 0);
    return () => clearTimeout(t);
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
