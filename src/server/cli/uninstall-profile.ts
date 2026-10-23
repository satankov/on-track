import { randomUUID } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { updateProfile } from "./platform.js";
import { assertRegularFile } from "./state.js";
import { statIfPresent } from "./uninstall-plan.js";

/** Exact installer block only; profiles are never sourced or broadly rewritten. */
export function removeProfileBlocks(home: string, bin: string): string[] {
  const retained: string[] = [];
  const block = updateProfile("", bin).replace(/^\n/, "");
  for (const name of [".zshrc", ".bashrc", ".bash_profile"]) {
    const path = join(home, name);
    if (!statIfPresent(path)) continue;
    try {
      assertRegularFile(path);
      const stat = lstatSync(path);
      if (stat.size > 1024 * 1024) throw new Error("Oversized profile");
      const text = readFileSync(path, "utf8");
      if (!text.includes("# >>> On Track command >>>")) continue;
      if (!text.includes(block)) {
        retained.push(path);
        continue;
      }
      const next = text.replaceAll(block, "");
      const temporary = path + ".thr-uninstall-" + randomUUID();
      try {
        writeFileSync(temporary, next, { flag: "wx", mode: stat.mode & 0o777 });
        assertRegularFile(path);
        const current = lstatSync(path);
        if (
          current.ino !== stat.ino ||
          current.dev !== stat.dev ||
          readFileSync(path, "utf8") !== text
        )
          throw new Error("Profile changed");
        renameSync(temporary, path);
      } finally {
        if (statIfPresent(temporary)) unlinkSync(temporary);
      }
    } catch {
      retained.push(path);
    }
  }
  return retained;
}
