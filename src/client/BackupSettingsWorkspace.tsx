import { useEffect, useRef, useState } from "react";
import type { Chat } from "../domain/types.js";
import type {
  BackupPreview,
  BackupProject,
  ImportOptions,
  ImportResult,
  ProjectSelection,
} from "../domain/database-transfer.js";
import { ImportOutcomeUnknownError } from "./api.js";

export type ImportCompletion = ImportResult & { refreshWarning?: string };
function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function ProjectChecklist({
  label,
  projects,
  excluded,
  onChange,
  disabled,
}: {
  label: string;
  projects: Array<
    Pick<Chat, "id" | "title" | "createdAt" | "pinnedAt" | "archivedAt"> &
      Partial<BackupProject>
  >;
  excluded: ReadonlySet<string>;
  onChange: (ids: Set<string>) => void;
  disabled: boolean;
}) {
  const count = projects.filter((project) => !excluded.has(project.id)).length;
  return (
    <fieldset className="backup-checklist" disabled={disabled}>
      <legend>{label}</legend>
      <div className="backup-selection-actions">
        <span>
          {count} of {projects.length} selected
        </span>
        <button
          className="button button-quiet"
          type="button"
          onClick={() => onChange(new Set())}
        >
          Select all
        </button>
        <button
          className="button button-quiet"
          type="button"
          onClick={() =>
            onChange(new Set(projects.map((project) => project.id)))
          }
        >
          Clear
        </button>
      </div>
      {projects.length === 0 ? (
        <p className="backup-help">
          No projects in this{" "}
          {label.includes("import") ? "backup" : "workspace"}.
        </p>
      ) : (
        <div className="backup-project-list">
          {projects.map((project) => (
            <label className="backup-project-row" key={project.id}>
              <input
                type="checkbox"
                checked={!excluded.has(project.id)}
                onChange={() => {
                  const next = new Set(excluded);
                  if (next.has(project.id)) next.delete(project.id);
                  else next.add(project.id);
                  onChange(next);
                }}
              />
              <span>
                <strong>{project.title}</strong>
                <small>
                  {project.archivedAt != null
                    ? "Archived · "
                    : project.pinnedAt != null
                      ? "Pinned · "
                      : ""}
                  Created {new Date(project.createdAt).toLocaleString()}
                  {project.messageCount !== undefined
                    ? ` · ${project.messageCount} messages · ${project.attachmentCount} files`
                    : ""}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function BackupSettingsWorkspace({
  projects,
  onExport,
  onPreview,
  onImport,
  unavailable,
}: {
  projects: Chat[];
  onExport: (selection: ProjectSelection) => Promise<void>;
  onPreview: (file: File) => Promise<BackupPreview>;
  onImport: (file: File, options: ImportOptions) => Promise<ImportCompletion>;
  unavailable: boolean;
}) {
  const [excludedExport, setExcludedExport] = useState<Set<string>>(
    () => new Set(),
  );
  const [excludedImport, setExcludedImport] = useState<Set<string>>(
    () => new Set(),
  );
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<BackupPreview>();
  const [mode, setMode] = useState<ImportOptions["mode"]>("merge");
  const [busy, setBusy] = useState<"export" | "preview" | "import">();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<ImportCompletion>();
  const [consumed, setConsumed] = useState(false);
  const request = useRef(0);
  const committing = useRef(false);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const exportIds = projects
    .filter((project) => !excludedExport.has(project.id))
    .map((project) => project.id);
  const importIds =
    preview?.projects
      .filter((project) => !excludedImport.has(project.id))
      .map((project) => project.id) ?? [];

  async function selectFile(next?: File) {
    const generation = ++request.current;
    setFile(next);
    setPreview(undefined);
    setExcludedImport(new Set());
    setResult(undefined);
    setConsumed(false);
    setError("");
    setStatus("");
    if (!next) {
      setBusy(undefined);
      return;
    }
    setBusy("preview");
    try {
      const value = await onPreview(next);
      if (generation === request.current) {
        setPreview(value);
        setStatus("Backup checked. Choose projects and an import mode.");
      }
    } catch (caught) {
      if (generation === request.current)
        setError(message(caught, "The backup could not be previewed."));
    } finally {
      if (generation === request.current) setBusy(undefined);
    }
  }
  async function exportBackup(selection: ProjectSelection) {
    if (busy || committing.current) return;
    setBusy("export");
    setError("");
    setStatus("");
    try {
      await onExport(selection);
      setStatus("Backup export is ready.");
    } catch (caught) {
      setError(message(caught, "The database could not be exported."));
    } finally {
      setBusy(undefined);
    }
  }
  async function importBackup() {
    if (
      !file ||
      !preview ||
      busy ||
      committing.current ||
      consumed ||
      unavailable
    )
      return;
    if (importIds.length === 0 && preview.projects.length > 0) return;
    if (
      mode === "replace" &&
      !window.confirm(
        `Replace the whole database with ${importIds.length} selected projects? ALL current projects, messages, and attached files will be removed, including projects not selected for import.`,
      )
    )
      return;
    committing.current = true;
    setBusy("import");
    setError("");
    setStatus("");
    try {
      const value = await onImport(file, {
        mode,
        selection:
          importIds.length === preview.projects.length ? "all" : importIds,
        digest: preview.digest,
      });
      setResult(value);
      setConsumed(true);
      setStatus(
        `${value.importedCount} projects ${mode === "merge" ? "imported" : "restored"}.`,
      );
    } catch (caught) {
      setError(message(caught, "The database could not be imported."));
      if (caught instanceof ImportOutcomeUnknownError) setConsumed(true);
    } finally {
      committing.current = false;
      setBusy(undefined);
    }
  }
  const emptyBackup = preview?.projects.length === 0;
  return (
    <main className="workspace settings-workspace">
      <header className="settings-workspace-header">
        <p className="eyebrow">Backups</p>
        <h1>Backup settings</h1>
      </header>
      <p className="backup-help">
        Backups are plaintext and readable. Each selected project includes all
        its messages, labels, settings, and attached files.
      </p>
      <section
        className="settings-panel backup-panel"
        aria-labelledby="backup-export-heading"
      >
        <div className="settings-panel-copy">
          <h2 id="backup-export-heading">Export projects</h2>
          <p>Create one restorable threadstr backup.</p>
        </div>
        <ProjectChecklist
          label="Projects to export"
          projects={projects}
          excluded={excludedExport}
          onChange={setExcludedExport}
          disabled={!!busy}
        />
        <div className="backup-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={!!busy}
            onClick={() => void exportBackup("all")}
          >
            Export all
          </button>
          <button
            className="button button-quiet"
            type="button"
            disabled={!!busy || exportIds.length === 0}
            onClick={() => void exportBackup(exportIds)}
          >
            Export selected ({exportIds.length})
          </button>
        </div>
      </section>
      <section
        className="settings-panel backup-panel"
        aria-labelledby="backup-import-heading"
      >
        <div className="settings-panel-copy">
          <h2 id="backup-import-heading">Import projects</h2>
          <p>Choose a backup to inspect its projects before importing.</p>
        </div>
        <label className="field-label" htmlFor="database-import">
          Choose threadstr backup
        </label>
        <input
          id="database-import"
          className="file-input"
          type="file"
          accept=".on-track-backup,application/vnd.on-track.backup+sqlite"
          disabled={busy === "import" || busy === "export"}
          aria-describedby={error ? "backup-error" : undefined}
          onChange={(event) => void selectFile(event.target.files?.[0])}
        />
        {file && !preview && !busy && (
          <button
            className="button button-quiet"
            type="button"
            onClick={() => void selectFile(file)}
          >
            Check backup again
          </button>
        )}
        {preview && (
          <>
            <ProjectChecklist
              label="Projects to import"
              projects={preview.projects}
              excluded={excludedImport}
              onChange={setExcludedImport}
              disabled={!!busy || consumed}
            />
            <fieldset className="backup-modes" disabled={!!busy || consumed}>
              <legend>Import mode</legend>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                />
                <span>Merge DB</span>
              </label>
              <p className="backup-help">
                Keep current projects and add independent copies. Conflicting
                names get the import time, for example A_2026-09-09_14-30-00Z.
              </p>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                />
                <span>Replace whole DB</span>
              </label>
              <p className="backup-help">
                Remove all current projects and files. Only the selected
                imported projects will remain.
              </p>
            </fieldset>
            <div className="backup-actions">
              <button
                className={`button ${mode === "replace" ? "button-danger" : "button-primary"}`}
                type="button"
                disabled={
                  !!busy ||
                  consumed ||
                  unavailable ||
                  (importIds.length === 0 && !emptyBackup)
                }
                onClick={() => void importBackup()}
              >
                {mode === "merge"
                  ? `Merge selected (${importIds.length})`
                  : `Replace with selected (${importIds.length})`}
              </button>
            </div>
            {unavailable && !busy && (
              <p className="backup-help">
                Wait for the current project change to finish before importing.
              </p>
            )}
          </>
        )}
      </section>
      <div className="backup-feedback" aria-live="polite">
        {busy ? (
          <p role="status" className="form-status">
            {busy === "preview"
              ? "Checking backup…"
              : busy === "import"
                ? "Importing projects…"
                : "Preparing export…"}
          </p>
        ) : (
          status && (
            <p role="status" className="form-status">
              {status}
            </p>
          )
        )}
        {result?.renames.length ? (
          <ul className="backup-renames">
            {result.renames.map((rename, index) => (
              <li key={index}>
                {rename.original} → {rename.renamed}
              </li>
            ))}
          </ul>
        ) : null}
        {result?.refreshWarning && (
          <p role="alert" className="form-error">
            {result.refreshWarning}
          </p>
        )}
      </div>
      {error && (
        <p id="backup-error" role="alert" className="form-error">
          {error}
        </p>
      )}
    </main>
  );
}
