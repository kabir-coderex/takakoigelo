# Taka Koi Gelo — Implementation Status

Last updated: 8 October 2026
Roadmap: [`roadmap.md`](./roadmap.md)

This is the living delivery record for the product roadmap. Update it after every phase with the shipped scope, design decisions, migration impact, verification evidence, known limitations, and the recommended next step.

## Progress

| Phase | Status | Implementation summary |
| --- | --- | --- |
| 0. Recovery and migration foundation | Release candidate | All automated gates pass; real-data preview verification remains the production release gate |
| 1. Reliable transaction entry | Release candidate | Editable full-date expenses, safe rendering, category archival/import protection, and recoverable deletion |
| 2. Multiple budget workspaces | Not started | Independent Family/Personal-style workspaces and an all-workspaces view |
| 3. Wallets, income, and transfers | Not started | Shared wallet ledger, balances, income, transfers, and fees |
| 4. Unified reports and daily-use polish | Not started | Ledger-based filters, exports, accessibility, and offline/update hardening |
| 5. Planning features | Not started | Recurring entries, goals, debt, rollover, and comparisons |
| 6. Optional enhancements | Not started | Tags, privacy controls, encryption, and optional synchronization |

## Phase 0 — Recovery and migration foundation

Implementation date: 8 October 2026
Code status: Complete
Release status: Ready for isolated real-data preview; see [`phase-0-test-report.md`](./phase-0-test-report.md)

### Implementation brief

Phase 0 replaces direct writes to the three legacy `localStorage` keys with a versioned storage adapter in `storage.js`. Browser writes are serialized with an origin-wide exclusive Web Lock. While holding that lock, the adapter writes a complete candidate revision, reads it back, validates it, and only then changes a single active-revision pointer. A write includes the revision that the current tab loaded; if another tab has already advanced the pointer, the stale write is rejected.

Existing installations do not migrate automatically. The app first validates legacy data and presents record counts and totals. Migration is enabled only after the user starts a downloadable pre-upgrade backup and confirms that it was saved and verified separately. The migration retains the original legacy keys and creates an exact raw browser snapshot before writing the schema-versioned candidate.

Backups now use the `taka-koi-gelo-backup` format with `schemaVersion: 1`. Old unversioned JSON backups remain accepted. Every restore is validated and previewed before confirmation. The app snapshots the active dataset, commits the restored candidate, reads it back, and validates it before it becomes active. Unknown future schemas and malformed backups are rejected without changing current data.

### Delivered

- Added an explicit storage adapter with read, validate, write, snapshot, restore, migration, export, and recovery operations.
- Added structural validation for current datasets, legacy data, legacy backups, and versioned backups.
- Added warnings that preserve and identify duplicate IDs and orphaned expenses instead of discarding them.
- Added schema-versioned full backups containing months, global categories, the active month, settings, export metadata, and a summary.
- Added a mandatory pre-migration backup screen with source counts and totals.
- Preserved the exact raw legacy values and left all legacy keys untouched during migration.
- Added verified candidate writes with a single active-revision pointer and a retained previous revision.
- Added a restore preview with month, category, transaction, and total figures.
- Made restore and recovery transactional, with a recovery snapshot created before replacement.
- Added a malformed-data recovery screen and raw recovery export instead of falling back to empty data.
- Added visible storage-error handling with retry, unsaved-data export, and safe reload actions.
- Added Web Locks serialization, cross-tab change detection, and revision checks to prevent stale or simultaneous overwrites.
- Added recovery-point controls in Settings. Recovering an older point first snapshots the current dataset, preserving post-upgrade records.
- Added backup reminders and a clearly worded “last export started” timestamp; the interface does not claim the file still exists.
- Coordinated service-worker updates through an update prompt instead of forcing an immediate reload while the user may be entering data.
- Added dependency-free storage tests covering the principal Phase 0 fixtures.

### Storage format

The active dataset is selected by `tkg_store_active`. Revision payloads use the `tkg_store_revision_` prefix, and durable migration/restore snapshots use `tkg_recovery_`. At most the active and immediately previous regular revisions are retained; explicit recovery snapshots are separate.

The legacy keys remain unchanged:

- `bt_months`
- `bt_global_cats`
- `bt_active_month`

No legacy expense, category, description, amount, ordering, month membership, display date, or ID is rewritten by the Phase 0 migration. Orphan and duplicate references are retained and reported as warnings for later review.

### Verification completed

Run the automated suite with:

```bash
npm test
```

The completed test run includes 12 original storage checks, 35 passing Jest cases, and 12 passing Playwright workflows. No expected-failure contracts remain. Full evidence is recorded in [`phase-0-test-report.md`](./phase-0-test-report.md).

The suites currently verify:

- fresh/empty storage initialization;
- multi-month migration totals and exact legacy-key preservation;
- repeat migration without duplicate transactions;
- malformed legacy JSON recovery;
- preservation and warning of orphaned transactions and duplicate IDs;
- ignoring an interrupted candidate that never became active;
- quota/write failure without moving the active pointer;
- migration abort when its raw safety snapshot cannot be written;
- rejection of a stale concurrent-tab write;
- rejection of malformed and unknown-future backups;
- legacy backup restore, recovery, and preservation of the replaced dataset;
- recovery from a corrupt active revision while preserving its exact raw bytes.
- restore preview and download behavior in a real browser;
- unsaved-data export after a simulated storage failure;
- offline application-shell restart;
- the normal sequential stale-tab workflow.

JavaScript syntax checks pass for both `storage.js` and the inline application script.

### Manual release checks still required

Phase 0 should not be deployed to the daily-use origin until these checks pass on copies of real data:

- Download a real pre-upgrade backup and restore it in a separate browser profile or preview origin.
- Compare month/category counts, transaction counts, descriptions, IDs, dates, ordering, and totals with the current production installation.
- Exercise the migration, reload, backup, restore preview, restore, and recovery flows in supported mobile and desktop browsers.
- Open two tabs and confirm the stale tab cannot overwrite the newer revision.
- Simulate restricted or full browser storage and confirm entered values remain available for retry/export.
- Test offline restart and the service-worker update prompt on an installed PWA.
- Verify the production host keeps the same origin and serves `sw.js` and `manifest.json` with the intended cache headers.

### Known boundaries

- Automatic browser snapshots are stored on the same device and are not a substitute for an independently saved backup.
- The browser cannot prove that a download still exists. The app records only when an export was started and asks the user to verify it.
- Phase 0 intentionally preserves the legacy transaction shape. Full dates, editing, HTML-safe rendering, category archival, and recoverable transaction deletion belong to Phase 1.
- Recovery snapshots are retained deliberately. Any future cleanup feature must be explicit and must never delete the active dataset.

## Phase 1 — Reliable transaction entry

Implementation date: 8 October 2026
Code status: Complete
Release status: Ready for isolated real-data preview; see [`phase-1-test-report.md`](./phase-1-test-report.md)

### Implementation brief

Phase 1 adds full local calendar dates and editing without replacing the existing expense ledger. A one-time `phase1Version` data normalization runs inside the existing serialized storage workflow. Before normalizing an already active Phase 0 dataset, the adapter creates a recoverable dataset snapshot and verifies that transaction counts and totals are unchanged.

Legacy display dates are converted to `YYYY-MM-DD` only when their day and month are valid and the month agrees with the containing budget month. The exact original string remains in `legacyDate`. Conflicting or unparseable values remain preserved with `date: null` and a visible review reason; the application does not invent a date.

### Delivered

- Added full-date entry with a date constrained to the selected budget month.
- Added expense editing for amount, description, category, and date.
- Added explicit cross-month moves. The destination month must already exist and the user must choose a valid destination category and confirm the move.
- Added finite, positive amount validation in both the interface and storage validator.
- Escaped user-controlled category, expense, month, date, recovery, and imported text in HTML-rendered views.
- Preserved category-name snapshots on existing transactions when categories are renamed.
- Archived monthly categories that still have transactions instead of deleting them; archived categories remain in historical reports and can be restored.
- Prevented monthly CSV replacement from removing categories referenced by existing expenses. Referenced categories are retained as archived unless the import reactivates them.
- Excluded archived categories when creating new expenses or copying categories into a new month.
- Moved single and bulk expense deletions to persistent transaction trash, with immediate Undo and Settings-based restore.
- Added recovery snapshots before whole-month and all-month deletion.
- Extended expense CSV export with verified date, original legacy date, and date-review status columns.
- Kept legacy, versioned, and recovered backups restorable through the same normalization pipeline.

### Data migration and compatibility

The storage envelope and backup format remain schema version 1 because Phase 1 fields are backward-compatible additions. Dataset evolution is tracked separately by `settings.phase1Version: 1`. Phase 0 datasets without that marker are snapshotted and normalized once; reopening is idempotent.

Normalized legacy expenses retain all IDs, amounts, descriptions, category IDs/snapshots, order, and containing months. Trustworthy dates gain their inferred full date while retaining the original string. Conflicting dates retain only the original value plus review metadata until the user corrects them. Totals do not depend on date normalization and are compared before activation.

Deleted expenses are stored in `settings.transactionTrash` with their full expense record, source month, source position, and deletion timestamp. They remain part of full JSON backups but are excluded from active spending totals until restored.

### Verification completed

Run the full suite with:

```bash
npm test
```

The completed run includes 12 dependency-free storage checks, 38 passing Jest cases, and 17 passing Playwright browser workflows. Phase 1 coverage verifies trusted and conflicting date normalization, migration snapshots and unchanged totals, strict amount/date validation, HTML-safe rendering, full-date entry, editing, confirmed month moves, trash/undo, category archival, CSV replacement protection, and every Phase 0 regression workflow.

### Manual release checks still required

- Preview a fresh copy of real production data and compare every pre/post-normalization transaction count and monthly/category total.
- Review every flagged legacy date and confirm that no conflicting date was inferred.
- Exercise editing, cross-month moves, category archival/restore, CSV replacement, trash restore, backup, restore, and recovery on supported mobile browsers.
- Confirm date-input behavior and local calendar dates on devices in the production timezone.
- Verify keyboard and screen-reader operation of edit, delete, Undo, category archive, and restore controls.
- Complete the outstanding Phase 0 production release checks before updating the daily-use origin.

### Known boundaries

- A cross-month edit requires the destination month and category to exist first; Phase 2 workspace-aware reassignment will build on this rule.
- Date normalization recognizes the English abbreviated/full month names produced by the legacy application. Other or conflicting strings are preserved for review.
- Transaction trash is intentionally retained and has no permanent-empty action in Phase 1.
- Whole-month and all-month deletion use recovery snapshots rather than transaction trash because their scope includes budgets and category structure.

### Suggested next step

Run the Phase 1 real-data preview and manual mobile/accessibility checks. After both Phase 0 and Phase 1 release gates pass in the daily-use environment, begin Phase 2 with the Existing Budget workspace migration.

## Suggested next step

Complete the final real-data check on an isolated preview origin using a fresh copy of the production backup. Compare counts, IDs, dates, ordering, and totals; then exercise recovery before updating the existing production origin.

Complete the Phase 1 real-data preview and manual release checks. Then begin Phase 2 by mapping all existing records into one **Existing Budget** workspace without duplicating transactions.

## Update template for the next phase

When a phase is implemented, append or update a section using this structure:

```text
## Phase N — Name

Implementation date:
Code status:
Release status:

### Implementation brief
### Delivered
### Data migration and compatibility
### Verification completed
### Manual release checks still required
### Known boundaries
### Suggested next step
```
