import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findForbiddenTrackedDataFiles } from "./release-contract.mjs";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const PLATFORM_KEYS = ["darwin-arm64", "darwin-x64", "linux-x64", "win-x64"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function unsafePath(path) {
  return (
    typeof path !== "string" ||
    !path ||
    path.length > 240 ||
    /[\\:<>"|?*]/u.test(path) ||
    [...path].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    path
      .split("/")
      .some(
        (part) =>
          !/^[a-zA-Z0-9_.@ -]+$/.test(part) ||
          part === "." ||
          part === ".." ||
          /[. ]$/u.test(part) ||
          /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part),
      )
  );
}
function privatePath(path) {
  return (
    path
      .split("/")
      .some(
        (part) =>
          [
            ".git",
            ".codex",
            ".agents",
            "node_modules",
            "dist",
            "coverage",
            "test-results",
            "playwright-report",
          ].includes(part.toLowerCase()) ||
          /^\.on-track-/i.test(part) ||
          (/^\.env(?:\.|$)/i.test(part) && part !== ".env.example"),
      ) || findForbiddenTrackedDataFiles([path]).length > 0
  );
}

/** Validate Git's regular-file inventory before allowing it into any archive. */
export function validateSourceEntries(entries) {
  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    entries.length > 10_000
  )
    throw new Error("Unsafe source inventory size.");
  const inventory = Object.create(null);
  const aliases = new Set();
  const componentSpellings = new Map();
  let size = 0;
  for (const entry of entries) {
    if (unsafePath(entry.path) || privatePath(entry.path))
      throw new Error("Unsafe or private source data path.");
    if (!["100644", "100755"].includes(entry.mode))
      throw new Error("Source assets may contain only regular files.");
    if (entry.path.split("/").includes(".gitattributes"))
      throw new Error(
        "Source Git export attributes require an explicit packaging review.",
      );
    const alias = entry.path.normalize("NFC").toLowerCase();
    if (aliases.has(alias))
      throw new Error("Source filenames have a platform alias.");
    aliases.add(alias);
    const components = entry.path.split("/");
    for (let index = 1; index <= components.length; index++) {
      const spelling = components.slice(0, index).join("/");
      const key = spelling.normalize("NFC").toLowerCase();
      if (
        componentSpellings.has(key) &&
        componentSpellings.get(key) !== spelling
      )
        throw new Error("Source path components have a platform alias.");
      componentSpellings.set(key, spelling);
    }
    if (!Buffer.isBuffer(entry.bytes) || entry.bytes.length > 20 * 1024 * 1024)
      throw new Error("Unsafe source file size.");
    size += entry.bytes.length;
    if (size > MAX_SOURCE_BYTES)
      throw new Error("Unsafe expanded source size.");
    inventory[entry.path] = {
      sha256: sha256(entry.bytes),
      size: entry.bytes.length,
    };
  }
  return inventory;
}

export function validateRuntimes(runtimes) {
  if (
    !runtimes ||
    Object.keys(runtimes).sort().join() !== PLATFORM_KEYS.toSorted().join()
  )
    throw new Error("Invalid runtime platform matrix.");
  const versions = new Set();
  for (const key of PLATFORM_KEYS) {
    const runtime = runtimes[key];
    if (
      !runtime ||
      typeof runtime.version !== "string" ||
      !/^24\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(runtime.version)
    )
      throw new Error("Invalid pinned runtime version.");
    versions.add(runtime.version);
    const name = `node-v${runtime.version}-${key}.${key === "win-x64" ? "zip" : "tar.gz"}`;
    if (
      runtime.name !== name ||
      runtime.url !==
        `https://nodejs.org/download/release/v${runtime.version}/${name}` ||
      !HASH.test(runtime.sha256) ||
      !Number.isSafeInteger(runtime.size) ||
      runtime.size < 1 ||
      runtime.size > 200 * 1024 * 1024
    )
      throw new Error("Invalid pinned runtime asset.");
  }
  if (versions.size !== 1)
    throw new Error(
      "Every managed runtime must use the same pinned Node patch.",
    );
}

function compareVersions(left, right) {
  const a = left.split(".").map(BigInt),
    b = right.split(".").map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

export function createManagedManifest({
  description,
  commit,
  minimumVersion,
  sourceBytes,
  sourceFiles,
  runtimes,
}) {
  if (
    !description ||
    !VERSION.test(description.version) ||
    description.releaseId !== `v${description.version}` ||
    description.protocol !== 1 ||
    !HASH.test(description.buildId) ||
    !Number.isSafeInteger(description.schemaVersion) ||
    description.schemaVersion < 1 ||
    !Number.isSafeInteger(description.migrationMarker) ||
    description.migrationMarker < 0 ||
    !/^[a-f0-9]{40}$/.test(commit)
  )
    throw new Error("Invalid committed release identity.");
  if (
    !VERSION.test(minimumVersion) ||
    compareVersions(minimumVersion, description.version) > 0
  )
    throw new Error("An explicit valid minimum managed version is required.");
  validateRuntimes(runtimes);
  if (
    !Buffer.isBuffer(sourceBytes) ||
    sourceBytes.length === 0 ||
    sourceBytes.length > MAX_SOURCE_BYTES
  )
    throw new Error("Invalid source archive size.");
  if (!sourceFiles || Object.keys(sourceFiles).length === 0)
    throw new Error("A nonempty source inventory is required.");
  const name = `on-track-${description.releaseId}.zip`;
  return {
    formatVersion: 1,
    managedProtocol: 1,
    browserApiProtocol: 1,
    migrationScope: "database-only",
    version: description.version,
    commit,
    buildId: description.buildId,
    schemaVersion: description.schemaVersion,
    migrationMarker: description.migrationMarker,
    minimumUpgradeVersion: minimumVersion,
    source: {
      name,
      url: `https://github.com/satankov/on-track/releases/download/${description.releaseId}/${name}`,
      sha256: sha256(sourceBytes),
      size: sourceBytes.length,
    },
    sourceFiles,
    runtimes,
  };
}

/** Produces assets from a clean, committed source tree. No network or user data. */
export async function packageManagedRelease({
  root = process.cwd(),
  output,
  minimumVersion,
  describe,
}) {
  if (!output || !VERSION.test(minimumVersion))
    throw new Error(
      "Use --output <empty-directory> --minimum-version <X.Y.Z>.",
    );
  root = realpathSync(root);
  const git = (args, encoding = "utf8") =>
    execFileSync("git", args, {
      cwd: root,
      encoding,
      maxBuffer: MAX_SOURCE_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const assertClean = () => {
    if (git(["status", "--porcelain=v1", "--untracked-files=all"]).trim())
      throw new Error(
        "Managed assets require a clean, fully committed source tree.",
      );
  };
  assertClean();
  const commit = git(["rev-parse", "HEAD"]).trim();
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error("Unsupported Git commit identity.");
  const infoAttributes = resolve(
    root,
    git(["rev-parse", "--git-path", "info/attributes"]).trim(),
  );
  if (existsSync(infoAttributes) && readFileSync(infoAttributes).length)
    throw new Error(
      "Local Git export attributes would change the release archive.",
    );
  const rows = git(["ls-tree", "-r", "-l", "-z", "--full-tree", commit])
    .split("\0")
    .filter(Boolean);
  if (rows.length > 10_000) throw new Error("Unsafe source inventory size.");
  let total = 0;
  const entries = rows.map((row) => {
    const match = row.match(
      /^(\d{6}) (blob|commit) ([a-f0-9]{40})\s+(\d+|-)\t([\s\S]+)$/,
    );
    if (
      !match ||
      match[2] !== "blob" ||
      !["100644", "100755"].includes(match[1])
    )
      throw new Error("Source assets may contain only regular files.");
    const size = Number(match[4]);
    total += size;
    if (
      !Number.isSafeInteger(size) ||
      size > 20 * 1024 * 1024 ||
      total > MAX_SOURCE_BYTES
    )
      throw new Error("Unsafe source file size.");
    return {
      path: match[5],
      mode: match[1],
      bytes: git(["cat-file", "blob", match[3]], null),
    };
  });
  const sourceFiles = validateSourceEntries(entries);
  for (const entry of entries) {
    const path = join(root, entry.path);
    if (
      !lstatSync(path).isFile() ||
      lstatSync(path).isSymbolicLink() ||
      !readFileSync(path).equals(entry.bytes)
    )
      throw new Error(
        "Working source changed while packaging the committed release.",
      );
  }
  const describeRelease =
    describe ??
    (
      await import(
        pathToFileURL(join(root, "dist/server/server/runtime/build-info.js"))
          .href
      )
    ).describeRuntime;
  const description = describeRelease(root);
  const pins = JSON.parse(
    readFileSync(join(root, "scripts/managed-runtime.json"), "utf8"),
  );
  if (pins.formatVersion !== 1)
    throw new Error("Unsupported managed runtime pin format.");
  const sourceBytes = git(
    [
      "-c",
      `core.attributesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
      "archive",
      "--format=zip",
      commit,
    ],
    null,
  );
  const manifest = createManagedManifest({
    description,
    commit,
    minimumVersion,
    sourceBytes,
    sourceFiles,
    runtimes: pins.runtimes,
  });
  const bootstrap = entries.find(
    (entry) => entry.path === "scripts/managed-bootstrap.mjs",
  )?.bytes;
  if (!bootstrap) throw new Error("Missing managed bootstrap release asset.");
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  const installers = ["install.sh", "install.ps1"].map((name) => {
    const bytes = entries.find(
      (entry) => entry.path === `scripts/${name}`,
    )?.bytes;
    const template = bytes?.toString("utf8");
    if (
      !template?.includes("__ONTRACK_RELEASE__") ||
      !template.includes("__ONTRACK_BOOTSTRAP_SHA256__") ||
      !template.includes("__ONTRACK_MANIFEST_SHA256__")
    )
      throw new Error("Missing versioned installer placeholders.");
    return {
      name,
      content: template
        .replaceAll("__ONTRACK_RELEASE__", description.releaseId)
        .replaceAll("__ONTRACK_BOOTSTRAP_SHA256__", sha256(bootstrap))
        .replaceAll("__ONTRACK_MANIFEST_SHA256__", sha256(manifestBytes)),
    };
  });
  assertClean();
  output = resolve(output);
  if (existsSync(output)) {
    if (
      lstatSync(output).isSymbolicLink() ||
      !lstatSync(output).isDirectory() ||
      readdirSync(output).length
    )
      throw new Error(
        "Managed release output must be an empty regular directory.",
      );
  } else mkdirSync(output, { recursive: true, mode: 0o700 });
  const write = (name, bytes) =>
    writeFileSync(join(output, name), bytes, { flag: "wx", mode: 0o600 });
  write(manifest.source.name, sourceBytes);
  write("managed-bootstrap.mjs", bootstrap);
  for (const installer of installers) write(installer.name, installer.content);
  write("managed-release.json", manifestBytes);
  const base = `https://github.com/satankov/on-track/releases/download/${description.releaseId}`;
  write(
    "INSTALL.md",
    [
      `# Install On Track ${description.releaseId}`,
      "",
      ...(description.version === "0.0.7"
        ? [
            "Experimental installer: real end-user installation and OS validation are deferred to the next release. Automated source and prepared lifecycle/recovery checks remain required. Manual Node/npm setup remains available.",
            "",
          ]
        : []),
      "Run one command for your OS. Setup downloads private Node, installs dependencies, and starts the local server in the background. It does not install a desktop app.",
      "",
      "## macOS and Linux",
      "",
      "```sh",
      `(installer=$(mktemp) && curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' '${base}/install.sh' --output "$installer" && bash "$installer"; result=$?; rm -f "$installer"; exit "$result")`,
      "```",
      "",
      "## Windows PowerShell",
      "",
      "```powershell",
      `$installer=Join-Path ([IO.Path]::GetTempPath()) ('ontrack-install-'+[guid]::NewGuid()+'.ps1'); try { Invoke-WebRequest -UseBasicParsing '${base}/install.ps1' -OutFile $installer; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer; if($LASTEXITCODE -ne 0){throw 'On Track installation failed'} } finally { Remove-Item -LiteralPath $installer -ErrorAction SilentlyContinue }`,
      "```",
      "",
      "Open a new terminal after installation. Use `ontrack run`, `ontrack stop`, or `ontrack update`. Background startup does not run automatically after a reboot.",
      "",
      "Manual setup remains available: install supported Node, extract the source ZIP, and run `npm run quickstart`. Later use `npm start`.",
      "",
      `[Full OS installation guides](https://github.com/satankov/on-track/tree/${description.releaseId}/docs/install)`,
      "",
    ].join("\n"),
  );
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2),
    options = {};
  try {
    for (let index = 0; index < args.length; index += 2) {
      const name = args[index],
        value = args[index + 1];
      if (
        !["--output", "--minimum-version"].includes(name) ||
        !value ||
        value.startsWith("--") ||
        name in options
      )
        throw new Error(
          "Use --output <empty-directory> --minimum-version <X.Y.Z>.",
        );
      options[name] = value;
    }
    const manifest = await packageManagedRelease({
      output: options["--output"],
      minimumVersion: options["--minimum-version"],
    });
    console.log(
      `Prepared managed release v${manifest.version}. Assets have not been published.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Managed packaging failed.",
    );
    process.exitCode = 1;
  }
}
