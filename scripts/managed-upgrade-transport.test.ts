import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import {
  publisherFixture,
  startPublisherProxy,
} from "./managed-upgrade-transport.mjs";

test("serves exact fixed publisher identities with authentic digest and bytes", () => {
  const source = Buffer.from("candidate zip");
  const manifest = {
    version: "99.0.0",
    source: {
      name: "on-track-v99.0.0.zip",
      url: "https://github.com/satankov/on-track/releases/download/v99.0.0/on-track-v99.0.0.zip",
      size: source.length,
      sha256: createHash("sha256").update(source).digest("hex"),
    },
  };
  const fixture = publisherFixture(manifest, source);
  const metadata = JSON.parse(
    fixture(
      "https://api.github.com/repos/satankov/on-track/releases/tags/v99.0.0",
    )!.toString(),
  );
  expect(metadata).toMatchObject({
    tag_name: "v99.0.0",
    immutable: true,
    draft: false,
    prerelease: false,
  });
  expect(metadata.assets[1].digest).toBe(`sha256:${manifest.source.sha256}`);
  expect(fixture(manifest.source.url)).toEqual(source);
  expect(fixture("https://github.com/unrelated/repository")).toBeUndefined();
  expect(fixture(manifest.source.url + "?redirect=elsewhere")).toBeUndefined();
  expect(
    fixture(
      "http://api.github.com/repos/satankov/on-track/releases/tags/v99.0.0",
    ),
  ).toBeUndefined();
});

test("publisher proxy refuses non-tunnel HTTP without forwarding outside the fixture", async () => {
  const proxy = await startPublisherProxy({
    key: undefined,
    cert: undefined,
    lookup: () => {
      throw new Error("Unexpected publisher route");
    },
  });
  try {
    const response = await fetch(proxy.url + "/https://example.com");
    expect(response.status).toBe(403);
    expect(proxy.requests).toEqual([]);
  } finally {
    await proxy.close();
  }
});
