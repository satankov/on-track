import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";
import { validateRuntimes } from "./managed-release.mjs";

async function readOfficial(url, limit, fetcher, consume) {
  const response = await fetcher(url, {
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(180_000),
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "OnTrack-Release-Verification",
    },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Official Node download failed (HTTP ${response.status}).`);
  }
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > limit)
  ) {
    await response.body?.cancel();
    throw new Error("Official Node download exceeds its size limit.");
  }
  if (!response.body) throw new Error("Official Node download has no body.");
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit)
        throw new Error("Official Node download exceeds its size limit.");
      consume(chunk.value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  return size;
}

/** Verify all pinned bytes without extracting, saving, or executing a runtime. */
export async function verifyRuntimePins({
  pins,
  fetcher = globalThis.fetch,
  onVerified = () => {},
}) {
  if (pins?.formatVersion !== 1)
    throw new Error("Invalid managed runtime pin format.");
  validateRuntimes(pins.runtimes);
  const version = Object.values(pins.runtimes)[0].version;
  if (
    pins.checksumsUrl !==
    `https://nodejs.org/download/release/v${version}/SHASUMS256.txt`
  )
    throw new Error(
      "Checksums must use the exact official Node release address.",
    );
  const chunks = [];
  await readOfficial(pins.checksumsUrl, 64 * 1024, fetcher, (chunk) =>
    chunks.push(chunk),
  );
  const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  for (const [platform, runtime] of Object.entries(pins.runtimes)) {
    if (
      lines.filter((line) => line === `${runtime.sha256}  ${runtime.name}`)
        .length !== 1
    )
      throw new Error(
        `Official Node checksum differs from the ${platform} pin.`,
      );
  }
  for (const [platform, runtime] of Object.entries(pins.runtimes)) {
    const hash = createHash("sha256");
    const size = await readOfficial(
      runtime.url,
      runtime.size,
      fetcher,
      (chunk) => hash.update(chunk),
    );
    if (size !== runtime.size)
      throw new Error(`Official Node archive size differs for ${platform}.`);
    if (hash.digest("hex") !== runtime.sha256)
      throw new Error(`Official Node archive digest differs for ${platform}.`);
    onVerified(platform);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 2)
      throw new Error("Usage: node scripts/verify-managed-runtime.mjs");
    const pins = JSON.parse(
      readFileSync(new URL("./managed-runtime.json", import.meta.url), "utf8"),
    );
    await verifyRuntimePins({
      pins,
      onVerified: (platform) =>
        console.log(`Verified official Node bytes: ${platform}`),
    });
    console.log(
      "All runtime hashes and sizes match. Detached publisher signatures are not verified by this command.",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Runtime verification failed.",
    );
    process.exitCode = 1;
  }
}
