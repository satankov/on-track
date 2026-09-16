# ADR-0011: User-initiated Home release checks

## Status

Accepted 2026-09-16 through approval of plan 0024 and the explicit coming-soon
reporting-placeholder amendment. No automatic updater or reporting service.

## Context

Users need to discover releases and receive instructions appropriate to their
local installation without losing the offline, project-first workspace. The CLI
already validates published manifests and owns privileged update activation.

## Decision

- Keep the browser same-origin CSP. A guarded local POST contacts only the fixed
  GitHub release channel after Check releases; loading Home or focusing the app
  never checks externally. The GET for installed version is local only.
- Reuse read-only CLI publication/checksum validation. Bound time, bytes, pages,
  candidates and frequency; coalesce concurrent checks and cache successful
  results in memory for five minutes. Errors never imply current/compatible.
- Display inert update commands and distinguish managed, manual, unsupported
  and unverified builds. Do not grant browser process/update capabilities.
- Permit a narrow exception to the path-free UI boundary: a shell-quoted trusted
  installation-launcher path in exact update instructions. Never expose data
  paths, tokens, nonces or control endpoints; never transmit the command/path.
  Launchers already supply their root, so do not append another `--root` flag.
- Preserve the primary Home action, add quiet links, and reserve the approved
  help-block location with noninteractive reporting-coming-soon copy. Reporting,
  diagnostic collection, mail delivery and hosting are deferred.

## Consequences

Normal project work remains offline. GitHub sees ordinary connection metadata
only after a check; no project data is sent. “Local only” refers to project
storage. Network failures leave project use independent. There is no migration,
new runtime dependency, stored user identifier or new backup content.

Verify guards before transport, compatible and invalid publications, manual and
custom-root commands, timeouts/cancellation, cache lifetime, no background calls,
clipboard fallback, all themes and mobile project/Settings access.
