import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { isEmptyLabelDraft, type LabelDraft } from "./label-drafts.js";

interface Drag {
  element: HTMLButtonElement;
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moving: boolean;
  grabOffset: number;
  target?: string;
}

export function useLabelReordering(
  labels: LabelDraft[],
  onChange: (labels: LabelDraft[]) => void,
  disabled: boolean,
) {
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    source: string;
    target?: string;
    offsetY: number;
    height: number;
  } | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const animation = frame;
    const pointer = drag;
    return () => {
      cancelAnimationFrame(animation.current);
      pointer.current = null;
    };
  }, []);

  function focusHandle(key: string) {
    const previousFocus = document.activeElement;
    requestAnimationFrame(() => {
      // Reordering can detach the focused node. Restore it unless the user has
      // already moved to another control before this animation frame.
      if (
        document.activeElement !== previousFocus &&
        document.activeElement !== document.body
      )
        return;
      Array.from(
        listRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-label-handle]",
        ) ?? [],
      )
        .find((button) => button.dataset.labelHandle === key)
        ?.focus();
    });
  }
  function move(key: string, destination: number) {
    const from = labels.findIndex((label) => label.key === key);
    let last = labels.length - 1;
    while (last >= 2 && isEmptyLabelDraft(labels[last]!)) last--;
    const to = Math.max(2, Math.min(last, destination));
    if (disabled || from < 2 || isEmptyLabelDraft(labels[from]!) || from === to)
      return;
    const next = [...labels];
    const [label] = next.splice(from, 1);
    next.splice(to, 0, label!);
    onChange(next);
    setStatus(`${label!.name || "New label"} moved to position ${to - 1}.`);
    focusHandle(key);
  }
  function cancel() {
    cancelAnimationFrame(frame.current);
    const pointer = drag.current;
    drag.current = null;
    if (pointer) {
      suppressClick.current = true;
      if (pointer.element.hasPointerCapture?.(pointer.pointerId))
        pointer.element.releasePointerCapture(pointer.pointerId);
    }
    setPreview(null);
    setPicked(null);
  }
  function updateTarget() {
    const pointer = drag.current;
    const list = listRef.current;
    if (!pointer?.moving || !list) return;
    const bounds = list.getBoundingClientRect();
    const rows = Array.from(
      list.querySelectorAll<HTMLElement>(
        "[data-label-key][data-sortable=true]",
      ),
    );
    const source = rows
      .find((row) => row.dataset.labelKey === pointer.key)
      ?.getBoundingClientRect();
    const height = source?.height ?? 0;
    const center = pointer.y - pointer.grabOffset + height / 2;
    let target: string | undefined;
    if (pointer.x >= bounds.left && pointer.x <= bounds.right) {
      let distance = Infinity;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        const delta = Math.abs(center - (rect.top + rect.height / 2));
        if (delta < distance) {
          distance = delta;
          target = row.dataset.labelKey;
        }
      }
    }
    pointer.target = target;
    const offsetY = source ? pointer.y - pointer.grabOffset - source.top : 0;
    setPreview((old) =>
      old?.source === pointer.key &&
      old.target === target &&
      old.offsetY === offsetY &&
      old.height === height
        ? old
        : { source: pointer.key, target, offsetY, height },
    );
  }
  function animate() {
    const pointer = drag.current;
    if (!pointer?.moving) return;
    const scroller = listRef.current?.closest<HTMLElement>(
      ".project-edit-workspace",
    );
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const edge = 40;
      const top = Math.max(0, rect.top);
      const bottom = Math.min(innerHeight, rect.bottom);
      const delta =
        pointer.y < top + edge ? -12 : pointer.y > bottom - edge ? 12 : 0;
      if (delta) scroller.scrollTop += delta;
    }
    updateTarget();
    frame.current = requestAnimationFrame(animate);
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, key: string) {
    if (disabled || event.button !== 0 || drag.current) return;
    suppressClick.current = false;
    drag.current = {
      element: event.currentTarget,
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moving: false,
      grabOffset:
        event.clientY -
        (event.currentTarget
          .closest("[data-label-key]")
          ?.getBoundingClientRect().top ?? event.clientY),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const pointer = drag.current;
    if (!pointer || pointer.pointerId !== event.pointerId || disabled) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (
      !pointer.moving &&
      Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) >= 5
    ) {
      pointer.moving = true;
      setPicked(null);
      animate();
    }
    if (pointer.moving) {
      event.preventDefault();
      updateTarget();
    }
  }
  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const pointer = drag.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointer.moving) {
      updateTarget();
      if (pointer.target)
        move(
          pointer.key,
          labels.findIndex((label) => label.key === pointer.target),
        );
      suppressClick.current = true;
      cancel();
    } else drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function click(event: MouseEvent<HTMLButtonElement>, key: string) {
    if (suppressClick.current && event.detail !== 0) {
      suppressClick.current = false;
      return;
    }
    if (disabled) return;
    if (picked && picked !== key) {
      move(
        picked,
        labels.findIndex((label) => label.key === key),
      );
      setPicked(null);
    } else {
      setPicked(picked === key ? null : key);
      setStatus(
        picked === key
          ? "Reordering cancelled."
          : `${labels.find((label) => label.key === key)?.name || "New label"} selected. Choose a handle at the new position.`,
      );
    }
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, key: string) {
    const index = labels.findIndex((label) => label.key === key);
    const destinations: Record<string, number> = {
      ArrowUp: index - 1,
      ArrowDown: index + 1,
      Home: 2,
      End: labels.length - 1,
    };
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      setStatus("Reordering cancelled.");
    } else if (event.key in destinations) {
      event.preventDefault();
      move(key, destinations[event.key]!);
    }
  }

  function lostCapture(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId === event.pointerId) cancel();
  }
  return {
    listRef,
    picked,
    preview,
    status,
    cancel,
    pointerDown,
    pointerMove,
    pointerUp,
    lostCapture,
    click,
    keyDown,
  };
}
