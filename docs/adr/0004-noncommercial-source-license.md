# ADR-0004: Noncommercial source-available license

## Status

Superseded by ADR-0005 before the first public release. This ADR remains as a
record of the earlier, uncommitted decision.

## Context

The project owner wants personal use to remain free while requiring a separate
license for commercial use. AGPL-3.0 does not provide that boundary: it permits
commercial activity while imposing copyleft and network-source obligations.
Licenses that prohibit commercial use also fail the Open Source Definition's
no-discrimination-by-field-of-endeavor requirement, so the project cannot
accurately call itself open source after this decision.

## Decision

License the public v0.0.1 source under the unmodified PolyForm Noncommercial
License 1.0.0, SPDX identifier `PolyForm-Noncommercial-1.0.0`. Describe On Track
as source-available and free for personal and other permitted noncommercial uses.
Commercial users must obtain a separate license from the copyright holder.

External code contributions are paused until the owner adopts a contributor
agreement that preserves the ability to issue commercial licenses.

## Alternatives considered

- **AGPL-3.0:** strong network copyleft, but commercial use remains permitted.
- **MIT:** simple and permissive, but grants unrestricted commercial use.
- **A bespoke personal-use license:** could narrow the grant further but adds
  ambiguity and legal maintenance; standardized terms are preferable.
- **Business Source License:** useful for delayed conversion to open source, but
  that time-based model was not requested.

## Consequences

The source remains inspectable, modifiable, and distributable for permitted
noncommercial purposes, but On Track is not OSI open-source software. Commercial
terms, pricing, owner identity, and contact are separate future decisions. A CLA
or equivalent agreement is needed before accepting third-party code if the owner
intends to dual-license commercially.

## Verification

The release contract verifies matching PolyForm SPDX metadata in both manifests.
Static documentation review prevents stale MIT/open-source claims. The canonical
license text is sourced from the tagged PolyForm 1.0.0 publication.
