import { useState, type ReactNode } from "react";

import type { Chat } from "../domain/types.js";
import { MAX_BATCH_NOTES, type BatchNotesInput } from "../domain/validation.js";

import type { SelectionAction } from "./useMessageSelection.js";

type Transfer = Exclude<BatchNotesInput["action"], "delete">;

export function MessageDestinationPicker({
  chats,
  sourceId,
  action,
  count,
  busy,
  error,
  onBack,
  onConfirm,
  backIcon,
}: {
  chats: Chat[];
  sourceId: string;
  action: Transfer;
  count: number;
  busy: boolean;
  error: string;
  onBack: () => void;
  onConfirm: (chatId: string) => void;
  backIcon: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [destination, setDestination] = useState("");
  const [expanded, setExpanded] = useState(new Map<string, boolean>());
  const verb = action === "copy" ? "Copy" : "Move";
  const title = `${verb} ${count} ${count === 1 ? "message" : "messages"}`;
  const normalized = query.trim().toLocaleLowerCase();
  const children = new Map<string, Chat[]>();
  for (const chat of chats) {
    if (!chat.projectId || chat.archivedAt != null || chat.id === sourceId)
      continue;
    const group = children.get(chat.projectId) ?? [];
    group.push(chat);
    children.set(chat.projectId, group);
  }
  const selectedChat = chats.find((chat) => chat.id === destination);
  const rows: { chat: Chat; name: string; open?: boolean }[] = [];
  for (const project of chats) {
    if (project.projectId || project.archivedAt != null) continue;
    const matches = (children.get(project.id) ?? []).filter((child) =>
      `${project.title} / ${child.title}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
    const matchesRoot =
      project.id !== sourceId &&
      project.title.toLocaleLowerCase().includes(normalized);
    if (!matchesRoot && !matches.length) continue;
    const open = matches.length
      ? (expanded.get(project.id) ??
        (Boolean(normalized) || selectedChat?.projectId === project.id))
      : undefined;
    rows.push({ chat: project, name: project.title, open });
    if (open) {
      for (const child of matches)
        rows.push({ chat: child, name: `${project.title} / ${child.title}` });
    }
  }
  const valid =
    destination !== sourceId &&
    rows.some(({ chat }) => chat.id === destination);
  return (
    <main
      className="workspace settings-workspace project-edit-workspace batch-destination"
      aria-label={verb + " messages"}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          onBack();
        }
      }}
    >
      <form
        className="project-edit-form project-settings-fields"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !busy) onConfirm(destination);
        }}
      >
        <button
          type="button"
          className="settings-back-button"
          aria-label="Back to messages"
          disabled={busy}
          onClick={onBack}
        >
          {backIcon}
        </button>
        <h1>{title}</h1>
        <input
          type="search"
          className="text-input"
          aria-label="Find a thread or subthread"
          placeholder="Find a thread or subthread"
          autoFocus
          value={query}
          disabled={busy}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setExpanded(new Map());
          }}
        />
        <section
          className="batch-destination-list"
          aria-label="Destination conversations"
        >
          {rows.length ? (
            <ul className="project-items">
              {rows.map(({ chat, name, open }) => {
                const selected = chat.id === destination;
                const source = chat.id === sourceId;
                return (
                  <li
                    key={chat.id}
                    className={`project-row${chat.projectId ? " project-row--subthread" : ""}${selected ? " project-row--active" : ""}`}
                    data-accent={chat.accent}
                  >
                    <button
                      type="button"
                      className="project-item"
                      aria-label={name}
                      aria-expanded={open}
                      aria-pressed={source ? undefined : selected}
                      disabled={busy}
                      onClick={() => {
                        if (open !== undefined) {
                          const nextOpen = source || selected ? !open : true;
                          setExpanded((current) =>
                            new Map(current).set(chat.id, nextOpen),
                          );
                        }
                        setDestination(source ? "" : chat.id);
                      }}
                    >
                      <span className="project-item-copy">
                        <strong title={chat.title}>{chat.title}</strong>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="field-help">
              {normalized
                ? "No matching conversations."
                : "No other conversations yet."}
            </p>
          )}
        </section>
        <div className="batch-destination-footer">
          {error && (
            <p className="composer-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button-primary"
            type="submit"
            disabled={!valid || busy}
          >
            {busy ? (action === "copy" ? "Copying…" : "Moving…") : title}
          </button>
        </div>
      </form>
    </main>
  );
}

export function MessageSelectionBar({
  count,
  source,
  confirming,
  busy,
  error,
  onCancel,
  onSelectAll,
  onAction,
  onConfirm,
}: {
  count: number;
  source: string;
  confirming: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSelectAll: () => void;
  onAction: (action: SelectionAction) => void;
  onConfirm: () => void;
}) {
  const number = `${count} ${count === 1 ? "message" : "messages"}`;
  return (
    <div
      className="message-selection-bar"
      role="group"
      aria-label="Selected message actions"
    >
      <strong role="status">
        {confirming ? `Delete ${number} from ${source}?` : `${count} selected`}
      </strong>
      <div className="message-selection-buttons">
        {!confirming && (
          <button
            type="button"
            className="button button-quiet"
            onClick={onSelectAll}
          >
            Select all
          </button>
        )}
        <button
          type="button"
          className="button button-quiet"
          disabled={busy}
          onClick={onCancel}
          data-selection-cancel
        >
          Cancel
        </button>
        {confirming ? (
          <button
            type="button"
            className="button button-danger"
            disabled={busy || !count}
            onClick={onConfirm}
          >
            {busy ? "Deleting…" : "Delete " + number}
          </button>
        ) : (
          (["copy", "move", "export", "delete"] as const).map((action) => (
            <button
              key={action}
              type="button"
              className={
                action === "delete"
                  ? "button batch-delete"
                  : "button batch-transfer"
              }
              data-selection-action={action}
              disabled={!count}
              onClick={() => onAction(action)}
            >
              {action[0].toUpperCase() + action.slice(1)}
            </button>
          ))
        )}
      </div>
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      {!error && count >= MAX_BATCH_NOTES && (
        <p className="field-help">
          Up to {MAX_BATCH_NOTES.toLocaleString()} messages can be selected at
          once.
        </p>
      )}
    </div>
  );
}
