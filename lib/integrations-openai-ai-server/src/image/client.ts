import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

// Same env fallback chain as ../client.ts. We MUST NOT throw at module load
// — that would crash the api-server at boot when this module is transitively
// imported from index.ts. Individual calls fail explicitly instead.
const apiKey =
  process.env.LLM_API_KEY ||
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
  process.env.OPENAI_API_KEY;

const baseURL =
  process.env.LLM_BASE_URL ||
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
  undefined;

if (!apiKey) {
  console.warn(
    "[LLM/image] No API key configured — image generation will error until LLM_API_KEY is set.",
  );
}

const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
  apiKey: apiKey ?? "missing-key",
};
if (baseURL) clientOptions.baseURL = baseURL;

export const openai = new OpenAI(clientOptions);

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });
  const base64 = response.data?.[0]?.b64_json ?? "";
  return Buffer.from(base64, "base64");
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      })
    )
  );

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
  });

  const imageBase64 = response.data?.[0]?.b64_json ?? "";
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}
