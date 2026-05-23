import { useCallback, useContext, createContext } from "react";
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
      title: "📁 History",
      description: "Browse and search all past sessions. Pick up where you left off or review AI-generated notes.",
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
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const key = tourKey(userId);

  // Re-evaluated on every render so callers (like welcome.tsx) get the live
  // value after the tour finishes and we write the flag.
  const shouldAutoStart = typeof window !== "undefined" && !localStorage.getItem(key);

  const startTour = useCallback(async () => {
    // Mark BEFORE the tour fires so closing the browser / hitting ESC still
    // counts as "seen". The user can replay it from welcome page if they want.
    try { localStorage.setItem(key, "1"); } catch {}
    try {
      const { driver } = await import("driver.js");
      await import("driver.js/dist/driver.css");

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
        steps: TOUR_STEPS.map((step) => ({
          element: (step as any).element,
          popover: { ...step.popover },
        })),
      });

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
