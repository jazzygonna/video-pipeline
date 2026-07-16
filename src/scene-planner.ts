import { GoogleGenAI } from "@google/genai";
import { BRAND } from "./brand.js";
import type { SceneOverrides } from "./scene-overrides.js";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

const TEXT_MODEL = "gemini-3.5-flash";

export interface ScenePlan {
  articleText: string;
  sceneCount: number;
  scenes: string[];
}

// personSceneNumbers lists 1-indexed scenes where a real reference photo will
// be composited or attached — those scenes are exempted from the "no people"
// rule and steered toward describing setting/action rather than appearance
// (the photo supplies her actual likeness).
function buildSystemPrompt(sceneCount: number, personSceneNumbers: number[]): string {
  const forbidden = BRAND.visualStyle.forbidden.join(", ");

  const personRule =
    personSceneNumbers.length > 0
      ? `\n\nEXCEPTION — scenes ${personSceneNumbers.join(", ")} must feature the real creator as the subject (a reference photo will be attached separately). For those scenes only: describe the setting, action, mood, and framing around her, but do NOT describe her face, hair, or physical appearance — that comes from the photo, not you. All other scenes still follow the "no people" rule below.`
      : "";

  return `You are a visual scene planner for a luxury short-form video pipeline.

Your job is to read a full article and return exactly ${sceneCount} scene descriptions that visualize the key ideas, themes, and moments from the article. Ground every scene in what the article actually says — do not invent unrelated imagery.

VISUAL STYLE RULES — apply to every scene:
- Style: ${BRAND.visualStyle.aesthetic}
- Feel: ${BRAND.visualStyle.feel}
- Subjects: ${BRAND.visualStyle.subjects}
- Composition: ${BRAND.visualStyle.composition}
- Texture: ${BRAND.visualStyle.texture}
- Reference: ${BRAND.visualStyle.reference}
- Forbidden: ${forbidden}${personRule}

COLOR RULES — do not use hex codes, describe colors in plain English only:
- Background: ${BRAND.palette.background}
- Primary: ${BRAND.palette.primary} for large shapes, gradients, and atmospheric lighting
- Accent: ${BRAND.palette.accent} used sparingly for highlights and one key focal element only — never dominant

SCENE DESCRIPTION RULES:
- Each description is 2–4 sentences
- Describe only what is visually present — objects, environments, lighting, atmosphere
- Never mention text, letters, numbers, signs, logos, or written words
- Never describe people, faces, human figures, or characters of any kind, except in the scenes listed in the EXCEPTION above (if any)
- Vary the subject matter across scenes so the video has visual range
- Each scene should feel distinct but tonally consistent with the others

OUTPUT FORMAT — respond with valid JSON only, no markdown fences, no commentary:
{"scenes": ["scene 1 description", "scene 2 description", ...]}`;
}

function parseScenes(raw: string): string[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Scene planner returned non-JSON output:\n${raw}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).scenes)
  ) {
    throw new Error(`Scene planner JSON missing "scenes" array:\n${raw}`);
  }

  const scenes = (parsed as { scenes: unknown[] }).scenes;

  if (!scenes.every((s) => typeof s === "string")) {
    throw new Error("Scene planner returned non-string entries in scenes array");
  }

  return scenes as string[];
}

export async function planScenes(
  articleText: string,
  sceneCount?: number,
  overrides: SceneOverrides = {}
): Promise<ScenePlan> {
  const { min, max } = BRAND.format.sceneCount;
  const count = sceneCount ?? Math.round((min + max) / 2); // default: 10

  if (count < min || count > max) {
    throw new RangeError(`sceneCount must be between ${min} and ${max}, got ${count}`);
  }

  const personSceneNumbers = Object.keys(overrides)
    .map(Number)
    .filter((n) => n <= count)
    .sort((a, b) => a - b);

  const response = await client.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `Article:\n\n${articleText}\n\nGenerate exactly ${count} scene descriptions based on the article above.` }],
      },
    ],
    config: {
      systemInstruction: buildSystemPrompt(count, personSceneNumbers),
      temperature: 0.9,
    },
  });

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  if (!raw) {
    throw new Error("Scene planner returned an empty response");
  }

  const scenes = parseScenes(raw);

  if (scenes.length !== count) {
    throw new Error(`Expected ${count} scenes, got ${scenes.length}`);
  }

  return { articleText, sceneCount: count, scenes };
}
