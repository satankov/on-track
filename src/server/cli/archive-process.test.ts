import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { extractVerifiedSource } from "./archive.js";
import type { ManagedReleaseManifest } from "./release.js";

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => boundary);
const roots: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it.each([
  [
    "ONTRACK_ARCHIVE_FAILURE:checksum:-2146233087\r\n",
    " (stage: checksum, code: -2146233087)",
  ],
  ["private/path or untrusted archive contents\n", ""],
  ["ONTRACK_ARCHIVE_FAILURE:private/path:-1\n", ""],
  ["ONTRACK_ARCHIVE_FAILURE:checksum:-1\nextra private content", ""],
])(
  "reports only allowlisted extraction diagnostics: %j",
  async (output, expected) => {
    const root = mkdtempSync(join(tmpdir(), "threadstr-archive-error-"));
    roots.push(root);
    boundary.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        kill: vi.fn(),
      });
      queueMicrotask(() => {
        child.stdout.end(output);
        child.emit("close", 1);
      });
      return child;
    });
    await expect(
      extractVerifiedSource(join(root, "archive.zip"), join(root, "output"), {
        sourceFiles: {},
      } as ManagedReleaseManifest),
    ).rejects.toThrow(
      new Error(
        "Archive extraction failed. Use the manual installation guide." +
          expected,
      ),
    );
  },
);
