import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { createServer, loadConfigFromFile } from "vite";
import { buildApp } from "./app.js";
import { openDatabase } from "./db/database.js";

it("preserves same-origin browser workflows through the actual Vite proxy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "threadstr-dev-proxy-"));
  const databasePath = join(directory, "on-track.sqlite");
  const check = vi.fn(async () => ({
    checkedAt: 1,
    status: "empty" as const,
    releases: [],
  }));
  const native = {
    supported: true,
    platform: "darwin" as const,
    open: vi.fn(async () => undefined),
    reveal: vi.fn(async () => undefined),
  };
  const app = buildApp({
    database: openDatabase(databasePath),
    databasePath,
    nativeFileActions: native,
    homeService: {
      info: { version: null, installation: "manual" },
      check,
      close: () => undefined,
    },
  });
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    const target = await app.listen({ host: "127.0.0.1", port: 0 });
    const loaded = await loadConfigFromFile(
      { command: "serve", mode: "development" },
      resolve("vite.config.ts"),
    );
    if (!loaded) throw new Error("Development config is missing.");
    const configured = loaded.config.server?.proxy?.["/api"];
    if (!configured) throw new Error("Development API proxy is missing.");
    // Change only the fixture backend address; keep the shipped proxy semantics.
    const proxy =
      typeof configured === "string" ? target : { ...configured, target };
    vite = await createServer({
      ...loaded.config,
      configFile: false,
      logLevel: "silent",
      server: {
        ...loaded.config.server,
        port: 0,
        proxy: { "/api": proxy },
      },
    });
    await vite.listen();
    const address = vite.httpServer!.address();
    if (!address || typeof address === "string")
      throw new Error("Missing Vite port.");
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = {
      origin,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    };
    const post = (path: string, data: unknown) =>
      fetch(`${origin}${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    const created = await post("/api/chats", {
      title: "Dev project",
      accent: "ocean",
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string };
    const form = new FormData();
    form.set("body", "Dev note");
    form.set("files", new Blob(["hello"], { type: "text/plain" }), "dev.txt");
    const noteResponse = await fetch(
      `${origin}/api/chats/${project.id}/notes`,
      { method: "POST", headers, body: form },
    );
    expect(noteResponse.status).toBe(201);
    const note = (await noteResponse.json()) as {
      id: string;
      attachments: Array<{ id: string }>;
    };
    const opened = await post(
      `/api/chats/${project.id}/notes/${note.id}/attachments/${note.attachments[0].id}/open`,
      {},
    );
    expect(opened.status).toBe(204);
    expect(native.open).toHaveBeenCalledOnce();
    expect((await post("/api/home/releases/check", {})).status).toBe(200);
    expect(check).toHaveBeenCalledOnce();
    const exported = await post("/api/database/export", { selection: "all" });
    expect(exported.status).toBe(200);
    const backup = await exported.blob();
    const preview = await fetch(`${origin}/api/database/import/preview`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/vnd.on-track.backup+sqlite",
      },
      body: backup,
    });
    expect(preview.status).toBe(200);
    const { digest } = (await preview.json()) as { digest: string };
    const imported = new FormData();
    imported.set(
      "options",
      JSON.stringify({ mode: "merge", selection: "all", digest }),
    );
    imported.set("file", backup, "dev.on-track-backup");
    expect(
      (
        await fetch(`${origin}/api/database/import`, {
          method: "POST",
          headers,
          body: imported,
        })
      ).status,
    ).toBe(200);
  } finally {
    await vite?.close();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
