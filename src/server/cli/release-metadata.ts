import { createHash } from "node:crypto";
import { z } from "zod";
import { releaseIdSchema } from "./state.js";
import {
  fetchTrusted,
  parseManagedReleaseManifest,
  REPOSITORY,
  type ManagedReleaseManifest,
} from "./release.js";
export const publishedSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  immutable: z.boolean(),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.string(),
      size: z.number().int().positive(),
      digest: z.string().nullable().optional(),
    }),
  ),
});
export type PublishedRelease = z.infer<typeof publishedSchema>;
export async function manifestFor(
  release: PublishedRelease,
  read: typeof fetchTrusted = fetchTrusted,
): Promise<ManagedReleaseManifest> {
  const tag = releaseIdSchema.parse(release.tag_name);
  if (release.draft || release.prerelease || !release.immutable)
    throw new Error("Choose a published immutable stable release.");
  const asset = release.assets.find(
    (asset) => asset.name === "managed-release.json",
  );
  const url = `https://github.com/${REPOSITORY}/releases/download/${tag}/managed-release.json`;
  if (
    !asset ||
    asset.browser_download_url !== url ||
    !asset.digest?.match(/^sha256:[a-f0-9]{64}$/)
  )
    throw new Error(
      "This source release does not support managed installation. Use its manual guide.",
    );
  const bytes = await read(url, Math.min(asset.size, 2 * 1024 * 1024));
  if (
    bytes.length !== asset.size ||
    createHash("sha256").update(bytes).digest("hex") !== asset.digest.slice(7)
  )
    throw new Error("Release manifest checksum mismatch.");
  const result = parseManagedReleaseManifest(
    JSON.parse(Buffer.from(bytes).toString("utf8")),
  );
  if (`v${result.version}` !== tag)
    throw new Error("Release identity mismatch.");
  const source = release.assets.find(
    (asset) => asset.name === result.source.name,
  );
  if (
    !source ||
    source.browser_download_url !== result.source.url ||
    source.size !== result.source.size ||
    source.digest !== `sha256:${result.source.sha256}`
  )
    throw new Error("Published source asset does not match its manifest.");
  return result;
}
