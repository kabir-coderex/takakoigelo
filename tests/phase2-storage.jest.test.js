'use strict';

const BudgetStorage = require('../storage.js');

function phase1Fixture() {
  return {
    months: {
      '2026-09': {
        name: 'September 2026',
        categories: [{ id: 'food', name: 'Food', budget: 5000, archived: false }],
        expenses: [{ id: 'a', catId: 'food', cat: 'Food', desc: 'Lunch', amt: 250, date: '2026-09-08' }]
      },
      '2026-10': {
        name: 'October 2026',
        categories: [{ id: 'rent', name: 'Rent', budget: 15000, archived: false }],
        expenses: [{ id: 'b', catId: 'rent', cat: 'Rent', desc: 'Home', amt: 15000, date: '2026-10-01' }]
      }
    },
    globalCats: [{ id: 'food', name: 'Food', budget: 5000, archived: false }],
    activeMonth: '2026-10',
    settings: { lastBackupAt: null, phase1Version: 1, transactionTrash: [] }
  };
}

describe('Phase 2 workspace migration and validation', () => {
  test('maps every existing record exactly once into Existing Budget', () => {
    const source = phase1Fixture();
    const before = BudgetStorage.summarize(source);
    const migrated = BudgetStorage.upgradePhase2Data(source).data;

    expect(migrated.workspaces).toEqual([expect.objectContaining({
      id: 'workspace-existing', name: 'Existing Budget', archived: false,
      template: source.globalCats
    })]);
    expect(migrated.months['2026-09'].categories).toBeUndefined();
    expect(migrated.months['2026-09'].budgets['workspace-existing'].expenses).toEqual(source.months['2026-09'].expenses);
    expect(BudgetStorage.summarize(migrated)).toEqual(before);
    expect(BudgetStorage.validateData(migrated).valid).toBe(true);
  });

  test('is repeatable without duplicating budgets or transactions', () => {
    const first = BudgetStorage.upgradePhase2Data(phase1Fixture()).data;
    const second = BudgetStorage.upgradePhase2Data(first).data;
    expect(second).toEqual(first);
    expect(BudgetStorage.summarize(second).transactions).toBe(2);
  });

  test('allows identical category names in independent workspaces and counts combined spending once', () => {
    const data = BudgetStorage.upgradePhase2Data(phase1Fixture()).data;
    data.workspaces.push({ id: 'personal', name: 'Personal', archived: false, template: [] });
    data.months['2026-10'].budgets.personal = {
      categories: [{ id: 'personal-food', name: 'Food', budget: 1000, archived: false }],
      expenses: [{ id: 'p1', catId: 'personal-food', cat: 'Food', desc: 'Snack', amt: 50, date: '2026-10-02' }]
    };
    expect(BudgetStorage.validateData(data).valid).toBe(true);
    expect(BudgetStorage.summarize(data).transactions).toBe(3);
    expect(BudgetStorage.summarize(data).totalAmount).toBe(15300);
  });

  test('archived workspaces keep valid historical budget references', () => {
    const data = BudgetStorage.upgradePhase2Data(phase1Fixture()).data;
    data.workspaces[0].archived = true;
    data.settings.activeWorkspaceId = 'all';
    expect(BudgetStorage.validateData(data).valid).toBe(true);
    expect(BudgetStorage.summarize(data).transactions).toBe(2);
  });
});
