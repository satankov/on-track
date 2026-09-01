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

    await apiClient.appendNote("project/one", {
      body: "Decision",
      createdAt: 123,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/chats/project%2Fone/notes", {
      method: "POST",
      body: JSON.stringify({ body: "Decision", createdAt: 123 }),
      headers: { "Content-Type": "application/json" },
    });
  });

  it("covers project mutations and successful database export", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "chat-1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "chat-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response("SQLite format 3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.sqlite3" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.createChat({ title: "Launch", accent: "coral" });
    await apiClient.updateChat("project/one", { title: "Delivery" });
    await apiClient.deleteChat("project/one");
    const exported = await apiClient.exportDatabase();

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/chats", {
      method: "POST",
      body: JSON.stringify({ title: "Launch", accent: "coral" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/chats/project%2Fone", {
      method: "PATCH",
      body: JSON.stringify({ title: "Delivery" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/chats/project%2Fone", {
      method: "DELETE",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/database/export");
    expect(await exported.text()).toBe("SQLite format 3");
  });

  it("sends note updates, deletes, and database imports through scoped routes", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "note-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.updateNote("project/one", "note/two", {
      body: "Revised",
      createdAt: 123,
    });
    await apiClient.deleteNote("project/one", "note/two");
    await apiClient.importDatabase(new Blob(["SQLite format 3"]));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/chats/project%2Fone/notes/note%2Ftwo",
      {
        method: "PATCH",
        body: JSON.stringify({ body: "Revised", createdAt: 123 }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/chats/project%2Fone/notes/note%2Ftwo",
      { method: "DELETE" },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/database/import", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: expect.any(Blob),
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

  it("reports database transfer failures safely", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("nope", { status: 500 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Invalid backup." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response("nope", { status: 500 })),
    );

    await expect(apiClient.exportDatabase()).rejects.toThrow(
      "The database could not be exported.",
    );
    await expect(apiClient.importDatabase(new Blob(["bad"]))).rejects.toThrow(
      "Invalid backup.",
    );
    await expect(apiClient.importDatabase(new Blob(["bad"]))).rejects.toThrow(
      "The database could not be imported.",
    );
  });
});
