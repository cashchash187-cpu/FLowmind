import { useState } from "react";
import { AlertTriangle, Zap, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckoutDialog } from "@/components/checkout-dialog";

interface UsageLimitBannerProps {
  used: number;
  limit: number;
  planName?: string;
}

/**
 * Shows a contextual upgrade banner inside the session page based on AI usage.
 *
 * - 80–99 %  → amber warning ("running low")
 * - 100 %    → red hard-limit ("upgrade to continue")
 *
 * Returns null when the plan is unlimited or usage is below 80 %.
 */
export function UsageLimitBanner({ used, limit, planName = "free" }: UsageLimitBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Unlimited plan — nothing to show
  if (limit === -1) return null;

  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const isExhausted = used >= limit;
  const isWarning = !isExhausted && pct >= 80;

  // Below threshold or already dismissed (only dismiss-able on warning, not on exhausted)
  if ((!isExhausted && !isWarning) || (dismissed && isWarning)) return null;

  return (
    <>
      <div
        className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all animate-in slide-in-from-top-1 duration-200 ${
          isExhausted
            ? "bg-destructive/10 border-b border-destructive/25 text-destructive"
            : "bg-amber-500/10 border-b border-amber-500/25 text-amber-700 dark:text-amber-400"
        }`}
      >
        {isExhausted ? (
          <Zap className="h-4 w-4 flex-none" />
        ) : (
          <AlertTriangle className="h-4 w-4 flex-none" />
        )}

        <span className="flex-1 min-w-0">
          {isExhausted ? (
            <>
              <strong>AI limit reached</strong> — you've used all {limit} requests on the{" "}
              <span className="capitalize">{planName}</span> plan.
            </>
          ) : (
            <>
              <strong>{used}/{limit}</strong> AI requests used this month — running low.
            </>
          )}
        </span>

        <Button
          size="sm"
          variant={isExhausted ? "destructive" : "outline"}
          className="flex-none h-7 px-3 gap-1.5 text-xs font-mono uppercase tracking-wider shrink-0"
          onClick={() => setCheckoutOpen(true)}
        >
          Upgrade to Pro
          <ArrowRight className="h-3 w-3" />
        </Button>

        {isWarning && (
          <button
            onClick={() => setDismissed(true)}
            className="flex-none text-current/50 hover:text-current transition-colors ml-1"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        planName="Pro"
        price="$29/month"
      />
    </>
  );
}
