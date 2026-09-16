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
        <span>{String(examples.length).padStart(2, "0")}</span>
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
  onChange,
  warning,
}: {
  showExamples: boolean;
  onChange: (show: boolean) => void;
  warning: string;
}) {
  return (
    <main className="workspace settings-workspace">
      <header className="settings-workspace-header">
        <p className="eyebrow">Personalization</p>
        <h1>General</h1>
      </header>
      <section
        className="settings-panel general-settings-panel"
        aria-labelledby="general-workspace"
      >
        <div className="settings-panel-copy">
          <h2 id="general-workspace">Workspace</h2>
        </div>
        <label className="examples-preference">
          <input
            type="checkbox"
            checked={showExamples}
            onChange={(e) => onChange(e.target.checked)}
            aria-describedby="examples-preference-description"
          />
          <strong>Show examples</strong>
        </label>
        <p id="examples-preference-description">
          Display read-only example projects in the sidebar. Saved in this
          browser.
        </p>
        {warning && <p role="status">{warning}</p>}
      </section>
    </main>
  );
}
