import { getUncachableStripeClient } from './stripeClient';

/**
 * Creates FlowMind products and prices in Stripe.
 * Idempotent — safe to run multiple times.
 *
 * Run with: pnpm --filter @workspace/scripts exec tsx src/seed-products.ts
 */
async function createProducts() {
  try {
    const stripe = await getUncachableStripeClient();
    console.log('Checking for existing products...');

    // ── Pro Plan ──────────────────────────────────────────────────────────────
    const existing = await stripe.products.search({
      query: "name:'Pro Plan' AND active:'true'",
    });

    if (existing.data.length > 0) {
      console.log(`Pro Plan already exists (${existing.data[0].id}). Skipping.`);
    } else {
      const pro = await stripe.products.create({
        name: 'Pro Plan',
        description: '50 hours/month, unlimited AI requests, advanced notes',
        metadata: { tier: 'pro' },
      });
      console.log(`✓ Created product: ${pro.name} (${pro.id})`);

      const monthly = await stripe.prices.create({
        product: pro.id,
        unit_amount: 2900,
        currency: 'usd',
        recurring: { interval: 'month' },
      });
      console.log(`✓ Monthly price: $29/month (${monthly.id})`);

      const yearly = await stripe.prices.create({
        product: pro.id,
        unit_amount: 29000,
        currency: 'usd',
        recurring: { interval: 'year' },
      });
      console.log(`✓ Yearly price: $290/year (${yearly.id})`);
    }

    console.log('\nDone. Webhooks will sync products to your database automatically.');
  } catch (err: any) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

createProducts();
