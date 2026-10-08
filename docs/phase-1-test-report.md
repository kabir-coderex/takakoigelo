# Phase 1 Test Report

Date: 8 October 2026  
Scope: Reliable transaction entry  
Decision: **Release candidate — automated Phase 1 gates pass**

## Summary

All 38 Jest cases, all 17 Playwright browser workflows, and all 12 dependency-free storage checks pass. The run includes the complete Phase 0 regression suite.

Phase 1 now supports full-date expense entry and editing, explicit cross-month moves, safe rendering, category archival, category-import protection, and recoverable deletion. Legacy date normalization preserves counts, amounts, and original date strings and flags values that cannot be inferred safely.

## Test results

| Suite | Result | Coverage |
| --- | --- | --- |
| Jest | 38 passed | Phase 0 storage guarantees plus Phase 1 date normalization, strict validation, totals, idempotent upgrade, and recovery snapshot |
| Playwright | 17 passed | Phase 0 browser workflows plus safe text, full-date entry, edit/move, trash/undo, category archival/import protection, and date-review UI |
| Original Node harness | 12 passed | Legacy migration, backups, revisions, recovery, and storage fault regressions |

## Passing Phase 1 workflows

1. A valid legacy day/month is converted to a full local `YYYY-MM-DD` date only when it agrees with its containing month.
2. A conflicting or invalid legacy date keeps its exact original string, receives no invented full date, and is visibly flagged for review.
3. Phase 1 normalization creates a recovery point, is repeatable, and preserves transaction counts and totals.
4. New expenses require a finite positive amount, active category, description, and valid date inside the selected month.
5. User text containing HTML syntax renders as text and does not create executable DOM elements.
6. Editing can change description, amount, category, and date.
7. Moving a corrected date across months requires an existing destination month, a valid destination category, and explicit confirmation.
8. Single deletion moves the complete expense record into persistent trash and immediate Undo restores it.
9. Bulk month clearing moves every expense to persistent trash.
10. Removing a referenced monthly category archives it while keeping its transactions and historical reporting visible.
11. Replacing monthly categories from CSV retains referenced categories as archived and does not disconnect or hide expenses.
12. Full JSON backups retain trash and date-review metadata; legacy backups normalize through the same pipeline.
13. Expense CSV export distinguishes verified dates, original legacy values, and records needing date review.

## Commands

```bash
npm test
```

The Playwright command starts a temporary server on `127.0.0.1:4173` and uses the installed Chrome channel configured for this host.

## Manual release checks still required

- Normalize a copy of real production data and compare transaction counts and monthly/category totals before and after.
- Manually inspect all date-review records and a sample of inferred dates.
- Verify date input, edit, month move, Undo, trash restore, category archive/restore, and CSV replacement on supported mobile browsers.
- Verify keyboard and screen-reader behavior for the new edit and recovery controls.
- Complete the Phase 0 real-data, quota, multi-browser, installed-PWA update, and production-origin checks.

## Release procedure

Deploy to an isolated preview and restore a fresh production backup. Confirm totals, review the normalization warnings, exercise edit/move/trash/category workflows, and perform a backup/restore round trip. Only then update the existing production origin. Keep the independent pre-upgrade backup and the automatic pre-normalization recovery snapshot through the observation period.
