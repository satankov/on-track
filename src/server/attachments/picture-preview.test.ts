import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  MAX_PICTURE_PREVIEW_BYTES,
  picturePreviewMediaType,
} from "../../domain/picture-preview.js";
import { inspectPicturePreview } from "./picture-preview.js";

// A 3×2 grayscale image, encoded as PNG, baseline JPEG and progressive JPEG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAAAAAC4HznGAAAAEElEQVR4nGNsZWBgYmBgAAADuwCJ2nFAxAAAAABJRU5ErkJggg==",
  "base64",
);
const baseline = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAMBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AV//Z",
  "base64",
);
const progressive = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wgALCAACAAMBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/aAAgBAQAAAAFf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oACAEBAAAAEP8A/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

function pngChunk(type: string, payload: Buffer) {
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length);
  chunk.write(type, 4, "latin1");
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

function withPngHeader(change: (header: Buffer) => void) {
  const header = Buffer.from(png.subarray(16, 29));
  change(header);
  return Buffer.concat([
    png.subarray(0, 8),
    pngChunk("IHDR", header),
    png.subarray(33),
  ]);
}

describe("picture preview eligibility", () => {
  it("suggests a media type only for the final supported filename extension", () => {
    expect(picturePreviewMediaType("Vacation.Photo.JpEg")).toBe("image/jpeg");
    expect(picturePreviewMediaType("screenshot.PNG")).toBe("image/png");
    for (const filename of [
      "photo",
      "photo.jpg.txt",
      "animation.gif",
      ".png",
      "photo.jpg ",
    ])
      expect(picturePreviewMediaType(filename)).toBeUndefined();
  });

  it.each([
    ["sample.PNG", png, "image/png"],
    ["sample.JPG", baseline, "image/jpeg"],
    ["sample.jpeg", progressive, "image/jpeg"],
  ] as const)("recognizes a complete %s picture", (name, bytes, type) => {
    expect(inspectPicturePreview(bytes, name)).toBe(type);
  });

  it("accepts an indexed PNG with textual metadata mentioning animation", () => {
    const indexed = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAAFXRFWHRDb21tZW50AGFjVEwgYW5kIGZjVEyYoPWKAAAABlBMVEX/AAD///9BHTQRAAAACklEQVR4nGNwAAAAQgBBKTf07wAAAABJRU5ErkJggg==",
      "base64",
    );
    expect(inspectPicturePreview(indexed, "palette.png")).toBe("image/png");
  });

  it("recognizes a JPEG whose scan contains restart intervals", () => {
    const restarted = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAgACABAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/3QAEAAH/2gAIAQEAAD8AV//QV//RV//SV//TV//UV//VV//WV//XV//QV//RV//SV//TV//UV//VV//WV//Z",
      "base64",
    );
    expect(inspectPicturePreview(restarted, "screenshot.jpeg")).toBe(
      "image/jpeg",
    );
  });

  it("requires the content to match the extension and enforces the byte ceiling", () => {
    expect(inspectPicturePreview(png, "photo.jpg")).toBeUndefined();
    expect(inspectPicturePreview(baseline, "photo.png")).toBeUndefined();
    expect(inspectPicturePreview(baseline, "photo.txt")).toBeUndefined();
    expect(
      inspectPicturePreview(
        Buffer.alloc(MAX_PICTURE_PREVIEW_BYTES + 1),
        "x.png",
      ),
    ).toBeUndefined();
  });

  it.each(["acTL", "fcTL", "fdAT"])(
    "rejects %s PNG animation chunks",
    (type) => {
      const animated = Buffer.concat([
        png.subarray(0, 33),
        pngChunk(type, Buffer.alloc(8)),
        png.subarray(33),
      ]);
      expect(inspectPicturePreview(animated, "motion.png")).toBeUndefined();
    },
  );

  it("rejects PNG headers with invalid dimensions or encoding fields", () => {
    for (const header of [
      withPngHeader((h) => h.writeUInt32BE(0, 0)),
      withPngHeader((h) => {
        h.writeUInt32BE(6001, 0);
        h.writeUInt32BE(4000, 4);
      }),
      withPngHeader((h) => {
        h[8] = 7;
      }),
      withPngHeader((h) => {
        h[12] = 2;
      }),
    ])
      expect(inspectPicturePreview(header, "picture.png")).toBeUndefined();
  });

  it("rejects truncated, damaged, or incomplete PNGs", () => {
    const badCrc = Buffer.from(png);
    badCrc[badCrc.length - 1] ^= 1;
    for (const bytes of [
      png.subarray(0, 7),
      png.subarray(0, 30),
      png.subarray(0, -1),
      badCrc,
      Buffer.concat([png.subarray(0, 33), png.subarray(-12)]),
      Buffer.concat([png, Buffer.from("trailing data")]),
    ])
      expect(inspectPicturePreview(bytes, "picture.png")).toBeUndefined();
  });

  it("rejects oversize or duplicate JPEG frames, absent image scans and invalid segment lengths", () => {
    const start = baseline.indexOf(Buffer.from([0xff, 0xc0]));
    const frame = baseline.subarray(
      start,
      start + 2 + baseline.readUInt16BE(start + 2),
    );
    const excessive = Buffer.from(baseline);
    excessive.writeUInt16BE(4000, start + 5);
    excessive.writeUInt16BE(6001, start + 7);
    const badLength = Buffer.from(baseline);
    badLength.writeUInt16BE(0, 4);
    for (const bytes of [
      excessive,
      badLength,
      baseline.subarray(0, -2),
      baseline.subarray(0, 3),
      Buffer.concat([
        baseline.subarray(0, start),
        frame,
        baseline.subarray(start),
      ]),
      Buffer.concat([
        baseline.subarray(0, baseline.indexOf(Buffer.from([0xff, 0xda]))),
        baseline.subarray(-2),
      ]),
      Buffer.concat([baseline, baseline]),
    ])
      expect(inspectPicturePreview(bytes, "photo.jpg")).toBeUndefined();
  });
});
