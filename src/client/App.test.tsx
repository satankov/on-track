// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import type { ApiClient } from "./api.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listChats: vi.fn().mockResolvedValue([]),
    getChat: vi.fn(),
    createChat: vi.fn().mockResolvedValue({
      id: "chat-1",
      title: "Launch",
      accent: "coral",
      createdAt: 1,
      updatedAt: 1,
    }),
    updateChat: vi.fn(),
    deleteChat: vi.fn(),
    appendNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    exportDatabase: vi.fn(),
    importDatabase: vi.fn(),
    ...overrides,
  };
}

describe("personal project chat workspace", () => {
  it("shows a loading workspace while projects are still being fetched", () => {
    const listRequest = deferred<[]>();
    const api = createApi({
      listChats: vi.fn(() => listRequest.promise),
    });
    render(<App api={api} />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading your projects",
    );
    expect(
      screen.queryByRole("button", { name: "Create your first project" }),
    ).not.toBeInTheDocument();
  });

  it("shows the first-project call to action only after a successful empty list", async () => {
    const api = createApi();
    render(<App api={api} />);

    expect(
      await screen.findByRole("button", { name: "Create your first project" }),
    ).toBeVisible();
    expect(
      screen.getByText("A quiet place for every moving project."),
    ).toBeVisible();
  });

  it("asks desktop users to choose a project when projects exist but none is open", async () => {
    const chat = {
      id: "chat-1",
      title: "Existing project",
      accent: "moss" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
    });
    render(<App api={api} />);

    expect(
      await screen.findByRole("heading", {
        name: "Choose a project to continue.",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create your first project" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Existing project" }),
    ).toBeVisible();
    expect(api.getChat).not.toHaveBeenCalled();
  });

  it("shows a recoverable local-service error when the project list fails", async () => {
    const api = createApi({
      listChats: vi.fn().mockRejectedValue(new Error("offline")),
    });
    render(<App api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The local project list could not be loaded.",
    );
    expect(
      screen.queryByRole("button", { name: "Create your first project" }),
    ).not.toBeInTheDocument();
  });

  it("creates a customized project from the useful empty state", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<App api={api} />);

    expect(
      await screen.findByText("A quiet place for every moving project."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(
      screen.getByRole("dialog", { name: "Create project" }),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Project name"), "Launch");
    await user.click(screen.getByRole("radio", { name: "Coral" }));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() =>
      expect(api.createChat).toHaveBeenCalledWith({
        title: "Launch",
        accent: "coral",
      }),
    );
    expect(screen.getByRole("heading", { name: "Launch" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Back to projects" }),
    ).toBeInTheDocument();
  });

  it("loads a project and persists title and accent customization", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Discovery",
      accent: "moss" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes: [] }),
      updateChat: vi
        .fn()
        .mockResolvedValue({ ...chat, title: "Research", accent: "iris" }),
    });
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: /Discovery/ }));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit project" })).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Customize project" }),
    ).toBeNull();
    const name = screen.getByLabelText("Project name");
    await user.clear(name);
    await user.type(name, "Research");
    await user.click(screen.getByRole("radio", { name: "Iris" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(api.updateChat).toHaveBeenCalledWith("chat-1", {
      title: "Research",
      accent: "iris",
    });
    expect(
      await screen.findByRole("heading", { name: "Research" }),
    ).toBeVisible();
  });

  it("deletes the active project from the inline edit workspace", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 100,
      updatedAt: 2_000,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes: [] }),
      deleteChat: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete project" }));

    expect(api.deleteChat).toHaveBeenCalledWith("chat-1");
    expect(
      screen.queryByRole("button", { name: "Open Delivery" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Create your first project" }),
    ).toBeVisible();
  });

  it("keeps the inline project editor open for cancelled and failed deletes", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 100,
      updatedAt: 2_000,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes: [] }),
      deleteChat: vi.fn().mockRejectedValue(new Error("Delete failed")),
    });
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    confirm.mockClear();
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete project" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.deleteChat).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Edit project" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Delete project" }));

    expect(api.deleteChat).toHaveBeenCalledWith("chat-1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Delete failed");
    expect(screen.getByRole("heading", { name: "Edit project" })).toBeVisible();
  });

  it("keeps a failed draft, then saves multiline text with Cmd/Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const appendNote = vi
      .fn()
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockResolvedValueOnce({
        id: "note-1",
        chatId: "chat-1",
        body: "**Decision** recorded\n<img src=x>",
        createdAt: 2,
      });
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes: [] }),
      appendNote,
    });
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: /Delivery/ }));
    const composer = await screen.findByLabelText("Add a note");
    await user.type(composer, "**Decision** recorded{enter}<img src=x>");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your note is still here",
    );
    expect(composer).toHaveValue("**Decision** recorded\n<img src=x>");

    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(await screen.findByText("Decision")).toBeVisible();
    expect(screen.getByText("Decision").tagName).toBe("STRONG");
    expect(document.querySelector("img")).toBeNull();
    expect(composer).toHaveValue("");
  });

  it("sends a new message with an optional composer timestamp", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const timestamp = "2026-08-30T10:15";
    const createdAt = new Date(timestamp).getTime();
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes: [] }),
      appendNote: vi.fn().mockResolvedValue({
        id: "note-1",
        chatId: "chat-1",
        body: "Backfilled message",
        createdAt,
      }),
    });
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );
    await user.type(screen.getByLabelText("Add a note"), "Backfilled message");
    await user.click(screen.getByRole("button", { name: "Choose timestamp" }));
    await user.clear(screen.getByLabelText("Message timestamp"));
    await user.type(screen.getByLabelText("Message timestamp"), timestamp);
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(api.appendNote).toHaveBeenCalledWith("chat-1", {
      body: "Backfilled message",
      createdAt,
    });
    expect(await screen.findByText("Backfilled message")).toBeVisible();
    expect(screen.getByLabelText("Add a note")).toHaveValue("");
  });

  it("opens settings as a rail mode and exports from the main workspace", async () => {
    const user = userEvent.setup();
    const api = createApi({
      exportDatabase: vi
        .fn()
        .mockResolvedValue(
          new Blob(["SQLite format 3"], { type: "application/vnd.sqlite3" }),
        ),
    });
    const createObjectURL = vi.fn(() => "blob:on-track-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<App api={api} />);

    await user.click(screen.getByRole("button", { name: /Settings/ }));
    expect(
      screen.getByRole("navigation", { name: "Settings sections" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Database settings" }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Export database" }));

    await waitFor(() => expect(api.exportDatabase).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
  });

  it("returns from settings to projects without losing the active project", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 100,
      updatedAt: 2_000,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes: [] }),
    });
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );
    await user.click(screen.getByRole("button", { name: /Settings/ }));
    expect(
      screen.getByRole("heading", { name: "Database settings" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back to projects" }));

    expect(screen.getByRole("heading", { name: "Delivery" })).toBeVisible();
  });

  it("shows settings export and import errors in the settings workspace", async () => {
    const user = userEvent.setup();
    const api = createApi({
      exportDatabase: vi.fn().mockRejectedValue(new Error("Export failed")),
      importDatabase: vi.fn().mockRejectedValue(new Error("Import failed")),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App api={api} />);

    await user.click(screen.getByRole("button", { name: /Settings/ }));
    await user.click(screen.getByRole("button", { name: "Export database" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Export failed");

    await user.upload(
      screen.getByLabelText("Choose database backup"),
      new File(["bad"], "bad.sqlite", { type: "application/vnd.sqlite3" }),
    );
    await user.click(screen.getByRole("button", { name: "Import database" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Import failed");
    expect(
      screen.getByRole("heading", { name: "Database settings" }),
    ).toBeVisible();
  });

  it("does not import a selected database when replacement is cancelled", async () => {
    const user = userEvent.setup();
    const api = createApi({ importDatabase: vi.fn() });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App api={api} />);

    await user.click(screen.getByRole("button", { name: /Settings/ }));
    await user.upload(
      screen.getByLabelText("Choose database backup"),
      new File(["SQLite format 3"], "backup.sqlite", {
        type: "application/vnd.sqlite3",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Import database" }));

    expect(api.importDatabase).not.toHaveBeenCalled();
  });

  it("imports a selected database after confirmation and refreshes the project list", async () => {
    const user = userEvent.setup();
    const api = createApi({
      listChats: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "restored",
            title: "Restored",
            accent: "ocean",
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
      importDatabase: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App api={api} />);

    await user.click(screen.getByRole("button", { name: /Settings/ }));
    await user.upload(
      screen.getByLabelText("Choose database backup"),
      new File(["SQLite format 3"], "backup.sqlite", {
        type: "application/vnd.sqlite3",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Import database" }));

    await waitFor(() => expect(api.importDatabase).toHaveBeenCalled());
    expect(
      await screen.findByRole("button", { name: "Open Restored" }),
    ).toBeVisible();
  });

  it("groups messages into right-aligned chat bubbles with one date per day", async () => {
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 100,
      updatedAt: 90_000_000,
    };
    const firstDay = new Date("2026-09-01T09:00:00").getTime();
    const secondSameDay = new Date("2026-09-01T11:00:00").getTime();
    const nextDay = new Date("2026-09-02T09:00:00").getTime();
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({
        ...chat,
        notes: [
          {
            id: "note-1",
            chatId: "chat-1",
            body: "First",
            createdAt: firstDay,
          },
          {
            id: "note-2",
            chatId: "chat-1",
            body: "Second",
            createdAt: secondSameDay,
          },
          {
            id: "note-3",
            chatId: "chat-1",
            body: "Third",
            createdAt: nextDay,
          },
        ],
      }),
    });
    render(<App api={api} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );

    const separators = screen.getAllByText(/September/);
    expect(separators).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(document.querySelectorAll(".message-row--own")).toHaveLength(3);
    expect(document.querySelectorAll(".message-time")).toHaveLength(3);
  });

  it("copies with icon feedback, edits from the composer, and deletes an existing message", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 100,
      updatedAt: 2_000,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({
        ...chat,
        notes: [
          {
            id: "note-1",
            chatId: "chat-1",
            body: "Original **message**",
            createdAt: 2_000,
          },
        ],
      }),
      updateNote: vi.fn().mockResolvedValue({
        id: "note-1",
        chatId: "chat-1",
        body: "Revised **message**",
        createdAt: 3_600_000,
      }),
      deleteNote: vi.fn().mockResolvedValue(undefined),
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );
    const note = await screen.findByText("Original");
    const noteItem = note.closest("li")!;
    await user.click(
      within(noteItem).getByRole("button", { name: "Copy message" }),
    );
    expect(writeText).toHaveBeenCalledWith("Original **message**");
    expect(
      within(noteItem).getByRole("button", { name: "Message copied" }),
    ).toBeVisible();

    await user.click(
      within(noteItem).getByRole("button", { name: "Edit message" }),
    );
    expect(screen.queryByRole("dialog", { name: "Edit message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(screen.queryByLabelText("Message timestamp")).toBeNull();
    const editComposer = screen.getByRole("textbox", { name: "Edit message" });
    await user.clear(editComposer);
    await user.type(editComposer, "Revised **message**");
    await user.click(screen.getByRole("button", { name: "Choose timestamp" }));
    await user.clear(screen.getByLabelText("Message timestamp"));
    const revisedTimestamp = "1970-01-01T01:00";
    await user.type(
      screen.getByLabelText("Message timestamp"),
      revisedTimestamp,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(api.updateNote).toHaveBeenCalledWith("chat-1", "note-1", {
      body: "Revised **message**",
      createdAt: new Date(revisedTimestamp).getTime(),
    });
    expect(await screen.findByText("Revised")).toBeVisible();

    const updatedItem = screen.getByText("Revised").closest("li")!;
    await user.click(
      within(updatedItem).getByRole("button", { name: "Delete message" }),
    );
    expect(api.deleteNote).toHaveBeenCalledWith("chat-1", "note-1");
    expect(screen.queryByText("Revised")).not.toBeInTheDocument();
  });

  it("keeps composer editing active for invalid timestamps and cancelled deletes", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 100,
      updatedAt: 2_000,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({
        ...chat,
        notes: [
          {
            id: "note-1",
            chatId: "chat-1",
            body: "Original message",
            createdAt: 2_000,
          },
        ],
      }),
      updateNote: vi.fn(),
      deleteNote: vi.fn(),
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );
    const noteItem = screen.getByText("Original message").closest("li")!;
    await user.click(
      within(noteItem).getByRole("button", { name: "Delete message" }),
    );
    expect(api.deleteNote).not.toHaveBeenCalled();

    await user.click(
      within(noteItem).getByRole("button", { name: "Edit message" }),
    );
    expect(screen.queryByLabelText("Message timestamp")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Choose timestamp" }));
    await user.clear(screen.getByLabelText("Message timestamp"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a valid timestamp.",
    );
    expect(screen.getByRole("textbox", { name: "Edit message" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("shows an error when clipboard copying fails", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 100,
      updatedAt: 2_000,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({
        ...chat,
        notes: [
          {
            id: "note-1",
            chatId: "chat-1",
            body: "Original message",
            createdAt: 2_000,
          },
        ],
      }),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );
    const noteItem = screen.getByText("Original message").closest("li")!;
    await user.click(
      within(noteItem).getByRole("button", { name: "Copy message" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The message could not be copied.",
    );
  });

  it("keeps project form values when creation fails", async () => {
    const user = userEvent.setup();
    const api = createApi({
      createChat: vi.fn().mockRejectedValue(new Error("Database busy")),
    });
    render(<App api={api} />);

    await screen.findByText("A quiet place for every moving project.");
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText("Project name"), "Important project");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Database busy");
    expect(screen.getByLabelText("Project name")).toHaveValue(
      "Important project",
    );
  });

  it("keeps the latest project selection when requests resolve out of order", async () => {
    const user = userEvent.setup();
    const alpha = {
      id: "alpha",
      title: "Alpha",
      accent: "coral" as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const beta = {
      ...alpha,
      id: "beta",
      title: "Beta",
      accent: "moss" as const,
    };
    const alphaRequest = deferred<{ notes: never[] } & typeof alpha>();
    const betaRequest = deferred<{ notes: never[] } & typeof beta>();
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([alpha, beta]),
      getChat: vi.fn((id: string) =>
        id === "alpha" ? alphaRequest.promise : betaRequest.promise,
      ),
    });
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "Open Alpha" }));
    await user.click(screen.getByRole("button", { name: "Open Beta" }));
    await act(async () => betaRequest.resolve({ ...beta, notes: [] }));
    expect(await screen.findByRole("heading", { name: "Beta" })).toBeVisible();
    await act(async () => alphaRequest.resolve({ ...alpha, notes: [] }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeVisible();
  });

  it("keeps navigation stable while a note save is pending", async () => {
    const user = userEvent.setup();
    const alpha = {
      id: "alpha",
      title: "Alpha",
      accent: "coral" as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const beta = {
      ...alpha,
      id: "beta",
      title: "Beta",
      accent: "moss" as const,
    };
    const noteRequest = deferred<{
      id: string;
      chatId: string;
      body: string;
      createdAt: number;
    }>();
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([alpha, beta]),
      getChat: vi.fn(async (id: string) => ({
        ...(id === "alpha" ? alpha : beta),
        notes: [],
      })),
      appendNote: vi.fn(() => noteRequest.promise),
    });
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "Open Alpha" }));
    await user.type(await screen.findByLabelText("Add a note"), "Alpha note");
    await user.click(screen.getByRole("button", { name: /Add note/ }));
    expect(screen.getByRole("button", { name: "Open Beta" })).toBeDisabled();

    await act(async () =>
      noteRequest.resolve({
        id: "note-alpha",
        chatId: "alpha",
        body: "Alpha note",
        createdAt: 3,
      }),
    );

    expect(screen.getByRole("heading", { name: "Alpha" })).toBeVisible();
    expect(screen.getByText("Alpha note")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Beta" })).toBeEnabled();
  });

  it("preserves a rejected note and its error before allowing navigation", async () => {
    const user = userEvent.setup();
    const alpha = {
      id: "alpha",
      title: "Alpha",
      accent: "coral" as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const beta = {
      ...alpha,
      id: "beta",
      title: "Beta",
      accent: "moss" as const,
    };
    const noteRequest = deferred<never>();
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([alpha, beta]),
      getChat: vi.fn().mockResolvedValue({ ...alpha, notes: [] }),
      appendNote: vi.fn(() => noteRequest.promise),
    });
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "Open Alpha" }));
    await user.type(
      await screen.findByLabelText("Add a note"),
      "Do not lose me",
    );
    await user.click(screen.getByRole("button", { name: /Add note/ }));
    expect(screen.getByRole("button", { name: "Open Beta" })).toBeDisabled();
    await act(async () => noteRequest.reject(new Error("Database busy")));

    expect(await screen.findByRole("alert")).toHaveTextContent("Database busy");
    expect(screen.getByLabelText("Add a note")).toHaveValue("Do not lose me");
    expect(screen.getByRole("button", { name: "Open Beta" })).toBeEnabled();
  });

  it("reorders a customized project by its latest activity", async () => {
    const user = userEvent.setup();
    const alpha = {
      id: "alpha",
      title: "Alpha",
      accent: "coral" as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const beta = {
      ...alpha,
      id: "beta",
      title: "Beta",
      accent: "moss" as const,
      updatedAt: 1,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([alpha, beta]),
      getChat: vi.fn().mockResolvedValue({ ...beta, notes: [] }),
      updateChat: vi
        .fn()
        .mockResolvedValue({ ...beta, title: "Beta updated", updatedAt: 3 }),
    });
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "Open Beta" }));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const input = screen.getByLabelText("Project name");
    await user.clear(input);
    await user.type(input, "Beta updated");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const projectButtons = within(
      screen.getByRole("navigation", { name: "Projects" }),
    )
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(projectButtons).toEqual(["Open Beta updated", "Open Alpha"]);
  });
});
