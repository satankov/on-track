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
    "profile.terminal",
    "location.inetloc",
    "help.chm",
    "addin.xll",
    "sandbox.wsb",
    "macros.docm",
    "macros.xlsm",
    "macros.pptm",
    "legacy.doc",
    "legacy.xls",
    "legacy.ppt",
    "page.html",
    "vector.svg",
    "archive.zip",
    "archive.tar.gz",
    "notes.unknown",
    "README",
    ".txt",
    "report.pdf.exe",
    "report.pdf.",
    "report.pdf ",
    "report.pd\u0130f",
    "report.\u202efdp",
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

  it.each(["profile.terminal", "file.unknown", "README"])(
    "blocks unsupported managed filename %s behind an allowed display name",
    (managedFilename) => {
      expect(
        attachmentOpenPolicy({
          displayFilename: "notes.txt",
          managedFilename,
          mode: 0o600,
          platform: "darwin",
        }),
      ).toBe("blocked");
    },
  );

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

  it.each([0o700, 0o610, 0o601])("blocks POSIX executable mode %s", (mode) => {
    expect(
      attachmentOpenPolicy({
        displayFilename: "notes.txt",
        managedFilename: "notes.txt",
        mode,
        platform: "linux",
      }),
    ).toBe("blocked");
  });

  it("does not interpret Windows mode bits as POSIX executable bits", () => {
    expect(
      attachmentOpenPolicy({
        displayFilename: "quarterly.pptx",
        managedFilename: "quarterly.pptx",
        mode: 0o700,
        platform: "win32",
      }),
    ).toBe("available");
  });

  it.each([
    "quarterly.pptx",
    "brief.docx",
    "report.pdf",
    "photo.png",
    "notes.txt",
    "notes.md",
    "data.csv",
    "table.xlsx",
    "photo.jpg",
    "photo.jpeg",
    "photo.gif",
    "photo.webp",
    "photo.bmp",
    "photo.tif",
    "photo.tiff",
    "photo.heic",
    "audio.mp3",
    "audio.wav",
    "audio.m4a",
    "audio.ogg",
    "audio.flac",
    "video.mp4",
    "video.mov",
    "video.webm",
    "REPORT.PdF",
    "notes.final.TXT",
  ])("allows ordinary document or media file %s", (filename) => {
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
