import { useLayoutEffect, useRef, type RefObject } from "react";

export interface SendFeedback {
  projectId: string;
  attempt: number;
  noteId?: string;
  savedNoteId?: string;
}

/** Transient paint only: mounting/restoring a workspace never replays a send. */
export function useSendFeedback(
  composerRef: RefObject<HTMLElement | null>,
  historyRef: RefObject<HTMLElement | null>,
  feedback?: SendFeedback,
) {
  const initial = useRef(feedback);
  const attempt = feedback?.attempt;
  const noteId = feedback?.noteId;
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (
      !composer ||
      attempt === undefined ||
      attempt === initial.current?.attempt
    )
      return;
    composer.removeAttribute("data-send-feedback");
    // Own a separate attribute so React class changes (such as leaving edit
    // mode) cannot interrupt the glow. Restart without remounting the editor.
    void composer.offsetWidth;
    composer.setAttribute("data-send-feedback", "");
    const timer = window.setTimeout(
      () => composer.removeAttribute("data-send-feedback"),
      720,
    );
    return () => {
      window.clearTimeout(timer);
      composer.removeAttribute("data-send-feedback");
    };
  }, [composerRef, attempt]);
  useLayoutEffect(() => {
    if (!noteId || noteId === initial.current?.noteId) return;
    const row = [
      ...(historyRef.current?.querySelectorAll<HTMLElement>("[data-note-id]") ??
        []),
    ].find((el) => el.dataset.noteId === noteId);
    if (!row) return;
    row.classList.add("message-row--arriving");
    const timer = window.setTimeout(
      () => row.classList.remove("message-row--arriving"),
      220,
    );
    return () => {
      window.clearTimeout(timer);
      row.classList.remove("message-row--arriving");
    };
  }, [historyRef, noteId]);
}
