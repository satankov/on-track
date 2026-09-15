import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { verifyRuntimePins } from "./verify-managed-runtime.mjs";

const original = JSON.parse(
  readFileSync(new URL("./managed-runtime.json", import.meta.url), "utf8"),
);
function fixture() {
  const bytes = Buffer.from("node-fixture");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const pins = {
    ...original,
    runtimes: Object.fromEntries(
      Object.entries(original.runtimes).map(([key, asset]) => [
        key,
        { ...(asset as object), sha256, size: bytes.length },
      ]),
    ),
  };
  const checksums = Object.values(pins.runtimes)
    .map((asset) => `${asset.sha256}  ${asset.name}`)
    .join("\n");
  const fetcher = vi.fn(
    async (address: string) =>
      new Response(address === pins.checksumsUrl ? checksums : bytes),
  );
  return { pins, bytes, checksums, fetcher };
}
describe("managed Node release verification", () => {
  it("checks official checksums and every pinned archive without executing downloads", async () => {
    const { pins, fetcher } = fixture();
    const verified: string[] = [];
    await verifyRuntimePins({
      pins,
      fetcher,
      onVerified: (platform: string) => verified.push(platform),
    });
    expect(verified.sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
      "win-x64",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(5);
    for (const [, options] of fetcher.mock.calls as unknown as [
      string,
      { redirect: string; signal: AbortSignal },
    ][])
      expect(options).toMatchObject({
        redirect: "error",
        signal: expect.any(AbortSignal),
      });
  });
  it("rejects altered official checksum text before downloading archives", async () => {
    const { pins } = fixture();
    const fetcher = vi.fn(async () => new Response("wrong"));
    await expect(verifyRuntimePins({ pins, fetcher })).rejects.toThrow(
      /checksum/i,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects runtime bytes with incorrect digest or size", async () => {
    const { pins, checksums, bytes } = fixture();
    await expect(
      verifyRuntimePins({
        pins,
        fetcher: async (address: string) =>
          new Response(
            address === pins.checksumsUrl
              ? checksums
              : Buffer.alloc(bytes.length),
          ),
      }),
    ).rejects.toThrow(/digest/i);
    await expect(
      verifyRuntimePins({
        pins,
        fetcher: async (address: string) =>
          new Response(
            address === pins.checksumsUrl
              ? checksums
              : Buffer.alloc(bytes.length + 1),
          ),
      }),
    ).rejects.toThrow(/limit|size/i);
  });
  it("refuses non-official checksums and HTTP failures", async () => {
    const { pins, fetcher } = fixture();
    await expect(
      verifyRuntimePins({
        pins: { ...pins, checksumsUrl: "https://example.com/SHA" },
        fetcher,
      }),
    ).rejects.toThrow(/official/i);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      verifyRuntimePins({
        pins,
        fetcher: async () => new Response("", { status: 403 }),
      }),
    ).rejects.toThrow(/403/);
  });
});
