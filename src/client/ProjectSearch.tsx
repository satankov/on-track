import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

export function ProjectSearch({
  id,
  onCommit,
  onClose,
  status,
  initialValue = "",
  onValueChange,
  count,
}: {
  id: string;
  onCommit: (value: string) => void;
  onClose: () => void;
  status: string;
  initialValue?: string;
  onValueChange?: (value: string) => void;
  count?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const commit = useRef(onCommit);
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    commit.current = onCommit;
  }, [onCommit]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusId = useId();
  useEffect(() => {
    inputRef.current?.focus();
    return () => clearTimeout(timer.current);
  }, []);

  function update(value: string) {
    onValueChange?.(value);
    clearTimeout(timer.current);
    if (composing.current) return;
    if (!value.trim()) {
      setPending(false);
      commit.current("");
    } else {
      setPending(true);
      timer.current = setTimeout(() => {
        setPending(false);
        commit.current(value);
      }, 150);
    }
  }

  return (
    <div
      className="project-search"
      id={id}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !composing.current &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          clearTimeout(timer.current);
          onClose();
        }
      }}
    >
      <div className="project-search-field">
        <input
          ref={inputRef}
          type="search"
          defaultValue={initialValue}
          aria-label="Search messages"
          aria-describedby={statusId}
          placeholder="Search…"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => update(event.currentTarget.value)}
          onCompositionStart={() => {
            composing.current = true;
            setPending(true);
            clearTimeout(timer.current);
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            update(event.currentTarget.value);
          }}
        />
        <span className="project-search-count" aria-label="Matching messages">
          {pending ? "…" : count}
        </span>
        <button
          type="button"
          className="project-search-clear"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => {
            clearTimeout(timer.current);
            setPending(false);
            if (inputRef.current) inputRef.current.value = "";
            onValueChange?.("");
            onCommit("");
            inputRef.current?.focus();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </button>
      </div>
      <span id={statusId} className="visually-hidden" role="status">
        {pending ? "Updating results…" : status}
      </span>
    </div>
  );
}

/** Announce a new save once without adding a visible status row or replaying it. */
export function SearchSaveStatus({
  savedNoteId,
  hidden,
}: {
  savedNoteId?: string;
  hidden: boolean;
}) {
  const previous = useRef(savedNoteId);
  const status = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const changed = previous.current !== savedNoteId;
    previous.current = savedNoteId;
    const element = status.current;
    if (!element || !changed || !savedNoteId || !hidden) return;
    element.textContent = "Saved. Hidden by the current search.";
    const timer = setTimeout(() => {
      element.textContent = "";
    }, 4000);
    return () => {
      clearTimeout(timer);
      element.textContent = "";
    };
  }, [savedNoteId, hidden]);
  return <span ref={status} role="status" className="visually-hidden" />;
}
