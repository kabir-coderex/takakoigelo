'use strict';

const assert = require('assert');
const BudgetStorage = require('../storage.js');

class MockStorage {
  constructor(seed) {
    this.map = new Map(Object.entries(seed || {}));
    this.failWrites = false;
  }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(String(key), String(value));
  }
  removeItem(key) { this.map.delete(key); }
}

function legacyFixture(overrides) {
  const months = {
    '2026-09': {
      name: 'September 2026',
      categories: [{ id: 'food', name: 'Food', budget: 5000 }],
      expenses: [{ id: 1, catId: 'food', cat: 'Food', desc: 'Lunch', amt: 250, date: '08 Sep' }]
    },
    '2026-10': {
      name: 'October 2026',
      categories: [{ id: 'rent', name: 'Rent', budget: 15000 }],
      expenses: [{ id: 2, catId: 'rent', cat: 'Rent', desc: 'Home', amt: 15000, date: '01 Oct' }]
    }
  };
  return Object.assign({
    bt_months: JSON.stringify(months),
    bt_global_cats: JSON.stringify([{ id: 'food', name: 'Food', budget: 5000 }]),
    bt_active_month: '2026-10'
  }, overrides || {});
}

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    process.stderr.write(`✗ ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

test('creates a validated empty versioned dataset for a fresh install', () => {
  const storage = new MockStorage();
  const result = new BudgetStorage.Adapter(storage).bootstrap();
  assert.equal(result.status, 'ready');
  assert.equal(result.validation.valid, true);
  assert.ok(storage.getItem(BudgetStorage.constants.ACTIVE_KEY));
});

test('requires a backup-gated migration and preserves legacy keys exactly', () => {
  const seed = legacyFixture();
  const storage = new MockStorage(seed);
  const adapter = new BudgetStorage.Adapter(storage);
  const before = Object.fromEntries(Object.keys(seed).map(key => [key, storage.getItem(key)]));
  const boot = adapter.bootstrap();
  assert.equal(boot.status, 'migration_required');
  assert.deepEqual(boot.summary, {
    months: 2,
    globalCategories: 1,
    monthlyCategories: 2,
    transactions: 2,
    totalAmount: 15250,
    byMonth: {
      '2026-09': { categories: 1, transactions: 1, totalAmount: 250 },
      '2026-10': { categories: 1, transactions: 1, totalAmount: 15000 }
    }
  });
  const migrated = adapter.migrateLegacy(boot.rawLegacy);
  assert.equal(migrated.validation.valid, true);
  assert.deepEqual(Object.fromEntries(Object.keys(seed).map(key => [key, storage.getItem(key)])), before);
  assert.ok(adapter.listRecoveryPoints().some(point => point.kind === 'raw-legacy'));
});

test('repeat migration recognizes the active dataset without duplicating records', () => {
  const storage = new MockStorage(legacyFixture());
  const adapter = new BudgetStorage.Adapter(storage);
  const boot = adapter.bootstrap();
  const first = adapter.migrateLegacy(boot.rawLegacy);
  const second = adapter.migrateLegacy(boot.rawLegacy);
  assert.equal(second.envelope.revision, first.envelope.revision);
  assert.equal(BudgetStorage.summarize(second.envelope.data).transactions, 2);
});

test('malformed legacy JSON enters recovery without writing active data', () => {
  const storage = new MockStorage(legacyFixture({ bt_months: '{broken' }));
  const result = new BudgetStorage.Adapter(storage).bootstrap();
  assert.equal(result.status, 'recovery_required');
  assert.equal(result.error.code, 'INVALID_JSON');
  assert.equal(storage.getItem(BudgetStorage.constants.ACTIVE_KEY), null);
  assert.equal(storage.getItem('bt_months'), '{broken');
});

test('orphaned transactions and duplicate IDs are preserved with warnings', () => {
  const fixture = legacyFixture();
  const months = JSON.parse(fixture.bt_months);
  months['2026-10'].expenses.push({ id: 2, catId: 'missing', cat: 'Old category', desc: 'Preserve me', amt: 10, date: '02 Oct' });
  fixture.bt_months = JSON.stringify(months);
  const boot = new BudgetStorage.Adapter(new MockStorage(fixture)).bootstrap();
  assert.equal(boot.status, 'migration_required');
  assert.equal(boot.data.months['2026-10'].expenses.length, 2);
  assert.ok(boot.validation.warnings.some(message => message.includes('Duplicate expense ID')));
  assert.ok(boot.validation.warnings.some(message => message.includes('Orphaned expense')));
});

test('an interrupted candidate write without a pointer is never selected', () => {
  const storage = new MockStorage(legacyFixture());
  storage.setItem(`${BudgetStorage.constants.REVISION_PREFIX}interrupted`, JSON.stringify({ incomplete: true }));
  const boot = new BudgetStorage.Adapter(storage).bootstrap();
  assert.equal(boot.status, 'migration_required');
  assert.equal(storage.getItem(BudgetStorage.constants.ACTIVE_KEY), null);
});

test('quota failure leaves the previous active revision selected', () => {
  const storage = new MockStorage();
  const adapter = new BudgetStorage.Adapter(storage);
  const boot = adapter.bootstrap();
  const activeBefore = storage.getItem(BudgetStorage.constants.ACTIVE_KEY);
  const changed = JSON.parse(JSON.stringify(boot.envelope.data));
  changed.settings.note = 'unsaved';
  storage.failWrites = true;
  assert.throws(() => adapter.write(changed, activeBefore), error => error.code === 'WRITE_FAILED');
  assert.equal(storage.getItem(BudgetStorage.constants.ACTIVE_KEY), activeBefore);
});

test('migration aborts before activation when the raw recovery snapshot cannot be written', () => {
  const fixture = legacyFixture();
  const storage = new MockStorage(fixture);
  const adapter = new BudgetStorage.Adapter(storage);
  const boot = adapter.bootstrap();
  storage.failWrites = true;
  assert.throws(() => adapter.migrateLegacy(boot.rawLegacy), error => error.code === 'SNAPSHOT_FAILED');
  assert.equal(storage.getItem(BudgetStorage.constants.ACTIVE_KEY), null);
  assert.equal(storage.getItem('bt_months'), fixture.bt_months);
});

test('a stale tab cannot overwrite a newer dataset', () => {
  const storage = new MockStorage();
  const firstTab = new BudgetStorage.Adapter(storage, { writerId: 'first' });
  const initial = firstTab.bootstrap();
  const secondTab = new BudgetStorage.Adapter(storage, { writerId: 'second' });
  const secondInitial = secondTab.bootstrap();
  const firstData = JSON.parse(JSON.stringify(initial.envelope.data));
  firstData.settings.from = 'first';
  firstTab.write(firstData, initial.envelope.revision);
  const secondData = JSON.parse(JSON.stringify(secondInitial.envelope.data));
  secondData.settings.from = 'second';
  assert.throws(
    () => secondTab.write(secondData, secondInitial.envelope.revision),
    error => error.code === 'REVISION_CONFLICT'
  );
});

test('invalid and future backups are rejected without modifying active data', () => {
  const storage = new MockStorage();
  const adapter = new BudgetStorage.Adapter(storage);
  adapter.bootstrap();
  const activeBefore = storage.getItem(BudgetStorage.constants.ACTIVE_KEY);
  assert.throws(() => adapter.inspectBackup('{bad'), error => error.code === 'INVALID_JSON');
  assert.throws(() => adapter.inspectBackup({
    format: BudgetStorage.constants.BACKUP_FORMAT,
    schemaVersion: 999,
    dataset: {}
  }), error => error.code === 'FUTURE_SCHEMA');
  assert.equal(storage.getItem(BudgetStorage.constants.ACTIVE_KEY), activeBefore);
});

test('legacy backups restore transactionally and the replaced dataset remains recoverable', () => {
  const storage = new MockStorage();
  const adapter = new BudgetStorage.Adapter(storage);
  const boot = adapter.bootstrap();
  const legacy = JSON.parse(legacyFixture().bt_months);
  const candidate = adapter.inspectBackup({ months: legacy, globalCats: [], exportedAt: new Date().toISOString() });
  const restored = adapter.restore(candidate, boot.envelope.revision);
  assert.equal(BudgetStorage.summarize(restored.envelope.data).transactions, 2);
  const point = adapter.listRecoveryPoints().find(item => item.reason === 'before-backup-restore');
  assert.ok(point && point.recoverable);
  const recovered = adapter.recover(point.key, restored.envelope.revision);
  assert.equal(BudgetStorage.summarize(recovered.envelope.data).transactions, 0);
  const postUpgradePoint = adapter.listRecoveryPoints().find(item => item.reason === 'before-recovery-switch');
  assert.ok(postUpgradePoint && postUpgradePoint.recoverable);
  const postUpgradeRecovered = adapter.recover(postUpgradePoint.key, recovered.envelope.revision);
  assert.equal(BudgetStorage.summarize(postUpgradeRecovered.envelope.data).transactions, 2);
});

test('a valid backup can recover a corrupt active revision while preserving its raw bytes', () => {
  const storage = new MockStorage();
  storage.setItem(BudgetStorage.constants.ACTIVE_KEY, 'broken-revision');
  storage.setItem(`${BudgetStorage.constants.REVISION_PREFIX}broken-revision`, '{not-json');
  const adapter = new BudgetStorage.Adapter(storage);
  const boot = adapter.bootstrap();
  assert.equal(boot.status, 'recovery_required');
  const candidate = adapter.inspectBackup({ months: {}, globalCats: [] });
  const restored = adapter.restoreDuringRecovery(candidate, boot.rawLegacy, boot.activePointer);
  assert.equal(restored.validation.valid, true);
  const rawPoint = adapter.listRecoveryPoints().find(point => point.reason === 'before-recovery-restore');
  assert.ok(rawPoint && !rawPoint.recoverable);
  const snapshot = JSON.parse(storage.getItem(rawPoint.key));
  assert.equal(snapshot.raw.activePointer, 'broken-revision');
  assert.equal(snapshot.raw.activeRevisionRaw, '{not-json');
});

if (!process.exitCode) process.stdout.write('All storage tests passed.\n');
