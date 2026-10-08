# Phase 3 Test Report

Date: 8 October 2026  
Scope: Wallets, income, and transfers  
Decision: **Release candidate — automated Phase 3 gates pass**

## Summary

All 47 Jest cases, all 25 Playwright browser workflows, and all 12 dependency-free storage checks pass. The run includes the complete Phase 0, Phase 1, and Phase 2 regression suites.

Phase 3 introduces shared wallets and a derived ledger without changing historical budget totals. Existing expenses remain explicitly wallet-unassigned and balance-neutral, while new expenses require a funding wallet.

## Test results

| Suite | Result | Coverage |
| --- | --- | --- |
| Jest | 47 passed | Earlier contracts plus Phase 3 migration, idempotence, wallet references, derived balances, transfer invariance, adjustments, and fee accounting |
| Playwright | 25 passed | Earlier workflows plus the full accounting example, legacy separation, archive retention, and recalculation after edit/delete/restore |
| Original Node harness | 12 passed | Legacy migration, backup, revision, recovery, and storage-fault regressions |

## Passing Phase 3 workflows

1. Every historical active or trashed expense receives `walletId: null` without changing budget counts or totals.
2. Repeated migration never duplicates a wallet movement or applies an old expense to a balance.
3. Opening balances, income, adjustments, and transfers remain distinct ledger entry types.
4. Bank opening ৳10,000 plus salary ৳50,000, groceries ৳4,000, a ৳5,000 Bank-to-bKash transfer, and a ৳20 fee produces Bank ৳50,980 and bKash ৳5,000.
5. Transfer principal is excluded from budget spending; the linked fee is included once as a normal workspace/category expense.
6. A fee-free transfer preserves the combined wallet balance.
7. New expenses require an active wallet and wallet-linked expenses reduce only that wallet.
8. Archived wallets preserve every ledger and expense reference.
9. Editing, deleting, and restoring income recalculates from records without double application.
10. Missing wallet references, invalid dates/amounts, same-wallet transfers, and adjustments without reasons fail validation.
11. Wallet entry deletion is recoverable and restoration retains the original entry identity.
12. Legacy and earlier-phase backups normalize through Phase 3 before activation.

## Commands

```bash
npm test
```

The Playwright command starts a temporary server on `127.0.0.1:4173` and uses the installed Chrome channel configured for this host.

## Manual release checks still required

- Restore a fresh production backup and compare every pre-existing expense and budget total before entering wallet balances.
- Confirm all migrated expenses remain wallet-unassigned and do not reduce newly entered opening balances.
- Reconcile derived wallet balances against independent bank/mobile-wallet statements and a physical cash count.
- Test negative-balance confirmation, wallet and entry lifecycle controls, transfer fees, and recovery on supported mobile browsers.
- Complete a full backup/restore/recovery round trip containing linked fees, archived wallets, and wallet-entry trash.
- Finish the previously documented accessibility, offline, installed-PWA, and production-origin checks.

## Release procedure

Deploy to an isolated preview and restore a fresh production backup. Verify unchanged historical counts/totals, enter dated opening balances, reconcile each wallet, exercise transfers and recovery, then export and restore the complete dataset in a separate browser profile. Only after those checks pass should the existing production origin be updated. Retain the independent backup and automatic pre-Phase-3 recovery snapshot through the observation period.
