import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ThemeProvider } from "./theme-provider";
import { LayoutDashboard, History, Settings, CreditCard, Plus, Mic, Moon, Sun, Menu, X, ShieldCheck, LogOut, Home } from "lucide-react";
import { useTheme } from "./theme-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { motion } from "framer-motion";
import { useAuthStore } from "@/lib/auth";
import { apiFetch } from "@/lib/auth";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      data-testid="button-theme-toggle"
      className="text-sidebar-foreground hover:text-foreground relative overflow-hidden rounded-full w-9 h-9 hover:bg-sidebar-accent"
    >
      <motion.div
        initial={false}
        animate={{ scale: theme === "dark" ? 0 : 1, rotate: theme === "dark" ? -90 : 0, opacity: theme === "dark" ? 0 : 1 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 flex items-center justify-center"
      >
        <Sun className="h-4 w-4" />
      </motion.div>
      <motion.div
        initial={false}
        animate={{ scale: theme === "dark" ? 1 : 0, rotate: theme === "dark" ? 0 : 90, opacity: theme === "dark" ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 flex items-center justify-center"
      >
        <Moon className="h-4 w-4" />
      </motion.div>
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { user, clearAuth } = useAuthStore();

  const navItems = [
    { href: "/", label: "Home", icon: Home, testId: "link-nav-home" },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "link-nav-dashboard" },
    { href: "/sessions", label: "Sessions", icon: History, testId: "link-nav-history" },
    { href: "/settings", label: "Settings", icon: Settings, testId: "link-nav-settings" },
    { href: "/pricing", label: "Pricing", icon: CreditCard, testId: "link-nav-pricing" },
    ...(user?.isAdmin ? [{ href: "/admin", label: "Admin", icon: ShieldCheck, testId: "link-nav-admin" }] : []),
  ];

  async function handleLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {}
    clearAuth();
    onNavigate?.();
  }

  return (
    <nav className="grid items-start text-sm font-medium gap-2">
      <Link href="/session/new" onClick={onNavigate} data-testid="link-new-session">
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
          <Button className="w-full justify-start gap-3 mb-5 h-11 px-4 rounded-xl font-semibold tracking-wide shadow-lg shadow-primary/20 border border-primary/20" variant="default">
            <Plus className="h-4 w-4" />
            New Session
          </Button>
        </motion.div>
      </Link>
      <div className="space-y-0.5">
        {navItems.map((item) => {
          const isActive = item.href === "/" ? location === "/" : location === item.href || location.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              data-testid={item.testId}
              className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors group ${
                isActive
                  ? "text-primary font-semibold"
                  : "text-sidebar-foreground hover:text-sidebar-accent-foreground"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="active-nav-bg"
                  className="absolute inset-0 bg-primary/10 dark:bg-primary/15 rounded-xl border border-primary/20"
                  initial={false}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
              )}
              <item.icon className={`h-4 w-4 relative z-10 transition-colors shrink-0 ${isActive ? "text-primary" : "group-hover:text-sidebar-accent-foreground"}`} />
              <span className="relative z-10">{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId="active-nav-dot"
                  className="absolute right-3 w-1.5 h-1.5 rounded-full bg-primary"
                  initial={false}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </div>

      {/* User display + logout */}
      {user && (
        <div className="mt-4 pt-4 border-t border-sidebar-border/60">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/30 mb-1">
            <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate">{user.displayName}</div>
              <div className="text-[10px] text-muted-foreground capitalize">{user.plan}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-xl transition-colors"
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}

function SidebarLogo() {
  return (
    <Link href="/" className="flex items-center gap-3 group" data-testid="link-logo">
      <div className="relative">
        <div className="bg-primary/15 p-2 rounded-xl text-primary group-hover:bg-primary/25 transition-all duration-300 group-hover:shadow-md group-hover:shadow-primary/20">
          <Mic className="h-5 w-5" />
        </div>
        <div className="absolute -inset-0.5 rounded-xl bg-primary/20 opacity-0 group-hover:opacity-100 blur-md transition-opacity duration-300" />
      </div>
      <span className="font-bold tracking-tight text-xl text-sidebar-accent-foreground group-hover:text-foreground transition-colors">
        Flow<span className="text-primary">Mind</span>
      </span>
    </Link>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ThemeProvider defaultTheme="dark" storageKey="flowmind-theme">
      {/* Wave 18b: pinned to the SMALLEST possible viewport (`100svh`) so
          the bottom mobile bar always sits flush with the visible area
          regardless of Safari's address-bar / toolbar state. Earlier
          attempt with `100dvh` left ~200 px of unused dark space below
          the buttons on iPhone because dvh accounted for the toolbar
          being hidden even when it was still visible. svh = the
          guaranteed-visible minimum, no overflow tricks. Tradeoff: when
          the toolbar auto-hides on scroll, that newly-revealed space
          stays unused — fine for our chrome-mostly-visible UX. */}
      <div className="flex h-[100svh] w-full overflow-hidden bg-background text-foreground font-sans">

        {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
        <aside className="fixed inset-y-0 left-0 z-10 w-64 flex-col border-r border-sidebar-border bg-sidebar hidden md:flex shadow-xl shadow-black/5 overflow-hidden">
          {/* Subtle decorative gradient at top */}
          <div className="absolute top-0 inset-x-0 h-48 bg-gradient-to-b from-primary/8 to-transparent pointer-events-none" />
          <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-t from-primary/5 to-transparent pointer-events-none" />

          <div className="flex h-16 items-center px-6 mt-2 mb-2 relative z-10">
            <SidebarLogo />
          </div>

          <div className="flex-1 overflow-auto py-2 px-4 relative z-10">
            <NavItems />
          </div>

          <div className="mt-auto p-4 border-t border-sidebar-border bg-sidebar/50 relative z-10">
            <div className="flex items-center justify-between px-2">
              <span className="text-[10px] text-sidebar-foreground/60 font-mono uppercase tracking-widest font-semibold">v0.1.0</span>
              <ThemeToggle />
            </div>
          </div>
        </aside>

        {/* ── Mobile top bar ───────────────────────────────────────────────── */}
        {/* pt comes from env(safe-area-inset-top) so the iOS Dynamic Island /
            notch never overlaps the logo/menu icons. The container height
            (h-14) plus that padding visually scales on notched devices. */}
        <div
          className="fixed top-0 left-0 right-0 z-20 h-14 border-b border-sidebar-border bg-sidebar/95 backdrop-blur-xl flex items-center justify-between px-4 md:hidden shadow-sm"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <SidebarLogo />
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="w-9 h-9 rounded-xl hover:bg-sidebar-accent text-sidebar-foreground" data-testid="button-mobile-menu">
                  <motion.div
                    animate={{ rotate: mobileOpen ? 90 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                  </motion.div>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0 flex flex-col bg-sidebar border-r border-sidebar-border overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-40 bg-gradient-to-b from-primary/10 to-transparent pointer-events-none" />
                <div className="flex h-14 items-center px-6 border-b border-sidebar-border relative z-10">
                  <SidebarLogo />
                </div>
                <div className="flex-1 overflow-auto py-6 px-4 relative z-10">
                  <NavItems onNavigate={() => setMobileOpen(false)} />
                </div>
                <div className="p-4 border-t border-sidebar-border relative z-10">
                  <span className="text-[10px] text-sidebar-foreground/60 font-mono uppercase tracking-widest font-semibold pl-2">v0.1.0</span>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        {/* min-h-0 is REQUIRED on the flex parent so the child <main> can
            properly own its own scroll instead of stretching the body. */}
        <div className="flex flex-1 flex-col min-w-0 min-h-0 md:pl-64">
          {/* Spacer height = h-14 (56 px) + iOS Dynamic Island / notch
              safe-area-inset-top, so the spacer exactly matches the visual
              height of the fixed mobile top bar (which also pads itself by
              that inset). Without the inset added here the session header
              would shift up under the notch on notched iPhones. */}
          <div
            className="md:hidden flex-none"
            style={{ height: "calc(3.5rem + env(safe-area-inset-top))" }}
          />
          {/* Wave 19: overflow-HIDDEN — the page-transition wrapper inside
              (App.tsx PageTransition) now owns the vertical scroll with
              h-full + overflow-y-auto. Keeping main un-scrollable means a
              full-viewport page like the live session can NEVER be pushed
              out of view by its own growing content. */}
          <main className="flex-1 min-w-0 min-h-0 relative z-0 overflow-hidden">
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
