import {test,expect} from '@playwright/test';
import {boot} from './helpers/expenseBackend.js';
import {reviewFixture} from './helpers/expenseReviewFixture.js';

const toast = page => page.locator('[data-sonner-toast]');

test('retry reconnects the trip channel and verifies the expense snapshot', async ({page}) => {
  const f = await reviewFixture();
  try {
    await boot(page,f.db,f.A);
    const channels = () => page.evaluate(() => window.budgetMock.activeTripChannels());
    await expect.poll(async () => (await channels()).length).toBe(1);
    const before = await channels();
    await page.evaluate(() => window.budgetMock.status('CHANNEL_ERROR'));
    await expect(toast(page)).toContainText('即時連線暫時中斷');
    const readsBefore = f.db.expenseCalls.filter(call => call.name === 'read_expense_snapshot').length;
    await toast(page).getByRole('button',{name:'重新嘗試'}).click();
    await expect.poll(channels).toEqual([`${before[0]}-retry-1`]);
    await expect(toast(page)).toContainText('資料已重新核對');
    expect(f.db.expenseCalls.filter(call => call.name === 'read_expense_snapshot').length).toBeGreaterThan(readsBefore);
    expect(page.qaErrors).toEqual([]);
  } finally { await page.close(); f.c.dispose(); await f.close(); }
});

test('toast close is vertically centered and dismissal does not create a scrolling toast', async ({page}) => {
  await page.clock.install();
  await page.goto('/demo/budget');
  await page.evaluate(async () => {
    const {notify} = await import('/src/lib/notifications.js');
    notify.error('即時連線暫時中斷，資料同步尚未確認。',{action:{label:'重新嘗試',onClick:()=>{}}});
  });
  const close = toast(page).getByRole('button',{name:'關閉通知'});
  await expect(close).toBeVisible();
  const centered = await close.evaluate(button => {
    const parent = button.closest('[data-sonner-toast]').getBoundingClientRect();
    const child = button.getBoundingClientRect();
    return Math.abs(parent.y + parent.height/2 - child.y - child.height/2);
  });
  expect(centered).toBeLessThan(1);
  await close.click();
  await expect(toast(page)).toHaveAttribute('data-removed','true');
  await expect(toast(page)).toHaveCSS('overflow-y','clip');
  await page.clock.runFor(400);
  await expect(toast(page)).toHaveCount(0);
});

test('full row outline yields to local selection and empty budget keeps its summary space', async ({page}) => {
  const f = await reviewFixture();
  try {
    await boot(page,f.db,f.A);
    const row = page.locator('.bw-row');
    const hint = await f.rpc('update_expense_selection',{p_trip_id:f.trip,p_session_id:f.sid,p_kind:'expense',p_id:f.id,p_activity_id:crypto.randomUUID(),p_action:'select'},f.B);
    expect(hint.error).toBeUndefined();
    const remote = row.locator('.bw-collaboration-outline');
    await expect(remote).toBeVisible();
    const cellEdges = () => row.evaluate(element => ({
      left: element.cells[0].getBoundingClientRect().left,
      right: element.cells[element.cells.length - 1].getBoundingClientRect().right,
    }));
    const before = await cellEdges();
    const remoteBox = await remote.boundingBox();
    expect(remoteBox.x).toBeCloseTo(before.left);
    expect(remoteBox.x + remoteBox.width).toBeCloseTo(before.right);
    await row.getByRole('button',{name:'Review',exact:true}).click();
    await expect(remote).toBeHidden();
    const selectedBox = await row.boundingBox();
    expect(await cellEdges()).toEqual(before);
    expect(selectedBox.x).toBeCloseTo(before.left);
    expect(selectedBox.x + selectedBox.width).toBeCloseTo(before.right);
    expect(await row.locator('.bw-day').evaluate(e => getComputedStyle(e,'::after').boxShadow)).toContain('2px');
    await page.getByRole('tab',{name:'編輯項目',exact:true}).click();
    const summary = page.getByRole('region',{name:'支出項目編輯'}).locator('.bw-calculation');
    const amount = page.getByRole('spinbutton',{name:'總額',exact:true});
    await amount.focus();
    await expect(amount).toBeEditable();
    const height = (await summary.boundingBox()).height;
    await amount.fill('');
    await expect(summary).toHaveText('個人—總額—');
    expect((await summary.boundingBox()).height).toBe(height);
    await expect(page.getByText('小數會在儲存時四捨五入。',{exact:false})).toHaveCount(0);
  } finally { await page.close(); f.c.dispose(); await f.close(); }
});
