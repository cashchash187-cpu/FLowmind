import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CreditCard, CheckCircle2, ExternalLink } from "lucide-react";

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planName?: string;
  price?: string;
  priceId?: string;
}

type Stage = "email" | "loading" | "redirect" | "already" | "error";

export function CheckoutDialog({
  open,
  onOpenChange,
  planName = "Pro",
  price = "$29/month",
}: CheckoutDialogProps) {
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<Stage>("email");
  const [errorMsg, setErrorMsg] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState("");

  const reset = () => {
    setStage("email");
    setErrorMsg("");
    setCheckoutUrl("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;

    setStage("loading");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setStage("error");
        return;
      }

      if (data.alreadySubscribed) {
        setStage("already");
        return;
      }

      if (data.url) {
        setCheckoutUrl(data.url);
        setStage("redirect");
        // Auto-open Stripe checkout
        window.location.href = data.url;
      }
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
      setStage("error");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Upgrade to {planName}
          </DialogTitle>
          <DialogDescription>
            {price} · Cancel anytime · Instant access
          </DialogDescription>
        </DialogHeader>

        {stage === "email" && (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="checkout-email">Your email address</Label>
              <Input
                id="checkout-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Used to link your subscription. You'll complete payment on the secure Stripe checkout page.
              </p>
            </div>
            <Button type="submit" className="w-full gap-2" disabled={!email.includes("@")}>
              <CreditCard className="h-4 w-4" />
              Continue to Payment
            </Button>
          </form>
        )}

        {stage === "loading" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Preparing secure checkout…</p>
          </div>
        )}

        {stage === "redirect" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <div className="text-center space-y-1">
              <p className="font-semibold">Redirecting to Stripe…</p>
              <p className="text-sm text-muted-foreground">
                If the page didn't open,{" "}
                <a
                  href={checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  click here
                  <ExternalLink className="inline h-3 w-3 ml-0.5" />
                </a>
              </p>
            </div>
          </div>
        )}

        {stage === "already" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <div className="text-center space-y-1">
              <p className="font-semibold">You're already subscribed!</p>
              <p className="text-sm text-muted-foreground">
                Your Pro plan is active. Use "Manage Billing" to update payment or cancel.
              </p>
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}

        {stage === "error" && (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              {errorMsg}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Try Again
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
