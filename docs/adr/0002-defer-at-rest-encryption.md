# ADR-0002: Defer at-rest encryption until key lifecycle is designed

## Status

Accepted for the proving slice; must be revisited before confidential use.

## Context

The product promises user-owned local data and eventually needs to protect a
copied or stolen database. Plain SQLite provides locality, not confidentiality.
Meaningful encryption also requires decisions about passphrases, OS keychains,
locking, memory exposure, forgotten credentials, recovery, backups, search
indexes, attachment files, migration, and secure cleanup of plaintext copies.

SQLCipher provides transparent page encryption and requires keying before the
first database operation. Its compatibility with a custom `better-sqlite3` build
is plausible but must be proven on each supported platform rather than assumed.

## Decision

The first slice stores data in plaintext SQLite and is explicitly limited to
non-confidential evaluation data. It makes no encryption or NDA-safe claim.

Before confidential use, run a dedicated SQLCipher spike and approve a complete
threat model and key/recovery design. The feature must cover the primary database,
WAL/journals, backups, exports, attachments, search indexes, plaintext migration,
and cleanup. A key stored beside the database is not acceptable protection.

## Alternatives considered

- Add a hard-coded or adjacent key now: rejected because it provides a misleading
  security claim without protecting against database leakage.
- Passphrase-only SQLCipher immediately: stronger at rest but risks permanent
  data loss and delays validation of the core workflow before recovery UX exists.
- OS full-disk encryption only: useful defense in depth, but it does not protect a
  copied database or data accessible from another process in an unlocked session.

## Consequences

- Product behavior and persistence can be proven without pretending encryption is
  solved.
- Users must not place NDA/confidential data in the proving build.
- Plaintext-to-encrypted migration will require a new encrypted database, verified
  transfer, atomic replacement, and deliberate cleanup of plaintext artifacts.
- The product owner must later approve the unlock/recovery tradeoff.

## Verification

The future spike must prove clean install, unlock/lock, wrong-key behavior,
backup/restore, plaintext migration and cleanup, and packaged builds on every
supported OS before this ADR can be superseded.

## Sources

- [SQLCipher design](https://www.zetetic.net/sqlcipher/design/)
- [SQLCipher key API](https://www.zetetic.net/sqlcipher/sqlcipher-api/)
- [Encrypting plaintext databases](https://www.zetetic.net/sqlcipher/encrypting-plaintext-databases/)
- [SQLCipher licensing](https://www.zetetic.net/sqlcipher/license/)
