import type { FastifyInstance } from "fastify";
import { HomeCheckError, type HomeService } from "./service.js";
export function registerHomeRoutes(app: FastifyInstance, service: HomeService) {
  let windowStart = 0;
  let requests = 0;
  app.addHook("onClose", async () => {
    service.close();
  });
  app.get("/api/home/info", async (_request, reply) =>
    reply.header("Cache-Control", "no-store").send(service.info),
  );
  app.post(
    "/api/home/releases/check",
    { bodyLimit: 256 },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (
        request.headers.origin !== `http://${request.headers.host}` ||
        request.headers["sec-fetch-site"] !== "same-origin" ||
        request.headers["sec-fetch-mode"] !== "cors" ||
        request.headers["sec-fetch-dest"] !== "empty"
      ) {
        return reply.code(403).send({
          code: "release_check_forbidden",
          message: "Release check request is not allowed.",
        });
      }
      if (
        request.headers["content-type"]?.split(";", 1)[0] !==
          "application/json" ||
        !request.body ||
        typeof request.body !== "object" ||
        Array.isArray(request.body) ||
        Object.keys(request.body).length
      ) {
        return reply.code(400).send({
          code: "invalid_input",
          message: "Please check the submitted values.",
        });
      }
      const now = Date.now();
      if (now - windowStart >= 60_000) {
        windowStart = now;
        requests = 0;
      }
      if (++requests > 6)
        return reply
          .code(429)
          .header("Retry-After", Math.ceil((windowStart + 60_000 - now) / 1000))
          .send({
            code: "rate_limited",
            message: "Please wait a minute before checking again.",
          });
      try {
        return await service.check();
      } catch (error) {
        const failure =
          error instanceof HomeCheckError
            ? error
            : new HomeCheckError("invalid_release");
        if (failure.code === "rate_limited")
          reply.header("Retry-After", failure.retryAfter);
        return reply
          .code(failure.code === "rate_limited" ? 429 : 503)
          .send({ code: failure.code, message: failure.message });
      }
    },
  );
}
