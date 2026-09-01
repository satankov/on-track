import type { Chat, ChatDetail, Note } from "../domain/types.js";
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
  deleteChat(id: string): Promise<void>;
  appendNote(id: string, input: CreateNoteInput): Promise<Note>;
  updateNote(
    chatId: string,
    noteId: string,
    input: UpdateNoteInput,
  ): Promise<Note>;
  deleteNote(chatId: string, noteId: string): Promise<void>;
  exportDatabase(): Promise<Blob>;
  importDatabase(file: Blob): Promise<void>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body
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
  deleteChat: async (id) => {
    await request<void>(`/api/chats/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  appendNote: (id, input) =>
    request<Note>(`/api/chats/${encodeURIComponent(id)}/notes`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateNote: (chatId, noteId, input) =>
    request<Note>(
      `/api/chats/${encodeURIComponent(chatId)}/notes/${encodeURIComponent(noteId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    ),
  deleteNote: async (chatId, noteId) => {
    await request<void>(
      `/api/chats/${encodeURIComponent(chatId)}/notes/${encodeURIComponent(noteId)}`,
      { method: "DELETE" },
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
      headers: { "Content-Type": "application/octet-stream" },
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
