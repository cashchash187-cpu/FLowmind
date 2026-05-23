import { Router } from "express";
import { logger } from "../lib/logger";
import { isResearchAvailable } from "../lib/research-provider";

const router = Router();

router.get("/config", async (req, res) => {
  let stripeAvailable = false;
  let devBanner: string | null = null;

  try {
    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();
    const prices = await stripe.prices.list({ active: true, limit: 1 });
    stripeAvailable = prices.data.length > 0;
  } catch {
    devBanner = "Stripe not connected — set STRIPE_SECRET_KEY (and optionally STRIPE_WEBHOOK_SECRET).";
  }

  const googleAuthAvailable = !!process.env.GOOGLE_CLIENT_ID;
  const researchAvailable = isResearchAvailable();

  if (!researchAvailable) {
    const msg = "Live research not configured — set TAVILY_API_KEY.";
    devBanner = devBanner ? `${devBanner} | ${msg}` : msg;
  }

  res.json({
    stripeAvailable,
    googleAuthAvailable,
    researchAvailable,
    appVersion: "0.1.0",
    devBanner,
  });
});

export default router;
