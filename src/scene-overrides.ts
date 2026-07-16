import { readFile } from "node:fs/promises";
import { join, resolve, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = join(PROJECT_ROOT, "content");
const REFERENCE_PHOTOS_DIR = join(PROJECT_ROOT, "reference-photos");

export type SceneMode = "real-photo" | "ai-with-photo";

export interface SceneOverride {
  mode: SceneMode;
  photo: string;
}

// Keyed by 1-indexed scene number, matching what a human would write when
// eyeballing a scene plan (scene 1, scene 2, ...).
export type SceneOverrides = Record<number, SceneOverride>;

function overridesPathFor(articleFilename: string): string {
  const base = basename(articleFilename, extname(articleFilename));
  return join(CONTENT_DIR, `${base}.scenes.json`);
}

// Loads content/<article-basename>.scenes.json if present, e.g.:
// { "3": { "mode": "real-photo", "photo": "janay-hotel.jpg" },
//   "7": { "mode": "ai-with-photo", "photo": "janay-face.jpg" } }
// Scene numbers not listed default to plain AI generation. Returns {} if no
// sidecar file exists for this article.
export async function loadSceneOverrides(articleFilename: string): Promise<SceneOverrides> {
  const overridesPath = overridesPathFor(articleFilename);

  let raw: string;
  try {
    raw = await readFile(overridesPath, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Scene overrides file is not valid JSON: ${overridesPath}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Scene overrides file must be a JSON object: ${overridesPath}`);
  }

  const overrides: SceneOverrides = {};

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const sceneNumber = Number(key);
    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) {
      throw new Error(`Invalid scene number "${key}" in ${overridesPath}`);
    }

    if (
      typeof value !== "object" ||
      value === null ||
      (value as Record<string, unknown>).mode === undefined ||
      (value as Record<string, unknown>).photo === undefined
    ) {
      throw new Error(`Scene ${key} in ${overridesPath} must have "mode" and "photo"`);
    }

    const mode = (value as Record<string, unknown>).mode;
    const photo = (value as Record<string, unknown>).photo;

    if (mode !== "real-photo" && mode !== "ai-with-photo") {
      throw new Error(
        `Scene ${key} in ${overridesPath} has invalid mode "${mode}" (expected "real-photo" or "ai-with-photo")`
      );
    }

    if (typeof photo !== "string" || !photo.trim()) {
      throw new Error(`Scene ${key} in ${overridesPath} has an invalid "photo" value`);
    }

    overrides[sceneNumber] = { mode, photo };
  }

  return overrides;
}

export function resolveReferencePhotoPath(photoFilename: string): string {
  return join(REFERENCE_PHOTOS_DIR, photoFilename);
}

export async function loadReferencePhoto(
  photoFilename: string
): Promise<{ data: Buffer; mimeType: string }> {
  const photoPath = resolveReferencePhotoPath(photoFilename);

  let data: Buffer;
  try {
    data = await readFile(photoPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Reference photo not found: ${photoPath}`);
    }
    throw err;
  }

  const ext = extname(photoFilename).toLowerCase();
  const mimeType =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

  return { data, mimeType };
}
