'use strict';

const BudgetStorage = require('../storage.js');

function category(id, name, budget) { return { id, name, budget, archived: false }; }
function phase2Fixture() {
  return {
    months: {
      '2026-10': {
        name: 'October 2026',
        budgets: {
          family: {
            categories: [category('groceries', 'Groceries', 5000), category('fees', 'Fees', 500)],
            expenses: [{ id: 'legacy', catId: 'groceries', cat: 'Groceries', desc: 'Old food', amt: 1000, date: '2026-10-01' }]
          }
        }
      }
    },
    globalCats: [],
    workspaces: [{ id: 'family', name: 'Family', archived: false, template: [] }],
    activeMonth: '2026-10',
    settings: {
      lastBackupAt: null, phase1Version: 1, transactionTrash: [],
      phase2Version: 1, activeWorkspaceId: 'family'
    }
  };
}

describe('Phase 3 wallet migration and accounting', () => {
  test('keeps every historical expense wallet-unassigned and balance-neutral', () => {
    const migrated=BudgetStorage.upgradePhase3Data(phase2Fixture()).data;
    expect(migrated.wallets).toEqual([]);
    expect(migrated.walletEntries).toEqual([]);
    expect(migrated.months['2026-10'].budgets.family.expenses[0].walletId).toBeNull();
    expect(BudgetStorage.summarize(migrated).totalAmount).toBe(1000);
    expect(BudgetStorage.calculateWalletBalances(migrated)).toEqual({});
    expect(BudgetStorage.validateData(migrated).valid).toBe(true);
  });

  test('is idempotent and never assigns or deducts a legacy expense twice', () => {
    const first=BudgetStorage.upgradePhase3Data(phase2Fixture()).data;
    const second=BudgetStorage.upgradePhase3Data(first).data;
    expect(second).toEqual(first);
    expect(second.months['2026-10'].budgets.family.expenses).toHaveLength(1);
  });

  test('derives opening, income, expense, transfer, and fee balances correctly', () => {
    const data=BudgetStorage.upgradePhase3Data(phase2Fixture()).data;
    data.wallets=[
      {id:'bank',name:'Bank',archived:false},
      {id:'bkash',name:'bKash',archived:false}
    ];
    data.walletEntries=[
      {id:'open',type:'opening',walletId:'bank',amount:10000,date:'2026-10-01',description:'Opening'},
      {id:'salary',type:'income',walletId:'bank',source:'Salary',description:'October',amount:50000,date:'2026-10-02'},
      {id:'move',type:'transfer',fromWalletId:'bank',toWalletId:'bkash',amount:5000,date:'2026-10-03',description:'Top up'}
    ];
    const budget=data.months['2026-10'].budgets.family;
    budget.expenses.push(
      {id:'new-food',catId:'groceries',cat:'Groceries',desc:'Food',amt:4000,date:'2026-10-03',walletId:'bank'},
      {id:'fee',catId:'fees',cat:'Fees',desc:'Transfer fee',amt:20,date:'2026-10-03',walletId:'bank',transferId:'move'}
    );

    expect(BudgetStorage.validateData(data).valid).toBe(true);
    expect(BudgetStorage.calculateWalletBalances(data)).toEqual({bank:50980,bkash:5000});
    expect(Object.values(BudgetStorage.calculateWalletBalances(data)).reduce((sum,value)=>sum+value,0)).toBe(55980);
    expect(BudgetStorage.summarize(data).totalAmount).toBe(5020);
  });

  test('fee-free transfers preserve the combined wallet balance and adjustments require reasons', () => {
    const data=BudgetStorage.upgradePhase3Data(phase2Fixture()).data;
    data.wallets=[{id:'cash',name:'Cash',archived:false},{id:'bank',name:'Bank',archived:false}];
    data.walletEntries=[
      {id:'open',type:'opening',walletId:'cash',amount:1000,date:'2026-10-01'},
      {id:'move',type:'transfer',fromWalletId:'cash',toWalletId:'bank',amount:400,date:'2026-10-02'}
    ];
    const balances=BudgetStorage.calculateWalletBalances(data);
    expect(balances).toEqual({cash:600,bank:400});
    expect(Object.values(balances).reduce((sum,value)=>sum+value,0)).toBe(1000);

    data.walletEntries.push({id:'bad-adjustment',type:'adjustment',walletId:'cash',amount:-10,date:'2026-10-03',reason:''});
    expect(BudgetStorage.validateData(data).valid).toBe(false);
  });

  test('rejects wallet-linked expenses and entries that reference missing wallets', () => {
    const data=BudgetStorage.upgradePhase3Data(phase2Fixture()).data;
    data.months['2026-10'].budgets.family.expenses[0].walletId='missing';
    data.walletEntries.push({id:'income',type:'income',walletId:'missing',source:'Salary',amount:1,date:'2026-10-01'});
    const validation=BudgetStorage.validateData(data);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toMatch(/reference a wallet/);
  });
});
