import type {
  Chat,
  ChatDetail,
  Note,
  NoteAttachment,
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
import {
  ManagedAttachmentUnavailableError,
  type ManagedAttachmentStore,
} from "./attachments/managed-attachment-store.js";

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

export class AttachmentUnavailableError extends Error {
  constructor(readonly status: "missing" | "unreadable" | "unsafe") {
    super(`The attachment is ${status}.`);
    this.name = "AttachmentUnavailableError";
  }
}

export type AttachmentStore = Pick<
  ManagedAttachmentStore,
  "create" | "observe" | "read" | "remove"
>;

export class ChatService {
  constructor(
    private readonly repository: SqliteChatRepository,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
    private readonly clock: () => number = () => Date.now(),
    private readonly attachmentStore?: AttachmentStore,
  ) {}

  listChats(): Chat[] {
    return this.repository.listChats();
  }

  getChat(id: string): ChatDetail {
    const chat = this.repository.getChat(id);
    if (!chat) throw new ProjectNotFoundError();
    const notes = this.repository.listStoredNotes(id).map((note) => ({
      ...note,
      attachments: note.attachments.map((attachment) =>
        this.refreshAttachment(attachment),
      ),
    }));
    return { ...chat, notes };
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
    const result = this.repository.deleteChat(id);
    if (!result.deleted) {
      throw new ProjectNotFoundError();
    }
    this.cleanup(result.storagePaths);
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
    const noteId = this.idFactory();
    const installed = this.installAttachments(
      input.attachments,
      input.createdAt ?? now,
    );
    try {
      const note = this.repository.appendNote({
        id: noteId,
        chatId,
        body,
        createdAt: input.createdAt,
        now,
        attachments: installed,
      });
      if (!note) throw new ProjectNotFoundError();
      return {
        ...note,
        body,
        attachments: installed.map((attachment) =>
          this.toPublicAttachment({
            ...attachment,
            noteId,
            status: "available",
          }),
        ),
      };
    } catch (error) {
      this.cleanup(installed.map((attachment) => attachment.storagePath));
      throw error;
    }
  }

  updateNote(chatId: string, noteId: string, input: unknown): Note {
    const values = updateNoteInputSchema.parse(input);
    const result = this.repository.updateNote(chatId, noteId, {
      ...values,
      now: this.clock(),
    });
    if (!result) throw new ProjectNotFoundError();
    this.cleanup(result.removedStoragePaths);
    return this.refreshedNote(chatId, noteId);
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
    const installed = this.installAttachments(input.attachments, now);
    let result: ReturnType<SqliteChatRepository["updateNote"]>;
    try {
      result = this.repository.updateNote(chatId, noteId, {
        body,
        createdAt: input.createdAt,
        now,
        keepAttachmentIds: input.keepAttachmentIds,
        attachments: installed,
      });
    } catch (error) {
      this.cleanup(installed.map((attachment) => attachment.storagePath));
      throw error;
    }
    if (!result) {
      this.cleanup(installed.map((attachment) => attachment.storagePath));
      throw new ProjectNotFoundError();
    }
    this.cleanup(result.removedStoragePaths);
    return this.refreshedNote(chatId, noteId);
  }

  deleteNote(chatId: string, noteId: string): void {
    const result = this.repository.deleteNote(chatId, noteId);
    if (!result.deleted) {
      throw new ProjectNotFoundError();
    }
    this.cleanup(result.storagePaths);
  }

  downloadAttachment(
    chatId: string,
    noteId: string,
    attachmentId: string,
  ): { attachment: NoteAttachment; content: Buffer } {
    const attachment = this.repository.getAttachment(
      chatId,
      noteId,
      attachmentId,
    );
    if (!attachment) throw new ProjectNotFoundError();
    const store = this.requireAttachmentStore();
    try {
      const read = store.read(attachment.storagePath);
      if (
        read.byteSize !== attachment.byteSize ||
        read.modifiedAt !== attachment.modifiedAt
      ) {
        this.repository.updateAttachmentMetadata(
          attachment.id,
          read.byteSize,
          read.modifiedAt,
        );
      }
      return {
        attachment: {
          ...this.toPublicAttachment(attachment),
          byteSize: read.byteSize,
          modifiedAt: read.modifiedAt,
          status: "available",
        },
        content: read.content,
      };
    } catch (error) {
      if (error instanceof ManagedAttachmentUnavailableError) {
        throw new AttachmentUnavailableError(error.status);
      }
      throw error;
    }
  }

  private refreshAttachment(attachment: StoredNoteAttachment): NoteAttachment {
    const observation = this.requireAttachmentStore().observe(
      attachment.storagePath,
    );
    if (observation.status !== "available") {
      return {
        ...this.toPublicAttachment(attachment),
        status: observation.status,
      };
    }
    const { byteSize, modifiedAt } = observation;
    if (byteSize === undefined || modifiedAt === undefined) {
      throw new Error("Managed attachment metadata is unavailable.");
    }
    if (
      byteSize !== attachment.byteSize ||
      modifiedAt !== attachment.modifiedAt
    ) {
      this.repository.updateAttachmentMetadata(
        attachment.id,
        byteSize,
        modifiedAt,
      );
    }
    return {
      ...this.toPublicAttachment(attachment),
      byteSize,
      modifiedAt,
      status: "available",
    };
  }

  private refreshedNote(chatId: string, noteId: string): Note {
    const note = this.getChat(chatId).notes.find(
      (candidate) => candidate.id === noteId,
    );
    if (!note) throw new ProjectNotFoundError();
    return note;
  }

  private installAttachments(
    attachments: Array<{
      filename: string;
      mediaType: string;
      byteSize: number;
      content: Uint8Array;
    }>,
    createdAt: number,
  ): Array<{
    id: string;
    filename: string;
    mediaType: string;
    storagePath: string;
    byteSize: number;
    modifiedAt: number;
    createdAt: number;
  }> {
    const installed = [];
    try {
      for (const attachment of attachments) {
        const id = this.idFactory();
        const created = this.requireAttachmentStore().create({
          attachmentId: id,
          filename: attachment.filename,
          content: attachment.content,
        });
        installed.push({
          id,
          filename: attachment.filename,
          mediaType: attachment.mediaType,
          storagePath: created.storagePath,
          byteSize: created.byteSize,
          modifiedAt: created.modifiedAt,
          createdAt,
        });
      }
      return installed;
    } catch (error) {
      this.cleanup(installed.map((attachment) => attachment.storagePath));
      throw error;
    }
  }

  private cleanup(storagePaths: string[]): void {
    if (!this.attachmentStore) return;
    for (const storagePath of storagePaths) {
      try {
        this.attachmentStore.remove(storagePath);
      } catch {
        // Reference changes are already committed; cleanup is best effort.
      }
    }
  }

  private requireAttachmentStore(): AttachmentStore {
    if (!this.attachmentStore) {
      throw new Error("Managed attachment storage is unavailable.");
    }
    return this.attachmentStore;
  }

  private toPublicAttachment(attachment: StoredNoteAttachment): NoteAttachment {
    return {
      id: attachment.id,
      noteId: attachment.noteId,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      byteSize: attachment.byteSize,
      modifiedAt: attachment.modifiedAt,
      createdAt: attachment.createdAt,
      status: attachment.status,
    };
  }
}
