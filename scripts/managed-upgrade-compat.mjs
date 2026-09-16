import assert from "node:assert/strict";
import { createFixtureArchive } from "./managed-upgrade-archive.mjs";
import { windowsFixtureCommand } from "./managed-upgrade-commands.mjs";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  createManagedManifest,
  validateSourceEntries,
} from "./managed-release.mjs";
import {
  publisherFixture,
  startPublisherProxy,
} from "./managed-upgrade-transport.mjs";

// Test-only version in disposable source copies. Never a release selection.
const candidateVersion = "99.0.0";
const baseline = {
  tag: "v0.0.8",
  source: "6c1dacd664f892612d9e9ad27cc83a3f952d3f41d2857975b69472038a61cdd0",
  manifest: "fa8010b2facf17373045392f1ea2780dc306d623512a19566d9a6a8692a1033a",
};
const repository = resolve(import.meta.dirname, "..");
const execute = promisify(execFile);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
assert.equal(
  args[0],
  "--baseline",
  "Usage: node scripts/managed-upgrade-compat.mjs --baseline v0.0.8 [--cache /absolute/path]",
);
assert.equal(
  args[1],
  baseline.tag,
  "Only the checksum-pinned v0.0.8 baseline is supported.",
);
assert(args.length === 2 || (args.length === 4 && args[2] === "--cache"));
const base = realpathSync(
  mkdtempSync(join(tmpdir(), "threadstr-baseline-upgrade-")),
);
const cache = args[3] ? resolve(args[3]) : join(base, "downloads");
mkdirSync(cache, { recursive: true });
const home = join(base, "disposable home é");
mkdirSync(home);
const environment = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  APPDATA: join(home, "AppData/Roaming"),
  LOCALAPPDATA: join(home, "AppData/Local"),
  XDG_DATA_HOME: join(home, ".local/share"),
};
for (const name of [
  "ON_TRACK_DATA_DIR",
  "ON_TRACK_PORT",
  "ON_TRACK_MANAGED_LAUNCH",
  "ON_TRACK_INSTALL_ROOT",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "NODE_USE_ENV_PROXY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "https_proxy",
  "http_proxy",
  "all_proxy",
  "no_proxy",
  "NO_PROXY",
  "NODE_TLS_REJECT_UNAUTHORIZED",
])
  delete environment[name];
let proxy;
let node;
let runtime;
let oldSource;
const roots = [];
const step = (message) => console.log(`Baseline upgrade: ${message}`);
async function run(executable, argv, options = {}) {
  try {
    return await execute(executable, argv, {
      cwd: repository,
      env: environment,
      timeout: 900_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      ...options,
    });
  } catch (error) {
    throw new Error(
      `Fixture command failed: ${executable} ${argv.slice(0, 2).join(" ")}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`,
      { cause: error },
    );
  }
}
async function asset(url, expected, name) {
  const path = join(cache, name);
  if (!existsSync(path)) {
    const temporary = join(base, name + ".download");
    // curl follows GitHub's signed release-asset redirects; pinned digests remain
    // authoritative. Downloading does not alter any remote resource.
    await run(process.platform === "win32" ? "curl.exe" : "curl", [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--proto",
      "=https",
      "--proto-redir",
      "=https",
      "--max-time",
      "300",
      "--output",
      temporary,
      url,
    ]);
    const bytes = readFileSync(temporary);
    assert.equal(digest(bytes), expected, `Checksum mismatch: ${name}`);
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  }
  const stat = lstatSync(path);
  assert(
    stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
    "Unsafe cached artifact",
  );
  assert.equal(
    digest(readFileSync(path)),
    expected,
    `Checksum mismatch: ${name}`,
  );
  return path;
}
async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const result = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return result;
}
function cliPath(source) {
  return join(source, "dist/server/server/cli/main.js");
}
function launcher(root, name) {
  return join(root, "bin", name + (process.platform === "win32" ? ".cmd" : ""));
}
async function command(root, name, argv, extra = {}) {
  const executable = launcher(root, name);
  if (process.platform === "win32") {
    return run(
      environment.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", windowsFixtureCommand(name, argv)],
      { ...extra, cwd: join(root, "bin"), windowsVerbatimArguments: true },
    );
  }
  return run(executable, argv, extra);
}
async function query(source, database, code) {
  return (
    await run(
      node,
      [
        "--input-type=module",
        "-e",
        `import Database from 'better-sqlite3'; const db = new Database(process.argv[1]); try { ${code} } finally { db.close(); }`,
        database,
      ],
      { cwd: source },
    )
  ).stdout.trim();
}
async function inspect(source, database) {
  return JSON.parse(
    await query(
      source,
      database,
      `console.log(JSON.stringify(Object.fromEntries(['app_metadata','chats','notes','note_attachments','chat_enabled_labels','note_labels'].map(name => [name,db.prepare('SELECT * FROM '+name+' ORDER BY 1').all()]))));`,
    ),
  );
}
async function request(url, path, options = {}) {
  const response = await globalThis.fetch(url + path, {
    ...options,
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  assert(
    response.ok,
    `${path}: HTTP ${response.status} ${await (response.ok ? Promise.resolve("") : response.text())}`,
  );
  return response;
}
async function install(root, source, manifest, data, savedPort) {
  await run(
    node,
    [
      join(repository, "scripts/managed-upgrade-cli.mjs"),
      cliPath(source),
      "install",
      "--root",
      root,
      "--release-dir",
      source,
      "--runtime-dir",
      runtime,
      "--manifest",
      manifest,
      "--data-dir",
      data,
      "--port",
      String(savedPort),
      "--no-profile",
      "--no-open",
    ],
    { cwd: source },
  );
}
try {
  step(
    "download and verify immutable v0.0.8 manifest, source, and official Node bytes",
  );
  const downloadBase = `https://github.com/satankov/on-track/releases/download/${baseline.tag}`;
  const manifestPath = await asset(
    `${downloadBase}/managed-release.json`,
    baseline.manifest,
    "v0.0.8-managed-release.json",
  );
  const oldManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sourceArchive = await asset(
    `${downloadBase}/on-track-v0.0.8.zip`,
    baseline.source,
    "on-track-v0.0.8.zip",
  );
  const platform = `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
  const runtimeAsset = oldManifest.runtimes[platform];
  assert(runtimeAsset, `No baseline runtime for ${platform}`);
  assert.equal(runtimeAsset.version, "24.14.0");
  const runtimeArchive = await asset(
    runtimeAsset.url,
    runtimeAsset.sha256,
    runtimeAsset.name,
  );
  const { extractVerifiedSource, extractRuntime } = await import(
    pathToFileURL(join(repository, "dist/server/server/cli/archive.js"))
  );
  const { describeRuntime } = await import(
    pathToFileURL(join(repository, "dist/server/server/runtime/build-info.js"))
  );
  oldSource = join(base, "published-source");
  await extractVerifiedSource(sourceArchive, oldSource, oldManifest);
  assert.equal(describeRuntime(oldSource).buildId, oldManifest.buildId);
  runtime = await extractRuntime(
    runtimeArchive,
    join(base, "private-runtime"),
    runtimeAsset,
  );
  node = join(runtime, process.platform === "win32" ? "node.exe" : "bin/node");
  step("verify candidate Unicode retention with the pinned baseline Node");
  const retention = await run(node, [
    join(repository, "scripts/managed-retain-smoke.mjs"),
  ]);
  console.log(retention.stdout.trim());
  const npm = join(
    runtime,
    process.platform === "win32"
      ? "node_modules/npm/bin/npm-cli.js"
      : "lib/node_modules/npm/bin/npm-cli.js",
  );
  const buildEnv = {
    ...environment,
    PATH: [dirname(node), environment.PATH].join(delimiter),
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
  step("build unchanged published source with its locked dependencies");
  await run(node, [npm, "ci", "--include=dev", "--no-audit", "--no-fund"], {
    cwd: oldSource,
    env: buildEnv,
  });
  await run(node, [npm, "run", "build"], { cwd: oldSource, env: buildEnv });
  for (const [path, expected] of Object.entries(oldManifest.sourceFiles))
    assert.equal(
      digest(readFileSync(join(oldSource, path))),
      expected.sha256,
      `Published source changed: ${path}`,
    );

  step(
    "snapshot working candidate source; override version only inside the fixture",
  );
  const candidate = join(base, "candidate-source");
  mkdirSync(candidate);
  const files = (
    await run("git", [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ])
  ).stdout
    .split("\0")
    .filter(Boolean);
  const entries = files.map((path) => {
    const stat = lstatSync(join(repository, path));
    assert(
      stat.isFile() && !stat.isSymbolicLink(),
      `Unsafe fixture source: ${path}`,
    );
    return {
      path,
      mode: stat.mode & 0o111 ? "100755" : "100644",
      bytes: readFileSync(join(repository, path)),
    };
  });
  validateSourceEntries(entries);
  for (const entry of entries) {
    const target = join(candidate, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.bytes, {
      mode: entry.mode === "100755" ? 0o755 : 0o644,
    });
  }
  for (const name of ["package.json", "package-lock.json"]) {
    const path = join(candidate, name),
      value = JSON.parse(readFileSync(path, "utf8"));
    value.version = candidateVersion;
    if (value.packages?.[""]) value.packages[""].version = candidateVersion;
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  }
  const sourceFiles = validateSourceEntries(
    entries.map((entry) => ({
      ...entry,
      bytes: readFileSync(join(candidate, entry.path)),
    })),
  );
  const zip = join(base, `on-track-v${candidateVersion}.zip`);
  createFixtureArchive(candidate, zip);
  const zipBytes = readFileSync(zip);
  const candidateManifest = createManagedManifest({
    description: describeRuntime(candidate),
    commit: "f".repeat(40),
    minimumVersion: "0.0.7",
    sourceBytes: zipBytes,
    sourceFiles,
    runtimes: oldManifest.runtimes,
  });
  step("verify generated candidate archive before exercising the updater");
  const archiveCheck = join(base, "candidate-archive-check");
  mkdirSync(archiveCheck);
  await extractVerifiedSource(
    zip,
    join(archiveCheck, "source"),
    candidateManifest,
  );
  const candidateManifestPath = join(base, "candidate-manifest.json");
  writeFileSync(candidateManifestPath, JSON.stringify(candidateManifest));

  const key = join(base, "test-only-key.pem"),
    cert = join(base, "test-only-cert.pem");
  const openssl =
    process.platform === "win32" &&
    existsSync("C:/Program Files/Git/usr/bin/openssl.exe")
      ? "C:/Program Files/Git/usr/bin/openssl.exe"
      : "openssl";
  await run(openssl, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    key,
    "-out",
    cert,
    "-subj",
    "/CN=threadstr disposable upgrade fixture",
    "-addext",
    "subjectAltName=DNS:github.com,DNS:api.github.com",
  ]);
  proxy = await startPublisherProxy({
    key: readFileSync(key),
    cert: readFileSync(cert),
    lookup: publisherFixture(candidateManifest, zipBytes),
  });
  const proxyEnv = {
    ...environment,
    HTTPS_PROXY: proxy.url,
    HTTP_PROXY: proxy.url,
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    NODE_USE_ENV_PROXY: "1",
    NODE_EXTRA_CA_CERTS: cert,
  };

  let builtCandidate;
  for (const state of ["running", "stopped", "installer"]) {
    // The immutable v0.0.8 copier mishandles Unicode paths on Windows with
    // Node 24.14. Keep its installation path ASCII; the mandatory candidate
    // retention check above covers Unicode using that same pinned runtime.
    const root = join(
        base,
        `${state} Runtime with spaces${process.platform === "win32" ? "" : " é"}`,
      ),
      data = join(base, `${state} Data with spaces é`);
    const savedPort = await port(),
      url = `http://127.0.0.1:${savedPort}`;
    roots.push(root);
    step(`${state}: install the actual v0.0.8 CLI and seed persisted data`);
    await install(root, oldSource, manifestPath, data, savedPort);
    assert(
      !existsSync(launcher(root, "thr")),
      "Baseline must not already have thr",
    );
    assert.match(
      (await command(root, "ontrack", ["--help"])).stdout,
      /On Track/,
    );
    await command(root, "ontrack", ["stop"]);
    const dbPath = join(data, "on-track.sqlite");
    await query(
      oldSource,
      dbPath,
      `db.exec("INSERT INTO chats(id,title,accent,created_at,updated_at,pinned_at) VALUES('kept','Kept project','ocean',10,20,30); INSERT INTO chats(id,title,accent,created_at,updated_at,archived_at) VALUES('archived','Archived project','moss',10,20,30); INSERT INTO notes(id,chat_id,body,created_at,sender) VALUES('note','kept','Saved before rename',20,'Alex'); INSERT INTO chat_enabled_labels VALUES('kept','todo'); INSERT INTO note_labels VALUES('note','todo'); INSERT INTO note_attachments(id,note_id,filename,media_type,storage_path,byte_size,modified_at,created_at) VALUES('file','note','kept.txt','text/plain','attachments/v1/fixture/file/kept.txt',10,20,20)");`,
    );
    const attachment = join(data, "attachments/v1/fixture/file/kept.txt");
    mkdirSync(dirname(attachment), { recursive: true, mode: 0o700 });
    writeFileSync(attachment, "Keep bytes", { mode: 0o600 });
    // Whole-second fixture time survives filesystem restore precision exactly.
    utimesSync(attachment, 1_700_000_000, 1_700_000_000);
    await query(
      oldSource,
      dbPath,
      `db.prepare("UPDATE note_attachments SET modified_at = ? WHERE id = ?").run(${Math.trunc(statSync(attachment).mtimeMs)}, "file");`,
    );
    await command(root, "ontrack", ["run", "--no-open"]);
    const backup = Buffer.from(
      await (await request(url, "/api/database/export")).arrayBuffer(),
    );
    const original = await inspect(oldSource, dbPath);
    const installBytes = readFileSync(join(root, "install.json"));
    const oldLauncher = readFileSync(launcher(root, "ontrack"));
    const dispatcher = readFileSync(join(root, "bin/command.mjs"));
    const shim = readFileSync(join(root, "shim-runtime.json"));
    if (state === "stopped") await command(root, "ontrack", ["stop"]);
    if (state === "running") {
      step(
        "running: unrelated thr causes precommit refusal and old selection recovery",
      );
      writeFileSync(launcher(root, "thr"), "unrelated executable fixture\n", {
        mode: 0o700,
      });
      await assert.rejects(
        command(
          root,
          "ontrack",
          ["update", `v${candidateVersion}`, "--yes", "--no-open"],
          { env: proxyEnv },
        ),
      );
      assert.equal(
        JSON.parse(readFileSync(join(root, "active.json"))).releaseId,
        baseline.tag,
      );
      assert.equal(
        readFileSync(launcher(root, "thr"), "utf8"),
        "unrelated executable fixture\n",
      );
      assert.deepEqual(await inspect(oldSource, dbPath), original);
      assert.match(
        (await command(root, "ontrack", ["status"])).stdout,
        /0\.0\.8: ready/,
      );
      rmSync(launcher(root, "thr"));
    }
    if (state === "installer") {
      assert(builtCandidate, "The prior upgrade must prepare the candidate");
      step(
        "installer: upgrade the v0.0.8 installation directly with the candidate prepared installer",
      );
      await install(
        root,
        builtCandidate,
        candidateManifestPath,
        data,
        savedPort,
      );
    } else {
      step(
        `${state}: run untouched ontrack update through the controlled publisher transport`,
      );
      await command(
        root,
        "ontrack",
        [
          "update",
          ...(state === "running" ? [`v${candidateVersion}`] : []),
          "--yes",
          "--no-open",
        ],
        { env: proxyEnv },
      );
    }
    assert.equal(
      JSON.parse(readFileSync(join(root, "active.json"))).releaseId,
      `v${candidateVersion}`,
    );
    assert(
      existsSync(launcher(root, "thr")),
      "Old-client upgrade did not provision thr",
    );
    assert.deepEqual(readFileSync(join(root, "install.json")), installBytes);
    assert.deepEqual(readFileSync(launcher(root, "ontrack")), oldLauncher);
    assert.deepEqual(readFileSync(join(root, "bin/command.mjs")), dispatcher);
    assert.deepEqual(readFileSync(join(root, "shim-runtime.json")), shim);
    for (const name of ["thr", "ontrack"]) {
      assert.match((await command(root, name, ["--help"])).stdout, /threadstr/);
      assert.match(
        (await command(root, name, ["status"])).stdout,
        /99\.0\.0: ready/,
      );
      await command(root, name, ["run", "--no-open"]);
    }
    assert.deepEqual(await inspect(oldSource, dbPath), original);
    assert.equal(readFileSync(attachment, "utf8"), "Keep bytes");
    await assert.rejects(
      run(node, [join(oldSource, "dist/server/server/main.js")], {
        cwd: oldSource,
        env: {
          ...environment,
          ON_TRACK_DATA_DIR: data,
          ON_TRACK_PORT: String(await port()),
        },
        timeout: 15_000,
      }),
      /already in use|another instance/i,
      "Old manual code must not open data owned by the renamed running server",
    );
    await request(url, "/api/database/import", {
      method: "PUT",
      headers: {
        origin: url,
        "content-type": "application/vnd.on-track.backup+sqlite",
      },
      body: backup,
    });
    const restored = await inspect(oldSource, dbPath);
    const logical = (snapshot) => ({
      ...snapshot,
      note_attachments: snapshot.note_attachments.map(
        ({ storage_path, ...metadata }) => {
          assert(storage_path);
          return metadata;
        },
      ),
    });
    assert.deepEqual(logical(restored), logical(original));
    assert.equal(
      readFileSync(
        join(data, restored.note_attachments[0].storage_path),
        "utf8",
      ),
      "Keep bytes",
    );
    const form = new globalThis.FormData();
    form.set("body", "Saved after committed upgrade");
    await request(url, "/api/chats/kept/notes", {
      method: "POST",
      headers: { origin: url },
      body: form,
    });
    const postcommit = await inspect(oldSource, dbPath);
    assert(
      postcommit.notes.some(
        (note) => note.body === "Saved after committed upgrade",
      ),
    );
    // The prepared installer is the same entry point used by the bootstrap;
    // repeat it against the existing root and require stable configuration.
    const activeSource = join(root, "releases", `v${candidateVersion}`);
    builtCandidate = activeSource;
    await install(root, activeSource, candidateManifestPath, data, savedPort);
    assert.deepEqual(readFileSync(join(root, "install.json")), installBytes);
    await command(root, "thr", ["stop"]);
    await command(root, "ontrack", ["run", "--no-open"]);
    assert.deepEqual(await inspect(oldSource, dbPath), postcommit);
    await command(root, "thr", ["stop"]);
    step(
      `${state}: upgrade, aliases, retained state/bytes, old backup restore, installer rerun and restart passed`,
    );
  }
  assert(
    proxy.requests.some((url) =>
      url.endsWith(`/on-track-v${candidateVersion}.zip`),
    ),
  );
  step(
    "PASS. Controlled publisher transport only; native shell profiles, browser preferences, online bootstrap and live published-to-published upgrade remain separate gates.",
  );
} catch (error) {
  // Inventory only disposable fixture runtimes; never dump operational records
  // (which contain control credentials) or real user data into CI logs.
  for (const root of roots) {
    const directory = join(root, "runtimes");
    try {
      const inventory = readdirSync(directory)
        .slice(0, 16)
        .map((name) => {
          const target = join(directory, name);
          const executable = join(
            target,
            process.platform === "win32" ? "node.exe" : "bin/node",
          );
          try {
            const stat = lstatSync(executable);
            return {
              name,
              executable: {
                size: stat.size,
                regular: stat.isFile(),
                links: stat.nlink,
              },
            };
          } catch (failure) {
            return {
              name,
              error: failure.code,
              entries: lstatSync(target).isDirectory()
                ? readdirSync(target).slice(0, 16)
                : [],
            };
          }
        });
      console.error("Fixture runtime inventory:", JSON.stringify(inventory));
    } catch (failure) {
      console.error("Fixture runtime inventory unavailable:", failure.code);
    }
  }
  for (const root of roots)
    for (const name of ["preparation.log", "server.log"]) {
      const log = join(root, "logs", name);
      if (existsSync(log))
        console.error(readFileSync(log, "utf8").slice(-8192));
    }
  throw error;
} finally {
  let safe = true;
  for (const root of roots)
    if (existsSync(join(root, "install.json"))) {
      try {
        await command(root, "ontrack", ["stop"]);
      } catch {
        try {
          await run(node, [cliPath(oldSource), "stop", "--root", root], {
            cwd: oldSource,
          });
        } catch {
          safe = false;
        }
      }
    }
  await proxy?.close();
  if (safe) rmSync(base, { recursive: true, force: true });
  else {
    console.error(
      `Fixture retained for authenticated shutdown/recovery: ${base}`,
    );
    process.exitCode = 1;
  }
}
