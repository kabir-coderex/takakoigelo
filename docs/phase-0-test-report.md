# Phase 0 Test Report

Date: 8 October 2026
Scope: Recovery and migration foundation
Decision: **Release candidate — automated Phase 0 gates pass**

## Summary

All 35 Jest cases, all 12 Playwright browser workflows, and all 12 original dependency-free storage checks pass.

Every finding from the independent Phase 0 audit is fixed: simultaneous writes are serialized, backup metadata is strict, invalid legacy settings remain preserved, recovery snapshots are verified exactly, restore validates before snapshotting, and legacy numeric/string/duplicate IDs remain operable without multi-record deletion.

## Test results

| Suite | Result | Coverage |
| --- | --- | --- |
| Jest | 35 passed | Validation, migration, backup compatibility, restore/recovery, exact snapshots, fault injection, lock enforcement, simultaneous/rapid writers, and stale revisions |
| Playwright | 12 passed | Fresh initialization, migration, separate-profile restore, malformed recovery, legacy IDs/settings, restore preview, reminders, concurrent tabs, unsaved export, and offline restart |
| Original Node harness | 12 passed | Existing storage regression fixtures |

## Passing browser workflows

1. A fresh installation creates a valid schema-versioned dataset and renders the empty state.
2. Legacy migration remains disabled until a backup is downloaded and the verification box is checked.
3. Migration preserves legacy browser keys, creates a raw recovery snapshot, and does not repeat after reload.
4. Malformed legacy JSON opens recovery and can be exported without replacing its bytes.
5. Invalid restore files are rejected without moving the active pointer.
6. Valid legacy backups show a preview, create a pre-restore snapshot, and restore successfully.
7. Backup exports update the clearly qualified “export started” status and reminder.
8. An already-stale tab is prevented from overwriting a newer revision.
9. Two simultaneous cross-tab commits produce exactly one winner and one revision conflict.
10. A simulated storage failure leaves the new-month input and in-memory month available for unsaved export.
11. The cached application shell restarts while the browser context is offline.
12. Numeric category IDs remain selectable after migration.
13. Duplicate string expense IDs delete exactly one selected record.
14. An invalid legacy active-month setting survives migration and unrelated saves until the user explicitly selects a month.
15. A downloaded pre-migration backup restores in a separate browser context with matching month, category, transaction, and total figures.

## Release blockers and findings

### Resolved — Simultaneous commits are serialized

All browser initialization, migration, save, restore, and recovery commits now run through `navigator.locks` using one origin-wide exclusive lock. The expected revision is checked while the lock is held. A waiting tab therefore sees the winning revision and receives `REVISION_CONFLICT` instead of reporting a second success.

Additional safeguards:

- Direct browser calls that bypass the lock fail with `LOCK_REQUIRED`.
- Browsers without Web Locks fail closed with `LOCK_UNAVAILABLE`, keeping unsaved state available rather than using an unsafe fallback.
- Revision pruning re-reads and preserves the revision currently named by the active pointer.
- Jest verifies simultaneous queued writes, unavailable-lock behavior, and bypass prevention.
- Rapid writes from one tab are safely rebased on that tab's preceding revision instead of producing a false conflict.
- Playwright verifies real simultaneous commits from two pages in the same origin.

### Resolved — Backup metadata validation

Unknown formats are rejected even when they resemble legacy backups. Versioned backups must contain matching supported top-level and nested schema versions plus an explicit dataset data object. The unversioned path is limited to backups without format/schema metadata.

Verified behavior:

- Unknown formats return `INVALID_BACKUP`.
- Future nested or top-level versions return `FUTURE_SCHEMA`.
- Mismatched or incomplete wrappers return `INVALID_BACKUP` without changing active data.

### Resolved — Legacy ID operability

Expense entry now selects a category by its array position and stores the category's original ID without coercion. Expense deletion uses the exact ledger array position rather than an interpolated legacy ID, so duplicate IDs cannot delete multiple records. Category reporting handles mixed numeric/string IDs and uses category-name snapshots to disambiguate duplicate IDs where possible.

Verified behavior:

- Numeric category IDs remain numeric on new expenses.
- String expense IDs are never interpolated as JavaScript expressions.
- Deleting one of two expenses with the same ID removes only the selected entry.

### Resolved — Legacy active-month preservation

Migration preserves the exact stored active-month value. The interface can display the first available month as a non-destructive fallback, while unrelated saves retain the original setting until the user explicitly selects a valid month.

The migration's exact-preservation comparison now includes `activeMonth`.

### Resolved — Exact snapshot verification

Raw migration and dataset recovery snapshots are serialized once, written once, read back, and compared byte-for-byte. Any mutation or truncation aborts before activation with `SNAPSHOT_FAILED`.

### Resolved — Validate-before-snapshot restore order

The adapter now normalizes and validates a raw recovery candidate before creating any replacement snapshot. Invalid candidates leave active data and recovery artifacts unchanged.

## Environment

- Node.js: 22.3.0
- npm: 10.8.1
- Jest: 30.5.2
- Playwright: 1.64.0
- Browser: installed Google Chrome channel

Playwright's managed Chromium build is unavailable for this macOS 12 ARM64 host, so the test configuration intentionally uses the installed Chrome channel. Service workers are blocked for ordinary tests to avoid installation-driven reload races and enabled in a dedicated offline-restart test.

## Commands

```bash
npm install
npm run test:legacy
npm run test:jest
npm run test:playwright
npm test
```

The Playwright command starts a temporary server on `127.0.0.1:4173`.

## Tests still requiring real data or manual environments

- Restore a real production export in a separate browser profile or preview origin and compare every month/category count, transaction, ID, date, order, and total.
- Test true browser quota exhaustion; the browser suite currently simulates the adapter failure deterministically.
- Exercise the service-worker update prompt from an older installed application version with a partially completed form.
- Run the browser suite on supported mobile Safari, Firefox, and Chromium-based desktop/mobile targets.
- Verify migration and recovery on the actual production origin only after the preview checks pass.

## Release procedure

Deploy this build to an isolated preview on the same origin strategy intended for production. Restore a freshly downloaded copy of the real daily-use backup, compare counts and totals, and exercise migration plus rollback. If that real-data check passes, deploy Phase 0 to the existing production origin without changing its domain. Keep the downloaded backup and raw recovery snapshot through the observation period.
