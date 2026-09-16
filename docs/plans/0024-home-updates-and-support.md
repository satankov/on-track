# Home updates and useful links implementation plan

Status: Implemented and locally verified 2026-09-16. One implementation phase.
Bug reporting is deferred to a separate future plan. Application implementation authorized; no deployment or publication authorized. Prepared against `206aa62`; implementation follows this plan with the latest user override below.

## Goal

Extend Home with quiet, useful controls while preserving “Choose a project to
continue.” and the existing first-project action: explicit release checks,
inline update commands and curated documentation, community, social and source
links. Deliver the reduced scope in one implementation phase, including tests,
review, verification and relevant documentation updates.

## Context and reusable precedent

- The user approved the dark-theme mockup and subsequently removed bug reporting
  from this slice. Preserve the accepted visual hierarchy and inline commands,
  but defer the report dialog, diagnostics, API and hosted service work. On
  implementation approval the user explicitly requested reserving the original
  help-block position with noninteractive “Report a bug — coming soon” text.
- Reference layout: existing wordmark, project rail, hero copy and thread motif;
  a thin divider below the hero; Updates and Resources columns; command block
  immediately under the release result. Group guide, backup, GitHub, community
  and social links compactly without duplicating them across rows. The mockup
  selector bar and illustrative release versions are not product UI.
- Do not add “Explore an example.” Preserve the existing Examples section and
  all project navigation. Bug reporting requires its own future scope/approval;
  no preparatory reporting infrastructure belongs in this phase.
- `src/client/App.tsx`: `EmptyWorkspace`, Home navigation, project rail, dialogs.
  `src/client/styles.css`: theme tokens, buttons, inputs, responsive shell.
  Home is currently hidden below 760px while the project rail occupies the view.
- `src/client/api.ts`, `src/server/app.ts`: typed transport, Zod validation,
  local request guards, rate limiting, maintenance admission and error mapping.
- `src/server/local-server.ts` already computes `describeRuntime()` once and
  validates managed launch identity. Reuse this result; do not hash sources on
  every UI request. `/api/health` currently exposes status only.
- `src/server/cli/distribution.ts`, `release.ts`: bounded trusted fetch, numeric
  version comparison, release metadata, manifest and compatibility checks.
  `launchers.ts` and `arguments.ts`: launchers supply their own installation root;
  adding another `--root` to a launcher command causes a duplicate-option error.
- [ADR-0008](../adr/0008-managed-install-and-cli.md) keeps privileged updates out
  of browser APIs. [ADR-0010](../adr/0010-threadstr-identity-and-cli-transition.md)
  preserves `ontrack` while introducing `thr`. Neither boundary is removed here.
- [Installation guide](../install/README.md) defines managed and manual updates.
  Managed delivery remains experimental; this feature does not certify platforms.
- Reuse native Fetch, Zod and the existing test stack. No new production
  dependency, hosted infrastructure, provider account or delivery credential
  is required for this slice.

External precedent checked during planning:

- [GitHub Releases API](https://docs.github.com/en/rest/releases/releases): public
  release listing without an account; retain the CLI's compatibility rules.

## Acceptance criteria

1. Existing Home heading/copy hierarchy, first-project action, project selection,
   reading positions, archive, Examples and settings remain functional. Utilities
   stay visually secondary and do not overlap the hero or each other.
2. Starting the app, returning Home and focusing the browser cause **no external
   request**. Only checking releases or following an external link initiates
   external contact. Release checks send no project contents or diagnostics.
3. “Check releases” displays loading, recent release links, last-checked time,
   current-version comparison, and an applicable update instruction. Handle
   up-to-date, newer compatible, newer incompatible, unsupported/custom build,
   offline, timeout, invalid metadata, empty results and rate limiting distinctly.
4. A newer compatible managed release displays a small code section directly
   below the result with Copy, release notes and a save-drafts reminder. Commands
   are generated from validated data, never fetched release prose or arbitrary
   URLs. The application never executes them.
5. Instructions distinguish managed, manual and unverified installations, target
   the running installation, preserve custom data-directory guidance, and never
   recommend a downgrade or generic `git pull`. Unknown compatibility does not
   produce “up to date” or an executable managed-update recommendation.
6. Guide, backup/restore, GitHub, community and social links use verified fixed
   HTTPS destinations. Omit unconfigured community/social links; ship no fake
   links, disabled placeholders or invented social handles.
7. Keyboard focus, status announcements, contrast, reduced motion and reflow work.
   Verify all existing themes despite the dark-only design reference, desktop,
   narrow mobile, short windows, long commands and 200% zoom.
8. No project schema, migration or backup-format changes. No update polling,
   automatic updating, diagnostics collection, accounts or telemetry. No bug-report
   form, route, schema, receiver or email integration. Only the explicitly requested
   noninteractive coming-soon placeholder is included.

## Non-goals

Bug reporting and related infrastructure (deferred to a future plan); one-click
updates; installer repair or new platform certification; embedded chat; adding
examples; replacing the design system; repository rename; new release/version
selection; commits, pushes, PRs or publication.

## Proposed design

### Home composition and state

Extract `HomeWorkspace` and `HomeUtilities` from the existing placeholder rather
than adding more feature logic to `App.tsx`. Reuse theme tokens and controls.
Desktop keeps the hero as the dominant element, then two quiet utility columns:
App updates and Need a hand? Preserve the mockup help-block position with
“Report a bug — coming soon” and short guidance; place resource links below. Reveal the command only after a check finds an applicable
release. Keep the hero reasonably stable while results expand; short windows
scroll normally. No promotional cards, auto-opening dialog or notification badge.

For mobile Home, retain the full project list and its existing sections, then
place one copy of utilities after the list and before the local/settings footer.
Do not make users traverse a duplicate hero before choosing a project. Keep the
project list scrollable and Settings reachable. Project detail and Settings views
must not acquire Home utilities. Render one active copy at each breakpoint so
hidden duplicates cannot make requests or enter the accessibility tree.

Loading/project-error states remain explicit and are not masked by utility
errors. Show the interactive utility block on ready Home states; static resource
links may remain available during project-load errors. Keep release results in
app session memory across Home navigation without rechecking. Refresh/close clears
the UI session state; there is no persistent cache or new browser-storage key.

### Local API and trust boundary

Proposed routes:

| Route                           | Purpose                                          | External traffic                  |
| ------------------------------- | ------------------------------------------------ | --------------------------------- |
| `GET /api/home/info`            | Safe version/install capabilities                | None                              |
| `POST /api/home/releases/check` | Explicit bounded release lookup; empty JSON body | Fixed GitHub release channel only |

Inject safe runtime description and install context into `buildApp()` from
`startLocalServer()`. Never expose the managed launch object, nonce, token, control
endpoint, data path or process record. For custom-root command instructions only,
a narrowly scoped installation-launcher path may appear in the displayed command;
it must never enter logs or outbound requests. Record this
limited exception to the previous path-free UI boundary in the implementation ADR.

The release-check POST requires exact same-origin Origin and Fetch Metadata plus JSON,
following the native-action guard precedent. The existing general loopback check
alone is insufficient. Enforce route-specific body limits, rate limits and bounded
responses before outbound work. Keep `connect-src 'self'` and `form-action 'self'`;
no browser third-party SDK or credentials. No arbitrary destination supplied by
browser data, release metadata, redirects or imported settings.

Network work must be abortable and bounded so it cannot hold maintenance admission
indefinitely. The release check has a 12-second total budget. Cancel outstanding fetch work on process shutdown. Error mapping
must not leak provider responses, credentials, user content or local paths.

### Release discovery and commands

Reuse/extract the existing fixed-publisher metadata parsing, version ordering and
compatibility logic into a small shared server module as needed. Preserve CLI
behavior with regression tests; do not call download/build/activation code from
the UI route. Read-only checks fetch release metadata and necessary manifests,
never source archives or runtimes. Reuse integrity/identity checks for recommended
managed releases. Pass platform explicitly so manual unsupported platforms can
still read release information without throwing in `currentManagedPlatform()`.

Use the existing bounded list policy (up to five pages of 100) and sort supported
`vX.Y.Z` versions numerically; display up to five recent non-draft, non-prerelease
releases. Managed recommendations additionally require immutable publication,
valid managed manifest/source metadata, platform availability, minimum-upgrade
compatibility and a version newer than the running build. Distinguish newest
published from newest compatible. Inspect at most ten candidate manifests per check. Exhausted limits, partial responses or a
malformed newer candidate must not silently produce a reassuring status.

Coalesce concurrent checks and cache a successful result for five minutes in
server memory, displaying its actual checked time. Clicking may reuse that cache;
label freshness honestly. No polling or disk cache. Initial local limit: six
checks/minute per process, including a clear retry delay. Handle GitHub quota
responses and retry hints without requiring a token from users.

Use the startup runtime version plus verified build identity. Managed launch is
explicit; non-managed startup alone is not proof of an official release. Compare
a manual build with validated same-tag publication metadata during an explicit
check where possible. Otherwise label it custom/unverified and offer manual
instructions without saying it is identical to the published build.

- Managed default installation: show `thr update vX.Y.Z`, with a disclosure for
  the exact installation launcher if PATH is not configured or ambiguous.
- Custom root: show the shell-quoted absolute `bin/thr` launcher (PowerShell uses
  `& '...\\thr.cmd' update vX.Y.Z`). Do not append `--root`: the launcher already
  supplies it. Reject newline/control characters; use dedicated POSIX/PowerShell
  quoting and tests for spaces, quotes, dollar signs and shell metacharacters.
  If safe generation is unavailable, give manual guidance instead of a command.
- Manual: link the exact release, explain backup/save drafts, stop, extract into
  a separate folder, then display `npm run quickstart` or PowerShell
  `npm.cmd run quickstart`. State that the terminal must be in that folder and
  any custom `ON_TRACK_DATA_DIR` must be retained; do not expose it in the API.
- Copy has accessible success/failure feedback and selectable-text fallback.
  No `--yes`, shell piping, installer execution or remote command text.

### Files and documentation affected during implementation

- New client modules: `src/client/HomeWorkspace.tsx`, `HomeUtilities.tsx`,
  `home-links.ts`, with focused component tests.
- Existing `src/client/App.tsx`, `styles.css`, `api.ts` and their tests for wiring,
  state, responsive placement and existing behavior preservation.
- New `src/domain/home.ts` for schemas/contracts and `src/server/home/` for
  release/info services, command generation, routes and tests.
- `src/server/app.ts`, `local-server.ts` for safe dependency injection and guards;
  narrowly scoped shared release parsing/selection changes and CLI regressions.
- New `e2e/home-utilities.spec.ts`, relevant fixture injection and existing Home,
  first-project, branding, Examples and project-chat regression coverage.
- During implementation, update PROJECT/ARCHITECTURE/README where the explicit
  outbound release-check capability changes their claims. Add an ADR covering
  user-initiated release checks and the narrow installation-path display exception.
  Scope “Nothing leaves this computer” to project content, clarify that “Local
  only” refers to project storage, and explain that GitHub receives normal network
  metadata when the user checks. No report/privacy-service/operator documentation.
  Do not change current-state docs before behavior exists.

## Data and migration impact

No SQLite, migrations or portable-backup changes. Release results and cache are
in memory only; no device identifier, project-content upload, persistent browser
preference or new stored user data. Existing project contents and attachment
handling do not change. Rollback is a code rollback; no hosted resource or data
migration needs undoing. No new credentials or secrets are needed.

## Phases

### Single phase: Home release checks and useful links

This reduced scope is one coherent, independently deliverable feature. It needs
no hosted-service setup, mail integration, database migration or new production
dependency. One approval covers the following implementation steps, including
review and verification; these are work steps, not separate approval phases.

1. Add safe local runtime information and read-only release checking with
   validation, compatibility selection, bounded transport and memory caching.
2. Add installation-aware command instructions and copy behavior; preserve the
   CLI's existing behavior and custom-installation targeting.
3. Integrate the approved quiet Home layout, inline release results and curated
   resources and the explicitly requested noninteractive reporting placeholder.
   Preserve the primary action, existing Examples and mobile project navigation.
4. Complete RED/GREEN tests, independent reviewer/security review, responsive and
   all-theme visual checks, relevant documentation, and the quality gates below.

Expected evidence: domain/API/component tests, Home E2E, CLI compatibility
regressions, rendered dark-reference comparisons, keyboard/mobile checks, no
unrequested external requests, and passing aggregate verification. Completion
means the entire remaining scope works; there is no later service-activation phase.
Unknown community/social URLs do not block completion: omit them until supplied.

## Test plan

Use TDD for behavior changes and the verification-loop skill after implementation.

| Guarantee                           | Evidence                                                                                                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home hierarchy/navigation/themes    | Component tests and desktop/mobile E2E; rendered comparison at 1440×1000, 1024×768, 390×844, 320px and true browser 200% zoom                                                                                          |
| Release selection and safe commands | Unit cases for numeric order, pre/draft/mutable releases, bad manifests, platform/floor incompatibility, equal/newer custom build, empty/partial pages, quoted custom paths, Windows syntax and no duplicate root flag |
| Network consent and guards          | API integration using injected fetch, explicit external-call counters, strict Origin/Fetch Metadata/body rejection before transport; no network on mount/focus/Home navigation; unchanged CLI checks                   |
| Regression                          | Project creation/editing, Examples, archive/pins, backup/restore and offline startup retain existing behavior                                                                                                          |

Focused commands (adjust only for final file naming):

```sh
npm test -- src/server/home src/client/HomeUtilities.test.tsx src/server/cli/distribution.test.ts src/server/cli/launchers.test.ts
npm run build
npx playwright test e2e/home-utilities.spec.ts
npm run verify
```

`npm run verify` is the authoritative app aggregate: release contract, build,
typecheck, lint, formatting, coverage (80% enforced), migration, E2E, dependency
security and managed smoke/update checks. No real GitHub calls in automated
tests; use injected fixtures and assert bounded external request behavior.

## Risks and mitigations

- GitHub outage, throttling or malformed metadata: distinct recoverable states,
  bounded requests and honest cache timestamps; project use stays independent.
- Incorrect install commands could target another installation: trusted runtime
  context, exact-launcher fallback, no duplicate root flag and shell quoting tests.
- Version-only equality can misidentify a custom build: verify publication identity
  during checks or explicitly label uncertainty.
- Long network operations can delay maintenance: timeout/abort budgets and tests
  for draining with in-flight requests. Do not hold database transactions to fetch.
- Mobile Home differs from desktop: preserve the project-first surface and full
  rail/footer access, with one utility instance and no independent nested scroll.
- Existing no-outbound claims become inaccurate: update scoped product copy and
  architectural documentation alongside implementation.

## Open decisions

Resolved: accepted dark visual direction; explicit checks and command display;
useful links; no new Explore feature; bug reporting deferred entirely; one phase.

Community group and social profile URLs remain needed only to show those entries.
Omit them until supplied. Existing GitHub and README/backup-guide links can ship
independently. There are no external-service setup decisions blocking this phase.

## Approval

The user approved the single implementation phase and explicitly added the
coming-soon reporting placeholder. No additional implementation approval is
needed. Commits, pushes, releases and remote mutations remain unauthorized.

## Completion evidence

Implemented the approved phase and explicit reporting-placeholder amendment.

- RED: Home UI and safe-info route tests failed because the controls/route were
  absent. GREEN: both passed after implementation. Review-added tests proved
  newer-version schema/migration regressions were incorrectly recommended, then
  passed after the compatibility filter was fixed.
- `npm run verify`: PASS, including release contract, build, typecheck, lint,
  formatting, coverage, database migrations, E2E, dependency high-severity gate,
  and managed lifecycle/update/recovery smoke checks.
- Unit/integration/component suite: 859 passed, 7 skipped (866 total); migration
  target: 22 passed; browser suite: 52 passed in desktop Chromium/mobile WebKit.
- Coverage: 90.17% statements, 84.25% branches, 92.04% functions, 91.33% lines.
  Home server modules: 98.23% statements and 91.52% branches.
- Independent correctness/security reviewer: no remaining actionable findings
  after schema/migration compatibility and recoverable cancellation fixes.
- Rendered checks: dark/light/neutral at 1440, 1024, 720, 390 and 320 CSS pixels;
  no horizontal overflow or duplicate utility controls. Narrow reflow was checked
  at the 720px equivalent of a 1440px viewport at 200%; native browser menu zoom
  was not separately exercised. Browser tests verify project navigation, preserved
  results, explicit checks, errors and the inert coming-soon report placeholder.
- No live software update, live GitHub check, reporting service, new dependency,
  database migration, commit or remote mutation performed for this feature.
- Existing moderate Fastify advisory remains; the configured high-severity audit
  gate passes. Native platform installation limits remain as previously recorded.
- Community/social destinations remain unspecified and those links are omitted.

## Current candidate amendment — v0.0.9

The release candidate includes subsequent Home and navigation polish: concise
Home copy, Backup & restore and GitHub resource links, browser-local persistence
of all four sidebar disclosures, isolated new-tab external message links, and label-menu
positioning within the history viewport. The new disclosure preference is
independent of the release-result cache, which remains in memory only.
These changes were uncommitted at the 2026-09-16 closeout; the completion evidence
above describes the earlier implementation, not verification of these edits.
The user selected v0.0.9 after this plan was implemented.

Candidate verification on 2026-09-16: `RELEASE_TAG=v0.0.9 npm run verify` passed
on macOS/Node 22.18.0: 867 tests passed / 7 skipped, 22 migration tests passed,
56 browser tests passed / 6 skipped; line coverage 91.42%, branch coverage 84.24%.
Review found and fixed new-tab footnote navigation with RED/GREEN coverage;
fragment links stay in the project and external links retain opener/referrer
isolation. Final review found no remaining actionable findings.
`node scripts/managed-upgrade-compat.mjs --baseline v0.0.8` passed running/stopped
updates, collision refusal, alias/data/backup preservation and installer reruns
through controlled transport. Native platform and live publication evidence remain
separate gates, tracked in issues #32–#34; the moderate Fastify advisory remains
in PR #26. These results do not authorize publication.
