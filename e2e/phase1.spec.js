const { test, expect } = require('@playwright/test');

const ACTIVE_KEY = 'tkg_store_active';
const REVISION_PREFIX = 'tkg_store_revision_';

function seededData() {
  return {
    months: {
      '2026-10': {
        name: 'October 2026',
        categories: [{ id: 'food', name: 'Food <safe>', budget: 1000, archived: false }],
        expenses: [{ id: 'old', catId: 'food', cat: 'Food <safe>', desc: '<img id="injected" src=x>', amt: 100, date: '2026-10-08', walletId: null }]
      },
      '2026-11': {
        name: 'November 2026',
        categories: [{ id: 'food-nov', name: 'Food <safe>', budget: 1200, archived: false }],
        expenses: []
      }
    },
    globalCats: [],
    wallets: [{ id: 'cash', name: 'Cash', archived: false }],
    walletEntries: [{ id: 'opening', type: 'opening', walletId: 'cash', amount: 1000, date: '2026-10-01' }],
    activeMonth: '2026-10',
    settings: {
      lastBackupAt: null, phase1Version: 1, transactionTrash: [],
      phase3Version: 1, walletEntryTrash: []
    }
  };
}

async function seedCurrent(page, data = seededData()) {
  await page.addInitScript(({ activeKey, revisionPrefix, dataset }) => {
    const envelope = {
      schemaVersion: 1, revision: 'seed', parentRevision: null,
      updatedAt: '2026-10-08T00:00:00.000Z', writerId: 'seed', metadata: { kind: 'test' }, data: dataset
    };
    localStorage.setItem(activeKey, 'seed');
    localStorage.setItem(revisionPrefix + 'seed', JSON.stringify(envelope));
  }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX, dataset: data });
}

async function activeData(page) {
  return page.evaluate(({ activeKey, revisionPrefix }) => {
    const revision = localStorage.getItem(activeKey);
    return JSON.parse(localStorage.getItem(revisionPrefix + revision)).data;
  }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX });
}

test.describe('Phase 1 reliable transaction entry', () => {
  test('renders user text safely and stores new expenses with full dates', async ({ page }) => {
    await seedCurrent(page);
    await page.goto('/index.html');
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await expect(page.getByText('<img id="injected" src=x>', { exact: true })).toBeVisible();
    await expect(page.locator('#injected')).toHaveCount(0);

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.locator('#catSel').selectOption({ label: 'Food <safe>' });
    await page.locator('#walletSel').selectOption({ label: 'Cash' });
    await page.locator('#descIn').fill('Tea & <b>snack</b>');
    await page.locator('#dateIn').fill('2026-10-12');
    await page.locator('#amtIn').fill('25.5');
    await page.locator('#tab-add').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Added');

    const data = await activeData(page);
    expect(data.months['2026-10'].budgets['workspace-existing'].expenses[0]).toEqual(expect.objectContaining({
      desc: 'Tea & <b>snack</b>', amt: 25.5, date: '2026-10-12'
    }));
  });

  test('edits all expense fields and explicitly moves a dated expense across months', async ({ page }) => {
    await seedCurrent(page);
    await page.goto('/index.html');
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await page.getByRole('button', { name: /Edit <img/ }).click();
    await page.locator('#editExpenseDesc').fill('Moved meal');
    await page.locator('#editExpenseAmount').fill('150');
    await page.locator('#editExpenseDate').fill('2026-11-03');
    await page.locator('#editExpenseCategory').selectOption({ label: 'Food <safe>' });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    const data = await activeData(page);
    expect(data.months['2026-10'].budgets['workspace-existing'].expenses).toHaveLength(0);
    expect(data.months['2026-11'].budgets['workspace-existing'].expenses).toEqual([
      expect.objectContaining({ desc: 'Moved meal', amt: 150, date: '2026-11-03', catId: 'food-nov' })
    ]);
  });

  test('deletion is recoverable and referenced categories are archived instead of removed', async ({ page }) => {
    await seedCurrent(page);
    await page.goto('/index.html');
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.log-item').getByRole('button', { name: '✕' }).click();
    await expect(page.locator('#toast')).toContainText('Moved to trash');
    let data = await activeData(page);
    expect(data.months['2026-10'].budgets['workspace-existing'].expenses).toHaveLength(0);
    expect(data.settings.transactionTrash).toHaveLength(1);

    await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('#toast')).toContainText('Expense restored');
    data = await activeData(page);
    expect(data.months['2026-10'].budgets['workspace-existing'].expenses).toHaveLength(1);
    expect(data.settings.transactionTrash).toHaveLength(0);

    await page.locator('#settingsBtn').click();
    const monthCategory = page.locator('#monthCatList .cat-mgmt-item').first();
    page.once('dialog', dialog => dialog.accept());
    await monthCategory.locator('.del-cat-btn').click();
    await expect(page.locator('#toast')).toContainText('Category archived');
    data = await activeData(page);
    expect(data.months['2026-10'].budgets['workspace-existing'].categories[0].archived).toBe(true);
    expect(data.months['2026-10'].budgets['workspace-existing'].expenses).toHaveLength(1);
  });

  test('legacy date conflicts stay preserved and visibly require review', async ({ page }) => {
    const months = seededData().months;
    months['2026-10'].expenses[0].date = '08 Sep';
    await page.addInitScript(values => {
      localStorage.setItem('bt_months', JSON.stringify(values.months));
      localStorage.setItem('bt_global_cats', '[]');
      localStorage.setItem('bt_active_month', '2026-10');
    }, { months });
    await page.goto('/index.html');
    const download = page.waitForEvent('download');
    await page.locator('#preMigrationDownload').click();
    await download;
    await page.locator('#migrationVerified').check();
    await page.locator('#runMigrationBtn').click();
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await expect(page.getByText(/08 Sep · review date/)).toBeVisible();
    const data = await activeData(page);
    expect(data.months['2026-10'].budgets['workspace-existing'].expenses[0]).toEqual(expect.objectContaining({ date: null, legacyDate: '08 Sep' }));
  });

  test('replacing monthly categories retains referenced categories and their expenses', async ({ page }) => {
    await seedCurrent(page);
    await page.goto('/index.html');
    await page.locator('#settingsBtn').click();
    await page.getByRole('button', { name: '📥' }).nth(1).click();
    await page.getByLabel('Replace').check();
    await page.locator('#importCatText').fill('Travel, 500');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Imported');

    const data = await activeData(page);
    expect(data.months['2026-10'].budgets['workspace-existing'].expenses).toHaveLength(1);
    expect(data.months['2026-10'].budgets['workspace-existing'].categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'food', archived: true }),
      expect.objectContaining({ name: 'Travel', archived: false })
    ]));
  });
});
