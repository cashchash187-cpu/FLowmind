import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Queries Stripe data from the stripe.* schema tables managed by stripe-replit-sync.
 * Never write to stripe.* tables directly — only query.
 */
export class StripeStorage {
  async findCustomerByEmail(email: string) {
    const result = await db.execute(
      sql`SELECT id, email FROM stripe.customers WHERE email = ${email} AND deleted = false LIMIT 1`
    );
    return result.rows[0] as { id: string; email: string } | undefined;
  }

  async getActiveSubscriptionForCustomer(customerId: string) {
    const result = await db.execute(
      sql`
        SELECT id, status, current_period_end, cancel_at_period_end
        FROM stripe.subscriptions
        WHERE customer = ${customerId}
          AND status IN ('active', 'trialing')
        ORDER BY created DESC
        LIMIT 1
      `
    );
    return result.rows[0] as {
      id: string;
      status: string;
      current_period_end: number;
      cancel_at_period_end: boolean;
    } | undefined;
  }

  async getProPriceId(): Promise<string | null> {
    const result = await db.execute(
      sql`
        SELECT pr.id
        FROM stripe.prices pr
        JOIN stripe.products p ON p.id = pr.product
        WHERE p.name = 'Pro Plan'
          AND p.active = true
          AND pr.active = true
          AND pr.recurring IS NOT NULL
        ORDER BY pr.unit_amount ASC
        LIMIT 1
      `
    );
    const row = result.rows[0] as { id: string } | undefined;
    return row?.id ?? null;
  }

  async listActivePricesWithProducts() {
    const result = await db.execute(
      sql`
        SELECT
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring
        FROM stripe.products p
        JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY pr.unit_amount ASC
      `
    );
    return result.rows as {
      product_id: string;
      product_name: string;
      product_description: string;
      price_id: string;
      unit_amount: number;
      currency: string;
      recurring: { interval: string } | null;
    }[];
  }
}

export const stripeStorage = new StripeStorage();
