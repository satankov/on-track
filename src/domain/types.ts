import type { ProjectLabel } from "./labels.js";
import type { Accent, ConfigurableLabel, Label } from "./validation.js";

export interface Chat {
  /** Null for Main; children always reference a root project. */
  projectId?: string | null;
  /** Present for continued subthreads even when their source is deleted. */
  origin?: { sourceChatId: string | null; sourceNoteId: string | null } | null;
  labelDefinitions?: ProjectLabel[];
  labelConfigurationRevision?: number;
  id: string;
  title: string;
  accent: Accent;
  enabledLabels: ConfigurableLabel[];
  collapseLongMessages: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  pinnedAt: number | null;
  latestAttentionAt: number | null;
  nextAttentionAt: number | null;
}

export interface ProjectArchiveState {
  archivedAt: number | null;
  pinnedAt: number | null;
}

export interface ProjectPinState {
  pinnedAt: number | null;
}

export interface Note {
  id: string;
  chatId: string;
  body: string;
  sender: string | null;
  createdAt: number;
  labels: Label[];
  attachments?: NoteAttachment[];
}

export interface ChatDetail extends Chat {
  notes: Note[];
}

export interface NoteAttachment {
  id: string;
  noteId: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  modifiedAt: number;
  createdAt: number;
  status: "available" | "missing" | "unreadable" | "unsafe";
  actions?: {
    open: "available" | "blocked" | "unavailable" | "unsupported";
    reveal: "available" | "unavailable" | "unsupported";
  };
}

export interface StoredNoteAttachment extends Omit<NoteAttachment, "actions"> {
  storagePath: string;
}
