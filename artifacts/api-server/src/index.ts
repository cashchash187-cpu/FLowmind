import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachWsTranscribe } from "./ws/transcribe";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initStripe() {
  try {
    const { runMigrations } = await import("stripe-replit-sync");
    const { getStripeSync } = await import("./stripeClient");

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return;

    await runMigrations({ databaseUrl });
    logger.info("Stripe schema ready");

    const stripeSync = await getStripeSync();

    const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (domains) {
      await stripeSync.findOrCreateManagedWebhook(
        `https://${domains}/api/stripe/webhook`
      );
      logger.info("Stripe webhook configured");
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

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
