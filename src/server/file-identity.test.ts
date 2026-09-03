import { describe, expect, it } from "vitest";

import { fileIdentity, isSameFileIdentity } from "./file-identity.js";

describe("cross-platform file identity", () => {
  it("normalizes the Windows volume serial number to its documented low 32 bits", () => {
    const descriptor = fileIdentity(
      { dev: 0x00000000_89abcdefn, ino: 42n },
      "win32",
    );
    const path = fileIdentity({ dev: 0x76543210_89abcdefn, ino: 42n }, "win32");

    expect(isSameFileIdentity(descriptor, path)).toBe(true);
  });

  it("still rejects a different Windows volume or file ID", () => {
    const expected = fileIdentity(
      { dev: 0x76543210_89abcdefn, ino: 42n },
      "win32",
    );

    expect(
      isSameFileIdentity(
        expected,
        fileIdentity({ dev: 0x76543210_89abcdeen, ino: 42n }, "win32"),
      ),
    ).toBe(false);
    expect(
      isSameFileIdentity(
        expected,
        fileIdentity({ dev: 0x76543210_89abcdefn, ino: 43n }, "win32"),
      ),
    ).toBe(false);
  });

  it("keeps the complete device identity on non-Windows platforms", () => {
    const expected = fileIdentity(
      { dev: 0x00000000_89abcdefn, ino: 42n },
      "linux",
    );
    const differentHighBits = fileIdentity(
      { dev: 0x76543210_89abcdefn, ino: 42n },
      "linux",
    );

    expect(isSameFileIdentity(expected, differentHighBits)).toBe(false);
  });
});
