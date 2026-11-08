import { randomUUID as uuid } from 'node:crypto';
import { expenseBackend } from './expenseBackend.js';
import { expenseRows, newExpense, priceExpense } from '../../src/lib/expenseItems.js';

export async function departureFixture() {
  const f = await expenseBackend({ timeline: true });
  const C = uuid(), D = uuid();
  for (const [id, name] of [[C, 'Charlie'], [D, 'Dora']]) {
    await f.sql.query('insert into auth.users(id) values($1)', [id]);
    await f.sql.query("insert into public.trip_members(trip_id,user_id,display_name,status,role) values($1,$2,$3,'approved','editor')", [f.trip,id,name]);
    f.db.members.push({ trip_id:f.trip, user_id:id, display_name:name, status:'approved', role:'editor' });
  }

  async function seed(title, form, { paid=false, payer, wholeOriginal=true, retained=false }={}) {
    await f.sql.exec('reset role');
    const id = uuid();
    const input = { currency:'TWD', exchange_rate:1, pricing_mode:'split_total', amount:900, participantIds:[f.A,f.B,C], ...form };
    let model = { ...newExpense({id,tripId:f.trip,members:f.db.members}), title, category:'交通' };
    model = priceExpense(model,'budget',input,0,{wholeOriginal});
    if (paid || retained) model = priceExpense(model,'paid',input,0,{wholeOriginal});
    const rows = typeof payer === 'string' ? [{ user_id:payer, amount:Math.round(model.budget.amount), order:0 }] : payer || [];
    model = { ...model, payment_state:paid?'paid':'unpaid', paid_at:paid?'2026-01-01T00:00:00Z':null,
      payment_mode:rows.length?'advance':'self', payer_id:rows[0]?.user_id ?? null, payer_allocations:rows, planning_managed:true };
    const {item,participants} = expenseRows(model);
    await f.sql.query(`insert into expense_stage_b.expense_items(id,trip_id,title,category,budget,paid,payment_state,paid_at,
      budget_decisions_known,paid_decisions_known,payment_mode,payer_id,payer_allocations,planning_managed)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id,f.trip,title,item.category,item.budget,item.paid,item.payment_state,item.paid_at,true,Boolean(item.paid),item.payment_mode,item.payer_id,JSON.stringify(rows),true]);
    for (const person of participants) await f.sql.query('insert into expense_stage_b.expense_participants values($1,$2,$3,$4,$5,$6)',
      [id,person.user_id,person.budget_selected,person.paid_selected,person.budget_share_amount,person.paid_share_amount]);
    return id;
  }

  async function remove(ids, actor=f.A) {
    await f.sql.exec('reset role');
    await f.sql.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
    await f.sql.exec('set role authenticated');
    const deleted = (await f.sql.query('delete from public.trip_members where trip_id=$1 and user_id=any($2::uuid[]) returning user_id', [f.trip,ids])).rows;
    for (const { user_id } of deleted) f.db.members.splice(f.db.members.findIndex(member=>member.user_id===user_id),1);
    if (deleted.length) await f.db.emit('expense_signals',{eventType:'UPDATE',new:{trip_id:f.trip}});
    return deleted.length;
  }

  async function rpc(name,args,actor=f.A) { return f.db.request({op:'rpc',name,args,actor}); }
  async function lease(id,group,actor=f.A,base=0) {
    const params = {p_id:id,p_group:group,p_session_id:uuid(),p_token:uuid(),p_base:base};
    const result = await rpc('expense_group_lease',{...params,p_action:'acquire'},actor);
    return { params:{...params,p_epoch:result.data?.epoch}, result,
      release:()=>rpc('expense_group_lease',{...params,p_epoch:result.data?.epoch,p_action:'release'},actor),
      mutate:(value,request=uuid())=>rpc('mutate_expense_group',{...params,p_epoch:result.data?.epoch,p_value:value,p_request_id:request},actor) };
  }
  return {...f,C,D,seed,remove,rpc,lease};
}
