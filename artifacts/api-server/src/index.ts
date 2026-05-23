import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachWsTranscribe } from "./ws/transcribe";

// Railway injects PORT. Locally we fall back to 8080 so `pnpm dev` keeps working
// without ceremony.
const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const host = process.env["HOST"] ?? "0.0.0.0";

async function initStripe() {
  try {
    const { runMigrations } = await import("stripe-replit-sync");
    const { getStripeSync } = await import("./stripeClient");

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return;

    await runMigrations({ databaseUrl });
    logger.info("Stripe schema ready");

    const stripeSync = await getStripeSync();

    const publicDomain =
      process.env.PUBLIC_BASE_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null) ||
      (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : null);
    if (publicDomain) {
      await stripeSync.findOrCreateManagedWebhook(`${publicDomain}/api/stripe/webhook`);
      logger.info({ publicDomain }, "Stripe webhook configured");
    }

    stripeSync.syncBackfill().catch((err) =>
      logger.error({ err }, "Stripe backfill error")
    );
  } catch (err: any) {
    logger.warn({ msg: err.message }, "Stripe not initialised (connect via Integrations tab)");
  }
}

await initStripe();

const { seedDatabase } = await import("./lib/seed");
await seedDatabase();

const { startIdleTicker } = await import("./lib/idle-ticker");
const { startRetentionLoop } = await import("./lib/retention");
startIdleTicker();
startRetentionLoop();

// Create HTTP server so WebSocket can share the same port
const server = http.createServer(app);

// Attach WebSocket transcription endpoint
attachWsTranscribe(server);

server.listen(port, host, () => {
  logger.info({ host, port }, "Server listening");
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
