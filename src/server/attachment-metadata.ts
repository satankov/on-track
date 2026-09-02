function isUnsafeFilenameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127 || character === '"';
}

export function sanitizeAttachmentFilename(
  filename: string | undefined,
): string {
  const leaf = (filename || "attachment").split(/[\\/]/).at(-1) || "attachment";
  const value = [...leaf]
    .map((character) =>
      isUnsafeFilenameCharacter(character) ? "_" : character,
    )
    .join("")
    .trim()
    .slice(0, 255);
  return value || "attachment";
}

export function sanitizeAttachmentMediaType(
  mediaType: string | undefined,
): string {
  const value = [...(mediaType || "application/octet-stream")]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
    .join("")
    .trim()
    .slice(0, 255);
  return value || "application/octet-stream";
}

export function isCanonicalAttachmentFilename(value: string): boolean {
  return sanitizeAttachmentFilename(value) === value;
}

export function isCanonicalAttachmentMediaType(value: string): boolean {
  return sanitizeAttachmentMediaType(value) === value;
}
