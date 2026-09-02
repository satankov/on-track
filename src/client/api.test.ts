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
          headers: {
            "Content-Type": "application/vnd.on-track.backup+sqlite",
          },
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
      headers: {
        "Content-Type": "application/vnd.on-track.backup+sqlite",
      },
      body: expect.any(Blob),
    });
  });

  it("uploads note attachments with multipart form data and downloads attachment bytes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "note-1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("deck", {
          status: 200,
          headers: { "Content-Type": "application/vnd.ms-powerpoint" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["deck"], "roadmap.ppt", {
      type: "application/vnd.ms-powerpoint",
    });

    await apiClient.appendNote("project/one", {
      body: "Deck context",
      createdAt: 250,
      files: [file],
    });
    const downloaded = await apiClient.downloadAttachment(
      "project/one",
      "note/two",
      "attachment/three",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/chats/project%2Fone/notes",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    );
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/chats/project%2Fone/notes/note%2Ftwo/attachments/attachment%2Fthree",
    );
    expect(await downloaded.text()).toBe("deck");
  });

  it("updates note attachments with multipart form data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "note-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["new"], "new.pdf", { type: "application/pdf" });

    await apiClient.updateNote("project/one", "note/two", {
      body: "Updated",
      createdAt: 300,
      keepAttachmentIds: ["attachment/keep"],
      files: [file],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chats/project%2Fone/notes/note%2Ftwo",
      expect.objectContaining({
        method: "PATCH",
        body: expect.any(FormData),
      }),
    );
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
  });

  it("reports attachment read failures safely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
    );

    await expect(
      apiClient.downloadAttachment("project/one", "note/two", "attachment"),
    ).rejects.toThrow("The attachment could not be downloaded.");
  });

  it("posts empty JSON to scoped native attachment action routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.openAttachment(
      "project/one",
      "note/two",
      "attachment/three",
    );
    await apiClient.revealAttachment(
      "project/one",
      "note/two",
      "attachment/three",
    );

    const base =
      "/api/chats/project%2Fone/notes/note%2Ftwo/attachments/attachment%2Fthree";
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${base}/open`, {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${base}/reveal`, {
      method: "POST",
      body: "{}",
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
