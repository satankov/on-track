import {
  isLocalFile,
  useConversationDraft,
  type ComposerFile,
} from "./conversation-draft.js";
import { PicturePreview } from "./PicturePreview.js";
import { PictureLoadQueue } from "./picture-load-queue.js";
import { useModalDialog } from "./useModalDialog.js";
import {
  MAX_PICTURE_PREVIEW_BYTES,
  picturePreviewMediaType,
} from "../domain/picture-preview.js";
import { MessageExportWorkspace } from "./MessageExportWorkspace.js";
import { selectedMessageSource } from "./message-export-source.js";
import { useMessageSelection } from "./useMessageSelection.js";
import { SharedMessageGradient } from "./SharedMessageGradient.js";
import { ProjectSearchResults } from "./ProjectSearchResults.js";
import { findProjectSearchResults } from "./project-search-results.js";
import { labelDisplayName } from "./label-display.js";
import { ProjectLabelContext } from "./label-context.js";
import { ProjectLabelsEditor } from "./ProjectLabelsEditor.js";
import {
  labelConfiguration,
  withLabelPlaceholder,
  type LabelDraft,
} from "./label-drafts.js";
import {
  projectLabels,
  labelConfigurationSchema,
  type LabelConfiguration,
} from "../domain/labels.js";
import {
  additiveModifier,
  filterKey,
  isApplePlatform,
  selectFilter,
  type FilterId,
  type HistoryFilter,
} from "./history-filters.js";
import { HighlightText } from "./HighlightText.js";
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
import {
  MessageDestinationPicker,
  MessageSelectionBar,
} from "./MessageBatchControls.js";
import { MessagePopover } from "./MessagePopover.js";
import { ExamplesSection, GeneralSettingsWorkspace } from "./Examples.js";
import { useWorkspacePreferences } from "./useWorkspacePreferences.js";
import type { RailSection } from "./preferences.js";
import {
  Fragment,
  useCallback,
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
  type MouseEvent,
  type ReactNode,
} from "react";
import { MarkdownMessage } from "./MarkdownMessage.js";

import { BackupSettingsWorkspace } from "./BackupSettingsWorkspace.js";
import type {
  ImportOptions,
  ProjectSelection,
} from "../domain/database-transfer.js";
import type { Chat, ChatDetail, Note } from "../domain/types.js";
import {
  ACCENTS,
  PERMANENT_LABELS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type BatchNotesInput,
  type Accent,
  type ConfigurableLabel,
  type Label,
} from "../domain/validation.js";
import {
  apiClient,
  attachmentPath,
  NoteBodyConflictError,
  type ApiClient,
} from "./api.js";
import {
  applyMarkdownAction,
  MARKDOWN_TOOLS,
  markdownActionForShortcut,
  type MarkdownAction,
} from "./markdown-assistance.js";
import { THEMES, type Theme } from "./theme.js";
import {
  restoreReadingPosition,
  useHistoryPosition,
  type ReadingPosition,
} from "./history-position.js";
import { senderColor } from "./sender-color.js";
import { useComposerFileDrop } from "./composer-file-drop.js";
import { HistoryNavigation } from "./HistoryNavigation.js";
import { useSendFeedback, type SendFeedback } from "./send-feedback.js";
import {
  ProjectSearch,
  SearchIcon,
  SearchSaveStatus,
} from "./ProjectSearch.js";
import {
  createSearchDocumentBuilder,
  matchesSearch,
  parseSearchQuery,
} from "./project-search.js";

const ACCENT_NAMES: Record<Accent, string> = {
  coral: "Coral",
  amber: "Amber",
  moss: "Moss",
  ocean: "Ocean",
  iris: "Iris",
  slate: "Slate",
  "coral-gradient": "Guava",
  "amber-gradient": "Honey",
  "moss-gradient": "Jade",
  "ocean-gradient": "Lagoon",
  "iris-gradient": "Orchid",
  "slate-gradient": "Periwinkle",
};

const LABEL_MARKS: Partial<Record<Label, string>> = {
  risk: "⚠️",
  milestone: "🎖️",
};

const FILTER_LABEL_NAMES: Partial<Record<Label, string>> = {
  attention: "Alert",
};

const ICON_ONLY_MESSAGE_LABELS = new Set<Label>(["pin", "attention"]);
const MESSAGE_COLLAPSED_HEIGHT_PX = 192;

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
  const attentionTimestamps = notes
    .filter((note) => note.labels?.includes("attention"))
    .map((note) => note.createdAt);
  return {
    id: detail.id,
    projectId: detail.projectId ?? null,
    origin: detail.origin ?? null,
    title: detail.title,
    accent: detail.accent,
    enabledLabels: detail.enabledLabels,
    labelDefinitions: detail.labelDefinitions,
    labelConfigurationRevision: detail.labelConfigurationRevision,
    collapseLongMessages: detail.collapseLongMessages ?? true,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    archivedAt: detail.archivedAt ?? null,
    pinnedAt: detail.pinnedAt ?? null,
    manualAlert: detail.manualAlert,
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
    latestAttentionAt: summary.latestAttentionAt,
    nextAttentionAt: summary.nextAttentionAt,
  };
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

function isMobileViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 760px)").matches
  );
}

function focusMobileBackButton(): void {
  if (!isMobileViewport()) return;
  const previousFocus = document.activeElement;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Navigation must not steal focus from a control reached while rendering.
      const currentFocus = document.activeElement;
      if (currentFocus !== previousFocus && currentFocus !== document.body)
        return;
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

function groupNotesByDay<T extends { createdAt: number }>(
  notes: T[],
): { key: string; label: string; notes: T[] }[] {
  return notes.reduce<{ key: string; label: string; notes: T[] }[]>(
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

function ProjectAccentPicker({
  accent,
  onChange,
  name,
}: {
  accent: Accent;
  onChange: (accent: Accent) => void;
  name: string;
}) {
  return (
    <fieldset className="accent-fieldset">
      <legend>
        Accent{" "}
        <span className="accent-selection-name" aria-hidden="true">
          {ACCENT_NAMES[accent]}
        </span>
      </legend>
      <div className="accent-options">
        {ACCENTS.map((value) => (
          <label
            className="accent-option"
            data-accent={value}
            key={value}
            title={ACCENT_NAMES[value]}
          >
            <input
              type="radio"
              name={name}
              aria-label={ACCENT_NAMES[value]}
              value={value}
              checked={accent === value}
              onChange={() => onChange(value)}
            />
            <span className="accent-swatch" aria-hidden="true">
              <CheckIcon />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
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
        <h2 id="project-dialog-title">
          {editing ? "Edit project" : "Create project"}
        </h2>
        <form className="project-settings-fields" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="project-title">
            Project name
          </label>
          <input
            id="project-title"
            className="text-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            required
          />

          <ProjectAccentPicker
            accent={accent}
            onChange={setAccent}
            name="accent"
          />

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {!editing && (
              <p className="field-help">More settings in Edit project.</p>
            )}
            <div className="dialog-action-buttons">
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
                {saving
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Create project"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </dialog>
  );
}

function SubthreadForm({
  source,
  onCancel,
  onSubmit,
}: {
  source: { chatId: string; sourceNoteId?: string };
  onCancel: () => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const dialogRef = useModalDialog();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <dialog
      ref={dialogRef}
      open
      className="dialog-backdrop"
      aria-labelledby="subthread-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onCancel();
      }}
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) onCancel();
      }}
    >
      <section className="project-dialog">
        <h2 id="subthread-dialog-title">
          {source.sourceNoteId ? "Continue in subthread" : "New subthread"}
        </h2>
        <form
          className="project-settings-fields"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving) return;
            setSaving(true);
            setError("");
            try {
              await onSubmit(title.trim());
            } catch (caught) {
              setError(
                errorMessage(caught, "The subthread could not be created."),
              );
              setSaving(false);
            }
          }}
        >
          <label className="field-label" htmlFor="subthread-title">
            Subthread name
          </label>
          <input
            id="subthread-title"
            className="text-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            required
            disabled={saving}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <div className="dialog-action-buttons">
              <button
                className="button button-quiet"
                type="button"
                onClick={onCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={saving || !title.trim()}
              >
                {saving ? "Creating…" : "Create subthread"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </dialog>
  );
}

function confirmChatDeletion(chat: Chat): boolean {
  const contents = chat.projectId
    ? "messages and files"
    : "subthreads, messages and files";
  return window.confirm(`Delete "${chat.title}" and all of its ${contents}?`);
}

function ProjectEditWorkspace({
  chat,
  onBack,
  onSubmit,
  mutationPending,
}: {
  chat: ChatDetail;
  mutationPending: boolean;
  onBack: () => void;
  onSubmit: (input: {
    title: string;
    accent?: Accent;
    labelConfiguration: LabelConfiguration;
    collapseLongMessages: boolean;
  }) => Promise<void>;
}) {
  const isSubthread = Boolean(chat.projectId);
  const kind = isSubthread ? "subthread" : "project";
  const [title, setTitle] = useState(chat.title);
  const [accent, setAccent] = useState<Accent>(chat.accent);
  const [labelDrafts, setLabelDrafts] = useState<LabelDraft[]>(() =>
    withLabelPlaceholder(
      projectLabels(chat).map(({ id, name, symbol, enabled }) => ({
        key: id,
        id,
        name,
        symbol,
        enabled,
      })),
    ),
  );
  const [labelRevision] = useState(chat.labelConfigurationRevision ?? 0);
  const [showLabelErrors, setShowLabelErrors] = useState(false);
  const [collapseLongMessages, setCollapseLongMessages] = useState(
    chat.collapseLongMessages ?? true,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      setShowLabelErrors(true);
      const config = labelConfigurationSchema.safeParse(
        labelConfiguration(labelDrafts, labelRevision),
      );
      if (!config.success)
        throw new Error(
          config.error.issues[0]?.message ?? "Check the label fields.",
        );
      await onSubmit({
        title,
        ...(isSubthread ? {} : { accent }),
        labelConfiguration: config.data,
        collapseLongMessages,
      });
    } catch (caught) {
      setError(errorMessage(caught, "The project could not be saved."));
      setSaving(false);
    }
  }

  return (
    <main
      className="workspace settings-workspace project-edit-workspace"
      aria-label={`Edit ${kind}`}
      data-accent={accent}
    >
      <form
        className="project-edit-form project-settings-fields"
        onSubmit={handleSubmit}
      >
        <button
          className="settings-back-button"
          type="button"
          aria-label="Back to project"
          onClick={onBack}
          disabled={saving || mutationPending}
        >
          <ArrowLeftIcon />
        </button>
        <div>
          <label className="field-label" htmlFor="project-edit-name">
            {isSubthread ? "Subthread name" : "Project name"}
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
        </div>
        {!isSubthread && (
          <ProjectAccentPicker
            accent={accent}
            onChange={setAccent}
            name="project-edit-accent"
          />
        )}
        <ProjectLabelsEditor
          labels={labelDrafts}
          onChange={setLabelDrafts}
          glyph={(label) => <LabelGlyph label={label} />}
          showErrors={showLabelErrors}
          disabled={saving || mutationPending}
        />
        <fieldset
          className="project-message-display-fieldset"
          aria-describedby="project-message-display-help"
        >
          <legend>Message display</legend>
          <label className="project-message-display-option">
            <span>Collapse long messages by default</span>
            <input
              type="checkbox"
              checked={collapseLongMessages}
              onChange={(event) =>
                setCollapseLongMessages(event.target.checked)
              }
            />
          </label>
          <p id="project-message-display-help" className="field-help">
            You can still expand or collapse each message.
          </p>
        </fieldset>
        {error && (
          <p id="project-edit-error" role="alert" className="form-error">
            {error}
          </p>
        )}
        <button
          className="button button-primary project-edit-save"
          type="submit"
          aria-describedby={error ? "project-edit-error" : undefined}
          disabled={saving || mutationPending}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>
    </main>
  );
}

type RailAction = "alert" | "pin" | "archive" | "delete";

function usesMouseHover(pointerType: string): boolean {
  return (
    pointerType === "mouse" &&
    window.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true
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
  expandedProjects,
  onSelect,
  onAction,
  onTemporalBoundary,
  onCreate,
  onSettings,
  navigationDisabled,
  railErrors,
  projectMutationIds,
}: {
  homeUtilities?: ReactNode;
  onHome: () => void;
  examplesSection?: ReactNode;
  collapsedSections: Record<RailSection, boolean>;
  onToggleSection: (section: RailSection) => void;
  chats: Chat[];
  activeId?: string;
  expandedProjects: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onAction: (chat: Chat, action: RailAction, section: RailSection) => void;
  onTemporalBoundary: () => void;
  onCreate: () => void;
  onSettings: () => void;
  navigationDisabled: boolean;
  railErrors: Record<string, string>;
  projectMutationIds: ReadonlySet<string>;
}) {
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const [shortcutsId, setShortcutsId] = useState<string>();
  const [hoveredRow, setHoveredRow] = useState<string>();
  const focusShortcuts = useRef<string | undefined>(undefined);
  const pointerFocus = useRef(false);
  useEffect(() => {
    // A Tab from elsewhere in the workspace can be the next entry into the rail.
    const useKeyboardFocus = () => {
      pointerFocus.current = false;
    };
    document.addEventListener("keydown", useKeyboardFocus, true);
    return () =>
      document.removeEventListener("keydown", useKeyboardFocus, true);
  }, []);
  useLayoutEffect(() => {
    if (!shortcutsId || focusShortcuts.current !== shortcutsId) return;
    focusShortcuts.current = undefined;
    document
      .getElementById(`shortcuts-${shortcutsId}`)
      ?.querySelector<HTMLButtonElement>("button:enabled")
      ?.focus();
  }, [shortcutsId]);
  useEffect(() => {
    if (!shortcutsId) return;
    function dismissOutside(event: PointerEvent) {
      if (
        !(event.target instanceof Element) ||
        event.target.closest<HTMLElement>("[data-project-row]")?.dataset
          .projectRow !== shortcutsId
      )
        setShortcutsId(undefined);
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [shortcutsId]);
  const boundaryCallback = useRef(onTemporalBoundary);
  const handledTemporalKey = useRef("");
  const pinned = chats.filter(
    (chat) =>
      !chat.projectId && chat.archivedAt == null && chat.pinnedAt != null,
  );
  const projects = chats.filter(
    (chat) =>
      !chat.projectId && chat.archivedAt == null && chat.pinnedAt == null,
  );
  const archived = chats.filter(
    (chat) =>
      chat.archivedAt != null &&
      (!chat.projectId ||
        chats.find((root) => root.id === chat.projectId)?.archivedAt == null),
  );
  const temporalKey = chats
    .map((chat) => `${chat.id}:${chat.nextAttentionAt ?? ""}`)
    .join("\u0000");
  const schedulingNow = now;
  const dueTemporalKey = chats.some(
    (chat) =>
      chat.nextAttentionAt != null && chat.nextAttentionAt <= schedulingNow,
  )
    ? temporalKey
    : "";
  const nextMidnight = new Date(schedulingNow);
  nextMidnight.setHours(24, 0, 0, 0);
  const temporalBoundary = Math.min(
    nextMidnight.getTime(),
    ...chats
      .map((chat) => chat.nextAttentionAt)
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

  function renderRow(chat: Chat, section: RailSection) {
    const attention = projectAttentionState(chat, now);
    const error = railErrors[chat.id];
    const isPinned = chat.pinnedAt != null;
    const isArchived = chat.archivedAt != null;
    const rowKey = `${section}-${chat.id}`;
    const open = shortcutsId === chat.id || hoveredRow === rowKey;
    const visibleAttention = chat.manualAlert ? "today" : attention;
    function revealOnFocus() {
      if (!pointerFocus.current) setShortcutsId(chat.id);
    }
    const shortcutsLabel = `Shortcuts for ${chat.title}`;
    const actionButton = (
      action: RailAction,
      name: string,
      icon: ReactNode,
      pressed?: boolean,
    ) => (
      <button
        type="button"
        className="project-shortcut"
        data-project-action={action}
        aria-label={name}
        title={action === "pin" && pressed ? `Unpin ${chat.title}` : name}
        aria-pressed={pressed}
        aria-describedby={error ? errorId : undefined}
        disabled={navigationDisabled || projectMutationIds.has(chat.id)}
        onClick={() => onAction(chat, action, section)}
      >
        {icon}
      </button>
    );
    const statusId = `project-status-${chat.id}`;
    const errorId = `project-action-error-${chat.id}`;
    return (
      <li
        className={`project-row ${chat.projectId ? "project-row--subthread" : ""} ${activeId === chat.id ? "project-row--active" : ""} ${error ? "project-row--error" : ""}`}
        data-accent={chat.accent}
        data-attention-state={attention}
        data-project-row={chat.id}
        data-shortcuts-open={open}
        key={chat.id}
        onPointerEnter={(event) => {
          if (usesMouseHover(event.pointerType)) setHoveredRow(rowKey);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse")
            setHoveredRow((current) =>
              current === rowKey ? undefined : current,
            );
        }}
        onPointerDownCapture={(event) => {
          // Touch and pen focus must not move the title before activation.
          pointerFocus.current = true;
          if (usesMouseHover(event.pointerType)) setShortcutsId(undefined);
        }}
        onBlur={(event) => {
          if (
            event.relatedTarget &&
            !event.currentTarget.contains(event.relatedTarget)
          )
            setShortcutsId((current) =>
              current === chat.id ? undefined : current,
            );
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.currentTarget
              .querySelector<HTMLButtonElement>(".project-item")
              ?.focus();
            setShortcutsId(undefined);
            setHoveredRow(undefined);
            event.stopPropagation();
          }
        }}
      >
        <button
          className={`project-item ${activeId === chat.id ? "project-item--active" : ""}`}
          data-chat-id={chat.id}
          type="button"
          aria-label={`Open ${chat.title}`}
          aria-describedby={`${statusId}${error ? ` ${errorId}` : ""}`}
          aria-expanded={
            !chat.projectId &&
            chats.some((child) => child.projectId === chat.id)
              ? expandedProjects.has(chat.id)
              : undefined
          }
          aria-current={activeId === chat.id ? "page" : undefined}
          disabled={navigationDisabled}
          onFocus={revealOnFocus}
          onClick={() => onSelect(chat.id)}
        >
          <span className="project-item-copy">
            <strong title={chat.title}>{chat.title}</strong>
            {chat.projectId && isArchived && (
              <small>
                {chats.find((root) => root.id === chat.projectId)?.title}
              </small>
            )}
            {error && <small>{error}</small>}
          </span>
        </button>
        <div
          className="project-shortcuts"
          role="group"
          aria-label={shortcutsLabel}
          id={`shortcuts-${chat.id}`}
          onFocus={revealOnFocus}
          hidden={!open}
        >
          {actionButton(
            "alert",
            `Alert ${chat.title}`,
            <span
              className={`attention-dot attention-dot--${chat.manualAlert ? "today" : "earlier"}`}
              aria-hidden="true"
            />,
            Boolean(chat.manualAlert),
          )}
          {!isArchived &&
            actionButton("pin", `Pin ${chat.title}`, <PinIcon />, isPinned)}
          {actionButton(
            "archive",
            isArchived
              ? `Restore ${chat.title} from archive`
              : `Archive ${chat.title}`,
            <ArchiveRestoreIcon />,
          )}
          {actionButton("delete", `Delete ${chat.title}`, <TrashIcon />)}
        </div>
        <button
          type="button"
          className="project-shortcuts-disclosure"
          aria-label={shortcutsLabel}
          aria-controls={`shortcuts-${chat.id}`}
          aria-expanded={open}
          disabled={navigationDisabled}
          onClick={() => {
            if (open) {
              setShortcutsId(undefined);
              setHoveredRow(undefined);
            } else {
              focusShortcuts.current = chat.id;
              setShortcutsId(chat.id);
            }
          }}
        >
          {visibleAttention && !open ? (
            <span
              className={`attention-dot attention-dot--${visibleAttention} project-attention-dot`}
              aria-hidden="true"
            />
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h.1M12 12h.1M19 12h.1" strokeWidth="3.5" />
            </svg>
          )}
        </button>
        <span className="visually-hidden" id={statusId}>
          {isArchived
            ? "Archived project. "
            : isPinned
              ? "Pinned project. "
              : ""}
          {chat.manualAlert && "Manual alert. "}
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
  }

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
        </button>
        <ul
          className="project-items"
          id={`rail-items-${label}`}
          hidden={collapsedSections[label]}
        >
          {items.map((chat) => {
            const children = sortChats(
              chats.filter(
                (child) =>
                  child.projectId === chat.id &&
                  (chat.archivedAt != null || child.archivedAt == null),
              ),
            );
            const expanded = expandedProjects.has(chat.id);
            const all = showAll.has(chat.id);
            let visible = all ? children : children.slice(0, 5);
            const selected = children.find((child) => child.id === activeId);
            if (!all && selected && !visible.includes(selected))
              visible = [...visible.slice(0, 4), selected];
            return (
              <Fragment key={chat.id}>
                {renderRow(chat, label)}
                {expanded && visible.map((child) => renderRow(child, label))}
                {expanded && children.length > 5 && (
                  <li className="subthread-disclosure-row">
                    <button
                      type="button"
                      className="subthread-disclosure"
                      aria-label={
                        all ? "Show fewer subthreads" : "Show all subthreads"
                      }
                      aria-expanded={all}
                      onClick={() =>
                        setShowAll((current) => {
                          const next = new Set(current);
                          if (all) next.delete(chat.id);
                          else next.add(chat.id);
                          return next;
                        })
                      }
                    >
                      {all ? "Show less" : "Show all"}
                    </button>
                  </li>
                )}
              </Fragment>
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
        <button
          className="settings-icon-button"
          type="button"
          onClick={onSettings}
          aria-label="Settings"
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
        <h1>Appearance</h1>
      </header>
      <section
        className="settings-panel appearance-panel"
        aria-label="Appearance theme"
      >
        <fieldset className="theme-fieldset">
          <legend className="visually-hidden">Theme</legend>
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

function SubthreadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M6 7v10M8 15h2a8 8 0 0 0 8-7" />
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
  const definition = useContext(ProjectLabelContext).find(
    (item) => item.id === label,
  );
  if (label.startsWith("custom-"))
    return (
      <span
        className={`label-glyph ${definition?.symbol ? "label-glyph--emoji" : "label-glyph--svg"}`}
        aria-hidden="true"
      >
        {definition?.symbol ?? <LabelIcon />}
      </span>
    );
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

function MessageLabels({ labels }: { labels: Label[] }) {
  const definitions = useContext(ProjectLabelContext);
  if (labels.length === 0) return null;
  return (
    <span className="message-labels" aria-label="Message labels" role="list">
      {definitions
        .filter((definition) => labels.includes(definition.id))
        .map((definition) => {
          const label = definition.id;
          const iconOnly = ICON_ONLY_MESSAGE_LABELS.has(label);
          return (
            <span
              className={`message-label ${iconOnly ? "message-label--icon-only" : ""}`}
              data-label={label}
              aria-label={iconOnly ? labelDisplayName(definition) : undefined}
              title={iconOnly ? labelDisplayName(definition) : undefined}
              role="listitem"
              key={label}
            >
              <LabelGlyph label={label} />
              {!iconOnly && (
                <span className="message-label-name">
                  {labelDisplayName(definition)}
                </span>
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
  const definitions = useContext(ProjectLabelContext);
  const labelName = (id: Label) =>
    labelDisplayName(
      definitions.find((item) => item.id === id) ?? { id, name: id },
    );
  const explainReadOnly = useContext(ExampleReadOnlyContext);
  const [busyLabel, setBusyLabel] = useState<Label>();
  const [error, setError] = useState("");
  const appliedLabels = note.labels ?? [];
  const permanent = new Set<Label>(PERMANENT_LABELS);
  const availableLabels = definitions
    .map((label) => label.id)
    .filter(
      (label) =>
        permanent.has(label) ||
        enabledLabels.includes(label as ConfigurableLabel) ||
        appliedLabels.includes(label),
    );

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
    <MessagePopover
      label="Change labels"
      icon={<LabelIcon />}
      onBlocked={explainReadOnly}
      onOpen={() => setError("")}
    >
      {() => (
        <>
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
                    {labelName(label)}
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
        </>
      )}
    </MessagePopover>
  );
}

function MessageMoreActions({
  copied,
  onContinue,
  onSelect,
  onCopy,
  onEdit,
  onDelete,
  onOpenInHistory,
}: {
  copied: boolean;
  onContinue?: () => void;
  onSelect?: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenInHistory?: () => void;
}) {
  const explainReadOnly = useContext(ExampleReadOnlyContext);
  const items = [
    { label: "Select messages", icon: <CheckIcon />, action: onSelect },
    {
      label: "Continue in subthread",
      icon: <SubthreadIcon />,
      action: onContinue,
      blocked: explainReadOnly,
    },
    { label: "Copy message", icon: <CopyIcon />, action: onCopy },
    {
      label: "Edit message",
      icon: <EditIcon />,
      action: onEdit,
      blocked: explainReadOnly,
    },
    {
      label: "Delete message",
      icon: <TrashIcon />,
      action: onDelete,
      blocked: explainReadOnly,
      danger: true,
    },
    { label: "Open message in history", action: onOpenInHistory },
  ];
  return (
    <>
      <MessagePopover
        label="More message actions"
        menu
        icon={
          copied ? (
            <CheckIcon />
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h1m6.5 0h1m6.5 0h1" strokeWidth="3" />
            </svg>
          )
        }
      >
        {() =>
          items.map(
            ({ label, icon, action, blocked, danger }) =>
              action && (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={`message-menu-item ${danger ? "message-menu-item--danger" : ""}`}
                  aria-disabled={blocked ? true : undefined}
                  aria-describedby={blocked ? "example-notice" : undefined}
                  onClick={blocked ?? action}
                >
                  {icon}
                  {label}
                </button>
              ),
          )
        }
      </MessagePopover>
      {copied && (
        <span className="visually-hidden" role="status">
          Message copied
        </span>
      )}
    </>
  );
}

function syncClippedMessageFocus(
  bodyElement: HTMLDivElement,
  collapsed: boolean,
) {
  const clipBottom =
    bodyElement.getBoundingClientRect().top + MESSAGE_COLLAPSED_HEIGHT_PX;
  for (const control of bodyElement.querySelectorAll<HTMLElement>(
    "a, input[type=checkbox]",
  )) {
    const clipped =
      collapsed && control.getBoundingClientRect().bottom > clipBottom;
    if (clipped) {
      control.dataset.messageClippedControl = "true";
      control.tabIndex = -1;
    } else if (control.dataset.messageClippedControl === "true") {
      delete control.dataset.messageClippedControl;
      control.removeAttribute("tabindex");
    }
  }
  for (const table of bodyElement.querySelectorAll<HTMLDivElement>(
    ".message-table-scroll",
  )) {
    table.tabIndex =
      collapsed && table.getBoundingClientRect().bottom > clipBottom ? -1 : 0;
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
  searchTerms,
  collapseLongMessages,
  onTaskChange,
}: {
  onTaskChange?: (body: string) => Promise<void>;
  body: string;
  searchTerms: string[];
  collapseLongMessages: boolean;
}) {
  const contentId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isLong, setIsLong] = useState(false);
  const [expanded, setExpanded] = useState(!collapseLongMessages);
  const collapsed = isLong && !expanded;
  const inFlight = useRef(false);
  const [savingTask, setSavingTask] = useState<{
    original: string;
    updated: string;
  }>();
  const [taskError, setTaskError] = useState("");
  async function changeTask(nextBody: string) {
    if (!onTaskChange || inFlight.current) return;
    inFlight.current = true;
    setSavingTask({ original: body, updated: nextBody });
    setTaskError("");
    try {
      await onTaskChange(nextBody);
    } catch (caught) {
      setTaskError(errorMessage(caught, "The task could not be saved."));
    } finally {
      inFlight.current = false;
      setSavingTask(undefined);
    }
  }

  useLayoutEffect(() => {
    const bodyElement = bodyRef.current;
    if (!bodyElement) return;
    const nextIsLong = bodyElement.scrollHeight > MESSAGE_COLLAPSED_HEIGHT_PX;
    setIsLong((current) => (current === nextIsLong ? current : nextIsLong));
    syncClippedMessageFocus(bodyElement, nextIsLong && !expanded);
    return () => syncClippedMessageFocus(bodyElement, false);
  }, [body, expanded]);

  useEffect(() => {
    const bodyElement = bodyRef.current;
    if (!bodyElement) return;
    const measure = () => {
      const nextIsLong = bodyElement.scrollHeight > MESSAGE_COLLAPSED_HEIGHT_PX;
      setIsLong((current) => (current === nextIsLong ? current : nextIsLong));
      syncClippedMessageFocus(bodyElement, nextIsLong && !expanded);
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
          <MarkdownMessage
            body={savingTask?.original === body ? savingTask.updated : body}
            searchTerms={searchTerms}
            pending={Boolean(savingTask)}
            onChange={onTaskChange && changeTask}
          />
        </div>
      </div>
      {taskError && (
        <p role="alert" className="attachment-action-error">
          {taskError}
        </p>
      )}
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
  pictureLoads,
  note,
  searchTerms,
  onAction,
}: {
  pictureLoads: PictureLoadQueue;
  note: Note;
  searchTerms: string[];
  onAction: (
    note: Note,
    attachmentId: string,
    action: "open" | "reveal",
  ) => Promise<void>;
}) {
  const explainReadOnly = useContext(ExampleReadOnlyContext);
  // A restored backup can reuse every ID, size and timestamp from an earlier visit.
  const previewVisit = useId();
  const [busyAction, setBusyAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  if (!note.attachments?.length) return null;

  const candidates = note.attachments.filter(
    (attachment) =>
      !explainReadOnly &&
      (attachment.status ?? "available") === "available" &&
      picturePreviewMediaType(attachment.filename),
  );
  const multiplePictures =
    candidates.filter(
      (attachment) => attachment.byteSize <= MAX_PICTURE_PREVIEW_BYTES,
    ).length > 1;

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
    <div
      className={`attachment-list${multiplePictures ? " attachment-list--pictures" : ""}`}
      aria-label="Message attachments"
    >
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
        const picture = candidates.includes(attachment);
        const oversized =
          picture && attachment.byteSize > MAX_PICTURE_PREVIEW_BYTES;
        const previewSource =
          picture && !oversized
            ? `${attachmentPath(note.chatId, note.id, attachment.id, "preview")}?v=${modifiedAt}-${attachment.byteSize}-${encodeURIComponent(previewVisit)}`
            : undefined;
        return (
          <div className="attachment-card" key={attachment.id}>
            {previewSource && (
              <PicturePreview
                key={previewSource + (multiplePictures ? ":compact" : "")}
                compact={multiplePictures}
                filename={attachment.filename}
                source={previewSource}
                queue={pictureLoads}
              />
            )}
            {(!previewSource || !multiplePictures) && (
              <span className="attachment-type" aria-hidden="true">
                {fileTypeLabel(attachment.filename, attachment.mediaType)}
              </span>
            )}
            <span className="attachment-copy">
              <strong>
                <HighlightText text={attachment.filename} terms={searchTerms} />
              </strong>
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
              {oversized && (
                <small className="attachment-status--warning">
                  Image is too large to preview.
                </small>
              )}
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

type TimelinePosition = Pick<Note, "id" | "createdAt"> & {
  positionId?: string;
};

function compareTimelinePosition(a: TimelinePosition, b: TimelinePosition) {
  const aKey = a.positionId ?? a.id;
  const bKey = b.positionId ?? b.id;
  return a.createdAt - b.createdAt || (aKey < bKey ? -1 : aKey > bKey ? 1 : 0);
}

function MessageGroups({
  gradient,
  notes,
  searchTerms,
  futureStartId,
  enabledLabels,
  collapseLongMessages,
  copiedNoteId,
  onAttachmentAction,
  onCopyNote,
  onDeleteNote,
  onEditNote,
  onSetNoteLabel,
  onTaskChange,
  onOpenInHistory,
  onContinue,
  onStartSelection,
  selected,
  onToggleSelected,
  selectionLocked,
  subthreads = [],
  showDetachedContinuations = true,
  onNavigate,
}: {
  gradient: boolean;
  onContinue?: (note: Note) => void;
  onStartSelection?: (note: Note) => void;
  selected?: ReadonlySet<string>;
  onToggleSelected: (id: string, extendRange?: boolean) => void;
  selectionLocked: boolean;
  subthreads?: Chat[];
  showDetachedContinuations?: boolean;
  onNavigate?: (
    chatId: string,
    noteId?: string,
    fallback?: ReadingPosition,
  ) => void;
  notes: Note[];
  searchTerms: string[];
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
  onTaskChange?: (note: Note, body: string) => Promise<void>;
  onOpenInHistory?: (note: Note) => void;
}) {
  const definitions = useContext(ProjectLabelContext);
  const [pictureLoads] = useState(() => new PictureLoadQueue());
  type Continuation = {
    id: string;
    createdAt: number;
    positionId: string;
    continuation: Chat;
  };
  const entries: (Note | Continuation)[] = [...notes];
  if (showDetachedContinuations) {
    for (const child of subthreads) {
      if (
        child.origin?.sourceNoteId == null &&
        child.origin?.sourceNoteCreatedAt != null
      ) {
        entries.push({
          id: `continuation:${child.id}`,
          createdAt: child.origin.sourceNoteCreatedAt,
          positionId: child.origin.sourceNotePositionId ?? child.id,
          continuation: child,
        });
      }
    }
  }
  if (entries.length > notes.length) entries.sort(compareTimelinePosition);

  function shiftRangeTarget(event: MouseEvent<HTMLElement>) {
    if (!selected || selectionLocked || !event.shiftKey || event.button !== 0)
      return;
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest(
        "a, button, dialog, input, label, select, textarea, summary, [tabindex='0']",
      )
    )
      return;
    return target.closest<HTMLElement>(".message-row");
  }

  return (
    <SharedMessageGradient
      active={gradient}
      className="message-groups"
      onMouseDown={(event) => {
        // Shift-clicking text can otherwise also extend the browser's text selection.
        if (shiftRangeTarget(event)) event.preventDefault();
      }}
      onClick={(event) => {
        const row = shiftRangeTarget(event);
        if (row?.dataset.noteId) {
          row
            .querySelector<HTMLElement>("[data-select-note]")
            ?.focus({ preventScroll: true });
          onToggleSelected(row.dataset.noteId, true);
        }
      }}
    >
      {groupNotesByDay(entries).map((group) => {
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
                if ("continuation" in note)
                  return (
                    <li
                      key={note.id}
                      className="thread-origin thread-continuation"
                      data-note-id={note.id}
                      data-created-at={note.createdAt}
                      tabIndex={-1}
                      style={{ gridRow: noteIndex + 1, gridColumn: "1 / -1" }}
                    >
                      Continued in{" "}
                      <button
                        type="button"
                        onClick={() => onNavigate?.(note.continuation.id)}
                      >
                        {note.continuation.title}
                      </button>
                    </li>
                  );
                const copied = copiedNoteId === note.id;
                const participant = Boolean(note.sender);
                return (
                  <ProjectLabelContext.Provider
                    key={note.id}
                    value={
                      note.labelSnapshots?.length
                        ? definitions.concat(note.labelSnapshots)
                        : definitions
                    }
                  >
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
                      tabIndex={-1}
                      data-selected={
                        selected ? selected.has(note.id) : undefined
                      }
                      className={`message-row ${participant ? "message-row--participant" : "message-row--own"}`}
                      style={{ gridRow: noteIndex + 1 }}
                    >
                      {selected && (
                        <label className="message-selection-check">
                          <input
                            type="checkbox"
                            data-select-note={note.id}
                            aria-label={`Select message: ${note.body.trim().slice(0, 90) || note.attachments?.[0]?.filename || formatMessageTime(note.createdAt)}`}
                            checked={selected.has(note.id)}
                            disabled={selectionLocked}
                            aria-keyshortcuts="Shift+Space"
                            onChange={(event) =>
                              onToggleSelected(
                                note.id,
                                "shiftKey" in event.nativeEvent &&
                                  event.nativeEvent.shiftKey === true,
                              )
                            }
                            onKeyDown={(event) => {
                              if (event.key === " " && event.shiftKey) {
                                event.preventDefault();
                                if (!event.repeat)
                                  onToggleSelected(note.id, true);
                              }
                            }}
                          />
                        </label>
                      )}
                      <div className="message-stack">
                        <article className="message-bubble">
                          {note.sender && (
                            <p
                              className="message-sender"
                              data-sender-color={senderColor(note.sender)}
                            >
                              <HighlightText
                                text={note.sender}
                                terms={searchTerms}
                              />
                            </p>
                          )}
                          <AttachmentList
                            pictureLoads={pictureLoads}
                            searchTerms={searchTerms}
                            note={note}
                            onAction={onAttachmentAction}
                          />
                          <CollapsibleMessageBody
                            searchTerms={searchTerms}
                            key={String(collapseLongMessages)}
                            body={note.body}
                            onTaskChange={
                              onTaskChange && !selected
                                ? (body) => onTaskChange(note, body)
                                : undefined
                            }
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
                        {!selected && (
                          <div
                            className="message-actions"
                            aria-label="Message actions"
                          >
                            <MessageLabelPicker
                              note={note}
                              enabledLabels={enabledLabels}
                              onToggle={onSetNoteLabel}
                            />
                            <MessageMoreActions
                              copied={copied}
                              onContinue={
                                onContinue && (() => onContinue(note))
                              }
                              onSelect={
                                onStartSelection &&
                                (() => onStartSelection(note))
                              }
                              onCopy={() => onCopyNote(note)}
                              onEdit={() => onEditNote(note)}
                              onDelete={() => onDeleteNote(note)}
                              onOpenInHistory={
                                onOpenInHistory && (() => onOpenInHistory(note))
                              }
                            />
                          </div>
                        )}
                      </div>
                      {subthreads
                        .filter(
                          (child) => child.origin?.sourceNoteId === note.id,
                        )
                        .map((child) => (
                          <div
                            className="thread-origin thread-continuation"
                            key={child.id}
                          >
                            Continued in{" "}
                            <button
                              type="button"
                              onClick={() => onNavigate?.(child.id)}
                            >
                              {child.title}
                            </button>
                          </div>
                        ))}
                    </li>
                  </ProjectLabelContext.Provider>
                );
              })}
            </ol>
          </section>
        );
      })}
    </SharedMessageGradient>
  );
}

function ChatWorkspace({
  alwaysShowMessageTime,
  chats = [],
  projectApi,
  onBatchNotes,
  onNewSubthread,
  subthreadBusy = false,
  onNavigate,
  navigationTarget,
  onSearchDestinationOpened,
  onOpenSearchResult,
  onTaskChange,
  sendFeedback,
  exampleCopyAction,
  exampleError,
  exampleGlow = false,
  readingPositions,
  searchQueries,
  detail,
  draft,
  draftSender,
  draftTimestamp,
  error,
  editingNote,
  editingAttachmentIds,
  pendingFiles,
  draftNotice,
  draftLocked = false,
  uploadFailed = false,
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
  alwaysShowMessageTime: boolean;
  chats?: Chat[];
  projectApi?: Pick<ApiClient, "getProject">;
  onBatchNotes?: (input: BatchNotesInput) => Promise<void>;
  onNewSubthread?: (sourceNoteId?: string) => void;
  subthreadBusy?: boolean;
  onNavigate?: (
    chatId: string,
    noteId?: string,
    fallback?: ReadingPosition,
  ) => void;
  navigationTarget?: ReadingPosition & { fromSearch?: boolean };
  onOpenSearchResult?: (chatId: string, noteId: string) => void;
  onSearchDestinationOpened?: () => void;
  onTaskChange?: (note: Note, body: string) => Promise<void>;
  sendFeedback?: SendFeedback;
  readingPositions: Map<string, ReadingPosition>;
  searchQueries: Map<string, string>;
  detail: TimelineContent & Pick<Chat, "projectId" | "origin">;
  exampleCopyAction?: ReactNode;
  exampleError?: ReactNode;
  exampleGlow?: boolean;
  draft: string;
  draftSender: string;
  draftTimestamp: string;
  error: string;
  editingNote?: Note;
  editingAttachmentIds: string[];
  pendingFiles: ComposerFile[];
  draftNotice?: ReactNode;
  draftLocked?: boolean;
  uploadFailed?: boolean;
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
  const definitions = projectLabels(detail);
  const labelName = (id: Label) =>
    labelDisplayName(
      definitions.find((item) => item.id === id) ?? { id, name: id },
    );
  const explainReadOnly = useContext(ExampleReadOnlyContext);
  const historyRef = useRef<HTMLElement>(null);
  const historyKey = filterKey(historyFilter);
  const filterPointer = useRef("");
  const applePlatform = isApplePlatform(
    navigator.platform || navigator.userAgent,
  );
  const filterHelpId = useId();
  const filterName = (filter: FilterId) =>
    filter === "attachments"
      ? "Files"
      : filter === "links"
        ? "Links"
        : labelName(filter.slice(6) as Label);
  const filterDescription = historyFilter.length
    ? historyFilter.map(filterName).join(" + ")
    : "All messages";
  const isSelected = (filter: FilterId | "all") =>
    filter === "all" ? !historyFilter.length : historyFilter.includes(filter);
  const [searchOpen, setSearchOpen] = useState(false);
  const [projectScope, setProjectScope] = useState(false);
  const [projectConversations, setProjectConversations] = useState<
    ChatDetail[]
  >([]);
  const [projectSearchError, setProjectSearchError] = useState("");
  const [projectSearchLoading, setProjectSearchLoading] = useState(false);
  const [projectSearchRetry, setProjectSearchRetry] = useState(0);
  const projectSearchActive = projectScope && searchOpen;
  const root = chats.find((chat) => chat.id === detail.projectId);
  const source = chats.find((chat) => chat.id === detail.origin?.sourceChatId);
  useEffect(() => {
    if (!projectSearchActive || !projectApi) return;
    let current = true;
    Promise.resolve()
      .then(() => {
        if (!current) return [];
        setProjectSearchLoading(true);
        setProjectSearchError("");
        return projectApi.getProject(detail.id);
      })
      .then((result) => {
        if (current) setProjectConversations(result);
      })
      .catch((caught) => {
        if (current)
          setProjectSearchError(
            errorMessage(caught, "Project search could not be loaded."),
          );
      })
      .finally(() => {
        if (current) setProjectSearchLoading(false);
      });
    return () => {
      current = false;
    };
  }, [
    projectApi,
    detail.id,
    detail.notes,
    chats,
    projectSearchActive,
    projectSearchRetry,
  ]);
  const [searchText, setSearchText] = useState(
    () => searchQueries.get(detail.id) ?? "",
  );
  const searchQuery = useMemo(
    () => parseSearchQuery(searchOpen ? searchText : ""),
    [searchOpen, searchText],
  );
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  const clearDestination = useRef<() => void>(() => {});
  const highlightDestination = useCallback((row: HTMLElement) => {
    clearDestination.current();
    row.setAttribute("data-search-destination", "");
    const timer = window.setTimeout(
      () => row.removeAttribute("data-search-destination"),
      900,
    );
    clearDestination.current = () => {
      window.clearTimeout(timer);
      row.removeAttribute("data-search-destination");
    };
  }, []);
  useLayoutEffect(() => () => clearDestination.current(), []);
  const beforeFilterChange = useHistoryPosition(
    historyRef,
    detail.id,
    historyKey,
    readingPositions,
    Boolean(explainReadOnly),
    `${projectSearchActive ? "project:" : ""}${searchQuery.key}`,
    highlightDestination,
  );
  useLayoutEffect(() => {
    if (!navigationTarget) return;
    const frame = requestAnimationFrame(() => {
      const history = historyRef.current;
      if (!history) return;
      restoreReadingPosition(history, navigationTarget);
      const row = [
        ...history.querySelectorAll<HTMLElement>("[data-note-id]"),
      ].find((item) => item.dataset.noteId === navigationTarget.noteId);
      row?.focus({ preventScroll: true });
      if (navigationTarget.fromSearch) {
        if (row) highlightDestination(row);
        onSearchDestinationOpened?.();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [navigationTarget, highlightDestination, onSearchDestinationOpened]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  useSendFeedback(composerRef, historyRef, sendFeedback);
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
  const analyzeNotes = useMemo(() => createSearchDocumentBuilder(), []);
  const searchNotes = useMemo(
    () =>
      projectSearchActive
        ? projectConversations.flatMap((conversation) => conversation.notes)
        : detail.notes,
    [projectSearchActive, projectConversations, detail.notes],
  );
  const searchDocuments = useMemo(
    () => analyzeNotes(searchNotes),
    [searchNotes, analyzeNotes],
  );
  const linkedNoteIds = new Set(
    searchNotes
      .filter((note) => searchDocuments.get(note.id)!.hasLinks)
      .map((note) => note.id),
  );
  const attachmentCount = searchNotes.filter(hasAttachments).length;
  const enabledLabels = detail.enabledLabels ?? ["todo", "milestone"];
  const filterLabels = definitions
    .filter((label) => label.enabled)
    .map((label) => label.id);
  const searchMatches = searchNotes.filter((note) =>
    matchesSearch(searchDocuments.get(note.id)!, searchQuery),
  );
  const visibleNotes = searchMatches
    .filter((note) => {
      return historyFilter.every((filter) => {
        if (filter === "attachments") return hasAttachments(note);
        if (filter === "links") return linkedNoteIds.has(note.id);
        return (note.labels ?? []).includes(filter.slice(6) as Label);
      });
    })
    .sort(compareTimelinePosition);
  const projectResults = useMemo(
    () => findProjectSearchResults(projectConversations, searchQuery),
    [projectConversations, searchQuery],
  );
  const visibleIds = new Set(visibleNotes.map((note) => note.id));
  const workspaceRef = useRef<HTMLElement>(null);
  const batch = useMessageSelection(
    historyRef,
    workspaceRef,
    visibleIds,
    onBatchNotes,
    (selected) =>
      selectedMessageSource(
        detail.projectId
          ? [root?.title ?? "Project", detail.title]
          : [detail.title],
        visibleNotes,
        selected,
        definitions,
      ),
  );
  const canSelectMessages = Boolean(
    onBatchNotes &&
    !saving &&
    !editingNote &&
    !projectSearchActive &&
    !searchQuery.error &&
    visibleNotes.length,
  );
  const noticeDestination = batch.notice?.destination;
  const fileDrop = useComposerFileDrop(
    composerRef,
    saving || draftLocked || Boolean(explainReadOnly) || Boolean(batch.stage),
    onFilesSelected,
  );
  const timelineNow = useTimelineNow(visibleNotes);
  const futureStartId = visibleNotes.find(
    (note) => note.createdAt > timelineNow,
  )?.id;
  const showingEmptyFilter =
    historyFilter.length > 0 && visibleNotes.length === 0;
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

    if (
      event.key === "Enter" &&
      !event.nativeEvent.isComposing &&
      !event.repeat &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      submitDraft();
    }
  }

  function changeHistoryFilter(
    filter: FilterId | "all",
    event?: {
      metaKey: boolean;
      ctrlKey: boolean;
      nativeEvent?: Event;
      detail?: number;
    },
  ) {
    // WebKit may expose a compatibility MouseEvent for a touch-generated click.
    const touch = event?.detail !== 0 && filterPointer.current === "touch";
    filterPointer.current = "";
    const next = selectFilter(
      historyFilter,
      filter,
      Boolean(
        event &&
        (additiveModifier(event, applePlatform) ||
          touch ||
          (event.nativeEvent as PointerEvent | undefined)?.pointerType ===
            "touch"),
      ),
    );
    if (filterKey(next) !== historyKey) batch.clearOnFilter();
    beforeFilterChange(filterKey(next));
    onHistoryFilterChange(next);
  }

  function filterKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    filter: FilterId | "all",
  ) {
    if (
      (event.key === "Enter" || event.key === " ") &&
      additiveModifier(event, applePlatform)
    ) {
      event.preventDefault();
      changeHistoryFilter(filter, event);
    }
  }

  function commitSearch(value: string) {
    if (parseSearchQuery(value).key !== searchQuery.key) batch.clearOnFilter();
    beforeFilterChange(historyKey, parseSearchQuery(value).key);
    setSearchText(value);
  }

  function rememberSearch(value: string) {
    if (value) searchQueries.set(detail.id, value);
    else searchQueries.delete(detail.id);
  }

  function openSearch() {
    batch.clearOnFilter();
    clearDestination.current();
    const searchDraft = searchQueries.get(detail.id) ?? "";
    beforeFilterChange(historyKey, parseSearchQuery(searchDraft).key);
    setSearchText(searchDraft);
    setSearchOpen(true);
  }

  function closeSearch() {
    batch.clearOnFilter();
    beforeFilterChange(historyKey, "");
    setSearchOpen(false);
    searchToggleRef.current?.focus();
  }

  function openInHistory(note: Note) {
    beforeFilterChange("all", "", {
      noteId: note.id,
      createdAt: note.createdAt,
      offset: 16,
    });
    setSearchOpen(false);
    onHistoryFilterChange([]);
  }

  return (
    <ProjectLabelContext.Provider value={definitions}>
      {batch.stage === "export" && batch.exportSource && (
        <MessageExportWorkspace
          source={batch.exportSource}
          onBack={batch.back}
          backIcon={<ArrowLeftIcon />}
        />
      )}
      {(batch.stage === "copy" || batch.stage === "move") && (
        <MessageDestinationPicker
          key={batch.stage}
          chats={chats}
          sourceId={detail.id}
          action={batch.stage}
          count={batch.selected.size}
          busy={batch.busy}
          error={batch.error}
          onBack={batch.back}
          onConfirm={(destination) => void batch.submit(destination)}
          backIcon={<ArrowLeftIcon />}
        />
      )}
      <main
        ref={workspaceRef}
        hidden={batch.isPicker}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            batch.stage &&
            !event.defaultPrevented
          ) {
            event.preventDefault();
            if (batch.stage === "delete") batch.back();
            else batch.cancel();
          }
        }}
        className={`workspace workspace-chat ${explainReadOnly ? "workspace-example" : ""} ${searchOpen ? "workspace-chat--search" : ""}`}
        data-accent={detail.accent}
      >
        <header className="chat-header" inert={batch.busy}>
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
              <h1
                className={detail.projectId ? "subthread-heading" : undefined}
                title={detail.title}
                aria-label={
                  detail.projectId
                    ? `${root?.title ?? "Project"} / ${detail.title}`
                    : detail.title
                }
              >
                {detail.projectId && (
                  <>
                    <button
                      className="subthread-parent-title"
                      type="button"
                      title={root?.title ?? "Project"}
                      onClick={() => onNavigate?.(detail.projectId!)}
                      disabled={navigationDisabled}
                    >
                      {root?.title ?? "Project"}
                    </button>
                    <span className="subthread-title-separator"> / </span>
                  </>
                )}
                <span className="conversation-title" title={detail.title}>
                  {detail.title}
                </span>
              </h1>
            </div>
            <button
              ref={searchToggleRef}
              className="project-search-toggle"
              type="button"
              aria-label="Search messages"
              title="Search messages"
              aria-expanded={searchOpen}
              aria-controls={searchOpen ? searchId : undefined}
              onClick={() => (searchOpen ? closeSearch() : openSearch())}
            >
              <SearchIcon />
            </button>
            {onNewSubthread && (
              <button
                className="project-search-toggle new-subthread-button"
                type="button"
                aria-label="New subthread"
                title="New subthread"
                disabled={navigationDisabled || subthreadBusy}
                onClick={() => onNewSubthread()}
              >
                <SubthreadIcon />
              </button>
            )}
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

        {searchOpen && (
          <ProjectSearch
            projectScope={projectScope}
            onProjectScopeChange={
              projectApi
                ? (checked) => {
                    beforeFilterChange(
                      historyKey,
                      `${checked ? "project:" : ""}${searchQuery.key}`,
                    );
                    batch.clearOnFilter();
                    setProjectScope(checked);
                  }
                : undefined
            }
            id={searchId}
            initialValue={searchText}
            onValueChange={rememberSearch}
            count={
              searchQuery.key &&
              !searchQuery.error &&
              !projectSearchLoading &&
              !projectSearchError
                ? visibleNotes.length
                : undefined
            }
            onCommit={commitSearch}
            onClose={closeSearch}
            status={
              (projectSearchActive && projectSearchLoading
                ? "Loading project messages…"
                : projectSearchActive && projectSearchError
                  ? projectSearchError
                  : undefined) ??
              searchQuery.error ??
              (searchQuery.key
                ? `${visibleNotes.length} matching messages. ${filterDescription}.`
                : "Search message text, people and filenames.")
            }
          />
        )}

        <nav
          inert={batch.busy}
          className="history-filter"
          aria-label="History filters"
          aria-describedby={filterHelpId}
          onPointerDown={(event) => {
            filterPointer.current = event.pointerType;
          }}
          onPointerCancel={() => {
            filterPointer.current = "";
          }}
        >
          <div className="history-filter-inner">
            <button
              type="button"
              className={`history-filter-button ${isSelected("all") ? "history-filter-button--active" : ""}`}
              aria-label={`All ${searchNotes.length}`}
              aria-pressed={isSelected("all")}
              onClick={(event) => changeHistoryFilter("all", event)}
              onKeyDown={(event) => filterKeyboard(event, "all")}
            >
              <span className="history-filter-icon" aria-hidden="true">
                <ListIcon />
              </span>
              <span className="history-filter-label">All</span>
              <span className="history-filter-count">{searchNotes.length}</span>
            </button>
            <button
              type="button"
              className={`history-filter-button ${isSelected("attachments") ? "history-filter-button--active" : ""}`}
              aria-label={`Files ${attachmentCount}`}
              aria-pressed={isSelected("attachments")}
              onClick={(event) => changeHistoryFilter("attachments", event)}
              onKeyDown={(event) => filterKeyboard(event, "attachments")}
            >
              <span className="history-filter-icon" aria-hidden="true">
                <PaperclipIcon />
              </span>
              <span className="history-filter-label">Files</span>
              <span className="history-filter-count">{attachmentCount}</span>
            </button>
            <button
              type="button"
              className={`history-filter-button ${isSelected("links") ? "history-filter-button--active" : ""}`}
              aria-label={`Links ${linkedNoteIds.size}`}
              aria-pressed={isSelected("links")}
              onClick={(event) => changeHistoryFilter("links", event)}
              onKeyDown={(event) => filterKeyboard(event, "links")}
            >
              <span className="history-filter-icon" aria-hidden="true">
                <LinkIcon />
              </span>
              <span className="history-filter-label">Links</span>
              <span className="history-filter-count">{linkedNoteIds.size}</span>
            </button>
            {filterLabels.map((label) => {
              const count = searchNotes.filter((note) =>
                (note.labels ?? []).includes(label),
              ).length;
              return (
                <button
                  type="button"
                  className={`history-filter-button ${isSelected(`label:${label}`) ? "history-filter-button--active" : ""}`}
                  aria-label={`${labelName(label)} ${count}`}
                  title={labelName(label)}
                  aria-pressed={isSelected(`label:${label}`)}
                  onClick={(event) =>
                    changeHistoryFilter(`label:${label}`, event)
                  }
                  onKeyDown={(event) => filterKeyboard(event, `label:${label}`)}
                  key={label}
                >
                  <span className="history-filter-icon">
                    <LabelGlyph label={label} />
                  </span>
                  <span className="history-filter-label">
                    {FILTER_LABEL_NAMES[label] ?? labelName(label)}
                  </span>
                  <span className="history-filter-count">{count}</span>
                </button>
              );
            })}
          </div>
          <p id={filterHelpId} className="history-filter-help">
            <kbd>⌘/Ctrl</kbd> + multiple
            <span className="visually-hidden">
              . Hold Command or Control while selecting filters, or tap to
              toggle on touch screens. Messages must match every selected
              filter.
            </span>
          </p>
        </nav>

        <section
          ref={historyRef}
          className="history"
          data-message-time={
            alwaysShowMessageTime ? "always" : "on-interaction"
          }
          onPointerUp={(event) => {
            if (alwaysShowMessageTime) return;
            const touch = event.pointerType === "touch";
            event.currentTarget.toggleAttribute(
              "data-touch-interaction",
              touch,
            );
            if (!touch || !(event.target instanceof Element)) return;
            if (event.target.closest("button, a, input, label, [tabindex='0']"))
              return;
            event.target
              .closest<HTMLElement>(".message-row")
              ?.focus({ preventScroll: true });
          }}
          tabIndex={-1}
          aria-label={`${detail.title} messages`}
        >
          {detail.projectId && !projectSearchActive && (
            <div className="thread-origin">
              {!detail.origin ? (
                "Independent subthread"
              ) : source ? (
                <>
                  <span>Subthread from</span>{" "}
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate?.(
                        source.id,
                        detail.origin?.sourceNoteId ?? undefined,
                        detail.origin?.sourceNoteCreatedAt != null
                          ? {
                              noteId: `continuation:${detail.id}`,
                              createdAt: detail.origin.sourceNoteCreatedAt,
                              offset: 16,
                            }
                          : undefined,
                      )
                    }
                  >
                    {source.title}
                  </button>
                  {!detail.origin.sourceNoteId && " · Original message deleted"}
                </>
              ) : (
                "Subthread from a deleted conversation"
              )}
            </div>
          )}
          {projectSearchActive && projectSearchLoading ? (
            <p className="thread-origin" role="status">
              Loading project messages…
            </p>
          ) : projectSearchActive && projectSearchError ? (
            <div className="no-notes">
              <p role="alert">{projectSearchError}</p>
              <button
                className="button button-quiet"
                onClick={() => setProjectSearchRetry((value) => value + 1)}
              >
                Retry search
              </button>
            </div>
          ) : searchQuery.error ? (
            <div className="no-notes no-notes--filtered">
              <p role="alert">{searchQuery.error}</p>
            </div>
          ) : searchQuery.key && visibleNotes.length === 0 ? (
            <div className="no-notes no-notes--filtered">
              <h2>No matching messages</h2>
              <p>Try fewer words or clear the search.</p>
              {historyFilter.length > 0 && searchMatches.length > 0 && (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={(event) => changeHistoryFilter("all", event)}
                  onKeyDown={(event) => filterKeyboard(event, "all")}
                >
                  Search all messages
                </button>
              )}
            </div>
          ) : projectSearchActive && searchQuery.key ? (
            <ProjectSearchResults
              results={projectResults.filter((result) =>
                visibleIds.has(result.note.id),
              )}
              query={searchQuery}
              onOpen={(chatId, note) => onOpenSearchResult?.(chatId, note.id)}
            />
          ) : projectSearchActive ? (
            <div className="no-notes">
              <p>Search across this project’s conversations.</p>
            </div>
          ) : detail.notes.length === 0 &&
            !chats.some(
              (chat) =>
                chat.origin?.sourceChatId === detail.id &&
                chat.origin.sourceNoteId == null &&
                chat.origin.sourceNoteCreatedAt != null,
            ) ? (
            <>
              <div className="no-notes">
                <p className="eyebrow">The thread starts here</p>
                <h2>What is worth remembering?</h2>
                <p>
                  Record a decision, an open question, or the next concrete
                  move.
                </p>
              </div>
            </>
          ) : showingEmptyFilter ? (
            <div className="message-groups">
              <div className="no-notes no-notes--filtered">
                <p className="eyebrow">{filterDescription}</p>
                <h2>
                  No{" "}
                  {historyFilter.length === 1 && isSelected("attachments")
                    ? "attached files"
                    : historyFilter.length === 1 && isSelected("links")
                      ? "links"
                      : "matching messages"}{" "}
                  yet.
                </h2>
                <p>
                  This project slice will update when a matching message
                  appears.
                </p>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => changeHistoryFilter("all")}
                >
                  Show all messages
                </button>
              </div>
            </div>
          ) : (
            <MessageGroups
              onStartSelection={canSelectMessages ? batch.begin : undefined}
              selected={batch.stage ? batch.selected : undefined}
              onToggleSelected={batch.toggle}
              selectionLocked={batch.stage === "delete" || batch.busy}
              gradient={detail.accent.endsWith("-gradient")}
              showDetachedContinuations={
                !searchQuery.key && historyFilter.length === 0
              }
              subthreads={chats.filter(
                (chat) => chat.origin?.sourceChatId === detail.id,
              )}
              onContinue={
                onNewSubthread && !subthreadBusy
                  ? (note) => onNewSubthread(note.id)
                  : undefined
              }
              onNavigate={onNavigate}
              searchTerms={searchQuery.terms}
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
              onTaskChange={onTaskChange}
              onOpenInHistory={searchQuery.key ? openInHistory : undefined}
            />
          )}
        </section>

        <HistoryNavigation
          historyRef={historyRef}
          contentKey={`${detail.id}:${historyKey}:${searchQuery.key}`}
        />
        {batch.stage && !batch.isPicker && (
          <footer className="composer-wrap">
            <MessageSelectionBar
              count={batch.selected.size}
              source={
                detail.projectId
                  ? `${root?.title ?? "Project"} / ${detail.title}`
                  : detail.title
              }
              confirming={batch.stage === "delete"}
              busy={batch.busy}
              error={batch.error}
              onSelectAll={batch.selectAll}
              onAction={batch.choose}
              onCancel={batch.stage === "delete" ? batch.back : batch.cancel}
              onConfirm={() => void batch.submit()}
            />
          </footer>
        )}
        <footer className="composer-wrap" hidden={Boolean(batch.stage)}>
          {batch.notice && (
            <div className="message-batch-notice" role="status">
              {batch.notice.text}
              {noticeDestination &&
                chats.some((chat) => chat.id === noticeDestination) && (
                  <button
                    type="button"
                    className="button button-quiet"
                    data-open-destination
                    onClick={() => onNavigate?.(noticeDestination)}
                  >
                    Open destination
                  </button>
                )}
            </div>
          )}
          <SearchSaveStatus
            savedNoteId={sendFeedback?.savedNoteId}
            hidden={
              Boolean(searchQuery.key) &&
              !visibleNotes.some(
                (note) => note.id === sendFeedback?.savedNoteId,
              )
            }
          />
          {exampleError}
          {draftNotice}
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
            onClickCapture={
              explainReadOnly ? () => explainReadOnly() : undefined
            }
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
              disabled={Boolean(explainReadOnly) || draftLocked || saving}
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
                  <div
                    className="pending-attachments"
                    aria-label="Pending files"
                  >
                    {editingAttachments.map((attachment) => (
                      <span className="pending-attachment" key={attachment.id}>
                        <span>
                          <strong>{attachment.filename}</strong>
                          <small>{formatFileSize(attachment.byteSize)}</small>
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${attachment.filename}`}
                          onClick={() =>
                            onRemoveEditingAttachment(attachment.id)
                          }
                        >
                          <XIcon />
                        </button>
                      </span>
                    ))}
                    {pendingFiles.map((file, index) => {
                      const name = isLocalFile(file)
                        ? file.name
                        : file.filename;
                      const size = isLocalFile(file)
                        ? file.size
                        : file.byteSize;
                      return (
                        <span
                          className="pending-attachment"
                          key={isLocalFile(file) ? `${name}-${index}` : file.id}
                        >
                          <span>
                            <strong>{name}</strong>
                            <small>
                              {!isLocalFile(file) && file.status !== "available"
                                ? "File unavailable. Remove or reattach it."
                                : formatFileSize(size)}
                              {isLocalFile(file) &&
                                !editingNote &&
                                (uploadFailed
                                  ? " · Upload pending"
                                  : " · Saving…")}
                            </small>
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${name}`}
                            onClick={() => onRemovePendingFile(index)}
                          >
                            <XIcon />
                          </button>
                        </span>
                      );
                    })}
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
                      editingNote ? "Edit this message…" : "Write a note..."
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
                  {!draftLocked && (
                    <input
                      ref={fileInputRef}
                      className="visually-hidden-file"
                      tabIndex={-1}
                      type="file"
                      multiple
                      aria-label="Attach files"
                      onChange={(event) => {
                        fileDrop.clearError();
                        onFilesSelected(Array.from(event.target.files ?? []));
                        event.target.value = "";
                      }}
                    />
                  )}
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
                    title={
                      timestampOpen ? "Hide timestamp" : "Choose timestamp"
                    }
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
    </ProjectLabelContext.Provider>
  );
}

function DraftNotice({
  outgoing,
}: {
  outgoing: ReturnType<typeof useConversationDraft>;
}) {
  const { session, view } = outgoing;
  if (!session) return null;
  if (view.status === "error" || view.status === "conflict") {
    const reload = view.status === "conflict" || !view.ready;
    return (
      <div className="composer-error" role="alert">
        {view.message}{" "}
        <button
          type="button"
          className="button button-quiet"
          onClick={() => {
            if (reload) void session.load(true);
            else void session.flush().catch(() => {});
          }}
        >
          {view.status === "conflict" ? "Use saved draft" : "Retry"}
        </button>
      </div>
    );
  }
  const hasDraft =
    view.body ||
    view.files.length ||
    view.senderOpen ||
    view.timestampOpen ||
    view.sender ||
    view.timestamp;
  return (
    <span className="draft-save-status" role="status">
      {view.status === "saving"
        ? "Saving draft…"
        : view.status === "saved" && hasDraft
          ? "Draft saved"
          : ""}
    </span>
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
  const outgoing = useConversationDraft(api, active?.id);
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [subthreadSource, setSubthreadSource] = useState<{
    chatId: string;
    sourceNoteId?: string;
  }>();
  const [navigationTarget, setNavigationTarget] = useState<
    ReadingPosition & { fromSearch?: boolean }
  >();
  const [navigationRevision, setNavigationRevision] = useState(0);
  const clearNavigationTarget = useCallback(
    () => setNavigationTarget(undefined),
    [],
  );
  const conversationSessions = useRef(
    new Map<
      string,
      {
        draft: string;
        sender: string;
        timestamp: string;
        senderOpen: boolean;
        timestampOpen: boolean;
        files: File[];
        filter: HistoryFilter;
        editing?: Note;
        attachmentIds: string[];
      }
    >(),
  );
  const [example, setExample] = useState<ExampleDetail>();
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  const [examplesError, setExamplesError] = useState("");
  const [examplesReload, setExamplesReload] = useState(0);
  const workspacePreferences = useWorkspacePreferences(api);
  const { theme, showExamples, collapsedSections, alwaysShowMessageTime } =
    workspacePreferences.preferences;
  const preferenceWarning = workspacePreferences.warning;
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
  const pendingCreatedProjectFocus = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const createdId = pendingCreatedProjectFocus.current;
    if (!createdId || dialog) return;
    pendingCreatedProjectFocus.current = undefined;
    // Native dialog cleanup restores its opener before this focus baseline.
    if (mode === "projects" && active?.id === createdId)
      focusMobileBackButton();
  }, [active?.id, dialog, mode]);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general");
  const [editingNote, setEditingNote] = useState<Note>();
  const [editingAttachmentIds, setEditingAttachmentIds] = useState<string[]>(
    [],
  );
  const [copiedNoteId, setCopiedNoteId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [draftSender, setDraftSender] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>([]);
  const [draftTimestamp, setDraftTimestamp] = useState("");
  const [composerSenderOpen, setComposerSenderOpen] = useState(false);
  const [composerTimestampOpen, setComposerTimestampOpen] = useState(false);
  const [error, setError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<SendFeedback>();
  const sendAttempt = useRef(0);
  const [importing, setImporting] = useState(false);
  const importInProgress = useRef(false);
  const databaseEpoch = useRef(0);
  const pendingNoteMutations = useRef(0);
  const previewTail = useRef<Promise<unknown>>(Promise.resolve());
  const [pendingNoteCount, setPendingNoteCount] = useState(0);
  const [railErrors, setRailErrors] = useState<Record<string, string>>({});
  const [projectMutationIds, setProjectMutationIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const projectMutations = useRef(new Set<string>());
  const pendingRailFocus = useRef<
    { chat: Chat; action: RailAction; section: RailSection } | undefined
  >(undefined);
  useLayoutEffect(() => {
    const pending = pendingRailFocus.current;
    if (!pending || projectMutationIds.has(pending.chat.id)) return;
    pendingRailFocus.current = undefined;
    const rows = [
      ...document.querySelectorAll<HTMLElement>("[data-project-row]"),
    ];
    const row = rows.find(
      (item) => item.dataset.projectRow === pending.chat.id,
    );
    const focused = document.activeElement;
    if (focused && focused !== document.body && !row?.contains(focused)) return;
    const parent = rows.find(
      (item) => item.dataset.projectRow === pending.chat.projectId,
    );
    const action = row?.querySelector<HTMLButtonElement>(
      `[data-project-action="${pending.action}"]`,
    );
    const fallback = row ?? parent;
    const target =
      action && !action.closest("[hidden]")
        ? action
        : fallback?.closest("[hidden]")
          ? fallback
              .closest(".project-section")
              ?.querySelector<HTMLButtonElement>(".rail-section-label")
          : (fallback?.querySelector<HTMLButtonElement>(".project-item") ??
            document
              .getElementById(`rail-${pending.section}`)
              ?.closest("button"));
    target?.focus();
  }, [projectMutationIds]);
  const [searchQueries] = useState(() => new Map<string, string>());
  const [readingPositions, setReadingPositions] = useState(
    () => new Map<string, ReadingPosition>(),
  );
  const selectionRequest = useRef(0);
  const pendingSelection = useRef<"example" | { chatId: string } | undefined>(
    undefined,
  );
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
  useLayoutEffect(() => {
    if (!active || example) return;
    conversationSessions.current.set(active.id, {
      draft,
      sender: draftSender,
      timestamp: draftTimestamp,
      senderOpen: composerSenderOpen,
      timestampOpen: composerTimestampOpen,
      files: pendingFiles,
      filter: historyFilter,
      editing: editingNote,
      attachmentIds: editingAttachmentIds,
    });
  }, [
    active,
    example,
    draft,
    draftSender,
    draftTimestamp,
    composerSenderOpen,
    composerTimestampOpen,
    pendingFiles,
    historyFilter,
    editingNote,
    editingAttachmentIds,
  ]);

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
          setHistoryFilter((current) =>
            current.filter(
              (filter) =>
                filter === "attachments" ||
                filter === "links" ||
                projectLabels(detail).some(
                  (label) => `label:${label.id}` === filter && label.enabled,
                ),
            ),
          );
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

  function updateExamplesVisibility(show: boolean) {
    workspacePreferences.update({ showExamples: show });
  }
  useEffect(() => {
    if (!showExamples && (example || pendingSelection.current === "example")) {
      selectionRequest.current++;
      pendingSelection.current = undefined;
      setExample(undefined);
      setHistoryFilter([]);
      setExampleNotice("Examples are hidden.");
    }
  }, [showExamples, example]);

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
      setHistoryFilter([]);
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
        setHistoryFilter([]);
        workspacePreferences.update({ collapsedSections: { Projects: false } });
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
    setDraftSender("");
    setComposerSenderOpen(false);
  }

  function rememberConversation() {
    if (!active || example) return;
    conversationSessions.current.set(active.id, {
      draft,
      sender: draftSender,
      timestamp: draftTimestamp,
      senderOpen: composerSenderOpen,
      timestampOpen: composerTimestampOpen,
      files: pendingFiles,
      filter: historyFilter,
      editing: editingNote,
      attachmentIds: editingAttachmentIds,
    });
  }
  function restoreConversation(id: string) {
    const saved = conversationSessions.current.get(id);
    setDraft(saved?.draft ?? "");
    setDraftSender(saved?.sender ?? "");
    setDraftTimestamp(saved?.timestamp ?? "");
    setComposerSenderOpen(saved?.senderOpen ?? false);
    setComposerTimestampOpen(saved?.timestampOpen ?? false);
    setPendingFiles(saved?.files ?? []);
    setHistoryFilter(saved?.filter ?? []);
    setEditingNote(saved?.editing);
    setEditingAttachmentIds(saved?.attachmentIds ?? []);
  }
  async function selectChat(
    id: string,
    noteId?: string,
    fallback?: ReadingPosition,
    fromSearch = false,
  ) {
    if (savingNote || copyInProgress.current) return;
    rememberConversation();
    pendingSelection.current = { chatId: id };
    const request = ++selectionRequest.current;
    setMode("projects");
    setError("");
    try {
      const detail = await api.getChat(id);
      if (request !== selectionRequest.current) return;
      setExample(undefined);
      setExpandedProjects((current) =>
        new Set(current).add(detail.projectId ?? detail.id),
      );
      const targetNote = noteId
        ? detail.notes.find((note) => note.id === noteId)
        : undefined;
      const target = targetNote
        ? {
            noteId: targetNote.id,
            createdAt: targetNote.createdAt,
            offset: 16,
            fromSearch,
          }
        : fallback;
      setNavigationTarget(target);
      if (noteId || fallback) {
        setNavigationRevision((value) => value + 1);
        if (target)
          setReadingPositions((current) => new Map(current).set(id, target));
      }
      setWorkspace((current) => {
        const summary = current.chats.find((chat) => chat.id === id);
        return {
          ...current,
          active: {
            ...detail,
            manualAlert: summary?.manualAlert ?? detail.manualAlert,
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
      restoreConversation(id);
      if (noteId || fallback) setHistoryFilter([]);
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
    rememberConversation();
    const chat = await api.createChat(input);
    pendingCreatedProjectFocus.current = chat.id;
    setNavigationTarget(undefined);
    setExpandedProjects((current) => new Set(current).add(chat.id));
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
    setHistoryFilter([]);
    setDraftTimestamp("");
    setComposerTimestampOpen(false);
    setEditingNote(undefined);
    setEditingAttachmentIds([]);
  }

  async function createSubthread(title: string) {
    if (!subthreadSource) return;
    const source = subthreadSource;
    const conversation = chats.find((chat) => chat.id === source.chatId);
    if (!conversation)
      throw new Error("The source conversation is no longer available.");
    // Creating from a child also changes its root's family membership.
    const ids = conversation.projectId
      ? [conversation.id, conversation.projectId]
      : [conversation.id];
    await runProjectMutation(ids, async () => {
      rememberConversation();
      const chat = await api.createSubthread(source.chatId, {
        title,
        ...(source.sourceNoteId ? { sourceNoteId: source.sourceNoteId } : {}),
      });
      selectionRequest.current += 1;
      setExample(undefined);
      setMode("projects");
      setNavigationTarget(undefined);
      setExpandedProjects((current) =>
        new Set(current).add(chat.projectId ?? chat.id),
      );
      copiedFocus.current = chat.id;
      setWorkspace((current) => ({
        chats: sortChats([
          ...current.chats.filter((item) => item.id !== chat.id),
          chat,
        ]),
        active: { ...chat, notes: [] },
      }));
      restoreConversation(chat.id);
      setSubthreadSource(undefined);
    });
  }

  async function runProjectMutation(
    ids: readonly string[],
    mutation: () => Promise<void>,
  ) {
    if (ids.some((id) => projectMutations.current.has(id)))
      throw new Error("Wait for the current project change to finish.");
    for (const id of ids) projectMutations.current.add(id);
    setProjectMutationIds(new Set(projectMutations.current));
    activeMutationGeneration.current += 1;
    summaryRequest.current += 1;
    try {
      await mutation();
    } finally {
      activeMutationGeneration.current += 1;
      summaryRequest.current += 1;
      for (const id of ids) projectMutations.current.delete(id);
      setProjectMutationIds(new Set(projectMutations.current));
    }
  }

  function clearProjectError(id: string) {
    setRailErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function applyChatAction(
    chat: Chat,
    action: Exclude<RailAction, "delete">,
  ) {
    const state =
      action === "pin"
        ? await api.setChatPinned(chat.id, chat.pinnedAt == null)
        : action === "archive"
          ? await api.setChatArchived(chat.id, chat.archivedAt == null)
          : await api.setChatAlert(chat.id, !chat.manualAlert);
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
  }

  async function runRailAction(
    chat: Chat,
    action: RailAction,
    section: RailSection,
  ) {
    if (projectMutations.current.has(chat.id)) return;
    if (action === "delete" && !confirmChatDeletion(chat)) return;
    clearProjectError(chat.id);
    const selection = selectionRequest.current;
    try {
      await runProjectMutation([chat.id], async () => {
        try {
          if (action === "delete") await deleteChatUnlocked(chat.id);
          else await applyChatAction(chat, action);
        } finally {
          if (selection === selectionRequest.current)
            pendingRailFocus.current = { chat, action, section };
        }
      });
    } catch (caught) {
      setRailErrors((current) => ({
        ...current,
        [chat.id]: errorMessage(
          caught,
          "The project change could not be saved.",
        ),
      }));
    }
  }

  async function updateChat(input: Parameters<typeof updateChatUnlocked>[0]) {
    if (active)
      await runProjectMutation([active.id], () => updateChatUnlocked(input));
  }

  async function updateChatUnlocked(input: {
    title: string;
    accent?: Accent;
    labelConfiguration: LabelConfiguration;
    collapseLongMessages: boolean;
  }) {
    if (!active) return;
    const projectId = active.id;
    const chat = await api.updateChat(active.id, input);
    activeMutationGeneration.current += 1;
    setWorkspace((current) => {
      const next = commitProjectUpdate(
        current,
        chat.id,
        () => chat,
        (detail) => ({
          ...detail,
          ...chat,
          notes: detail.notes.map((note) => ({
            ...note,
            labels: note.labels.filter(
              (id) =>
                projectLabels(chat).some((label) => label.id === id) ||
                note.labelSnapshots?.some((label) => label.id === id),
            ),
          })),
        }),
      );
      if (!chat.projectId) {
        next.chats = next.chats.map((item) =>
          item.projectId === chat.id ? { ...item, accent: chat.accent } : item,
        );
        if (next.active?.projectId === chat.id)
          next.active = { ...next.active, accent: chat.accent };
      }
      return next;
    });
    setHistoryFilter((current) =>
      current.filter(
        (filter) =>
          filter === "attachments" ||
          filter === "links" ||
          PERMANENT_LABELS.includes(filter.slice(6) as never) ||
          chat.enabledLabels.includes(filter.slice(6) as ConfigurableLabel),
      ),
    );
    setDialog(undefined);
    setMode("projects");
    if (activeId.current === projectId) focusMobileBackButton();
  }

  async function deleteChatUnlocked(projectId: string) {
    await api.deleteChat(projectId);
    const deletedIds = new Set(
      chats
        .filter((chat) => chat.id === projectId || chat.projectId === projectId)
        .map((chat) => chat.id),
    );
    setSubthreadSource((current) =>
      current && deletedIds.has(current.chatId) ? undefined : current,
    );
    for (const id of deletedIds) {
      searchQueries.delete(id);
      conversationSessions.current.delete(id);
      outgoing.forget(id);
    }
    setReadingPositions((current) => {
      const next = new Map(current);
      for (const id of deletedIds) next.delete(id);
      return next;
    });
    const pending = pendingSelection.current;
    if (pending && pending !== "example" && deletedIds.has(pending.chatId)) {
      selectionRequest.current += 1;
      pendingSelection.current = undefined;
    }
    activeMutationGeneration.current += 1;
    setWorkspace((current) => ({
      chats: current.chats
        .filter((chat) => chat.id !== projectId && chat.projectId !== projectId)
        .map((chat) =>
          chat.origin?.sourceChatId && deletedIds.has(chat.origin.sourceChatId)
            ? {
                ...chat,
                origin: {
                  ...chat.origin,
                  sourceChatId: null,
                  sourceNoteId: null,
                },
              }
            : chat,
        ),
      active:
        current.active && deletedIds.has(current.active.id)
          ? undefined
          : current.active?.origin?.sourceChatId &&
              deletedIds.has(current.active.origin.sourceChatId)
            ? {
                ...current.active,
                origin: {
                  ...current.active.origin,
                  sourceChatId: null,
                  sourceNoteId: null,
                },
              }
            : current.active,
    }));
    if (activeId.current && deletedIds.has(activeId.current)) {
      setDraft("");
      resetSenderComposer();
      setPendingFiles([]);
      setHistoryFilter([]);
      setDraftTimestamp("");
      setComposerTimestampOpen(false);
      setError("");
      setEditingNote(undefined);
      setEditingAttachmentIds([]);
      setMode((current) => (current === "projectEdit" ? "projects" : current));
    }
  }

  async function appendNote() {
    if (!active || savingNote) return;
    if (
      editingNote
        ? !draft.trim() && !pendingFiles.length && !editingAttachmentIds.length
        : !outgoing.session ||
          (!outgoing.view.body.trim() && !outgoing.view.files.length)
    )
      return;
    const projectId = active.id;
    const submittedDraft = draft;
    const submittedSender = draftSender.trim();
    const submittedFiles = pendingFiles;
    const editing = editingNote;
    const timestampValue = editing ? draftTimestamp : outgoing.view.timestamp;
    setSavingNote(true);
    setError("");
    try {
      const timestamp =
        (editing || outgoing.view.timestampOpen) && timestampValue
          ? fromDateTimeLocalValue(timestampValue)
          : undefined;
      if (editing) {
        if (timestamp === undefined)
          throw new Error("Choose a valid timestamp.");
        const attempt = ++sendAttempt.current;
        setSendFeedback({ projectId, attempt });
        const sender = submittedSender || null;
        await updateNote(editing, {
          body: submittedDraft,
          ...(sender === (editing.sender ?? null) ? {} : { sender }),
          createdAt: timestamp,
          keepAttachmentIds: editingAttachmentIds,
          files: submittedFiles,
        });
        setEditingNote(undefined);
        setEditingAttachmentIds([]);
        if (activeId.current === projectId)
          setSendFeedback({ projectId, attempt, savedNoteId: editing.id });
      } else {
        const attempt = ++sendAttempt.current;
        setSendFeedback({ projectId, attempt });
        const note = await outgoing.session!.send(timestamp);
        if (activeId.current === projectId)
          setSendFeedback({
            projectId,
            attempt,
            noteId: note.id,
            savedNoteId: note.id,
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
              const notes = sortNotes([
                ...detail.notes.filter((item) => item.id !== note.id),
                note,
              ]);
              return {
                ...detail,
                notes,
                updatedAt: chatActivityFromNotes(detail, notes),
              };
            },
          ),
        );
      }
      if (editing && activeId.current === projectId) {
        setDraft((current) => (current === submittedDraft ? "" : current));
        setPendingFiles((current) =>
          current === submittedFiles ? [] : current,
        );
        setDraftTimestamp("");
        setComposerTimestampOpen(false);
      }
    } catch (caught) {
      if (activeId.current === projectId) {
        setError(
          editing && caught instanceof NoteBodyConflictError
            ? "This message changed in another window. Your unsaved edit is still here. Copy any changes you want to keep, then cancel and reopen the message to edit the latest version."
            : errorMessage(caught, "The note could not be added."),
        );
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
    resetSenderComposer();
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

  function attachToDraft(files: File[]) {
    if (
      outgoing.view.files.length + files.length >
      MAX_ATTACHMENTS_PER_MESSAGE
    ) {
      setError(
        `A message can have up to ${MAX_ATTACHMENTS_PER_MESSAGE} attachments.`,
      );
      return;
    }
    const oversized = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      setError(`${oversized.name} exceeds the 100 MiB attachment limit.`);
      return;
    }
    setError("");
    outgoing.session?.edit({ files: [...outgoing.view.files, ...files] });
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
      createdAt?: number;
      keepAttachmentIds?: string[];
      files?: File[];
    },
  ) {
    if (!active) return;
    const projectId = active.id;
    const epoch = databaseEpoch.current;
    const selection = selectionRequest.current;
    const mutation = activeMutationGeneration.current;
    let updated: Note;
    try {
      updated = await api.updateNote(projectId, noteToUpdate.id, {
        ...input,
        expectedBody: noteToUpdate.body,
      });
    } catch (caught) {
      if (caught instanceof NoteBodyConflictError) {
        const detail = await api.getChat(projectId);
        if (
          epoch === databaseEpoch.current &&
          selection === selectionRequest.current &&
          mutation === activeMutationGeneration.current
        ) {
          setWorkspace((current) =>
            commitProjectUpdate(
              current,
              projectId,
              () => chatFromDetail(detail),
              () => detail,
            ),
          );
        }
      }
      throw caught;
    }
    if (epoch !== databaseEpoch.current) return;
    activeMutationGeneration.current += 1;
    if (input.createdAt === undefined) {
      setWorkspace((current) =>
        commitProjectUpdate(
          current,
          projectId,
          (chat) => chat,
          (detail) => ({
            ...detail,
            notes: detail.notes.map((note) =>
              note.id === updated.id && note.body === noteToUpdate.body
                ? { ...note, body: updated.body }
                : note,
            ),
          }),
        ),
      );
      return;
    }
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
    try {
      await runNoteMutation(() => api.deleteNote(projectId, note.id));
    } catch (caught) {
      if (epoch === databaseEpoch.current && activeId.current === projectId)
        setError(errorMessage(caught, "The message could not be deleted."));
      return;
    }
    if (epoch !== databaseEpoch.current) return;
    const focusedRow =
      document.activeElement?.closest<HTMLElement>(".message-row");
    if (
      activeId.current === projectId &&
      focusedRow?.dataset.noteId === note.id
    ) {
      const rows = [
        ...(focusedRow
          .closest(".history")
          ?.querySelectorAll<HTMLElement>(".message-row") ?? []),
      ];
      const index = rows.indexOf(focusedRow);
      const destination =
        rows[index + 1] ??
        rows[index - 1] ??
        document.querySelector<HTMLElement>("[data-composer-textarea]");
      destination?.focus({ preventScroll: true });
    }
    activeMutationGeneration.current += 1;
    removeFromSource(active, [note]);
  }

  function removeFromSource(active: ChatDetail, removed: Note[]) {
    const projectId = active.id;
    const removedById = new Map(removed.map((note) => [note.id, note]));
    const submittedNotes = active.notes.filter(
      (item) => !removedById.has(item.id),
    );
    const submittedUpdatedAt = chatActivityFromNotes(active, submittedNotes);
    const submittedDetail = {
      ...active,
      notes: submittedNotes,
      updatedAt: submittedUpdatedAt,
    };
    setWorkspace((current) => {
      const next = commitProjectUpdate(
        current,
        projectId,
        (chat) => mergeMessageSummary(chat, submittedDetail),
        (detail) => {
          const notes = detail.notes.filter(
            (item) => !removedById.has(item.id),
          );
          return {
            ...detail,
            notes,
            updatedAt: chatActivityFromNotes(detail, notes),
          };
        },
      );
      function detachSource<T extends Chat>(chat: T): T {
        const sourceId = chat.origin?.sourceNoteId;
        const note = sourceId && removedById.get(sourceId);
        return note && chat.origin
          ? {
              ...chat,
              origin: {
                ...chat.origin,
                sourceNoteId: null,
                sourceNoteCreatedAt: note.createdAt,
                sourceNotePositionId: note.id,
              },
            }
          : chat;
      }
      next.chats = next.chats.map(detachSource);
      if (next.active) next.active = detachSource(next.active);
      return next;
    });
  }

  async function batchNotes(input: BatchNotesInput) {
    if (!active || savingNote || pendingSelection.current)
      throw new Error("Wait for the current change to finish.");
    const source = active;
    const ids =
      input.action === "delete"
        ? [source.id]
        : [source.id, input.destinationChatId];
    setSavingNote(true);
    try {
      await runProjectMutation(ids, () =>
        runNoteMutation(() => api.batchNotes(source.id, input)),
      );
      if (input.action !== "copy") {
        const removedIds = new Set(input.noteIds);
        removeFromSource(
          source,
          source.notes.filter((note) => removedIds.has(note.id)),
        );
      }
      refreshProjectSummaries();
    } finally {
      setSavingNote(false);
    }
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
    const included =
      selection === "all"
        ? undefined
        : new Set(
            chats
              .filter((chat) => selection.includes(chat.projectId ?? chat.id))
              .map((chat) => chat.id),
          );
    await Promise.all(outgoing.flush(included));
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
    await workspacePreferences.pause();
    try {
      // Drain local writes before changing databases. A previously rejected save
      // cannot prevent a user-confirmed replacement or discard a local edit on merge.
      await Promise.allSettled(outgoing.flush());
      const result = await api.importDatabase(file, options);
      invalidate();
      if (options.mode === "replace") {
        conversationSessions.current.clear();
        outgoing.clear();
        setExpandedProjects(new Set());
        setSubthreadSource(undefined);
        setNavigationTarget(undefined);
        activeId.current = undefined;
        setExample(undefined);
        setWorkspace({ chats: [] });
        setReadingPositions(new Map());
        searchQueries.clear();
        setDraftTimestamp("");
        resetSenderComposer();
        setPendingFiles([]);
        setHistoryFilter([]);
        setComposerTimestampOpen(false);
        setDraft("");
        setEditingNote(undefined);
        setEditingAttachmentIds([]);
        setCopiedNoteId(undefined);
        setRailErrors({});
        pendingRailFocus.current = undefined;
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
      await workspacePreferences.resume();
    }
  }

  function backToProjects() {
    if (savingNote || copyInProgress.current) return;
    rememberConversation();
    if (active) {
      const saved = conversationSessions.current.get(active.id);
      if (saved)
        conversationSessions.current.set(active.id, { ...saved, filter: [] });
    }
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
    setHistoryFilter([]);
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
      {preferenceWarning && (
        <div className="global-error preference-error" role="alert">
          {preferenceWarning}{" "}
          <button
            type="button"
            className="button button-quiet"
            onClick={workspacePreferences.retry}
          >
            Retry preferences
          </button>
        </div>
      )}
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
                  workspacePreferences.update({
                    collapsedSections: {
                      Examples: !collapsedSections.Examples,
                    },
                  })
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
            workspacePreferences.update({
              collapsedSections: { [section]: !collapsedSections[section] },
            })
          }
          chats={chats}
          activeId={active?.id ?? example?.id}
          expandedProjects={expandedProjects}
          onSelect={(id) => {
            const chat = chats.find((item) => item.id === id);
            if (active?.id === id && !chat?.projectId && mode === "projects") {
              setExpandedProjects((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            } else void selectChat(id);
          }}
          onAction={runRailAction}
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
          railErrors={railErrors}
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
            alwaysShowMessageTime={alwaysShowMessageTime}
            onMessageTimeChange={(alwaysShowMessageTime) =>
              workspacePreferences.update({ alwaysShowMessageTime })
            }
            onChange={updateExamplesVisibility}
            warning=""
          />
        ) : settingsSection === "appearance" ? (
          <AppearanceSettingsWorkspace
            theme={theme}
            onThemeChange={(theme) => workspacePreferences.update({ theme })}
          />
        ) : (
          <BackupSettingsWorkspace
            projects={chats.filter((chat) => !chat.projectId)}
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
            alwaysShowMessageTime={alwaysShowMessageTime}
            key={`${example.id}:${example.revision}`}
            detail={{ ...example, id: `${example.id}:${example.revision}` }}
            readingPositions={readingPositions}
            searchQueries={searchQueries}
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
          onBack={() => setMode("projects")}
          onSubmit={updateChat}
        />
      ) : active ? (
        <ChatWorkspace
          alwaysShowMessageTime={alwaysShowMessageTime}
          key={`${active.id}:${navigationRevision}`}
          chats={chats}
          projectApi={api}
          onBatchNotes={batchNotes}
          subthreadBusy={
            projectMutationIds.has(active.id) ||
            projectMutationIds.has(active.projectId ?? active.id)
          }
          onNewSubthread={(sourceNoteId) =>
            setSubthreadSource({ chatId: active.id, sourceNoteId })
          }
          onNavigate={(id, noteId, fallback) =>
            void selectChat(id, noteId, fallback)
          }
          navigationTarget={navigationTarget}
          onSearchDestinationOpened={clearNavigationTarget}
          onOpenSearchResult={(id, noteId) =>
            void selectChat(id, noteId, undefined, true)
          }
          onTaskChange={(note, body) =>
            runNoteMutation(() => updateNote(note, { body }))
          }
          sendFeedback={
            sendFeedback?.projectId === active.id ? sendFeedback : undefined
          }
          readingPositions={readingPositions}
          searchQueries={searchQueries}
          detail={active}
          draft={editingNote ? draft : outgoing.view.body}
          draftSender={editingNote ? draftSender : outgoing.view.sender}
          draftTimestamp={
            editingNote ? draftTimestamp : outgoing.view.timestamp
          }
          draftLocked={!editingNote && !outgoing.view.ready}
          uploadFailed={
            outgoing.view.status === "error" ||
            outgoing.view.status === "conflict"
          }
          draftNotice={!editingNote && <DraftNotice outgoing={outgoing} />}
          error={error}
          editingNote={editingNote}
          editingAttachmentIds={editingAttachmentIds}
          pendingFiles={editingNote ? pendingFiles : outgoing.view.files}
          historyFilter={historyFilter}
          saving={savingNote}
          senderOpen={
            editingNote ? composerSenderOpen : outgoing.view.senderOpen
          }
          timestampOpen={
            editingNote ? composerTimestampOpen : outgoing.view.timestampOpen
          }
          onBack={backToProjects}
          onCustomize={() => setMode("projectEdit")}
          onCopyNote={copyNote}
          onAttachmentAction={attachmentAction}
          onEditNote={startEditingNote}
          onCancelEditNote={cancelEditingNote}
          onDeleteNote={deleteNote}
          onDraftChange={
            editingNote ? setDraft : (body) => outgoing.session?.edit({ body })
          }
          onDraftSenderChange={
            editingNote
              ? setDraftSender
              : (sender) => outgoing.session?.edit({ sender })
          }
          onDraftTimestampChange={
            editingNote
              ? setDraftTimestamp
              : (timestamp) => outgoing.session?.edit({ timestamp })
          }
          onFilesSelected={editingNote ? addPendingFiles : attachToDraft}
          onHistoryFilterChange={setHistoryFilter}
          onRemoveEditingAttachment={removeEditingAttachment}
          onRemovePendingFile={
            editingNote
              ? removePendingFile
              : (index) =>
                  outgoing.session?.edit({
                    files: outgoing.view.files.filter((_, i) => i !== index),
                  })
          }
          onSetNoteLabel={setNoteLabel}
          onSubmit={appendNote}
          onSenderOpenChange={
            editingNote
              ? setComposerSenderOpen
              : (senderOpen) => outgoing.session?.edit({ senderOpen })
          }
          onToggleTimestamp={() => {
            if (!editingNote) {
              const timestampOpen = !outgoing.view.timestampOpen;
              outgoing.session?.edit({
                timestampOpen,
                timestamp:
                  outgoing.view.timestamp ||
                  (timestampOpen ? toDateTimeLocalValue(Date.now()) : ""),
              });
              return;
            }
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
      {subthreadSource && (
        <SubthreadForm
          source={subthreadSource}
          onCancel={() => setSubthreadSource(undefined)}
          onSubmit={createSubthread}
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
