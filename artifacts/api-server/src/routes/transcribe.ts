import { Router, type IRouter } from "express";
import multer from "multer";
import { openai, toFile } from "@workspace/integrations-openai-ai-server";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const router: IRouter = Router();

router.post("/sessions/:id/transcribe", upload.single("audio"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  const { language } = req.body as { language?: string };
  const langCode = language && language !== "auto" ? language.split("-")[0] : undefined;

  try {
    const file = await toFile(req.file.buffer, "audio.webm", { type: req.file.mimetype || "audio/webm" });
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
      response_format: "json",
      ...(langCode ? { language: langCode } : {}),
    });
    res.json({ text: transcription.text });
  } catch (err) {
    req.log.error({ err }, "Whisper transcription failed");
    res.status(500).json({ error: "Transcription failed" });
  }
});

export default router;
