# Phase 2 Test Report

Date: 8 October 2026  
Scope: Multiple budget workspaces  
Decision: **Release candidate — automated Phase 2 gates pass**

## Summary

All 42 Jest cases, all 21 Playwright browser workflows, and all 12 dependency-free storage checks pass. The run includes the complete Phase 0 and Phase 1 regression suites.

Phase 2 maps all existing records into one **Existing Budget** workspace, supports independent named workspace budgets and templates, aggregates them without double counting, and preserves archived workspace history.

## Test results

| Suite | Result | Coverage |
| --- | --- | --- |
| Jest | 42 passed | Phase 0/1 contracts plus exact workspace migration, idempotence, validation, independent category identity, combined totals, and archived history |
| Playwright | 21 passed | Phase 0/1 workflows plus workspace overview, CRUD/archive/restore, earlier-month copying, and cross-workspace transaction moves |
| Original Node harness | 12 passed | Legacy migration, backup, revision, recovery, and storage-fault regressions |

## Passing Phase 2 workflows

1. Every legacy month, category, and expense is mapped exactly once into **Existing Budget**.
2. The existing global template becomes the Existing Budget workspace template.
3. Repeated normalization does not create duplicate workspaces, budgets, or transactions.
4. Family and Personal-style workspaces can use the same category name with independent IDs, budgets, and spending.
5. Workspace-specific totals contain only that workspace’s transactions.
6. All Workspaces totals count every expense exactly once.
7. Users can create, rename, switch, archive, and restore workspaces.
8. Archived workspaces keep their monthly budgets and historical transactions.
9. New months copy each workspace from its latest earlier budget and never from a future month.
10. A workspace template is used when no earlier monthly budget exists.
11. New expenses use the selected workspace.
12. Expense editing can move a transaction between workspaces only with a valid destination category and explicit confirmation.
13. Transaction trash records its source workspace and restores to the correct monthly budget.
14. Legacy, Phase 0, Phase 1, and Phase 2 backups all pass through the same validated normalization and restore pipeline.

## Commands

```bash
npm test
```

The Playwright command starts a temporary server on `127.0.0.1:4173` and uses the installed Chrome channel configured for this host.

## Manual release checks still required

- Migrate a fresh production-data copy and compare all records and totals inside Existing Budget.
- Confirm All Workspaces totals equal the sum of workspace-specific totals with no duplicate expenses.
- Test workspace controls, templates, month copying, archive/restore, and transaction moves on supported mobile browsers.
- Perform a full backup/restore/recovery round trip containing multiple and archived workspaces.
- Complete the previously documented Phase 0 and Phase 1 real-device and production-origin checks.

## Release procedure

Deploy to an isolated preview and restore a fresh production backup. Verify the Existing Budget mapping and counts, create separate test workspaces, exercise month copying and transaction moves, archive and restore a workspace, and complete a backup/restore round trip. Only then update the existing production origin. Keep the independent backup and automatic pre-Phase-2 recovery snapshot through the observation period.
