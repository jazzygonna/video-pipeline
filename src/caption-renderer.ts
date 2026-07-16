import sharp from "sharp";
import type { WatermarkedImage } from "./watermark.js";

// Rendering constants — actual color values for compositing (not prompt descriptions).
const IVORY_WHITE = "rgba(255, 252, 240, 1)";
const GOLD = "rgba(212, 175, 55, 1)";
const BAR_BG = "rgba(10, 8, 12, 0.72)";

const FONT_SIZE_RATIO = 0.042;   // caption font as fraction of image width
const BAR_HEIGHT_RATIO = 0.22;   // caption bar as fraction of image height
const GOLD_STRIPE_RATIO = 0.006; // gold accent stripe as fraction of image height
const SIDE_PADDING_RATIO = 0.06; // horizontal text padding as fraction of image width
// Approximate average character width as a fraction of font size (for line-wrapping).
const CHAR_WIDTH_ESTIMATE = 0.52;

export interface CaptionedImage {
  data: Buffer;
  mimeType: "image/png";
  sceneIndex: number;
}

function wrapText(text: string, charsPerLine: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= charsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // If a single word exceeds the line width, let it overflow rather than break mid-word.
      current = word;
    }
  }
  if (current) lines.push(current);

  return lines;
}

function buildCaptionSvg(
  width: number,
  height: number,
  captionText: string
): Buffer {
  const fontSize = Math.round(width * FONT_SIZE_RATIO);
  const barHeight = Math.round(height * BAR_HEIGHT_RATIO);
  const stripeHeight = Math.round(height * GOLD_STRIPE_RATIO);
  const sidePadding = Math.round(width * SIDE_PADDING_RATIO);
  const barY = height - barHeight;

  const usableWidth = width - sidePadding * 2;
  const charsPerLine = Math.floor(usableWidth / (fontSize * CHAR_WIDTH_ESTIMATE));
  const lines = wrapText(captionText, charsPerLine);

  const lineHeight = Math.round(fontSize * 1.35);
  const totalTextHeight = lines.length * lineHeight;
  const textStartY = barY + stripeHeight + Math.round((barHeight - stripeHeight - totalTextHeight) / 2) + fontSize;

  const textElements = lines
    .map((line, i) => {
      const y = textStartY + i * lineHeight;
      return `<text
      x="${width / 2}"
      y="${y}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${fontSize}"
      font-weight="600"
      letter-spacing="0.02em"
      fill="${IVORY_WHITE}"
      text-anchor="middle"
      dominant-baseline="auto"
    >${line}</text>`;
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <!-- caption bar background -->
  <rect x="0" y="${barY}" width="${width}" height="${barHeight}" fill="${BAR_BG}" />
  <!-- gold accent stripe -->
  <rect x="0" y="${barY}" width="${width}" height="${stripeHeight}" fill="${GOLD}" />
  <!-- caption text -->
  ${textElements}
</svg>`;

  return Buffer.from(svg);
}

export async function renderCaption(
  image: WatermarkedImage,
  captionText: string
): Promise<CaptionedImage> {
  if (!captionText.trim()) {
    throw new Error(`Empty caption text for scene ${image.sceneIndex}`);
  }

  const { width, height } = await sharp(image.data).metadata();

  if (!width || !height) {
    throw new Error(`Could not read dimensions for scene ${image.sceneIndex}`);
  }

  const data = await sharp(image.data)
    .composite([{ input: buildCaptionSvg(width, height, captionText), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return { data, mimeType: "image/png", sceneIndex: image.sceneIndex };
}

export async function renderCaptionsToAll(
  images: WatermarkedImage[],
  captions: string[]
): Promise<CaptionedImage[]> {
  if (images.length !== captions.length) {
    throw new Error(
      `Image count (${images.length}) does not match caption count (${captions.length})`
    );
  }

  return Promise.all(images.map((img, i) => renderCaption(img, captions[i])));
}
