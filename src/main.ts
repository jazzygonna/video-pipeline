import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { resolve, dirname, isAbsolute } from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadArticle } from "./article-loader.js";
import { planScenes } from "./scene-planner.js";
import { generateSceneImages } from "./image-generator.js";
import { loadSceneOverrides } from "./scene-overrides.js";
import { applyWatermarkToAll } from "./watermark.js";
import { renderCaptionsToAll } from "./caption-renderer.js";
import { generateVoiceover } from "./voiceover-generator.js";
import { assembleVideo } from "./video-assembler.js";
import { BRAND } from "./brand.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = resolve(PROJECT_ROOT, "output");
const MUSIC_DIR = resolve(PROJECT_ROOT, "music");
const TEXT_MODEL = "gemini-3.5-flash";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

function log(step: number, total: number, message: string): void {
  console.log(`[${step}/${total}] ${message}`);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// A bare filename (e.g. "Kind of Breeze.wav") resolves against the local
// music/ bank; an absolute or slash-containing path is used as-is. With no
// argument at all, falls back to BACKGROUND_MUSIC_PATH from .env.
function resolveMusicPath(musicArg?: string): string | undefined {
  if (!musicArg) return process.env.BACKGROUND_MUSIC_PATH;
  if (isAbsolute(musicArg) || musicArg.includes("/") || musicArg.includes("\\")) {
    return musicArg;
  }
  return resolve(MUSIC_DIR, musicArg);
}

function parseArgs(): {
  filename: string;
  outputPath: string;
  sceneCount?: number;
  musicFile?: string;
} {
  const args = process.argv.slice(2);

  if (!args[0]) {
    console.error("Usage: node dist/main.js <article-filename> [output.mp4] [sceneCount] [musicFile]");
    console.error("Example: node dist/main.js my-post.txt output/video.mp4 10 \"Kind of Breeze.wav\"");
    process.exit(1);
  }

  return {
    filename: args[0],
    outputPath: args[1] ?? resolve(OUTPUT_DIR, `video-${timestamp()}.mp4`),
    sceneCount: args[2] ? parseInt(args[2], 10) : undefined,
    musicFile: args[3],
  };
}

async function generateCaptions(articleText: string, count: number): Promise<string[]> {
  const response = await client.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              `Article:\n\n${articleText}`,
              `Generate exactly ${count} short captions for a short-form video based on this article.`,
              "Each caption is one sentence, 8–12 words, capturing a key point in sequence.",
              "Write for the screen — punchy, plain language, no jargon.",
              "Return valid JSON only, no markdown fences:",
              '{"captions": ["caption 1", "caption 2", ...]}',
            ].join("\n\n"),
          },
        ],
      },
    ],
    config: { temperature: 0.7 },
  });

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  if (!raw) throw new Error("Caption generation returned an empty response");

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Caption generation returned non-JSON:\n${raw}`);
  }

  const captions = (parsed as { captions?: unknown }).captions;

  if (!Array.isArray(captions) || !captions.every((c) => typeof c === "string")) {
    throw new Error(`Caption generation returned malformed data:\n${raw}`);
  }

  if (captions.length !== count) {
    throw new Error(`Expected ${count} captions, got ${captions.length}`);
  }

  return captions as string[];
}

async function main(): Promise<void> {
  const { filename, outputPath, sceneCount, musicFile } = parseArgs();
  const STEPS = 8;

  if (!process.env.GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY environment variable is not set");
    process.exit(1);
  }

  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) {
    console.error("Error: ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID environment variables must be set");
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  log(1, STEPS, `Loading article: ${filename}`);
  const articleText = await loadArticle(filename);
  console.log(`    ${articleText.split(/\s+/).length} words loaded`);

  const sceneOverrides = await loadSceneOverrides(filename);
  const overrideCount = Object.keys(sceneOverrides).length;
  if (overrideCount > 0) {
    console.log(`    ${overrideCount} scene(s) overridden with reference photos`);
  }

  log(2, STEPS, "Planning scenes");
  const plan = await planScenes(articleText, sceneCount, sceneOverrides);
  console.log(`    ${plan.sceneCount} scenes planned`);

  log(3, STEPS, "Generating captions");
  const captions = await generateCaptions(articleText, plan.sceneCount);
  console.log(`    ${captions.length} captions generated`);

  log(4, STEPS, `Generating images with ${BRAND.imageModel.model}`);
  const images = await generateSceneImages(plan.scenes, sceneOverrides);
  console.log(`    ${images.length} images generated`);

  log(5, STEPS, "Applying watermarks");
  const stamped = await applyWatermarkToAll(images);

  log(6, STEPS, "Rendering captions");
  const captioned = await renderCaptionsToAll(stamped, captions);

  log(7, STEPS, "Generating voiceover");
  const voiceoverClips = await generateVoiceover(captions);
  console.log(`    ${voiceoverClips.length} voiceover clips generated`);

  log(8, STEPS, "Assembling video");
  const result = await assembleVideo(captioned, outputPath, voiceoverClips, resolveMusicPath(musicFile));

  console.log("\nDone.");
  console.log(`  Output:   ${result.outputPath}`);
  console.log(`  Duration: ${result.durationSeconds}s (${result.secondsPerScene}s per scene)`);
  console.log(`  Scenes:   ${result.sceneCount}`);
}

main().catch((err) => {
  console.error("\nPipeline failed:", err.message);
  process.exit(1);
});
