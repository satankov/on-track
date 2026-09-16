import { useState } from "react";
import type { HomeCheck } from "../domain/home.js";
import type { useHomeUpdates } from "./useHomeUpdates.js";

const repository = "https://github.com/satankov/on-track";
const messages: Record<HomeCheck["status"], string> = {
  available: "A compatible update is available.",
  current: "You’re up to date.",
  ahead: "This build is ahead of the published releases.",
  manual:
    "A newer release is available. Update your manual installation below.",
  incompatible:
    "A newer release exists, but no compatible managed update was found. See the installation guide.",
  unverified:
    "This build could not be matched to a published release. See the installation guide before updating.",
  empty: "No supported published releases were found.",
};
export function HomeUtilities({
  updates,
}: {
  updates: ReturnType<typeof useHomeUpdates>;
}) {
  const { info, result, error, busy, check } = updates;
  const [copyStatus, setCopyStatus] = useState("");
  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopyStatus("Command copied.");
    } catch {
      setCopyStatus("Could not copy. Select the command and copy it manually.");
    }
  }
  return (
    <section className="home-utilities" aria-label="Updates and help">
      <div className="home-utility-grid">
        <section aria-labelledby="home-updates-title">
          <h2 id="home-updates-title">App updates</h2>
          <div className="home-release-row">
            <span>
              Installed{" "}
              {info?.version ? `v${info.version}` : "version unavailable"}
            </span>
            <button
              className="button button-quiet"
              type="button"
              disabled={busy}
              onClick={() => {
                setCopyStatus("");
                void check();
              }}
            >
              {busy ? "Checking…" : result ? "Check again" : "Check releases"}
            </button>
          </div>
          <p className="home-small">
            Contacts GitHub only when you check. No project content is sent.
          </p>
          <div role="status" aria-live="polite">
            {busy && <p>Looking for published releases…</p>}
          </div>
          {error && (
            <p className="home-error" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div className="home-release-result">
              <p role="status">{messages[result.status]}</p>
              {result.update && (
                <>
                  <div className="home-result-heading">
                    <strong>v{result.update.version} is available</strong>
                    <a
                      href={`${repository}/releases/tag/v${result.update.version}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Release notes ↗
                    </a>
                  </div>
                  {result.update.kind === "manual" ? (
                    <p>
                      Export a backup and save drafts. Stop the old server,
                      extract this release into a separate folder, then run this
                      command there. Keep your existing{" "}
                      <code>ON_TRACK_DATA_DIR</code> if you use one.
                    </p>
                  ) : (
                    <p>Run this in your terminal to update:</p>
                  )}
                  <div className="home-command">
                    <code>{result.update.command}</code>
                    <button
                      type="button"
                      onClick={() => void copy(result.update!.command)}
                    >
                      Copy
                    </button>
                  </div>
                  {result.update.kind === "managed" && (
                    <p className="home-small">
                      Save any open drafts before updating.
                    </p>
                  )}
                  {result.update.exactCommand &&
                    result.update.exactCommand !== result.update.command && (
                      <details>
                        <summary>Command for this installation</summary>
                        <p>
                          Use this if the thr command is unavailable or points
                          to another installation.
                        </p>
                        <div className="home-command">
                          <code>{result.update.exactCommand}</code>
                          <button
                            type="button"
                            onClick={() =>
                              void copy(result.update!.exactCommand!)
                            }
                          >
                            Copy exact command
                          </button>
                        </div>
                      </details>
                    )}
                  <p className="home-small" role="status">
                    {copyStatus}
                  </p>
                </>
              )}
              <p className="home-small">
                Checked{" "}
                {new Date(result.checkedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · Results cached for 5 minutes
              </p>
              {result.releases.length > 0 && (
                <details>
                  <summary>Recent releases</summary>
                  <ul>
                    {result.releases.map((release) => (
                      <li key={release.version}>
                        <a href={release.url} target="_blank" rel="noreferrer">
                          v{release.version} ↗
                        </a>
                        {release.version === info?.version
                          ? " · Installed version"
                          : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </section>
        <section aria-labelledby="home-help-title">
          <h2 id="home-help-title">Need a hand?</h2>
          <p>Find help in the guides below.</p>
          <p className="home-report-placeholder">Report a bug — coming soon</p>
        </section>
      </div>
      <nav className="home-links" aria-label="Resources">
        <a
          href={`${repository}/blob/main/docs/install/README.md#data-and-backups`}
          target="_blank"
          rel="noreferrer"
        >
          Backup &amp; restore ↗
        </a>
        <a href={repository} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </nav>
    </section>
  );
}
