import type { ExampleSummary } from "../domain/examples.js";
export function ExamplesSection({
  examples,
  collapsed,
  onToggle,
  onSelect,
  activeSlug,
  disabled,
  error,
  onRetry,
}: {
  examples: ExampleSummary[];
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (slug: string) => void;
  activeSlug?: string;
  disabled: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <section className="project-section" aria-labelledby="rail-Examples">
      <button
        className="rail-section-label"
        type="button"
        aria-label="Examples"
        aria-expanded={!collapsed}
        aria-controls="rail-items-Examples"
        onClick={onToggle}
      >
        <span className="rail-section-title" id="rail-Examples">
          Examples
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      <div id="rail-items-Examples" hidden={collapsed}>
        {error ? (
          <p className="examples-load-error" role="alert">
            {error}{" "}
            <button
              className="button button-quiet"
              disabled={disabled}
              onClick={onRetry}
            >
              Retry examples
            </button>
          </p>
        ) : (
          <ul className="project-items">
            {examples.map((example) => (
              <li
                className={`project-row ${activeSlug === example.slug ? "project-row--active" : ""}`}
                data-accent={example.accent}
                key={example.slug}
              >
                <button
                  type="button"
                  className={`project-item ${activeSlug === example.slug ? "project-item--active" : ""}`}
                  aria-current={
                    activeSlug === example.slug ? "page" : undefined
                  }
                  aria-label={`Open example ${example.title}`}
                  data-example-slug={example.slug}
                  disabled={disabled}
                  onClick={() => onSelect(example.slug)}
                >
                  <span className="project-item-copy">
                    <strong>{example.title}</strong>
                    <small>{example.description}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function GeneralSettingsWorkspace({
  showExamples,
  alwaysShowMessageTime,
  onMessageTimeChange,
  onChange,
  warning,
}: {
  showExamples: boolean;
  alwaysShowMessageTime: boolean;
  onMessageTimeChange: (show: boolean) => void;
  onChange: (show: boolean) => void;
  warning: string;
}) {
  return (
    <main className="workspace settings-workspace">
      <header className="settings-workspace-header">
        <h1>General</h1>
      </header>
      <section
        className="settings-panel general-settings-panel"
        aria-label="Workspace"
      >
        <div className="general-preferences">
          <label className="examples-preference">
            <strong>Show examples</strong>
            <input
              type="checkbox"
              checked={showExamples}
              onChange={(e) => onChange(e.target.checked)}
              aria-describedby="examples-preference-description"
            />
          </label>
          <label className="examples-preference">
            <strong>Always show message time</strong>
            <input
              type="checkbox"
              checked={alwaysShowMessageTime}
              onChange={(event) => onMessageTimeChange(event.target.checked)}
              aria-describedby="message-time-description"
            />
          </label>
        </div>
        <p id="examples-preference-description" className="field-help">
          Examples appear as read-only projects in the sidebar.
        </p>
        <p id="message-time-description" className="field-help">
          When message times are hidden, hover over, focus, or tap a message to
          see its time.
        </p>
        {warning && <p role="status">{warning}</p>}
      </section>
    </main>
  );
}
