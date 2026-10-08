# Taka Koi Gelo — Product Roadmap

Created: 8 October 2026  
Status: Proposed implementation plan  
Primary requirement: Preserve existing records through every upgrade.

## Goal

Evolve the existing offline budget tracker into a simple money manager with separate Family and Personal budgets, shared wallets, income, and transfers. Keep mobile expense entry fast and retain vanilla HTML, CSS, and JavaScript without mandatory accounts or a backend.

This document is a roadmap, not an implemented migration or a claim that the live app has been fully tested. Shared wallets with separate budget reporting are the proposed default.

## Current baseline

The supplied source stores monthly categories and expenses in `bt_months`, the global category template in `bt_global_cats`, and the selected month in `bt_active_month` in localStorage. Expenses contain `id`, `catId`, `cat`, `desc`, `amt`, and a display date without a year. JSON backups currently contain `months`, `globalCats`, and `exportedAt` without a schema version.

Initialization currently falls back to empty collections when JSON parsing fails. The new version must instead preserve unreadable raw values and offer recovery. The service worker currently activates immediately; updates need coordination with migration and open tabs.

The browser data belongs to the site's origin. Keep the existing production URL during this work. Changing domains requires an explicit export/import transfer.

## Non-negotiable data requirements

- [ ] Never delete, overwrite, or reset legacy data as part of an upgrade.
- [ ] Never silently discard records that cannot be parsed or mapped.
- [ ] Download a complete JSON backup before upgrading the daily-use installation, and verify restoration in an isolated test environment.
- [ ] Preserve a raw local snapshot before every migration or destructive import, in addition to the downloaded backup.
- [ ] Retain descriptions, amounts, categories, ordering, month membership, and original dates. Preserve original IDs as legacy metadata if new unique IDs are required.
- [ ] Version both application storage and exported backups.
- [ ] Validate migrated data before selecting it as the active dataset.
- [ ] Abort safely on corrupt data, quota errors, interrupted writes, or failed validation. Keep the previous dataset available.
- [ ] Keep old JSON backups restorable through the migration pipeline.
- [ ] Make migration repeatable without duplicate records or duplicate wallet deductions.
- [ ] Rollback must preserve records created after the upgrade; switching back to an old snapshot alone is not sufficient.

No browser-only app can guarantee survival after device loss or cleared browser storage. Independently saved backups are part of this requirement; an automatic snapshot in the same browser is not an independent backup.

## Proposed product model

| Concept | Responsibility |
| --- | --- |
| Workspace | A persistent budget identity, such as Family or Personal |
| Monthly budget | A workspace's categories and planned amounts for one calendar month |
| Category | A spending classification within a monthly workspace budget |
| Wallet | A shared, ongoing money balance: Cash, Bank, bKash, etc. |
| Transaction | An income, expense, transfer, opening balance, or adjustment |
| Template | Default categories and budgets for future months in a workspace |

Examples: October → Family → Groceries; October → Personal → Learning. Both can pay from the same Bank wallet. Wallet balances continue across months. Workspace allocations are plans and do not move money.

Each new expense must reference one wallet, one workspace, one category, and a full transaction date. Income requires a wallet and source; a budget workspace is optional. Reports derive the calendar month from the transaction date, and editing a date across months requires validation of the destination budget/category.

Use stable IDs and a single authoritative transaction ledger. Store BDT amounts as integer poisha for arithmetic. Preserve legacy values and flag unsupported precision rather than silently rounding them.

## Delivery order

| Phase | Priority | Outcome | Dependency |
| --- | --- | --- | --- |
| 0. Recovery and migration foundation | P0 | Safe upgrades and verified backups | None |
| 1. Reliable transaction entry | P0 | Edit expenses, full dates, safe rendering | Phase 0 |
| 2. Multiple budget workspaces | P0 | Family and Personal budgets in the same month | Phase 1 |
| 3. Wallets, income, and transfers | P0 | Actual money balances alongside planned budgets | Phase 2 |
| 4. Unified reports and daily-use polish | P1 | Clear workspace and cash-flow reporting | Phase 3 |
| 5. Planning features | P1 | Recurring entries, savings, debt, rollover | Stable core |
| 6. Optional enhancements | P2 | Tags, privacy controls, optional sync | Proven user need |

Release one phase at a time. Calendar commitments should follow implementation estimates and migration testing; data safety is the release gate.

## Phase 0 — Recovery and migration foundation

### Deliverables

- [ ] Introduce a storage adapter with explicit read, validate, write, backup, and recover operations.
- [ ] Add a schema-versioned backup format containing all data and relevant settings.
- [ ] Build a strict validator for legacy and new backups, including unknown future versions.
- [ ] Add a restore preview showing months, categories, transactions, and totals before confirmation.
- [ ] Make restore transactional: validate a candidate first, snapshot current data, then commit the replacement.
- [ ] Reject an invalid backup without modifying current data.
- [ ] Handle storage failures visibly and keep unsaved input available for retry or export.
- [ ] Detect concurrent tabs; prevent stale tabs from overwriting newer datasets. localStorage has no multi-key transaction, so use a verified candidate dataset plus one active revision pointer and serialize writes.
- [ ] Offer recovery/export when existing data is malformed instead of initializing and saving empty state.
- [ ] Add backup reminders and show the last successful export date, without claiming a downloaded file still exists.

### Migration sequence

1. Read the legacy keys without modifying them; retain their exact raw strings.
2. Require a downloadable pre-upgrade backup for the daily-use installation and verify restore on a copy.
3. Build the new dataset separately under versioned keys. Preserve the legacy keys and snapshot.
4. Compare counts, IDs/mappings, original field values, and expense totals per month and category. Preserve orphaned categories/expenses for recovery.
5. Write the candidate, read it back, and validate it again.
6. Switch the active dataset pointer only after all checks pass. Keep a migration record with source version, destination version, and validation results.
7. Reopening the app resumes or recognizes the migration without repeating it.
8. On failure, offer the existing dataset and export/recovery options. Do not automatically clear storage or downgrade newly written data.

### Release gate

- [ ] Real exported data restores successfully on a separate browser profile/test origin.
- [ ] Empty, multi-month, malformed, orphaned, duplicate-ID, interrupted-migration, low-storage, and concurrent-tab fixtures are covered.
- [ ] Reload and repeated migration preserve every record and total.
- [ ] Rollback/recovery is demonstrated without losing post-upgrade transactions.

## Phase 1 — Reliable transaction entry

- [ ] Add edit support for amount, description, category, and transaction date.
- [ ] Store full local calendar dates as `YYYY-MM-DD`; keep timestamps separately where needed.
- [ ] Infer legacy years from the containing month only when the stored day/month is valid and agrees with it. Preserve conflicting dates and flag them for review; do not invent dates.
- [ ] Treat date corrections that change the month as an explicit move with valid destination references.
- [ ] Render user-entered values safely, avoiding unescaped HTML insertion.
- [ ] Validate finite positive amounts and distinguish invalid input from valid zero balances.
- [ ] Archive categories with transactions or require reassignment; preserve transaction category snapshots.
- [ ] Prevent category CSV replacement from disconnecting existing expenses.
- [ ] Offer undo or a recoverable trash for transaction deletion.

### Release gate

- [ ] Editing updates all affected reports consistently.
- [ ] Historical spending totals are unchanged after date normalization.
- [ ] Text containing HTML or special characters displays as text.
- [ ] Category removal/import cannot silently hide transactions.

## Phase 2 — Multiple budget workspaces

- [ ] Create, rename, switch, and archive named workspaces.
- [ ] Support independent Family and Personal categories and budgets within one month.
- [ ] Give each workspace its own template and month-copy workflow.
- [ ] Copy budgets/categories from the latest earlier month of that workspace, or its template when no earlier month exists. Do not copy from a future month.
- [ ] Provide workspace-specific views and an All Workspaces overview.
- [ ] Default new expense entry to the selected workspace.
- [ ] Support moving an expense between workspaces with category reassignment.
- [ ] Archive a workspace without deleting its historical records.

### Existing-data mapping

Migrate every existing month into one workspace named **Existing Budget**. Copy the existing global template into that workspace. Do not assume that old expenses were Family or Personal spending. The user can rename this workspace and optionally reclassify entries later. Create Personal or Family as additional workspaces without duplicating old records.

### Release gate

- [ ] All legacy monthly/category totals match inside Existing Budget.
- [ ] Family and Personal can use identical category names without collisions.
- [ ] Combined spending counts each expense exactly once.
- [ ] Archiving preserves history and exports.

## Phase 3 — Wallets, income, and transfers

- [ ] Create and archive Cash, Bank, bKash, and custom wallets.
- [ ] Set an opening balance with an effective date; distinguish it from earned income.
- [ ] Add income entries with wallet, source, description, amount, and date.
- [ ] Require a funding wallet for new expenses.
- [ ] Record transfers as one operation affecting two wallets; exclude transfer principal from income and expense totals.
- [ ] Record transfer fees as separate expenses linked to the transfer.
- [ ] Provide wallet history, balances, and optional balance adjustments with a reason.
- [ ] Derive balances from the ledger so editing/deleting an entry recalculates correctly.
- [ ] Show budget remaining and wallet balance as separate values.
- [ ] Warn about insufficient funds; allow explicit confirmation of a negative tracked balance when records are incomplete.
- [ ] Keep wallets shared across workspaces and independent of month boundaries.

### Historical expenses and wallet onboarding

Never deduct all old expenses from a newly entered current wallet balance. Preserve legacy entries with an explicit **wallet unassigned** status. They continue to count in budget reports but do not affect known wallet balances.

During onboarding, let the user enter each wallet's balance as of a chosen starting date. New wallet-linked transactions from that date affect it. Historical reconciliation is optional and must show a balance preview; assigning older entries must not change today's balance without a corresponding verified opening balance or adjustment.

### Accounting acceptance examples

| Action | Wallet effect | Budget/report effect |
| --- | --- | --- |
| Bank opening balance ৳10,000 | Bank becomes ৳10,000 | No income or spending |
| Salary ৳50,000 into Bank | Bank +৳50,000 | Income +৳50,000 |
| Family groceries ৳4,000 from Bank | Bank −৳4,000 | Family/Groceries spending +৳4,000 |
| Bank → bKash ৳5,000 | Bank −৳5,000; bKash +৳5,000 | No income or spending |
| Transfer fee ৳20 from Bank | Bank −৳20 | Fee expense +৳20 |
| Set Personal budget to ৳3,000 | No change | Planned budget only |
| Import legacy expense with no wallet | No change | Historical spending retained |

### Release gate

- [ ] Combined wallet balance is unchanged by a fee-free transfer.
- [ ] Edits, deletes, restores, and repeated migrations never double-apply wallet movements.
- [ ] Archived wallets retain all ledger references.
- [ ] Income, opening balances, adjustments, and transfers remain distinct in reports.

## Phase 4 — Unified reports and daily-use polish

- [ ] Filter reports by month, workspace, wallet, category, and transaction type.
- [ ] Show monthly income, expenses, and net cash flow separately from budget remaining and total wallet balances.
- [ ] Exclude opening balances, transfers, and reconciliation adjustments from earned-income/spending summaries.
- [ ] Show legacy expenses without assigned wallets clearly in wallet-filtered reports.
- [ ] Extend CSV export for income, expenses, and transfers; retain full dates and workspace/wallet names.
- [ ] Back up all workspaces, wallets, ledger entries, templates, schema metadata, and settings.
- [ ] Keep mobile entry quick with remembered selections, appropriate keyboards, and clear validation.
- [ ] Test offline entry, restart persistence, install behavior, and keyboard accessibility.
- [ ] Coordinate service-worker updates with open forms and storage versions. Offer an update prompt instead of forcing a reload during entry.
- [ ] Remove only app-owned obsolete caches and never budget storage during cache cleanup.

### Release gate

- [ ] Reports reconcile with ledger totals across all workspaces.
- [ ] A full backup/restore round trip reproduces wallet balances and historical budgets.
- [ ] An installed older PWA upgrades without losing saved records or unsaved input.

## Phase 5 — Planning features

Deliver individually after the core is stable:

- [ ] Recurring templates for rent, bills, and salary, producing reviewable due entries. Track occurrences to prevent duplicates; do not rely on background execution when the app is closed.
- [ ] Savings goals with target amount/date and linked contributions. Distinguish earmarked money from actual wallet transfers and spending.
- [ ] Debt tracking for borrowing, lending, repayment, and remaining principal. Separate loan proceeds from earned income and principal repayments from ordinary spending; report interest/fees separately.
- [ ] Opt-in budget rollover per category/workspace, defining treatment of overspending and edited prior months. Rollover changes the spending plan, not wallet balances.
- [ ] Spending comparisons and useful threshold alerts based on recorded data.

## Phase 6 — Optional enhancements

- [ ] Transaction tags and saved filters.
- [ ] Optional app lock, with a clear distinction between hiding the interface and encrypting stored data.
- [ ] Optional encrypted backup exports with recovery guidance before activation.
- [ ] Optional cross-device sync only if needed; preserve offline use and define conflict resolution before implementation.
- [ ] Optional household collaboration only after identities and shared/private data boundaries are designed.

## Final release checklist for every phase

- [ ] Confirm a fresh independent backup and a tested recovery path.
- [ ] Run migrations and regression workflows on copies, never first on the only daily-use dataset.
- [ ] Compare record counts, monthly/category totals, and wallet balances where applicable.
- [ ] Verify existing CSV export/import and legacy JSON restore remain supported.
- [ ] Verify refresh, offline restart, concurrent tabs, and PWA update behavior.
- [ ] Ship to an isolated preview before updating the existing production origin.
- [ ] Publish migration notes and recovery instructions alongside the release.
- [ ] Keep rollback artifacts and raw legacy data; cleanup is a separate deliberate action after verified backups and stable use.

## First milestone

Start with Phase 0: a verified backup/restore workflow and a migration mechanism that leaves the existing dataset intact. Workspaces and wallets become releasable only after this foundation passes its acceptance checks.
