import {
  HomeWorkspace,
  type WorkspacePlaceholderState,
} from "./HomeWorkspace.js";
import { HomeUtilities } from "./HomeUtilities.js";
import { useHomeUpdates } from "./useHomeUpdates.js";
import { ExampleReadOnlyContext, EXAMPLE_NOTICE } from "./example-read-only.js";
import type {
  ExampleDetail,
  ExampleSummary,
  TimelineContent,
} from "../domain/examples.js";
import { ExamplesSection, GeneralSettingsWorkspace } from "./Examples.js";
import {
  readShowExamples,
  persistShowExamples,
  SHOW_EXAMPLES_KEY,
} from "./preferences.js";
import {
  Fragment,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { BackupSettingsWorkspace } from "./BackupSettingsWorkspace.js";
import type {
  ImportOptions,
  ProjectSelection,
} from "../domain/database-transfer.js";
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
  applyMarkdownAction,
  MARKDOWN_TOOLS,
  markdownActionForShortcut,
  type MarkdownAction,
} from "./markdown-assistance.js";
import {
  applyTheme,
  persistTheme,
  readStoredTheme,
  THEMES,
  type Theme,
} from "./theme.js";
import {
  useHistoryPosition,
  type ReadingPosition,
} from "./history-position.js";
import { analyzeMarkdown } from "./markdown-analysis.js";
import { senderColor } from "./sender-color.js";
import { useComposerFileDrop } from "./composer-file-drop.js";

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
  risk: "⚠️",
  milestone: "🎖️",
};

const FILTER_LABEL_NAMES: Record<Label, string> = {
  ...LABEL_NAMES,
  attention: "Alert",
  "open-question": "Question",
};

const ICON_ONLY_MESSAGE_LABELS = new Set<Label>(["pin", "attention"]);
const MESSAGE_COLLAPSED_HEIGHT_PX = 192;

type HistoryFilter = "all" | "attachments" | "links" | Label;
type RailSection = "Pinned" | "Projects" | "Archive" | "Examples";

interface WorkspaceServerState {
  chats: Chat[];
  active?: ChatDetail;
}

function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    const aArchivedAt = a.archivedAt ?? null;
    const bArchivedAt = b.archivedAt ?? null;
    if (aArchivedAt !== null || bArchivedAt !== null) {
      if (aArchivedAt === null) return -1;
      if (bArchivedAt === null) return 1;
      return bArchivedAt - aArchivedAt || a.id.localeCompare(b.id);
    }
    const aPinnedAt = a.pinnedAt ?? null;
    const bPinnedAt = b.pinnedAt ?? null;
    if (aPinnedAt !== null || bPinnedAt !== null) {
      if (aPinnedAt === null) return 1;
      if (bPinnedAt === null) return -1;
      return bPinnedAt - aPinnedAt || a.id.localeCompare(b.id);
    }
    return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
  });
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

function chatFromDetail(detail: ChatDetail, now = Date.now()): Chat {
  const notes = sortNotes(detail.notes);
  const latest = notes.filter((note) => note.createdAt <= now).at(-1);
  const attentionTimestamps = notes
    .filter((note) => note.labels?.includes("attention"))
    .map((note) => note.createdAt);
  return {
    id: detail.id,
    title: detail.title,
    accent: detail.accent,
    enabledLabels: detail.enabledLabels,
    collapseLongMessages: detail.collapseLongMessages ?? true,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    archivedAt: detail.archivedAt ?? null,
    pinnedAt: detail.pinnedAt ?? null,
    latestMessagePreview: latest?.body.slice(0, 512) ?? null,
    nextMessageAt:
      notes.find((note) => note.createdAt > now)?.createdAt ?? null,
    latestAttentionAt:
      attentionTimestamps.filter((timestamp) => timestamp <= now).at(-1) ??
      null,
    nextAttentionAt:
      attentionTimestamps.find((timestamp) => timestamp > now) ?? null,
  };
}

function mergeMessageSummary(chat: Chat, detail: ChatDetail): Chat {
  const summary = chatFromDetail(detail);
  return {
    ...chat,
    updatedAt: summary.updatedAt,
    latestMessagePreview: summary.latestMessagePreview,
    nextMessageAt: summary.nextMessageAt,
    latestAttentionAt: summary.latestAttentionAt,
    nextAttentionAt: summary.nextAttentionAt,
  };
}

function projectPreview(chat: Chat): string {
  const preview =
    chat.latestMessagePreview == null
      ? ""
      : analyzeMarkdown(chat.latestMessagePreview).text;
  if (chat.latestMessagePreview == null) return "Ready for the first note";
  return preview || "Attachment message";
}

function projectAttentionState(
  chat: Chat,
  now: number,
): "today" | "earlier" | undefined {
  const reachedFuture =
    chat.nextAttentionAt !== null &&
    chat.nextAttentionAt !== undefined &&
    chat.nextAttentionAt <= now
      ? chat.nextAttentionAt
      : null;
  const latest = Math.max(
    chat.latestAttentionAt ?? Number.NEGATIVE_INFINITY,
    reachedFuture ?? Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(latest)) return undefined;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return latest >= startOfToday.getTime() ? "today" : "earlier";
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
  const style = getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight) || 24;
  const padding =
    (Number.parseFloat(style.paddingTop) || 0) +
    (Number.parseFloat(style.paddingBottom) || 0);
  const maxHeight = lineHeight * 8 + (padding || 24);
  textarea.style.maxHeight = `${maxHeight}px`;
  textarea.style.height = `${Math.max(48, Math.min(scrollHeight, maxHeight))}px`;
  textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
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
  onToggleArchived,
  mutationPending,
}: {
  chat: ChatDetail;
  onToggleArchived: () => Promise<void>;
  mutationPending: boolean;
  onBack: () => void;
  onSubmit: (input: {
    title: string;
    accent: Accent;
    enabledLabels: ConfigurableLabel[];
    collapseLongMessages: boolean;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(chat.title);
  const [accent, setAccent] = useState<Accent>(chat.accent);
  const [enabledLabels, setEnabledLabels] = useState<ConfigurableLabel[]>(
    chat.enabledLabels ?? ["todo", "milestone"],
  );
  const [collapseLongMessages, setCollapseLongMessages] = useState(
    chat.collapseLongMessages ?? true,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiveStatus, setArchiveStatus] = useState("");
  const archiveButton = useRef<HTMLButtonElement>(null);
  const pendingArchiveFocus = useRef(false);
  useLayoutEffect(() => {
    if (!mutationPending && pendingArchiveFocus.current) {
      pendingArchiveFocus.current = false;
      archiveButton.current?.focus();
    }
  }, [mutationPending]);

  async function handleArchive() {
    setError("");
    setArchiveStatus("");
    pendingArchiveFocus.current = true;
    try {
      await onToggleArchived();
      setArchiveStatus(
        chat.archivedAt == null
          ? "Project moved to Archive."
          : "Project restored to Projects.",
      );
    } catch (caught) {
      setError(
        errorMessage(caught, "The project archive state could not be saved."),
      );
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSubmit({
        title,
        accent,
        enabledLabels,
        collapseLongMessages,
      });
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
          <p>
            Change project settings, or archive it while keeping its messages
            and files.
          </p>
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
          <fieldset className="project-message-display-fieldset">
            <legend>Message display</legend>
            <p className="field-help">
              Choose how long messages first appear in this project. Every long
              message can still be expanded or collapsed individually.
            </p>
            <label className="project-message-display-option">
              <input
                type="checkbox"
                checked={collapseLongMessages}
                onChange={(event) =>
                  setCollapseLongMessages(event.target.checked)
                }
              />
              <span>Collapse long messages by default</span>
            </label>
          </fieldset>
          {error && (
            <p id="project-edit-error" role="alert" className="form-error">
              {error}
            </p>
          )}
          <p role="status" className="visually-hidden">
            {archiveStatus}
          </p>
          <div className="project-edit-actions">
            <div className="project-lifecycle-actions">
              <button
                className="button button-danger"
                type="button"
                onClick={handleDelete}
                disabled={saving || deleting || mutationPending}
              >
                {deleting ? "Deleting…" : "Delete project"}
              </button>
              <button
                ref={archiveButton}
                className="button button-quiet"
                type="button"
                onClick={handleArchive}
                disabled={saving || deleting || mutationPending}
                aria-busy={mutationPending || undefined}
                aria-describedby={error ? "project-edit-error" : undefined}
              >
                {chat.archivedAt == null
                  ? "Archive project"
                  : "Restore project"}
              </button>
            </div>
            <span />
            <button
              className="button button-quiet"
              type="button"
              onClick={onBack}
              disabled={saving || deleting || mutationPending}
            >
              Back to project
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={saving || deleting || mutationPending}
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
  homeUtilities,
  onHome,
  examplesSection,
  collapsedSections,
  onToggleSection,
  chats,
  activeId,
  onSelect,
  onTogglePinned,
  onRestore,
  onTemporalBoundary,
  onCreate,
  onSettings,
  navigationDisabled,
  pinErrors,
  projectMutationIds,
}: {
  homeUtilities?: ReactNode;
  onHome: () => void;
  examplesSection?: ReactNode;
  collapsedSections: Record<RailSection, boolean>;
  onToggleSection: (section: RailSection) => void;
  chats: Chat[];
  activeId?: string;
  onSelect: (id: string) => void;
  onTogglePinned: (chat: Chat) => void;
  onRestore: (chat: Chat) => void;
  onTemporalBoundary: () => void;
  onCreate: () => void;
  onSettings: () => void;
  navigationDisabled: boolean;
  pinErrors: Record<string, string>;
  projectMutationIds: ReadonlySet<string>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const boundaryCallback = useRef(onTemporalBoundary);
  const handledTemporalKey = useRef("");
  const previews = useMemo(
    () => new Map(chats.map((chat) => [chat.id, projectPreview(chat)])),
    [chats],
  );
  const pinned = chats.filter(
    (chat) => chat.archivedAt == null && chat.pinnedAt != null,
  );
  const projects = chats.filter(
    (chat) => chat.archivedAt == null && chat.pinnedAt == null,
  );
  const archived = chats.filter((chat) => chat.archivedAt != null);
  const temporalKey = chats
    .map(
      (chat) =>
        `${chat.id}:${chat.nextMessageAt ?? ""}:${chat.nextAttentionAt ?? ""}`,
    )
    .join("\u0000");
  const schedulingNow = now;
  const dueTemporalKey = chats.some((chat) =>
    [chat.nextMessageAt, chat.nextAttentionAt].some(
      (timestamp) => timestamp != null && timestamp <= schedulingNow,
    ),
  )
    ? temporalKey
    : "";
  const nextMidnight = new Date(schedulingNow);
  nextMidnight.setHours(24, 0, 0, 0);
  const temporalBoundary = Math.min(
    nextMidnight.getTime(),
    ...chats
      .flatMap((chat) => [chat.nextMessageAt, chat.nextAttentionAt])
      .filter(
        (timestamp): timestamp is number =>
          timestamp !== null &&
          timestamp !== undefined &&
          timestamp > schedulingNow,
      ),
  );

  useEffect(() => {
    boundaryCallback.current = onTemporalBoundary;
  }, [onTemporalBoundary]);

  useEffect(() => {
    if (!dueTemporalKey || handledTemporalKey.current === dueTemporalKey)
      return;
    handledTemporalKey.current = dueTemporalKey;
    boundaryCallback.current();
  }, [dueTemporalKey]);

  useEffect(() => {
    const current = Date.now();
    const delay = Math.min(
      Math.max(0, temporalBoundary - current) + 1,
      MAX_TIMELINE_TIMEOUT_MS,
    );
    const timeout = window.setTimeout(() => {
      handledTemporalKey.current = temporalKey;
      setNow(Date.now());
      boundaryCallback.current();
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [temporalBoundary, temporalKey]);

  useEffect(() => {
    const refresh = () => {
      handledTemporalKey.current = temporalKey;
      setNow(Date.now());
      boundaryCallback.current();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [temporalKey]);

  function renderSection(label: RailSection, items: Chat[]) {
    return (
      <section className="project-section" aria-labelledby={`rail-${label}`}>
        <button
          className="rail-section-label"
          type="button"
          aria-label={label}
          aria-expanded={!collapsedSections[label]}
          aria-controls={`rail-items-${label}`}
          onClick={() => onToggleSection(label)}
        >
          <span className="rail-section-title" id={`rail-${label}`}>
            {label}
            <ChevronDownIcon />
          </span>
          <span>{String(items.length).padStart(2, "0")}</span>
        </button>
        <ul
          className="project-items"
          id={`rail-items-${label}`}
          hidden={collapsedSections[label]}
        >
          {items.map((chat) => {
            const attention = projectAttentionState(chat, now);
            const error = pinErrors[chat.id];
            const isPinned = chat.pinnedAt != null;
            const isArchived = chat.archivedAt != null;
            const statusId = `project-status-${chat.id}`;
            const errorId = `project-pin-error-${chat.id}`;
            return (
              <li
                className={`project-row ${activeId === chat.id ? "project-row--active" : ""} ${error ? "project-row--error" : ""}`}
                data-accent={chat.accent}
                data-attention-state={attention}
                key={chat.id}
              >
                <button
                  className={`project-item ${activeId === chat.id ? "project-item--active" : ""}`}
                  data-chat-id={chat.id}
                  type="button"
                  aria-label={`Open ${chat.title}`}
                  aria-describedby={`${statusId}${error ? ` ${errorId}` : ""}`}
                  aria-current={activeId === chat.id ? "page" : undefined}
                  disabled={navigationDisabled}
                  onClick={() => onSelect(chat.id)}
                >
                  <span className="project-item-copy">
                    <strong>{chat.title}</strong>
                    <small>{error || previews.get(chat.id)}</small>
                  </span>
                </button>
                <button
                  className="project-pin-button"
                  data-project-pin-id={chat.id}
                  type="button"
                  aria-label={
                    isArchived
                      ? `Restore ${chat.title} from archive`
                      : `Pin ${chat.title}`
                  }
                  title={isArchived ? "Restore project" : undefined}
                  aria-pressed={isArchived ? undefined : isPinned}
                  aria-describedby={error ? errorId : undefined}
                  disabled={
                    navigationDisabled || projectMutationIds.has(chat.id)
                  }
                  onClick={() =>
                    isArchived ? onRestore(chat) : onTogglePinned(chat)
                  }
                >
                  {isArchived ? <ArchiveRestoreIcon /> : <PinIcon />}
                </button>
                {attention && (
                  <span
                    className={`attention-dot attention-dot--${attention} project-attention-dot project-attention-dot--${attention}`}
                    aria-hidden="true"
                  />
                )}
                <span className="visually-hidden" id={statusId}>
                  {isArchived
                    ? "Archived project. "
                    : isPinned
                      ? "Pinned project. "
                      : ""}
                  {attention === "today"
                    ? "Attention today."
                    : attention === "earlier"
                      ? "Earlier attention."
                      : "No attention."}
                </span>
                {error && (
                  <span className="visually-hidden" id={errorId} role="alert">
                    {error}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <aside
      className={`project-rail ${activeId ? "project-rail--detail-open" : ""}`}
    >
      <header className="rail-header">
        <div>
          <a
            className="brand-mark"
            href="/"
            aria-label="Home"
            aria-disabled={navigationDisabled || undefined}
            onClick={(event) => {
              if (navigationDisabled) {
                event.preventDefault();
                return;
              }
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              onHome();
            }}
          >
            <img
              className="brand-wordmark brand-wordmark--light"
              src="/branding/threadstr-wordmark-on-light.svg"
              alt=""
              width="192"
              height="43"
            />
            <img
              className="brand-wordmark brand-wordmark--dark"
              src="/branding/threadstr-wordmark-on-dark.svg"
              alt=""
              width="192"
              height="43"
            />
            <span className="brand-fallback">threadstr</span>
          </a>
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

      <nav aria-label="Projects" className="project-list">
        {renderSection("Pinned", pinned)}
        {renderSection("Projects", projects)}
        {renderSection("Archive", archived)}
        {examplesSection}
        {homeUtilities}
      </nav>

      <footer className="local-footnote">
        <span className="local-indicator" aria-hidden="true" />
        <span className="local-footnote-copy">
          <strong>Local only</strong>
        </span>
        <button
          className="settings-icon-button"
          type="button"
          onClick={onSettings}
          aria-label="Settings. Local only."
        >
          <SettingsIcon />
        </button>
      </footer>
    </aside>
  );
}

type SettingsSection = "general" | "appearance" | "backups";

function SettingsRail({
  activeSection,
  disabled,
  onBack,
  onSelect,
}: {
  activeSection: SettingsSection;
  disabled: boolean;
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
          disabled={disabled}
          onClick={onBack}
          aria-label="Back to projects"
        >
          <ArrowLeftIcon />
        </button>
      </header>
      <nav aria-label="Settings sections" className="settings-section-list">
        <button
          className={`settings-section-item ${activeSection === "general" ? "settings-section-item--active" : ""}`}
          type="button"
          disabled={disabled}
          aria-current={activeSection === "general" ? "page" : undefined}
          onClick={() => onSelect("general")}
        >
          <span className="settings-section-icon" aria-hidden="true">
            <SettingsIcon />
          </span>
          <span>
            <strong>General</strong>
            <small>Workspace preferences</small>
          </span>
        </button>
        <button
          className={`settings-section-item ${
            activeSection === "appearance"
              ? "settings-section-item--active"
              : ""
          }`}
          type="button"
          disabled={disabled}
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
          disabled={disabled}
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

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
        transform="translate(1 1)"
      />
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

function SenderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-3.3 2.4-5 5.5-5s4.9 1.7 5.5 5" />
      <path d="m15 13 5-5" />
      <path d="m17 7 2 2" />
    </svg>
  );
}

function MarkdownToolGlyph({ action }: { action: MarkdownAction }) {
  const labels: Record<MarkdownAction, string> = {
    bold: "B",
    italic: "I",
    link: "↗",
    quote: "❞",
    "bulleted-list": "•≡",
    "numbered-list": "1≡",
    checklist: "☐",
    code: "</>",
    table: "▦",
  };

  return (
    <span
      className={`markdown-tool-glyph markdown-tool-glyph--${action}`}
      aria-hidden="true"
    >
      {labels[action]}
    </span>
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

function ArchiveRestoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 10v11h16V10M3 6h18v4H3zM9 14h6" />
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
  if (label === "attention") {
    return (
      <span className="label-glyph" aria-hidden="true">
        <span className="attention-dot attention-dot--today" />
      </span>
    );
  }

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
  allowReadOnly = false,
  onClick,
}: {
  label: string;
  children: ReactNode;
  danger?: boolean;
  allowReadOnly?: boolean;
  onClick: () => void;
}) {
  const explainReadOnly = useContext(ExampleReadOnlyContext);
  const blocked = Boolean(explainReadOnly) && !allowReadOnly;
  return (
    <button
      type="button"
      aria-disabled={blocked || undefined}
      aria-describedby={blocked ? "example-notice" : undefined}
      className={`message-action ${danger ? "message-action--danger" : ""}`}
      aria-label={label}
      title={label}
      onClick={blocked ? explainReadOnly : onClick}
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
  const explainReadOnly = useContext(ExampleReadOnlyContext);
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
        aria-disabled={Boolean(explainReadOnly) || undefined}
        aria-describedby={explainReadOnly ? "example-notice" : undefined}
        title="Change labels"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          if (explainReadOnly) {
            explainReadOnly();
            return;
          }
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

function syncClippedMessageLinks(
  bodyElement: HTMLDivElement,
  collapsed: boolean,
) {
  const clipBottom =
    bodyElement.getBoundingClientRect().top + MESSAGE_COLLAPSED_HEIGHT_PX;
  for (const link of bodyElement.querySelectorAll<HTMLAnchorElement>("a")) {
    const clipped =
      collapsed && link.getBoundingClientRect().bottom > clipBottom;
    if (clipped) {
      link.dataset.messageClippedLink = "true";
      link.tabIndex = -1;
    } else if (link.dataset.messageClippedLink === "true") {
      delete link.dataset.messageClippedLink;
      link.removeAttribute("tabindex");
    }
  }
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CollapsibleMessageBody({
  body,
  collapseLongMessages,
}: {
  body: string;
  collapseLongMessages: boolean;
}) {
  const contentId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isLong, setIsLong] = useState(false);
  const [expanded, setExpanded] = useState(!collapseLongMessages);
  const collapsed = isLong && !expanded;

  useLayoutEffect(() => {
    const bodyElement = bodyRef.current;
    if (!bodyElement) return;
    const nextIsLong = bodyElement.scrollHeight > MESSAGE_COLLAPSED_HEIGHT_PX;
    setIsLong((current) => (current === nextIsLong ? current : nextIsLong));
    syncClippedMessageLinks(bodyElement, nextIsLong && !expanded);
    return () => syncClippedMessageLinks(bodyElement, false);
  }, [body, expanded]);

  useEffect(() => {
    const bodyElement = bodyRef.current;
    if (!bodyElement) return;
    const measure = () => {
      const nextIsLong = bodyElement.scrollHeight > MESSAGE_COLLAPSED_HEIGHT_PX;
      setIsLong((current) => (current === nextIsLong ? current : nextIsLong));
      syncClippedMessageLinks(bodyElement, nextIsLong && !expanded);
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(bodyElement);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [body, expanded]);

  return (
    <>
      <div
        className={`message-body-viewport ${collapsed ? "message-body-viewport--collapsed" : ""}`}
        style={
          {
            "--message-collapse-height": `${MESSAGE_COLLAPSED_HEIGHT_PX}px`,
          } as CSSProperties
        }
      >
        <div className="message-body note-body" id={contentId} ref={bodyRef}>
          <MarkdownMessage body={body} />
        </div>
      </div>
      {isLong && (
        <button
          className="message-collapse-toggle"
          type="button"
          aria-controls={contentId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span>{expanded ? "Show less" : "Show more"}</span>
          <ChevronDownIcon />
        </button>
      )}
    </>
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
  const explainReadOnly = useContext(ExampleReadOnlyContext);
  const [busyAction, setBusyAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  if (!note.attachments?.length) return null;

  async function runAction(attachmentId: string, action: "open" | "reveal") {
    if (explainReadOnly) {
      explainReadOnly();
      return;
    }
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
        const reason = explainReadOnly
          ? "Create a copy to open or modify this file."
          : openCapability === "blocked"
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
                className={
                  reason && !explainReadOnly
                    ? "attachment-status--warning"
                    : undefined
                }
                title={
                  reason
                    ? undefined
                    : `Modified ${formatAttachmentModified(modifiedAt)}`
                }
              >
                {reason ? (
                  <>
                    {!explainReadOnly && <span aria-hidden="true">⚠ </span>}
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
                aria-disabled={Boolean(explainReadOnly) || undefined}
                disabled={
                  !explainReadOnly &&
                  (openCapability !== "available" || Boolean(busyAction))
                }
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
                aria-disabled={Boolean(explainReadOnly) || undefined}
                aria-describedby={explainReadOnly ? reasonId : undefined}
                disabled={
                  !explainReadOnly &&
                  (revealCapability !== "available" || Boolean(busyAction))
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
  collapseLongMessages,
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
  collapseLongMessages: boolean;
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
                const participant = Boolean(note.sender);
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
                      data-note-id={note.id}
                      data-created-at={note.createdAt}
                      className={`message-row ${participant ? "message-row--participant" : "message-row--own"}`}
                      style={{ gridRow: noteIndex + 1 }}
                    >
                      <div className="message-stack">
                        <article className="message-bubble">
                          {note.sender && (
                            <p
                              className="message-sender"
                              data-sender-color={senderColor(note.sender)}
                            >
                              {note.sender}
                            </p>
                          )}
                          <AttachmentList
                            note={note}
                            onAction={onAttachmentAction}
                          />
                          <CollapsibleMessageBody
                            key={String(collapseLongMessages)}
                            body={note.body}
                            collapseLongMessages={collapseLongMessages}
                          />
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
                            allowReadOnly
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
  exampleCopyAction,
  exampleError,
  exampleGlow = false,
  readingPositions,
  detail,
  draft,
  draftSender,
  draftTimestamp,
  error,
  editingNote,
  editingAttachmentIds,
  pendingFiles,
  historyFilter,
  saving,
  senderOpen,
  timestampOpen,
  onBack,
  onCancelEditNote,
  onCustomize,
  onCopyNote,
  onAttachmentAction,
  onEditNote,
  onDeleteNote,
  onDraftChange,
  onDraftSenderChange,
  onDraftTimestampChange,
  onFilesSelected,
  onHistoryFilterChange,
  onRemoveEditingAttachment,
  onRemovePendingFile,
  onSetNoteLabel,
  onSubmit,
  onSenderOpenChange,
  onToggleTimestamp,
  copiedNoteId,
  navigationDisabled,
}: {
  readingPositions: Map<string, ReadingPosition>;
  detail: TimelineContent;
  exampleCopyAction?: ReactNode;
  exampleError?: ReactNode;
  exampleGlow?: boolean;
  draft: string;
  draftSender: string;
  draftTimestamp: string;
  error: string;
  editingNote?: Note;
  editingAttachmentIds: string[];
  pendingFiles: File[];
  historyFilter: HistoryFilter;
  saving: boolean;
  senderOpen: boolean;
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
  onDraftSenderChange: (value: string) => void;
  onDraftTimestampChange: (value: string) => void;
  onFilesSelected: (files: File[]) => void;
  onHistoryFilterChange: (filter: HistoryFilter) => void;
  onRemoveEditingAttachment: (attachmentId: string) => void;
  onRemovePendingFile: (index: number) => void;
  onSetNoteLabel: (note: Note, label: Label, applied: boolean) => Promise<void>;
  onSubmit: () => void;
  onSenderOpenChange: (open: boolean) => void;
  onToggleTimestamp: () => void;
  copiedNoteId?: string;
  navigationDisabled: boolean;
}) {
  const explainReadOnly = useContext(ExampleReadOnlyContext);
  const historyRef = useRef<HTMLElement>(null);
  const beforeFilterChange = useHistoryPosition(
    historyRef,
    detail.id,
    historyFilter,
    readingPositions,
    Boolean(explainReadOnly),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileDrop = useComposerFileDrop(
    composerRef,
    saving || Boolean(explainReadOnly),
    onFilesSelected,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const markdownToolsId = useId();
  const senderToolsId = useId();
  const pendingMarkdownSelection = useRef<
    { start: number; end: number } | undefined
  >(undefined);
  const lastMarkdownSelection = useRef<
    { start: number; end: number } | undefined
  >(undefined);
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [activeMarkdownAction, setActiveMarkdownAction] =
    useState<MarkdownAction>("bold");
  const [markdownError, setMarkdownError] = useState("");
  const previousUtilityRows = useRef([false, false, false]);
  const linkedNoteIds = useMemo(
    () =>
      new Set(
        detail.notes
          .filter((note) => analyzeMarkdown(note.body).hasLinks)
          .map((note) => note.id),
      ),
    [detail.notes],
  );
  const attachmentCount = detail.notes.filter(hasAttachments).length;
  const enabledLabels = detail.enabledLabels ?? ["todo", "milestone"];
  const filterLabels = [...PERMANENT_LABELS, ...enabledLabels];
  const visibleNotes = detail.notes.filter((note) => {
    if (historyFilter === "all") return true;
    if (historyFilter === "attachments") return hasAttachments(note);
    if (historyFilter === "links") return linkedNoteIds.has(note.id);
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
  const activeMarkdownTool =
    MARKDOWN_TOOLS.find((tool) => tool.action === activeMarkdownAction) ??
    MARKDOWN_TOOLS[0];
  const visibleComposerError = error || fileDrop.error || markdownError;
  const currentSender = draftSender.trim() || "You";

  useLayoutEffect(() => {
    const openRows = [senderOpen, timestampOpen, markdownOpen];
    const openedIndex = openRows.findIndex(
      (open, index) => open && !previousUtilityRows.current[index],
    );
    previousUtilityRows.current = openRows;
    if (openedIndex < 0) return;
    const content = composerRef.current?.querySelector(".composer-content");
    const row = content?.querySelector(
      [
        ".composer-sender-row",
        ".composer-timestamp-row",
        ".markdown-tools-strip",
      ][openedIndex],
    );
    if (!content || !row) return;
    const viewport = content.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) {
      content.scrollTop += bounds.top - viewport.top;
    }
  }, [senderOpen, timestampOpen, markdownOpen]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    resizeComposerTextarea(textarea);
    const selection = pendingMarkdownSelection.current;
    if (selection) {
      pendingMarkdownSelection.current = undefined;
      textarea.focus();
      textarea.setSelectionRange(selection.start, selection.end);
      lastMarkdownSelection.current = selection;
    }
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

  function applyMarkdownFormatting(action: MarkdownAction) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selection =
      document.activeElement === textarea
        ? { start: textarea.selectionStart, end: textarea.selectionEnd }
        : (lastMarkdownSelection.current ?? {
            start: textarea.selectionStart,
            end: textarea.selectionEnd,
          });
    const result = applyMarkdownAction(
      draft,
      action,
      selection.start,
      selection.end,
    );
    if (!result.ok) {
      setMarkdownError(result.error);
      restoreMarkdownSelection(selection);
      return;
    }

    setMarkdownError("");
    setActiveMarkdownAction(action);
    pendingMarkdownSelection.current = {
      start: result.selectionStart,
      end: result.selectionEnd,
    };
    if (result.value === draft) {
      pendingMarkdownSelection.current = undefined;
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
      return;
    }
    onDraftChange(result.value);
  }

  function restoreMarkdownSelection(selection = lastMarkdownSelection.current) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    if (!selection) return;
    textarea.setSelectionRange(selection.start, selection.end);
    lastMarkdownSelection.current = selection;
  }

  function closeMarkdownTools() {
    setMarkdownOpen(false);
    restoreMarkdownSelection();
  }

  function rememberMarkdownSelection() {
    const textarea = textareaRef.current;
    if (!textarea || document.activeElement !== textarea) return;
    lastMarkdownSelection.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }

  function beginEditingNote(note: Note) {
    fileDrop.clearError();
    setMarkdownError("");
    lastMarkdownSelection.current = undefined;
    onEditNote(note);
  }

  function cancelEditingNote() {
    fileDrop.clearError();
    setMarkdownError("");
    lastMarkdownSelection.current = undefined;
    onCancelEditNote();
  }

  function submitDraft() {
    fileDrop.clearError();
    setMarkdownError("");
    lastMarkdownSelection.current = undefined;
    onSubmit();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && markdownOpen) {
      event.preventDefault();
      closeMarkdownTools();
      return;
    }
    if (event.key === "Escape" && senderOpen) {
      event.preventDefault();
      onSenderOpenChange(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const markdownAction = markdownActionForShortcut(
      event,
      navigator.platform || navigator.userAgent,
    );
    if (markdownAction) {
      event.preventDefault();
      applyMarkdownFormatting(markdownAction);
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitDraft();
    }
  }

  function changeHistoryFilter(filter: HistoryFilter) {
    beforeFilterChange(filter);
    onHistoryFilterChange(filter);
  }

  return (
    <main
      className={`workspace workspace-chat ${explainReadOnly ? "workspace-example" : ""}`}
      data-accent={detail.accent}
    >
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
            <p className="eyebrow">
              {explainReadOnly ? "Example project" : "Project thread"}
            </p>
            <h1>{detail.title}</h1>
          </div>
          {exampleCopyAction ?? (
            <button
              className="button button-quiet edit-project-button"
              type="button"
              onClick={onCustomize}
            >
              <EditIcon />
              <span>Edit</span>
            </button>
          )}
        </div>
      </header>

      <nav className="history-filter" aria-label="History filters">
        <div className="history-filter-inner">
          <button
            type="button"
            className={`history-filter-button ${historyFilter === "all" ? "history-filter-button--active" : ""}`}
            aria-label={`All ${detail.notes.length}`}
            aria-pressed={historyFilter === "all"}
            onClick={() => changeHistoryFilter("all")}
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
            onClick={() => changeHistoryFilter("attachments")}
          >
            <span className="history-filter-icon" aria-hidden="true">
              <PaperclipIcon />
            </span>
            <span className="history-filter-label">Files</span>
            <span className="history-filter-count">{attachmentCount}</span>
          </button>
          <button
            type="button"
            className={`history-filter-button ${historyFilter === "links" ? "history-filter-button--active" : ""}`}
            aria-label={`Links ${linkedNoteIds.size}`}
            aria-pressed={historyFilter === "links"}
            onClick={() => changeHistoryFilter("links")}
          >
            <span className="history-filter-icon" aria-hidden="true">
              <LinkIcon />
            </span>
            <span className="history-filter-label">Links</span>
            <span className="history-filter-count">{linkedNoteIds.size}</span>
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
                onClick={() => changeHistoryFilter(label)}
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

      <section
        ref={historyRef}
        className="history"
        aria-label={`${detail.title} messages`}
      >
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
                  : historyFilter === "links"
                    ? "Links"
                    : LABEL_NAMES[historyFilter]}
              </p>
              <h2>
                No{" "}
                {historyFilter === "attachments"
                  ? "attached files"
                  : historyFilter === "links"
                    ? "links"
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
            collapseLongMessages={detail.collapseLongMessages ?? true}
            copiedNoteId={copiedNoteId}
            onAttachmentAction={onAttachmentAction}
            onCopyNote={onCopyNote}
            onDeleteNote={onDeleteNote}
            onEditNote={beginEditingNote}
            onSetNoteLabel={onSetNoteLabel}
          />
        )}
      </section>

      <footer className="composer-wrap">
        {exampleError}
        {visibleComposerError && (
          <p role="alert" className="composer-error">
            Your note is still here. {visibleComposerError}
          </p>
        )}
        <div
          ref={composerRef}
          className={`composer ${editingNote ? "composer--editing" : ""} ${fileDrop.active ? "composer--file-drag" : ""} ${fileDrop.over ? "composer--file-over" : ""}`}
          data-readonly-highlight={exampleGlow ? "true" : undefined}
          data-readonly={explainReadOnly ? "true" : undefined}
          role={explainReadOnly ? "group" : undefined}
          tabIndex={explainReadOnly ? 0 : undefined}
          aria-label={
            explainReadOnly ? "Read-only message composer" : undefined
          }
          aria-describedby={explainReadOnly ? "example-notice" : undefined}
          onClickCapture={explainReadOnly ? () => explainReadOnly() : undefined}
          onDrop={
            explainReadOnly
              ? (event) => {
                  event.preventDefault();
                  explainReadOnly();
                }
              : undefined
          }
          onDragOver={
            explainReadOnly ? (event) => event.preventDefault() : undefined
          }
          onKeyDown={(event) => {
            if (explainReadOnly) {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                explainReadOnly();
              }
              return;
            }
            handleComposerKeyDown(event);
          }}
        >
          {explainReadOnly && (
            <p className="example-composer-notice" id="example-notice">
              {EXAMPLE_NOTICE}
            </p>
          )}
          <fieldset
            className="composer-controls"
            disabled={Boolean(explainReadOnly)}
          >
            {fileDrop.active && (
              <div className="composer-drop-target" role="status">
                <PaperclipIcon />
                <span>
                  {editingNote
                    ? "Drop files here to attach to this message"
                    : "Drop files here to attach"}
                </span>
              </div>
            )}
            <div className="composer-content">
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
              {senderOpen && (
                <div
                  id={senderToolsId}
                  className="composer-sender-row"
                  role="group"
                  aria-label="Message sender"
                >
                  <label
                    className="field-label"
                    htmlFor={`${senderToolsId}-name`}
                  >
                    Sender
                  </label>
                  <button
                    className="composer-sender-you"
                    type="button"
                    aria-pressed={!draftSender.trim()}
                    onClick={() => onDraftSenderChange("")}
                  >
                    You
                  </button>
                  <span className="composer-sender-or" aria-hidden="true">
                    or
                  </span>
                  <input
                    id={`${senderToolsId}-name`}
                    className="text-input composer-sender-input"
                    type="text"
                    aria-label="Sender name"
                    value={draftSender}
                    maxLength={80}
                    placeholder="Type a sender name…"
                    onChange={(event) =>
                      onDraftSenderChange(event.target.value)
                    }
                  />
                  <span className="composer-sender-hint" aria-hidden="true">
                    Participant messages appear on the left
                  </span>
                </div>
              )}
              {timestampOpen && (
                <div className="composer-timestamp-row">
                  <label className="field-label" htmlFor="composer-timestamp">
                    Timestamp
                  </label>
                  <input
                    id="composer-timestamp"
                    className="text-input composer-timestamp-input"
                    type="datetime-local"
                    aria-label="Message timestamp"
                    value={draftTimestamp}
                    onChange={(event) =>
                      onDraftTimestampChange(event.target.value)
                    }
                  />
                </div>
              )}
              {markdownOpen && (
                <div
                  id={markdownToolsId}
                  className="markdown-tools-strip"
                  role="group"
                  aria-label="Markdown assistance"
                >
                  <span className="markdown-tools-label">Format</span>
                  <div className="markdown-tools-scroll">
                    {MARKDOWN_TOOLS.map((tool) => (
                      <button
                        className="markdown-tool-button"
                        type="button"
                        key={tool.action}
                        aria-label={
                          tool.shortcutLabel
                            ? `${tool.label} (${tool.shortcutLabel})`
                            : tool.label
                        }
                        aria-keyshortcuts={tool.ariaKeyShortcuts}
                        title={`${tool.label} · ${tool.syntax}${tool.shortcutLabel ? ` · ${tool.shortcutLabel}` : ""}`}
                        onPointerDown={rememberMarkdownSelection}
                        onFocus={() => setActiveMarkdownAction(tool.action)}
                        onMouseEnter={() =>
                          setActiveMarkdownAction(tool.action)
                        }
                        onClick={() => applyMarkdownFormatting(tool.action)}
                      >
                        <MarkdownToolGlyph action={tool.action} />
                      </button>
                    ))}
                  </div>
                  <span className="markdown-tool-hint" aria-hidden="true">
                    <strong>{activeMarkdownTool.label}</strong>
                    <code>{activeMarkdownTool.syntax}</code>
                    {activeMarkdownTool.shortcutLabel && (
                      <span>{activeMarkdownTool.shortcutLabel}</span>
                    )}
                  </span>
                  <span className="markdown-tools-escape" aria-hidden="true">
                    Esc
                  </span>
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
                  onChange={(event) => {
                    fileDrop.clearError();
                    setMarkdownError("");
                    onDraftChange(event.target.value);
                  }}
                  onSelect={rememberMarkdownSelection}
                  onBlur={rememberMarkdownSelection}
                  onKeyDown={handleKeyDown}
                />
              </div>
            </div>
            <div className="composer-bar">
              <div className="composer-tools">
                <button
                  className={`composer-icon-button ${draftSender.trim() ? "composer-icon-button--active" : ""}`}
                  type="button"
                  onClick={() => onSenderOpenChange(!senderOpen)}
                  aria-label={`${senderOpen ? "Hide" : "Show"} sender options. Current sender: ${currentSender}`}
                  aria-expanded={senderOpen}
                  aria-controls={senderToolsId}
                  title={`Sender: ${currentSender}`}
                >
                  <SenderIcon />
                </button>
                <button
                  className="composer-icon-button composer-markdown-button"
                  type="button"
                  onClick={() => {
                    setMarkdownOpen((open) => !open);
                    setMarkdownError("");
                  }}
                  onPointerDown={rememberMarkdownSelection}
                  aria-label={
                    markdownOpen
                      ? "Hide Markdown assistance"
                      : "Show Markdown assistance"
                  }
                  aria-expanded={markdownOpen}
                  aria-controls={markdownToolsId}
                  title={
                    markdownOpen
                      ? "Hide Markdown assistance"
                      : "Show Markdown assistance"
                  }
                >
                  <span className="markdown-mark" aria-hidden="true">
                    M↓
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  className="visually-hidden-file"
                  type="file"
                  multiple
                  aria-label="Attach files"
                  onChange={(event) => {
                    fileDrop.clearError();
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
              <div className="composer-actions">
                <span className="composer-shortcut">
                  <kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd>
                </span>
                {editingNote && (
                  <button
                    className="composer-cancel-button"
                    type="button"
                    onClick={cancelEditingNote}
                  >
                    Cancel
                  </button>
                )}
                <button
                  className="send-button"
                  type="button"
                  onClick={submitDraft}
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
          </fieldset>
        </div>
      </footer>
    </main>
  );
}

export function App({ api = apiClient }: { api?: ApiClient }) {
  const homeUpdates = useHomeUpdates(api);
  const [narrowHome, setNarrowHome] = useState(
    () => window.matchMedia?.("(max-width: 760px)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 760px)");
    if (!media) return;
    const change = () => setNarrowHome(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [workspace, setWorkspace] = useState<WorkspaceServerState>({
    chats: [],
  });
  const { chats, active } = workspace;
  const [example, setExample] = useState<ExampleDetail>();
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  const [examplesError, setExamplesError] = useState("");
  const [examplesReload, setExamplesReload] = useState(0);
  const [showExamples, setShowExamples] = useState(readShowExamples);
  const [preferenceWarning, setPreferenceWarning] = useState("");
  const [copyingExample, setCopyingExample] = useState(false);
  const copyInProgress = useRef(false);
  const [exampleNotice, setExampleNotice] = useState("");
  const [exampleGlow, setExampleGlow] = useState(false);
  const exampleGlowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(exampleGlowTimer.current), []);
  function explainExampleReadOnly() {
    clearTimeout(exampleGlowTimer.current);
    setExampleGlow(true);
    setExampleNotice(
      "Read-only example. Create an editable copy first to use this action.",
    );
    exampleGlowTimer.current = setTimeout(() => setExampleGlow(false), 800);
  }

  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [dialog, setDialog] = useState<"create" | "edit">();
  const [mode, setMode] = useState<"projects" | "settings" | "projectEdit">(
    "projects",
  );
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general");
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [editingNote, setEditingNote] = useState<Note>();
  const [editingAttachmentIds, setEditingAttachmentIds] = useState<string[]>(
    [],
  );
  const [copiedNoteId, setCopiedNoteId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [draftSender, setDraftSender] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [draftTimestamp, setDraftTimestamp] = useState("");
  const [composerSenderOpen, setComposerSenderOpen] = useState(false);
  const [composerTimestampOpen, setComposerTimestampOpen] = useState(false);
  const [error, setError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInProgress = useRef(false);
  const databaseEpoch = useRef(0);
  const pendingNoteMutations = useRef(0);
  const previewTail = useRef<Promise<unknown>>(Promise.resolve());
  const [pendingNoteCount, setPendingNoteCount] = useState(0);
  const [pinErrors, setPinErrors] = useState<Record<string, string>>({});
  const [projectMutationIds, setProjectMutationIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const projectMutations = useRef(new Set<string>());
  const pendingPinFocus = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const id = pendingPinFocus.current;
    if (id === undefined || projectMutationIds.has(id)) return;
    pendingPinFocus.current = undefined;
    const control = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-project-pin-id]"),
    ].find((button) => button.dataset.projectPinId === id);
    const target = control?.closest("[hidden]")
      ? control
          .closest(".project-section")
          ?.querySelector<HTMLButtonElement>(".rail-section-label")
      : control;
    target?.focus();
  }, [projectMutationIds]);
  const [readingPositions, setReadingPositions] = useState(
    () => new Map<string, ReadingPosition>(),
  );
  const [collapsedSections, setCollapsedSections] = useState<
    Record<RailSection, boolean>
  >({ Pinned: false, Projects: false, Archive: false, Examples: false });
  const selectionRequest = useRef(0);
  const pendingSelection = useRef<"example" | "project" | undefined>(undefined);
  const copiedFocus = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (active?.id !== copiedFocus.current || !copiedFocus.current) return;
    copiedFocus.current = undefined;
    const heading = document.querySelector<HTMLElement>(".workspace-chat h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [active?.id]);
  const activeMutationGeneration = useRef(0);
  const summaryRequest = useRef(0);
  const activeId = useRef<string | undefined>(undefined);
  const copyResetTimer = useRef<number | undefined>(undefined);
  const newMessageSender = useRef("");
  const newMessageSenderOpen = useRef(false);

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
      if (!projectId || importInProgress.current) return;
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
      .listExamples()
      .then((result) => {
        if (current) {
          setExamples(result);
          setExamplesError("");
        }
      })
      .catch(() => {
        if (current) setExamplesError("Examples could not be loaded.");
      });
    return () => {
      current = false;
    };
  }, [api, examplesReload]);

  function updateExamplesVisibility(show: boolean, persist = true) {
    setShowExamples(show);
    if (persist)
      setPreferenceWarning(
        persistShowExamples(show)
          ? ""
          : "This preference could not be saved. It applies until this page is closed.",
      );
    if (!show && (example || pendingSelection.current === "example")) {
      selectionRequest.current++;
      pendingSelection.current = undefined;
      setExample(undefined);
      setHistoryFilter("all");
    }
  }
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === SHOW_EXAMPLES_KEY || event.key === null) {
        const show = readShowExamples();
        setShowExamples(show);
        if (!show && (example || pendingSelection.current === "example")) {
          selectionRequest.current++;
          pendingSelection.current = undefined;
          setExample(undefined);
          setHistoryFilter("all");
          setExampleNotice("Examples are hidden.");
        }
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [example]);

  async function selectExample(slug: string) {
    if (savingNote || copyInProgress.current) return;
    pendingSelection.current = "example";
    const request = ++selectionRequest.current;
    setError("");
    try {
      const detail = await api.getExample(slug);
      if (request !== selectionRequest.current) return;
      activeId.current = undefined;
      setWorkspace((current) => ({ ...current, active: undefined }));
      clearTimeout(exampleGlowTimer.current);
      setExampleGlow(false);
      setExample(detail);
      setMode("projects");
      setHistoryFilter("all");
      setExampleNotice("");
      setDraft("");
      setPendingFiles([]);
      setEditingNote(undefined);
      setEditingAttachmentIds([]);
      setDraftTimestamp("");
      setComposerTimestampOpen(false);
      resetSenderComposer();
      focusMobileBackButton();
    } catch (caught) {
      if (request === selectionRequest.current)
        setError(errorMessage(caught, "The example could not be opened."));
    } finally {
      if (request === selectionRequest.current)
        pendingSelection.current = undefined;
    }
  }

  async function createExampleCopy() {
    if (!example || copyInProgress.current || importInProgress.current) return;
    copyInProgress.current = true;
    setCopyingExample(true);
    setError("");
    activeMutationGeneration.current++;
    summaryRequest.current++;
    const selection = selectionRequest.current;
    try {
      const result = await api.copyExample(example.slug, example.revision);
      let detail = result.project;
      if (!detail) {
        try {
          detail = await api.getChat(result.id);
        } catch {
          setError(
            "Your editable copy was created, but could not be opened. Refresh Projects to find it; do not create it again.",
          );
          return;
        }
      }
      const copiedProject = detail;
      setWorkspace((current) => ({
        chats: sortChats([
          ...current.chats.filter((chat) => chat.id !== copiedProject.id),
          chatFromDetail(copiedProject),
        ]),
        active:
          selection === selectionRequest.current
            ? copiedProject
            : current.active,
      }));
      if (selection === selectionRequest.current) {
        setExample(undefined);
        activeId.current = detail.id;
        copiedFocus.current = detail.id;
        setLoadState("loaded");
        setHistoryFilter("all");
        setCollapsedSections((current) => ({ ...current, Projects: false }));
      }
      setExampleNotice("Editable copy created.");
    } catch (caught) {
      setError(errorMessage(caught, "The example could not be copied."));
      // A lost response may follow a committed copy. Refresh never retries the POST.
    } finally {
      copyInProgress.current = false;
      setCopyingExample(false);
      activeMutationGeneration.current++;
      summaryRequest.current++;
      refreshProjectSummaries();
    }
  }
  function refreshProjectSummaries() {
    if (importInProgress.current) return;
    const request = ++summaryRequest.current;
    const mutation = activeMutationGeneration.current;
    void api
      .listChats()
      .then((result) => {
        if (
          request !== summaryRequest.current ||
          mutation !== activeMutationGeneration.current
        )
          return;
        setWorkspace((current) => ({
          ...current,
          chats: sortChats(result),
        }));
      })
      .catch(() => {
        // Temporal and focus refreshes are best effort.
      });
  }

  useEffect(() => {
    let current = true;
    const request = ++summaryRequest.current;
    api
      .listChats()
      .then((result) => {
        if (!current || request !== summaryRequest.current) return;
        setWorkspace((current) => ({ ...current, chats: sortChats(result) }));
        setLoadState("loaded");
      })
      .catch(() => {
        if (!current || request !== summaryRequest.current) return;
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

  function resetSenderComposer() {
    newMessageSender.current = "";
    newMessageSenderOpen.current = false;
    setDraftSender("");
    setComposerSenderOpen(false);
  }

  function changeDraftSender(value: string) {
    setDraftSender(value);
    if (!editingNote) newMessageSender.current = value;
  }

  function changeSenderOpen(open: boolean) {
    setComposerSenderOpen(open);
    if (!editingNote) newMessageSenderOpen.current = open;
  }

  async function selectChat(id: string) {
    if (savingNote || copyInProgress.current) return;
    pendingSelection.current = "project";
    const request = ++selectionRequest.current;
    setMode("projects");
    setError("");
    try {
      const detail = await api.getChat(id);
      if (request !== selectionRequest.current) return;
      setExample(undefined);
      setWorkspace((current) => {
        const summary = current.chats.find((chat) => chat.id === id);
        return {
          ...current,
          active: {
            ...detail,
            archivedAt:
              summary?.archivedAt === undefined
                ? detail.archivedAt
                : summary.archivedAt,
            pinnedAt:
              summary?.pinnedAt === undefined
                ? detail.pinnedAt
                : summary.pinnedAt,
          },
        };
      });
      setDraft("");
      resetSenderComposer();
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
    } finally {
      if (request === selectionRequest.current)
        pendingSelection.current = undefined;
    }
  }

  async function createChat(input: { title: string; accent: Accent }) {
    const chat = await api.createChat(input);
    setExample(undefined);
    selectionRequest.current += 1;
    setWorkspace((current) => ({
      chats: [chat, ...current.chats],
      active: { ...chat, notes: [] },
    }));
    setDialog(undefined);
    setDraft("");
    resetSenderComposer();
    setPendingFiles([]);
    setHistoryFilter("all");
    setDraftTimestamp("");
    setComposerTimestampOpen(false);
    setEditingNote(undefined);
    setEditingAttachmentIds([]);
    focusMobileBackButton();
  }

  async function runProjectMutation(id: string, mutation: () => Promise<void>) {
    if (projectMutations.current.has(id))
      throw new Error("Wait for the current project change to finish.");
    projectMutations.current.add(id);
    setProjectMutationIds((current) => new Set(current).add(id));
    activeMutationGeneration.current += 1;
    summaryRequest.current += 1;
    try {
      await mutation();
    } finally {
      activeMutationGeneration.current += 1;
      summaryRequest.current += 1;
      projectMutations.current.delete(id);
      setProjectMutationIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  function clearProjectError(id: string) {
    setPinErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function toggleChatPinned(chat: Chat) {
    if (projectMutations.current.has(chat.id)) return;
    clearProjectError(chat.id);
    try {
      await runProjectMutation(chat.id, async () => {
        const state = await api.setChatPinned(chat.id, chat.pinnedAt == null);
        setWorkspace((current) => ({
          active:
            current.active?.id === chat.id
              ? { ...current.active, ...state }
              : current.active,
          chats: sortChats(
            current.chats.map((item) =>
              item.id === chat.id ? { ...item, ...state } : item,
            ),
          ),
        }));
        pendingPinFocus.current = chat.id;
      });
    } catch (caught) {
      setPinErrors((current) => ({
        ...current,
        [chat.id]: errorMessage(caught, "The project pin could not be saved."),
      }));
      pendingPinFocus.current = chat.id;
    }
  }

  async function setChatArchived(
    chat: Chat,
    archived: boolean,
    fromSidebar = false,
  ) {
    clearProjectError(chat.id);
    await runProjectMutation(chat.id, async () => {
      try {
        const state = await api.setChatArchived(chat.id, archived);
        setWorkspace((current) => ({
          active:
            current.active?.id === chat.id
              ? { ...current.active, ...state }
              : current.active,
          chats: sortChats(
            current.chats.map((item) =>
              item.id === chat.id ? { ...item, ...state } : item,
            ),
          ),
        }));
      } finally {
        if (fromSidebar) pendingPinFocus.current = chat.id;
      }
    });
  }

  async function restoreChat(chat: Chat) {
    if (projectMutations.current.has(chat.id)) return;
    try {
      await setChatArchived(chat, false, true);
    } catch (caught) {
      setPinErrors((current) => ({
        ...current,
        [chat.id]: errorMessage(caught, "The project could not be restored."),
      }));
    }
  }

  async function updateChat(input: Parameters<typeof updateChatUnlocked>[0]) {
    if (active)
      await runProjectMutation(active.id, () => updateChatUnlocked(input));
  }

  async function deleteChat() {
    if (active) await runProjectMutation(active.id, deleteChatUnlocked);
  }

  async function updateChatUnlocked(input: {
    title: string;
    accent: Accent;
    enabledLabels: ConfigurableLabel[];
    collapseLongMessages: boolean;
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

  async function deleteChatUnlocked() {
    if (!active) return;
    const projectId = active.id;
    const selectionAtStart = selectionRequest.current;
    await api.deleteChat(projectId);
    setReadingPositions((current) => {
      const next = new Map(current);
      next.delete(projectId);
      return next;
    });
    const navigationUnchanged = selectionRequest.current === selectionAtStart;
    if (navigationUnchanged) selectionRequest.current += 1;
    activeMutationGeneration.current += 1;
    setWorkspace((current) => ({
      chats: current.chats.filter((chat) => chat.id !== projectId),
      active: current.active?.id === projectId ? undefined : current.active,
    }));
    if (navigationUnchanged) {
      setDraft("");
      resetSenderComposer();
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
    const submittedSender = draftSender.trim();
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
        const sender = submittedSender || null;
        await updateNote(editing, {
          body: submittedDraft,
          ...(sender === (editing.sender ?? null) ? {} : { sender }),
          createdAt: timestamp,
          keepAttachmentIds: editingAttachmentIds,
          files: submittedFiles,
        });
        setDraftSender(newMessageSender.current);
        setComposerSenderOpen(newMessageSenderOpen.current);
      } else {
        const note = await api.appendNote(projectId, {
          body: submittedDraft,
          ...(submittedSender ? { sender: submittedSender } : {}),
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
    newMessageSender.current = draftSender;
    newMessageSenderOpen.current = composerSenderOpen;
    setEditingNote(note);
    setEditingAttachmentIds(
      note.attachments?.map((attachment) => attachment.id) ?? [],
    );
    setDraft(note.body);
    setDraftSender(note.sender ?? "");
    setComposerSenderOpen(Boolean(note.sender));
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
    setDraftSender(newMessageSender.current);
    setComposerSenderOpen(newMessageSenderOpen.current);
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
      sender?: string | null;
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

  async function runNoteMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (importInProgress.current) throw new Error("Wait for import to finish.");
    pendingNoteMutations.current += 1;
    setPendingNoteCount(pendingNoteMutations.current);
    try {
      return await operation();
    } finally {
      pendingNoteMutations.current -= 1;
      setPendingNoteCount(pendingNoteMutations.current);
    }
  }

  async function deleteNote(note: Note) {
    if (!active) return;
    if (!window.confirm("Delete this message?")) return;
    const projectId = active.id;
    const epoch = databaseEpoch.current;
    await runNoteMutation(() => api.deleteNote(projectId, note.id));
    if (epoch !== databaseEpoch.current) return;
    activeMutationGeneration.current += 1;
    const submittedNotes = active.notes.filter((item) => item.id !== note.id);
    const submittedUpdatedAt = chatActivityFromNotes(active, submittedNotes);
    const submittedDetail = {
      ...active,
      notes: submittedNotes,
      updatedAt: submittedUpdatedAt,
    };
    setWorkspace((current) =>
      commitProjectUpdate(
        current,
        projectId,
        (chat) => mergeMessageSummary(chat, submittedDetail),
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
    const epoch = databaseEpoch.current;
    const labels = await runNoteMutation(() =>
      api.setNoteLabel(projectId, note.id, label, applied),
    );
    if (epoch !== databaseEpoch.current) return;
    activeMutationGeneration.current += 1;
    const submittedDetail = {
      ...active,
      notes: active.notes.map((item) =>
        item.id === note.id ? { ...item, labels } : item,
      ),
    };
    setWorkspace((current) =>
      commitProjectUpdate(
        current,
        projectId,
        (chat) => mergeMessageSummary(chat, submittedDetail),
        (detail) => ({
          ...detail,
          notes: detail.notes.map((item) =>
            item.id === note.id ? { ...item, labels } : item,
          ),
        }),
      ),
    );
  }

  async function exportDatabase(selection: ProjectSelection) {
    const blob = await api.exportDatabase(selection);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `threadstr-${new Date().toISOString().slice(0, 10)}.on-track-backup`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function previewDatabase(file: File) {
    const next = previewTail.current.then(
      () => api.previewDatabase(file),
      () => api.previewDatabase(file),
    );
    previewTail.current = next;
    return next;
  }

  async function importDatabase(file: File, options: ImportOptions) {
    if (
      importInProgress.current ||
      savingNote ||
      projectMutations.current.size ||
      pendingNoteMutations.current > 0
    )
      throw new Error(
        "Wait for the current project change to finish before importing.",
      );
    importInProgress.current = true;
    setImporting(true);
    const invalidate = () => {
      databaseEpoch.current += 1;
      selectionRequest.current += 1;
      activeMutationGeneration.current += 1;
      summaryRequest.current += 1;
    };
    invalidate();
    try {
      const result = await api.importDatabase(file, options);
      invalidate();
      if (options.mode === "replace") {
        activeId.current = undefined;
        setExample(undefined);
        setWorkspace({ chats: [] });
        setReadingPositions(new Map());
        setDraftTimestamp("");
        resetSenderComposer();
        setPendingFiles([]);
        setHistoryFilter("all");
        setComposerTimestampOpen(false);
        setDraft("");
        setEditingNote(undefined);
        setEditingAttachmentIds([]);
        setCopiedNoteId(undefined);
        setPinErrors({});
        pendingPinFocus.current = undefined;
        setError("");
      }
      try {
        const importedChats = await api.listChats();
        setLoadState("loaded");
        setError("");
        setWorkspace((current) => ({
          ...current,
          chats: sortChats(importedChats),
        }));
        return result;
      } catch {
        return {
          ...result,
          refreshWarning:
            "Import completed, but the project list could not be refreshed. Reload the page to see your projects; do not import again.",
        };
      }
    } finally {
      invalidate();
      importInProgress.current = false;
      setImporting(false);
    }
  }

  function backToProjects() {
    if (savingNote || copyInProgress.current) return;
    const exampleSlug = example?.slug;
    setExample(undefined);
    const projectId = active?.id;
    setMode("projects");
    setError("");
    selectionRequest.current += 1;
    setWorkspace((current) => ({ ...current, active: undefined }));
    setEditingNote(undefined);
    setEditingAttachmentIds([]);
    setDraft("");
    resetSenderComposer();
    setPendingFiles([]);
    setHistoryFilter("all");
    setDraftTimestamp("");
    setComposerTimestampOpen(false);
    if (exampleSlug) {
      requestAnimationFrame(() => {
        const row = [
          ...document.querySelectorAll<HTMLButtonElement>(
            "[data-example-slug]",
          ),
        ].find((button) => button.dataset.exampleSlug === exampleSlug);
        const target = row?.closest("[hidden]")
          ? document.querySelector<HTMLButtonElement>('[aria-label="Examples"]')
          : row;
        target?.focus();
      });
    }
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
      {exampleNotice && (
        <p className="visually-hidden" role="status">
          {exampleNotice}
        </p>
      )}
      {mode === "settings" ? (
        <SettingsRail
          activeSection={settingsSection}
          disabled={importing}
          onBack={() => setMode("projects")}
          onSelect={setSettingsSection}
        />
      ) : (
        <ProjectRail
          homeUtilities={
            narrowHome &&
            mode === "projects" &&
            !active &&
            !example &&
            (placeholderState === "empty" || placeholderState === "choose") ? (
              <HomeUtilities updates={homeUpdates} />
            ) : undefined
          }
          onHome={backToProjects}
          examplesSection={
            showExamples ? (
              <ExamplesSection
                examples={examples}
                collapsed={collapsedSections.Examples}
                onToggle={() =>
                  setCollapsedSections((current) => ({
                    ...current,
                    Examples: !current.Examples,
                  }))
                }
                onSelect={selectExample}
                activeSlug={example?.slug}
                disabled={savingNote || copyingExample}
                error={examplesError}
                onRetry={() => setExamplesReload((value) => value + 1)}
              />
            ) : undefined
          }
          collapsedSections={collapsedSections}
          onToggleSection={(section) =>
            setCollapsedSections((current) => ({
              ...current,
              [section]: !current[section],
            }))
          }
          chats={chats}
          activeId={active?.id ?? example?.id}
          onSelect={selectChat}
          onTogglePinned={toggleChatPinned}
          onRestore={restoreChat}
          onTemporalBoundary={refreshProjectSummaries}
          onCreate={() => {
            selectionRequest.current++;
            pendingSelection.current = undefined;
            setDialog("create");
          }}
          onSettings={() => {
            if (!copyInProgress.current) {
              selectionRequest.current++;
              pendingSelection.current = undefined;
              setMode("settings");
            }
          }}
          navigationDisabled={savingNote || copyingExample}
          pinErrors={pinErrors}
          projectMutationIds={projectMutationIds}
        />
      )}
      {!active && !example && error && (
        <p className="global-error" role="alert">
          {error}
        </p>
      )}
      {mode === "settings" ? (
        settingsSection === "general" ? (
          <GeneralSettingsWorkspace
            showExamples={showExamples}
            onChange={updateExamplesVisibility}
            warning={preferenceWarning}
          />
        ) : settingsSection === "appearance" ? (
          <AppearanceSettingsWorkspace theme={theme} onThemeChange={setTheme} />
        ) : (
          <BackupSettingsWorkspace
            projects={chats}
            onPreview={previewDatabase}
            unavailable={
              importing ||
              savingNote ||
              projectMutationIds.size > 0 ||
              pendingNoteCount > 0
            }
            onExport={exportDatabase}
            onImport={importDatabase}
          />
        )
      ) : example ? (
        <ExampleReadOnlyContext.Provider value={explainExampleReadOnly}>
          <ChatWorkspace
            key={`${example.id}:${example.revision}`}
            detail={{ ...example, id: `${example.id}:${example.revision}` }}
            readingPositions={readingPositions}
            exampleGlow={exampleGlow}
            exampleCopyAction={
              <button
                className="button button-primary example-copy-button"
                disabled={copyingExample}
                onClick={() => void createExampleCopy()}
              >
                {copyingExample ? "Creating copy…" : "Create editable copy"}
              </button>
            }
            exampleError={
              error ? (
                <p role="alert" className="composer-error">
                  {error}{" "}
                  <button
                    className="button button-quiet"
                    onClick={() => {
                      refreshProjectSummaries();
                      void selectExample(example.slug);
                    }}
                  >
                    Refresh example and projects
                  </button>
                </p>
              ) : undefined
            }
            draft=""
            draftSender=""
            draftTimestamp=""
            error=""
            editingAttachmentIds={[]}
            pendingFiles={[]}
            historyFilter={historyFilter}
            saving={false}
            senderOpen={false}
            timestampOpen={false}
            onBack={backToProjects}
            onCustomize={() => {}}
            onCopyNote={copyNote}
            onAttachmentAction={async () => {}}
            onEditNote={() => {}}
            onCancelEditNote={() => {}}
            onDeleteNote={() => {}}
            onDraftChange={() => {}}
            onDraftSenderChange={() => {}}
            onDraftTimestampChange={() => {}}
            onFilesSelected={() => {}}
            onHistoryFilterChange={setHistoryFilter}
            onRemoveEditingAttachment={() => {}}
            onRemovePendingFile={() => {}}
            onSetNoteLabel={async () => {}}
            onSubmit={() => {}}
            onSenderOpenChange={() => {}}
            onToggleTimestamp={() => {}}
            copiedNoteId={copiedNoteId}
            navigationDisabled={copyingExample}
          />
        </ExampleReadOnlyContext.Provider>
      ) : mode === "projectEdit" && active ? (
        <ProjectEditWorkspace
          key={active.id}
          chat={active}
          mutationPending={projectMutationIds.has(active.id)}
          onToggleArchived={() =>
            setChatArchived(active, active.archivedAt == null)
          }
          onBack={() => setMode("projects")}
          onSubmit={updateChat}
          onDelete={deleteChat}
        />
      ) : active ? (
        <ChatWorkspace
          key={active.id}
          readingPositions={readingPositions}
          detail={active}
          draft={draft}
          draftSender={draftSender}
          draftTimestamp={draftTimestamp}
          error={error}
          editingNote={editingNote}
          editingAttachmentIds={editingAttachmentIds}
          pendingFiles={pendingFiles}
          historyFilter={historyFilter}
          saving={savingNote}
          senderOpen={composerSenderOpen}
          timestampOpen={composerTimestampOpen}
          onBack={backToProjects}
          onCustomize={() => setMode("projectEdit")}
          onCopyNote={copyNote}
          onAttachmentAction={attachmentAction}
          onEditNote={startEditingNote}
          onCancelEditNote={cancelEditingNote}
          onDeleteNote={deleteNote}
          onDraftChange={setDraft}
          onDraftSenderChange={changeDraftSender}
          onDraftTimestampChange={setDraftTimestamp}
          onFilesSelected={addPendingFiles}
          onHistoryFilterChange={setHistoryFilter}
          onRemoveEditingAttachment={removeEditingAttachment}
          onRemovePendingFile={removePendingFile}
          onSetNoteLabel={setNoteLabel}
          onSubmit={appendNote}
          onSenderOpenChange={changeSenderOpen}
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
        <HomeWorkspace
          state={placeholderState}
          onCreate={() => {
            selectionRequest.current++;
            pendingSelection.current = undefined;
            setDialog("create");
          }}
        >
          {!narrowHome &&
            (placeholderState === "empty" || placeholderState === "choose") && (
              <HomeUtilities updates={homeUpdates} />
            )}
        </HomeWorkspace>
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
