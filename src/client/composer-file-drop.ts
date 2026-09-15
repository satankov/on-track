import { useEffect, useEffectEvent, useState, type RefObject } from "react";

function containsFiles(transfer: DataTransfer | null): boolean {
  return (
    !!transfer &&
    (Array.from(transfer.types).includes("Files") ||
      Array.from(transfer.items ?? []).some((item) => item.kind === "file"))
  );
}

export function useComposerFileDrop(
  composerRef: RefObject<HTMLDivElement | null>,
  saving: boolean,
  onFilesSelected: (files: File[]) => void,
) {
  const [active, setActive] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const selectFiles = useEffectEvent(onFilesSelected);

  useEffect(() => {
    let depth = 0;
    const withinComposer = (target: EventTarget | null) =>
      target instanceof Node && !!composerRef.current?.contains(target);
    const reset = () => {
      depth = 0;
      setActive(false);
      setOver(false);
    };
    const enter = (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;
      depth += 1;
      if (!saving) setActive(true);
    };
    const dragOver = (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;
      event.preventDefault();
      const accepted = !saving && withinComposer(event.target);
      event.dataTransfer!.dropEffect = accepted ? "copy" : "none";
      setActive(!saving);
      setOver(accepted);
    };
    const leave = (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) reset();
      else if (!withinComposer(event.relatedTarget)) setOver(false);
    };
    const drop = (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;
      event.preventDefault();
      reset();
      if (saving || !withinComposer(event.target)) return;
      const transfer = event.dataTransfer!;
      // Never traverse directories or turn dragged text/URLs into downloads.
      if (
        Array.from(transfer.items ?? []).some(
          (item) =>
            item.kind === "file" && item.webkitGetAsEntry?.()?.isDirectory,
        )
      ) {
        setError(
          "Folders cannot be attached. Choose individual files instead.",
        );
        return;
      }
      const files = Array.from(transfer.files);
      if (files.length === 0) return;
      setError("");
      selectFiles(files);
    };
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") reset();
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", dragOver);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", keyDown);
    return () => {
      reset();
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("keydown", keyDown);
    };
  }, [composerRef, saving]);

  return {
    active: active && !saving,
    over: over && !saving,
    error,
    clearError: () => setError(""),
  };
}
