import type {
  Chat,
  ChatDetail,
  Note,
  ProjectPinState,
} from "../domain/types.js";
import type { Label } from "../domain/validation.js";
import type {
  CreateChatInput,
  CreateNoteInput,
  UpdateChatInput,
  UpdateNoteInput,
} from "../domain/validation.js";

export interface ApiClient {
  listChats(): Promise<Chat[]>;
  getChat(id: string): Promise<ChatDetail>;
  createChat(input: CreateChatInput): Promise<Chat>;
  updateChat(id: string, input: UpdateChatInput): Promise<Chat>;
  setChatPinned(id: string, pinned: boolean): Promise<ProjectPinState>;
  deleteChat(id: string): Promise<void>;
  appendNote(id: string, input: CreateNoteInput): Promise<Note>;
  updateNote(
    chatId: string,
    noteId: string,
    input: UpdateNoteInput,
  ): Promise<Note>;
  deleteNote(chatId: string, noteId: string): Promise<void>;
  setNoteLabel(
    chatId: string,
    noteId: string,
    label: Label,
    applied: boolean,
  ): Promise<Label[]>;
  openAttachment(
    chatId: string,
    noteId: string,
    attachmentId: string,
  ): Promise<void>;
  revealAttachment(
    chatId: string,
    noteId: string,
    attachmentId: string,
  ): Promise<void>;
  exportDatabase(): Promise<Blob>;
  importDatabase(file: Blob): Promise<void>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    headers:
      init?.body && !isFormData
        ? { "Content-Type": "application/json", ...init.headers }
        : init?.headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      payload?.message ?? "The local service could not complete that request.",
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const apiClient: ApiClient = {
  listChats: () => request<Chat[]>("/api/chats"),
  getChat: (id) => request<ChatDetail>(`/api/chats/${encodeURIComponent(id)}`),
  createChat: (input) =>
    request<Chat>("/api/chats", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateChat: (id, input) =>
    request<Chat>(`/api/chats/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  setChatPinned: (id, pinned) =>
    request<ProjectPinState>(`/api/chats/${encodeURIComponent(id)}/pin`, {
      method: pinned ? "PUT" : "DELETE",
    }),
  deleteChat: async (id) => {
    await request<void>(`/api/chats/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  appendNote: (id, input) => {
    const form = noteFormData(input);
    return request<Note>(`/api/chats/${encodeURIComponent(id)}/notes`, {
      method: "POST",
      body: form,
    });
  },
  updateNote: (chatId, noteId, input) => {
    const path = `/api/chats/${encodeURIComponent(chatId)}/notes/${encodeURIComponent(noteId)}`;
    return request<Note>(path, {
      method: "PATCH",
      body: noteFormData(input),
    });
  },
  deleteNote: async (chatId, noteId) => {
    await request<void>(
      `/api/chats/${encodeURIComponent(chatId)}/notes/${encodeURIComponent(noteId)}`,
      { method: "DELETE" },
    );
  },
  setNoteLabel: (chatId, noteId, label, applied) =>
    request<Label[]>(
      `/api/chats/${encodeURIComponent(chatId)}/notes/${encodeURIComponent(noteId)}/labels/${encodeURIComponent(label)}`,
      { method: applied ? "PUT" : "DELETE" },
    ),
  openAttachment: async (chatId, noteId, attachmentId) => {
    await request<void>(
      attachmentActionPath(chatId, noteId, attachmentId, "open"),
      {
        method: "POST",
        body: "{}",
      },
    );
  },
  revealAttachment: async (chatId, noteId, attachmentId) => {
    await request<void>(
      attachmentActionPath(chatId, noteId, attachmentId, "reveal"),
      { method: "POST", body: "{}" },
    );
  },
  exportDatabase: async () => {
    const response = await fetch("/api/database/export");
    if (!response.ok) throw new Error("The database could not be exported.");
    return response.blob();
  },
  importDatabase: async (file) => {
    const response = await fetch("/api/database/import", {
      method: "PUT",
      headers: {
        "Content-Type": "application/vnd.on-track.backup+sqlite",
      },
      body: file,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ?? "The database could not be imported.",
      );
    }
  },
};

function noteFormData(input: CreateNoteInput | UpdateNoteInput): FormData {
  const form = new FormData();
  if (input.body !== undefined) form.set("body", input.body);
  if (input.createdAt !== undefined) {
    form.set("createdAt", String(input.createdAt));
  }
  if ("keepAttachmentIds" in input) {
    if (input.keepAttachmentIds !== undefined) {
      form.set("replaceAttachments", "true");
    }
    for (const id of input.keepAttachmentIds ?? []) {
      form.append("keepAttachmentIds", id);
    }
  }
  for (const file of input.files ?? []) form.append("files", file);
  return form;
}

function attachmentActionPath(
  chatId: string,
  noteId: string,
  attachmentId: string,
  action: "open" | "reveal",
): string {
  return `/api/chats/${encodeURIComponent(chatId)}/notes/${encodeURIComponent(noteId)}/attachments/${encodeURIComponent(attachmentId)}/${action}`;
}
