# ADR-0005: Apache License 2.0

## Status

Accepted for v0.0.1. Supersedes ADR-0004 before the first public release and
defines the current public license.

## Context

The owner reconsidered the earlier personal-use/noncommercial restriction and
explicitly selected Apache License 2.0. The repository has no commits, remote,
tags, or published releases, so the earlier candidate license was never shipped
from this repository.

Apache-2.0 is an OSI-approved permissive open-source license. It allows personal
and commercial use, modification, and distribution subject to its conditions. It
also includes an express patent license from contributors and terminates that
patent license for a party that brings specified patent litigation over the work.

## Decision

License On Track under the unmodified Apache License, Version 2.0, using SPDX
identifier `Apache-2.0` in package metadata. Keep the canonical license text in
the repository's top-level `LICENSE` file.

Accept intentional contributions under the contribution terms in section 5 of
Apache-2.0 unless explicitly stated otherwise. No contributor license agreement
or separate commercial license is claimed. A `NOTICE` file is not added because
the project currently has no project-level attribution notices that require it.

## Alternatives considered

- **PolyForm Noncommercial 1.0.0:** implements the earlier commercial-use
  restriction but is source-available rather than open source.
- **AGPL-3.0:** open source with network copyleft, but still permits commercial
  use and imposes obligations the owner does not want for this release.
- **MIT:** permissive and simple, but lacks Apache-2.0's express patent grant and
  patent-litigation termination provision.

## Consequences

Anyone may use On Track for personal or commercial purposes and may modify and
redistribute it while complying with Apache-2.0. Redistributors must provide the
license, preserve required notices, mark modified files, and respect the
license's trademark limitations. The license provides the software without
warranties or conditions.

This choice is incompatible with charging merely for permission to use the code
commercially. Revenue would need to come from optional services, support,
hosting, proprietary add-ons that respect dependency licenses, or another model.

## Verification

The release contract requires matching `Apache-2.0` metadata in `package.json`
and `package-lock.json`. Release preparation byte-compares `LICENSE` against the
Apache Software Foundation's canonical text and searches current public docs for
stale noncommercial claims.

## Sources

- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.html)
- [Applying the Apache License](https://www.apache.org/legal/apply-license)
- [Open Source Initiative license list](https://opensource.org/licenses)
