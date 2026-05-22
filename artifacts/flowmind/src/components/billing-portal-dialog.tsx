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
import { Loader2, CreditCard, ExternalLink } from "lucide-react";

interface BillingPortalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Stage = "email" | "loading" | "redirect" | "not-found" | "error";

export function BillingPortalDialog({ open, onOpenChange }: BillingPortalDialogProps) {
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<Stage>("email");
  const [errorMsg, setErrorMsg] = useState("");
  const [portalUrl, setPortalUrl] = useState("");

  const reset = () => {
    setStage("email");
    setErrorMsg("");
    setPortalUrl("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;

    setStage("loading");
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (res.status === 404) {
        setStage("not-found");
        return;
      }

      if (!res.ok) {
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setStage("error");
        return;
      }

      if (data.url) {
        setPortalUrl(data.url);
        setStage("redirect");
        window.location.href = data.url;
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
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
            Manage Billing
          </DialogTitle>
          <DialogDescription>
            View your subscription, update payment, or cancel.
          </DialogDescription>
        </DialogHeader>

        {stage === "email" && (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="portal-email">Email used when subscribing</Label>
              <Input
                id="portal-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full gap-2" disabled={!email.includes("@")}>
              <CreditCard className="h-4 w-4" />
              Open Billing Portal
            </Button>
          </form>
        )}

        {stage === "loading" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Opening billing portal…</p>
          </div>
        )}

        {stage === "redirect" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="text-center space-y-1">
              <p className="font-semibold">Redirecting to Stripe Billing…</p>
              <p className="text-sm text-muted-foreground">
                If the page didn't open,{" "}
                <a
                  href={portalUrl}
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

        {stage === "not-found" && (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-700 dark:text-amber-400">
              No subscription found for this email. If you've subscribed, make sure you're using the same email address.
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Try a Different Email
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
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
