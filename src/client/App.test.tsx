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
    appendNote: vi.fn(),
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
    await user.click(
      await screen.findByRole("button", { name: "Customize project" }),
    );
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

  it("keeps a failed draft, then saves multiline text literally with Cmd/Ctrl+Enter", async () => {
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
        body: "<img src=x>\nDecision recorded",
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
    await user.type(composer, "<img src=x>{enter}Decision recorded");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your note is still here",
    );
    expect(composer).toHaveValue("<img src=x>\nDecision recorded");

    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(await screen.findByText(/<img src=x>/)).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
    expect(composer).toHaveValue("");
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
    await user.click(
      await screen.findByRole("button", { name: "Customize project" }),
    );
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
