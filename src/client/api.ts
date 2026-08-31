import type { Chat, ChatDetail, Note } from "../domain/types.js";
import type {
  CreateChatInput,
  CreateNoteInput,
  UpdateChatInput,
} from "../domain/validation.js";

export interface ApiClient {
  listChats(): Promise<Chat[]>;
  getChat(id: string): Promise<ChatDetail>;
  createChat(input: CreateChatInput): Promise<Chat>;
  updateChat(id: string, input: UpdateChatInput): Promise<Chat>;
  appendNote(id: string, input: CreateNoteInput): Promise<Note>;
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
  appendNote: (id, input) =>
    request<Note>(`/api/chats/${encodeURIComponent(id)}/notes`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
