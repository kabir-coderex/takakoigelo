# Taka Koi Gelo — Implementation Status

Last updated: 8 October 2026
Roadmap: [`roadmap.md`](./roadmap.md)

This is the living delivery record for the product roadmap. Update it after every phase with the shipped scope, design decisions, migration impact, verification evidence, known limitations, and the recommended next step.

## Progress

| Phase | Status | Implementation summary |
| --- | --- | --- |
| 0. Recovery and migration foundation | Release candidate | All automated gates pass; real-data preview verification remains the production release gate |
| 1. Reliable transaction entry | Not started | Edit support, full dates, safe rendering, category lifecycle, and recoverable deletion |
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

## Suggested next step

Complete the final real-data check on an isolated preview origin using a fresh copy of the production backup. Compare counts, IDs, dates, ordering, and totals; then exercise recovery before updating the existing production origin.

After the real-data gate passes and Phase 0 is observed successfully in production, begin Phase 1 with full `YYYY-MM-DD` transaction dates and safe DOM/text rendering.

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
