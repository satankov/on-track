import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import fastifyStatic from "@fastify/static";

import { buildApp } from "./app.js";
import { resolveDataDirectory } from "./data-directory.js";
import { openDatabaseAfterRestoreRecovery } from "./startup-database.js";

const dataDirectory = resolveDataDirectory();
const databasePath = join(dataDirectory, "on-track.sqlite");
const database = openDatabaseAfterRestoreRecovery({
  dataDirectory,
  databasePath,
});
const app = buildApp({ database, databasePath, dataDirectory });
const clientRoot = resolve(process.cwd(), "dist/client");

if (existsSync(clientRoot)) {
  await app.register(fastifyStatic, {
    root: clientRoot,
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply
        .code(404)
        .send({ code: "not_found", message: "Route not found." });
    }
    return reply.sendFile("index.html");
  });
}

const portValue = Number(process.env.ON_TRACK_PORT ?? "4173");
if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65_535) {
  throw new Error("ON_TRACK_PORT must be an integer between 1 and 65535");
}

await app.listen({ host: "127.0.0.1", port: portValue });
console.log(`On Track is available at http://127.0.0.1:${portValue}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
