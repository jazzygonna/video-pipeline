import { GoogleGenAI } from "@google/genai";
import { BRAND, buildImagePrompt } from "./brand.js";
import { loadReferencePhoto, type SceneOverrides } from "./scene-overrides.js";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
  promptUsed: string;
  sceneIndex: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithRetry(
  prompt: string,
  sceneIndex: number,
  referencePhoto?: { data: Buffer; mimeType: string }
): Promise<GeneratedImage> {
  const { model, responseModalities, delayBetweenCallsMs, maxRetries } = BRAND.imageModel;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
        { text: prompt },
      ];

      if (referencePhoto) {
        parts.push({
          inlineData: {
            data: referencePhoto.data.toString("base64"),
            mimeType: referencePhoto.mimeType,
          },
        });
      }

      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          responseModalities: [...responseModalities],
          imageConfig: { aspectRatio: BRAND.format.aspectRatio },
        },
      });

      const responseParts = response.candidates?.[0]?.content?.parts ?? [];
      const imagePart = responseParts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));

      if (!imagePart?.inlineData?.data) {
        throw new Error(`No image data in response (attempt ${attempt}/${maxRetries})`);
      }

      return {
        data: Buffer.from(imagePart.inlineData.data, "base64"),
        mimeType: imagePart.inlineData.mimeType ?? "image/png",
        promptUsed: prompt,
        sceneIndex,
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(delayBetweenCallsMs);
      }
    }
  }

  throw new Error(
    `Image generation failed for scene ${sceneIndex} after ${maxRetries} attempts: ${lastError}`
  );
}

// Generate a single image from a raw scene description.
// The description is passed through buildImagePrompt before being sent,
// so callers should not pre-apply brand context.
//
// Pass referencePhoto to run in "ai-with-photo" mode: the photo is attached
// to the request and the prompt is built to preserve her likeness instead of
// following the faceless brand style.
export async function generateImage(
  sceneDescription: string,
  sceneIndex = 0,
  referencePhoto?: { data: Buffer; mimeType: string }
): Promise<GeneratedImage> {
  const prompt = buildImagePrompt(sceneDescription, { includePerson: !!referencePhoto });
  return callWithRetry(prompt, sceneIndex, referencePhoto);
}

// Generate one image per scene in sequence, with the configured inter-call
// delay between each request. Throws on the first scene that exhausts retries.
//
// overrides is keyed by 1-indexed scene number:
// - "real-photo": the reference photo is used directly, no AI call is made.
// - "ai-with-photo": the reference photo is attached to the generation call.
// Scenes with no override are generated as plain AI images (unchanged).
export async function generateSceneImages(
  sceneDescriptions: string[],
  overrides: SceneOverrides = {}
): Promise<GeneratedImage[]> {
  const { sceneCount } = BRAND.format;

  if (
    sceneDescriptions.length < sceneCount.min ||
    sceneDescriptions.length > sceneCount.max
  ) {
    throw new RangeError(
      `Expected ${sceneCount.min}–${sceneCount.max} scenes, got ${sceneDescriptions.length}`
    );
  }

  const results: GeneratedImage[] = [];

  for (let i = 0; i < sceneDescriptions.length; i++) {
    const sceneNumber = i + 1;
    const override = overrides[sceneNumber];

    if (override?.mode === "real-photo") {
      const photo = await loadReferencePhoto(override.photo);
      results.push({
        data: photo.data,
        mimeType: photo.mimeType,
        promptUsed: `[real photo] ${override.photo}`,
        sceneIndex: i,
      });
      continue;
    }

    if (i > 0) {
      await sleep(BRAND.imageModel.delayBetweenCallsMs);
    }

    const referencePhoto =
      override?.mode === "ai-with-photo" ? await loadReferencePhoto(override.photo) : undefined;

    results.push(await generateImage(sceneDescriptions[i], i, referencePhoto));
  }

  return results;
}
