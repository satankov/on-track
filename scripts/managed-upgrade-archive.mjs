import { execFileSync } from "node:child_process";

// Source is a disposable candidate snapshot, never the developer's checkout.
// Match the real publisher's Git ZIP writer on every OS, without a commit.
export function createFixtureArchive(source, archive) {
  const git = (args) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        `core.attributesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
        ...args,
      ],
      { cwd: source, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  git(["init", "-q"]);
  git(["add", "--force", "--all"]);
  const tree = git(["write-tree"]).trim();
  git(["archive", "--format=zip", `--output=${archive}`, tree]);
}
