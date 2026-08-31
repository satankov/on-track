import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { Chat, ChatDetail } from "../domain/types.js";
import { ACCENTS, type Accent } from "../domain/validation.js";
import { apiClient, type ApiClient } from "./api.js";

const ACCENT_NAMES: Record<Accent, string> = {
  coral: "Coral",
  amber: "Amber",
  moss: "Moss",
  ocean: "Ocean",
  iris: "Iris",
  slate: "Slate",
};

function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
}

function isMobileViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 760px)").matches
  );
}

function focusMobileBackButton(): void {
  if (!isMobileViewport()) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("[data-back-button]")?.focus();
    });
  });
}

interface ProjectFormProps {
  chat?: Chat;
  onCancel: () => void;
  onSubmit: (input: { title: string; accent: Accent }) => Promise<void>;
}

function ProjectForm({ chat, onCancel, onSubmit }: ProjectFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(chat?.title ?? "");
  const [accent, setAccent] = useState<Accent>(chat?.accent ?? "coral");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = Boolean(chat);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof dialog.showModal !== "function") return;
    dialog.removeAttribute("open");
    dialog.showModal();
    return () => dialog.close();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSubmit({ title, accent });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The project could not be saved.",
      );
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      open
      className="dialog-backdrop"
      aria-labelledby="project-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="project-dialog"
        aria-labelledby="project-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">{editing ? "Project settings" : "New thread"}</p>
        <h2 id="project-dialog-title">
          {editing ? "Customize project" : "Create project"}
        </h2>
        <p className="dialog-copy">
          Give this stream a clear name and a color you can spot quickly.
        </p>
        <form onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="project-title">
            Project name
          </label>
          <input
            autoFocus
            id="project-title"
            className="text-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            required
          />

          <fieldset className="accent-fieldset">
            <legend>Project accent</legend>
            <div className="accent-options">
              {ACCENTS.map((value) => (
                <label
                  className="accent-option"
                  data-accent={value}
                  key={value}
                >
                  <input
                    type="radio"
                    name="accent"
                    value={value}
                    checked={accent === value}
                    onChange={() => setAccent(value)}
                  />
                  <span className="accent-swatch" aria-hidden="true" />
                  <span>{ACCENT_NAMES[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button button-quiet"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={saving}
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Create project"}
            </button>
          </div>
        </form>
      </section>
    </dialog>
  );
}

function ProjectRail({
  chats,
  activeId,
  onSelect,
  onCreate,
  navigationDisabled,
}: {
  chats: Chat[];
  activeId?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  navigationDisabled: boolean;
}) {
  return (
    <aside
      className={`project-rail ${activeId ? "project-rail--detail-open" : ""}`}
    >
      <header className="rail-header">
        <div>
          <p className="brand-mark">ON TRACK</p>
          <p className="brand-subtitle">Private project threads</p>
        </div>
        <button
          className="new-project-button"
          type="button"
          onClick={onCreate}
          disabled={navigationDisabled}
          aria-label="New project"
        >
          <span aria-hidden="true">+</span>
        </button>
      </header>

      <div className="rail-section-label">
        <span>Projects</span>
        <span>{String(chats.length).padStart(2, "0")}</span>
      </div>

      <nav aria-label="Projects" className="project-list">
        {chats.map((chat) => (
          <button
            className={`project-item ${activeId === chat.id ? "project-item--active" : ""}`}
            data-accent={chat.accent}
            data-chat-id={chat.id}
            key={chat.id}
            type="button"
            aria-label={`Open ${chat.title}`}
            aria-current={activeId === chat.id ? "page" : undefined}
            disabled={navigationDisabled}
            onClick={() => onSelect(chat.id)}
          >
            <span className="project-dot" aria-hidden="true" />
            <span className="project-item-copy">
              <strong>{chat.title}</strong>
              <small>
                {chat.updatedAt === chat.createdAt
                  ? "Ready for the first note"
                  : "Recently updated"}
              </small>
            </span>
            <span className="project-arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        ))}
      </nav>

      <footer className="local-footnote">
        <span className="local-indicator" aria-hidden="true" />
        <span>
          <strong>Local only</strong>
          <small>Not encrypted yet</small>
        </span>
      </footer>
    </aside>
  );
}

function EmptyWorkspace({
  loading,
  onCreate,
}: {
  loading: boolean;
  onCreate: () => void;
}) {
  return (
    <main className="workspace workspace-empty">
      <div className="empty-thread" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="empty-copy">
        <p className="eyebrow">Your personal project log</p>
        <h1>A quiet place for every moving project.</h1>
        <p>
          Capture decisions, loose ends, and the thought you will need three
          weeks from now. Nothing leaves this computer.
        </p>
        <button
          className="button button-primary"
          type="button"
          onClick={onCreate}
          disabled={loading}
        >
          {loading ? "Loading…" : "Create your first project"}
        </button>
      </div>
    </main>
  );
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function ChatWorkspace({
  detail,
  draft,
  error,
  saving,
  onBack,
  onCustomize,
  onDraftChange,
  onSubmit,
  navigationDisabled,
}: {
  detail: ChatDetail;
  draft: string;
  error: string;
  saving: boolean;
  onBack: () => void;
  onCustomize: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  navigationDisabled: boolean;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <main className="workspace workspace-chat" data-accent={detail.accent}>
      <header className="chat-header">
        <button
          className="back-button"
          data-back-button
          type="button"
          onClick={onBack}
          disabled={navigationDisabled}
          aria-label="Back to projects"
        >
          ←
        </button>
        <div className="chat-heading">
          <p className="eyebrow">Project thread</p>
          <h1>{detail.title}</h1>
        </div>
        <button
          className="button button-quiet customize-button"
          type="button"
          onClick={onCustomize}
        >
          Customize project
        </button>
      </header>

      <section className="history" aria-label={`${detail.title} notes`}>
        <div className="thread-line" aria-hidden="true" />
        {detail.notes.length === 0 ? (
          <div className="no-notes">
            <p className="eyebrow">The thread starts here</p>
            <h2>What is worth remembering?</h2>
            <p>
              Record a decision, an open question, or the next concrete move.
            </p>
          </div>
        ) : (
          <ol className="note-list">
            {detail.notes.map((note) => (
              <li className="note" key={note.id}>
                <span className="note-node" aria-hidden="true" />
                <time dateTime={new Date(note.createdAt).toISOString()}>
                  {formatTime(note.createdAt)}
                </time>
                <p>{note.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="composer-wrap">
        {error && (
          <p role="alert" className="composer-error">
            Your note is still here. {error}
          </p>
        )}
        <div className="composer">
          <textarea
            aria-label="Add a note"
            placeholder="Add a note to this project…"
            value={draft}
            maxLength={10_000}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="composer-bar">
            <span>
              <kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> to add
            </span>
            <button
              className="send-button"
              type="button"
              onClick={onSubmit}
              disabled={saving || !draft.trim()}
            >
              {saving ? "Adding…" : "Add note"}{" "}
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}

export function App({ api = apiClient }: { api?: ApiClient }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [active, setActive] = useState<ChatDetail>();
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<"create" | "edit">();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const selectionRequest = useRef(0);
  const activeId = useRef<string | undefined>(undefined);

  useEffect(() => {
    activeId.current = active?.id;
  }, [active?.id]);

  useEffect(() => {
    let current = true;
    api
      .listChats()
      .then((result) => current && setChats(result))
      .catch(
        () =>
          current && setError("The local project list could not be loaded."),
      )
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [api]);

  const activeSummary = useMemo(
    () => chats.find((chat) => chat.id === active?.id),
    [active?.id, chats],
  );

  async function selectChat(id: string) {
    if (savingNote) return;
    const request = ++selectionRequest.current;
    setError("");
    try {
      const detail = await api.getChat(id);
      if (request !== selectionRequest.current) return;
      setActive(detail);
      setDraft("");
      focusMobileBackButton();
    } catch (caught) {
      if (request !== selectionRequest.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "The project could not be opened.",
      );
    }
  }

  async function createChat(input: { title: string; accent: Accent }) {
    const chat = await api.createChat(input);
    selectionRequest.current += 1;
    setChats((current) => [chat, ...current]);
    setActive({ ...chat, notes: [] });
    setDialog(undefined);
    focusMobileBackButton();
  }

  async function updateChat(input: { title: string; accent: Accent }) {
    if (!active) return;
    const chat = await api.updateChat(active.id, input);
    setChats((current) =>
      sortChats(current.map((item) => (item.id === chat.id ? chat : item))),
    );
    setActive((current) =>
      current?.id === chat.id ? { ...current, ...chat } : current,
    );
    setDialog(undefined);
  }

  async function appendNote() {
    if (!active || !draft.trim() || savingNote) return;
    const projectId = active.id;
    const submittedDraft = draft;
    setSavingNote(true);
    setError("");
    try {
      const note = await api.appendNote(projectId, { body: submittedDraft });
      setActive((current) =>
        current?.id === projectId
          ? { ...current, notes: [...current.notes, note] }
          : current,
      );
      setChats((current) =>
        sortChats(
          current.map((chat) =>
            chat.id === projectId
              ? { ...chat, updatedAt: note.createdAt }
              : chat,
          ),
        ),
      );
      if (activeId.current === projectId) {
        setDraft((current) => (current === submittedDraft ? "" : current));
      }
    } catch (caught) {
      if (activeId.current === projectId) {
        setError(
          caught instanceof Error
            ? caught.message
            : "The note could not be added.",
        );
      }
    } finally {
      setSavingNote(false);
    }
  }

  function backToProjects() {
    if (savingNote) return;
    const projectId = active?.id;
    selectionRequest.current += 1;
    setActive(undefined);
    if (projectId && isMobileViewport()) {
      requestAnimationFrame(() => {
        const project = [
          ...document.querySelectorAll<HTMLButtonElement>("[data-chat-id]"),
        ].find((button) => button.dataset.chatId === projectId);
        project?.focus();
      });
    }
  }

  return (
    <div className="app-shell">
      <ProjectRail
        chats={chats}
        activeId={active?.id}
        onSelect={selectChat}
        onCreate={() => setDialog("create")}
        navigationDisabled={savingNote}
      />
      {!active && error && (
        <p className="global-error" role="alert">
          {error}
        </p>
      )}
      {active ? (
        <ChatWorkspace
          detail={active}
          draft={draft}
          error={error}
          saving={savingNote}
          onBack={backToProjects}
          onCustomize={() => setDialog("edit")}
          onDraftChange={setDraft}
          onSubmit={appendNote}
          navigationDisabled={savingNote}
        />
      ) : (
        <EmptyWorkspace
          loading={loading}
          onCreate={() => setDialog("create")}
        />
      )}
      {dialog === "create" && (
        <ProjectForm
          onCancel={() => setDialog(undefined)}
          onSubmit={createChat}
        />
      )}
      {dialog === "edit" && activeSummary && (
        <ProjectForm
          chat={activeSummary}
          onCancel={() => setDialog(undefined)}
          onSubmit={updateChat}
        />
      )}
    </div>
  );
}
