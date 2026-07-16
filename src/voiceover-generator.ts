import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegBin = require("ffmpeg-static") as string;
const execFileAsync = promisify(execFile);

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "";
const MODEL_ID = "eleven_multilingual_v2";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;

export interface VoiceoverClip {
  data: Buffer;
  mimeType: "audio/mpeg";
  durationSeconds: number;
  sceneIndex: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function synthesize(text: string): Promise<Buffer> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ElevenLabs request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

// Probe duration by running the audio through ffmpeg and parsing stderr —
// ffmpeg-static ships no ffprobe binary, so this avoids adding one.
async function probeDurationSeconds(filePath: string): Promise<number> {
  // "-f null -" exits 0 on success, so the Duration line is read from
  // stderr on the resolved result rather than from a thrown error.
  let stderr: string;
  try {
    const result = await execFileAsync(ffmpegBin, ["-i", filePath, "-f", "null", "-"]);
    stderr = result.stderr;
  } catch (err: unknown) {
    stderr = (err as { stderr?: string }).stderr ?? "";
  }

  const match = stderr.match(/Duration:\s(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
  if (!match) throw new Error(`Could not parse duration from ffmpeg output for ${filePath}`);
  const [, h, m, s] = match;
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s);
}

async function synthesizeWithRetry(text: string, sceneIndex: number): Promise<Buffer> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await synthesize(text);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }

  throw new Error(
    `Voiceover generation failed for scene ${sceneIndex} after ${MAX_RETRIES} attempts: ${lastError}`
  );
}

export async function generateVoiceover(captions: string[]): Promise<VoiceoverClip[]> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY environment variable is not set");
  if (!ELEVENLABS_VOICE_ID) throw new Error("ELEVENLABS_VOICE_ID environment variable is not set");

  const tmpDir = await mkdtemp(join(tmpdir(), "voiceover-probe-"));

  try {
    const clips: VoiceoverClip[] = [];

    for (let i = 0; i < captions.length; i++) {
      const data = await synthesizeWithRetry(captions[i], i);
      const probePath = join(tmpDir, `clip-${i}.mp3`);
      await writeFile(probePath, data);
      const durationSeconds = await probeDurationSeconds(probePath);

      clips.push({ data, mimeType: "audio/mpeg", durationSeconds, sceneIndex: i });
    }

    return clips;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
