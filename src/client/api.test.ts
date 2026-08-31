import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "./api.js";

afterEach(() => vi.unstubAllGlobals());

describe("browser API client", () => {
  it("sends JSON mutations and encodes project identifiers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "note-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.appendNote("project/one", { body: "Decision" });

    expect(fetchMock).toHaveBeenCalledWith("/api/chats/project%2Fone/notes", {
      method: "POST",
      body: JSON.stringify({ body: "Decision" }),
      headers: { "Content-Type": "application/json" },
    });
  });

  it("uses a server error message without exposing response details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Project not found." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(apiClient.getChat("missing")).rejects.toThrow(
      "Project not found.",
    );
  });

  it("falls back safely when an error response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("proxy failure", { status: 502 })),
    );

    await expect(apiClient.listChats()).rejects.toThrow(
      "The local service could not complete that request.",
    );
  });
});
