import { useState } from "react";
import { Check, Mail, Zap, Shield, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckoutDialog } from "@/components/checkout-dialog";
import { motion } from "framer-motion";

const CONTACT_EMAIL = "cashchash187@gmail.com";
const CONTACT_SUBJECT = "FlowMind Business Inquiry";

function openContactSales() {
  window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(CONTACT_SUBJECT)}&body=${encodeURIComponent(
    "Hi,\n\nI'm interested in the FlowMind Business plan for my team. Could you provide more information?\n\nName:\nCompany:\nTeam size:\n"
  )}`;
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.2 } }
};

const cardAnim = {
  hidden: { opacity: 0, y: 36, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring" as const, stiffness: 260, damping: 22 } }
};

export default function PricingPage() {
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const tiers = [
    {
      name: "Free",
      description: "Basic AI assistance for occasional meetings.",
      price: "$0",
      period: "forever",
      features: [
        "1 hour audio / month",
        "20 AI requests / month",
        "3-day history retention",
        "1 active session",
        "Copilot mode",
        "Memory: 20 Notizen",
      ],
      action: null as null,
      buttonText: "Current Plan",
      highlighted: false,
      accentColor: "text-muted-foreground",
    },
    {
      name: "Pro",
      description: "For professionals who live in high-stakes meetings.",
      price: "$29",
      period: "per month",
      features: [
        "25 hours audio / month",
        "1,000 AI requests / month",
        "Unlimited history",
        "Insight mode unlocked",
        "Memory: unbegrenzt + Ask your Memory",
        "Meeting → Memory: Aufgaben & Fakten automatisch",
        "Pro real-time AI transcription (higher accuracy)",
      ],
      action: "checkout" as const,
      buttonText: "Upgrade to Pro",
      highlighted: true,
      accentColor: "text-primary",
    },
    {
      name: "Business",
      description: "Shared intelligence for high-performance teams.",
      price: "$99",
      period: "per month",
      features: [
        "120 hours audio / month",
        "10,000 AI requests / month",
        "Team workspace (preview)",
        "10 concurrent sessions",
        "Pro real-time AI transcription (higher accuracy)",
        "Priority support",
      ],
      action: "contact" as const,
      buttonText: "Contact Sales",
      highlighted: false,
      accentColor: "text-violet-500",
    },
  ];

  return (
    <>
      <div className="relative overflow-hidden">
        {/* Ambient glows */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-primary/8 rounded-full blur-[100px]" />
          <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-violet-500/5 rounded-full blur-[100px]" />
        </div>

        <div className="relative z-10 p-6 md:p-8 max-w-6xl mx-auto space-y-14 py-10 lg:py-16">

          {/* ── Hero ─────────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            className="text-center max-w-3xl mx-auto space-y-5"
          >
            <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary rounded-full px-4 py-1.5 mb-2">
              <Zap className="h-4 w-4" />
              <span className="text-xs uppercase font-mono font-bold tracking-widest">Unlock Your Edge</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-none text-foreground">
              Invest in your<br />
              <span className="text-primary">unfair advantage.</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
              Choose the plan that fits your meeting cadence. Upgrade anytime, no lock-in.
            </p>
          </motion.div>

          {/* ── Cards ────────────────────────────────────────────────────── */}
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid md:grid-cols-3 gap-6 lg:gap-8 items-stretch"
          >
            {tiers.map((tier) => (
              <motion.div
                key={tier.name}
                variants={cardAnim}
                whileHover={{ y: -6, transition: { duration: 0.2 } }}
                className={`h-full ${tier.highlighted ? "md:-mt-6" : ""}`}
              >
                <Card className={`relative flex flex-col h-full rounded-3xl overflow-hidden transition-shadow duration-300 ${
                  tier.highlighted
                    ? "border-primary/50 shadow-2xl shadow-primary/15 bg-card ring-1 ring-primary/25"
                    : "border-border/60 bg-card/70 hover:shadow-lg hover:border-border"
                }`}>
                  {/* Pro: gradient top bar */}
                  {tier.highlighted && (
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
                  )}

                  {/* Pro: popular badge */}
                  {tier.highlighted && (
                    <div className="absolute top-4 right-4">
                      <span className="bg-primary text-primary-foreground text-[10px] uppercase font-mono tracking-widest px-3 py-1 rounded-full font-bold shadow-md shadow-primary/30">
                        Most Popular
                      </span>
                    </div>
                  )}

                  <CardHeader className="pt-8 px-7 pb-4">
                    <div className={`text-xs font-mono uppercase tracking-widest font-bold mb-3 ${tier.accentColor}`}>
                      {tier.name}
                    </div>
                    <div className="flex items-baseline gap-2 mb-3">
                      <span className="text-5xl font-black font-mono tracking-tighter text-foreground">{tier.price}</span>
                      <span className="text-sm text-muted-foreground font-medium">{tier.period}</span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{tier.description}</p>
                  </CardHeader>

                  <CardContent className="flex-1 px-7 pb-6">
                    <div className="border-t border-border/50 pt-5">
                      <ul className="space-y-3.5">
                        {tier.features.map((feature, i) => (
                          <motion.li
                            key={i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.4 + i * 0.06 }}
                            className="flex items-start gap-3"
                          >
                            <div className={`p-0.5 rounded-full mt-0.5 shrink-0 ${tier.highlighted ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                              <Check className="h-3 w-3" />
                            </div>
                            <span className="text-sm text-foreground/80 font-medium leading-relaxed">{feature}</span>
                          </motion.li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>

                  <CardFooter className="px-7 pb-8 pt-2">
                    {tier.action === "checkout" ? (
                      <motion.div className="w-full" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                        <Button
                          className="w-full font-bold tracking-wide h-13 rounded-xl shadow-lg shadow-primary/25 gap-2"
                          size="lg"
                          onClick={() => setCheckoutOpen(true)}
                          data-testid="button-upgrade-pro"
                        >
                          {tier.buttonText} <ArrowRight className="h-4 w-4" />
                        </Button>
                      </motion.div>
                    ) : tier.action === "contact" ? (
                      <motion.div className="w-full" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                        <Button
                          className="w-full font-bold tracking-wide h-13 gap-2 rounded-xl"
                          variant="outline"
                          size="lg"
                          onClick={openContactSales}
                          data-testid="button-contact-sales"
                        >
                          <Mail className="h-4 w-4" />
                          {tier.buttonText}
                        </Button>
                      </motion.div>
                    ) : (
                      <Button
                        className="w-full font-bold tracking-wide h-13 rounded-xl"
                        variant="outline"
                        size="lg"
                        disabled
                        data-testid="button-current-plan"
                      >
                        {tier.buttonText}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              </motion.div>
            ))}
          </motion.div>

          {/* ── Trust footer ─────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-6 border-t border-border/40 text-sm text-muted-foreground"
          >
            <div className="flex items-center gap-2 font-medium">
              <Shield className="h-4 w-4 text-primary" />
              14-day free trial, no credit card required
            </div>
            <div className="hidden sm:block w-px h-4 bg-border/60" />
            <div className="font-medium">
              Payments by <span className="font-bold text-foreground">Stripe</span>
            </div>
            <div className="hidden sm:block w-px h-4 bg-border/60" />
            <div className="font-medium">Cancel anytime</div>
          </motion.div>
        </div>
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
