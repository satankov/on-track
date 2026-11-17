import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Note } from "../domain/types.js";
import { MAX_BATCH_NOTES, type BatchNotesInput } from "../domain/validation.js";
import {
  captureReadingPosition,
  restoreReadingPosition,
  type ReadingPosition,
} from "./history-position.js";

const selectionChanged = "The visible messages changed. Review your selection.";

export function useMessageSelection(
  historyRef: RefObject<HTMLElement | null>,
  workspaceRef: RefObject<HTMLElement | null>,
  visibleIds: ReadonlySet<string>,
  onBatchNotes?: (input: BatchNotesInput) => Promise<void>,
) {
  const [batchStage, setBatchStage] = useState<
    "select" | BatchNotesInput["action"]
  >();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [batchError, setBatchError] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const batchInFlight = useRef(false);
  const [batchNotice, setBatchNotice] = useState<{
    text: string;
    destination?: string;
  }>();
  const openerId = useRef("");
  const rangeAnchor = useRef("");
  const nextFocus = useRef<
    { id?: string; action?: string; selector?: string } | undefined
  >(undefined);
  const selectionStart = useRef<ReadingPosition | undefined>(undefined);
  const batchPosition = useRef<ReadingPosition | undefined>(undefined);
  const isPicker = batchStage === "copy" || batchStage === "move";
  useLayoutEffect(() => {
    const target =
      nextFocus.current ??
      (batchStage === "select" && batchError === selectionChanged
        ? { selector: "[data-select-note]:checked, [data-selection-cancel]" }
        : undefined);
    if (isPicker || !target) return;
    nextFocus.current = undefined;
    const host = workspaceRef.current;
    if (batchPosition.current && historyRef.current) {
      restoreReadingPosition(historyRef.current, batchPosition.current);
      batchPosition.current = undefined;
    }
    const element = target.id
      ? [...(host?.querySelectorAll<HTMLElement>("[data-note-id]") ?? [])]
          .find((row) => row.dataset.noteId === target.id)
          ?.querySelector<HTMLElement>(
            batchStage
              ? "[data-select-note]"
              : "[aria-label='More message actions']",
          )
      : host?.querySelector<HTMLElement>(
          target.selector ?? `[data-selection-action="${target.action}"]`,
        );
    (element ?? historyRef.current)?.focus({ preventScroll: true });
  }, [batchStage, batchError, isPicker, historyRef, workspaceRef]);

  // Selection always describes messages the user can still inspect. A refresh
  // can remove a note or change whether it matches the current search/filter.
  if (
    batchStage &&
    !batchBusy &&
    [...selected].some((id) => !visibleIds.has(id))
  ) {
    const remaining = new Set([...selected].filter((id) => visibleIds.has(id)));
    setSelected(remaining);
    setBatchStage("select");
    setBatchError(selectionChanged);
  }
  function endSelection() {
    if (batchInFlight.current) return;
    batchPosition.current = selectionStart.current;
    nextFocus.current = { id: openerId.current };
    setBatchStage(undefined);
    setBatchError("");
    setSelected(new Set());
  }

  function resetSelectionForFilter() {
    if (!batchStage || batchInFlight.current) return;
    setBatchStage(undefined);
    setBatchError("");
    setSelected(new Set());
  }

  function beginSelection(note: Note) {
    selectionStart.current = historyRef.current
      ? captureReadingPosition(historyRef.current)
      : undefined;
    batchPosition.current = selectionStart.current;
    openerId.current = note.id;
    rangeAnchor.current = note.id;
    nextFocus.current = { id: note.id };
    setBatchNotice(undefined);
    setSelected(new Set([note.id]));
    setBatchStage("select");
  }

  function applySelection(next: ReadonlySet<string>) {
    if (next.size > MAX_BATCH_NOTES) {
      setBatchError(
        `This would select ${next.size.toLocaleString()} messages. Select up to ${MAX_BATCH_NOTES.toLocaleString()} at a time.`,
      );
      return false;
    }
    setSelected(next);
    setBatchError("");
    return true;
  }

  function toggleSelected(id: string, extendRange = false) {
    if (!visibleIds.has(id)) return;
    const next = new Set(selected);
    if (extendRange && visibleIds.has(rangeAnchor.current)) {
      const orderedIds = [...visibleIds];
      const anchorIndex = orderedIds.indexOf(rangeAnchor.current);
      const targetIndex = orderedIds.indexOf(id);
      const first = Math.min(anchorIndex, targetIndex);
      const last = Math.max(anchorIndex, targetIndex);
      for (const rowId of orderedIds.slice(first, last + 1)) next.add(rowId);
      applySelection(next);
      return;
    }
    if (next.has(id) && !extendRange) next.delete(id);
    else next.add(id);
    if (applySelection(next)) rangeAnchor.current = id;
  }

  function chooseBatchAction(action: BatchNotesInput["action"]) {
    if (action === "delete")
      nextFocus.current = { selector: "[data-selection-cancel]" };
    else if (historyRef.current)
      batchPosition.current = captureReadingPosition(historyRef.current);
    setBatchError("");
    setBatchStage(action);
  }

  function backToSelection() {
    if (batchInFlight.current) return;
    nextFocus.current = { action: batchStage };
    setBatchError("");
    setBatchStage("select");
  }

  async function submitBatch(destinationChatId?: string) {
    if (
      !onBatchNotes ||
      !batchStage ||
      batchStage === "select" ||
      !selected.size ||
      batchInFlight.current
    )
      return;
    const noteIds = [...selected];
    let input: BatchNotesInput;
    if (batchStage === "delete") input = { action: "delete", noteIds };
    else if (destinationChatId)
      input = { action: batchStage, noteIds, destinationChatId };
    else return;
    batchInFlight.current = true;
    setBatchBusy(true);
    setBatchError("");
    try {
      await onBatchNotes(input);
      const verb = { copy: "copied", move: "moved", delete: "deleted" }[
        batchStage
      ];
      setBatchNotice({
        text: `${noteIds.length} ${noteIds.length === 1 ? "message" : "messages"} ${verb}.`,
        destination: destinationChatId,
      });
      batchPosition.current = selectionStart.current;
      nextFocus.current = destinationChatId
        ? { selector: "[data-open-destination]" }
        : { selector: ".history" };
      setSelected(new Set());
      setBatchStage(undefined);
    } catch (caught) {
      setBatchError(
        caught instanceof Error
          ? caught.message
          : "The message action could not be completed.",
      );
    } finally {
      batchInFlight.current = false;
      setBatchBusy(false);
    }
  }

  return {
    stage: batchStage,
    selected,
    busy: batchBusy,
    error: batchError,
    notice: batchNotice,
    isPicker,
    begin: beginSelection,
    toggle: toggleSelected,
    selectAll: () => applySelection(visibleIds),
    choose: chooseBatchAction,
    back: backToSelection,
    cancel: endSelection,
    clearOnFilter: resetSelectionForFilter,
    submit: submitBatch,
  };
}
