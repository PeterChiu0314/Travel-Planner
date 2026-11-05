import {randomUUID as uuid} from 'node:crypto';
import {expenseBackend} from './expenseBackend.js';
import {createExpenseEditor} from '../../src/lib/expenseEditor.js';
import {newExpense,priceExpense,expenseRows} from '../../src/lib/expenseItems.js';
export async function reviewFixture(legacy=false){
 const f=await expenseBackend(),id=uuid(),sid=uuid();
 let item={...newExpense({id,tripId:f.trip,members:f.db.members}),title:'Review',payer_id:f.A};
 if(legacy)item={...item,budget:null,paid:{amount:100,currency:'TWD',exchange_rate:1,twd_amount:100,pricing_mode:'split_total',participantIds:[],shares:{},record_status:'complete'},payment_state:'paid',decisions:{budget:null,paid:null}};
 else item=priceExpense(item,'budget',{amount:10000,currency:'TWD',exchange_rate:1,pricing_mode:'split_total',participantIds:[f.A]},0);
 const {item:row,participants}=expenseRows(item);
 await f.sql.query('insert into expense_stage_b.expense_items(id,trip_id,title,payer_id,budget,paid,payment_state,budget_decisions_known,paid_decisions_known) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,f.trip,row.title,row.payer_id,row.budget,row.paid,row.payment_state,row.budget_decisions_known,row.paid_decisions_known]);
 for(const p of participants)await f.sql.query('insert into expense_stage_b.expense_participants values($1,$2,$3,$4,$5,$6)',[p.expense_id,p.user_id,p.budget_selected,p.paid_selected,p.budget_share_amount,p.paid_share_amount]);
 const rpc=(name,args,actor=f.A)=>f.db.request({op:'rpc',name,args,actor});
 const service={authorized:async()=>true,read:(trip,session)=>rpc('read_expense_snapshot',{p_trip_id:trip,p_session_id:session}),lease:r=>rpc('expense_group_lease',r),mutate:r=>rpc('mutate_expense_group',r)};
 const c=createExpenseEditor({service,actor:f.A,trip:f.trip,sessionId:sid});await c.refresh();
 return {...f,id,sid,service,c,rpc};
}
