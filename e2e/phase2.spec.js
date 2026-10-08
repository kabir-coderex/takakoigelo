const { test, expect } = require('@playwright/test');

const ACTIVE_KEY = 'tkg_store_active';
const REVISION_PREFIX = 'tkg_store_revision_';

function workspace(id, name, template = []) { return { id, name, archived: false, template }; }
function category(id, name, budget) { return { id, name, budget, archived: false }; }

function phase2Data() {
  return {
    months: {
      '2026-10': {
        name: 'October 2026',
        budgets: {
          family: {
            categories: [category('family-food', 'Food', 1000)],
            expenses: [{ id: 'f1', catId: 'family-food', cat: 'Food', desc: 'Family meal', amt: 200, date: '2026-10-03' }]
          },
          personal: {
            categories: [category('personal-food', 'Food', 500)],
            expenses: [{ id: 'p1', catId: 'personal-food', cat: 'Food', desc: 'Personal snack', amt: 100, date: '2026-10-04' }]
          }
        }
      }
    },
    globalCats: [],
    workspaces: [workspace('family', 'Family'), workspace('personal', 'Personal')],
    activeMonth: '2026-10',
    settings: {
      lastBackupAt: null, phase1Version: 1, transactionTrash: [],
      phase2Version: 1, activeWorkspaceId: 'family'
    }
  };
}

async function seedCurrent(page, data) {
  await page.addInitScript(({ activeKey, revisionPrefix, dataset }) => {
    localStorage.setItem(activeKey, 'seed-phase2');
    localStorage.setItem(revisionPrefix + 'seed-phase2', JSON.stringify({
      schemaVersion: 1, revision: 'seed-phase2', parentRevision: null,
      updatedAt: '2026-10-08T00:00:00.000Z', writerId: 'seed', metadata: { kind: 'test' }, data: dataset
    }));
  }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX, dataset: data });
}

async function activeData(page) {
  return page.evaluate(({ activeKey, revisionPrefix }) => {
    const revision = localStorage.getItem(activeKey);
    return JSON.parse(localStorage.getItem(revisionPrefix + revision)).data;
  }, { activeKey: ACTIVE_KEY, revisionPrefix: REVISION_PREFIX });
}

test.describe('Phase 2 multiple budget workspaces', () => {
  test('shows independent same-named categories and a combined overview without double counting', async ({ page }) => {
    await seedCurrent(page, phase2Data());
    await page.goto('/index.html');
    await expect(page.locator('#headerTitle')).toContainText('Family');
    await expect(page.locator('#stSpent')).toHaveText('৳200');

    await page.getByRole('button', { name: 'Personal', exact: true }).click();
    await expect(page.locator('#stSpent')).toHaveText('৳100');
    await page.getByRole('button', { name: 'All Workspaces', exact: true }).click();
    await expect(page.getByText('৳300 spent of ৳1,500 · 2 transactions')).toBeVisible();
    await expect(page.locator('.workspace-card')).toHaveCount(2);
  });

  test('creates, renames, archives, and restores a workspace without deleting history', async ({ page }) => {
    await seedCurrent(page, phase2Data());
    await page.goto('/index.html');
    await page.getByRole('button', { name: '+ Workspace' }).click();
    await page.locator('#workspaceName').fill('Side Budget');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Side Budget', exact: true })).toBeVisible();

    await page.locator('#settingsBtn').click();
    const row=page.locator('.settings-section').filter({hasText:'Workspaces'}).locator('.cat-mgmt-item').filter({hasText:'Side Budget'});
    await row.locator('.edit-btn').click();
    await page.locator('#workspaceName').fill('Learning');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const renamed=page.locator('.settings-section').filter({hasText:'Workspaces'}).locator('.cat-mgmt-item').filter({hasText:'Learning'});
    page.once('dialog', dialog=>dialog.accept());
    await renamed.locator('.del-cat-btn').click();

    let data=await activeData(page);
    expect(data.workspaces.find(item=>item.name==='Learning').archived).toBe(true);
    expect(data.months['2026-10'].budgets[data.workspaces.find(item=>item.name==='Learning').id]).toBeTruthy();
    await page.locator('.settings-section').filter({hasText:'Workspaces'}).locator('.cat-mgmt-item').filter({hasText:'Learning'}).locator('.edit-btn').last().click();
    await expect(page.locator('#toast')).toContainText('Workspace restored');
    data=await activeData(page);
    expect(data.workspaces.find(item=>item.name==='Learning').archived).toBe(false);
  });

  test('copies a workspace budget only from its latest earlier month, never a future month', async ({ page }) => {
    const data=phase2Data();
    data.months={
      '2026-09': {name:'September 2026',budgets:{family:{categories:[category('earlier','Earlier Category',700)],expenses:[]},personal:{categories:[],expenses:[]}}},
      '2026-11': {name:'November 2026',budgets:{family:{categories:[category('future','Future Category',900)],expenses:[]},personal:{categories:[],expenses:[]}}}
    };
    data.activeMonth='2026-09';
    await seedCurrent(page,data);
    await page.goto('/index.html');
    await page.getByRole('button',{name:'+ New Month'}).click();
    await page.locator('#newMonthInput').fill('2026-10');
    await page.getByRole('button',{name:'Create',exact:true}).click();
    await expect(page.locator('#catSel')).toContainText('Earlier Category');
    await expect(page.locator('#catSel')).not.toContainText('Future Category');
  });

  test('moves an expense between workspaces with explicit category reassignment', async ({ page }) => {
    await seedCurrent(page,phase2Data());
    await page.goto('/index.html');
    await page.getByRole('button',{name:'Log',exact:true}).click();
    await page.getByRole('button',{name:'Edit Family meal'}).click();
    await page.locator('#editExpenseWorkspace').selectOption('personal');
    await page.locator('#editExpenseCategory').selectOption({label:'Food'});
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.locator('#toast')).toContainText('Expense moved');

    const data=await activeData(page);
    expect(data.months['2026-10'].budgets.family.expenses).toHaveLength(0);
    expect(data.months['2026-10'].budgets.personal.expenses).toHaveLength(2);
    expect(data.months['2026-10'].budgets.personal.expenses[0]).toEqual(expect.objectContaining({catId:'personal-food',desc:'Family meal'}));
  });
});
