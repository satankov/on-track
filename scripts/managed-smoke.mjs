import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";

// Prepared-artifact integration test, deliberately separate from online bootstrap
// verification. Every process, write, and dependency junction is disposable.
const repository = resolve(import.meta.dirname, "..");
const compiled = join(repository, "dist/server/server");
assert(
  existsSync(join(compiled, "cli/main.js")),
  "Run npm run build before this smoke test.",
);
const { describeRuntime } = await import(
  pathToFileURL(join(compiled, "runtime/build-info.js"))
);
const { acquireInstanceOwner } = await import(
  pathToFileURL(join(compiled, "runtime/instance-owner.js"))
);
const { managedStatus, stopManaged } = await import(
  pathToFileURL(join(compiled, "cli/process.js"))
);
const { activatePrepared } = await import(
  pathToFileURL(join(compiled, "cli/update.js"))
);
const {
  managedPaths,
  readActiveRelease,
  selectActiveRelease,
  writeInstallState,
} = await import(pathToFileURL(join(compiled, "cli/state.js")));
const { openDatabase } = await import(
  pathToFileURL(join(compiled, "db/database.js"))
);
const execute = promisify(execFile);
const base = realpathSync(
  mkdtempSync(join(tmpdir(), "ontrack-managed-smoke-")),
);
const root = join(base, "Runtime with spaces — test");
const dataDirectory = join(base, "Data with spaces — test");
const databasePath = join(dataDirectory, "on-track.sqlite");
const environment = { ...process.env };
for (const name of [
  "ON_TRACK_DATA_DIR",
  "ON_TRACK_PORT",
  "ON_TRACK_MANAGED_LAUNCH",
  "ON_TRACK_INSTALL_ROOT",
  "NODE_OPTIONS",
])
  delete environment[name];
let completed = false;

function step(message) {
  console.log(`Managed smoke: ${message}`);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}
async function command(executable, args, options = {}) {
  return execute(executable, args, {
    cwd: repository,
    env: environment,
    timeout: 45_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    ...options,
  });
}
function copyRelease(version) {
  const destination = join(root, "releases", `v${version}`);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const input of [
    "src",
    "dist",
    "drizzle",
    "public",
    "package.json",
    "package-lock.json",
    "index.html",
    "tsconfig.json",
    "tsconfig.server.json",
    "vite.config.ts",
  ]) {
    if (existsSync(join(repository, input)))
      cpSync(join(repository, input), join(destination, input), {
        recursive: true,
        dereference: false,
      });
  }
  // Reuse the already-installed test dependencies. This is not a clean-machine
  // native dependency install claim; the CI install step tests npm ci separately.
  symlinkSync(
    join(repository, "node_modules"),
    join(destination, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  return destination;
}
async function cli(...args) {
  const paths = managedPaths(root, readActiveRelease(root));
  return command(paths.node, [paths.cli, ...args, "--root", root], {
    cwd: paths.releaseDirectory,
  });
}
function inspectDatabase() {
  const sqlite = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return {
      schema: sqlite
        .prepare("SELECT schema_version FROM app_metadata WHERE id = 1")
        .pluck()
        .get(),
      notes: sqlite
        .prepare("SELECT id, body, sender FROM notes ORDER BY id")
        .all(),
      attachments: sqlite
        .prepare("SELECT id, storage_path FROM note_attachments ORDER BY id")
        .all(),
    };
  } finally {
    sqlite.close();
  }
}
async function jsonRequest(url, pathname, init) {
  const response = await globalThis.fetch(`${url}${pathname}`, {
    ...init,
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  assert(response.ok, `HTTP ${response.status} for ${pathname}`);
  return response.json();
}
async function fixtureRelease(version, baseline, failAfterMigration) {
  const release = copyRelease(version);
  const manifestPath = join(release, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const lockPath = join(release, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.version = version;
  lock.packages[""].version = version;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  const sourcePath = join(release, "src/server/db/database.ts");
  let source = readFileSync(sourcePath, "utf8");
  assert(/const CURRENT_SCHEMA_VERSION\s*=\s*\d+/.test(source));
  source = source.replace(
    /const CURRENT_SCHEMA_VERSION\s*=\s*\d+/,
    `const CURRENT_SCHEMA_VERSION = ${baseline.schemaVersion + 1}`,
  );
  source = source.replace(
    /LATEST_BUNDLED_MIGRATION_AT\s*=\s*[\d_]+/,
    `LATEST_BUNDLED_MIGRATION_AT = ${baseline.migrationMarker + 1}`,
  );
  if (failAfterMigration) {
    assert(source.includes("return sqlite;"));
    source = source.replace(
      "return sqlite;",
      'sqlite.close(); throw new Error("Smoke fixture failed after database migration");',
    );
  }
  writeFileSync(sourcePath, source);
  const migrationPath = join(release, "drizzle/meta/_journal.json");
  const journal = JSON.parse(readFileSync(migrationPath, "utf8"));
  const tag = `${String(journal.entries.length).padStart(4, "0")}_managed_smoke_fixture`;
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: baseline.migrationMarker + 1,
    tag,
    breakpoints: true,
  });
  writeFileSync(migrationPath, JSON.stringify(journal));
  writeFileSync(
    join(release, "drizzle", `${tag}.sql`),
    `UPDATE app_metadata SET schema_version = ${baseline.schemaVersion + 1} WHERE id = 1;\n`,
  );
  assert(
    process.env.npm_execpath,
    "Run this test through its npm script so fixture builds use the same npm CLI.",
  );
  await command(process.execPath, [process.env.npm_execpath, "run", "build"], {
    cwd: release,
    timeout: 120_000,
  });
  return { protocol: 1, releaseId: `v${version}`, runtimeId };
}
async function activate(selection) {
  const owner = acquireInstanceOwner(root, {
    filename: ".on-track-install-owner.sqlite",
  });
  try {
    await activatePrepared(root, selection, {
      confirm: async () => true,
      progress: step,
    });
  } finally {
    owner.release();
  }
}

const baseline = describeRuntime(repository);
const platform = process.platform === "win32" ? "win" : process.platform;
const runtimeId = `node-v${process.versions.node}-${platform}-${process.arch}`;
try {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(dataDirectory, { mode: 0o700 });
  const initial = { protocol: 1, releaseId: baseline.releaseId, runtimeId };
  copyRelease(baseline.version);
  const privateNode = managedPaths(root, initial).node;
  mkdirSync(dirname(privateNode), { recursive: true, mode: 0o700 });
  copyFileSync(process.execPath, privateNode);
  writeInstallState(root, {
    protocol: 1,
    dataDirectory,
    port: await freePort(),
  });
  selectActiveRelease(root, initial);
  const sqlite = openDatabase(databasePath);
  sqlite.exec(
    "INSERT INTO chats(id,title,accent,created_at,updated_at,pinned_at) VALUES('smoke-project','Managed smoke','ocean',10,20,30); INSERT INTO notes(id,chat_id,body,created_at,sender) VALUES('smoke-note','smoke-project','Saved before update',20,'Alex'); INSERT INTO note_attachments(id,note_id,filename,media_type,storage_path,byte_size,modified_at,created_at) VALUES('smoke-file','smoke-note','kept.txt','text/plain','attachments/v1/smoke/kept.txt',10,20,20), ('smoke-missing','smoke-note','missing.txt','text/plain','attachments/v1/smoke/missing.txt',10,20,20)",
  );
  sqlite.close();
  const attachment = join(dataDirectory, "attachments/v1/smoke/kept.txt");
  mkdirSync(dirname(attachment), { recursive: true });
  writeFileSync(attachment, "Keep bytes");
  const original = inspectDatabase();

  step(
    "start returns while its server remains ready after the CLI process exits",
  );
  assert.match((await cli("run", "--no-open")).stdout, /running/i);
  const first = await managedStatus(root);
  assert.equal(first?.state, "ready");
  assert.equal(first.buildId, baseline.buildId);
  await jsonRequest(first.url, "/api/health");
  await cli("run", "--no-open");
  assert.equal((await managedStatus(root)).nonce, first.nonce);
  assert.match((await cli("status")).stdout, /ready/);
  const paths = managedPaths(root, initial);
  await assert.rejects(
    command(paths.node, [paths.entry], {
      cwd: paths.releaseDirectory,
      env: {
        ...environment,
        ON_TRACK_DATA_DIR: dataDirectory,
        ON_TRACK_PORT: String(await freePort()),
      },
      timeout: 15_000,
    }),
    (error) => /already in use|another instance/i.test(error.stderr ?? ""),
    "A competing manual server on another port must fail before opening data.",
  );
  assert.equal((await managedStatus(root)).nonce, first.nonce);
  await cli("stop");
  await cli("stop");
  assert.equal(await managedStatus(root), undefined);
  assert.deepEqual(inspectDatabase(), original);
  await cli("run", "--no-open");
  assert.equal((await managedStatus(root)).state, "ready");

  if (process.argv.includes("--updates")) {
    const [major, minor, patch] = baseline.version.split(".").map(Number);
    step("build a failing candidate that applies a real schema migration");
    const failing = await fixtureRelease(
      `${major}.${minor}.${patch + 1}`,
      baseline,
      true,
    );
    await assert.rejects(activate(failing));
    assert.deepEqual(readActiveRelease(root), initial);
    assert.deepEqual(inspectDatabase(), original);
    assert.equal((await managedStatus(root)).buildId, baseline.buildId);
    assert.equal(readFileSync(attachment, "utf8"), "Keep bytes");
    step(
      "build and activate a successful candidate with the same schema transition",
    );
    const candidate = await fixtureRelease(
      `${major}.${minor}.${patch + 2}`,
      baseline,
      false,
    );
    await activate(candidate);
    const active = await managedStatus(root);
    assert.equal(active.state, "ready");
    assert.equal(active.releaseId, candidate.releaseId);
    assert.equal(inspectDatabase().schema, baseline.schemaVersion + 1);
    assert.deepEqual(inspectDatabase().notes, original.notes);
    assert.deepEqual(inspectDatabase().attachments, original.attachments);
    assert.equal(readFileSync(attachment, "utf8"), "Keep bytes");
    const created = await jsonRequest(active.url, "/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json", origin: active.url },
      body: JSON.stringify({ title: "Saved after update", accent: "moss" }),
    });
    assert(
      created.id || created.chat?.id,
      "Committed application must accept a new project.",
    );
    await cli("stop");
    await cli("run", "--no-open");
    const restarted = await managedStatus(root);
    assert.equal(restarted.releaseId, candidate.releaseId);
    const projects = await jsonRequest(restarted.url, "/api/chats");
    assert(
      JSON.stringify(projects).includes("Saved after update"),
      "Postcommit writes must survive restart and journal reconciliation.",
    );
    step(
      "successful activation, failed-candidate recovery, attachments, and postcommit restart passed",
    );
  }
  completed = true;
  step(
    "prepared installation, background lifecycle, duplicate/manual ownership, and persistence passed",
  );
} catch (error) {
  const log = join(root, "logs/server.log");
  if (existsSync(log)) console.error(readFileSync(log, "utf8").slice(-16_384));
  throw error;
} finally {
  let safelyStopped = !existsSync(join(root, "install.json"));
  if (!safelyStopped) {
    try {
      await stopManaged(root);
      safelyStopped = !(await managedStatus(root));
    } catch (error) {
      console.error("Disposable fixture shutdown failed:", error.message);
    }
  }
  if (safelyStopped) rmSync(base, { recursive: true, force: true });
  else {
    console.error(`Fixture retained for recovery: ${base}`);
    process.exitCode = 1;
  }
  if (!completed) process.exitCode = 1;
}
