import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export function HistoryNavigation({
  historyRef,
  contentKey,
}: {
  historyRef: RefObject<HTMLElement | null>;
  contentKey: string;
}) {
  const [edges, setEdges] = useState({ up: false, down: false });
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    const measure = () => {
      const overflow = history.scrollHeight - history.clientHeight > 24;
      const up = overflow && history.scrollTop > 24;
      const down =
        overflow &&
        history.scrollHeight - history.clientHeight - history.scrollTop > 24;
      if (
        (!up && document.activeElement === upRef.current) ||
        (!down && document.activeElement === downRef.current)
      )
        history.focus({ preventScroll: true });
      setEdges((current) =>
        current.up === up && current.down === down ? current : { up, down },
      );
    };
    const resize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    const observe = () => {
      resize?.disconnect();
      resize?.observe(history);
      for (const child of history.children) resize?.observe(child);
      measure();
    };
    const mutations = new MutationObserver(observe);
    mutations.observe(history, { childList: true, subtree: true });
    observe();
    history.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      resize?.disconnect();
      mutations.disconnect();
      history.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [historyRef, contentKey]);
  function move(end: boolean) {
    const history = historyRef.current;
    history?.scrollTo({
      top: end ? history.scrollHeight : 0,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  return (
    <div className="history-navigation">
      {edges.up && (
        <button
          ref={upRef}
          type="button"
          aria-label="Scroll to beginning"
          title="Scroll to beginning"
          onClick={() => move(false)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="M5 5h14M6 14l6-6 6 6M12 8v12" />
          </svg>
        </button>
      )}
      {edges.down && (
        <button
          ref={downRef}
          type="button"
          aria-label="Scroll to end"
          title="Scroll to end"
          onClick={() => move(true)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="M5 19h14M6 10l6 6 6-6M12 4v12" />
          </svg>
        </button>
      )}
    </div>
  );
}
