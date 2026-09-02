import { extname } from "node:path";

const BLOCKED_EXTENSIONS = new Set([
  ".app",
  ".application",
  ".appimage",
  ".appref-ms",
  ".appx",
  ".appxbundle",
  ".au3",
  ".apk",
  ".bat",
  ".cmd",
  ".command",
  ".com",
  ".cpl",
  ".crx",
  ".desktop",
  ".deb",
  ".dll",
  ".dmg",
  ".exe",
  ".gadget",
  ".hta",
  ".inf",
  ".ins",
  ".iso",
  ".jar",
  ".jnlp",
  ".js",
  ".jse",
  ".lnk",
  ".msc",
  ".msi",
  ".msp",
  ".msix",
  ".msixbundle",
  ".mst",
  ".msh",
  ".msh1",
  ".msh1xml",
  ".msh2",
  ".msh2xml",
  ".mshxml",
  ".pif",
  ".pkg",
  ".ps1",
  ".ps1xml",
  ".ps2",
  ".ps2xml",
  ".psd1",
  ".psm1",
  ".psc1",
  ".psc2",
  ".py",
  ".pyc",
  ".pyo",
  ".pyw",
  ".pyz",
  ".pyzw",
  ".rb",
  ".reg",
  ".rpm",
  ".scf",
  ".scr",
  ".sh",
  ".run",
  ".sct",
  ".settingcontent-ms",
  ".shb",
  ".shs",
  ".vb",
  ".vbe",
  ".vbs",
  ".url",
  ".webloc",
  ".website",
  ".workflow",
  ".ws",
  ".wsc",
  ".wsf",
  ".wsh",
  ".xnk",
  ".xpi",
]);

function isBlockedFilename(filename: string): boolean {
  const normalized = filename.trimEnd().toLocaleLowerCase("en-US");
  return (
    BLOCKED_EXTENSIONS.has(normalized) ||
    BLOCKED_EXTENSIONS.has(extname(normalized))
  );
}

export function attachmentOpenPolicy(input: {
  displayFilename: string;
  managedFilename: string;
  mode: number;
  platform: NodeJS.Platform;
}): "available" | "blocked" {
  if (
    isBlockedFilename(input.displayFilename) ||
    isBlockedFilename(input.managedFilename)
  ) {
    return "blocked";
  }
  if (input.platform !== "win32" && (input.mode & 0o111) !== 0) {
    return "blocked";
  }
  return "available";
}
