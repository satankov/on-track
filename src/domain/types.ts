import type { Accent } from "./validation.js";

export interface Chat {
  id: string;
  title: string;
  accent: Accent;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  chatId: string;
  body: string;
  createdAt: number;
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
}

export interface StoredNoteAttachment extends NoteAttachment {
  storagePath: string;
}
