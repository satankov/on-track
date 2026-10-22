import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { removeProfileBlocks } from "./uninstall-profile.js";
import { updateProfile } from "./platform.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it.skipIf(process.platform === "win32")(
  "removes only an exact owned block and retains modified profiles and symlinks",
  () => {
    const home = mkdtempSync(join(tmpdir(), "thr-profile-"));
    roots.push(home);
    const bin = "/runtime with 'quotes'/bin",
      other = updateProfile("# personal\n", "/other/bin");
    writeFileSync(
      join(home, ".zshrc"),
      updateProfile("alias ll='ls -l'\n", bin),
    );
    writeFileSync(join(home, ".bashrc"), other);
    symlinkSync(join(home, ".bashrc"), join(home, ".bash_profile"));
    expect(removeProfileBlocks(home, bin)).toEqual([
      join(home, ".bashrc"),
      join(home, ".bash_profile"),
    ]);
    expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe(
      "alias ll='ls -l'\n",
    );
    expect(readFileSync(join(home, ".bashrc"), "utf8")).toBe(other);
  },
);
