// Released alongside the shell bootstrap. No project data is opened here.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";
const publisher = "https://github.com/satankov/on-track/releases";
const digest = (data) => createHash("sha256").update(data).digest("hex");
function safePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 240 &&
    path
      .split("/")
      .every(
        (part) =>
          /^[a-zA-Z0-9_.@ -]+$/.test(part) &&
          part !== "." &&
          part !== ".." &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}
export function verifyManifestBytes(bytes, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected || "") || digest(bytes) !== expected)
    throw Error("Manifest checksum verification failed.");
  return validateSourceManifest(JSON.parse(bytes.toString()));
}
export async function getBytes(url, max, fetcher = globalThis.fetch) {
  let current = new URL(url);
  for (let count = 0; count < 5; count++) {
    if (
      current.protocol !== "https:" ||
      current.username ||
      current.password ||
      ![
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(current.hostname)
    )
      throw Error("Untrusted download address.");
    const response = await fetcher(current, {
      redirect: "manual",
      signal: globalThis.AbortSignal.timeout(120000),
    });
    if (response.status >= 300 && response.status < 400) {
      current = new URL(response.headers.get("location"), current);
      continue;
    }
    if (!response.ok || !response.body)
      throw Error("Could not download release.");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > max) throw Error("Download exceeds limit.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw Error("Too many download redirects.");
}
export function validateSourceManifest(value) {
  if (
    !value ||
    value.formatVersion !== 1 ||
    value.managedProtocol !== 1 ||
    value.browserApiProtocol !== 1 ||
    value.migrationScope !== "database-only" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version)
  )
    throw Error("Incompatible release manifest.");
  const source = value.source;
  if (
    !source ||
    source.name !== `on-track-v${value.version}.zip` ||
    source.url !== `${publisher}/download/v${value.version}/${source.name}` ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isSafeInteger(source.size) ||
    source.size < 1 ||
    source.size > 300 * 1024 * 1024
  )
    throw Error("Invalid source asset.");
  const files = Object.entries(value.sourceFiles || {});
  let total = 0;
  const aliases = new Set();
  if (!files.length || files.length > 10000)
    throw Error("Invalid source file count.");
  for (const [path, entry] of files) {
    const alias = path.toLowerCase();
    if (
      !safePath(path) ||
      aliases.has(alias) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > 20 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw Error("Unsafe source file.");
    aliases.add(alias);
    total += entry.size;
  }
  if (
    total > 100 * 1024 * 1024 ||
    !value.sourceFiles["package.json"] ||
    !value.sourceFiles["package-lock.json"]
  )
    throw Error("Invalid source contents.");
  return value;
}
function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    shell: false,
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    if (options.cwd) {
      const log = join(options.cwd, "installation-error.log");
      writeFileSync(
        log,
        Buffer.concat([
          result.stdout || Buffer.alloc(0),
          result.stderr || Buffer.alloc(0),
        ]).subarray(-65536),
        { mode: 0o600 },
      );
      throw Error("Release preparation failed. Diagnostic log: " + log);
    }
    throw Error("Release preparation failed.");
  }
  return result.stdout;
}
export function extractSource(archive, destination, files) {
  mkdirSync(destination, { mode: 0o700 });
  if (process.platform === "win32") {
    const policy = join(dirname(destination), "source-policy.json");
    writeFileSync(policy, JSON.stringify(files));
    const script = `$ErrorActionPreference='Stop';$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules');Add-Type -AssemblyName System.IO.Compression.FileSystem;$z=[IO.Compression.ZipFile]::OpenRead($args[0]);try{$p=Get-Content -Raw -LiteralPath $args[2]|ConvertFrom-Json;$seen=@{};foreach($e in $z.Entries){$n=$e.FullName;if($n.EndsWith('/')){continue};if($seen.ContainsKey($n)-or -not $p.PSObject.Properties[$n]){throw 'Invalid entry'};$seen[$n]=$true;$v=$p.PSObject.Properties[$n].Value;if($e.Length-ne $v.size-or (($e.ExternalAttributes-shr 16)-band 61440)-eq 40960){throw 'Unsafe entry'};$s=$e.Open();try{$m=New-Object IO.MemoryStream;$buffer=New-Object byte[] 65536;$total=0;while(($count=$s.Read($buffer,0,$buffer.Length))-gt 0){$total+=$count;if($total-gt $v.size){throw 'Expansion limit'};$m.Write($buffer,0,$count)};$b=$m.ToArray();$h=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)).Replace('-','').ToLower();if($h-ne $v.sha256){throw 'Hash mismatch'};$out=Join-Path $args[1] $n;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($out))|Out-Null;[IO.File]::WriteAllBytes($out,$b)}finally{$s.Dispose()}};if($seen.Count-ne ($p.PSObject.Properties|Measure-Object).Count){throw 'Missing entries'}}finally{$z.Dispose()}`;
    const ps = join(dirname(destination), "extract.ps1");
    writeFileSync(ps, script);
    command("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      ps,
      archive,
      destination,
      policy,
    ]);
    return;
  }
  const names = command("unzip", ["-Z1", archive])
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .filter((p) => !p.endsWith("/"));
  if (
    names.length !== Object.keys(files).length ||
    new Set(names).size !== names.length ||
    names.some((p) => !Object.hasOwn(files, p))
  )
    throw Error("Unexpected archive entries.");
  const types = command("zipinfo", ["-l", archive]).toString("utf8");
  if (/^l/m.test(types)) throw Error("Source symlinks are forbidden.");
  for (const name of names) {
    const data = command("unzip", ["-p", archive, name]);
    if (data.length !== files[name].size || digest(data) !== files[name].sha256)
      throw Error("Source integrity mismatch.");
    const path = join(destination, name);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, data, { flag: "wx", mode: 0o600 });
  }
}
async function main() {
  const [rootArgument, runtimeDirectory, ...options] = process.argv.slice(2);
  const root = realpathSync(resolve(rootArgument));
  const release = process.env.ONTRACK_BOOTSTRAP_RELEASE;
  if (!/^v\d+\.\d+\.\d+$/.test(release || ""))
    throw Error("Use a published, versioned installer.");
  const manifest = verifyManifestBytes(
    await getBytes(
      `${publisher}/download/${release}/managed-release.json`,
      2 * 1024 * 1024,
    ),
    process.env.ONTRACK_BOOTSTRAP_MANIFEST_SHA256,
  );
  if ("v" + manifest.version !== release)
    throw Error("Release identity mismatch.");
  const stage = mkdtempSync(join(root, "bootstrap-source."));
  const archive = join(stage, "source.zip");
  const bytes = await getBytes(manifest.source.url, manifest.source.size);
  if (
    bytes.length !== manifest.source.size ||
    digest(bytes) !== manifest.source.sha256
  )
    throw Error("Source checksum mismatch.");
  writeFileSync(archive, bytes, { flag: "wx", mode: 0o600 });
  const source = join(stage, "source");
  extractSource(archive, source, manifest.sourceFiles);
  const manifestPath = join(stage, "managed-release.json");
  writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^npm_/i.test(key) || key === "NODE_OPTIONS" || key === "NODE_ENV")
      delete env[key];
  env.PATH =
    dirname(process.execPath) +
    (process.platform === "win32" ? ";" : ":") +
    env.PATH;
  env.npm_config_cache = join(stage, "npm-cache");
  env.npm_config_userconfig = join(stage, "npmrc");
  env.npm_config_globalconfig = join(stage, "global-npmrc");
  writeFileSync(
    env.npm_config_userconfig,
    "registry=https://registry.npmjs.org/\n",
  );
  writeFileSync(env.npm_config_globalconfig, "");
  const npm = join(
    runtimeDirectory,
    process.platform === "win32"
      ? "node_modules/npm/bin/npm-cli.js"
      : "lib/node_modules/npm/bin/npm-cli.js",
  );
  console.log("Installing dependencies…");
  command(process.execPath, [npm, "ci", "--include=dev"], {
    cwd: source,
    env,
    stdio: "pipe",
  });
  console.log("Building On Track…");
  command(process.execPath, [npm, "run", "build"], {
    cwd: source,
    env,
    stdio: "pipe",
  });
  command(
    process.execPath,
    [
      join(source, "dist/server/server/cli/main.js"),
      "install",
      "--root",
      root,
      "--release-dir",
      source,
      "--runtime-dir",
      runtimeDirectory,
      "--manifest",
      manifestPath,
      ...options,
    ],
    { cwd: source, env, stdio: "inherit" },
  );
  rmSync(stage, { recursive: true });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
