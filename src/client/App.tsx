import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Chat, ChatDetail, Note } from "../domain/types.js";
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

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

function toDateTimeLocalValue(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocalValue(value: string): number {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Choose a valid timestamp.");
  return timestamp;
}

function chatActivityFromNotes(chat: ChatDetail, notes: Note[]): number {
  return notes.reduce(
    (newest, note) => Math.max(newest, note.createdAt),
    chat.createdAt,
  );
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

function hasAttachments(note: Note): boolean {
  return (note.attachments?.length ?? 0) > 0;
}

function formatFileSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(filename: string, mediaType: string): string {
  const extension = filename.includes(".")
    ? filename.split(".").pop()?.toUpperCase()
    : "";
  return extension || mediaType.split("/").pop()?.toUpperCase() || "FILE";
}

function useModalDialog(): RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof dialog.showModal !== "function") return;
    dialog.removeAttribute("open");
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return dialogRef;
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

function formatMessageTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatMessageDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function messageDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function groupNotesByDay(
  notes: Note[],
): { key: string; label: string; notes: Note[] }[] {
  return notes.reduce<{ key: string; label: string; notes: Note[] }[]>(
    (groups, note) => {
      const key = messageDateKey(note.createdAt);
      const current = groups.at(-1);
      if (current?.key === key) {
        current.notes.push(note);
      } else {
        groups.push({
          key,
          label: formatMessageDate(note.createdAt),
          notes: [note],
        });
      }
      return groups;
    },
    [],
  );
}

interface ProjectFormProps {
  chat?: Chat;
  onCancel: () => void;
  onSubmit: (input: { title: string; accent: Accent }) => Promise<void>;
}

function ProjectForm({ chat, onCancel, onSubmit }: ProjectFormProps) {
  const dialogRef = useModalDialog();
  const [title, setTitle] = useState(chat?.title ?? "");
  const [accent, setAccent] = useState<Accent>(chat?.accent ?? "coral");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = Boolean(chat);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSubmit({ title, accent });
    } catch (caught) {
      setError(errorMessage(caught, "The project could not be saved."));
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
          {editing ? "Edit project" : "Create project"}
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

function ProjectEditWorkspace({
  chat,
  onBack,
  onSubmit,
  onDelete,
}: {
  chat: ChatDetail;
  onBack: () => void;
  onSubmit: (input: { title: string; accent: Accent }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(chat.title);
  const [accent, setAccent] = useState<Accent>(chat.accent);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSubmit({ title, accent });
    } catch (caught) {
      setError(errorMessage(caught, "The project could not be saved."));
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${chat.title}" and all of its messages?`)) {
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await onDelete();
    } catch (caught) {
      setError(errorMessage(caught, "The project could not be deleted."));
      setDeleting(false);
    }
  }

  return (
    <main className="workspace settings-workspace project-edit-workspace">
      <header className="settings-workspace-header">
        <p className="eyebrow">Project</p>
        <h1>Edit project</h1>
      </header>
      <section className="settings-panel" aria-labelledby="project-edit-title">
        <div className="settings-panel-copy">
          <h2 id="project-edit-title">{chat.title}</h2>
          <p>Change the project name, accent color, or delete this project.</p>
        </div>
        <form className="project-edit-form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="project-edit-name">
            Project name
          </label>
          <input
            autoFocus
            id="project-edit-name"
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
                    name="project-edit-accent"
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
          <div className="project-edit-actions">
            <button
              className="button button-danger"
              type="button"
              onClick={handleDelete}
              disabled={saving || deleting}
            >
              {deleting ? "Deleting…" : "Delete project"}
            </button>
            <span />
            <button
              className="button button-quiet"
              type="button"
              onClick={onBack}
              disabled={saving || deleting}
            >
              Back to project
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={saving || deleting}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function ProjectRail({
  chats,
  activeId,
  onSelect,
  onCreate,
  onSettings,
  navigationDisabled,
}: {
  chats: Chat[];
  activeId?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSettings: () => void;
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
        <span className="local-footnote-copy">
          <strong>Local only</strong>
          <small>Not encrypted yet</small>
        </span>
        <button
          className="settings-icon-button"
          type="button"
          onClick={onSettings}
          aria-label="Settings. Local only, not encrypted yet."
        >
          <SettingsIcon />
        </button>
      </footer>
    </aside>
  );
}

type WorkspacePlaceholderState = "loading" | "empty" | "choose" | "error";

function EmptyWorkspace({
  state,
  onCreate,
}: {
  state: WorkspacePlaceholderState;
  onCreate: () => void;
}) {
  const content = {
    loading: {
      eyebrow: "Projects",
      heading: "Loading your projects.",
      copy: "Your local workspace is opening.",
    },
    empty: {
      eyebrow: "Your personal project log",
      heading: "A quiet place for every moving project.",
      copy: "Capture decisions, loose ends, and the thought you will need three weeks from now. Nothing leaves this computer.",
    },
    choose: {
      eyebrow: "Projects ready",
      heading: "Choose a project to continue.",
      copy: "Select a project from the list to reopen its thread, or start a new one when another moving piece appears.",
    },
    error: {
      eyebrow: "Projects unavailable",
      heading: "Your project list could not be loaded.",
      copy: "Check the local service and try again. Existing local data has not been changed.",
    },
  }[state];
  const statusProps =
    state === "loading"
      ? ({ role: "status", "aria-live": "polite" } as const)
      : undefined;

  return (
    <main className="workspace workspace-empty">
      <div className="empty-thread" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="empty-copy" {...statusProps}>
        <p className="eyebrow">{content.eyebrow}</p>
        <h1>{content.heading}</h1>
        <p>{content.copy}</p>
        {state === "empty" && (
          <button
            className="button button-primary"
            type="button"
            onClick={onCreate}
          >
            Create your first project
          </button>
        )}
      </div>
    </main>
  );
}

function SettingsRail({ onBack }: { onBack: () => void }) {
  return (
    <aside className="project-rail settings-rail">
      <header className="rail-header settings-rail-header">
        <div>
          <p className="brand-mark">Settings</p>
          <p className="brand-subtitle">Local workspace controls</p>
        </div>
        <button
          className="settings-back-button"
          type="button"
          onClick={onBack}
          aria-label="Back to projects"
        >
          <ArrowLeftIcon />
        </button>
      </header>
      <nav aria-label="Settings sections" className="settings-section-list">
        <button
          className="settings-section-item settings-section-item--active"
          type="button"
          aria-current="page"
        >
          <span className="settings-section-icon" aria-hidden="true">
            <DatabaseIcon />
          </span>
          <span>
            <strong>Database</strong>
            <small>Import and export</small>
          </span>
        </button>
      </nav>
    </aside>
  );
}

function SettingsWorkspace({
  onExport,
  onImport,
}: {
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
}) {
  const [file, setFile] = useState<File>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await onExport();
      setStatus("Database export is ready.");
    } catch (caught) {
      setError(errorMessage(caught, "The database could not be exported."));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!file) return;
    if (
      !window.confirm(
        "Importing this backup will replace the current local database.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await onImport(file);
      setStatus("Database imported.");
    } catch (caught) {
      setError(errorMessage(caught, "The database could not be imported."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace settings-workspace">
      <header className="settings-workspace-header">
        <p className="eyebrow">Database</p>
        <h1>Database settings</h1>
      </header>
      <section className="settings-panel" aria-labelledby="database-transfer">
        <div className="settings-panel-copy">
          <h2 id="database-transfer">Import and export</h2>
          <p>
            Export a SQLite backup or import one you trust. Backups are still
            plaintext.
          </p>
        </div>
        <div className="settings-control-group">
          <div className="settings-control-row">
            <div>
              <strong>Export database</strong>
              <small>Create a restorable copy of the current local data.</small>
            </div>
            <button
              className="button button-primary"
              type="button"
              onClick={handleExport}
              disabled={busy}
            >
              Export database
            </button>
          </div>
          <div className="settings-control-row settings-control-row--stacked">
            <label className="field-label" htmlFor="database-import">
              Choose database backup
            </label>
            <input
              id="database-import"
              className="file-input"
              type="file"
              accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
            <button
              className="button button-primary"
              type="button"
              onClick={handleImport}
              disabled={busy || !file}
            >
              Import database
            </button>
          </div>
        </div>
        {status && (
          <p role="status" className="form-status">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 0 1-4 0v-.08A1.7 1.7 0 0 0 8.96 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.04A1.7 1.7 0 0 0 4.6 8.92a1.7 1.7 0 0 0-.34-1.87L4.2 6.99a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 0 1 4 0v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 0 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v14c0 1.66 3.13 3 7 3s7-1.34 7-3V5" />
      <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m21.4 11.6-8.5 8.5a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 1 1 5 5l-9.3 9.3a2 2 0 0 1-2.8-2.8l8.6-8.6" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
      <path d="M19 19H5V5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function MessageActionButton({
  label,
  children,
  danger = false,
  onClick,
}: {
  label: string;
  children: ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`message-action ${danger ? "message-action--danger" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MarkdownMessage({ body }: { body: string }) {
  if (!body.trim()) return null;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
      {body}
    </ReactMarkdown>
  );
}

function AttachmentList({
  note,
  onOpen,
}: {
  note: Note;
  onOpen: (note: Note, attachmentId: string) => void;
}) {
  if (!note.attachments?.length) return null;
  return (
    <div className="attachment-list" aria-label="Message attachments">
      {note.attachments.map((attachment) => (
        <button
          className="attachment-card"
          key={attachment.id}
          type="button"
          aria-label={`Open ${attachment.filename}`}
          onClick={() => onOpen(note, attachment.id)}
        >
          <span className="attachment-type" aria-hidden="true">
            {fileTypeLabel(attachment.filename, attachment.mediaType)}
          </span>
          <span className="attachment-copy">
            <strong>{attachment.filename}</strong>
            <small>{formatFileSize(attachment.byteSize)}</small>
          </span>
          <span className="attachment-open" aria-hidden="true">
            <OpenIcon />
          </span>
        </button>
      ))}
    </div>
  );
}

function ChatWorkspace({
  detail,
  draft,
  draftTimestamp,
  error,
  editingNote,
  editingAttachmentIds,
  pendingFiles,
  historyFilter,
  saving,
  timestampOpen,
  onBack,
  onCancelEditNote,
  onCustomize,
  onCopyNote,
  onOpenAttachment,
  onEditNote,
  onDeleteNote,
  onDraftChange,
  onDraftTimestampChange,
  onFilesSelected,
  onHistoryFilterChange,
  onRemoveEditingAttachment,
  onRemovePendingFile,
  onSubmit,
  onToggleTimestamp,
  copiedNoteId,
  navigationDisabled,
}: {
  detail: ChatDetail;
  draft: string;
  draftTimestamp: string;
  error: string;
  editingNote?: Note;
  editingAttachmentIds: string[];
  pendingFiles: File[];
  historyFilter: "all" | "attachments";
  saving: boolean;
  timestampOpen: boolean;
  onBack: () => void;
  onCancelEditNote: () => void;
  onCustomize: () => void;
  onCopyNote: (note: Note) => void;
  onOpenAttachment: (note: Note, attachmentId: string) => void;
  onEditNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
  onDraftChange: (value: string) => void;
  onDraftTimestampChange: (value: string) => void;
  onFilesSelected: (files: File[]) => void;
  onHistoryFilterChange: (filter: "all" | "attachments") => void;
  onRemoveEditingAttachment: (attachmentId: string) => void;
  onRemovePendingFile: (index: number) => void;
  onSubmit: () => void;
  onToggleTimestamp: () => void;
  copiedNoteId?: string;
  navigationDisabled: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentCount = detail.notes.filter(hasAttachments).length;
  const visibleNotes =
    historyFilter === "attachments"
      ? detail.notes.filter(hasAttachments)
      : detail.notes;
  const showingEmptyFilter =
    historyFilter === "attachments" && visibleNotes.length === 0;
  const editingAttachments =
    editingNote?.attachments?.filter((attachment) =>
      editingAttachmentIds.includes(attachment.id),
    ) ?? [];

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <main className="workspace workspace-chat" data-accent={detail.accent}>
      <header className="chat-header">
        <div className="chat-header-inner">
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
            className="button button-quiet edit-project-button"
            type="button"
            onClick={onCustomize}
          >
            Edit
          </button>
        </div>
      </header>

      <nav className="history-filter" aria-label="History filters">
        <div className="history-filter-inner">
          <button
            type="button"
            className={`history-filter-button ${historyFilter === "all" ? "history-filter-button--active" : ""}`}
            aria-pressed={historyFilter === "all"}
            onClick={() => onHistoryFilterChange("all")}
          >
            All {detail.notes.length}
          </button>
          <button
            type="button"
            className={`history-filter-button ${historyFilter === "attachments" ? "history-filter-button--active" : ""}`}
            aria-pressed={historyFilter === "attachments"}
            onClick={() => onHistoryFilterChange("attachments")}
          >
            Files {attachmentCount}
          </button>
        </div>
      </nav>

      <section className="history" aria-label={`${detail.title} messages`}>
        {detail.notes.length === 0 ? (
          <>
            <div className="no-notes">
              <p className="eyebrow">The thread starts here</p>
              <h2>What is worth remembering?</h2>
              <p>
                Record a decision, an open question, or the next concrete move.
              </p>
            </div>
          </>
        ) : showingEmptyFilter ? (
          <div className="message-groups">
            <div className="no-notes no-notes--filtered">
              <p className="eyebrow">Files</p>
              <h2>No attached files yet.</h2>
              <p>
                Messages with attachments will appear in this project slice.
              </p>
            </div>
          </div>
        ) : (
          <div className="message-groups">
            {groupNotesByDay(visibleNotes).map((group) => (
              <section className="message-day" key={group.key}>
                <div className="message-date-separator">{group.label}</div>
                <ol className="message-list">
                  {group.notes.map((note) => {
                    const copied = copiedNoteId === note.id;
                    return (
                      <li
                        className="message-row message-row--own"
                        key={note.id}
                      >
                        <div className="message-stack">
                          <article className="message-bubble">
                            <AttachmentList
                              note={note}
                              onOpen={onOpenAttachment}
                            />
                            <div className="message-body note-body">
                              <MarkdownMessage body={note.body} />
                            </div>
                            <footer className="message-footer">
                              <time
                                className="message-time"
                                dateTime={new Date(
                                  note.createdAt,
                                ).toISOString()}
                              >
                                {formatMessageTime(note.createdAt)}
                              </time>
                            </footer>
                          </article>
                          <div
                            className="message-actions"
                            aria-label="Message actions"
                          >
                            <MessageActionButton
                              label={copied ? "Message copied" : "Copy message"}
                              onClick={() => onCopyNote(note)}
                            >
                              {copied ? <CheckIcon /> : <CopyIcon />}
                            </MessageActionButton>
                            <MessageActionButton
                              label="Edit message"
                              onClick={() => onEditNote(note)}
                            >
                              <EditIcon />
                            </MessageActionButton>
                            <MessageActionButton
                              label="Delete message"
                              danger
                              onClick={() => onDeleteNote(note)}
                            >
                              <TrashIcon />
                            </MessageActionButton>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </section>

      <footer className="composer-wrap">
        {error && (
          <p role="alert" className="composer-error">
            Your note is still here. {error}
          </p>
        )}
        <div className={`composer ${editingNote ? "composer--editing" : ""}`}>
          {(editingAttachments.length > 0 || pendingFiles.length > 0) && (
            <div className="pending-attachments" aria-label="Pending files">
              {editingAttachments.map((attachment) => (
                <span className="pending-attachment" key={attachment.id}>
                  <span>
                    <strong>{attachment.filename}</strong>
                    <small>{formatFileSize(attachment.byteSize)}</small>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.filename}`}
                    onClick={() => onRemoveEditingAttachment(attachment.id)}
                  >
                    <XIcon />
                  </button>
                </span>
              ))}
              {pendingFiles.map((file, index) => (
                <span
                  className="pending-attachment"
                  key={`${file.name}-${index}`}
                >
                  <span>
                    <strong>{file.name}</strong>
                    <small>{formatFileSize(file.size)}</small>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => onRemovePendingFile(index)}
                  >
                    <XIcon />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            data-composer-textarea
            aria-label={editingNote ? "Edit message" : "Add a note"}
            placeholder={
              editingNote ? "Edit this message…" : "Add a note to this project…"
            }
            value={draft}
            maxLength={10_000}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {timestampOpen && (
            <div className="composer-timestamp-row">
              <label className="field-label" htmlFor="composer-timestamp">
                Message timestamp
              </label>
              <input
                id="composer-timestamp"
                className="text-input composer-timestamp-input"
                type="datetime-local"
                value={draftTimestamp}
                onChange={(event) => onDraftTimestampChange(event.target.value)}
              />
            </div>
          )}
          <div className="composer-bar">
            <span>
              <kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> to add
            </span>
            <div className="composer-tools">
              <input
                ref={fileInputRef}
                className="visually-hidden-file"
                type="file"
                multiple
                aria-label="Attach files"
                onChange={(event) => {
                  onFilesSelected(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                className="composer-icon-button"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Open file picker"
                title="Attach files"
              >
                <PaperclipIcon />
              </button>
              <button
                className="composer-icon-button"
                type="button"
                onClick={onToggleTimestamp}
                aria-label={
                  timestampOpen ? "Hide timestamp" : "Choose timestamp"
                }
                aria-expanded={timestampOpen}
                title={timestampOpen ? "Hide timestamp" : "Choose timestamp"}
              >
                <ClockIcon />
              </button>
            </div>
            {editingNote && (
              <button
                className="composer-cancel-button"
                type="button"
                onClick={onCancelEditNote}
              >
                Cancel
              </button>
            )}
            <button
              className="send-button"
              type="button"
              onClick={onSubmit}
              disabled={
                saving ||
                (!draft.trim() &&
                  pendingFiles.length === 0 &&
                  editingAttachments.length === 0)
              }
            >
              {saving
                ? editingNote
                  ? "Saving…"
                  : "Adding…"
                : editingNote
                  ? "Save"
                  : "Add note"}{" "}
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
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [dialog, setDialog] = useState<"create" | "edit">();
  const [mode, setMode] = useState<"projects" | "settings" | "projectEdit">(
    "projects",
  );
  const [editingNote, setEditingNote] = useState<Note>();
  const [editingAttachmentIds, setEditingAttachmentIds] = useState<string[]>(
    [],
  );
  const [copiedNoteId, setCopiedNoteId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "attachments">(
    "all",
  );
  const [draftTimestamp, setDraftTimestamp] = useState("");
  const [composerTimestampOpen, setComposerTimestampOpen] = useState(false);
  const [error, setError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const selectionRequest = useRef(0);
  const activeId = useRef<string | undefined>(undefined);
  const copyResetTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    activeId.current = active?.id;
  }, [active?.id]);

  useEffect(() => {
    let current = true;
    api
      .listChats()
      .then((result) => {
        if (!current) return;
        setChats(result);
        setLoadState("loaded");
      })
      .catch(() => {
        if (!current) return;
        setError("The local project list could not be loaded.");
        setLoadState("error");
      });
    return () => {
      current = false;
    };
  }, [api]);

  const placeholderState: WorkspacePlaceholderState =
    loadState === "loading"
      ? "loading"
      : loadState === "error"
        ? "error"
        : chats.length > 0
          ? "choose"
          : "empty";

  async function selectChat(id: string) {
    if (savingNote) return;
    const request = ++selectionRequest.current;
    setMode("projects");
    setError("");
    try {
      const detail = await api.getChat(id);
      if (request !== selectionRequest.current) return;
      setActive(detail);
      setDraft("");
      setPendingFiles([]);
      setHistoryFilter("all");
      setDraftTimestamp("");
      setComposerTimestampOpen(false);
      setEditingNote(undefined);
      setEditingAttachmentIds([]);
      focusMobileBackButton();
    } catch (caught) {
      if (request !== selectionRequest.current) return;
      setError(errorMessage(caught, "The project could not be opened."));
    }
  }

  async function createChat(input: { title: string; accent: Accent }) {
    const chat = await api.createChat(input);
    selectionRequest.current += 1;
    setChats((current) => [chat, ...current]);
    setActive({ ...chat, notes: [] });
    setDialog(undefined);
    setPendingFiles([]);
    setHistoryFilter("all");
    setDraftTimestamp("");
    setComposerTimestampOpen(false);
    setEditingNote(undefined);
    setEditingAttachmentIds([]);
    focusMobileBackButton();
  }

  async function updateChat(input: { title: string; accent: Accent }) {
    if (!active) return;
    const projectId = active.id;
    const chat = await api.updateChat(active.id, input);
    setChats((current) =>
      sortChats(current.map((item) => (item.id === chat.id ? chat : item))),
    );
    setActive((current) =>
      current?.id === chat.id ? { ...current, ...chat } : current,
    );
    setDialog(undefined);
    setMode("projects");
    if (activeId.current === projectId) focusMobileBackButton();
  }

  async function deleteChat() {
    if (!active) return;
    const projectId = active.id;
    await api.deleteChat(projectId);
    selectionRequest.current += 1;
    setChats((current) => current.filter((chat) => chat.id !== projectId));
    setActive(undefined);
    setDraft("");
    setPendingFiles([]);
    setHistoryFilter("all");
    setDraftTimestamp("");
    setComposerTimestampOpen(false);
    setError("");
    setEditingNote(undefined);
    setEditingAttachmentIds([]);
    setMode("projects");
  }

  async function appendNote() {
    if (!active || (!draft.trim() && pendingFiles.length === 0) || savingNote)
      return;
    const projectId = active.id;
    const submittedDraft = draft;
    const submittedFiles = pendingFiles;
    const editing = editingNote;
    const timestampValue = draftTimestamp;
    setSavingNote(true);
    setError("");
    try {
      const timestamp =
        (editing || composerTimestampOpen) && timestampValue
          ? fromDateTimeLocalValue(timestampValue)
          : undefined;
      if (editing) {
        if (timestamp === undefined)
          throw new Error("Choose a valid timestamp.");
        await updateNote(editing, {
          body: submittedDraft,
          createdAt: timestamp,
          keepAttachmentIds: editingAttachmentIds,
          files: submittedFiles,
        });
      } else {
        const note = await api.appendNote(projectId, {
          body: submittedDraft,
          ...(timestamp === undefined ? {} : { createdAt: timestamp }),
          ...(submittedFiles.length === 0 ? {} : { files: submittedFiles }),
        });
        setActive((current) =>
          current?.id === projectId
            ? { ...current, notes: sortNotes([...current.notes, note]) }
            : current,
        );
        setChats((current) =>
          sortChats(
            current.map((chat) =>
              chat.id === projectId
                ? {
                    ...chat,
                    updatedAt: chatActivityFromNotes(active, [
                      ...active.notes,
                      note,
                    ]),
                  }
                : chat,
            ),
          ),
        );
      }
      if (activeId.current === projectId) {
        setDraft((current) => (current === submittedDraft ? "" : current));
        setPendingFiles((current) =>
          current === submittedFiles ? [] : current,
        );
        setDraftTimestamp("");
        setComposerTimestampOpen(false);
      }
    } catch (caught) {
      if (activeId.current === projectId) {
        setError(errorMessage(caught, "The note could not be added."));
      }
    } finally {
      setSavingNote(false);
    }
  }

  function startEditingNote(note: Note) {
    setEditingNote(note);
    setEditingAttachmentIds(
      note.attachments?.map((attachment) => attachment.id) ?? [],
    );
    setDraft(note.body);
    setPendingFiles([]);
    setDraftTimestamp(toDateTimeLocalValue(note.createdAt));
    setComposerTimestampOpen(false);
    setError("");
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>("[data-composer-textarea]")
        ?.focus();
    });
  }

  function cancelEditingNote() {
    setEditingNote(undefined);
    setEditingAttachmentIds([]);
    setDraft("");
    setPendingFiles([]);
    setDraftTimestamp("");
    setComposerTimestampOpen(false);
    setError("");
  }

  async function copyNote(note: Note) {
    try {
      await navigator.clipboard.writeText(note.body);
      window.clearTimeout(copyResetTimer.current);
      setCopiedNoteId(note.id);
      copyResetTimer.current = window.setTimeout(() => {
        setCopiedNoteId((current) =>
          current === note.id ? undefined : current,
        );
      }, 1200);
    } catch {
      setError("The message could not be copied.");
    }
  }

  async function openAttachment(note: Note, attachmentId: string) {
    if (!active) return;
    const attachment = note.attachments?.find(
      (item) => item.id === attachmentId,
    );
    if (!attachment) return;
    try {
      const blob = await api.downloadAttachment(
        active.id,
        note.id,
        attachmentId,
      );
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (caught) {
      setError(errorMessage(caught, "The attachment could not be opened."));
    }
  }

  function addPendingFiles(files: File[]) {
    setPendingFiles((current) => [...current, ...files]);
  }

  function removePendingFile(index: number) {
    setPendingFiles((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  function removeEditingAttachment(attachmentId: string) {
    setEditingAttachmentIds((current) =>
      current.filter((id) => id !== attachmentId),
    );
  }

  async function updateNote(
    noteToUpdate: Note,
    input: {
      body: string;
      createdAt: number;
      keepAttachmentIds?: string[];
      files?: File[];
    },
  ) {
    if (!active) return;
    const projectId = active.id;
    const updated = await api.updateNote(projectId, noteToUpdate.id, input);
    setActive((current) => {
      if (!current) return current;
      const notes = sortNotes(
        current.notes.map((note) => (note.id === updated.id ? updated : note)),
      );
      return {
        ...current,
        notes,
        updatedAt: chatActivityFromNotes(current, notes),
      };
    });
    setChats((current) =>
      sortChats(
        current.map((chat) =>
          chat.id === projectId
            ? {
                ...chat,
                updatedAt: chatActivityFromNotes(
                  active,
                  sortNotes(
                    active.notes.map((note) =>
                      note.id === updated.id ? updated : note,
                    ),
                  ),
                ),
              }
            : chat,
        ),
      ),
    );
    setEditingNote(undefined);
    setEditingAttachmentIds([]);
  }

  async function deleteNote(note: Note) {
    if (!active) return;
    if (!window.confirm("Delete this message?")) return;
    await api.deleteNote(active.id, note.id);
    const remaining = active.notes.filter((item) => item.id !== note.id);
    const updatedAt = chatActivityFromNotes(active, remaining);
    setActive((current) =>
      current?.id === active.id
        ? { ...current, notes: remaining, updatedAt }
        : current,
    );
    setChats((current) =>
      sortChats(
        current.map((chat) =>
          chat.id === active.id ? { ...chat, updatedAt } : chat,
        ),
      ),
    );
  }

  async function exportDatabase() {
    const blob = await api.exportDatabase();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `on-track-${new Date().toISOString().slice(0, 10)}.sqlite`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importDatabase(file: File) {
    await api.importDatabase(file);
    const importedChats = await api.listChats();
    setChats(importedChats);
    setActive(undefined);
    setDraftTimestamp("");
    setPendingFiles([]);
    setHistoryFilter("all");
    setComposerTimestampOpen(false);
    setMode("projects");
    setDraft("");
    setError("");
  }

  function backToProjects() {
    if (savingNote) return;
    const projectId = active?.id;
    selectionRequest.current += 1;
    setActive(undefined);
    setEditingNote(undefined);
    setEditingAttachmentIds([]);
    setDraft("");
    setPendingFiles([]);
    setHistoryFilter("all");
    setDraftTimestamp("");
    setComposerTimestampOpen(false);
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
      {mode === "settings" ? (
        <SettingsRail onBack={() => setMode("projects")} />
      ) : (
        <ProjectRail
          chats={chats}
          activeId={active?.id}
          onSelect={selectChat}
          onCreate={() => setDialog("create")}
          onSettings={() => setMode("settings")}
          navigationDisabled={savingNote}
        />
      )}
      {!active && error && (
        <p className="global-error" role="alert">
          {error}
        </p>
      )}
      {mode === "settings" ? (
        <SettingsWorkspace
          onExport={exportDatabase}
          onImport={importDatabase}
        />
      ) : mode === "projectEdit" && active ? (
        <ProjectEditWorkspace
          chat={active}
          onBack={() => setMode("projects")}
          onSubmit={updateChat}
          onDelete={deleteChat}
        />
      ) : active ? (
        <ChatWorkspace
          detail={active}
          draft={draft}
          draftTimestamp={draftTimestamp}
          error={error}
          editingNote={editingNote}
          editingAttachmentIds={editingAttachmentIds}
          pendingFiles={pendingFiles}
          historyFilter={historyFilter}
          saving={savingNote}
          timestampOpen={composerTimestampOpen}
          onBack={backToProjects}
          onCustomize={() => setMode("projectEdit")}
          onCopyNote={copyNote}
          onOpenAttachment={openAttachment}
          onEditNote={startEditingNote}
          onCancelEditNote={cancelEditingNote}
          onDeleteNote={deleteNote}
          onDraftChange={setDraft}
          onDraftTimestampChange={setDraftTimestamp}
          onFilesSelected={addPendingFiles}
          onHistoryFilterChange={setHistoryFilter}
          onRemoveEditingAttachment={removeEditingAttachment}
          onRemovePendingFile={removePendingFile}
          onSubmit={appendNote}
          onToggleTimestamp={() => {
            setComposerTimestampOpen((current) => {
              const next = !current;
              if (next && !draftTimestamp) {
                setDraftTimestamp(toDateTimeLocalValue(Date.now()));
              }
              return next;
            });
          }}
          copiedNoteId={copiedNoteId}
          navigationDisabled={savingNote}
        />
      ) : (
        <EmptyWorkspace
          state={placeholderState}
          onCreate={() => setDialog("create")}
        />
      )}
      {dialog === "create" && (
        <ProjectForm
          onCancel={() => setDialog(undefined)}
          onSubmit={createChat}
        />
      )}
    </div>
  );
}
