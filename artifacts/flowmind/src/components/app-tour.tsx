import { useCallback, useContext, createContext, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuthStore } from "@/lib/auth";

interface TourContextValue {
  /** Run the tour. Marks the per-user "done" flag so it won't auto-fire again. */
  startTour: () => void;
  /** True if the current user has never seen the tour in this browser. */
  shouldAutoStart: boolean;
  /** Clears the per-user "done" flag so the next visit auto-fires the tour again. */
  resetTourFlag: () => void;
}

const TourContext = createContext<TourContextValue>({
  startTour: () => {},
  shouldAutoStart: false,
  resetTourFlag: () => {},
});

export function useAppTour() {
  return useContext(TourContext);
}

/** Per-user localStorage key — global key leaks tour state across accounts. */
function tourKey(userId: number | null | undefined) {
  return userId ? `fm_tour_done:${userId}` : "fm_tour_done:anon";
}

const TOUR_STEPS = [
  {
    element: "[data-tour='new-session']",
    popover: {
      title: "🎙 Start a session",
      description: "Click <strong>New Session</strong> to start recording any meeting or call. FlowMind will transcribe it live and give you instant AI assistance.",
      side: "bottom" as const,
    },
  },
  {
    element: "[data-testid='link-nav-dashboard']",
    popover: {
      title: "📊 Dashboard",
      description: "Your command centre — see recent sessions, usage stats, and quick-start actions at a glance.",
      side: "right" as const,
    },
  },
  {
    element: "[data-testid='link-nav-history']",
    popover: {
      title: "📁 Sessions",
      description: "Browse every past session. Drag them into folders, rename anything inline, pick up where you left off.",
      side: "right" as const,
    },
  },
  {
    element: "[data-testid='link-nav-brain']",
    popover: {
      title: "🧠 Memory — dein zweites Gehirn",
      description: "Das Feature, das FlowMind einzigartig macht. Sprich Notizen ein (\"erinnere mich Freitag an Kevin\") — die KI sortiert sie automatisch in Ordner & Seiten. <strong>Jedes Meeting landet hier automatisch.</strong> Frag dein Gedächtnis alles, und es füttert dein nächstes Gespräch.",
      side: "right" as const,
    },
  },
  {
    element: "[data-testid='link-nav-settings']",
    popover: {
      title: "⚙️ Settings",
      description: "Manage your profile, password, connected accounts, and usage. You can also replay this tour anytime from here.",
      side: "right" as const,
    },
  },
  {
    element: "[data-testid='link-nav-pricing']",
    popover: {
      title: "💎 Pricing & Plans",
      description: "Upgrade to <strong>Pro</strong> to unlock Insight Mode, longer sessions, and unlimited history.",
      side: "right" as const,
    },
  },
  {
    popover: {
      title: "🤖 AI Copilot modes",
      description: "During a live session, press <strong>AI Assist</strong> to get instant help: <em>Objection Handler</em>, <em>Answer</em>, <em>Explain</em>, or <em>Logic Check</em> — all in the conversation's language.",
    },
  },
  {
    popover: {
      title: "🚀 You're all set!",
      description: "Start your first session and let FlowMind be your co-pilot. This tour won't show again — but you can replay it from the welcome page anytime.",
    },
  },
];

export function AppTourProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? null;
  const key = tourKey(userId);
  const [location] = useLocation();

  // Server-side truth: lastLoginAt is the value BEFORE the login that issued
  // the current token (see /api/auth/login — it reads the user row then
  // updates lastLoginAt, so the response carries the previous timestamp).
  // null => first login ever. Anything else => returning user.
  const isFirstLoginEver = !!user && !user.lastLoginAt;

  // Tab-local guard so the tour doesn't double-fire if the welcome page
  // remounts inside the same first-login session.
  const shouldAutoStart =
    isFirstLoginEver &&
    typeof window !== "undefined" &&
    !localStorage.getItem(key);

  // Driver.js mounts its overlay as a portal to document.body — it lives
  // OUTSIDE the React tree, so a route change does not unmount it. We keep
  // the live instance in a ref and kill it whenever the route changes so
  // the overlay can never get stuck on top of an unrelated page.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driverRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      // Cleanup on every location change AND on unmount.
      if (driverRef.current) {
        try { driverRef.current.destroy(); } catch { /* already destroyed */ }
        driverRef.current = null;
      }
    };
  }, [location]);

  const startTour = useCallback(async () => {
    // Mark BEFORE the tour fires so closing the browser / hitting ESC still
    // counts as "seen". The user can replay it from welcome page if they want.
    try { localStorage.setItem(key, "1"); } catch {}
    try {
      const { driver } = await import("driver.js");
      await import("driver.js/dist/driver.css");

      // If somehow another driver is still alive (e.g. user double-triggered),
      // tear it down before mounting a new one.
      if (driverRef.current) {
        try { driverRef.current.destroy(); } catch { /* noop */ }
      }

      const driverObj = driver({
        showProgress: true,
        animate: true,
        overlayColor: "rgba(0,0,0,0.55)",
        popoverClass: "fm-tour",
        progressText: "Step {{current}} of {{total}}",
        nextBtnText: "Next →",
        prevBtnText: "← Back",
        doneBtnText: "Get started →",
        smoothScroll: true,
        onDestroyed: () => {
          if (driverRef.current === driverObj) driverRef.current = null;
        },
        steps: TOUR_STEPS.map((step) => ({
          element: (step as any).element,
          popover: { ...step.popover },
        })),
      });

      driverRef.current = driverObj;
      driverObj.drive();
    } catch (err) {
      console.warn("Tour init failed:", err);
    }
  }, [key]);

  const resetTourFlag = useCallback(() => {
    try { localStorage.removeItem(key); } catch {}
  }, [key]);

  return (
    <TourContext.Provider value={{ startTour, shouldAutoStart, resetTourFlag }}>
      {children}
    </TourContext.Provider>
  );
}
