import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import configRouter from "./config";
import sessionsRouter from "./sessions";
import transcriptsRouter from "./transcripts";
import notesRouter from "./notes";
import aiRouter from "./ai";
import usageRouter from "./usage";
import stripeRouter from "./stripe";
import transcribeRouter from "./transcribe";
import accountRouter from "./account";
import adminRouter from "./admin";
import researchRouter from "./research";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

// 1. Health — always public
router.use(healthRouter);

// 2. Auth — no requireAuth
router.use(authRouter);

// 3. Config — public
router.use(configRouter);

// 4. Stripe — Stripe manages its own auth (webhook uses raw body in app.ts)
router.use(stripeRouter);

// 5. All data routes require authentication
router.use(requireAuth);

// 6. Authed routes
router.use(accountRouter);
router.use(sessionsRouter);
router.use(transcriptsRouter);
router.use(notesRouter);
router.use(aiRouter);
router.use(usageRouter);
router.use(transcribeRouter);
router.use(researchRouter);

// 7. Admin routes (admin-only after requireAuth)
router.use(requireAdmin);
router.use(adminRouter);

export default router;
