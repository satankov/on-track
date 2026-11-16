import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export function MessagePopover({
  label,
  icon,
  menu = false,
  onBlocked,
  onOpen,
  children,
}: {
  label: string;
  icon: ReactNode;
  menu?: boolean;
  onBlocked?: () => void;
  onOpen?: () => void;
  children: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const usingMouse = useRef(false);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const row = root?.closest<HTMLElement>(".message-row");
    function dismissOnMouseLeave(event: PointerEvent) {
      if (event.pointerType === "mouse" && usingMouse.current) close();
    }
    row?.addEventListener("pointerleave", dismissOnMouseLeave);
    const dismissOutside = (event: Event) => {
      // WebKit can focus the message row while pressing a checkbox inside its popup.
      if (event.type === "focusin" && event.target === row) return;
      if (!root?.contains(event.target as Node)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      row?.removeEventListener("pointerleave", dismissOnMouseLeave);
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    const history = rootRef.current?.closest(".history");
    if (!trigger || !popover || !history) return;
    let horizontalShift = 0;
    const position = () => {
      const button = trigger.getBoundingClientRect();
      const bounds = history.getBoundingClientRect();
      const above = Math.max(0, button.top - Math.max(0, bounds.top) - 7);
      const below = Math.max(
        0,
        Math.min(window.innerHeight, bounds.bottom) - button.bottom - 7,
      );
      const up = popover.scrollHeight > below && above > below;
      popover.dataset.side = up ? "up" : "down";
      popover.style.maxHeight = `${up ? above : below}px`;
      const menu = popover.getBoundingClientRect();
      const naturalLeft = menu.left - horizontalShift;
      const leftEdge = Math.max(0, bounds.left) + 8;
      const rightEdge = Math.min(window.innerWidth, bounds.right) - 8;
      const left = Math.max(
        leftEdge,
        Math.min(naturalLeft, rightEdge - menu.width),
      );
      horizontalShift = left - naturalLeft;
      popover.style.transform = `translateX(${horizontalShift}px)`;
      // The transparent gap follows the whole popup, including its viewport shift.
      rootRef.current?.style.setProperty(
        "--popup-gap-left",
        `${left - button.left}px`,
      );
      rootRef.current?.style.setProperty(
        "--popup-gap-width",
        `${menu.width}px`,
      );
    };
    position();
    if (menu)
      popover
        .querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus({ preventScroll: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(position);
    observer?.observe(history);
    observer?.observe(popover);
    history.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    return () => {
      observer?.disconnect();
      history.removeEventListener("scroll", position);
      window.removeEventListener("resize", position);
    };
  }, [open, menu]);

  function close() {
    setOpen(false);
    const focus = document.activeElement;
    if (
      rootRef.current?.contains(focus) ||
      focus === rootRef.current?.closest(".message-row") ||
      focus === document.body
    ) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }

  return (
    <div
      className={`message-popup ${open ? "message-popup--open" : ""}`}
      ref={rootRef}
      onPointerDownCapture={(event) => {
        usingMouse.current = event.pointerType === "mouse";
      }}
      onKeyDownCapture={() => {
        usingMouse.current = false;
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="message-action"
        aria-label={label}
        title={label}
        aria-disabled={onBlocked ? true : undefined}
        aria-describedby={onBlocked ? "example-notice" : undefined}
        aria-haspopup={menu ? "menu" : undefined}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => {
          if (onBlocked) return onBlocked();
          triggerRef.current?.focus({ preventScroll: true });
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        {icon}
      </button>
      {open && (
        <div
          ref={popoverRef}
          id={popoverId}
          className={menu ? "message-more-menu" : "message-label-popover"}
          role={menu ? "menu" : undefined}
          aria-label={menu ? label : undefined}
          onClick={(event) => {
            if (
              menu &&
              event.target instanceof Element &&
              event.target.closest('[role="menuitem"]')
            )
              close();
          }}
          onKeyDown={(event) => {
            if (!menu) return;
            if (event.key === "Tab") {
              close();
              return;
            }
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]',
              ),
            ];
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            let next;
            switch (event.key) {
              case "ArrowDown":
                next = (index + 1) % items.length;
                break;
              case "ArrowUp":
                next = (index - 1 + items.length) % items.length;
                break;
              case "Home":
                next = 0;
                break;
              case "End":
                next = items.length - 1;
                break;
              default:
                return;
            }
            event.preventDefault();
            items[next]?.focus();
          }}
        >
          {children()}
        </div>
      )}
    </div>
  );
}
