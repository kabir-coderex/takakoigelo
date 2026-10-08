(function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const BACKUP_FORMAT = 'taka-koi-gelo-backup';
  const ACTIVE_KEY = 'tkg_store_active';
  const REVISION_PREFIX = 'tkg_store_revision_';
  const RECOVERY_PREFIX = 'tkg_recovery_';
  const WRITE_LOCK_NAME = 'taka-koi-gelo-storage-write-v1';
  const LEGACY_KEYS = Object.freeze({
    months: 'bt_months',
    globalCats: 'bt_global_cats',
    activeMonth: 'bt_active_month'
  });

  class StorageAdapterError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'StorageAdapterError';
      this.code = code;
      this.details = details || null;
    }
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyData() {
    return {
      months: {},
      globalCats: [],
      activeMonth: null,
      settings: {
        lastBackupAt: null
      }
    };
  }

  function validateCategory(category, path, errors) {
    if (!isObject(category)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (!['string', 'number'].includes(typeof category.id) || String(category.id).length === 0) {
      errors.push(`${path}.id must be a non-empty string or number`);
    }
    if (typeof category.name !== 'string' || !category.name.trim()) {
      errors.push(`${path}.name must be a non-empty string`);
    }
    if (typeof category.budget !== 'number' || !Number.isFinite(category.budget) || category.budget < 0) {
      errors.push(`${path}.budget must be a finite non-negative number`);
    }
  }

  function validateExpense(expense, path, errors) {
    if (!isObject(expense)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (!['string', 'number'].includes(typeof expense.id) || String(expense.id).length === 0) {
      errors.push(`${path}.id must be a non-empty string or number`);
    }
    if (!['string', 'number'].includes(typeof expense.catId) || String(expense.catId).length === 0) {
      errors.push(`${path}.catId must be a non-empty string or number`);
    }
    if (typeof expense.cat !== 'string' || !expense.cat.trim()) {
      errors.push(`${path}.cat must be a non-empty string`);
    }
    if (typeof expense.desc !== 'string') {
      errors.push(`${path}.desc must be a string`);
    }
    if (typeof expense.amt !== 'number' || !Number.isFinite(expense.amt) || expense.amt <= 0) {
      errors.push(`${path}.amt must be a finite positive number`);
    }
    if (typeof expense.date !== 'string' || !expense.date.trim()) {
      errors.push(`${path}.date must be a non-empty string`);
    }
  }

  function validateData(data) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      return { valid: false, errors: ['dataset must be an object'], warnings };
    }
    if (!isObject(data.months)) errors.push('months must be an object');
    if (!Array.isArray(data.globalCats)) errors.push('globalCats must be an array');
    if (data.activeMonth !== null && typeof data.activeMonth !== 'string') {
      errors.push('activeMonth must be a string or null');
    }
    if (!isObject(data.settings)) errors.push('settings must be an object');
    if (errors.length) return { valid: false, errors, warnings };

    const globalIds = new Set();
    data.globalCats.forEach((category, index) => {
      validateCategory(category, `globalCats[${index}]`, errors);
      if (isObject(category)) {
        const id = String(category.id);
        if (globalIds.has(id)) warnings.push(`Duplicate global category ID: ${id}`);
        globalIds.add(id);
      }
    });

    Object.entries(data.months).forEach(([monthKey, month]) => {
      const path = `months.${monthKey}`;
      if (!/^\d{4}-\d{2}$/.test(monthKey)) warnings.push(`Unusual month key: ${monthKey}`);
      if (!isObject(month)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (typeof month.name !== 'string' || !month.name.trim()) errors.push(`${path}.name must be a non-empty string`);
      if (!Array.isArray(month.categories)) errors.push(`${path}.categories must be an array`);
      if (!Array.isArray(month.expenses)) errors.push(`${path}.expenses must be an array`);
      if (!Array.isArray(month.categories) || !Array.isArray(month.expenses)) return;

      const categoryIds = new Set();
      month.categories.forEach((category, index) => {
        validateCategory(category, `${path}.categories[${index}]`, errors);
        if (isObject(category)) {
          const id = String(category.id);
          if (categoryIds.has(id)) warnings.push(`Duplicate category ID ${id} in ${monthKey}`);
          categoryIds.add(id);
        }
      });

      const expenseIds = new Set();
      month.expenses.forEach((expense, index) => {
        validateExpense(expense, `${path}.expenses[${index}]`, errors);
        if (!isObject(expense)) return;
        const id = String(expense.id);
        if (expenseIds.has(id)) warnings.push(`Duplicate expense ID ${id} in ${monthKey}`);
        expenseIds.add(id);
        const hasCategory = month.categories.some(category =>
          isObject(category) &&
          (String(category.id) === String(expense.catId) || category.name === expense.cat)
        );
        if (!hasCategory) warnings.push(`Orphaned expense ${id} in ${monthKey} is preserved`);
      });
    });

    if (data.activeMonth && !Object.prototype.hasOwnProperty.call(data.months, data.activeMonth)) {
      warnings.push(`Active month ${data.activeMonth} does not exist; the first available month will be selected`);
    }
    if (data.settings.lastBackupAt !== null &&
        (typeof data.settings.lastBackupAt !== 'string' || Number.isNaN(Date.parse(data.settings.lastBackupAt)))) {
      errors.push('settings.lastBackupAt must be an ISO date string or null');
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  function summarize(data) {
    const summary = {
      months: 0,
      globalCategories: Array.isArray(data.globalCats) ? data.globalCats.length : 0,
      monthlyCategories: 0,
      transactions: 0,
      totalAmount: 0,
      byMonth: {}
    };
    if (!isObject(data.months)) return summary;
    Object.entries(data.months).forEach(([key, month]) => {
      const categories = Array.isArray(month.categories) ? month.categories.length : 0;
      const expenses = Array.isArray(month.expenses) ? month.expenses : [];
      const total = expenses.reduce((sum, expense) => sum + (Number.isFinite(expense.amt) ? expense.amt : 0), 0);
      summary.months += 1;
      summary.monthlyCategories += categories;
      summary.transactions += expenses.length;
      summary.totalAmount += total;
      summary.byMonth[key] = { categories, transactions: expenses.length, totalAmount: total };
    });
    return summary;
  }

  function parseJson(raw, label) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new StorageAdapterError('INVALID_JSON', `${label} contains invalid JSON`, { cause: error.message });
    }
  }

  function readLegacyRaw(storage) {
    return {
      months: storage.getItem(LEGACY_KEYS.months),
      globalCats: storage.getItem(LEGACY_KEYS.globalCats),
      activeMonth: storage.getItem(LEGACY_KEYS.activeMonth)
    };
  }

  function parseLegacy(raw) {
    let months = {};
    let globalCats = [];
    if (raw.months !== null) months = parseJson(raw.months, LEGACY_KEYS.months);
    if (raw.globalCats !== null) globalCats = parseJson(raw.globalCats, LEGACY_KEYS.globalCats);
    const data = {
      months,
      globalCats,
      activeMonth: raw.activeMonth === null ? null : raw.activeMonth,
      settings: { lastBackupAt: null }
    };
    const validation = validateData(data);
    if (!validation.valid) {
      throw new StorageAdapterError('INVALID_LEGACY_DATA', 'Legacy data failed validation', validation);
    }
    return { data, validation };
  }

  function normalizeBackup(input) {
    if (!isObject(input)) throw new StorageAdapterError('INVALID_BACKUP', 'Backup must contain a JSON object');
    let data;
    let sourceVersion;
    let metadata = {};

    if (Object.prototype.hasOwnProperty.call(input, 'format') && input.format !== BACKUP_FORMAT) {
      throw new StorageAdapterError('INVALID_BACKUP', `Unknown backup format: ${String(input.format)}`);
    }
    if (input.format === BACKUP_FORMAT) {
      if (!Number.isInteger(input.schemaVersion)) {
        throw new StorageAdapterError('INVALID_BACKUP', 'Backup schemaVersion is missing or invalid');
      }
      if (input.schemaVersion > SCHEMA_VERSION) {
        throw new StorageAdapterError('FUTURE_SCHEMA', `Backup schema version ${input.schemaVersion} is newer than this app supports`);
      }
      if (input.schemaVersion < 1 || !isObject(input.dataset)) {
        throw new StorageAdapterError('INVALID_BACKUP', 'Unsupported or incomplete versioned backup');
      }
      if (!Number.isInteger(input.dataset.schemaVersion)) {
        throw new StorageAdapterError('INVALID_BACKUP', 'Backup dataset schemaVersion is missing or invalid');
      }
      if (input.dataset.schemaVersion > SCHEMA_VERSION) {
        throw new StorageAdapterError('FUTURE_SCHEMA', `Backup dataset schema version ${input.dataset.schemaVersion} is newer than this app supports`);
      }
      if (input.dataset.schemaVersion !== input.schemaVersion) {
        throw new StorageAdapterError('INVALID_BACKUP', 'Backup schema versions do not match');
      }
      if (!isObject(input.dataset.data)) {
        throw new StorageAdapterError('INVALID_BACKUP', 'Versioned backup dataset is missing its data object');
      }
      sourceVersion = input.schemaVersion;
      data = input.dataset.data;
      metadata = input.metadata || {};
    } else if (!Object.prototype.hasOwnProperty.call(input, 'schemaVersion') &&
               isObject(input.months) && Array.isArray(input.globalCats || [])) {
      sourceVersion = 0;
      data = {
        months: input.months,
        globalCats: input.globalCats || [],
        activeMonth: Object.prototype.hasOwnProperty.call(input, 'activeMonth')
          ? input.activeMonth
          : Object.keys(input.months).sort()[0] || null,
        settings: { lastBackupAt: null }
      };
    } else {
      throw new StorageAdapterError('INVALID_BACKUP', 'This is not a recognized Budget Tracker backup');
    }

    data = clone(data);
    if (!isObject(data.settings)) data.settings = { lastBackupAt: null };
    if (!Object.prototype.hasOwnProperty.call(data.settings, 'lastBackupAt')) data.settings.lastBackupAt = null;
    const validation = validateData(data);
    if (!validation.valid) {
      throw new StorageAdapterError('INVALID_BACKUP', 'Backup data failed validation', validation);
    }
    return { data, sourceVersion, metadata, validation, summary: summarize(data) };
  }

  class Adapter {
    constructor(storage, options) {
      if (!storage) throw new Error('A localStorage-compatible object is required');
      const opts = options || {};
      this.storage = storage;
      this.writerId = opts.writerId || makeId('tab');
      this.lockManager = Object.prototype.hasOwnProperty.call(opts, 'lockManager')
        ? opts.lockManager
        : (root.navigator && root.navigator.locks ? root.navigator.locks : null);
      this.lockDepth = 0;
    }

    get activeKey() { return ACTIVE_KEY; }

    async withWriteLock(operation) {
      if (!this.lockManager || typeof this.lockManager.request !== 'function') {
        throw new StorageAdapterError(
          'LOCK_UNAVAILABLE',
          'This browser cannot safely serialize budget writes. Export your data and use a browser with Web Locks support.'
        );
      }
      return this.lockManager.request(WRITE_LOCK_NAME, { mode: 'exclusive' }, async () => {
        this.lockDepth += 1;
        try {
          return await operation();
        } finally {
          this.lockDepth -= 1;
        }
      });
    }

    bootstrapExclusive() {
      return this.withWriteLock(() => this.bootstrap());
    }

    readEnvelope(revision) {
      const raw = this.storage.getItem(REVISION_PREFIX + revision);
      if (raw === null) throw new StorageAdapterError('MISSING_REVISION', `Active revision ${revision} is missing`);
      const envelope = parseJson(raw, `revision ${revision}`);
      if (!isObject(envelope) || envelope.schemaVersion !== SCHEMA_VERSION || envelope.revision !== revision) {
        throw new StorageAdapterError('INVALID_REVISION', `Revision ${revision} has invalid metadata`);
      }
      const validation = validateData(envelope.data);
      if (!validation.valid) throw new StorageAdapterError('INVALID_REVISION', `Revision ${revision} failed validation`, validation);
      return { envelope, validation };
    }

    readActive() {
      const revision = this.storage.getItem(ACTIVE_KEY);
      if (!revision) return null;
      return this.readEnvelope(revision);
    }

    bootstrap() {
      try {
        const active = this.readActive();
        if (active) return { status: 'ready', ...active };
      } catch (error) {
        return {
          status: 'recovery_required',
          error,
          rawLegacy: readLegacyRaw(this.storage),
          activePointer: this.storage.getItem(ACTIVE_KEY)
        };
      }

      const rawLegacy = readLegacyRaw(this.storage);
      const hasLegacy = Object.values(rawLegacy).some(value => value !== null);
      if (hasLegacy) {
        try {
          const parsed = parseLegacy(rawLegacy);
          return {
            status: 'migration_required',
            rawLegacy,
            data: parsed.data,
            validation: parsed.validation,
            summary: summarize(parsed.data)
          };
        } catch (error) {
          return { status: 'recovery_required', error, rawLegacy };
        }
      }

      const result = this.commit(emptyData(), null, { kind: 'initial' });
      return { status: 'ready', envelope: result.envelope, validation: result.validation };
    }

    commit(data, expectedRevision, metadata) {
      if (this.lockManager && this.lockDepth === 0) {
        throw new StorageAdapterError('LOCK_REQUIRED', 'Budget writes must run inside the exclusive storage lock.');
      }
      const validation = validateData(data);
      if (!validation.valid) throw new StorageAdapterError('INVALID_DATA', 'Candidate dataset failed validation', validation);
      const currentRevision = this.storage.getItem(ACTIVE_KEY);
      if ((currentRevision || null) !== (expectedRevision || null)) {
        throw new StorageAdapterError('REVISION_CONFLICT', 'Another tab saved newer data. This tab was prevented from overwriting it.', {
          expectedRevision: expectedRevision || null,
          currentRevision: currentRevision || null
        });
      }

      const revision = makeId('rev');
      const envelope = {
        schemaVersion: SCHEMA_VERSION,
        revision,
        parentRevision: currentRevision || null,
        updatedAt: nowIso(),
        writerId: this.writerId,
        metadata: metadata || { kind: 'save' },
        data: clone(data)
      };
      const key = REVISION_PREFIX + revision;
      try {
        this.storage.setItem(key, JSON.stringify(envelope));
        const verified = this.readEnvelope(revision);
        if (JSON.stringify(verified.envelope.data) !== JSON.stringify(envelope.data)) {
          throw new StorageAdapterError('VERIFY_FAILED', 'Candidate dataset changed during storage verification');
        }
        this.storage.setItem(ACTIVE_KEY, revision);
        if (this.storage.getItem(ACTIVE_KEY) !== revision) {
          throw new StorageAdapterError('VERIFY_FAILED', 'The active revision pointer could not be verified');
        }
        this.pruneRevisions(revision, envelope.parentRevision);
        return verified;
      } catch (error) {
        if (error instanceof StorageAdapterError) throw error;
        throw new StorageAdapterError('WRITE_FAILED', 'Browser storage could not save the data', { cause: error.message });
      }
    }

    write(data, expectedRevision) {
      return this.commit(data, expectedRevision, { kind: 'save' });
    }

    writeExclusive(data, expectedRevision) {
      return this.withWriteLock(() => {
        let effectiveRevision = expectedRevision;
        const currentRevision = this.storage.getItem(ACTIVE_KEY);
        if (currentRevision && currentRevision !== expectedRevision) {
          const current = this.readEnvelope(currentRevision).envelope;
          if (current.writerId === this.writerId) effectiveRevision = currentRevision;
        }
        return this.write(data, effectiveRevision);
      });
    }

    pruneRevisions(activeRevision, parentRevision) {
      try {
        const pointedRevision = this.storage.getItem(ACTIVE_KEY);
        const keep = new Set([activeRevision, parentRevision, pointedRevision].filter(Boolean));
        const removals = [];
        for (let index = 0; index < this.storage.length; index += 1) {
          const key = this.storage.key(index);
          if (key && key.startsWith(REVISION_PREFIX) && !keep.has(key.slice(REVISION_PREFIX.length))) removals.push(key);
        }
        removals.forEach(key => this.storage.removeItem(key));
      } catch (_) {
        // Cleanup is best-effort and never affects the active pointer.
      }
    }

    snapshotRaw(reason, rawLegacy) {
      const key = RECOVERY_PREFIX + makeId('raw');
      const snapshot = {
        kind: 'raw-legacy',
        createdAt: nowIso(),
        reason,
        raw: clone(rawLegacy)
      };
      const serialized = JSON.stringify(snapshot);
      try {
        this.storage.setItem(key, serialized);
        if (this.storage.getItem(key) !== serialized) throw new Error('Snapshot verification failed');
      } catch (error) {
        throw new StorageAdapterError('SNAPSHOT_FAILED', 'Could not preserve the raw legacy snapshot; no migration was performed', { cause: error.message });
      }
      return key;
    }

    snapshotCurrent(reason) {
      const active = this.readActive();
      if (!active) return null;
      const key = RECOVERY_PREFIX + makeId('dataset');
      const snapshot = {
        kind: 'dataset',
        createdAt: nowIso(),
        reason,
        envelope: active.envelope
      };
      const serialized = JSON.stringify(snapshot);
      try {
        this.storage.setItem(key, serialized);
        if (this.storage.getItem(key) !== serialized) throw new Error('Snapshot verification failed');
      } catch (error) {
        throw new StorageAdapterError('SNAPSHOT_FAILED', 'Could not create a recovery snapshot; current data was not replaced', { cause: error.message });
      }
      return key;
    }

    migrateLegacy(expectedRaw) {
      if (this.storage.getItem(ACTIVE_KEY)) return this.readActive();
      const currentRaw = readLegacyRaw(this.storage);
      if (JSON.stringify(currentRaw) !== JSON.stringify(expectedRaw)) {
        throw new StorageAdapterError('LEGACY_CHANGED', 'Legacy data changed in another tab. Reload before migrating.');
      }
      const parsed = parseLegacy(currentRaw);
      const snapshotKey = this.snapshotRaw('before-schema-1-migration', currentRaw);
      const sourceSummary = summarize(parsed.data);
      const candidate = clone(parsed.data);
      const destinationSummary = summarize(candidate);
      const exactLegacyFieldsPreserved =
        JSON.stringify(candidate.months) === JSON.stringify(parsed.data.months) &&
        JSON.stringify(candidate.globalCats) === JSON.stringify(parsed.data.globalCats) &&
        candidate.activeMonth === parsed.data.activeMonth;
      if (JSON.stringify(sourceSummary) !== JSON.stringify(destinationSummary) || !exactLegacyFieldsPreserved) {
        throw new StorageAdapterError('MIGRATION_MISMATCH', 'Candidate counts, totals, or legacy fields do not match the source dataset');
      }
      const result = this.commit(candidate, null, {
        kind: 'migration',
        sourceVersion: 0,
        destinationVersion: SCHEMA_VERSION,
        snapshotKey,
        validation: {
          valid: true,
          warnings: parsed.validation.warnings,
          sourceSummary,
          destinationSummary,
          exactLegacyFieldsPreserved
        }
      });
      return result;
    }

    migrateLegacyExclusive(expectedRaw) {
      return this.withWriteLock(() => this.migrateLegacy(expectedRaw));
    }

    inspectBackup(value) {
      const parsed = typeof value === 'string' ? parseJson(value, 'backup file') : value;
      return normalizeBackup(parsed);
    }

    createBackup(data, metadata) {
      const validation = validateData(data);
      if (!validation.valid) throw new StorageAdapterError('INVALID_DATA', 'Cannot export an invalid dataset', validation);
      return {
        format: BACKUP_FORMAT,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: nowIso(),
        metadata: Object.assign({ application: 'Taka Koi Gelo' }, metadata || {}),
        summary: summarize(data),
        dataset: {
          schemaVersion: SCHEMA_VERSION,
          data: clone(data)
        }
      };
    }

    createPreMigrationBackup(data, rawLegacy) {
      return this.createBackup(data, {
        kind: 'pre-migration',
        sourceSchemaVersion: 0,
        rawLegacy: clone(rawLegacy)
      });
    }

    restore(candidate, expectedRevision) {
      const normalized = candidate && candidate.data ? candidate : normalizeBackup(candidate);
      this.snapshotCurrent('before-backup-restore');
      return this.commit(normalized.data, expectedRevision, {
        kind: 'restore',
        sourceVersion: normalized.sourceVersion
      });
    }

    restoreExclusive(candidate, expectedRevision) {
      return this.withWriteLock(() => this.restore(candidate, expectedRevision));
    }

    restoreDuringRecovery(candidate, rawLegacy, expectedPointer) {
      const normalized = candidate && candidate.data ? candidate : normalizeBackup(candidate);
      const currentPointer = this.storage.getItem(ACTIVE_KEY);
      if ((currentPointer || null) !== (expectedPointer || null)) {
        throw new StorageAdapterError('REVISION_CONFLICT', 'Stored data changed in another tab. Reload before restoring.');
      }
      this.snapshotRaw('before-recovery-restore', {
        legacy: rawLegacy || readLegacyRaw(this.storage),
        activePointer: currentPointer,
        activeRevisionRaw: currentPointer ? this.storage.getItem(REVISION_PREFIX + currentPointer) : null
      });
      return this.commit(normalized.data, currentPointer, {
        kind: 'recovery-restore',
        sourceVersion: normalized.sourceVersion
      });
    }

    restoreDuringRecoveryExclusive(candidate, rawLegacy, expectedPointer) {
      return this.withWriteLock(() => this.restoreDuringRecovery(candidate, rawLegacy, expectedPointer));
    }

    listRecoveryPoints() {
      const points = [];
      const active = this.storage.getItem(ACTIVE_KEY);
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);
        if (!key) continue;
        try {
          if (key.startsWith(RECOVERY_PREFIX)) {
            const value = parseJson(this.storage.getItem(key), key);
            points.push({ key, kind: value.kind, createdAt: value.createdAt, reason: value.reason, recoverable: value.kind === 'dataset' });
          } else if (key.startsWith(REVISION_PREFIX)) {
            const revision = key.slice(REVISION_PREFIX.length);
            if (revision === active) continue;
            const value = parseJson(this.storage.getItem(key), key);
            points.push({ key, kind: 'revision', createdAt: value.updatedAt, reason: 'Previous saved revision', recoverable: true });
          }
        } catch (_) {
          points.push({ key, kind: 'unreadable', createdAt: null, reason: 'Unreadable recovery artifact', recoverable: false });
        }
      }
      return points.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }

    recover(key, expectedRevision) {
      const raw = this.storage.getItem(key);
      if (raw === null) throw new StorageAdapterError('MISSING_RECOVERY', 'Recovery point no longer exists');
      const value = parseJson(raw, 'recovery point');
      const data = value.kind === 'dataset' ? value.envelope && value.envelope.data : value.data;
      if (!data) throw new StorageAdapterError('INVALID_RECOVERY', 'This recovery artifact cannot be activated directly');
      const validation = validateData(data);
      if (!validation.valid) throw new StorageAdapterError('INVALID_RECOVERY', 'Recovery data failed validation', validation);
      this.snapshotCurrent('before-recovery-switch');
      return this.commit(data, expectedRevision, { kind: 'recovery', sourceKey: key });
    }

    recoverExclusive(key, expectedRevision) {
      return this.withWriteLock(() => this.recover(key, expectedRevision));
    }

    exportRawRecovery(rawLegacy, error) {
      return {
        format: 'taka-koi-gelo-raw-recovery',
        createdAt: nowIso(),
        error: error ? { code: error.code || 'UNKNOWN', message: error.message, details: error.details || null } : null,
        rawLegacy: clone(rawLegacy || readLegacyRaw(this.storage)),
        activePointer: this.storage.getItem(ACTIVE_KEY),
        activeRevisionRaw: this.storage.getItem(ACTIVE_KEY)
          ? this.storage.getItem(REVISION_PREFIX + this.storage.getItem(ACTIVE_KEY))
          : null
      };
    }
  }

  const api = {
    Adapter,
    StorageAdapterError,
    validateData,
    normalizeBackup,
    summarize,
    emptyData,
    constants: { SCHEMA_VERSION, BACKUP_FORMAT, ACTIVE_KEY, REVISION_PREFIX, RECOVERY_PREFIX, WRITE_LOCK_NAME, LEGACY_KEYS }
  };

  root.BudgetStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
