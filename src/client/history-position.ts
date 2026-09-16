import { useLayoutEffect, useRef, type RefObject } from "react";

export interface ReadingPosition {
  noteId: string;
  createdAt: number;
  offset: number;
}

function messageRows(history: HTMLElement): HTMLElement[] {
  return [...history.querySelectorAll<HTMLElement>("[data-note-id]")];
}

export function captureReadingPosition(
  history: HTMLElement,
): ReadingPosition | undefined {
  const top = history.getBoundingClientRect().top;
  const row = messageRows(history).find(
    (row) => row.getBoundingClientRect().bottom > top,
  );
  if (!row) return undefined;
  return {
    noteId: row.dataset.noteId!,
    createdAt: Number(row.dataset.createdAt),
    offset: row.getBoundingClientRect().top - top,
  };
}

export function restoreReadingPosition(
  history: HTMLElement,
  position?: ReadingPosition,
  now = Date.now(),
): void {
  const rows = messageRows(history);
  if (rows.length === 0) return;
  const box = history.getBoundingClientRect();
  if (position) {
    const row =
      rows.find((row) => row.dataset.noteId === position.noteId) ??
      rows.find((row) => Number(row.dataset.createdAt) >= position.createdAt) ??
      rows.at(-1)!;
    const rowBox = row.getBoundingClientRect();
    // Expanded messages may start collapsed again on return. Keep the anchor
    // visible rather than applying an offset beyond its new, shorter height.
    const offset =
      position.offset <= -rowBox.height
        ? Math.min(0, 48 - rowBox.height)
        : position.offset;
    history.scrollTop += rowBox.top - box.top - offset;
    return;
  }
  const firstFutureIndex = rows.findIndex(
    (row) => Number(row.dataset.createdAt) > now,
  );
  if (firstFutureIndex === 0) {
    history.scrollTop = 0;
  } else if (firstFutureIndex === -1) {
    history.scrollTop = history.scrollHeight;
  } else {
    const firstFuture = rows[firstFutureIndex].getBoundingClientRect();
    // Keep past context visible even when a future message is taller than the pane.
    const futureHeight = Math.min(
      firstFuture.height,
      history.clientHeight * 0.5,
    );
    history.scrollTop += firstFuture.top + futureHeight - box.bottom;
  }
}

/** Session-owned positions outlive the workspace, but never enter project data. */
export function useHistoryPosition(
  historyRef: RefObject<HTMLElement | null>,
  projectId: string,
  filter: string,
  positions: Map<string, ReadingPosition>,
  startAtBeginning = false,
): (nextFilter: string) => void {
  const active = useRef<{
    filter: string;
    save: () => void;
    pause: () => void;
  } | null>(null);

  // Registered before the transition effect so unmount captures the current
  // workspace before that effect disables saving and cancels its frame.
  useLayoutEffect(() => {
    return () => active.current?.save();
  }, [historyRef, projectId, positions]);

  useLayoutEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    let initialized = false;
    const save = () => {
      if (!initialized || filter !== "all") return;
      const position = captureReadingPosition(history);
      if (position) positions.set(projectId, position);
    };
    // Child layout effects first settle collapsed Markdown heights. Restore once
    // per actual filter transition, without reacting to edits or clock ticks.
    const frame = requestAnimationFrame(() => {
      if (startAtBeginning && filter === "all" && !positions.has(projectId))
        history.scrollTop = 0;
      else
        restoreReadingPosition(
          history,
          filter === "all" ? positions.get(projectId) : undefined,
        );
      initialized = true;
      save();
    });
    active.current = {
      filter,
      save,
      pause: () => {
        initialized = false;
        cancelAnimationFrame(frame);
      },
    };
    history.addEventListener("scroll", save, { passive: true });
    return () => {
      initialized = false;
      cancelAnimationFrame(frame);
      history.removeEventListener("scroll", save);
    };
  }, [historyRef, projectId, positions, filter, startAtBeginning]);

  return (nextFilter) => {
    if (!active.current || active.current.filter === nextFilter) return;
    // Capture All while its rows still exist. Scroll events caused by replacing
    // them must not overwrite that anchor before the next restoration frame.
    active.current.save();
    active.current.pause();
  };
}
