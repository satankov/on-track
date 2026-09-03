import { describe, expect, it } from "vitest";

import {
  assertSupportedRuntime,
  runtimeSupportError,
} from "./runtime-support.js";

describe("runtime support policy", () => {
  it("requires Node 24 on Windows", () => {
    expect(
      runtimeSupportError({ platform: "win32", nodeVersion: "22.16.0" }),
    ).toBe("On Track requires Node.js 24 on Windows; found Node.js 22.16.0.");
    expect(
      runtimeSupportError({ platform: "win32", nodeVersion: "24.0.0" }),
    ).toBeUndefined();
    expect(() =>
      assertSupportedRuntime({ platform: "win32", nodeVersion: "22.16.0" }),
    ).toThrow("requires Node.js 24 on Windows");
  });

  it.each(["linux", "darwin"] as const)(
    "supports Node 22.16 and Node 24 on %s",
    (platform) => {
      expect(
        runtimeSupportError({ platform, nodeVersion: "22.16.0" }),
      ).toBeUndefined();
      expect(
        runtimeSupportError({ platform, nodeVersion: "24.0.0" }),
      ).toBeUndefined();
    },
  );

  it("rejects runtimes outside the documented LTS policy", () => {
    expect(
      runtimeSupportError({ platform: "linux", nodeVersion: "22.15.0" }),
    ).toContain("Node.js 22.16 or Node.js 24");
    expect(
      runtimeSupportError({ platform: "darwin", nodeVersion: "25.0.0" }),
    ).toContain("Node.js 22.16 or Node.js 24");
    expect(
      runtimeSupportError({ platform: "linux", nodeVersion: "invalid" }),
    ).toContain("Unsupported Node.js version");
    expect(
      runtimeSupportError({ platform: "linux", nodeVersion: "24.0.0-rc.1" }),
    ).toContain("Unsupported Node.js version");
  });

  it("rejects operating systems outside the tested support matrix", () => {
    expect(
      runtimeSupportError({ platform: "freebsd", nodeVersion: "24.0.0" }),
    ).toBe(
      "Unsupported operating system: freebsd. On Track supports Windows, macOS, and Linux.",
    );
  });
});
