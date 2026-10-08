const { test, expect } = require('@playwright/test');

const ACTIVE_KEY='tkg_store_active';
const REVISION_PREFIX='tkg_store_revision_';

function phase3Data(){
  return {
    months:{
      '2026-10':{name:'October 2026',budgets:{family:{
        categories:[
          {id:'groceries',name:'Groceries',budget:5000,archived:false},
          {id:'fees',name:'Fees',budget:500,archived:false}
        ],expenses:[]
      }}}
    },
    globalCats:[],
    workspaces:[{id:'family',name:'Family',archived:false,template:[]}],
    wallets:[
      {id:'bank',name:'Bank',archived:false},
      {id:'bkash',name:'bKash',archived:false}
    ],
    walletEntries:[{id:'opening-bank',type:'opening',walletId:'bank',amount:10000,date:'2026-10-01',description:'Opening balance'}],
    activeMonth:'2026-10',
    settings:{
      lastBackupAt:null,phase1Version:1,transactionTrash:[],phase2Version:1,
      activeWorkspaceId:'family',phase3Version:1,walletEntryTrash:[]
    }
  };
}

async function seedCurrent(page,data=phase3Data()){
  await page.addInitScript(({activeKey,revisionPrefix,dataset})=>{
    localStorage.setItem(activeKey,'seed-phase3');
    localStorage.setItem(revisionPrefix+'seed-phase3',JSON.stringify({schemaVersion:1,revision:'seed-phase3',parentRevision:null,updatedAt:'2026-10-08T00:00:00.000Z',writerId:'seed',metadata:{kind:'test'},data:dataset}));
  },{activeKey:ACTIVE_KEY,revisionPrefix:REVISION_PREFIX,dataset:data});
}

async function activeData(page){
  return page.evaluate(({activeKey,revisionPrefix})=>{const revision=localStorage.getItem(activeKey);return JSON.parse(localStorage.getItem(revisionPrefix+revision)).data;},{activeKey:ACTIVE_KEY,revisionPrefix:REVISION_PREFIX});
}

test.describe('Phase 3 wallets, income, and transfers',()=>{
  test('matches the opening, salary, expense, transfer, and fee accounting example',async({page})=>{
    await seedCurrent(page);await page.goto('/index.html');
    await page.getByRole('button',{name:'Wallets',exact:true}).click();
    await page.getByRole('button',{name:'+ Income'}).click();
    await page.locator('#walletEntryWallet').selectOption('bank');
    await page.locator('#walletEntryAmount').fill('50000');
    await page.locator('#walletEntryDate').fill('2026-10-02');
    await page.locator('#walletEntrySource').fill('Salary');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.locator('#toast')).toContainText('Wallet entry saved');

    await page.getByRole('button',{name:'Add',exact:true}).click();
    await page.locator('#catSel').selectOption({label:'Groceries'});
    await page.locator('#walletSel').selectOption('bank');
    await page.locator('#descIn').fill('Family groceries');
    await page.locator('#dateIn').fill('2026-10-03');
    await page.locator('#amtIn').fill('4000');
    await page.locator('#tab-add').getByRole('button',{name:'Add',exact:true}).click();
    await expect(page.locator('#toast')).toContainText('Added');

    await page.getByRole('button',{name:'Wallets',exact:true}).click();
    await page.getByRole('button',{name:'⇄ Transfer'}).click();
    await page.locator('#transferFrom').selectOption('bank');
    await page.locator('#transferTo').selectOption('bkash');
    await page.locator('#transferAmount').fill('5000');
    await page.locator('#transferDate').fill('2026-10-03');
    await page.locator('#transferFee').fill('20');
    await page.locator('#transferFeeWorkspace').selectOption('family');
    await page.locator('#transferFeeCategory').selectOption({label:'Fees'});
    await page.getByRole('button',{name:'Save Transfer'}).click();
    await expect(page.locator('#toast')).toContainText('Transfer saved');

    const result=await page.evaluate(()=>({data:currentData(),balances:BudgetStorage.calculateWalletBalances(currentData()),summary:BudgetStorage.summarize(currentData())}));
    expect(result.balances).toEqual({bank:50980,bkash:5000});
    expect(result.summary.totalAmount).toBe(4020);
    expect(result.data.walletEntries.filter(entry=>entry.type==='transfer')).toHaveLength(1);
    expect(result.data.months['2026-10'].budgets.family.expenses.find(expense=>expense.transferId)).toEqual(expect.objectContaining({amt:20,walletId:'bank'}));
  });

  test('keeps legacy wallet-unassigned spending separate from a new opening balance',async({page})=>{
    const data=phase3Data();
    data.months['2026-10'].budgets.family.expenses.push({id:'legacy',catId:'groceries',cat:'Groceries',desc:'Historical food',amt:900,date:'2026-10-01',walletId:null});
    await seedCurrent(page,data);await page.goto('/index.html');
    await expect(page.locator('#stWalletBalance')).toHaveText('৳10,000');
    await expect(page.locator('#stUnassigned')).toHaveText('1');
    await page.getByRole('button',{name:'Log',exact:true}).click();
    await expect(page.getByText(/Wallet unassigned/)).toBeVisible();
  });

  test('a fee-free transfer preserves combined balance and wallet archive keeps history',async({page})=>{
    await seedCurrent(page);await page.goto('/index.html');
    await page.getByRole('button',{name:'Wallets',exact:true}).click();
    await page.getByRole('button',{name:'⇄ Transfer'}).click();
    await page.locator('#transferFrom').selectOption('bank');await page.locator('#transferTo').selectOption('bkash');await page.locator('#transferAmount').fill('400');await page.locator('#transferDate').fill('2026-10-02');
    await page.getByRole('button',{name:'Save Transfer'}).click();await expect(page.locator('#toast')).toContainText('Transfer saved');
    let balances=await page.evaluate(()=>BudgetStorage.calculateWalletBalances(currentData()));
    expect(balances).toEqual({bank:9600,bkash:400});
    expect(Object.values(balances).reduce((sum,value)=>sum+value,0)).toBe(10000);

    const bankCard=page.locator('.workspace-card').filter({hasText:'Bank'});page.once('dialog',dialog=>dialog.accept());await bankCard.getByRole('button',{name:'Archive'}).click();await expect(page.locator('#toast')).toContainText('Wallet archived');
    const data=await activeData(page);expect(data.wallets.find(wallet=>wallet.id==='bank').archived).toBe(true);expect(data.walletEntries).toHaveLength(2);
  });

  test('editing, deleting, and restoring income recalculates from records without double application',async({page})=>{
    const data=phase3Data();data.walletEntries.push({id:'salary',type:'income',walletId:'bank',source:'Salary',description:'October',amount:500,date:'2026-10-02'});
    await seedCurrent(page,data);await page.goto('/index.html');await page.getByRole('button',{name:'Wallets',exact:true}).click();
    const income=page.locator('.log-item').filter({hasText:'Income · Salary'});await income.getByRole('button',{name:'Edit wallet entry'}).click();await page.locator('#walletEntryAmount').fill('600');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('#toast')).toContainText('Wallet entry saved');
    expect(await page.evaluate(()=>BudgetStorage.calculateWalletBalances(currentData()).bank)).toBe(10600);

    const edited=page.locator('.log-item').filter({hasText:'Income · Salary'});page.once('dialog',dialog=>dialog.accept());await edited.getByRole('button',{name:'Delete wallet entry'}).click();await expect(page.locator('#toast')).toContainText('moved to trash');expect(await page.evaluate(()=>BudgetStorage.calculateWalletBalances(currentData()).bank)).toBe(10000);
    await page.locator('#settingsBtn').click();await page.getByRole('button',{name:'Restore'}).last().click();await expect(page.locator('#toast')).toContainText('Wallet entry restored');expect(await page.evaluate(()=>BudgetStorage.calculateWalletBalances(currentData()).bank)).toBe(10600);
    expect((await activeData(page)).walletEntries.filter(entry=>entry.id==='salary')).toHaveLength(1);
  });
});
