import type {
  Chat,
  ChatDetail,
  Note,
  NoteAttachment,
  StoredNoteAttachment,
} from "../domain/types.js";
import { z } from "zod";
import type { Label } from "../domain/validation.js";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  createChatInputSchema,
  updateChatInputSchema,
  labelSchema,
} from "../domain/validation.js";
import {
  InvalidAttachmentSelectionError,
  type SqliteChatRepository,
} from "./db/repository.js";
import {
  ManagedAttachmentUnavailableError,
  type ManagedAttachmentStore,
} from "./attachments/managed-attachment-store.js";
import { attachmentOpenPolicy } from "./attachment-open-policy.js";
import type { NativeFileActions } from "./native-file-actions.js";
import { NativeFileActionUnsupportedError } from "./native-file-actions.js";
import { NativeFileActionFailedError } from "./native-file-actions.js";

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

export class AttachmentOpenBlockedError extends Error {
  constructor() {
    super(
      "This file type cannot be opened from On Track. You can still show it in its folder.",
    );
    this.name = "AttachmentOpenBlockedError";
  }
}

export type AttachmentStore = Pick<
  ManagedAttachmentStore,
  "create" | "observe" | "remove"
> &
  Partial<
    Pick<
      ManagedAttachmentStore,
      "resolveAvailableTarget" | "resolveSafeContainingDirectory"
    >
  >;

const noteWriteAttachmentSchema = z
  .object({
    filename: z.string().min(1).max(255),
    mediaType: z.string().min(1).max(255),
    byteSize: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
    content: z.custom<Uint8Array>(
      (value) => value instanceof Uint8Array,
      "Attachment content must be bytes",
    ),
  })
  .refine(
    (attachment) => attachment.content.byteLength === attachment.byteSize,
    {
      message: "Attachment size does not match its content",
    },
  );

const noteBodySchema = z.string().trim().max(10_000);
const noteTimestampSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

const appendNoteCommandSchema = z
  .object({
    body: noteBodySchema.optional().default(""),
    createdAt: noteTimestampSchema.optional(),
    attachments: z
      .array(noteWriteAttachmentSchema)
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .optional()
      .default([]),
  })
  .refine((input) => input.body.length > 0 || input.attachments.length > 0, {
    message: "Provide note text or an attachment",
  });

const updateNoteCommandSchema = z
  .object({
    body: noteBodySchema.optional(),
    createdAt: noteTimestampSchema.optional(),
    keepAttachmentIds: z
      .array(z.string())
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Attachment IDs must be unique",
      })
      .optional(),
    attachments: z
      .array(noteWriteAttachmentSchema)
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .optional()
      .default([]),
    replaceAttachments: z.boolean().optional(),
  })
  .superRefine((input, context) => {
    const attachmentCount =
      (input.keepAttachmentIds?.length ?? 0) + input.attachments.length;
    const replacingAttachments =
      input.replaceAttachments === true ||
      input.keepAttachmentIds !== undefined ||
      input.attachments.length > 0;
    if (
      input.body === undefined &&
      input.createdAt === undefined &&
      !replacingAttachments
    ) {
      context.addIssue({
        code: "custom",
        message: "Provide note text, timestamp, or attachment changes",
      });
    }
    if (
      (input.body !== undefined || replacingAttachments) &&
      (input.body?.length ?? 0) === 0 &&
      attachmentCount === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "An empty message must keep or add an attachment",
      });
    }
    if (attachmentCount > MAX_ATTACHMENTS_PER_MESSAGE) {
      context.addIssue({
        code: "custom",
        message: "A message has too many attachments",
      });
    }
  });

export class ChatService {
  constructor(
    private readonly repository: SqliteChatRepository,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
    private readonly clock: () => number = () => Date.now(),
    private readonly attachmentStore?: AttachmentStore,
    private readonly nativeFileActions?: NativeFileActions,
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
    const values = appendNoteCommandSchema.parse(input);
    const now = this.clock();
    const noteId = this.idFactory();
    const installed = this.installAttachments(
      values.attachments,
      values.createdAt ?? now,
    );
    try {
      const note = this.repository.appendNote({
        id: noteId,
        chatId,
        body: values.body,
        createdAt: values.createdAt,
        now,
        attachments: installed,
      });
      if (!note) throw new ProjectNotFoundError();
      return {
        ...note,
        body: values.body,
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
    const values = updateNoteCommandSchema.parse(input);
    const replaceAttachments =
      values.replaceAttachments === true ||
      values.keepAttachmentIds !== undefined ||
      values.attachments.length > 0;
    const now = this.clock();
    const installed = this.installAttachments(values.attachments, now);
    let result: ReturnType<SqliteChatRepository["updateNote"]>;
    try {
      result = this.repository.updateNote(chatId, noteId, {
        body: values.body,
        createdAt: values.createdAt,
        now,
        keepAttachmentIds: replaceAttachments
          ? (values.keepAttachmentIds ?? [])
          : undefined,
        attachments: replaceAttachments ? installed : undefined,
      });
    } catch (error) {
      this.cleanup(installed.map((attachment) => attachment.storagePath));
      if (error instanceof InvalidAttachmentSelectionError) {
        throw new InvalidInputError();
      }
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

  setNoteLabel(
    chatId: string,
    noteId: string,
    input: unknown,
    applied: boolean,
  ): Label[] {
    const label = labelSchema.parse(input);
    const labels = this.repository.setNoteLabel(chatId, noteId, label, applied);
    if (labels === undefined) throw new ProjectNotFoundError();
    if (labels === null) throw new InvalidInputError();
    return labels;
  }

  async openAttachment(
    chatId: string,
    noteId: string,
    attachmentId: string,
  ): Promise<void> {
    const attachment = this.requireScopedAttachment(
      chatId,
      noteId,
      attachmentId,
    );
    const refreshed = this.refreshAttachment(attachment);
    if (refreshed.status !== "available") {
      throw new AttachmentUnavailableError(refreshed.status);
    }
    const target = this.resolveAvailableTarget(attachment.storagePath);
    if (
      attachmentOpenPolicy({
        displayFilename: attachment.filename,
        managedFilename: target.managedFilename,
        mode: target.mode,
        platform: this.requireNativeFileActions().platform,
      }) === "blocked"
    ) {
      throw new AttachmentOpenBlockedError();
    }
    const actions = this.requireNativeFileActions();
    if (!actions.supported) throw new NativeFileActionUnsupportedError();
    await this.runNativeAction(() => actions.open(target.absolutePath));
  }

  async revealAttachment(
    chatId: string,
    noteId: string,
    attachmentId: string,
  ): Promise<void> {
    const attachment = this.requireScopedAttachment(
      chatId,
      noteId,
      attachmentId,
    );
    const refreshed = this.refreshAttachment(attachment);
    const actions = this.requireNativeFileActions();
    if (!actions.supported) throw new NativeFileActionUnsupportedError();
    const containingDirectory = this.resolveSafeContainingDirectory(
      attachment.storagePath,
    );
    const path =
      refreshed.status === "available"
        ? this.resolveAvailableTarget(attachment.storagePath).absolutePath
        : containingDirectory;
    await this.runNativeAction(() => actions.reveal(path, containingDirectory));
  }

  private refreshAttachment(attachment: StoredNoteAttachment): NoteAttachment {
    const observation = this.requireAttachmentStore().observe(
      attachment.storagePath,
    );
    if (observation.status !== "available") {
      return {
        ...this.toPublicAttachment(attachment),
        status: observation.status,
        actions: this.actionCapabilities(attachment, observation.status),
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
      actions: this.actionCapabilities(attachment, "available"),
    };
  }

  private requireScopedAttachment(
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

  private actionCapabilities(
    attachment: StoredNoteAttachment,
    status: NoteAttachment["status"],
  ): NoteAttachment["actions"] {
    const actions = this.nativeFileActions;
    if (!actions?.supported) {
      return { open: "unsupported", reveal: "unsupported" };
    }
    let reveal: NonNullable<NoteAttachment["actions"]>["reveal"] =
      "unavailable";
    try {
      this.resolveSafeContainingDirectory(attachment.storagePath);
      reveal = "available";
    } catch {
      // Unsafe or unavailable ancestors cannot be revealed.
    }
    if (status !== "available") return { open: "unavailable", reveal };
    try {
      const target = this.resolveAvailableTarget(attachment.storagePath);
      return {
        open: attachmentOpenPolicy({
          displayFilename: attachment.filename,
          managedFilename: target.managedFilename,
          mode: target.mode,
          platform: actions.platform,
        }),
        reveal,
      };
    } catch {
      return { open: "unavailable", reveal };
    }
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

  private resolveAvailableTarget(storagePath: string) {
    const resolver = this.requireAttachmentStore().resolveAvailableTarget;
    if (!resolver)
      throw new Error("Native attachment actions are unavailable.");
    try {
      return resolver.call(this.attachmentStore, storagePath);
    } catch (error) {
      if (error instanceof ManagedAttachmentUnavailableError) {
        throw new AttachmentUnavailableError(error.status);
      }
      throw error;
    }
  }

  private resolveSafeContainingDirectory(storagePath: string): string {
    const resolver =
      this.requireAttachmentStore().resolveSafeContainingDirectory;
    if (!resolver)
      throw new Error("Native attachment actions are unavailable.");
    try {
      return resolver.call(this.attachmentStore, storagePath);
    } catch (error) {
      if (error instanceof ManagedAttachmentUnavailableError) {
        throw new AttachmentUnavailableError(error.status);
      }
      throw error;
    }
  }

  private requireNativeFileActions(): NativeFileActions {
    if (!this.nativeFileActions) {
      throw new NativeFileActionUnsupportedError();
    }
    return this.nativeFileActions;
  }

  private async runNativeAction(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (
        error instanceof NativeFileActionUnsupportedError ||
        error instanceof NativeFileActionFailedError
      ) {
        throw error;
      }
      throw new NativeFileActionFailedError();
    }
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
      actions: this.actionCapabilities(attachment, attachment.status),
    };
  }
}
