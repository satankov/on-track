# Security policy

## Supported versions

On Track is pre-1.0 alpha software. Security fixes are made only on the latest
released version.

| Version        | Supported |
| -------------- | --------- |
| Latest `0.0.x` | Yes       |
| Older versions | No        |

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting for this repository after the repository owner
enables it under **Settings -> Security -> Private vulnerability reporting**.

Include a concise impact description, affected version, reproduction steps, and
suggested mitigation if known. Do not include real personal data, database files,
credentials, or NDA material. A maintainer should acknowledge a complete report
within seven days and coordinate disclosure after a fix is available.

## Current data-safety posture

On Track keeps data on the local machine and binds only to loopback, but its
SQLite database, managed attachments, and exported backups are **not encrypted**.
Backup restore replaces current local projects and files rather than merging
them. The application is not suitable for confidential, NDA-bound, or
irreplaceable information. See
[ADR-0002](docs/adr/0002-defer-at-rest-encryption.md).
