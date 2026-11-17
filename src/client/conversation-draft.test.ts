import { describe, it, expect, vi } from "vitest";
import {
  EMPTY_DRAFT_FIELDS,
  type ConversationDraft,
} from "../domain/drafts.js";
import { DraftSession } from "./conversation-draft.js";
import { RequestError, type ApiClient } from "./api.js";

const blank: ConversationDraft = {
  ...EMPTY_DRAFT_FIELDS,
  attachments: [],
  revision: null,
};
const first = {
  id: "a",
  filename: "a.txt",
  byteSize: 1,
  status: "available" as const,
};
const note = {
  id: "r1",
  chatId: "chat",
  body: "text",
  createdAt: 1,
  sender: null,
  labels: [],
  draftRevision: "next",
};
function fixture() {
  const api = {
    getDraft: vi.fn<ApiClient["getDraft"]>().mockResolvedValue(blank),
    saveDraft: vi.fn<ApiClient["saveDraft"]>(async (_id, input) => ({
      ...blank,
      ...input,
      revision: "r1",
    })),
    sendDraft: vi.fn<ApiClient["sendDraft"]>().mockResolvedValue(note),
  };
  return { api, draft: new DraftSession(api, "chat") };
}
describe("conversation draft", () => {
  it("serializes typing and removal during a file upload without resending bytes", async () => {
    const { draft, api } = fixture();
    await draft.load();
    let finish!: (value: ConversationDraft) => void;
    api.saveDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const a = new File(["a"], "a.txt"),
      b = new File(["b"], "b.txt");
    draft.edit({ body: "one", files: [a] });
    const saved = draft.flush();
    draft.edit({ body: "two", files: [a, b] });
    finish({ ...blank, body: "one", revision: "upload", attachments: [first] });
    await saved;
    expect(api.saveDraft).toHaveBeenNthCalledWith(
      2,
      "chat",
      expect.objectContaining({
        revision: "upload",
        body: "two",
        keepAttachmentIds: ["a"],
      }),
      [b],
    );
    expect(draft.snapshot().body).toBe("two");
    draft.dispose();
  });
  it("retains typed text after a stale write and lets the user explicitly load the other tab's version", async () => {
    const { draft, api } = fixture();
    draft.edit({ body: "premature" });
    expect(draft.snapshot().body).toBe("");
    await draft.load();
    api.saveDraft.mockRejectedValueOnce(
      new RequestError(409, "Draft changed in another tab.", "draft_conflict"),
    );
    draft.edit({ body: "my text" });
    await expect(draft.flush()).rejects.toThrow("another tab");
    draft.edit({ body: "my newer text" });
    await draft.load();
    expect(draft.snapshot()).toMatchObject({
      body: "my newer text",
      status: "conflict",
    });
    await expect(draft.send()).rejects.toThrow("another tab");
    api.getDraft.mockResolvedValue({
      ...blank,
      revision: "other",
      body: "other tab",
    });
    await draft.load(true);
    expect(draft.snapshot()).toMatchObject({ body: "other tab", ready: true });
    expect(api.sendDraft).not.toHaveBeenCalled();
    draft.dispose();
  });
  it("keeps files and unsent text after a failed save and retries a lost send using the original revision", async () => {
    const { draft, api } = fixture();
    api.getDraft.mockRejectedValueOnce(new Error("Offline"));
    await draft.load();
    expect(draft.snapshot()).toMatchObject({ ready: false, status: "error" });
    await draft.load();
    draft.edit({ body: "text", sender: "Maya" });
    api.saveDraft.mockRejectedValueOnce(new Error("Disk full"));
    await expect(draft.send()).rejects.toThrow("Disk full");
    expect(api.sendDraft).not.toHaveBeenCalled();
    api.sendDraft.mockRejectedValueOnce(new TypeError("Connection lost"));
    await expect(draft.send()).rejects.toThrow("Connection lost");
    expect(draft.snapshot().body).toBe("text");
    api.sendDraft.mockResolvedValueOnce({ ...note, replayed: true });
    api.getDraft.mockResolvedValue({
      ...blank,
      revision: "other",
      body: "Newer outgoing draft",
    });
    expect(await draft.send()).toMatchObject({ id: "r1" });
    expect(api.sendDraft.mock.calls).toEqual([
      ["chat", "r1", undefined],
      ["chat", "r1", undefined],
    ]);
    expect(draft.snapshot().body).toBe("Newer outgoing draft");
    draft.dispose();
  });
  it("recovers after a managed draft attachment disappears before send", async () => {
    const { draft, api } = fixture();
    const saved = {
      ...blank,
      revision: "current",
      body: "keep this text",
      attachments: [first],
    };
    api.getDraft.mockResolvedValueOnce(saved).mockResolvedValueOnce({
      ...saved,
      attachments: [{ ...first, status: "missing" }],
    });
    await draft.load();
    api.sendDraft.mockRejectedValueOnce(
      new RequestError(409, "The file is missing.", "attachment_unavailable"),
    );
    await expect(draft.send()).rejects.toThrow("file is missing");
    expect(draft.snapshot().files).toEqual([{ ...first, status: "missing" }]);
    draft.edit({ files: [] });
    await draft.send();
    expect(api.saveDraft).toHaveBeenCalledWith(
      "chat",
      expect.objectContaining({ body: saved.body, keepAttachmentIds: [] }),
      [],
    );
    expect(api.sendDraft).toHaveBeenCalledTimes(2);
  });
  it("ignores a stale refresh and forgets queued writes after deletion", async () => {
    const { draft, api } = fixture();
    await draft.load();
    let finish!: (value: ConversationDraft) => void;
    api.getDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const waiting = draft.load();
    draft.edit({ body: "local" });
    finish({ ...blank, body: "old" });
    await waiting;
    expect(draft.snapshot().body).toBe("local");
    draft.dispose();
    await draft.flush();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });
});
