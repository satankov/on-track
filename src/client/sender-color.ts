import { ACCENT_FAMILIES, type AccentFamily } from "../domain/validation.js";

function canonicalSender(sender: string): string {
  return sender.normalize("NFKC").trim().toLowerCase();
}

export function senderColor(sender: string): AccentFamily {
  let hash = 0x811c9dc5;
  for (const character of canonicalSender(sender)) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (
    ACCENT_FAMILIES[(hash >>> 0) % ACCENT_FAMILIES.length] ?? ACCENT_FAMILIES[0]
  );
}
