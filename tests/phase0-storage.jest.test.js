'use strict';

const BudgetStorage = require('../storage.js');

class MemoryStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed).map(([key, value]) => [String(key), String(value)]));
    this.writeCount = 0;
    this.failOnWrite = null;
  }

  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) {
    this.writeCount += 1;
    if (this.failOnWrite === this.writeCount) {
      const error = new Error('The quota has been exceeded.');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.values.set(String(key), String(value));
  }
  removeItem(key) { this.values.delete(String(key)); }

  failNextWrite() { this.failOnWrite = this.writeCount + 1; }
  entries() { return Object.fromEntries(this.values); }
}

class QueueLockManager {
  constructor() {
    this.tail = Promise.resolve();
  }

  request(_name, _options, operation) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    return previous.then(operation).finally(release);
  }
}

const monthData = {
  '2026-09': {
    name: 'September 2026',
    categories: [
      { id: 'food', name: 'Food', budget: 5000 },
      { id: 20, name: 'Transport', budget: 1800 }
    ],
    expenses: [
      { id: 101, catId: 'food', cat: 'Food', desc: 'Lunch <special>', amt: 250.5, date: '08 Sep' },
      { id: '102', catId: 20, cat: 'Transport', desc: 'Bus', amt: 40, date: '09 Sep' }
    ]
  },
  '2026-10': {
    name: 'October 2026',
    categories: [{ id: 'rent', name: 'Rent', budget: 15000 }],
    expenses: [{ id: 103, catId: 'rent', cat: 'Rent', desc: 'Home', amt: 15000, date: '01 Oct' }]
  }
};

function legacySeed(overrides = {}) {
  return {
    bt_months: JSON.stringify(monthData),
    bt_global_cats: JSON.stringify([
      { id: 'food', name: 'Food', budget: 5000 },
      { id: 20, name: 'Transport', budget: 1800 }
    ]),
    bt_active_month: '2026-10',
    ...overrides
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function activeRevision(storage) {
  return storage.getItem(BudgetStorage.constants.ACTIVE_KEY);
}

function recoveryKeys(storage) {
  return Object.keys(storage.entries()).filter(key => key.startsWith(BudgetStorage.constants.RECOVERY_PREFIX));
}

describe('Phase 0 dataset validation', () => {
  test('accepts a complete dataset and produces exact aggregate totals', () => {
    const data = {
      months: clone(monthData),
      globalCats: [{ id: 'food', name: 'Food', budget: 5000 }],
      activeMonth: '2026-10',
      settings: { lastBackupAt: '2026-10-08T04:00:00.000Z' }
    };

    expect(BudgetStorage.validateData(data)).toEqual({ valid: true, errors: [], warnings: [] });
    expect(BudgetStorage.summarize(data)).toEqual({
      months: 2,
      globalCategories: 1,
      monthlyCategories: 3,
      transactions: 3,
      totalAmount: 15290.5,
      byMonth: {
        '2026-09': { categories: 2, transactions: 2, totalAmount: 290.5 },
        '2026-10': { categories: 1, transactions: 1, totalAmount: 15000 }
      }
    });
  });

  test.each([
    ['non-object root', null, 'dataset must be an object'],
    ['non-object months', { months: [], globalCats: [], activeMonth: null, settings: {} }, 'months must be an object'],
    ['negative category budget', {
      months: { x: { name: 'X', categories: [{ id: 1, name: 'Bad', budget: -1 }], expenses: [] } },
      globalCats: [], activeMonth: null, settings: { lastBackupAt: null }
    }, 'budget must be a finite non-negative number'],
    ['non-positive expense amount', {
      months: { x: { name: 'X', categories: [{ id: 1, name: 'One', budget: 1 }], expenses: [{ id: 1, catId: 1, cat: 'One', desc: '', amt: 0, date: '1 X' }] } },
      globalCats: [], activeMonth: null, settings: { lastBackupAt: null }
    }, 'amt must be a finite positive number'],
    ['invalid backup timestamp', {
      months: {}, globalCats: [], activeMonth: null, settings: { lastBackupAt: 'not-a-date' }
    }, 'lastBackupAt must be an ISO date string or null']
  ])('rejects %s', (_label, data, message) => {
    const result = BudgetStorage.validateData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.includes(message))).toBe(true);
  });

  test('preserves duplicate IDs, orphaned expenses, unusual month keys, and missing active month as warnings', () => {
    const data = {
      months: {
        october: {
          name: 'October',
          categories: [
            { id: 'same', name: 'A', budget: 1 },
            { id: 'same', name: 'B', budget: 2 }
          ],
          expenses: [
            { id: 7, catId: 'absent', cat: 'Old', desc: 'one', amt: 1, date: '1 Oct' },
            { id: 7, catId: 'absent', cat: 'Old', desc: 'two', amt: 2, date: '2 Oct' }
          ]
        }
      },
      globalCats: [
        { id: 1, name: 'One', budget: 1 },
        { id: '1', name: 'Again', budget: 2 }
      ],
      activeMonth: 'missing',
      settings: { lastBackupAt: null }
    };

    const result = BudgetStorage.validateData(data);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Duplicate global category ID: 1',
      'Unusual month key: october',
      'Duplicate category ID same in october',
      'Duplicate expense ID 7 in october',
      'Orphaned expense 7 in october is preserved',
      'Active month missing does not exist; the first available month will be selected'
    ]));
    expect(data.months.october.expenses).toHaveLength(2);
  });
});

describe('Phase 0 legacy migration', () => {
  test('requires migration, reports the source, preserves every legacy field, and never changes legacy bytes', () => {
    const seed = legacySeed();
    const storage = new MemoryStorage(seed);
    const adapter = new BudgetStorage.Adapter(storage, { writerId: 'migration-test' });
    const boot = adapter.bootstrap();

    expect(boot.status).toBe('migration_required');
    expect(boot.summary.transactions).toBe(3);
    expect(boot.summary.totalAmount).toBe(15290.5);

    const backup = adapter.createPreMigrationBackup(boot.data, boot.rawLegacy);
    expect(backup.format).toBe(BudgetStorage.constants.BACKUP_FORMAT);
    expect(backup.schemaVersion).toBe(1);
    expect(backup.metadata.rawLegacy).toEqual(boot.rawLegacy);

    const migrated = adapter.migrateLegacy(boot.rawLegacy);
    expect(migrated.envelope.data.months['2026-09'].budgets['workspace-existing'].expenses[0]).toEqual(expect.objectContaining({
      id: 101, desc: 'Lunch <special>', amt: 250.5, date: '2026-09-08', legacyDate: '08 Sep'
    }));
    expect(migrated.envelope.data.months['2026-10'].budgets['workspace-existing'].expenses[0].date).toBe('2026-10-01');
    expect(migrated.envelope.metadata.validation.legacyFieldsPreserved).toBe(true);
    expect(migrated.envelope.metadata.validation.sourceSummary)
      .toEqual(migrated.envelope.metadata.validation.destinationSummary);
    for (const [key, raw] of Object.entries(seed)) expect(storage.getItem(key)).toBe(raw);

    const rawPoint = adapter.listRecoveryPoints().find(point => point.kind === 'raw-legacy');
    expect(rawPoint).toEqual(expect.objectContaining({
      reason: 'before-schema-1-migration',
      recoverable: false
    }));
    expect(JSON.parse(storage.getItem(rawPoint.key)).raw).toEqual(boot.rawLegacy);
  });

  test('repeated migration is idempotent and does not duplicate revisions or records', () => {
    const storage = new MemoryStorage(legacySeed());
    const adapter = new BudgetStorage.Adapter(storage);
    const boot = adapter.bootstrap();
    const first = adapter.migrateLegacy(boot.rawLegacy);
    const keysAfterFirst = Object.keys(storage.entries());
    const second = adapter.migrateLegacy(boot.rawLegacy);

    expect(second.envelope.revision).toBe(first.envelope.revision);
    expect(Object.keys(storage.entries())).toEqual(keysAfterFirst);
    expect(BudgetStorage.summarize(second.envelope.data).transactions).toBe(3);
  });

  test('rejects changed legacy bytes before taking a migration snapshot', () => {
    const storage = new MemoryStorage(legacySeed());
    const adapter = new BudgetStorage.Adapter(storage);
    const boot = adapter.bootstrap();
    storage.setItem('bt_active_month', '2026-09');

    expect(() => adapter.migrateLegacy(boot.rawLegacy)).toThrow(expect.objectContaining({ code: 'LEGACY_CHANGED' }));
    expect(activeRevision(storage)).toBeNull();
    expect(recoveryKeys(storage)).toHaveLength(0);
  });

  test('malformed legacy data enters recovery and preserves the exact unreadable value', () => {
    const storage = new MemoryStorage(legacySeed({ bt_months: '{bad json' }));
    const adapter = new BudgetStorage.Adapter(storage);
    const boot = adapter.bootstrap();

    expect(boot.status).toBe('recovery_required');
    expect(boot.error.code).toBe('INVALID_JSON');
    expect(boot.rawLegacy.months).toBe('{bad json');
    expect(activeRevision(storage)).toBeNull();
  });

  test('quota failure while snapshotting aborts before any active revision is written', () => {
    const storage = new MemoryStorage(legacySeed());
    const adapter = new BudgetStorage.Adapter(storage);
    const boot = adapter.bootstrap();
    storage.failNextWrite();

    expect(() => adapter.migrateLegacy(boot.rawLegacy)).toThrow(expect.objectContaining({ code: 'SNAPSHOT_FAILED' }));
    expect(activeRevision(storage)).toBeNull();
    expect(storage.getItem('bt_months')).toBe(legacySeed().bt_months);
  });
});

describe('Phase 0 backup versions and rejection', () => {
  test('round-trips the current versioned backup without sharing mutable references', () => {
    const adapter = new BudgetStorage.Adapter(new MemoryStorage());
    const data = { months: clone(monthData), globalCats: [], activeMonth: '2026-09', settings: { lastBackupAt: null } };
    const backup = adapter.createBackup(data, { purpose: 'jest' });
    data.months['2026-09'].expenses[0].amt = 999;

    const inspected = adapter.inspectBackup(JSON.stringify(backup));
    expect(inspected.sourceVersion).toBe(1);
    expect(inspected.metadata.purpose).toBe('jest');
    expect(inspected.data.months['2026-09'].budgets['workspace-existing'].expenses[0].amt).toBe(250.5);
    expect(inspected.summary.transactions).toBe(3);
  });

  test('normalizes an unversioned legacy backup and supplies missing optional fields', () => {
    const adapter = new BudgetStorage.Adapter(new MemoryStorage());
    const inspected = adapter.inspectBackup({ months: clone(monthData), exportedAt: 'legacy metadata' });

    expect(inspected.sourceVersion).toBe(0);
    expect(inspected.data.globalCats).toEqual([]);
    expect(inspected.data.activeMonth).toBe('2026-09');
    expect(inspected.data.settings).toEqual({
      lastBackupAt: null, phase1Version: 1, transactionTrash: [],
      phase2Version: 1, activeWorkspaceId: 'workspace-existing'
    });
  });

  test.each([
    ['malformed JSON', '{broken', 'INVALID_JSON'],
    ['unrecognized object', { hello: 'world' }, 'INVALID_BACKUP'],
    ['missing schemaVersion', { format: BudgetStorage.constants.BACKUP_FORMAT, dataset: {} }, 'INVALID_BACKUP'],
    ['future schema', { format: BudgetStorage.constants.BACKUP_FORMAT, schemaVersion: 2, dataset: {} }, 'FUTURE_SCHEMA'],
    ['invalid dataset', {
      format: BudgetStorage.constants.BACKUP_FORMAT,
      schemaVersion: 1,
      dataset: { data: { months: [], globalCats: [], activeMonth: null, settings: {} } }
    }, 'INVALID_BACKUP']
  ])('rejects %s without changing current data', (_label, candidate, code) => {
    const storage = new MemoryStorage();
    const adapter = new BudgetStorage.Adapter(storage);
    adapter.bootstrap();
    const before = storage.entries();

    expect(() => adapter.inspectBackup(candidate)).toThrow(expect.objectContaining({ code }));
    expect(storage.entries()).toEqual(before);
  });
});

describe('Phase 0 transactional restore and recovery', () => {
  test('restores a validated candidate and can recover both pre-restore and post-upgrade datasets', () => {
    const storage = new MemoryStorage();
    const adapter = new BudgetStorage.Adapter(storage);
    const initial = adapter.bootstrap();
    const candidate = adapter.inspectBackup({ months: clone(monthData), globalCats: [] });
    const restored = adapter.restore(candidate, initial.envelope.revision);

    expect(BudgetStorage.summarize(restored.envelope.data).transactions).toBe(3);
    const beforeRestore = adapter.listRecoveryPoints().find(point => point.reason === 'before-backup-restore');
    expect(beforeRestore.recoverable).toBe(true);

    const rolledBack = adapter.recover(beforeRestore.key, restored.envelope.revision);
    expect(BudgetStorage.summarize(rolledBack.envelope.data).transactions).toBe(0);
    const beforeSwitch = adapter.listRecoveryPoints().find(point => point.reason === 'before-recovery-switch');
    const rolledForward = adapter.recover(beforeSwitch.key, rolledBack.envelope.revision);
    expect(BudgetStorage.summarize(rolledForward.envelope.data).transactions).toBe(3);
  });

  test('a quota error during candidate write leaves the previous pointer and data active', () => {
    const storage = new MemoryStorage();
    const adapter = new BudgetStorage.Adapter(storage);
    const initial = adapter.bootstrap();
    const beforePointer = activeRevision(storage);
    const changed = clone(initial.envelope.data);
    changed.settings.marker = 'must not activate';
    storage.failNextWrite();

    expect(() => adapter.write(changed, initial.envelope.revision)).toThrow(expect.objectContaining({ code: 'WRITE_FAILED' }));
    expect(activeRevision(storage)).toBe(beforePointer);
    expect(adapter.readActive().envelope.data.settings.marker).toBeUndefined();
  });

  test('a pointer-write failure leaves the verified candidate inactive and reload uses the old revision', () => {
    const storage = new MemoryStorage();
    const adapter = new BudgetStorage.Adapter(storage);
    const initial = adapter.bootstrap();
    const previousPointer = activeRevision(storage);
    const changed = clone(initial.envelope.data);
    changed.settings.marker = 'candidate';
    storage.failOnWrite = storage.writeCount + 2;

    expect(() => adapter.write(changed, previousPointer)).toThrow(expect.objectContaining({ code: 'WRITE_FAILED' }));
    expect(activeRevision(storage)).toBe(previousPointer);
    expect(new BudgetStorage.Adapter(storage).bootstrap().envelope.data.settings.marker).toBeUndefined();
  });

  test('rejects missing, raw-only, and invalid recovery artifacts without changing active data', () => {
    const storage = new MemoryStorage();
    const adapter = new BudgetStorage.Adapter(storage);
    const initial = adapter.bootstrap();
    const before = activeRevision(storage);
    const rawKey = `${BudgetStorage.constants.RECOVERY_PREFIX}raw-test`;
    storage.setItem(rawKey, JSON.stringify({ kind: 'raw-legacy', raw: {} }));
    const invalidKey = `${BudgetStorage.constants.RECOVERY_PREFIX}invalid-test`;
    storage.setItem(invalidKey, JSON.stringify({ kind: 'dataset', envelope: { data: { months: [] } } }));

    expect(() => adapter.recover('absent', before)).toThrow(expect.objectContaining({ code: 'MISSING_RECOVERY' }));
    expect(() => adapter.recover(rawKey, before)).toThrow(expect.objectContaining({ code: 'INVALID_RECOVERY' }));
    expect(() => adapter.recover(invalidKey, before)).toThrow(expect.objectContaining({ code: 'INVALID_RECOVERY' }));
    expect(activeRevision(storage)).toBe(initial.envelope.revision);
  });

  test('recovery mode restore preserves corrupt active bytes before activating valid data', () => {
    const storage = new MemoryStorage();
    storage.setItem(BudgetStorage.constants.ACTIVE_KEY, 'corrupt');
    storage.setItem(`${BudgetStorage.constants.REVISION_PREFIX}corrupt`, '{unreadable');
    const adapter = new BudgetStorage.Adapter(storage);
    const boot = adapter.bootstrap();
    const candidate = adapter.inspectBackup({ months: {}, globalCats: [] });
    const restored = adapter.restoreDuringRecovery(candidate, boot.rawLegacy, boot.activePointer);

    expect(restored.validation.valid).toBe(true);
    const point = adapter.listRecoveryPoints().find(item => item.reason === 'before-recovery-restore');
    const saved = JSON.parse(storage.getItem(point.key));
    expect(saved.raw.activePointer).toBe('corrupt');
    expect(saved.raw.activeRevisionRaw).toBe('{unreadable');
  });
});

describe('Phase 0 concurrent revisions', () => {
  test('prevents a stale tab from overwriting the winning tab and reports both revisions', () => {
    const storage = new MemoryStorage();
    const tabA = new BudgetStorage.Adapter(storage, { writerId: 'A' });
    const aRead = tabA.bootstrap();
    const tabB = new BudgetStorage.Adapter(storage, { writerId: 'B' });
    const bRead = tabB.bootstrap();
    const aData = clone(aRead.envelope.data);
    aData.settings.winner = 'A';
    const winner = tabA.write(aData, aRead.envelope.revision);

    const bData = clone(bRead.envelope.data);
    bData.settings.winner = 'B';
    expect(() => tabB.write(bData, bRead.envelope.revision)).toThrow(expect.objectContaining({
      code: 'REVISION_CONFLICT',
      details: {
        expectedRevision: bRead.envelope.revision,
        currentRevision: winner.envelope.revision
      }
    }));
    expect(tabA.readActive().envelope.data.settings.winner).toBe('A');
  });

  test('rejects a stale recovery restore before replacing corrupt state', () => {
    const storage = new MemoryStorage();
    const adapter = new BudgetStorage.Adapter(storage);
    const initial = adapter.bootstrap();
    const candidate = adapter.inspectBackup({ months: {}, globalCats: [] });

    expect(() => adapter.restoreDuringRecovery(candidate, null, 'not-current'))
      .toThrow(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(activeRevision(storage)).toBe(initial.envelope.revision);
  });
});

describe('Phase 0 known release blockers', () => {
  test('serializes simultaneous commits so only one tab reports success', async () => {
    const storage = new MemoryStorage();
    const lockManager = new QueueLockManager();
    const tabA = new BudgetStorage.Adapter(storage, { writerId: 'A', lockManager });
    const initial = await tabA.bootstrapExclusive();
    const tabB = new BudgetStorage.Adapter(storage, { writerId: 'B', lockManager });
    const bRead = tabB.readActive();

    const aData = clone(initial.envelope.data);
    aData.settings.winner = 'A';
    const bData = clone(bRead.envelope.data);
    bData.settings.winner = 'B';
    const results = await Promise.allSettled([
      tabA.writeExclusive(aData, initial.envelope.revision),
      tabB.writeExclusive(bData, bRead.envelope.revision)
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected.reason).toEqual(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(() => tabA.readActive()).not.toThrow();
    expect(['A', 'B']).toContain(tabA.readActive().envelope.data.settings.winner);
  });

  test('fails closed when exclusive locking is unavailable', async () => {
    const storage = new MemoryStorage();
    const unlocked = new BudgetStorage.Adapter(storage);
    const initial = unlocked.bootstrap();
    const locked = new BudgetStorage.Adapter(storage, { lockManager: null });

    await expect(locked.writeExclusive(initial.envelope.data, initial.envelope.revision))
      .rejects.toEqual(expect.objectContaining({ code: 'LOCK_UNAVAILABLE' }));
    expect(activeRevision(storage)).toBe(initial.envelope.revision);
  });

  test('rejects direct writes that bypass an available lock manager', async () => {
    const storage = new MemoryStorage();
    const lockManager = new QueueLockManager();
    const adapter = new BudgetStorage.Adapter(storage, { lockManager });
    const initial = await adapter.bootstrapExclusive();

    expect(() => adapter.write(initial.envelope.data, initial.envelope.revision))
      .toThrow(expect.objectContaining({ code: 'LOCK_REQUIRED' }));
  });

  test('serializes rapid writes from the same tab without a false stale-tab conflict', async () => {
    const storage = new MemoryStorage();
    const lockManager = new QueueLockManager();
    const adapter = new BudgetStorage.Adapter(storage, { writerId: 'same-tab', lockManager });
    const initial = await adapter.bootstrapExclusive();
    const first = clone(initial.envelope.data);
    first.settings.sequence = 1;
    const second = clone(initial.envelope.data);
    second.settings.sequence = 2;

    const results = await Promise.all([
      adapter.writeExclusive(first, initial.envelope.revision),
      adapter.writeExclusive(second, initial.envelope.revision)
    ]);
    expect(results).toHaveLength(2);
    expect(adapter.readActive().envelope.data.settings.sequence).toBe(2);
  });

  test('rejects an unknown backup format even when it resembles a legacy backup', () => {
    const adapter = new BudgetStorage.Adapter(new MemoryStorage());
    expect(() => adapter.inspectBackup({ format: 'another-product', months: {}, globalCats: [] }))
      .toThrow(expect.objectContaining({ code: 'INVALID_BACKUP' }));
  });

  test('rejects mismatched nested and top-level backup schema versions', () => {
    const adapter = new BudgetStorage.Adapter(new MemoryStorage());
    expect(() => adapter.inspectBackup({
      format: BudgetStorage.constants.BACKUP_FORMAT,
      schemaVersion: 1,
      dataset: { schemaVersion: 999, data: BudgetStorage.emptyData() }
    })).toThrow(expect.objectContaining({ code: 'FUTURE_SCHEMA' }));
  });

  test('preserves an invalid legacy active-month value for review instead of rewriting it', () => {
    const storage = new MemoryStorage(legacySeed({ bt_active_month: '1999-01' }));
    const boot = new BudgetStorage.Adapter(storage).bootstrap();
    expect(boot.data.activeMonth).toBe('1999-01');
    expect(boot.validation.warnings).toContain('Active month 1999-01 does not exist; the first available month will be selected');
  });

  test('compares a raw migration snapshot byte-for-byte before activation', () => {
    const storage = new MemoryStorage(legacySeed());
    const adapter = new BudgetStorage.Adapter(storage);
    const boot = adapter.bootstrap();
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key.startsWith(BudgetStorage.constants.RECOVERY_PREFIX)) {
        originalSetItem(key, JSON.stringify({ truncated: true }));
        return;
      }
      originalSetItem(key, value);
    };
    expect(() => adapter.migrateLegacy(boot.rawLegacy))
      .toThrow(expect.objectContaining({ code: 'SNAPSHOT_FAILED' }));
    expect(activeRevision(storage)).toBeNull();
  });

  test('validates raw recovery restore input before creating a snapshot', () => {
    const storage = new MemoryStorage();
    const adapter = new BudgetStorage.Adapter(storage);
    const initial = adapter.bootstrap();
    const beforeRecoveryCount = recoveryKeys(storage).length;
    expect(() => adapter.restoreDuringRecovery({ invalid: true }, null, initial.envelope.revision))
      .toThrow(expect.objectContaining({ code: 'INVALID_BACKUP' }));
    expect(recoveryKeys(storage)).toHaveLength(beforeRecoveryCount);
  });
});
