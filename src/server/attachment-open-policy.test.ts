import { describe, expect, it } from "vitest";

import { attachmentOpenPolicy } from "./attachment-open-policy.js";

describe("attachment open policy", () => {
  it.each([
    "installer.EXE",
    "archive.tar.cmd",
    "script.ps1",
    "shortcut.lnk",
    "package.msi",
    "application.app",
    "launcher.desktop",
    "automation.sh",
    "payload.jar",
    "settings.reg",
  ])("blocks dangerous filename %s case-insensitively", (filename) => {
    expect(
      attachmentOpenPolicy({
        displayFilename: filename,
        managedFilename: "safe.txt",
        mode: 0o600,
        platform: "darwin",
      }),
    ).toBe("blocked");
  });

  it("checks the managed basename as well as the display name", () => {
    expect(
      attachmentOpenPolicy({
        displayFilename: "notes.txt",
        managedFilename: "notes.txt.exe ",
        mode: 0o600,
        platform: "win32",
      }),
    ).toBe("blocked");
  });

  it.each([
    ".exe",
    ".CMD",
    ".lnk",
    "shortcut.pif",
    "clickonce.application",
    "launcher.appref-ms",
    "package.msixbundle",
    "python.pyw",
    "archive.pyz",
    "window.pyzw",
    "webstart.jnlp",
    "scrap.shb",
    "scrap.shs",
    "shortcut.website",
  ])("blocks extension-only and Windows launcher name %s", (filename) => {
    expect(
      attachmentOpenPolicy({
        displayFilename: filename,
        managedFilename: filename,
        mode: 0o600,
        platform: "win32",
      }),
    ).toBe("blocked");
  });

  it("blocks executable mode bits on POSIX but ignores MIME metadata", () => {
    expect(
      attachmentOpenPolicy({
        displayFilename: "notes.txt",
        managedFilename: "notes.txt",
        mode: 0o700,
        platform: "linux",
      }),
    ).toBe("blocked");
    expect(
      attachmentOpenPolicy({
        displayFilename: "quarterly.pptx",
        managedFilename: "quarterly.pptx",
        mode: 0o600,
        platform: "darwin",
      }),
    ).toBe("available");
  });

  it.each([
    "quarterly.pptx",
    "brief.docx",
    "report.pdf",
    "photo.png",
    "notes.txt",
  ])("allows ordinary document %s", (filename) => {
    expect(
      attachmentOpenPolicy({
        displayFilename: filename,
        managedFilename: filename,
        mode: 0o600,
        platform: "linux",
      }),
    ).toBe("available");
  });
});
