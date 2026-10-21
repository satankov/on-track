import { extname } from "node:path";

// This bounds native dispatch; it does not validate file contents or sandbox viewers.
const ALLOWED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".flac",
  ".mp4",
  ".mov",
  ".webm",
]);

function isAllowedFilename(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(extname(filename).toLowerCase());
}

export function attachmentOpenPolicy(input: {
  displayFilename: string;
  managedFilename: string;
  mode: number;
  platform: NodeJS.Platform;
}): "available" | "blocked" {
  if (
    !isAllowedFilename(input.displayFilename) ||
    !isAllowedFilename(input.managedFilename)
  ) {
    return "blocked";
  }
  if (input.platform !== "win32" && (input.mode & 0o111) !== 0) {
    return "blocked";
  }
  return "available";
}
