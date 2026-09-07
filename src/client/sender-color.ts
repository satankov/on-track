import { ACCENTS, type Accent } from "../domain/validation.js";

function canonicalSender(sender: string): string {
  return sender.normalize("NFKC").trim().toLowerCase();
}

export function senderColor(sender: string): Accent {
  let hash = 0x811c9dc5;
  for (const character of canonicalSender(sender)) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return ACCENTS[(hash >>> 0) % ACCENTS.length] ?? ACCENTS[0];
}
