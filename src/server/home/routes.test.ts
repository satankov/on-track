import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { registerHomeRoutes } from "./routes.js";
import { HomeCheckError } from "./service.js";
const headers = {
  host: "127.0.0.1:4173",
  origin: "http://127.0.0.1:4173",
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
};
function setup() {
  const app = Fastify();
  const check = vi
    .fn()
    .mockResolvedValue({ status: "empty", checkedAt: 1, releases: [] });
  const close = vi.fn();
  registerHomeRoutes(app, {
    info: { version: "0.0.8", installation: "managed" },
    check,
    close,
  });
  return { app, check, close };
}
it("rejects cross-origin, missing metadata and nonempty requests before network", async () => {
  const { app, check } = setup();
  try {
    for (const altered of [
      { origin: "http://127.0.0.1:4000" },
      { origin: "" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-mode": "navigate" },
      { "sec-fetch-dest": "document" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/home/releases/check",
            headers: { ...headers, ...altered },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/home/releases/check",
          headers,
          payload: { url: "https://evil.test" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/home/releases/check",
          headers,
          payload: [],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/home/releases/check",
          headers,
          payload: { large: "a".repeat(300) },
        })
      ).statusCode,
    ).toBe(413);
    expect(check).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it("limits explicit checks and exposes only safe information", async () => {
  const { app, check, close } = setup();
  try {
    const info = await app.inject({ url: "/api/home/info" });
    expect(info.json()).toEqual({ version: "0.0.8", installation: "managed" });
    expect(info.headers["cache-control"]).toBe("no-store");
    for (let i = 0; i < 6; i++)
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/home/releases/check",
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
    const limited = await app.inject({
      method: "POST",
      url: "/api/home/releases/check",
      headers,
      payload: {},
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(check).toHaveBeenCalledTimes(6);
  } finally {
    await app.close();
  }
  expect(close).toHaveBeenCalled();
});
it.each([
  new HomeCheckError("offline"),
  new HomeCheckError("rate_limited", 123),
  Error("/secret/token"),
])("maps failures without exposing internals", async (error) => {
  const { app, check } = setup();
  check.mockRejectedValue(error);
  try {
    const result = await app.inject({
      method: "POST",
      url: "/api/home/releases/check",
      headers,
      payload: {},
    });
    expect(result.statusCode).toBe(
      error instanceof HomeCheckError && error.code === "rate_limited"
        ? 429
        : 503,
    );
    expect(result.body).not.toContain("secret");
  } finally {
    await app.close();
  }
});
