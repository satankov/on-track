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
      enabledLabels: ["todo", "milestone"],
      createdAt: 1,
      updatedAt: 1,
    }),
    updateChat: vi.fn(),
    deleteChat: vi.fn(),
    appendNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    setNoteLabel: vi.fn(),
    openAttachment: vi.fn(),
    revealAttachment: vi.fn(),
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
      enabledLabels: ["todo", "milestone"],
    });
    expect(
      await screen.findByRole("heading", { name: "Research" }),
    ).toBeVisible();
  });

  it("configures only project labels and preserves their catalog order", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Discovery",
      accent: "moss" as const,
      enabledLabels: ["todo", "milestone"] as ("todo" | "milestone")[],
      createdAt: 1,
      updatedAt: 1,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes: [] }),
      updateChat: vi.fn().mockResolvedValue({
        ...chat,
        enabledLabels: ["todo", "decision", "milestone"],
      }),
    });
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: /Discovery/ }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("group", { name: "Project labels" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Todo" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Milestone" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Pin" })).toBeNull();
    expect(screen.queryByText(/Always available/i)).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Decision" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(api.updateChat).toHaveBeenCalledWith("chat-1", {
      title: "Discovery",
      accent: "moss",
      enabledLabels: ["todo", "decision", "milestone"],
    });
  });

  it("shows, changes, and filters multiple labels with inactive assignments retained", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Launch",
      accent: "ocean" as const,
      enabledLabels: ["todo", "risk", "milestone"] as const,
      createdAt: 100,
      updatedAt: 200,
    };
    const note = {
      id: "note-1",
      chatId: "chat-1",
      body: "Prepare rollout",
      createdAt: 200,
      labels: ["decision", "risk"] as const,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes: [note] }),
      setNoteLabel: vi.fn().mockResolvedValue(["pin", "decision", "risk"]),
    });
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Launch" }),
    );
    const filters = screen.getByRole("navigation", { name: "History filters" });
    expect(
      within(filters)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "All 1",
      "Files 0",
      "Pin 0",
      "Attention 0",
      "Todo 0",
      "Risk 1",
      "Milestone 0",
    ]);
    expect(
      within(filters).queryByRole("button", { name: /Decision/ }),
    ).toBeNull();
    expect(
      screen.getByText("Decision").closest(".message-label"),
    ).toBeVisible();
    expect(
      screen.getByText("⚠️", {
        selector: '.message-label[data-label="risk"] .label-glyph--emoji',
      }),
    ).toBeVisible();

    const message = screen.getByText("Prepare rollout").closest("li")!;
    expect(
      within(within(message).getByLabelText("Message actions"))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Change labels",
      "Copy message",
      "Edit message",
      "Delete message",
    ]);
    await user.click(
      within(message).getByRole("button", { name: "Change labels" }),
    );
    expect(
      within(message).getByRole("checkbox", { name: "Risk" }),
    ).toBeChecked();
    expect(
      within(message).getByRole("checkbox", { name: "Decision (inactive)" }),
    ).toBeChecked();
    expect(
      within(message).queryByRole("checkbox", { name: "Open question" }),
    ).toBeNull();
    await user.click(within(message).getByRole("checkbox", { name: "Pin" }));

    await waitFor(() =>
      expect(api.setNoteLabel).toHaveBeenCalledWith(
        "chat-1",
        "note-1",
        "pin",
        true,
      ),
    );
    expect(
      within(filters).getByRole("button", { name: "Pin 1" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    expect(
      within(message).getByRole("button", { name: "Change labels" }),
    ).toHaveFocus();
    expect(
      within(message).queryByRole("group", { name: "Message labels" }),
    ).toBeNull();
  });

  it("uses compact icon-led filters and icon-only permanent message markers", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Launch",
      accent: "ocean" as const,
      enabledLabels: [
        "todo",
        "decision",
        "open-question",
        "risk",
        "milestone",
      ] as const,
      createdAt: 100,
      updatedAt: 200,
    };
    const note = {
      id: "note-1",
      chatId: "chat-1",
      body: "Prepare rollout",
      createdAt: 200,
      labels: [
        "pin",
        "attention",
        "todo",
        "decision",
        "open-question",
      ] as const,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes: [note] }),
    });
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Launch" }),
    );

    const filters = screen.getByRole("navigation", { name: "History filters" });
    const filesFilter = within(filters).getByRole("button", {
      name: "Files 0",
    });
    const attentionFilter = within(filters).getByRole("button", {
      name: "Attention 1",
    });
    const questionFilter = within(filters).getByRole("button", {
      name: "Open question 1",
    });
    const decisionFilter = within(filters).getByRole("button", {
      name: "Decision 1",
    });
    const milestoneFilter = within(filters).getByRole("button", {
      name: "Milestone 0",
    });

    expect(
      filesFilter.querySelector(".history-filter-icon svg"),
    ).not.toBeNull();
    expect(attentionFilter).toHaveTextContent("Alert");
    expect(decisionFilter).toHaveTextContent("Decision");
    expect(questionFilter).toHaveTextContent("Question");
    expect(questionFilter).not.toHaveTextContent("Open question");
    expect(milestoneFilter).toHaveTextContent("Milestone");
    for (const filter of within(filters).getAllByRole("button")) {
      expect(filter.querySelector(".history-filter-count")).not.toBeNull();
    }

    const message = screen.getByText("Prepare rollout").closest("li")!;
    const pin = message.querySelector<HTMLElement>(
      '.message-label[data-label="pin"]',
    )!;
    const attention = message.querySelector<HTMLElement>(
      '.message-label[data-label="attention"]',
    )!;
    expect(pin).toHaveAccessibleName("Pin");
    expect(attention).toHaveAccessibleName("Attention");
    expect(pin).not.toHaveTextContent("Pin");
    expect(attention).not.toHaveTextContent("Attention");
    expect(pin.querySelector("svg")).not.toBeNull();
    expect(attention).toHaveTextContent("🔴");

    for (const label of ["todo", "decision", "open-question"]) {
      expect(
        message.querySelector(
          `.message-label[data-label="${label}"] .label-glyph svg`,
        ),
      ).not.toBeNull();
    }
  });

  it("keeps the previous label state and reports a recoverable mutation error", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Launch",
      accent: "ocean" as const,
      enabledLabels: ["todo"] as "todo"[],
      createdAt: 100,
      updatedAt: 200,
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({
        ...chat,
        notes: [
          {
            id: "note-1",
            chatId: "chat-1",
            body: "Prepare rollout",
            createdAt: 200,
            labels: [],
          },
        ],
      }),
      setNoteLabel: vi.fn().mockRejectedValue(new Error("Database busy")),
    });
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Launch" }),
    );
    const message = screen.getByText("Prepare rollout").closest("li")!;
    await user.click(
      within(message).getByRole("button", { name: "Change labels" }),
    );
    await user.click(within(message).getByRole("checkbox", { name: "Pin" }));

    expect(await within(message).findByRole("alert")).toHaveTextContent(
      "Database busy",
    );
    expect(
      within(message).getByRole("checkbox", { name: "Pin" }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Pin 0" })).toBeVisible();
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

  it("resizes the composer for multiline drafts and edit-prefilled messages", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const note = {
      id: "note-1",
      chatId: "chat-1",
      body: "First line\nSecond line\nThird line\nFourth line",
      createdAt: 2,
    };
    let simulatedScrollHeight: number | undefined;
    const scrollHeight = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return (
          simulatedScrollHeight ?? 48 + (this.value.split("\n").length - 1) * 24
        );
      },
    });

    try {
      const api = createApi({
        listChats: vi.fn().mockResolvedValue([chat]),
        getChat: vi.fn().mockResolvedValue({ ...chat, notes: [note] }),
      });
      render(<App api={api} />);

      await user.click(
        await screen.findByRole("button", { name: "Open Delivery" }),
      );
      const composer = screen.getByLabelText("Add a note");
      expect(composer).toHaveStyle({ height: "48px" });

      await user.type(composer, "One{enter}Two{enter}Three");
      expect(composer).toHaveStyle({ height: "96px" });

      await user.clear(composer);
      expect(composer).toHaveStyle({ height: "48px" });

      await user.type(
        composer,
        "One{enter}Two{enter}Three{enter}Four{enter}Five{enter}Six",
      );
      expect(composer).toHaveStyle({
        height: "144px",
        overflowY: "auto",
      });

      simulatedScrollHeight = 72;
      window.dispatchEvent(new Event("resize"));
      expect(composer).toHaveStyle({ height: "72px", overflowY: "hidden" });
      simulatedScrollHeight = undefined;
      await user.clear(composer);

      const noteItem = screen.getByRole("article").closest("li")!;
      await user.click(
        within(noteItem).getByRole("button", { name: "Edit message" }),
      );
      expect(screen.getByRole("textbox", { name: "Edit message" })).toHaveStyle(
        { height: "120px" },
      );

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByLabelText("Add a note")).toHaveStyle({
        height: "48px",
      });
    } finally {
      if (scrollHeight) {
        Object.defineProperty(
          HTMLTextAreaElement.prototype,
          "scrollHeight",
          scrollHeight,
        );
      }
    }
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

  it("sends selected files with caption text and can remove a pending attachment", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const uploaded = new File(["deck"], "roadmap.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const removed = new File(["draft"], "draft.pdf", {
      type: "application/pdf",
    });
    const appendNote = vi.fn().mockResolvedValue({
      id: "note-1",
      chatId: "chat-1",
      body: "Deck context",
      createdAt: 2,
      attachments: [
        {
          id: "attachment-1",
          noteId: "note-1",
          filename: "roadmap.pptx",
          mediaType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          byteSize: 4,
          createdAt: 2,
        },
      ],
    });
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes: [] }),
      appendNote,
    });
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );
    await user.upload(screen.getByLabelText("Attach files"), [
      uploaded,
      removed,
    ]);
    expect(screen.getByText("roadmap.pptx")).toBeVisible();
    expect(screen.getByText("draft.pdf")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove draft.pdf" }));
    await user.type(screen.getByLabelText("Add a note"), "Deck context");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(appendNote).toHaveBeenCalledWith("chat-1", {
      body: "Deck context",
      files: [uploaded],
    });
    expect(await screen.findByText("roadmap.pptx")).toBeVisible();
    expect(screen.queryByText("draft.pdf")).not.toBeInTheDocument();
  });

  it("opens settings as a rail mode and exports from the main workspace", async () => {
    const user = userEvent.setup();
    const api = createApi({
      exportDatabase: vi.fn().mockResolvedValue(
        new Blob(["SQLite format 3"], {
          type: "application/vnd.on-track.backup+sqlite",
        }),
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
      screen.getByRole("heading", { name: "Backup settings" }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(screen.getByLabelText("Choose On Track backup")).toHaveAttribute(
      "accept",
      ".on-track-backup,application/vnd.on-track.backup+sqlite",
    );
    expect(
      screen.getByText(/Backups are plaintext and readable/),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Export backup" }));

    await waitFor(() => expect(api.exportDatabase).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
  });

  it("switches and persists appearance themes from preview radio cards", async () => {
    const user = userEvent.setup();
    const themeColor = document.createElement("meta");
    themeColor.name = "theme-color";
    document.head.append(themeColor);
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
    const view = render(<App api={createApi()} />);

    try {
      await user.click(screen.getByRole("button", { name: /Settings/ }));
      expect(
        screen.getByRole("heading", { name: "Backup settings" }),
      ).toBeVisible();

      await user.click(screen.getByRole("button", { name: /Appearance/ }));
      expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible();
      expect(screen.getByRole("radio", { name: /Light/ })).toBeChecked();
      expect(screen.getAllByTestId("theme-preview")).toHaveLength(3);

      await user.click(screen.getByRole("radio", { name: /Neutral/ }));
      expect(document.documentElement).toHaveAttribute("data-theme", "neutral");
      expect(document.documentElement.style.colorScheme).toBe("dark");
      expect(themeColor).toHaveAttribute("content", "#30343a");
      expect(localStorage.getItem("on-track-theme")).toBe("neutral");
      expect(screen.getByText("Selected", { selector: "small" })).toBeVisible();

      await user.click(screen.getByRole("button", { name: /Backups/ }));
      expect(
        screen.getByRole("heading", { name: "Backup settings" }),
      ).toBeVisible();
    } finally {
      view.unmount();
      themeColor.remove();
      localStorage.clear();
      delete document.documentElement.dataset.theme;
      document.documentElement.style.colorScheme = "";
    }
  });

  it("restores a stored theme and falls back from invalid appearance values", () => {
    const themeColor = document.createElement("meta");
    themeColor.name = "theme-color";
    document.head.append(themeColor);
    localStorage.setItem("on-track-theme", "dark");
    const darkView = render(<App api={createApi()} />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    darkView.unmount();

    localStorage.setItem("on-track-theme", "unsupported-theme");
    const fallbackView = render(<App api={createApi()} />);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");

    fallbackView.unmount();
    themeColor.remove();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
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
      screen.getByRole("heading", { name: "Backup settings" }),
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
    await user.click(screen.getByRole("button", { name: "Export backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Export failed");

    await user.upload(
      screen.getByLabelText("Choose On Track backup"),
      new File(["bad"], "bad.on-track-backup", {
        type: "application/vnd.on-track.backup+sqlite",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Restore backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Import failed");
    expect(
      screen.getByRole("heading", { name: "Backup settings" }),
    ).toBeVisible();
  });

  it("does not import a selected database when replacement is cancelled", async () => {
    const user = userEvent.setup();
    const api = createApi({ importDatabase: vi.fn() });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App api={api} />);

    await user.click(screen.getByRole("button", { name: /Settings/ }));
    await user.upload(
      screen.getByLabelText("Choose On Track backup"),
      new File(["SQLite format 3"], "backup.on-track-backup", {
        type: "application/vnd.on-track.backup+sqlite",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Restore backup" }));

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
      screen.getByLabelText("Choose On Track backup"),
      new File(["SQLite format 3"], "backup.on-track-backup", {
        type: "application/vnd.on-track.backup+sqlite",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Restore backup" }));

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

  it("renders attachment cards and filters history to messages with files", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 100,
      updatedAt: 2_000,
    };
    const notes = [
      {
        id: "note-1",
        chatId: "chat-1",
        body: "Plain update",
        createdAt: 1_000,
        attachments: [],
      },
      {
        id: "note-2",
        chatId: "chat-1",
        body: "Read this deck",
        createdAt: 2_000,
        attachments: [
          {
            id: "attachment-1",
            noteId: "note-2",
            filename: "roadmap.pptx",
            mediaType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            byteSize: 2048,
            modifiedAt: 2_000,
            createdAt: 2_000,
            status: "available" as const,
            actions: {
              open: "available" as const,
              reveal: "available" as const,
            },
          },
          {
            id: "attachment-missing",
            noteId: "note-2",
            filename: "missing.pdf",
            mediaType: "application/pdf",
            byteSize: 512,
            modifiedAt: 2_000,
            createdAt: 2_000,
            status: "missing" as const,
            actions: {
              open: "unavailable" as const,
              reveal: "available" as const,
            },
          },
          {
            id: "attachment-blocked",
            noteId: "note-2",
            filename: "installer.exe",
            mediaType: "application/octet-stream",
            byteSize: 256,
            modifiedAt: 2_000,
            createdAt: 2_000,
            status: "available" as const,
            actions: {
              open: "blocked" as const,
              reveal: "available" as const,
            },
          },
          {
            id: "attachment-unsupported",
            noteId: "note-2",
            filename: "unsupported.txt",
            mediaType: "text/plain",
            byteSize: 128,
            modifiedAt: 2_000,
            createdAt: 2_000,
            status: "available" as const,
            actions: {
              open: "unsupported" as const,
              reveal: "unsupported" as const,
            },
          },
        ],
      },
    ];
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat: vi.fn().mockResolvedValue({ ...chat, notes }),
      openAttachment: vi.fn().mockResolvedValue(undefined),
      revealAttachment: vi.fn().mockResolvedValue(undefined),
    });
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );

    expect(screen.getByText("Plain update")).toBeVisible();
    expect(screen.getByText("roadmap.pptx")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Open missing.pdf" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Show missing.pdf in Folder" }),
    ).toBeEnabled();
    expect(screen.getByText(/File is missing/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Open installer.exe" }),
    ).toBeDisabled();
    expect(screen.getByText(/Opening is blocked/)).toBeVisible();
    expect(
      screen.getByText(/Native file actions are not supported/),
    ).toBeVisible();
    const attachmentMetadata = screen.getByText(/^2 KB ·/);
    expect(attachmentMetadata).not.toHaveTextContent("Modified");
    expect(attachmentMetadata).toHaveAttribute(
      "title",
      expect.stringMatching(/^Modified /),
    );
    expect(
      screen.getByRole("button", { name: "Open roadmap.pptx" }),
    ).toContainHTML("<svg");
    expect(
      screen.getByRole("button", { name: "Show roadmap.pptx in Folder" }),
    ).toContainHTML("<svg");
    expect(
      screen.getByText("roadmap.pptx").closest(".attachment-card")?.tagName,
    ).toBe("DIV");
    await user.click(screen.getByRole("button", { name: "Files 1" }));
    expect(screen.queryByText("Plain update")).not.toBeInTheDocument();
    expect(screen.getByText("Read this deck")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open roadmap.pptx" }));
    expect(api.openAttachment).toHaveBeenCalledWith(
      "chat-1",
      "note-2",
      "attachment-1",
    );
    await user.click(
      screen.getByRole("button", { name: "Show roadmap.pptx in Folder" }),
    );
    expect(api.revealAttachment).toHaveBeenCalledWith(
      "chat-1",
      "note-2",
      "attachment-1",
    );
  });

  it("shows native action progress and a recoverable card-local error", async () => {
    const user = userEvent.setup();
    const openRequest = deferred<void>();
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
            body: "Deck",
            createdAt: 2_000,
            attachments: [
              {
                id: "attachment-1",
                noteId: "note-1",
                filename: "roadmap.pptx",
                mediaType: "application/octet-stream",
                byteSize: 1024,
                modifiedAt: 2_000,
                createdAt: 2_000,
                status: "available" as const,
                actions: {
                  open: "available" as const,
                  reveal: "available" as const,
                },
              },
            ],
          },
        ],
      }),
      openAttachment: vi.fn(() => openRequest.promise),
    });
    render(<App api={api} />);
    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );

    await user.click(screen.getByRole("button", { name: "Open roadmap.pptx" }));
    expect(
      screen.getByRole("button", { name: "Open roadmap.pptx" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "Open roadmap.pptx" }),
    ).toHaveTextContent("…");
    await act(async () =>
      openRequest.reject(new Error("Default application is busy.")),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Default application is busy.",
    );
    expect(
      screen.getByRole("button", { name: "Open roadmap.pptx" }),
    ).toBeEnabled();
  });

  it("refreshes attachment metadata on focus without clearing the draft", async () => {
    const user = userEvent.setup();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 100,
      updatedAt: 2_000,
    };
    const attachment = {
      id: "attachment-1",
      noteId: "note-1",
      filename: "roadmap.pptx",
      mediaType: "application/octet-stream",
      byteSize: 1024,
      modifiedAt: 2_000,
      createdAt: 2_000,
      status: "available" as const,
      actions: { open: "available" as const, reveal: "available" as const },
    };
    const getChat = vi
      .fn()
      .mockResolvedValueOnce({
        ...chat,
        notes: [
          {
            id: "note-1",
            chatId: "chat-1",
            body: "Deck",
            createdAt: 2_000,
            attachments: [attachment],
          },
        ],
      })
      .mockResolvedValueOnce({
        ...chat,
        notes: [
          {
            id: "note-1",
            chatId: "chat-1",
            body: "Deck",
            createdAt: 2_000,
            attachments: [{ ...attachment, byteSize: 3072, modifiedAt: 4_000 }],
          },
        ],
      });
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat,
    });
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );
    await user.type(screen.getByLabelText("Add a note"), "Keep this draft");
    act(() => window.dispatchEvent(new Event("focus")));

    expect(await screen.findByText(/^3 KB ·/)).toBeVisible();
    expect(screen.getByLabelText("Add a note")).toHaveValue("Keep this draft");
  });

  it("does not let an older focus refresh overwrite a newer note mutation", async () => {
    const user = userEvent.setup();
    const focusRefresh = deferred<{
      id: string;
      title: string;
      accent: "ocean";
      createdAt: number;
      updatedAt: number;
      notes: never[];
    }>();
    const chat = {
      id: "chat-1",
      title: "Delivery",
      accent: "ocean" as const,
      createdAt: 100,
      updatedAt: 2_000,
    };
    const getChat = vi
      .fn()
      .mockResolvedValueOnce({ ...chat, notes: [] })
      .mockImplementationOnce(() => focusRefresh.promise);
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([chat]),
      getChat,
      appendNote: vi.fn().mockResolvedValue({
        id: "note-new",
        chatId: "chat-1",
        body: "Newer local note",
        createdAt: 3_000,
      }),
    });
    render(<App api={api} />);
    await user.click(
      await screen.findByRole("button", { name: "Open Delivery" }),
    );

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(getChat).toHaveBeenCalledTimes(2));
    await user.type(screen.getByLabelText("Add a note"), "Newer local note");
    await user.click(screen.getByRole("button", { name: /Add note/ }));
    expect(await screen.findByText("Newer local note")).toBeVisible();
    await act(async () => focusRefresh.resolve({ ...chat, notes: [] }));

    expect(screen.getByText("Newer local note")).toBeVisible();
  });

  it("copies with icon feedback, edits message files from the composer, and deletes an existing message", async () => {
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
            attachments: [
              {
                id: "attachment-keep",
                noteId: "note-1",
                filename: "keep.pdf",
                mediaType: "application/pdf",
                byteSize: 4,
                createdAt: 2_000,
              },
              {
                id: "attachment-remove",
                noteId: "note-1",
                filename: "remove.pdf",
                mediaType: "application/pdf",
                byteSize: 6,
                createdAt: 2_000,
              },
            ],
          },
        ],
      }),
      updateNote: vi.fn().mockResolvedValue({
        id: "note-1",
        chatId: "chat-1",
        body: "Revised **message**",
        createdAt: 3_600_000,
        attachments: [
          {
            id: "attachment-keep",
            noteId: "note-1",
            filename: "keep.pdf",
            mediaType: "application/pdf",
            byteSize: 4,
            createdAt: 2_000,
          },
          {
            id: "attachment-new",
            noteId: "note-1",
            filename: "new.pdf",
            mediaType: "application/pdf",
            byteSize: 3,
            createdAt: 3_600_000,
          },
        ],
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
    const editFiles = screen.getByLabelText("Pending files");
    expect(within(editFiles).getByText("keep.pdf")).toBeVisible();
    expect(within(editFiles).getByText("remove.pdf")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove remove.pdf" }));
    const newFile = new File(["new"], "new.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Attach files"), newFile);
    expect(screen.getByText("new.pdf")).toBeVisible();
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
      keepAttachmentIds: ["attachment-keep"],
      files: [newFile],
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
      enabledLabels: ["todo", "milestone"] as ("todo" | "milestone")[],
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

  it("commits a pending project update to the sidebar after navigation", async () => {
    const user = userEvent.setup();
    const alpha = {
      id: "alpha",
      title: "Alpha",
      accent: "coral" as const,
      enabledLabels: ["todo", "milestone"] as ("todo" | "milestone")[],
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
    const updateRequest = deferred<typeof alpha>();
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([alpha, beta]),
      getChat: vi.fn(async (id: string) => ({
        ...(id === "alpha" ? alpha : beta),
        notes: [],
      })),
      updateChat: vi.fn(() => updateRequest.promise),
    });
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "Open Alpha" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByLabelText("Project name");
    await user.clear(input);
    await user.type(input, "Alpha updated");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(screen.getByRole("button", { name: "Open Beta" }));
    expect(await screen.findByRole("heading", { name: "Beta" })).toBeVisible();

    await act(async () =>
      updateRequest.resolve({
        ...alpha,
        title: "Alpha updated",
        updatedAt: 3,
      }),
    );

    expect(
      screen.getByRole("button", { name: "Open Alpha updated" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Beta" })).toBeVisible();
  });

  it("commits a pending note deletion to the sidebar after navigation", async () => {
    const user = userEvent.setup();
    const alpha = {
      id: "alpha",
      title: "Alpha",
      accent: "coral" as const,
      enabledLabels: ["todo", "milestone"] as ("todo" | "milestone")[],
      createdAt: 1,
      updatedAt: 3,
    };
    const beta = {
      ...alpha,
      id: "beta",
      title: "Beta",
      accent: "moss" as const,
      updatedAt: 2,
    };
    const deleteRequest = deferred<void>();
    const note = {
      id: "note-alpha",
      chatId: "alpha",
      body: "Remove me",
      createdAt: 3,
      labels: [],
    };
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([alpha, beta]),
      getChat: vi.fn(async (id: string) => ({
        ...(id === "alpha" ? alpha : beta),
        notes: id === "alpha" ? [note] : [],
      })),
      deleteNote: vi.fn(() => deleteRequest.promise),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "Open Alpha" }));
    const noteItem = (await screen.findByText("Remove me")).closest("li")!;
    await user.click(
      within(noteItem).getByRole("button", { name: "Delete message" }),
    );
    await user.click(screen.getByRole("button", { name: "Open Beta" }));
    expect(await screen.findByRole("heading", { name: "Beta" })).toBeVisible();

    await act(async () => deleteRequest.resolve());

    const projectButtons = within(
      screen.getByRole("navigation", { name: "Projects" }),
    )
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(projectButtons).toEqual(["Open Beta", "Open Alpha"]);
    expect(screen.getByRole("heading", { name: "Beta" })).toBeVisible();
  });

  it("preserves the active project when another project deletion resolves", async () => {
    const user = userEvent.setup();
    const alpha = {
      id: "alpha",
      title: "Alpha",
      accent: "coral" as const,
      enabledLabels: ["todo", "milestone"] as ("todo" | "milestone")[],
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
    const deleteRequest = deferred<void>();
    const api = createApi({
      listChats: vi.fn().mockResolvedValue([alpha, beta]),
      getChat: vi.fn(async (id: string) => ({
        ...(id === "alpha" ? alpha : beta),
        notes: [],
      })),
      deleteChat: vi.fn(() => deleteRequest.promise),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "Open Alpha" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete project" }));
    await user.click(screen.getByRole("button", { name: "Open Beta" }));
    expect(await screen.findByRole("heading", { name: "Beta" })).toBeVisible();

    await act(async () => deleteRequest.resolve());

    expect(screen.queryByRole("button", { name: "Open Alpha" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Beta" })).toBeVisible();
  });

  it("keeps navigation stable while a note save is pending", async () => {
    const user = userEvent.setup();
    const alpha = {
      id: "alpha",
      title: "Alpha",
      accent: "coral" as const,
      enabledLabels: ["todo", "milestone"] as ("todo" | "milestone")[],
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
      labels: [];
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
        labels: [],
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
