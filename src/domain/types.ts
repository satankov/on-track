import type { Accent, ConfigurableLabel, Label } from "./validation.js";

export const MAX_PROJECT_PREVIEW_SOURCE_LENGTH = 512;

export interface Chat {
  id: string;
  title: string;
  accent: Accent;
  enabledLabels: ConfigurableLabel[];
  createdAt: number;
  updatedAt: number;
  pinnedAt: number | null;
  latestMessagePreview: string | null;
  nextMessageAt: number | null;
  latestAttentionAt: number | null;
  nextAttentionAt: number | null;
}

export interface ProjectPinState {
  pinnedAt: number | null;
}

export interface Note {
  id: string;
  chatId: string;
  body: string;
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
