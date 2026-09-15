export interface RuntimeDescription {
  protocol: 1;
  version: string;
  releaseId: string;
  buildId: string;
  schemaVersion: number;
  migrationMarker: number;
}

export function describeRuntime(root = process.cwd()): RuntimeDescription {
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as { version?: unknown };
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version)
  ) {
    throw new Error("This source release has no supported version identity.");
  }
  const hash = createHash("sha256");
  function visit(relative: string): void {
    const path = join(root, relative);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error("Build inputs must not be symbolic links.");
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort())
        visit(`${relative}/${entry}`);
    } else if (stat.isFile()) {
      const bytes = readFileSync(path);
      hash
        .update(`${relative.length}:${relative}:${bytes.length}:`)
        .update(bytes);
    } else throw new Error("Unsupported build input.");
  }
  for (const input of [
    "drizzle",
    "index.html",
    "package-lock.json",
    "package.json",
    "public",
    "src",
    "tsconfig.json",
    "tsconfig.server.json",
    "vite.config.ts",
  ]) {
    if (existsSync(join(root, input))) visit(input);
  }
  const source = readFileSync(join(root, "src/server/db/database.ts"), "utf8");
  const schemaVersion = Number(
    source.match(/const CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1],
  );
  const migrations = JSON.parse(
    readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"),
  ) as { entries?: { when?: unknown }[] };
  const markers = migrations.entries?.map((entry) => entry.when) ?? [];
  if (
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < 1 ||
    markers.length === 0 ||
    markers.some(
      (marker) =>
        typeof marker !== "number" ||
        !Number.isSafeInteger(marker) ||
        marker < 0,
    )
  ) {
    throw new Error("This release has invalid migration metadata.");
  }
  return {
    protocol: 1,
    version: manifest.version,
    releaseId: `v${manifest.version}`,
    buildId: hash.digest("hex"),
    schemaVersion,
    migrationMarker: Math.max(...(markers as number[])),
  };
}
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
