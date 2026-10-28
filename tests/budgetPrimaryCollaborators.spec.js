import {expect,test} from '@playwright/test';
import {primaryBudgetCollaborators} from '../src/lib/budgetCollaboration.js';
const hint=(user_id,resource_id,mode='selection',selected_at='2026-10-28T00:00:00.000Z',own_session=false)=>({user_id,resource_id,kind:'budget',mode,selected_at,own_session});
test('real edits suppress all same-user selections but preserve every distinct real edit',()=>{
  const input=[hint('A','a','edit'),hint('A','b','selection','2026-10-28T00:01:00Z'),hint('B','b')];
  expect(primaryBudgetCollaborators(input).map(r=>[r.user_id,r.resource_id])).toEqual([['A','a'],['B','b']]);
  input.push(hint('A','c','edit'));expect(primaryBudgetCollaborators(input).filter(r=>r.user_id==='A').map(r=>r.resource_id)).toEqual(['a','c']);
});
test('only actual selection time chooses primary; heartbeat expiry and wire ordering cannot steal it',()=>{
  const older={...hint('A','a'),expires_at:'2099-01-01T00:00:00Z'},newer={...hint('A','b','selection','2026-10-28T00:00:01.000Z'),expires_at:'2026-10-28T00:01:00Z'};
  expect(primaryBudgetCollaborators([older,newer])[0].resource_id).toBe('b');expect(primaryBudgetCollaborators([newer,older])[0].resource_id).toBe('b');
  older.expires_at='2199-01-01T00:00:00Z';expect(primaryBudgetCollaborators([older,newer])[0].resource_id).toBe('b');
});
test('own-session edit participates before remote filtering; same-row users dedupe independently',()=>{
  const rows=[hint('A','a','edit',null,true),hint('A','b'),hint('A','a','edit'),hint('B','a'),hint('B','a')];
  const primary=primaryBudgetCollaborators(rows);expect(primary).toHaveLength(2);expect(primary[0].own_session).toBe(true);
  expect(primary.filter(r=>!r.own_session).map(r=>r.user_id)).toEqual(['B']);
});
test('legacy unordered selections have a stable fallback independent of refreshed expiry',()=>{
  const a={...hint('A','a','selection',null),expires_at:'2030'},b={...hint('A','b','selection',null),expires_at:'2040'};
  expect(primaryBudgetCollaborators([a,b])[0].resource_id).toBe(primaryBudgetCollaborators([b,a])[0].resource_id);
});
