export const MAX_PICTURE_PREVIEW_BYTES = 12 * 1024 * 1024;
export const MAX_PICTURE_PREVIEW_PIXELS = 24_000_000;

export type PicturePreviewMediaType = "image/png" | "image/jpeg";

export function picturePreviewMediaType(
  filename: string,
): PicturePreviewMediaType | undefined {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return undefined;
  switch (filename.slice(dot + 1).toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
  }
}
