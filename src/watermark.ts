import sharp from "sharp";
import { BRAND } from "./brand.js";
import type { GeneratedImage } from "./image-generator.js";

const TARGET_WIDTH = BRAND.format.width;
const TARGET_HEIGHT = BRAND.format.height;

export interface WatermarkedImage {
  data: Buffer;
  mimeType: "image/png";
  sceneIndex: number;
}

// Watermark font size and padding are proportional to image width
// so the stamp scales correctly regardless of resolution.
const FONT_SIZE_RATIO = 0.038;
const PADDING_RATIO = 0.022;

function buildWatermarkSvg(width: number, height: number): Buffer {
  const { text, opacityPercent } = BRAND.identity.watermark;
  const opacity = opacityPercent / 100;
  const fontSize = Math.round(width * FONT_SIZE_RATIO);
  const padding = Math.round(width * PADDING_RATIO);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <text
    x="${padding}"
    y="${padding + fontSize}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${fontSize}"
    font-weight="600"
    letter-spacing="0.04em"
    fill="white"
    fill-opacity="${opacity}"
  >${text}</text>
</svg>`;

  return Buffer.from(svg);
}

export async function applyWatermark(image: GeneratedImage): Promise<WatermarkedImage> {
  // Normalize to target dimensions first so all downstream compositing math
  // is guaranteed to operate on a 1080×1920 canvas regardless of what the
  // image API returned.
  const normalized = await sharp(image.data)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "cover", position: "centre" })
    .toBuffer();

  const data = await sharp(normalized)
    .composite([{ input: buildWatermarkSvg(TARGET_WIDTH, TARGET_HEIGHT), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return { data, mimeType: "image/png", sceneIndex: image.sceneIndex };
}


export async function applyWatermarkToAll(
  images: GeneratedImage[]
): Promise<WatermarkedImage[]> {
  return Promise.all(images.map(applyWatermark));
}
