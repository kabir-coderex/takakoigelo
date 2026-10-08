const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

const ACTIVE_KEY = 'tkg_store_active';
const REVISION_PREFIX = 'tkg_store_revision_';
const RECOVERY_PREFIX = 'tkg_recovery_';

function legacyData() {
  return {
    months: {
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
    },
    globalCats: [{ id: 'food', name: 'Food', budget: 5000 }],
    activeMonth: '2026-10'
  };
}

async function seedLocalStorage(page, values) {
  await page.addInitScript(seed => {
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
  }, values);
}

function legacyStorage(overrides = {}) {
  const data = legacyData();
  return {
    bt_months: JSON.stringify(data.months),
    bt_global_cats: JSON.stringify(data.globalCats),
    bt_active_month: data.activeMonth,
    ...overrides
  };
}

function validLegacyBackup() {
  const data = legacyData();
  return JSON.stringify({
    months: { '2026-10': data.months['2026-10'] },
    globalCats: data.globalCats,
    activeMonth: '2026-10'
  });
}

async function chooseRestoreFile(page, body, name = 'backup.json') {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Restore/ }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(body) });
}

test.describe('Phase 0 recovery and migration browser workflows', () => {
  test('fresh install creates and renders a validated versioned dataset', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.getByText('No months yet')).toBeVisible();
    await expect(page.getByText('No full backup has been exported yet.')).toBeVisible();

    const stored = await page.evaluate(({ activeKey, revisionPrefix }) => {
      const revision = localStorage.getItem(activeKey);
      return {
        revision,
        envelope: JSON.parse(localStorage.getItem(revisionPrefix + revision))
      };
    }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX });

    expect(stored.revision).toBeTruthy();
    expect(stored.envelope.schemaVersion).toBe(1);
    expect(stored.envelope.metadata.kind).toBe('initial');
    expect(stored.envelope.data).toEqual({
      months: {}, globalCats: [], wallets: [], walletEntries: [], activeMonth: null,
      workspaces: [{ id: 'workspace-existing', name: 'Existing Budget', archived: false, template: [] }],
      settings: {
        lastBackupAt: null, phase1Version: 1, transactionTrash: [],
        phase2Version: 1, activeWorkspaceId: 'workspace-existing',
        phase3Version: 1, walletEntryTrash: []
      }
    });
  });

  test('legacy migration stays gated until a backup is downloaded and verified', async ({ page }) => {
    const legacy = legacyStorage();
    await seedLocalStorage(page, legacy);
    await page.goto('/index.html');

    await expect(page.getByRole('heading', { name: 'Protect your existing records' })).toBeVisible();
    await expect(page.getByText('2', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('৳15,250')).toBeVisible();
    await expect(page.locator('#migrationVerified')).toBeDisabled();
    await expect(page.locator('#runMigrationBtn')).toBeDisabled();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#preMigrationDownload').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^taka-koi-gelo-pre-upgrade-\d{4}-\d{2}-\d{2}\.json$/);
    const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    expect(backup.metadata.kind).toBe('pre-migration');
    expect(backup.summary.transactions).toBe(2);

    await page.locator('#migrationVerified').check();
    await expect(page.locator('#runMigrationBtn')).toBeEnabled();
    await page.locator('#runMigrationBtn').click();

    await expect(page.getByRole('button', { name: 'October 2026' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'October 2026' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Protect your existing records' })).toHaveCount(0);
    const storageState = await page.evaluate(({ recoveryPrefix, original }) => ({
      legacy: {
        months: localStorage.getItem('bt_months'),
        globalCats: localStorage.getItem('bt_global_cats'),
        activeMonth: localStorage.getItem('bt_active_month')
      },
      active: localStorage.getItem('tkg_store_active'),
      rawSnapshots: Object.keys(localStorage).filter(key => key.startsWith(recoveryPrefix))
        .map(key => JSON.parse(localStorage.getItem(key)))
        .filter(value => value.kind === 'raw-legacy'),
      original
    }), { recoveryPrefix: RECOVERY_PREFIX, original: legacy });
    const rawLegacy = {
      months: legacy.bt_months,
      globalCats: legacy.bt_global_cats,
      activeMonth: legacy.bt_active_month
    };
    expect(storageState.legacy).toEqual(rawLegacy);
    expect(storageState.active).toBeTruthy();
    expect(storageState.rawSnapshots).toHaveLength(1);
    expect(storageState.rawSnapshots[0].raw).toEqual(rawLegacy);
  });

  test('malformed legacy data opens recovery without replacing source bytes', async ({ page }) => {
    const legacy = legacyStorage({ bt_months: '{broken-json' });
    await seedLocalStorage(page, legacy);
    await page.goto('/index.html');

    await expect(page.getByRole('heading', { name: 'Your current data needs attention' })).toBeVisible();
    await expect(page.locator('#recoveryError')).toContainText('INVALID_JSON');
    await expect(page.getByText('Existing data was not modified')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export raw recovery data' }).click();
    const download = await downloadPromise;
    const recovery = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    expect(recovery.format).toBe('taka-koi-gelo-raw-recovery');
    expect(recovery.rawLegacy.months).toBe('{broken-json');

    const state = await page.evaluate(activeKey => ({
      active: localStorage.getItem(activeKey),
      malformed: localStorage.getItem('bt_months')
    }), ACTIVE_KEY);
    expect(state).toEqual({ active: null, malformed: '{broken-json' });
  });

  test('a pre-migration backup restores in a separate browser profile with matching totals', async ({ browser }) => {
    const sourceContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:4173', acceptDownloads: true, serviceWorkers: 'block'
    });
    const source = await sourceContext.newPage();
    await seedLocalStorage(source, legacyStorage());
    await source.goto('/index.html');
    const downloadPromise = source.waitForEvent('download');
    await source.locator('#preMigrationDownload').click();
    const download = await downloadPromise;
    const backupBuffer = await fs.readFile(await download.path());
    await sourceContext.close();

    const restoreContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:4173', acceptDownloads: true, serviceWorkers: 'block'
    });
    const restoredPage = await restoreContext.newPage();
    await restoredPage.goto('/index.html');
    await restoredPage.locator('#settingsBtn').click();
    await chooseRestoreFile(restoredPage, backupBuffer, 'pre-migration-backup.json');
    await expect(restoredPage.locator('#restorePreviewContent')).toContainText('৳15,250');
    await restoredPage.getByRole('button', { name: 'Replace Current Data' }).click();
    await expect(restoredPage.getByRole('button', { name: 'October 2026' })).toBeVisible();

    const summary = await restoredPage.evaluate(({ activeKey, revisionPrefix }) => {
      const revision = localStorage.getItem(activeKey);
      const data = JSON.parse(localStorage.getItem(revisionPrefix + revision)).data;
      return BudgetStorage.summarize(data);
    }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX });
    expect(summary).toEqual(expect.objectContaining({
      months: 2,
      globalCategories: 1,
      monthlyCategories: 2,
      transactions: 2,
      totalAmount: 15250
    }));
    await restoreContext.close();
  });

  test('legacy numeric and duplicate string IDs remain usable without multi-delete', async ({ page }) => {
    const month = {
      name: 'October 2026',
      categories: [{ id: 20, name: 'Transport', budget: 1800 }],
      expenses: [
        { id: 'duplicate', catId: 20, cat: 'Transport', desc: 'Bus one', amt: 40, date: '01 Oct' },
        { id: 'duplicate', catId: 20, cat: 'Transport', desc: 'Bus two', amt: 50, date: '02 Oct' }
      ]
    };
    await seedLocalStorage(page, {
      bt_months: JSON.stringify({ '2026-10': month }),
      bt_global_cats: JSON.stringify(month.categories),
      bt_active_month: '2026-10'
    });
    await page.goto('/index.html');

    const backupDownload = page.waitForEvent('download');
    await page.locator('#preMigrationDownload').click();
    await backupDownload;
    await page.locator('#migrationVerified').check();
    await page.locator('#runMigrationBtn').click();

    await page.getByRole('button', { name: 'Wallets', exact: true }).click();
    await page.getByRole('button', { name: '+ Wallet' }).click();
    await page.locator('#walletName').fill('Cash');
    await page.locator('#walletOpeningAmount').fill('100');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.locator('#catSel').selectOption({ label: 'Transport' });
    await page.locator('#walletSel').selectOption({ label: 'Cash' });
    await page.locator('#descIn').fill('New fare');
    await page.locator('#amtIn').fill('10');
    await page.locator('#tab-add').getByRole('button', { name: 'Add', exact: true }).click();

    const addedCatId = await page.evaluate(({ activeKey, revisionPrefix }) => {
      const revision = localStorage.getItem(activeKey);
      return JSON.parse(localStorage.getItem(revisionPrefix + revision))
        .data.months['2026-10'].budgets['workspace-existing'].expenses[0].catId;
    }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX });
    expect(addedCatId).toBe(20);

    await page.getByRole('button', { name: 'Log', exact: true }).click();
    const expenseRows = page.locator('#logList .log-item');
    const busOne = expenseRows.filter({ hasText: 'Bus one' });
    page.once('dialog', dialog => dialog.accept());
    await busOne.locator('.del-btn').click();
    await expect(expenseRows).toHaveCount(2);
    await expect(page.getByText('Bus one', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Bus two', { exact: true })).toBeVisible();
  });

  test('migration preserves an invalid legacy active month until the user selects one', async ({ page }) => {
    const legacy = legacyStorage({ bt_active_month: '1999-01' });
    await seedLocalStorage(page, legacy);
    await page.goto('/index.html');
    const backupDownload = page.waitForEvent('download');
    await page.locator('#preMigrationDownload').click();
    await backupDownload;
    await page.locator('#migrationVerified').check();
    await page.locator('#runMigrationBtn').click();
    await expect(page.locator('#toast')).toContainText('Data upgraded and verified');
    await page.evaluate(() => saveAll());

    const stored = await page.evaluate(({ activeKey, revisionPrefix }) => {
      const revision = localStorage.getItem(activeKey);
      return JSON.parse(localStorage.getItem(revisionPrefix + revision)).data.activeMonth;
    }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX });
    expect(stored).toBe('1999-01');
    await expect(page.getByRole('button', { name: 'September 2026' })).toBeVisible();
  });

  test('invalid restore is rejected and valid restore is previewed before replacement', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.getByText('No months yet')).toBeVisible();
    const before = await page.evaluate(key => localStorage.getItem(key), ACTIVE_KEY);
    await page.locator('#settingsBtn').click();

    await chooseRestoreFile(page, '{not-json', 'invalid.json');
    await expect(page.locator('#storageIssue')).toHaveClass(/show/);
    await expect(page.locator('#storageIssueText')).toContainText('invalid JSON');
    expect(await page.evaluate(key => localStorage.getItem(key), ACTIVE_KEY)).toBe(before);
    await page.locator('#storageIssue').getByRole('button', { name: 'Close' }).click();

    await chooseRestoreFile(page, validLegacyBackup());
    await expect(page.getByRole('heading', { name: 'Restore Preview' })).toBeVisible();
    await expect(page.locator('#restorePreviewContent')).toContainText('1');
    await expect(page.locator('#restorePreviewContent')).toContainText('৳15,000');
    await expect(page.locator('#restorePreviewContent')).toContainText('Legacy (unversioned)');
    expect(await page.evaluate(key => localStorage.getItem(key), ACTIVE_KEY)).toBe(before);

    await page.getByRole('button', { name: 'Replace Current Data' }).click();
    await expect(page.getByRole('button', { name: 'October 2026' })).toBeVisible();
    const restored = await page.evaluate(({ activeKey, revisionPrefix, recoveryPrefix }) => {
      const revision = localStorage.getItem(activeKey);
      const envelope = JSON.parse(localStorage.getItem(revisionPrefix + revision));
      return {
        revision,
        expenses: envelope.data.months['2026-10'].budgets['workspace-existing'].expenses,
        hasRestoreSnapshot: Object.keys(localStorage).some(key => {
          if (!key.startsWith(recoveryPrefix)) return false;
          return JSON.parse(localStorage.getItem(key)).reason === 'before-backup-restore';
        })
      };
    }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX, recoveryPrefix: RECOVERY_PREFIX });
    expect(restored.revision).not.toBe(before);
    expect(restored.expenses).toHaveLength(1);
    expect(restored.hasRestoreSnapshot).toBe(true);
  });

  test('backup reminder records and reports when the export was started', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.backup-banner')).toContainText('No full backup has been exported yet.');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.backup-banner').getByRole('button', { name: 'Back up' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^taka-koi-gelo-backup-\d{4}-\d{2}-\d{2}\.json$/);

    await page.locator('#settingsBtn').click();
    await expect(page.getByText(/Last export started .* Verify that the downloaded file exists\./)).toBeVisible();
    await expect(page.locator('.backup-banner')).toHaveCount(0);
    const timestamp = await page.evaluate(({ activeKey, revisionPrefix }) => {
      const revision = localStorage.getItem(activeKey);
      return JSON.parse(localStorage.getItem(revisionPrefix + revision)).data.settings.lastBackupAt;
    }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX });
    expect(Date.parse(timestamp)).not.toBeNaN();
  });

  test('a second tab becomes stale and cannot overwrite the newer active revision', async ({ context }) => {
    const first = await context.newPage();
    const stale = await context.newPage();
    await first.goto('/index.html');
    await stale.goto('/index.html');

    await first.getByRole('button', { name: '+ New Month' }).click();
    await first.locator('#newMonthInput').fill('2026-11');
    await first.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(first.getByRole('button', { name: 'November 2026' })).toBeVisible();

    await expect(stale.locator('#storageIssue')).toHaveClass(/show/);
    await expect(stale.locator('#storageIssueText')).toContainText('newer dataset was saved in another tab');
    const activeBeforeAttempt = await first.evaluate(key => localStorage.getItem(key), ACTIVE_KEY);

    const staleResult = await stale.evaluate(async () => {
      months['2026-12'] = { name: 'December 2026', categories: [], expenses: [] };
      try {
        await saveAll();
        return { saved: true };
      } catch (error) {
        return { saved: false, message: error.message };
      }
    });
    expect(staleResult.saved).toBe(false);
    expect(staleResult.message).toContain('newer dataset exists in another tab');

    const final = await first.evaluate(({ activeKey, revisionPrefix }) => {
      const revision = localStorage.getItem(activeKey);
      return {
        revision,
        months: Object.keys(JSON.parse(localStorage.getItem(revisionPrefix + revision)).data.months)
      };
    }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX });
    expect(final.revision).toBe(activeBeforeAttempt);
    expect(final.months).toEqual(['2026-11']);
  });

  test('simultaneous cross-tab commits produce exactly one winner', async ({ context }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([first.goto('/index.html'), second.goto('/index.html')]);

    const save = page => page.evaluate(async label => {
      const candidate = JSON.parse(JSON.stringify(currentData()));
      candidate.settings.concurrentWinner = label;
      try {
        const result = await storageAdapter.writeExclusive(candidate, loadedRevision);
        return { status: 'saved', revision: result.envelope.revision, label };
      } catch (error) {
        return { status: 'rejected', code: error.code, label };
      }
    }, page === first ? 'first' : 'second');

    const results = await Promise.all([save(first), save(second)]);
    expect(results.filter(result => result.status === 'saved')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toEqual([
      expect.objectContaining({ code: 'REVISION_CONFLICT' })
    ]);

    const active = await first.evaluate(({ activeKey, revisionPrefix }) => {
      const revision = localStorage.getItem(activeKey);
      const envelope = JSON.parse(localStorage.getItem(revisionPrefix + revision));
      return { revision, winner: envelope.data.settings.concurrentWinner };
    }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX });
    expect(active.revision).toBe(results.find(result => result.status === 'saved').revision);
    expect(['first', 'second']).toContain(active.winner);
  });

  test('quota failure keeps entered data available for retry or unsaved export', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => {
      storageAdapter.write = () => {
        throw new BudgetStorage.StorageAdapterError('WRITE_FAILED', 'Browser storage could not save the data');
      };
    });

    await page.getByRole('button', { name: '+ New Month' }).click();
    await page.locator('#newMonthInput').fill('2026-12');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.locator('#storageIssue')).toHaveClass(/show/);
    await expect(page.locator('#storageIssueText')).toContainText('could not save');
    await expect(page.locator('#newMonthModal')).toHaveClass(/show/);
    await expect(page.locator('#newMonthInput')).toHaveValue('2026-12');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export unsaved copy' }).click();
    const download = await downloadPromise;
    const unsaved = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    expect(unsaved.metadata.kind).toBe('unsaved-recovery');
    expect(unsaved.dataset.data.months['2026-12'].name).toBe('December 2026');
  });

  test('cached application shell restarts while offline', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:4173',
      serviceWorkers: 'allow'
    });
    const page = await context.newPage();
    await page.goto('/index.html');
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
      return registration.active && registration.active.state;
    });

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No months yet')).toBeVisible();
    await context.setOffline(false);
    await context.close();
  });
});
