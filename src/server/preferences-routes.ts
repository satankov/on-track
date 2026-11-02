import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { preferenceInputSchema } from "../domain/preferences.js";
import { readPreferences, updatePreferences } from "./db/preferences.js";

export function registerPreferenceRoutes(
  app: FastifyInstance,
  database: () => Database.Database,
): void {
  app.get("/api/preferences", async (_request, reply) =>
    reply.header("Cache-Control", "no-store").send(readPreferences(database())),
  );
  app.post(
    "/api/preferences/initialize",
    { bodyLimit: 2048 },
    async (request, reply) =>
      reply
        .header("Cache-Control", "no-store")
        .send(
          updatePreferences(
            database(),
            preferenceInputSchema.parse(request.body),
            true,
          ),
        ),
  );
  app.patch("/api/preferences", { bodyLimit: 2048 }, async (request, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .send(
        updatePreferences(
          database(),
          preferenceInputSchema.parse(request.body),
        ),
      ),
  );
  app.get("/api/preferences/bootstrap.js", async (_request, reply) => {
    const preferences = readPreferences(database());
    // Only validated enums/booleans enter this script, never arbitrary user text.
    return reply
      .header("Cache-Control", "no-store")
      .type("text/javascript; charset=utf-8").send(`(function(){
      var p=${JSON.stringify(preferences)};
      window.__THREADSTR_PREFERENCES__=p;
      var theme=p.theme, colors={light:"#f3f5f7",neutral:"#30343a",dark:"#111417"};
      if(!p.initialized){try {var legacy=localStorage.getItem("on-track-theme"); if(Object.prototype.hasOwnProperty.call(colors,legacy)) theme=legacy;}catch(e){}}
      document.documentElement.dataset.theme=theme;
      document.documentElement.style.colorScheme=theme==="light"?"light":"dark";
      var meta=document.querySelector('meta[name="theme-color"]'); if(meta)meta.setAttribute("content",colors[theme]);
    })();`);
  });
}
