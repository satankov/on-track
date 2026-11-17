import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  EMPTY_DRAFT_FIELDS as blankFields,
  type ConversationDraft,
  type DraftAttachment,
  type DraftFields,
} from "../domain/drafts.js";
import { RequestError, type ApiClient } from "./api.js";

type DraftApi = Pick<ApiClient, "getDraft" | "saveDraft" | "sendDraft">;
export type ComposerFile = File | DraftAttachment;
export const isLocalFile = (file: ComposerFile): file is File =>
  !("id" in file);
type DraftView = DraftFields & {
  files: ComposerFile[];
  ready: boolean;
  status: "loading" | "idle" | "saving" | "saved" | "error" | "conflict";
  message: string;
};
const initial: DraftView = {
  ...blankFields,
  files: [],
  ready: false,
  status: "loading",
  message: "",
};
const emptyView = () => initial;
const noSubscribe = () => () => {};
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export class DraftSession {
  private view = initial;
  private revision: string | null = null;
  private dirty = false;
  private disposed = false;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private loading?: Promise<void>;
  private writing?: Promise<void>;
  private sending = false;

  constructor(
    private api: DraftApi,
    readonly chatId: string,
  ) {}
  snapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private change(patch: Partial<DraftView>) {
    if (this.disposed) return;
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }
  private adopt(saved: ConversationDraft) {
    this.revision = saved.revision;
    this.dirty = false;
    this.change({
      body: saved.body,
      sender: saved.sender,
      timestamp: saved.timestamp,
      senderOpen: saved.senderOpen,
      timestampOpen: saved.timestampOpen,
      files: saved.attachments,
      ready: true,
      status: "idle",
      message: "",
    });
  }
  load(replace = false): Promise<void> {
    if (this.loading) return this.loading;
    if (
      this.disposed ||
      this.writing ||
      this.sending ||
      (this.dirty && !replace)
    )
      return Promise.resolve();
    const before = this.view;
    this.loading = this.api
      .getDraft(this.chatId)
      .then((saved) => {
        if (before !== this.view || this.disposed) return;
        if (!replace && this.view.ready && this.revision === saved.revision) {
          this.change({ files: saved.attachments });
        } else this.adopt(saved);
      })
      .catch((error) => {
        if (this.view === before && (!before.ready || replace)) {
          this.change({
            status: before.status === "conflict" ? "conflict" : "error",
            message: messageOf(error, "The draft could not be loaded."),
          });
        }
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }
  edit(patch: Partial<DraftFields> & { files?: ComposerFile[] }) {
    if (!this.view.ready || this.disposed || this.sending) return;
    this.dirty = true;
    const conflict = this.view.status === "conflict";
    this.change({
      ...patch,
      ...(conflict ? {} : { status: "saving", message: "" }),
    });
    clearTimeout(this.timer);
    if (!conflict)
      this.timer = setTimeout(() => {
        void this.flush().catch(() => {});
      }, 180);
  }
  get needsSave() {
    return this.dirty || !!this.writing;
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.writing) return this.writing;
    if (this.view.status === "conflict")
      return Promise.reject(new Error(this.view.message));
    if (this.disposed || !this.dirty) return Promise.resolve();
    this.writing = this.writeChanges().finally(() => {
      this.writing = undefined;
    });
    return this.writing;
  }
  private async writeChanges() {
    while (this.dirty && !this.disposed) {
      const { body, sender, timestamp, senderOpen, timestampOpen, files } =
        this.view;
      const uploads = files.filter(isLocalFile);
      const keepAttachmentIds = files
        .filter((file): file is DraftAttachment => !isLocalFile(file))
        .map((file) => file.id);
      this.dirty = false;
      this.change({ status: "saving", message: "" });
      try {
        const saved = await this.api.saveDraft(
          this.chatId,
          {
            revision: this.revision,
            body,
            sender,
            timestamp,
            senderOpen,
            timestampOpen,
            keepAttachmentIds,
          },
          uploads,
        );
        if (this.disposed) return;
        this.revision = saved.revision;
        // A file may be removed or another added while the upload is in flight.
        const replacements = new Map(
          uploads.map((file, i) => [
            file,
            saved.attachments[keepAttachmentIds.length + i],
          ]),
        );
        const retained = new Map(
          saved.attachments.map((file) => [file.id, file]),
        );
        this.change({
          files: this.view.files.map((file) =>
            isLocalFile(file)
              ? (replacements.get(file) ?? file)
              : (retained.get(file.id) ?? file),
          ),
          status: this.dirty ? "saving" : "saved",
        });
      } catch (error) {
        this.dirty = true;
        this.change({
          status:
            error instanceof RequestError && error.code === "draft_conflict"
              ? "conflict"
              : "error",
          message: messageOf(error, "The draft could not be saved."),
        });
        throw error;
      }
    }
  }
  async send(createdAt?: number) {
    if (this.sending) throw new Error("This message is being sent.");
    this.sending = true;
    try {
      await this.flush();
      if (!this.revision) throw new Error("The draft has not finished saving.");
      const sent = await this.api.sendDraft(
        this.chatId,
        this.revision,
        createdAt,
      );
      // The server uses the submitted revision as the message ID, so a retry
      // after connection loss returns the same message and preserves later work.
      this.revision = sent.draftRevision;
      this.dirty = false;
      this.change({
        ...blankFields,
        sender: this.view.sender,
        senderOpen: this.view.senderOpen,
        files: [],
        status: "idle",
        message: "",
      });
      if (sent.replayed) {
        this.change({ ready: false, status: "loading" });
        try {
          this.adopt(await this.api.getDraft(this.chatId));
        } catch {
          this.change({
            status: "error",
            message:
              "The message was sent. Reload the saved draft to continue.",
          });
        }
      }
      return sent;
    } catch (error) {
      if (error instanceof RequestError && error.code === "draft_conflict") {
        this.change({ status: "conflict", message: error.message });
      } else if (
        error instanceof RequestError &&
        error.code === "attachment_unavailable"
      ) {
        // The failed send keeps ownership in the draft. Refresh availability
        // without replacing text or adopting another tab's revision.
        const current = await this.api
          .getDraft(this.chatId)
          .catch(() => undefined);
        if (current && current.revision === this.revision)
          this.change({ files: current.attachments });
      }
      throw error;
    } finally {
      this.sending = false;
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.listeners.clear();
  }
}

export function useConversationDraft(api: DraftApi, chatId?: string) {
  const [sessions] = useState(() => new Map<string, DraftSession>());
  const session = useMemo(() => {
    if (!chatId) return;
    let item = sessions.get(chatId);
    if (!item) {
      item = new DraftSession(api, chatId);
      sessions.set(chatId, item);
    }
    return item;
  }, [api, chatId, sessions]);
  const view = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.snapshot ?? emptyView,
  );
  useEffect(() => {
    if (!session) return;
    void session.load();
    const focus = () => {
      if (session.snapshot().status !== "conflict") void session.load();
    };
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("focus", focus);
      if (session.needsSave) void session.flush().catch(() => {});
    };
  }, [session]);
  useEffect(() => {
    const flush = () => {
      for (const item of sessions.values())
        if (item.needsSave) void item.flush().catch(() => {});
    };
    const hide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const leaving = (event: BeforeUnloadEvent) => {
      if ([...sessions.values()].some((item) => item.needsSave)) {
        flush();
        event.preventDefault();
        event.returnValue = true;
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", leaving);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", leaving);
    };
  }, [sessions]);
  function forget(id: string) {
    sessions.get(id)?.dispose();
    sessions.delete(id);
  }
  return {
    view,
    session,
    forget,
    clear: () => {
      for (const id of sessions.keys()) forget(id);
    },
    flush: (ids?: ReadonlySet<string>) =>
      [...sessions.values()]
        .filter((item) => item.needsSave && (!ids || ids.has(item.chatId)))
        .map((item) => item.flush()),
  };
}
