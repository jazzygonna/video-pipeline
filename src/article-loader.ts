import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = join(PROJECT_ROOT, "content");

// Substack boilerplate markers that appear at the end of exported posts.
// Matched against the start of each paragraph (trimmed), case-insensitive.
const BOILERPLATE_MARKERS = [
  /^subscribe\b/i,
  /^share\s+this\s+post/i,
  /^leave\s+a\s+comment/i,
  /^thanks\s+for\s+reading/i,
  /^if\s+you\s+(found|enjoyed|liked)\s+this/i,
  /^upgrade\s+to\s+paid/i,
  /^get\s+more\s+from\b/i,
  /^this\s+post\s+is\s+for\s+(paid\s+)?subscribers/i,
  /^already\s+a\s+(paid\s+)?subscriber/i,
  /^unsubscribe\b/i,
  /^manage\s+your\s+subscription/i,
];

function stripBoilerplate(text: string): string {
  const paragraphs = text.split(/\n{2,}/);

  // Walk backwards and drop any trailing paragraphs that are pure boilerplate.
  let cutoff = paragraphs.length;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const para = paragraphs[i].trim();
    if (para === "" || BOILERPLATE_MARKERS.some((re) => re.test(para))) {
      cutoff = i;
    } else {
      break;
    }
  }

  return paragraphs.slice(0, cutoff).join("\n\n").trim();
}

export async function loadArticle(filename: string): Promise<string> {
  const filePath = join(CONTENT_DIR, filename);

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Article not found: ${filePath}`);
    }
    throw err;
  }

  const cleaned = stripBoilerplate(raw);

  if (!cleaned) {
    throw new Error(`Article is empty after stripping boilerplate: ${filename}`);
  }

  return cleaned;
}

// CLI entry point: node dist/article-loader.js <filename>
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const filename = process.argv[2];
  if (!filename) {
    console.error("Usage: node dist/article-loader.js <filename>");
    process.exit(1);
  }
  loadArticle(filename).then(console.log).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
