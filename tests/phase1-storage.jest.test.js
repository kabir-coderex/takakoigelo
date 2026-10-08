'use strict';

const BudgetStorage = require('../storage.js');

class MemoryStorage {
  constructor(seed = {}) { this.values = new Map(Object.entries(seed)); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function legacyData(expenses) {
  return {
    months: {
      '2026-10': {
        name: 'October 2026',
        categories: [{ id: 'food', name: 'Food', budget: 1000 }],
        expenses
      }
    },
    globalCats: [],
    activeMonth: '2026-10',
    settings: { lastBackupAt: null }
  };
}

describe('Phase 1 date normalization', () => {
  test('infers only valid dates that agree with their containing month', () => {
    const source = legacyData([
      { id: 1, catId: 'food', cat: 'Food', desc: 'valid', amt: 10, date: '8 Oct' },
      { id: 2, catId: 'food', cat: 'Food', desc: 'conflict', amt: 20, date: '9 Sep' },
      { id: 3, catId: 'food', cat: 'Food', desc: 'invalid', amt: 30, date: '32 Oct' }
    ]);
    const result = BudgetStorage.upgradePhase1Data(source);
    const [valid, conflict, invalid] = result.data.months['2026-10'].expenses;

    expect(valid).toEqual(expect.objectContaining({ date: '2026-10-08', legacyDate: '8 Oct' }));
    expect(valid.dateReview).toBeUndefined();
    expect(conflict).toEqual(expect.objectContaining({ date: null, legacyDate: '9 Sep' }));
    expect(conflict.dateReview.reason).toMatch(/conflicts/);
    expect(invalid).toEqual(expect.objectContaining({ date: null, legacyDate: '32 Oct' }));
    expect(invalid.dateReview.reason).toMatch(/not valid/);
    expect(BudgetStorage.summarize(result.data).totalAmount).toBe(60);
    expect(BudgetStorage.validateData(result.data).valid).toBe(true);
  });

  test('strict Phase 1 datasets reject arbitrary date strings and invalid amounts', () => {
    const data = BudgetStorage.upgradePhase1Data(legacyData([])).data;
    data.months['2026-10'].expenses.push({
      id: 1, catId: 'food', cat: 'Food', desc: 'bad', amt: Number.POSITIVE_INFINITY, date: 'today'
    });
    const validation = BudgetStorage.validateData(data);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toMatch(/finite positive number/);
    expect(validation.errors.join(' ')).toMatch(/YYYY-MM-DD/);
  });

  test('upgrades an existing Phase 0 revision transactionally and retains a recovery point', () => {
    const storage = new MemoryStorage();
    const adapter = new BudgetStorage.Adapter(storage);
    const initial = adapter.bootstrap();
    const phase0 = legacyData([{ id: 1, catId: 'food', cat: 'Food', desc: 'meal', amt: 25, date: '02 Oct' }]);
    delete phase0.settings.phase1Version;
    delete phase0.settings.transactionTrash;
    const saved = adapter.write(phase0, initial.envelope.revision);

    const reopened = new BudgetStorage.Adapter(storage).bootstrap();
    expect(reopened.envelope.revision).not.toBe(saved.envelope.revision);
    expect(reopened.envelope.metadata.kind).toBe('phase-1-normalization');
    expect(reopened.envelope.data.months['2026-10'].expenses[0].date).toBe('2026-10-02');
    expect(BudgetStorage.summarize(reopened.envelope.data).totalAmount).toBe(25);
    expect(new BudgetStorage.Adapter(storage).listRecoveryPoints())
      .toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'before-phase-1-normalization', recoverable: true })]));
  });
});
