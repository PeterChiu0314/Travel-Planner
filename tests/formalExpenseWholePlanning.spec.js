import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {boot,enableMetadata} from './helpers/expenseBackend.js';
import {reviewFixture} from './helpers/expenseReviewFixture.js';

const editor = page => page.getByRole('region',{name:'支出項目編輯'});
const pricing = page => editor(page).getByRole('group',{name:'預算計價與分攤',exact:true});
const details = page => page.getByRole('tab',{name:'項目明細',exact:true});
const select = page => page.locator('.bw-row').getByRole('button',{name:'Review',exact:true}).click();
async function open(page,f,actor){
 await enableMetadata(page);
 await boot(page,f.db,actor);
 await select(page);
 await page.getByRole('tab',{name:'編輯項目',exact:true}).click();
}

test('legacy decimals stay untouched until an edit, then three shares reconcile and the peer can take over',async({page,context})=>{
 const f=await reviewFixture(),peer=await context.newPage(),C=uuid();
 try{
  await f.sql.exec('reset role');
  await f.sql.query("insert into public.trip_members values($1,$2,'C','c@qa.invalid','approved','editor')",[f.trip,C]);
  f.db.members.push({trip_id:f.trip,user_id:C,display_name:'C',email:'c@qa.invalid',status:'approved',role:'editor'});
  await f.sql.query("update expense_stage_b.expense_items set budget=budget||'{\"amount\":1000.41,\"twd_amount\":1000}'::jsonb where id=$1",[f.id]);
  for(const id of [f.A,f.B,C]){
   await f.sql.query(`insert into expense_stage_b.expense_participants(expense_id,user_id,budget_selected,budget_share_amount)
    values($1,$2,true,333.47) on conflict(expense_id,user_id) do update set budget_selected=true,budget_share_amount=333.47`,[f.id,id]);
  }
  await page.clock.install();
  await open(page,f,f.A);
  await open(peer,f,f.B);
  const group=pricing(page),amount=group.getByRole('spinbutton',{name:'總額',exact:true});
  const payer=editor(peer).getByRole('button',{name:'指定付款人',exact:true});
  const getShares=async()=>(await f.snapshot()).participants.filter(p=>p.budget_selected).map(p=>p.budget_share_amount);
  await expect(amount).toHaveValue('1000.41');
  await expect(amount).toHaveAttribute('step','1');
  await amount.focus();
  await expect(amount).toBeEditable();
  await expect(payer).toBeDisabled();
  expect(await getShares()).toEqual([333.47,333.47,333.47]);
  await amount.fill('1000.42');
  await page.clock.runFor(1200);
  await expect(amount).toHaveValue('1000.42');
  expect((await f.snapshot()).items[0].budget.amount).toBe(1000.41);
  await amount.blur();
  await expect(amount).toHaveValue('1000');
  await expect.poll(getShares).toEqual([334,333,333]);
  await expect(payer).toBeEnabled();
  await group.getByRole('button',{name:'自訂分攤',exact:true}).click();
  const inputs=group.getByRole('spinbutton',{name:/分攤金額/});
  await expect(inputs).toHaveCount(3);
  expect((await inputs.evaluateAll(nodes=>nodes.map(node=>Number(node.value)))).sort()).toEqual([333,333,334]);
  for(const [label,value] of [['A','699.50'],['B','499.50'],['C','0.49']]){
   await group.getByRole('spinbutton',{name:`${label} 分攤金額`,exact:true}).fill(value);
  }
  await details(page).click();
  await expect.poll(async()=>(await f.snapshot()).items[0].budget.amount).toBe(1200);
  await peer.reload();
  await select(peer);
  const breakdown=peer.locator('.bw-detail-shares');
  await breakdown.locator('summary').getByText('成員分攤明細',{exact:false}).click();
  await expect(breakdown).toContainText('700');
  await expect(breakdown).toContainText('500');
  expect(page.qaErrors).toEqual([]);
  expect(peer.qaErrors).toEqual([]);
 }finally{await page.close();await peer.close();f.c.dispose();await f.close();}
});
