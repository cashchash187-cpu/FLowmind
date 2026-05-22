import { useCallback, useContext, createContext } from "react";

interface TourContextValue {
  startTour: () => void;
}

const TourContext = createContext<TourContextValue>({ startTour: () => {} });

export function useAppTour() {
  return useContext(TourContext);
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
  const startTour = useCallback(async () => {
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
        onDestroyed: () => {
          localStorage.setItem("fm_tour_done", "1");
        },
        steps: TOUR_STEPS.map((step) => ({
          element: (step as any).element,
          popover: { ...step.popover },
        })),
      });

      driverObj.drive();
    } catch (err) {
      console.warn("Tour init failed:", err);
    }
  }, []);

  return (
    <TourContext.Provider value={{ startTour }}>
      {children}
    </TourContext.Provider>
  );
}
