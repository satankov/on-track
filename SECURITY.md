# Security policy

## Supported versions

Security fixes apply to the [latest release](https://github.com/satankov/on-track/releases/latest).
Older releases receive no backports.

## Reporting a vulnerability

Send suspected vulnerabilities to the maintainers through
[GitHub’s private reporting form](https://github.com/satankov/on-track/security/advisories/new).
Keep technical details private until a fix is available.

Include a concise impact description, affected version, reproduction steps, and
suggested mitigation if known. Do not include real personal data, database files,
credentials, or NDA material. A maintainer should acknowledge a complete report
within seven days and coordinate disclosure after a fix is available.

## Current data-safety posture

threadstr keeps data on the local machine and binds only to loopback, but its
SQLite database, managed attachments, and exported backups are **not encrypted**.
Backup import defaults to adding selected projects as independent copies.
The explicit **Replace whole DB** mode removes current projects and files after
confirmation. The application is not suitable for confidential, NDA-bound, or
irreplaceable information. See
[ADR-0002](docs/adr/0002-defer-at-rest-encryption.md).
