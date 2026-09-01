import type { Chat, ChatDetail, Note } from "../domain/types.js";
import {
  createChatInputSchema,
  createNoteInputSchema,
  updateNoteInputSchema,
  updateChatInputSchema,
} from "../domain/validation.js";
import type { SqliteChatRepository } from "./db/repository.js";

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found.");
  }
}

export class ChatService {
  constructor(
    private readonly repository: SqliteChatRepository,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
    private readonly clock: () => number = () => Date.now(),
  ) {}

  listChats(): Chat[] {
    return this.repository.listChats();
  }

  getChat(id: string): ChatDetail {
    const chat = this.repository.getChat(id);
    if (!chat) throw new ProjectNotFoundError();
    return { ...chat, notes: this.repository.listNotes(id) };
  }

  createChat(input: unknown): Chat {
    const values = createChatInputSchema.parse(input);
    return this.repository.createChat({
      id: this.idFactory(),
      ...values,
      now: this.clock(),
    });
  }

  updateChat(id: string, input: unknown): Chat {
    const values = updateChatInputSchema.parse(input);
    const chat = this.repository.updateChat(id, {
      ...values,
      now: this.clock(),
    });
    if (!chat) throw new ProjectNotFoundError();
    return chat;
  }

  deleteChat(id: string): void {
    if (!this.repository.deleteChat(id)) {
      throw new ProjectNotFoundError();
    }
  }

  appendNote(chatId: string, input: unknown): Note {
    const values = createNoteInputSchema.parse(input);
    const note = this.repository.appendNote({
      id: this.idFactory(),
      chatId,
      body: values.body,
      createdAt: values.createdAt,
      now: this.clock(),
    });
    if (!note) throw new ProjectNotFoundError();
    return note;
  }

  updateNote(chatId: string, noteId: string, input: unknown): Note {
    const values = updateNoteInputSchema.parse(input);
    const note = this.repository.updateNote(chatId, noteId, {
      ...values,
      now: this.clock(),
    });
    if (!note) throw new ProjectNotFoundError();
    return note;
  }

  deleteNote(chatId: string, noteId: string): void {
    if (!this.repository.deleteNote(chatId, noteId)) {
      throw new ProjectNotFoundError();
    }
  }
}
