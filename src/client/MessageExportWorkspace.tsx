import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ExportDocument } from "./message-export.js";
import type { ExportOptions, ExportSource } from "./message-export-source.js";

export function MessageExportWorkspace({
  source,
  onBack,
  backIcon,
}: {
  source: ExportSource;
  onBack: () => void;
  backIcon: ReactNode;
}) {
  const [format, setFormat] = useState<ExportOptions["format"]>("md");
  const [includeLabels, setIncludeLabels] = useState(false);
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const workspace = useRef<HTMLElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      const target = event.target;
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Touch browsers can leave focus on the document after a download.
      if (
        target instanceof Node &&
        target !== document &&
        target !== document.body &&
        target !== document.documentElement &&
        !workspace.current?.contains(target)
      )
        return;
      event.preventDefault();
      onBack();
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onBack]);
  const count = source.messages.length;
  return (
    <main
      className="workspace settings-workspace project-edit-workspace message-export"
      aria-labelledby="export-title"
      ref={workspace}
    >
      <div className="project-edit-form project-settings-fields export-sheet">
        <header className="export-head">
          <button
            type="button"
            className="settings-back-button"
            aria-label="Back to selected messages"
            onClick={onBack}
          >
            {backIcon}
          </button>
          <h1 id="export-title" tabIndex={-1} ref={heading}>
            Export {count} {count === 1 ? "message" : "messages"}
          </h1>
        </header>
        <ExportPreview
          source={source}
          format={format}
          timeZone={timeZone}
          includeLabels={includeLabels}
          controls={
            <div className="export-options">
              <fieldset>
                <legend>Format</legend>
                <div className="export-formats">
                  {(["md", "txt"] as const).map((value) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="export-format"
                        value={value}
                        checked={value === format}
                        onChange={() => setFormat(value)}
                      />
                      <span>{value === "md" ? "Markdown" : "Plain text"}</span>
                      <small>.{value}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="project-label-option export-labels">
                Include message labels
                <input
                  type="checkbox"
                  checked={includeLabels}
                  onChange={(event) =>
                    setIncludeLabels(event.currentTarget.checked)
                  }
                />
              </label>
            </div>
          }
        />
      </div>
    </main>
  );
}

function useExportDocument(
  source: ExportSource,
  options: ExportOptions,
  attempt: number,
) {
  const [ready, setReady] = useState<{
    source: ExportSource;
    key: string;
    result: ExportDocument | "error";
  }>();
  const key = [
    options.format,
    options.includeLabels,
    options.timeZone,
    attempt,
  ].join("|");
  const { format, includeLabels, timeZone } = options;
  useEffect(() => {
    const settings = { format, includeLabels, timeZone };
    const setResult = (result: ExportDocument | "error") =>
      setReady({ source, key, result });
    let active = true;
    let worker: Worker | undefined;
    async function prepare() {
      try {
        // Small excerpts avoid worker startup. Larger selections can be cancelled
        // even mid-parse by terminating their dedicated, local worker.
        if (
          source.messages.length > 32 ||
          source.messages.reduce((n, m) => n + m.body.length, 0) > 24_000
        ) {
          worker = new Worker(
            new URL("./message-export.worker.ts", import.meta.url),
            { type: "module" },
          );
          worker.onmessage = ({ data }: MessageEvent<ExportDocument>) => {
            if (active) setResult(data);
            worker?.terminate();
          };
          worker.onerror = (event) => {
            event.preventDefault();
            if (active) setResult("error");
            worker?.terminate();
          };
          worker.postMessage({ source, options: settings });
        } else {
          const { formatMessageExport } = await import("./message-export.js");
          if (active) setResult(formatMessageExport(source, settings));
        }
      } catch {
        if (active) setResult("error");
      }
    }
    void prepare();
    return () => {
      active = false;
      worker?.terminate();
    };
  }, [source, format, includeLabels, timeZone, key]);
  return ready?.source === source && ready.key === key
    ? ready.result
    : undefined;
}

function ExportPreview({
  source,
  format,
  timeZone,
  includeLabels,
  controls,
}: ExportOptions & { source: ExportSource; controls: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const result = useExportDocument(
    source,
    { format, timeZone, includeLabels },
    attempt,
  );
  const doc = result && result !== "error" ? result : undefined;
  const [feedback, setFeedback] = useState<{
    doc: ExportDocument;
    notice: string;
    manual?: boolean;
  }>();
  const notice = feedback?.doc === doc ? feedback?.notice : "";
  const manual = Boolean(feedback && feedback.doc === doc && feedback.manual);
  const manualField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (manual) {
      manualField.current?.focus();
      manualField.current?.select();
    }
  }, [manual]);
  const action = useRef(0);
  useLayoutEffect(
    () => () => {
      action.current++;
    },
    [doc],
  );
  async function copy() {
    if (!doc) return;
    const request = ++action.current;
    try {
      await navigator.clipboard.writeText(doc.text);
      if (request === action.current)
        setFeedback({ doc, notice: "Text copied." });
    } catch {
      if (request !== action.current) return;
      manualField.current?.focus();
      manualField.current?.select();
      setFeedback({
        doc,
        manual: true,
        notice:
          "Clipboard unavailable. The preview text is selected. Copy it manually.",
      });
    }
  }
  function download() {
    if (!doc) return;
    action.current++;
    let url: string | undefined;
    try {
      const mime = format === "md" ? "text/markdown" : "text/plain";
      url = URL.createObjectURL(
        new Blob([doc.text], { type: mime + ";charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.download = doc.filename;
      link.href = url;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setFeedback({ doc, notice: "Download requested." });
    } catch {
      setFeedback({
        doc,
        notice: "Couldn’t start the download. Try again or use Copy text.",
      });
    } finally {
      if (url) {
        const completedUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(completedUrl), 1000);
      }
    }
  }
  return (
    <>
      <div className="export-scroll">
        {controls}
        <section
          className="export-excerpt"
          aria-labelledby="export-preview-heading"
        >
          <div className="export-meta">
            <h2 id="export-preview-heading">Preview</h2>
            {doc && (
              <span className="export-filename">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14 3H6v18h12V7l-4-4Zm0 0v5h4" />
                </svg>
                {doc.filename}
              </span>
            )}
          </div>
          {result === "error" ? (
            <div>
              <p role="alert">Couldn’t prepare the export.</p>
              <button
                type="button"
                className="button"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Try again
              </button>
            </div>
          ) : !doc ? (
            <p className="field-help" role="status">
              Preparing export…
            </p>
          ) : manual ? (
            <textarea
              className="export-text"
              ref={manualField}
              aria-label="Exact export text"
              readOnly
              rows={12}
              value={doc.text}
            />
          ) : (
            <pre
              className="export-text"
              aria-label="Exact export text"
              tabIndex={0}
            >
              {doc.parts.map(({ kind, start, end }, i) => (
                <Fragment key={start}>
                  {i > 0 && (
                    <span className={"export-gap before-" + kind}>
                      {doc.text.slice(doc.parts[i - 1].end, start)}
                    </span>
                  )}
                  <span className={"export-part-" + kind}>
                    {doc.text.slice(start, end)}
                  </span>
                </Fragment>
              ))}
              {doc.text.slice(doc.parts[doc.parts.length - 1].end)}
            </pre>
          )}
        </section>
      </div>
      <footer className="export-foot">
        <span className="field-help" role="status">
          {notice}
        </span>
        <div className="export-actions">
          <button
            type="button"
            className="button"
            disabled={!doc}
            onClick={() => void copy()}
          >
            Copy text
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!doc}
            onClick={download}
          >
            Download .{format}
          </button>
        </div>
      </footer>
    </>
  );
}
