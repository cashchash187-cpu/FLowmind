import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { AnimatePresence, motion } from "framer-motion";
import { AppTourProvider } from "@/components/app-tour";
import { AuthGate } from "@/components/auth-gate";
import { ErrorBoundary } from "@/components/error-boundary";
import { useAuthStore } from "@/lib/auth";

import WelcomePage from "@/pages/welcome";
import LoginPage from "@/pages/login";
import ChangePasswordPage from "@/pages/change-password";
import Dashboard from "@/pages/dashboard";
import NewSession from "@/pages/new-session";
import SessionLive from "@/pages/session";
import SessionNotes from "@/pages/session-notes";
import HistoryPage from "@/pages/history";
import PricingPage from "@/pages/pricing";
import SettingsPage from "@/pages/settings";
import AdminPage from "@/pages/admin";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // Keep previous data during navigation so pages don't flash empty
      placeholderData: (prev: unknown) => prev,
      retry: (failureCount, error: unknown) => {
        if ((error as { status?: number })?.status === 401) return false;
        return failureCount < 2;
      },
    },
  },
});

function PageTransition({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  // No `mode="wait"`: with mode="wait", the new page only renders AFTER the
  // old one finishes exiting, which combined with React 19 + AnimatePresence
  // occasionally left a blank frame that the user perceived as a permanent
  // white screen (no reload, nothing visible). Letting the new page render
  // immediately fixes that — a brief crossfade is fine.
  return (
    <AnimatePresence initial={false}>
      {/* h-full + overflow-y-auto: the motion div owns BOTH the page height
          and the page scroll. Pages that fill the viewport (live session)
          use h-full and never scroll — their sticky headers stay pinned no
          matter how long the transcript grows. Pages with long content
          (dashboard, settings) scroll inside this div. The parent <main>
          is overflow-hidden so nothing above this level ever scrolls. */}
      <motion.div
        key={location}
        className="h-full overflow-y-auto"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        style={{ willChange: "opacity, transform" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function AppRouter() {
  const { user } = useAuthStore();

  return (
    <Switch>
      {/* Public — no auth needed */}
      <Route path="/login" component={LoginPage} />
      <Route path="/change-password" component={ChangePasswordPage} />

      {/* Protected routes — wrapped in AuthGate inside Layout */}
      <Route>
        <AuthGate>
          <Layout>
            <ErrorBoundary>
              <PageTransition>
                <Switch>
                  <Route path="/" component={WelcomePage} />
                  <Route path="/dashboard" component={Dashboard} />
                  <Route path="/session/new" component={NewSession} />
                  <Route path="/session/:id/notes" component={SessionNotes} />
                  <Route path="/session/:id" component={SessionLive} />
                  <Route path="/sessions" component={HistoryPage} />
                  {/* Keep the old /history URL working for any existing bookmarks. */}
                  <Route path="/history" component={HistoryPage} />
                  <Route path="/pricing" component={PricingPage} />
                  <Route path="/settings" component={SettingsPage} />
                  {user?.isAdmin && <Route path="/admin" component={AdminPage} />}
                  <Route component={NotFound} />
                </Switch>
              </PageTransition>
            </ErrorBoundary>
          </Layout>
        </AuthGate>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppTourProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AppRouter />
            </WouterRouter>
          </AppTourProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
