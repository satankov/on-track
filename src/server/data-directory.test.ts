import { homedir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDataDirectory } from "./data-directory.js";

describe("application data directory", () => {
  it("honors absolute and relative explicit overrides", () => {
    expect(
      resolveDataDirectory({ ON_TRACK_DATA_DIR: "/tmp/on-track" }, "linux"),
    ).toBe("/tmp/on-track");
    expect(
      resolveDataDirectory({ ON_TRACK_DATA_DIR: "local-data" }, "linux"),
    ).toBe(resolve("local-data"));
  });

  it("uses the native macOS application support directory", () => {
    expect(resolveDataDirectory({}, "darwin")).toBe(
      `${homedir()}/Library/Application Support/On Track`,
    );
  });

  it("uses APPDATA on Windows and a home fallback", () => {
    expect(
      resolveDataDirectory(
        { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
        "win32",
      ),
    ).toContain("On Track");
    expect(resolveDataDirectory({}, "win32")).toContain(
      "AppData/Roaming/On Track",
    );
  });

  it("uses XDG_DATA_HOME on Linux and a home fallback", () => {
    expect(
      resolveDataDirectory({ XDG_DATA_HOME: "/var/local/me" }, "linux"),
    ).toBe("/var/local/me/on-track");
    expect(resolveDataDirectory({}, "linux")).toBe(
      `${homedir()}/.local/share/on-track`,
    );
  });
});
