import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

// Exercise the complete shell entry point with local download fixtures and real
// archive/hash utilities. /bin/bash intentionally selects macOS's bundled 3.2.
test
  .runIf(process.platform !== "win32")
  .each(["defaults", "root-only", "options"])(
  "installer forwards %s arguments with the system Bash",
  (mode) => {
    const directory = mkdtempSync(join(tmpdir(), "ontrack-shell-"));
    directories.push(directory);
    const home = join(directory, "fresh home é");
    const bin = join(directory, "bin");
    const platform = process.platform === "darwin" ? "darwin" : "linux";
    const nodeName = `node-v24.14.0-${platform}-${process.arch}`;
    const nodeBin = join(directory, nodeName, "bin");
    for (const path of [home, bin, nodeBin])
      mkdirSync(path, { recursive: true });
    writeFileSync(
      join(nodeBin, "node"),
      '#!/bin/bash\nprintf "%s\\0" "$@" > "$TEST_RECEIPT"\n',
      { mode: 0o700 },
    );
    const archive = join(directory, "runtime.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", directory, nodeName]);
    const bootstrap = join(directory, "bootstrap.mjs");
    writeFileSync(bootstrap, "// Local bootstrap receipt fixture.\n");
    const digest = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    writeFileSync(
      join(bin, "curl"),
      `#!/bin/bash
set -eu
while [ "$#" -gt 0 ]; do
  case "$1" in
    https://nodejs.org/download/release/v24.14.0/*) source="$TEST_ARCHIVE";;
    https://github.com/satankov/on-track/releases/download/v0.0.7/managed-bootstrap.mjs) source="$TEST_BOOTSTRAP";;
    -o) shift; destination="$1";;
  esac
  shift
done
cp "$source" "$destination"
`,
      { mode: 0o700 },
    );
    const installer = join(directory, "install.sh");
    writeFileSync(
      installer,
      readFileSync("scripts/install.sh", "utf8")
        .replace("__ONTRACK_RELEASE__", "v0.0.7")
        .replace("__ONTRACK_BOOTSTRAP_SHA256__", digest(bootstrap))
        .replace("__ONTRACK_MANIFEST_SHA256__", "a".repeat(64))
        .replace(/hash=[a-f0-9]{64}/g, `hash=${digest(archive)}`),
    );
    const root =
      mode === "defaults"
        ? join(
            home,
            process.platform === "darwin"
              ? "Library/Application Support/On Track Runtime"
              : ".local/share/on-track-runtime",
          )
        : join(directory, "custom runtime é");
    const options =
      mode === "options"
        ? [
            "--data-dir",
            join(home, "data folder é $literal"),
            "--port",
            "4180",
            "--adopt-from",
            join(home, "manual source"),
            "--no-profile",
            "--no-open",
          ]
        : [];
    const receipt = join(directory, "receipt");
    const result = spawnSync(
      "/bin/bash",
      [installer, ...(mode === "defaults" ? [] : ["--root", root]), ...options],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          XDG_DATA_HOME: "",
          PATH: `${bin}:${process.env.PATH}`,
          TEST_ARCHIVE: archive,
          TEST_BOOTSTRAP: bootstrap,
          TEST_RECEIPT: receipt,
        },
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status, result.stderr).toBe(0);
    const args = readFileSync(receipt, "utf8").split("\0");
    expect(args.pop()).toBe("");
    expect(args[0]).toMatch(/\/bootstrap\.[^/]+\/managed-bootstrap\.mjs$/);
    expect(args[1]).toBe(root);
    expect(args[2]).toBe(args[0].replace("managed-bootstrap.mjs", nodeName));
    expect(args.slice(3)).toEqual(options);
    expect(existsSync(join(root, ".bootstrap-claim"))).toBe(false);
    expect(existsSync(args[0])).toBe(false);
  },
);
