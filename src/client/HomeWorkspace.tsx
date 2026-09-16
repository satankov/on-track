import type { ReactNode } from "react";
export type WorkspacePlaceholderState =
  "loading" | "empty" | "choose" | "error";

export function HomeWorkspace({
  state,
  onCreate,
  children,
}: {
  state: WorkspacePlaceholderState;
  onCreate: () => void;
  children?: ReactNode;
}) {
  const content = {
    loading: {
      eyebrow: "Projects",
      heading: "Loading your projects.",
      copy: "Your local workspace is opening.",
    },
    empty: {
      eyebrow: "Your personal project log",
      heading: "A quiet place for every moving project.",
      copy: "Capture decisions, loose ends, and the thought you will need three weeks from now. Your project content stays on this computer.",
    },
    choose: {
      eyebrow: "Projects ready",
      heading: "Choose a project to continue.",
      copy: "Select a project from the list to reopen its thread, or start a new one when another moving piece appears.",
    },
    error: {
      eyebrow: "Projects unavailable",
      heading: "Your project list could not be loaded.",
      copy: "Check the local service and try again. Existing local data has not been changed.",
    },
  }[state];
  const statusProps =
    state === "loading"
      ? ({ role: "status", "aria-live": "polite" } as const)
      : undefined;

  return (
    <main
      className={`workspace workspace-empty ${children ? "workspace-home" : ""}`}
    >
      <div className="home-hero">
        <div className="empty-thread" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="empty-copy" {...statusProps}>
          <p className="eyebrow">{content.eyebrow}</p>
          <h1>{content.heading}</h1>
          <p>{content.copy}</p>
          {state === "empty" && (
            <button
              className="button button-primary"
              type="button"
              onClick={onCreate}
            >
              Create your first project
            </button>
          )}
        </div>
      </div>
      {children}
    </main>
  );
}
