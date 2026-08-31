import type { Chat, ChatDetail, Note } from "../domain/types.js";
import {
  createChatInputSchema,
  createNoteInputSchema,
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

  appendNote(chatId: string, input: unknown): Note {
    const values = createNoteInputSchema.parse(input);
    const note = this.repository.appendNote({
      id: this.idFactory(),
      chatId,
      ...values,
      now: this.clock(),
    });
    if (!note) throw new ProjectNotFoundError();
    return note;
  }
}
