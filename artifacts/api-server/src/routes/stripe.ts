import { Router, type IRouter, type Request, type Response } from "express";
import { getUncachableStripeClient } from "../stripeClient";
import { stripeStorage } from "../stripeStorage";

const router: IRouter = Router();

function getBaseUrl(req: Request): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domains) return `https://${domains}`;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

/**
 * GET /api/stripe/plans
 * Returns active products with prices (for the pricing page to show live Stripe data).
 */
router.get("/stripe/plans", async (_req: Request, res: Response) => {
  try {
    const rows = await stripeStorage.listActivePricesWithProducts();
    res.json({ data: rows });
  } catch (err: any) {
    res.status(503).json({ error: "Stripe not connected", detail: err.message });
  }
});

/**
 * POST /api/stripe/checkout
 * Body: { email: string, priceId?: string }
 * Creates a Stripe Checkout session and returns { url }.
 */
router.post("/stripe/checkout", async (req: Request, res: Response): Promise<void> => {
  const { email, priceId: bodyPriceId } = req.body as { email?: string; priceId?: string };

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required." }); return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const base = getBaseUrl(req);

    // Resolve price ID — use provided one or look up the Pro Plan price
    let priceId = bodyPriceId;
    if (!priceId) {
      priceId = (await stripeStorage.getProPriceId()) ?? undefined;
    }
    if (!priceId) {
      res.status(503).json({ error: "No active Pro Plan price found. Run seed-products first." }); return;
    }

    // Find or create Stripe customer
    let customerId: string;
    const existing = await stripeStorage.findCustomerByEmail(email);
    if (existing) {
      customerId = existing.id;

      // Check if already subscribed
      const activeSub = await stripeStorage.getActiveSubscriptionForCustomer(customerId);
      if (activeSub) {
        res.json({ alreadySubscribed: true, status: activeSub.status }); return;
      }
    } else {
      const customer = await stripe.customers.create({ email });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${base}/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing?checkout=cancelled`,
      customer_email: existing ? undefined : email,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stripe/portal
 * Body: { email: string }
 * Creates a Stripe Customer Portal session and returns { url }.
 */
router.post("/stripe/portal", async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email?: string };

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required." }); return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const base = getBaseUrl(req);

    const customer = await stripeStorage.findCustomerByEmail(email);
    if (!customer) {
      res.status(404).json({
        error: "No account found for this email. Please upgrade first.",
      }); return;
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${base}/settings`,
    });

    res.json({ url: portalSession.url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stripe/subscription?email=...
 * Returns the active subscription for a given email (if any).
 */
router.get("/stripe/subscription", async (req: Request, res: Response): Promise<void> => {
  const { email } = req.query as { email?: string };
  if (!email) { res.json({ subscription: null }); return; }

  try {
    const customer = await stripeStorage.findCustomerByEmail(email);
    if (!customer) { res.json({ subscription: null }); return; }

    const sub = await stripeStorage.getActiveSubscriptionForCustomer(customer.id);
    res.json({ subscription: sub ?? null });
  } catch {
    res.json({ subscription: null });
  }
});

export default router;
