import {
  Fragment,
  useEffect,
  useId,
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
import {
  ACCENTS,
  CONFIGURABLE_LABELS,
  LABELS,
  PERMANENT_LABELS,
  type Accent,
  type ConfigurableLabel,
  type Label,
} from "../domain/validation.js";
import { apiClient, type ApiClient } from "./api.js";
import {
  applyTheme,
  persistTheme,
  readStoredTheme,
  THEMES,
  type Theme,
} from "./theme.js";

const ACCENT_NAMES: Record<Accent, string> = {
  coral: "Coral",
  amber: "Amber",
  moss: "Moss",
  ocean: "Ocean",
  iris: "Iris",
  slate: "Slate",
};

const LABEL_NAMES: Record<Label, string> = {
  pin: "Pin",
  attention: "Attention",
  todo: "Todo",
  decision: "Decision",
  "open-question": "Open question",
  risk: "Risk",
  milestone: "Milestone",
};

const LABEL_MARKS: Partial<Record<Label, string>> = {
  attention: "🔴",
  risk: "⚠️",
  milestone: "🎖️",
};

const FILTER_LABEL_NAMES: Record<Label, string> = {
  ...LABEL_NAMES,
  attention: "Alert",
  "open-question": "Question",
};

const ICON_ONLY_MESSAGE_LABELS = new Set<Label>(["pin", "attention"]);

type HistoryFilter = "all" | "attachments" | Label;

interface WorkspaceServerState {
  chats: Chat[];
  active?: ChatDetail;
}

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

function chatFromDetail(detail: ChatDetail): Chat {
  return {
    id: detail.id,
    title: detail.title,
    accent: detail.accent,
    enabledLabels: detail.enabledLabels,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

function commitProjectUpdate(
  state: WorkspaceServerState,
  projectId: string,
  updateSummary: (chat: Chat) => Chat,
  updateActive: (active: ChatDetail) => ChatDetail,
): WorkspaceServerState {
  const active =
    state.active?.id === projectId ? updateActive(state.active) : state.active;
  return {
    active,
    chats: sortChats(
      state.chats.map((chat) =>
        chat.id !== projectId
          ? chat
          : active?.id === projectId
            ? chatFromDetail(active)
            : updateSummary(chat),
      ),
    ),
  };
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

function hasAttachments(note: Note): boolean {
  return (note.attachments?.length ?? 0) > 0;
}

function resizeComposerTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "0px";
  const scrollHeight = textarea.scrollHeight;
  textarea.style.height = `${Math.max(48, Math.min(scrollHeight, 144))}px`;
  textarea.style.overflowY = scrollHeight > 144 ? "auto" : "hidden";
}

function formatFileSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAttachmentModified(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatAttachmentModifiedCompact(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
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

const MAX_TIMELINE_TIMEOUT_MS = 2_147_483_647;

function useTimelineNow(notes: Note[]): number {
  const [renderedAt, setRenderedAt] = useState(() => Date.now());
  const timelineKey = notes
    .map((note) => `${note.id}:${note.createdAt}`)
    .join("\u0000");
  const previousTimelineKey = useRef(timelineKey);
  const now = renderedAt;
  const nextFutureTimestamp = notes.find(
    (note) => note.createdAt > now,
  )?.createdAt;

  useEffect(() => {
    if (nextFutureTimestamp === undefined) return;
    const delay = Math.min(
      Math.max(0, nextFutureTimestamp - Date.now()) + 1,
      MAX_TIMELINE_TIMEOUT_MS,
    );
    const timeout = window.setTimeout(() => {
      setRenderedAt(Math.max(Date.now(), nextFutureTimestamp));
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [nextFutureTimestamp, renderedAt]);

  useLayoutEffect(() => {
    if (previousTimelineKey.current === timelineKey) return;
    previousTimelineKey.current = timelineKey;
    // Synchronize the external wall clock before paint when the visible timeline changes.
    setRenderedAt(Date.now());
  }, [timelineKey]);

  return now;
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
  onSubmit: (input: {
    title: string;
    accent: Accent;
    enabledLabels: ConfigurableLabel[];
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(chat.title);
  const [accent, setAccent] = useState<Accent>(chat.accent);
  const [enabledLabels, setEnabledLabels] = useState<ConfigurableLabel[]>(
    chat.enabledLabels ?? ["todo", "milestone"],
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSubmit({ title, accent, enabledLabels });
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
          <fieldset className="project-label-fieldset">
            <legend>Project labels</legend>
            <p className="field-help">
              Choose which labels are useful in this project. Existing message
              labels stay in place if you turn one off.
            </p>
            <div className="project-label-options">
              {CONFIGURABLE_LABELS.map((label) => (
                <label className="project-label-option" key={label}>
                  <input
                    type="checkbox"
                    checked={enabledLabels.includes(label)}
                    onChange={(event) =>
                      setEnabledLabels((current) =>
                        event.target.checked
                          ? CONFIGURABLE_LABELS.filter(
                              (candidate) =>
                                current.includes(candidate) ||
                                candidate === label,
                            )
                          : current.filter((candidate) => candidate !== label),
                      )
                    }
                  />
                  <span>{LABEL_NAMES[label]}</span>
                  <LabelGlyph label={label} />
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
          <p className="brand-mark">On Track</p>
          <p className="brand-subtitle">Private project threads</p>
        </div>
        <button
          className="new-project-button"
          type="button"
          onClick={onCreate}
          disabled={navigationDisabled}
          aria-label="New project"
        >
          <PlusIcon />
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
              <ChevronRightIcon />
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

type SettingsSection = "appearance" | "backups";

function SettingsRail({
  activeSection,
  onBack,
  onSelect,
}: {
  activeSection: SettingsSection;
  onBack: () => void;
  onSelect: (section: SettingsSection) => void;
}) {
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
          className={`settings-section-item ${
            activeSection === "appearance"
              ? "settings-section-item--active"
              : ""
          }`}
          type="button"
          aria-current={activeSection === "appearance" ? "page" : undefined}
          onClick={() => onSelect("appearance")}
        >
          <span className="settings-section-icon" aria-hidden="true">
            <AppearanceIcon />
          </span>
          <span>
            <strong>Appearance</strong>
            <small>Theme and contrast</small>
          </span>
        </button>
        <button
          className={`settings-section-item ${
            activeSection === "backups" ? "settings-section-item--active" : ""
          }`}
          type="button"
          aria-current={activeSection === "backups" ? "page" : undefined}
          onClick={() => onSelect("backups")}
        >
          <span className="settings-section-icon" aria-hidden="true">
            <DatabaseIcon />
          </span>
          <span>
            <strong>Backups</strong>
            <small>Export and restore</small>
          </span>
        </button>
      </nav>
    </aside>
  );
}

const THEME_NAMES: Record<Theme, string> = {
  light: "Light",
  neutral: "Neutral",
  dark: "Dark",
};

const THEME_DESCRIPTIONS: Record<Theme, string> = {
  light: "Clear daylight",
  neutral: "Soft graphite",
  dark: "Low-light focus",
};

function AppearanceSettingsWorkspace({
  theme,
  onThemeChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  return (
    <main className="workspace settings-workspace appearance-workspace">
      <header className="settings-workspace-header">
        <p className="eyebrow">Personalization</p>
        <h1>Appearance</h1>
      </header>
      <section
        className="settings-panel appearance-panel"
        aria-labelledby="theme-choice"
      >
        <div className="settings-panel-copy">
          <h2 id="theme-choice">Choose a theme</h2>
          <p>
            Pick the lighting that makes project notes easiest to read. Layout
            and project color identity stay the same.
          </p>
        </div>
        <fieldset className="theme-fieldset">
          <legend>Theme</legend>
          <div className="theme-options">
            {THEMES.map((value) => {
              const selected = theme === value;
              return (
                <label
                  className="theme-option"
                  data-preview-theme={value}
                  key={value}
                >
                  <input
                    type="radio"
                    name="appearance-theme"
                    value={value}
                    checked={selected}
                    onChange={() => onThemeChange(value)}
                  />
                  <span
                    className="theme-preview"
                    data-testid="theme-preview"
                    aria-hidden="true"
                  >
                    <span className="theme-preview-rail">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="theme-preview-workspace">
                      <i className="theme-preview-header" />
                      <span className="theme-preview-history">
                        <i />
                        <i />
                      </span>
                      <i className="theme-preview-composer" />
                    </span>
                  </span>
                  <span className="theme-option-copy">
                    <strong>{THEME_NAMES[value]}</strong>
                    <small>
                      {selected ? "Selected" : THEME_DESCRIPTIONS[value]}
                    </small>
                  </span>
                  <span className="theme-option-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </section>
    </main>
  );
}

function BackupSettingsWorkspace({
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
      setStatus("Backup export is ready.");
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
        "Restoring this backup will replace all current local projects and attached files. It does not merge data.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await onImport(file);
      setStatus("Backup restored.");
    } catch (caught) {
      setError(errorMessage(caught, "The database could not be imported."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace settings-workspace">
      <header className="settings-workspace-header">
        <p className="eyebrow">Backups</p>
        <h1>Backup settings</h1>
      </header>
      <section className="settings-panel" aria-labelledby="database-transfer">
        <div className="settings-panel-copy">
          <h2 id="database-transfer">Export and restore</h2>
          <p>
            Export one versioned On Track backup containing projects, messages,
            and attached files. Backups are plaintext and readable. Restoring
            replaces current local data; it does not merge histories.
          </p>
        </div>
        <div className="settings-control-group">
          <div className="settings-control-row">
            <div>
              <strong>Export backup</strong>
              <small>
                Create one restorable copy of current local data and files.
              </small>
            </div>
            <button
              className="button button-primary"
              type="button"
              onClick={handleExport}
              disabled={busy}
            >
              Export backup
            </button>
          </div>
          <div className="settings-control-row settings-control-row--stacked">
            <label className="field-label" htmlFor="database-import">
              Choose On Track backup
            </label>
            <input
              id="database-import"
              className="file-input"
              type="file"
              accept=".on-track-backup,application/vnd.on-track.backup+sqlite"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
            <button
              className="button button-primary"
              type="button"
              onClick={handleImport}
              disabled={busy || !file}
            >
              Restore backup
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

function AppearanceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="m4.22 4.22 1.42 1.42" />
      <path d="m18.36 18.36 1.42 1.42" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="m4.22 19.78 1.42-1.42" />
      <path d="m18.36 5.64 1.42-1.42" />
      <circle cx="12" cy="12" r="4" />
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m4 12 16-8-5 16-3-6Z" />
      <path d="m12 14 3-3" />
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

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 6h12" />
      <path d="M8 12h12" />
      <path d="M8 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m14 4 6 6-3 1-4 4 1 4-1 1-9-9 1-1 4 1 4-4Z" />
      <path d="m9 15-5 5" />
    </svg>
  );
}

function TodoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="m7.5 12 3 3 6-7" />
    </svg>
  );
}

function DecisionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 3v18" />
      <path d="M6 7h8l3-3" />
      <path d="M6 15h8l3 3" />
      <path d="m15 4 2-2 2 2" />
      <path d="m15 18 2 2 2-2" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.7 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.2.9-1.2 1.7" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function LabelGlyph({ label }: { label: Label }) {
  const mark = LABEL_MARKS[label];
  if (mark) {
    return (
      <span className="label-glyph label-glyph--emoji" aria-hidden="true">
        {mark}
      </span>
    );
  }

  const icon =
    label === "pin" ? (
      <PinIcon />
    ) : label === "todo" ? (
      <TodoIcon />
    ) : label === "decision" ? (
      <DecisionIcon />
    ) : (
      <QuestionIcon />
    );

  return (
    <span className="label-glyph label-glyph--svg" aria-hidden="true">
      {icon}
    </span>
  );
}

function LabelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 13 13 20 4 11V4h7Z" />
      <circle cx="8.5" cy="8.5" r="1.25" />
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

function OpenFileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 4h6v6" />
      <path d="m20 4-9 9" />
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
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

function MessageLabels({ labels }: { labels: Label[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="message-labels" aria-label="Message labels" role="list">
      {LABELS.filter((label) => labels.includes(label)).map((label) => {
        const iconOnly = ICON_ONLY_MESSAGE_LABELS.has(label);
        return (
          <span
            className={`message-label ${iconOnly ? "message-label--icon-only" : ""}`}
            data-label={label}
            aria-label={iconOnly ? LABEL_NAMES[label] : undefined}
            title={iconOnly ? LABEL_NAMES[label] : undefined}
            role="listitem"
            key={label}
          >
            <LabelGlyph label={label} />
            {!iconOnly && (
              <span className="message-label-name">{LABEL_NAMES[label]}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function MessageLabelPicker({
  note,
  enabledLabels,
  onToggle,
}: {
  note: Note;
  enabledLabels: ConfigurableLabel[];
  onToggle: (note: Note, label: Label, applied: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busyLabel, setBusyLabel] = useState<Label>();
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const appliedLabels = note.labels ?? [];
  const permanent = new Set<Label>(PERMANENT_LABELS);
  const availableLabels = LABELS.filter(
    (label) =>
      permanent.has(label) ||
      enabledLabels.includes(label as ConfigurableLabel) ||
      appliedLabels.includes(label),
  );

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);

  async function changeLabel(label: Label, applied: boolean) {
    setBusyLabel(label);
    setError("");
    try {
      await onToggle(note, label, applied);
    } catch (caught) {
      setError(errorMessage(caught, "The label could not be changed."));
    } finally {
      setBusyLabel(undefined);
    }
  }

  return (
    <div
      className={`message-label-picker ${open ? "message-label-picker--open" : ""}`}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="message-action"
        aria-label="Change labels"
        title="Change labels"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          setOpen((current) => !current);
          setError("");
        }}
      >
        <LabelIcon />
      </button>
      {open && (
        <div className="message-label-popover" id={popoverId}>
          <fieldset>
            <legend>Message labels</legend>
            {availableLabels.map((label) => {
              const applied = appliedLabels.includes(label);
              const inactive =
                !permanent.has(label) &&
                !enabledLabels.includes(label as ConfigurableLabel);
              return (
                <label
                  className={`message-label-choice ${inactive ? "message-label-choice--inactive" : ""}`}
                  key={label}
                >
                  <input
                    type="checkbox"
                    checked={applied}
                    disabled={busyLabel !== undefined || (inactive && !applied)}
                    onChange={(event) =>
                      void changeLabel(label, event.target.checked)
                    }
                  />
                  <span>
                    <LabelGlyph label={label} />
                    {LABEL_NAMES[label]}
                    {inactive ? " (inactive)" : ""}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {error && (
            <p className="message-label-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
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
  onAction,
}: {
  note: Note;
  onAction: (
    note: Note,
    attachmentId: string,
    action: "open" | "reveal",
  ) => Promise<void>;
}) {
  const [busyAction, setBusyAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  if (!note.attachments?.length) return null;

  async function runAction(attachmentId: string, action: "open" | "reveal") {
    const key = `${attachmentId}:${action}`;
    if (busyAction) return;
    setBusyAction(key);
    setActionError(undefined);
    try {
      await onAction(note, attachmentId, action);
    } catch (caught) {
      setActionError(
        errorMessage(caught, "The file action could not be completed."),
      );
    } finally {
      setBusyAction(undefined);
    }
  }

  return (
    <div className="attachment-list" aria-label="Message attachments">
      {note.attachments.map((attachment) => {
        const status = attachment.status ?? "available";
        const openCapability =
          attachment.actions?.open ??
          (status === "available" ? "available" : "unavailable");
        const revealCapability =
          attachment.actions?.reveal ??
          (status === "available" ? "available" : "unavailable");
        const reasonId = `attachment-${attachment.id}-status`;
        const reason =
          openCapability === "blocked"
            ? "Opening is blocked for this file type."
            : openCapability === "unsupported"
              ? "Native file actions are not supported on this system."
              : status !== "available"
                ? `File is ${status}.`
                : undefined;
        const openBusy = busyAction === `${attachment.id}:open`;
        const revealBusy = busyAction === `${attachment.id}:reveal`;
        const modifiedAt = attachment.modifiedAt ?? attachment.createdAt;
        return (
          <div className="attachment-card" key={attachment.id}>
            <span className="attachment-type" aria-hidden="true">
              {fileTypeLabel(attachment.filename, attachment.mediaType)}
            </span>
            <span className="attachment-copy">
              <strong>{attachment.filename}</strong>
              <small
                id={reasonId}
                className={reason ? "attachment-status--warning" : undefined}
                title={
                  reason
                    ? undefined
                    : `Modified ${formatAttachmentModified(modifiedAt)}`
                }
              >
                {reason ? (
                  <>
                    <span aria-hidden="true">⚠ </span>
                    {reason}
                  </>
                ) : (
                  `${formatFileSize(attachment.byteSize)} · ${formatAttachmentModifiedCompact(modifiedAt)}`
                )}
              </small>
            </span>
            <span className="attachment-actions">
              <button
                type="button"
                className="button button-primary attachment-action"
                aria-label={`Open ${attachment.filename}`}
                aria-busy={openBusy}
                title="Open"
                aria-describedby={reason ? reasonId : undefined}
                disabled={openCapability !== "available" || Boolean(busyAction)}
                onClick={() => void runAction(attachment.id, "open")}
              >
                {openBusy ? (
                  <span
                    className="attachment-action-progress"
                    aria-hidden="true"
                  >
                    …
                  </span>
                ) : (
                  <OpenFileIcon />
                )}
              </button>
              <button
                type="button"
                className="button button-quiet attachment-action"
                aria-label={`Show ${attachment.filename} in Folder`}
                aria-busy={revealBusy}
                title="Show in Folder"
                disabled={
                  revealCapability !== "available" || Boolean(busyAction)
                }
                onClick={() => void runAction(attachment.id, "reveal")}
              >
                {revealBusy ? (
                  <span
                    className="attachment-action-progress"
                    aria-hidden="true"
                  >
                    …
                  </span>
                ) : (
                  <FolderIcon />
                )}
              </button>
            </span>
          </div>
        );
      })}
      {actionError && (
        <p className="attachment-action-error" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}

function MessageGroups({
  notes,
  futureStartId,
  enabledLabels,
  copiedNoteId,
  onAttachmentAction,
  onCopyNote,
  onDeleteNote,
  onEditNote,
  onSetNoteLabel,
}: {
  notes: Note[];
  futureStartId?: string;
  enabledLabels: ConfigurableLabel[];
  copiedNoteId?: string;
  onAttachmentAction: (
    note: Note,
    attachmentId: string,
    action: "open" | "reveal",
  ) => Promise<void>;
  onCopyNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
  onEditNote: (note: Note) => void;
  onSetNoteLabel: (note: Note, label: Label, applied: boolean) => Promise<void>;
}) {
  return (
    <div className="message-groups">
      {groupNotesByDay(notes).map((group) => {
        const futureStartIndex = group.notes.findIndex(
          (note) => note.id === futureStartId,
        );
        const futureStartsGroup = futureStartIndex === 0;
        return (
          <section className="message-day" key={group.key}>
            {futureStartsGroup && (
              <div
                className="future-message-boundary future-message-boundary--day"
                role="separator"
                aria-label="Future messages"
              >
                <span
                  className="future-message-boundary-surface"
                  aria-hidden="true"
                />
              </div>
            )}
            <div className="message-date-separator">{group.label}</div>
            <ol
              className="message-list"
              style={{
                gridTemplateRows: `repeat(${group.notes.length}, auto)`,
              }}
            >
              {group.notes.map((note, noteIndex) => {
                const copied = copiedNoteId === note.id;
                return (
                  <Fragment key={note.id}>
                    {!futureStartsGroup && note.id === futureStartId && (
                      <li
                        key="future-boundary"
                        className="future-message-boundary"
                        role="separator"
                        aria-label="Future messages"
                        style={{
                          gridRow: `${noteIndex + 1} / ${group.notes.length + 1}`,
                        }}
                      >
                        <span
                          className="future-message-boundary-surface"
                          aria-hidden="true"
                        />
                      </li>
                    )}
                    <li
                      key="message"
                      className="message-row message-row--own"
                      style={{ gridRow: noteIndex + 1 }}
                    >
                      <div className="message-stack">
                        <article className="message-bubble">
                          <AttachmentList
                            note={note}
                            onAction={onAttachmentAction}
                          />
                          <div className="message-body note-body">
                            <MarkdownMessage body={note.body} />
                          </div>
                          <footer className="message-footer">
                            <MessageLabels labels={note.labels ?? []} />
                            <time
                              className="message-time"
                              dateTime={new Date(note.createdAt).toISOString()}
                            >
                              {formatMessageTime(note.createdAt)}
                            </time>
                          </footer>
                        </article>
                        <div
                          className="message-actions"
                          aria-label="Message actions"
                        >
                          <MessageLabelPicker
                            note={note}
                            enabledLabels={enabledLabels}
                            onToggle={onSetNoteLabel}
                          />
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
                  </Fragment>
                );
              })}
            </ol>
          </section>
        );
      })}
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
  onAttachmentAction,
  onEditNote,
  onDeleteNote,
  onDraftChange,
  onDraftTimestampChange,
  onFilesSelected,
  onHistoryFilterChange,
  onRemoveEditingAttachment,
  onRemovePendingFile,
  onSetNoteLabel,
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
  historyFilter: HistoryFilter;
  saving: boolean;
  timestampOpen: boolean;
  onBack: () => void;
  onCancelEditNote: () => void;
  onCustomize: () => void;
  onCopyNote: (note: Note) => void;
  onAttachmentAction: (
    note: Note,
    attachmentId: string,
    action: "open" | "reveal",
  ) => Promise<void>;
  onEditNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
  onDraftChange: (value: string) => void;
  onDraftTimestampChange: (value: string) => void;
  onFilesSelected: (files: File[]) => void;
  onHistoryFilterChange: (filter: HistoryFilter) => void;
  onRemoveEditingAttachment: (attachmentId: string) => void;
  onRemovePendingFile: (index: number) => void;
  onSetNoteLabel: (note: Note, label: Label, applied: boolean) => Promise<void>;
  onSubmit: () => void;
  onToggleTimestamp: () => void;
  copiedNoteId?: string;
  navigationDisabled: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentCount = detail.notes.filter(hasAttachments).length;
  const enabledLabels = detail.enabledLabels ?? ["todo", "milestone"];
  const filterLabels = [...PERMANENT_LABELS, ...enabledLabels];
  const visibleNotes = detail.notes.filter((note) => {
    if (historyFilter === "all") return true;
    if (historyFilter === "attachments") return hasAttachments(note);
    return (note.labels ?? []).includes(historyFilter);
  });
  const timelineNow = useTimelineNow(visibleNotes);
  const futureStartId = visibleNotes.find(
    (note) => note.createdAt > timelineNow,
  )?.id;
  const showingEmptyFilter =
    historyFilter !== "all" && visibleNotes.length === 0;
  const editingAttachments =
    editingNote?.attachments?.filter((attachment) =>
      editingAttachmentIds.includes(attachment.id),
    ) ?? [];

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    resizeComposerTextarea(textarea);
  }, [draft]);

  useEffect(() => {
    const resize = () => {
      const textarea = textareaRef.current;
      if (textarea) resizeComposerTextarea(textarea);
    };
    const textarea = textareaRef.current;
    let observedWidth = textarea?.clientWidth ?? 0;
    const observer =
      textarea && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const nextWidth = entries[0]?.contentRect.width ?? 0;
            if (nextWidth === observedWidth) return;
            observedWidth = nextWidth;
            resizeComposerTextarea(textarea);
          })
        : undefined;
    if (textarea) observer?.observe(textarea);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, []);

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
            <ArrowLeftIcon />
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
            <EditIcon />
            <span>Edit</span>
          </button>
        </div>
      </header>

      <nav className="history-filter" aria-label="History filters">
        <div className="history-filter-inner">
          <button
            type="button"
            className={`history-filter-button ${historyFilter === "all" ? "history-filter-button--active" : ""}`}
            aria-label={`All ${detail.notes.length}`}
            aria-pressed={historyFilter === "all"}
            onClick={() => onHistoryFilterChange("all")}
          >
            <span className="history-filter-icon" aria-hidden="true">
              <ListIcon />
            </span>
            <span className="history-filter-label">All</span>
            <span className="history-filter-count">{detail.notes.length}</span>
          </button>
          <button
            type="button"
            className={`history-filter-button ${historyFilter === "attachments" ? "history-filter-button--active" : ""}`}
            aria-label={`Files ${attachmentCount}`}
            aria-pressed={historyFilter === "attachments"}
            onClick={() => onHistoryFilterChange("attachments")}
          >
            <span className="history-filter-icon" aria-hidden="true">
              <PaperclipIcon />
            </span>
            <span className="history-filter-label">Files</span>
            <span className="history-filter-count">{attachmentCount}</span>
          </button>
          {filterLabels.map((label) => {
            const count = detail.notes.filter((note) =>
              (note.labels ?? []).includes(label),
            ).length;
            return (
              <button
                type="button"
                className={`history-filter-button ${historyFilter === label ? "history-filter-button--active" : ""}`}
                aria-label={`${LABEL_NAMES[label]} ${count}`}
                title={LABEL_NAMES[label]}
                aria-pressed={historyFilter === label}
                onClick={() => onHistoryFilterChange(label)}
                key={label}
              >
                <span className="history-filter-icon">
                  <LabelGlyph label={label} />
                </span>
                <span className="history-filter-label">
                  {FILTER_LABEL_NAMES[label]}
                </span>
                <span className="history-filter-count">{count}</span>
              </button>
            );
          })}
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
              <p className="eyebrow">
                {historyFilter === "attachments"
                  ? "Files"
                  : LABEL_NAMES[historyFilter]}
              </p>
              <h2>
                No{" "}
                {historyFilter === "attachments"
                  ? "attached files"
                  : "matching messages"}{" "}
                yet.
              </h2>
              <p>
                This project slice will update when a matching message appears.
              </p>
            </div>
          </div>
        ) : (
          <MessageGroups
            notes={visibleNotes}
            futureStartId={futureStartId}
            enabledLabels={enabledLabels}
            copiedNoteId={copiedNoteId}
            onAttachmentAction={onAttachmentAction}
            onCopyNote={onCopyNote}
            onDeleteNote={onDeleteNote}
            onEditNote={onEditNote}
            onSetNoteLabel={onSetNoteLabel}
          />
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
          <div className="composer-input-row">
            <textarea
              ref={textareaRef}
              data-composer-textarea
              aria-label={editingNote ? "Edit message" : "Add a note"}
              placeholder={
                editingNote
                  ? "Edit this message…"
                  : "Add a note to this project…"
              }
              value={draft}
              maxLength={10_000}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="composer-bar">
              <span>
                <kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd>
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
                aria-label={
                  saving
                    ? editingNote
                      ? "Saving message"
                      : "Adding note"
                    : editingNote
                      ? "Save"
                      : "Add note"
                }
                disabled={
                  saving ||
                  (!draft.trim() &&
                    pendingFiles.length === 0 &&
                    editingAttachments.length === 0)
                }
              >
                <span>
                  {saving
                    ? editingNote
                      ? "Saving…"
                      : "Adding…"
                    : editingNote
                      ? "Save"
                      : "Add"}
                </span>
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

export function App({ api = apiClient }: { api?: ApiClient }) {
  const [workspace, setWorkspace] = useState<WorkspaceServerState>({
    chats: [],
  });
  const { chats, active } = workspace;
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [dialog, setDialog] = useState<"create" | "edit">();
  const [mode, setMode] = useState<"projects" | "settings" | "projectEdit">(
    "projects",
  );
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("backups");
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [editingNote, setEditingNote] = useState<Note>();
  const [editingAttachmentIds, setEditingAttachmentIds] = useState<string[]>(
    [],
  );
  const [copiedNoteId, setCopiedNoteId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [draftTimestamp, setDraftTimestamp] = useState("");
  const [composerTimestampOpen, setComposerTimestampOpen] = useState(false);
  const [error, setError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const selectionRequest = useRef(0);
  const activeMutationGeneration = useRef(0);
  const activeId = useRef<string | undefined>(undefined);
  const copyResetTimer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    activeId.current = active?.id;
  }, [active?.id]);

  useEffect(() => {
    let focusRequest = 0;
    const refreshActiveProject = () => {
      const projectId = activeId.current;
      if (!projectId) return;
      const request = ++focusRequest;
      const selection = selectionRequest.current;
      const mutation = activeMutationGeneration.current;
      void api
        .getChat(projectId)
        .then((detail) => {
          if (
            request !== focusRequest ||
            selection !== selectionRequest.current ||
            mutation !== activeMutationGeneration.current ||
            activeId.current !== projectId
          ) {
            return;
          }
          setWorkspace((current) =>
            commitProjectUpdate(
              current,
              projectId,
              () => chatFromDetail(detail),
              () => detail,
            ),
          );
        })
        .catch(() => {
          // Focus refresh is best effort; explicit actions surface their errors.
        });
    };
    window.addEventListener("focus", refreshActiveProject);
    return () => window.removeEventListener("focus", refreshActiveProject);
  }, [api]);

  useEffect(() => {
    let current = true;
    api
      .listChats()
      .then((result) => {
        if (!current) return;
        setWorkspace((current) => ({ ...current, chats: result }));
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
      setWorkspace((current) => ({ ...current, active: detail }));
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
    setWorkspace((current) => ({
      chats: [chat, ...current.chats],
      active: { ...chat, notes: [] },
    }));
    setDialog(undefined);
    setPendingFiles([]);
    setHistoryFilter("all");
    setDraftTimestamp("");
    setComposerTimestampOpen(false);
    setEditingNote(undefined);
    setEditingAttachmentIds([]);
    focusMobileBackButton();
  }

  async function updateChat(input: {
    title: string;
    accent: Accent;
    enabledLabels: ConfigurableLabel[];
  }) {
    if (!active) return;
    const projectId = active.id;
    const chat = await api.updateChat(active.id, input);
    activeMutationGeneration.current += 1;
    setWorkspace((current) =>
      commitProjectUpdate(
        current,
        chat.id,
        () => chat,
        (detail) => ({
          ...detail,
          ...chat,
        }),
      ),
    );
    if (
      historyFilter !== "all" &&
      historyFilter !== "attachments" &&
      !PERMANENT_LABELS.includes(historyFilter as never) &&
      !chat.enabledLabels.includes(historyFilter as ConfigurableLabel)
    ) {
      setHistoryFilter("all");
    }
    setDialog(undefined);
    setMode("projects");
    if (activeId.current === projectId) focusMobileBackButton();
  }

  async function deleteChat() {
    if (!active) return;
    const projectId = active.id;
    const selectionAtStart = selectionRequest.current;
    await api.deleteChat(projectId);
    const navigationUnchanged = selectionRequest.current === selectionAtStart;
    if (navigationUnchanged) selectionRequest.current += 1;
    activeMutationGeneration.current += 1;
    setWorkspace((current) => ({
      chats: current.chats.filter((chat) => chat.id !== projectId),
      active: current.active?.id === projectId ? undefined : current.active,
    }));
    if (navigationUnchanged) {
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
        activeMutationGeneration.current += 1;
        const submittedNotes = sortNotes([...active.notes, note]);
        const submittedUpdatedAt = chatActivityFromNotes(
          active,
          submittedNotes,
        );
        setWorkspace((current) =>
          commitProjectUpdate(
            current,
            projectId,
            (chat) => ({ ...chat, updatedAt: submittedUpdatedAt }),
            (detail) => {
              const notes = sortNotes([...detail.notes, note]);
              return {
                ...detail,
                notes,
                updatedAt: chatActivityFromNotes(detail, notes),
              };
            },
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

  async function attachmentAction(
    note: Note,
    attachmentId: string,
    action: "open" | "reveal",
  ) {
    if (!active) return;
    const attachment = note.attachments?.find(
      (item) => item.id === attachmentId,
    );
    if (!attachment) return;
    if (action === "open") {
      await api.openAttachment(active.id, note.id, attachmentId);
    } else {
      await api.revealAttachment(active.id, note.id, attachmentId);
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
    activeMutationGeneration.current += 1;
    const submittedNotes = sortNotes(
      active.notes.map((note) => (note.id === updated.id ? updated : note)),
    );
    const submittedUpdatedAt = chatActivityFromNotes(active, submittedNotes);
    setWorkspace((current) =>
      commitProjectUpdate(
        current,
        projectId,
        (chat) => ({ ...chat, updatedAt: submittedUpdatedAt }),
        (detail) => {
          const notes = sortNotes(
            detail.notes.map((note) =>
              note.id === updated.id ? updated : note,
            ),
          );
          return {
            ...detail,
            notes,
            updatedAt: chatActivityFromNotes(detail, notes),
          };
        },
      ),
    );
    setEditingNote(undefined);
    setEditingAttachmentIds([]);
  }

  async function deleteNote(note: Note) {
    if (!active) return;
    if (!window.confirm("Delete this message?")) return;
    const projectId = active.id;
    await api.deleteNote(projectId, note.id);
    activeMutationGeneration.current += 1;
    const submittedNotes = active.notes.filter((item) => item.id !== note.id);
    const submittedUpdatedAt = chatActivityFromNotes(active, submittedNotes);
    setWorkspace((current) =>
      commitProjectUpdate(
        current,
        projectId,
        (chat) => ({ ...chat, updatedAt: submittedUpdatedAt }),
        (detail) => {
          const notes = detail.notes.filter((item) => item.id !== note.id);
          return {
            ...detail,
            notes,
            updatedAt: chatActivityFromNotes(detail, notes),
          };
        },
      ),
    );
  }

  async function setNoteLabel(note: Note, label: Label, applied: boolean) {
    if (!active) return;
    const projectId = active.id;
    const labels = await api.setNoteLabel(projectId, note.id, label, applied);
    activeMutationGeneration.current += 1;
    setWorkspace((current) =>
      commitProjectUpdate(
        current,
        projectId,
        (chat) => chat,
        (detail) => ({
          ...detail,
          notes: detail.notes.map((item) =>
            item.id === note.id ? { ...item, labels } : item,
          ),
        }),
      ),
    );
  }

  async function exportDatabase() {
    const blob = await api.exportDatabase();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `on-track-${new Date().toISOString().slice(0, 10)}.on-track-backup`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importDatabase(file: File) {
    await api.importDatabase(file);
    const importedChats = await api.listChats();
    selectionRequest.current += 1;
    activeMutationGeneration.current += 1;
    setWorkspace({ chats: importedChats });
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
    setWorkspace((current) => ({ ...current, active: undefined }));
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
        <SettingsRail
          activeSection={settingsSection}
          onBack={() => setMode("projects")}
          onSelect={setSettingsSection}
        />
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
        settingsSection === "appearance" ? (
          <AppearanceSettingsWorkspace theme={theme} onThemeChange={setTheme} />
        ) : (
          <BackupSettingsWorkspace
            onExport={exportDatabase}
            onImport={importDatabase}
          />
        )
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
          onAttachmentAction={attachmentAction}
          onEditNote={startEditingNote}
          onCancelEditNote={cancelEditingNote}
          onDeleteNote={deleteNote}
          onDraftChange={setDraft}
          onDraftTimestampChange={setDraftTimestamp}
          onFilesSelected={addPendingFiles}
          onHistoryFilterChange={setHistoryFilter}
          onRemoveEditingAttachment={removeEditingAttachment}
          onRemovePendingFile={removePendingFile}
          onSetNoteLabel={setNoteLabel}
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
