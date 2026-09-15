import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type ManagedReleaseManifest, safeSourcePath } from "./release.js";

async function capture(
  command: string,
  args: string[],
  limit: number,
): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let length = 0;
    const chunks: Buffer[] = [];
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error("Archive operation timed out.")),
      60_000,
    );
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > limit) fail(new Error("Archive expansion limit exceeded."));
      else chunks.push(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0) {
        const diagnostic = Buffer.concat(chunks, length)
          .toString("utf8")
          .match(
            /^ONTRACK_ARCHIVE_FAILURE:(inventory|open|entry|write|checksum|complete):(-?\d+)\r?\n$/,
          );
        reject(
          new Error(
            "Archive extraction failed. Use the manual installation guide." +
              (diagnostic
                ? ` (stage: ${diagnostic[1]}, code: ${diagnostic[2]})`
                : ""),
          ),
        );
      } else resolvePromise(Buffer.concat(chunks, length));
    });
  });
}
export async function extractVerifiedSource(
  archive: string,
  destination: string,
  manifest: ManagedReleaseManifest,
): Promise<void> {
  mkdirSync(destination, { mode: 0o700 });
  if (process.platform === "win32") {
    // .NET exposes entry types and bounded streams without a shell or ZIP parser.
    const script = join(destination, "../source-inventory.json");
    writeFileSync(script, JSON.stringify(manifest.sourceFiles), {
      flag: "wx",
      mode: 0o600,
    });
    await capture(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(process.cwd(), "scripts/extract-source.ps1"),
        "-Archive",
        archive,
        "-Destination",
        destination,
        "-Inventory",
        script,
      ],
      4096,
    );
    return;
  }
  const list = (await capture("unzip", ["-Z", "-1", archive], 1024 * 1024))
    .toString("utf8")
    .split("\n")
    .filter(Boolean);
  const metadata = (
    await capture("unzip", ["-Z", "-l", archive], 2 * 1024 * 1024)
  ).toString("utf8");
  if (/^l[rwxsStT-]{9}/m.test(metadata))
    throw new Error("Source archive contains a symbolic link.");
  const seen = new Set<string>();
  const expected = Object.keys(manifest.sourceFiles);
  for (const entry of list) {
    const path = entry.endsWith("/") ? entry.slice(0, -1) : entry;
    if (!safeSourcePath(path) || seen.has(entry.toLowerCase()))
      throw new Error("Unsafe or duplicate archive entry.");
    seen.add(entry.toLowerCase());
    if (!entry.endsWith("/") && !Object.hasOwn(manifest.sourceFiles, entry))
      throw new Error("Unexpected source archive entry.");
  }
  if (expected.some((path) => !list.includes(path)))
    throw new Error("Source archive is incomplete.");
  for (const path of expected) {
    const file = manifest.sourceFiles[path];
    const bytes = await capture("unzip", ["-p", archive, path], file.size);
    if (
      bytes.length !== file.size ||
      createHash("sha256").update(bytes).digest("hex") !== file.sha256
    )
      throw new Error("Source entry checksum mismatch.");
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  }
}
export async function extractRuntime(
  archive: string,
  destination: string,
  runtime: NonNullable<ManagedReleaseManifest["runtimes"]["darwin-arm64"]>,
): Promise<string> {
  mkdirSync(destination, { mode: 0o700 });
  const name = runtime.name.replace(/\.(tar\.gz|zip)$/, "");
  if (process.platform === "win32")
    await capture("tar.exe", ["-xf", archive, "-C", destination], 4096);
  else await capture("tar", ["-xzf", archive, "-C", destination], 4096);
  const root = realpathSync(join(destination, name));
  let count = 0,
    total = 0;
  function inspect(path: string): void {
    const stat = lstatSync(path);
    if (
      ++count > 30_000 ||
      (total += stat.isFile() ? stat.size : 0) > 600 * 1024 * 1024
    )
      throw new Error("Runtime expansion limit exceeded.");
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      const rel = relative(root, realpathSync(resolve(dirname(path), target)));
      if (
        isAbsolute(target) ||
        rel === ".." ||
        rel.startsWith(`..${sep}`) ||
        isAbsolute(rel)
      )
        throw new Error("Unsafe runtime link.");
    } else if (stat.isDirectory())
      for (const entry of readdirSync(path)) inspect(join(path, entry));
    else if (!stat.isFile()) throw new Error("Unsafe runtime entry.");
  }
  inspect(root);
  return root;
}
