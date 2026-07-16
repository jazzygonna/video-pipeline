import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegBin = require("ffmpeg-static") as string;
const execFileAsync = promisify(execFile);
import { BRAND } from "./brand.js";
import type { CaptionedImage } from "./caption-renderer.js";
import type { VoiceoverClip } from "./voiceover-generator.js";

// Gap held on each frame after its voiceover clip finishes, so a scene
// doesn't cut the instant the line stops — video and audio timelines both
// get this pad per scene, so they stay in sync end to end.
const SCENE_PAD_SECONDS = 0.4;
const BACKGROUND_MUSIC_VOLUME = 0.15;

export interface VideoResult {
  outputPath: string;
  durationSeconds: number;
  sceneCount: number;
  secondsPerScene: number;
}

async function runFfmpeg(args: string[]): Promise<void> {
  if (!ffmpegBin) throw new Error("ffmpeg-static did not resolve a binary path");
  try {
    await execFileAsync(ffmpegBin, args);
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`ffmpeg failed:\n${(e.stderr ?? e.message ?? String(err)).slice(-2000)}`);
  }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

export async function assembleVideo(
  images: CaptionedImage[],
  outputPath: string,
  voiceoverClips: VoiceoverClip[],
  backgroundMusicPath?: string
): Promise<VideoResult> {
  const { min, max } = BRAND.format.sceneCount;

  if (images.length < min || images.length > max) {
    throw new RangeError(`Expected ${min}–${max} scenes, got ${images.length}`);
  }

  if (voiceoverClips.length !== images.length) {
    throw new Error(
      `Voiceover clip count (${voiceoverClips.length}) does not match image count (${images.length})`
    );
  }

  const sortedImages = [...images].sort((a, b) => a.sceneIndex - b.sceneIndex);
  const sortedClips = [...voiceoverClips].sort((a, b) => a.sceneIndex - b.sceneIndex);

  const sceneDurations = sortedClips.map((c) => c.durationSeconds + SCENE_PAD_SECONDS);
  const totalDuration = sceneDurations.reduce((sum, d) => sum + d, 0);

  const tmpDir = await mkdtemp(join(tmpdir(), "video-pipeline-"));

  try {
    // Write frames to disk in parallel.
    const framePaths = await Promise.all(
      sortedImages.map(async (img, i) => {
        const p = join(tmpDir, `frame-${String(i).padStart(4, "0")}.png`);
        await writeFile(p, img.data);
        return toPosix(p);
      })
    );

    // Write voiceover clips to disk in parallel.
    const audioPaths = await Promise.all(
      sortedClips.map(async (clip, i) => {
        const p = join(tmpDir, `voice-${String(i).padStart(4, "0")}.mp3`);
        await writeFile(p, clip.data);
        return toPosix(p);
      })
    );

    // Build the concat demuxer input file for the silent video, one duration
    // per scene matched to that scene's voiceover length (+ pad).
    // The last file is listed twice — without a trailing duration entry ffmpeg
    // drops the final frame when using the concat demuxer.
    const concatLines: string[] = [];
    for (let i = 0; i < framePaths.length; i++) {
      concatLines.push(`file '${framePaths[i]}'`);
      concatLines.push(`duration ${sceneDurations[i].toFixed(6)}`);
    }
    concatLines.push(`file '${framePaths[framePaths.length - 1]}'`);

    const concatFile = toPosix(join(tmpDir, "concat.txt"));
    await writeFile(concatFile, concatLines.join("\n"), "utf-8");

    const { width, height } = BRAND.format;
    const silentVideoPath = toPosix(join(tmpDir, "silent.mp4"));

    await runFfmpeg([
      "-f", "concat",
      "-safe", "0",
      "-i", concatFile,
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-y",
      silentVideoPath,
    ]);

    // Mux the silent video with the padded, concatenated voiceover track and,
    // if provided, background music ducked underneath it.
    const inputArgs = ["-i", silentVideoPath, ...audioPaths.flatMap((p) => ["-i", p])];

    const padFilters = audioPaths
      .map((_, i) => `[${i + 1}:a]apad=pad_dur=${SCENE_PAD_SECONDS}[a${i}]`)
      .join(";");
    const concatLabels = audioPaths.map((_, i) => `[a${i}]`).join("");
    const voiceConcat = `${concatLabels}concat=n=${audioPaths.length}:v=0:a=1[voice]`;

    let filterComplex: string;
    let audioMapLabel: string;

    if (backgroundMusicPath) {
      const musicInputIndex = audioPaths.length + 1;
      inputArgs.push("-stream_loop", "-1", "-i", toPosix(backgroundMusicPath));
      const bgFilter = `[${musicInputIndex}:a]volume=${BACKGROUND_MUSIC_VOLUME},atrim=0:${totalDuration.toFixed(6)},asetpts=PTS-STARTPTS[bg]`;
      const mixFilter = `[voice][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`;
      filterComplex = [padFilters, voiceConcat, bgFilter, mixFilter].join(";");
      audioMapLabel = "[aout]";
    } else {
      filterComplex = [padFilters, voiceConcat].join(";");
      audioMapLabel = "[voice]";
    }

    await runFfmpeg([
      ...inputArgs,
      "-filter_complex", filterComplex,
      "-map", "0:v",
      "-map", audioMapLabel,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-shortest",
      "-y",
      toPosix(outputPath),
    ]);

    return {
      outputPath,
      durationSeconds: parseFloat(totalDuration.toFixed(2)),
      sceneCount: sortedImages.length,
      secondsPerScene: parseFloat((totalDuration / sortedImages.length).toFixed(2)),
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
