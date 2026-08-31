import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDataDirectory } from "./data-directory.js";

describe("application data directory", () => {
  it("honors absolute and relative explicit overrides", () => {
    const absolutePath = resolve("on-track-data");

    expect(resolveDataDirectory({ ON_TRACK_DATA_DIR: absolutePath })).toBe(
      absolutePath,
    );
    expect(resolveDataDirectory({ ON_TRACK_DATA_DIR: "local-data" })).toBe(
      resolve("local-data"),
    );
  });

  it("uses the native macOS application support directory", () => {
    expect(resolveDataDirectory({}, "darwin", "/Users/example")).toBe(
      "/Users/example/Library/Application Support/On Track",
    );
  });

  it("uses APPDATA on Windows and a home fallback", () => {
    expect(
      resolveDataDirectory(
        { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
        "win32",
      ),
    ).toBe("C:\\Users\\me\\AppData\\Roaming\\On Track");
    expect(resolveDataDirectory({}, "win32", "C:\\Users\\example")).toBe(
      "C:\\Users\\example\\AppData\\Roaming\\On Track",
    );
  });

  it("uses XDG_DATA_HOME on Linux and a home fallback", () => {
    expect(
      resolveDataDirectory(
        { XDG_DATA_HOME: "/var/local/me" },
        "linux",
        "/home/example",
      ),
    ).toBe("/var/local/me/on-track");
    expect(resolveDataDirectory({}, "linux", "/home/example")).toBe(
      "/home/example/.local/share/on-track",
    );
  });
});
