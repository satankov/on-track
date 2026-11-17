import { useLayoutEffect, useRef, type RefObject } from "react";

export function useModalDialog(): RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof dialog.showModal !== "function") return;
    dialog.removeAttribute("open");
    // Let the native dialog move initial focus and remember its opener. React
    // autoFocus would move it before showModal can capture the return target.
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return dialogRef;
}
