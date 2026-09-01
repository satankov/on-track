import type {
  Chat,
  ChatDetail,
  Note,
  StoredNoteAttachment,
} from "../domain/types.js";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
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

export class InvalidInputError extends Error {
  constructor() {
    super("Please check the submitted values.");
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

  appendNoteWithAttachments(
    chatId: string,
    input: {
      body?: string;
      createdAt?: number;
      attachments: {
        filename: string;
        mediaType: string;
        byteSize: number;
        content: Uint8Array;
      }[];
    },
  ): Note {
    const body = input.body?.trim() ?? "";
    if (body.length === 0 && input.attachments.length === 0) {
      createNoteInputSchema.parse(input);
    }
    if (body.length > 10_000) createNoteInputSchema.parse({ body });
    if (input.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new InvalidInputError();
    }
    for (const attachment of input.attachments) {
      if (
        attachment.byteSize < 1 ||
        attachment.byteSize > MAX_ATTACHMENT_BYTES ||
        attachment.content.byteLength !== attachment.byteSize
      ) {
        throw new InvalidInputError();
      }
    }

    const now = this.clock();
    const note = this.repository.appendNote({
      id: this.idFactory(),
      chatId,
      body,
      createdAt: input.createdAt,
      now,
      attachments: input.attachments.map((attachment) => ({
        ...attachment,
        id: this.idFactory(),
        createdAt: input.createdAt ?? now,
      })),
    });
    if (!note) throw new ProjectNotFoundError();
    return { ...note, body };
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

  updateNoteWithAttachments(
    chatId: string,
    noteId: string,
    input: {
      body?: string;
      createdAt?: number;
      keepAttachmentIds: string[];
      attachments: {
        filename: string;
        mediaType: string;
        byteSize: number;
        content: Uint8Array;
      }[];
    },
  ): Note {
    const body = input.body?.trim() ?? "";
    if (
      body.length === 0 &&
      input.keepAttachmentIds.length === 0 &&
      input.attachments.length === 0
    ) {
      throw new InvalidInputError();
    }
    if (body.length > 10_000) createNoteInputSchema.parse({ body });
    if (
      input.keepAttachmentIds.length + input.attachments.length >
      MAX_ATTACHMENTS_PER_MESSAGE
    ) {
      throw new InvalidInputError();
    }
    for (const attachment of input.attachments) {
      if (
        attachment.byteSize < 1 ||
        attachment.byteSize > MAX_ATTACHMENT_BYTES ||
        attachment.content.byteLength !== attachment.byteSize
      ) {
        throw new InvalidInputError();
      }
    }

    const now = this.clock();
    const note = this.repository.updateNote(chatId, noteId, {
      body,
      createdAt: input.createdAt,
      now,
      keepAttachmentIds: input.keepAttachmentIds,
      attachments: input.attachments.map((attachment) => ({
        ...attachment,
        id: this.idFactory(),
        createdAt: now,
      })),
    });
    if (!note) throw new ProjectNotFoundError();
    return note;
  }

  deleteNote(chatId: string, noteId: string): void {
    if (!this.repository.deleteNote(chatId, noteId)) {
      throw new ProjectNotFoundError();
    }
  }

  getAttachment(
    chatId: string,
    noteId: string,
    attachmentId: string,
  ): StoredNoteAttachment {
    const attachment = this.repository.getAttachment(
      chatId,
      noteId,
      attachmentId,
    );
    if (!attachment) throw new ProjectNotFoundError();
    return attachment;
  }
}
