// Brand guidelines for @EmpireByJanay short-form video pipeline.
// All color descriptions are plain English — no hex codes anywhere in this file.
// Import this object into every module that touches image generation or rendering.

export const BRAND = {
  identity: {
    handle: "@CurateYourBestLife",
    watermark: {
      text: "@CurateYourBestLife",
      position: "top-left",
      opacityPercent: 40,
    },
  },

  palette: {
    // Every value is a plain-English description, safe to paste into image prompts.
    background: "deep charcoal, nearly black, with subtle atmospheric depth",
    primary: "rich royal purple",
    accent: "warm metallic gold",
    captionText: "warm ivory white",
    captionBar: "warm metallic gold",
  },

  // Enforce in every image prompt: gold is the accent, never the dominant color.
  colorRules: [
    "Background must be deep charcoal, nearly black, with subtle depth.",
    "Primary large shapes, gradients, and atmospheric lighting use rich royal purple.",
    "Warm metallic gold is used sparingly — only for highlights, glow, and one key focal element per scene. Gold is the accent, never dominant.",
    "Never use hex codes. Describe every color in plain English only.",
  ],

  visualStyle: {
    aesthetic: "luxe editorial illustration",
    feel: "rich, layered magazine-style graphic with a premium travel and tech feel",
    subjects: "objects, scenes, landscapes, and symbolic imagery only",
    composition: "cinematic composition with generous negative space",
    texture: "subtle texture and depth",
    reference: "every scene should feel like a spread in a luxury travel magazine",
    forbidden: [
      "no people",
      "no faces",
      "no human figures",
      "no AI avatar characters",
      "no characters of any kind",
    ],
  },

  captions: {
    fontColor: "warm ivory white",
    accentBarColor: "warm metallic gold",
    highlightColor: "warm metallic gold",
  },

  format: {
    targetDurationSeconds: { min: 50, max: 60 },
    sceneCount: { min: 9, max: 11 },
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
  },

  imageModel: {
    model: "gemini-3.1-flash-image",
    endpoint: "generateContent",
    responseModalities: ["IMAGE", "TEXT"] as const,
    delayBetweenCallsMs: 600,
    maxRetries: 3,
  },

  // Append this string to the end of every image prompt, verbatim.
  promptSuffix:
    "CRITICAL: absolutely zero text, numbers, hex codes, or letters anywhere in this image.",

  // Additional rules applied to every image prompt before generation.
  promptRules: [
    "Never describe text, letters, numbers, signs, or logos in any scene.",
    "Never use hex codes — describe every color in plain English only.",
    "Never include people, faces, human figures, or AI avatar characters.",
    "Always end the prompt with the CRITICAL suffix verbatim.",
  ],
} as const;

// Convenience: build a complete image prompt by combining a scene description
// with the global color context, style rules, and required suffix.
//
// Pass includePerson: true when a reference photo of the real creator is
// attached to the request — this drops the "no people" restriction and
// instructs the model to preserve her likeness from the attached photo
// instead of inventing a character.
export function buildImagePrompt(
  sceneDescription: string,
  opts: { includePerson?: boolean } = {}
): string {
  const colorContext = [
    `Background: ${BRAND.palette.background}.`,
    `Primary color: ${BRAND.palette.primary}, used for large shapes, gradients, and atmospheric lighting.`,
    `Accent: ${BRAND.palette.accent}, used sparingly for highlights, glow, and one key focal element only. Never dominant.`,
  ].join(" ");

  const styleContext = opts.includePerson
    ? [
        `Style: ${BRAND.visualStyle.aesthetic}.`,
        `Feel: ${BRAND.visualStyle.feel}.`,
        `Composition: ${BRAND.visualStyle.composition}.`,
        `${BRAND.visualStyle.reference}.`,
        "The attached reference photo shows the real person who must appear in this scene as the subject.",
        "Preserve her actual face, features, and likeness exactly as shown in the reference photo — do not stylize, alter, beautify, or replace her appearance.",
        "Integrate her naturally into the described setting, lighting, and mood; only the environment and atmosphere follow the luxe editorial illustration style, not her.",
      ].join(" ")
    : [
        `Style: ${BRAND.visualStyle.aesthetic}.`,
        `Feel: ${BRAND.visualStyle.feel}.`,
        `Subjects: ${BRAND.visualStyle.subjects}.`,
        `Composition: ${BRAND.visualStyle.composition}.`,
        `${BRAND.visualStyle.reference}.`,
        BRAND.visualStyle.forbidden.join(", ") + ".",
      ].join(" ");

  return [sceneDescription.trim(), colorContext, styleContext, BRAND.promptSuffix]
    .join(" ")
    .trim();
}
