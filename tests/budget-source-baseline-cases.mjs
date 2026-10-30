import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
// These observations were run against c136244 before creating the Source migration.
export async function sourceBaselineCases(h,p) {
 const {test,admin,trip,fixture,actorA,record}=h;
 await test('Source baseline: first link captures origin; unlink retains history; relink overwrites historical origin',async()=>{
  const old=await fixture(),next=await fixture(),id=uuid();await admin('begin');try{
   await admin("insert into actual_expenses(id,trip_id,title,amount,twd_amount,currency,exchange_rate,payer_id,payment_origin,twd_amount_source,actual_twd_amount) values($1,$2,'manual source',900,777,'JPY',0.2,$3,'manual','actual',777)",[id,trip,actorA]);
   await admin('update actual_expenses set budget_item_id=$2 where id=$1',[id,old]);let row=await record(id,'actual');assert.equal(row.budget_origin_id,old);assert.equal(row.actual_twd_amount,777);
   await admin('update actual_expenses set budget_item_id=null where id=$1',[id]);row=await record(id,'actual');assert.equal(row.budget_origin_id,old);
   await admin('update actual_expenses set budget_item_id=$2 where id=$1',[id,next]);row=await record(id,'actual');assert.equal(row.budget_origin_id,next,'legacy trigger actually overwrites old historical origin');
  }finally{await admin('rollback');}
 });
 await test('Source baseline: generated detach changes provenance and leaves the original backlink unsupported',async()=>{
  const {id,aid}=await p.paid();await admin('begin');try{const before=await record(aid,'actual');assert.equal(before.payment_origin,'budget_toggle');await admin('update actual_expenses set budget_item_id=null where id=$1',[aid]);const after=await record(aid,'actual');assert.equal(after.budget_origin_id,id);assert.equal(after.payment_origin,'manual');assert.equal((await record(id)).auto_created_actual_expense_id,aid);assert.equal((await admin("select app_private.budget_payment_targets('budget',$1) v",[id]))[0].v,null);assert.equal(after.actual_twd_amount,before.actual_twd_amount);}finally{await admin('rollback');}
 });
 await test('Source baseline: Budget delete SET NULL retains Actual identity origin known debit and receipt target',async()=>{
  const id=await fixture(),aid=uuid(),receipt=uuid();await admin('begin');try{await admin("insert into actual_expenses(id,trip_id,budget_item_id,title,amount,twd_amount,currency,exchange_rate,payer_id,payment_origin,twd_amount_source,actual_twd_amount) values($1,$2,$3,'manual linked',900,777,'JPY',0.2,$4,'manual','actual',777)",[aid,trip,id,actorA]);await admin("insert into attachments(id,trip_id,target_type,target_id,file_name,file_url,file_type,file_size,uploaded_by) values($1,$2,'actual_expense',$3,'keep','keep','image/png',1,$4)",[receipt,trip,aid,actorA]);await admin('delete from budget_items where id=$1',[id]);const row=await record(aid,'actual');assert.equal(row.budget_item_id,null);assert.equal(row.budget_origin_id,id);assert.equal(row.actual_twd_amount,777);assert.equal((await admin('select target_id from attachments where id=$1',[receipt]))[0].target_id,aid);}finally{await admin('rollback');}
 });
}
