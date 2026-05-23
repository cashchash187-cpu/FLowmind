import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { WebhookHandlers } from "./webhookHandlers";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());

// ── Stripe webhook: MUST come BEFORE express.json() ──────────────────────────
// Stripe needs the raw request body as a Buffer for signature verification.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;

    try {
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: any) {
      logger.error({ err }, "Stripe webhook error");
      res.status(400).json({ error: "Webhook processing failed" });
    }
  }
);

// ── Standard middleware ───────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ── Railway-friendly health endpoint (no /api prefix) ─────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Serve the React build (single-origin Railway deploy) ──────────────────────
// The Docker build copies the frontend dist into ./public next to the bundle.
// PUBLIC_DIR can override the path (handy for `node dist/index.mjs` from repo root).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const publicDir = process.env.PUBLIC_DIR
  ? path.resolve(process.env.PUBLIC_DIR)
  : path.resolve(HERE, "public");

if (fs.existsSync(publicDir)) {
  logger.info({ publicDir }, "Serving static frontend");
  app.use(express.static(publicDir, { index: false, maxAge: "1h" }));

  // SPA fallback for any non-/api GET that didn't match a file above.
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res, next) => {
    const indexHtml = path.join(publicDir, "index.html");
    if (!fs.existsSync(indexHtml)) return next();
    res.sendFile(indexHtml);
  });
} else {
  logger.warn({ publicDir }, "Frontend dist not found — serving API only");
}

export default app;
