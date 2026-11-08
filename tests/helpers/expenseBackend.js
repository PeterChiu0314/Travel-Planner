import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {randomUUID as uuid} from 'node:crypto';
import {backend,boot} from './formalBudgetMock.js';import {enableMetadata} from './budgetMetadataMock.js';
import {nativeBootstrap} from './b7-native-bootstrap.mjs';
export {boot,enableMetadata};
export async function installTimelineFixture(sql,trip,actor,members,{legacyBudget=false}={}){
 await sql.exec(nativeBootstrap);
 const dir=new URL('../../supabase/migrations/',import.meta.url);
 for(const name of (await fs.readdir(dir)).filter(name=>name.endsWith('.sql')).sort()){
  if (legacyBudget && name.includes('issue23_retire_legacy_budget')) break;
  let body=(await fs.readFile(new URL(name,dir),'utf8')).replace(/create extension if not exists pgcrypto;/ig,'');
  // Hosted inventory and historical import do not apply to an empty fixture.
  if(name.includes('issue18_single_expense'))body=body.replace(/-- preflight\.sql[\s\S]*?(?=-- isolated-schema\.sql)/,'').replace(/-- import-actual\.sql[\s\S]*?(?=-- retire-old-writes\.sql)/,'');
  await sql.exec(body);
 }
 await sql.query('insert into auth.users(id) select unnest($1::uuid[])',[members.map(member=>member.user_id)]);
 await sql.query('insert into public.trips(id,title,name,destination,owner_id,start_date,end_date,budget_exchange_rates) values($1,$2,$2,$3,$4,$5,$6,$7)',[trip.id,trip.title,trip.destination,actor,trip.start_date,trip.end_date,trip.budget_exchange_rates]);
 for(const member of members)await sql.query('insert into public.trip_members(trip_id,user_id,display_name,email,status,role) values($1,$2,$3,$4,$5,$6) on conflict(trip_id,user_id) do update set display_name=excluded.display_name,email=excluded.email',[trip.id,member.user_id,member.display_name,member.email,member.status,member.role]);
}
export async function expenseBackend({timeline=false,legacyBudget=false,wholePlanning=true}={}){
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),sql=new PGlite(),db=backend({leases:true}),original=db.request.bind(db);
 const trip=uuid(),A=uuid(),B=uuid();db.trips.splice(0,db.trips.length,{...db.trips[0],id:trip,owner_id:A});db.members.splice(0,db.members.length,{trip_id:trip,user_id:A,display_name:'A',email:'a@qa.invalid',status:'approved',role:'owner'},{trip_id:trip,user_id:B,display_name:'B',email:'b@qa.invalid',status:'approved',role:'editor'});
 db.rows.budget_items=[];db.rows.actual_expenses=[];db.rows.budget_item_participants=[];db.rows.actual_expense_participants=[];db.rows.itinerary_budget_items=[];db.rows.itinerary_items=[];db.rows.attachments=[];
 if(timeline)await installTimelineFixture(sql,db.trips[0],A,db.members,{legacyBudget});
 else{
 await sql.exec(`create role anon;create role authenticated;create schema auth;create schema app_private;create table public.trips(id uuid primary key,budget_exchange_rates jsonb default '{}',start_date date,end_date date,status text not null default 'planning');create table public.trip_members(trip_id uuid,user_id uuid,display_name text,email text,status text,role text);create table public.itinerary_items(id uuid primary key,trip_id uuid,title text,day_index int,updated_at timestamptz);create table public.accommodations(id uuid,trip_id uuid,expense_id uuid);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function app_private.can_read_trip(t uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.trip_members where trip_id=t and user_id=a and status='approved')$$;
 create function app_private.can_edit_trip(t uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.trip_members where trip_id=t and user_id=a and status='approved' and role in('owner','editor'))$$;
 grant usage on schema auth,app_private to authenticated;grant execute on function auth.uid(),app_private.can_read_trip(uuid,uuid) to authenticated;`);
 const active=db.trips[0];
 await sql.query('insert into public.trips(id,budget_exchange_rates,start_date,end_date,status) values($1,$2,$3,$4,$5)',[trip,active.budget_exchange_rates,active.start_date,active.end_date,active.status]);
 for(const m of db.members)await sql.query('insert into public.trip_members values($1,$2,$3,$4,$5,$6)',[m.trip_id,m.user_id,m.display_name,m.email,m.status,m.role]);
 for(const file of ['isolated-schema.sql','isolated-rpc.sql','public-api.sql','rates.sql'])await sql.exec(await fs.readFile(new URL('../../docs/operations/issue18/'+file,import.meta.url),'utf8'));
 await sql.exec(await fs.readFile(new URL('../../supabase/migrations/20261105132450_issue18_precise_lease_release.sql',import.meta.url),'utf8'));
 await sql.exec(await fs.readFile(new URL('../../supabase/migrations/20261106055836_expense_field_lease_ttl.sql',import.meta.url),'utf8'));
 await sql.exec((await fs.readFile(new URL('../../docs/operations/issue18/realtime.sql',import.meta.url),'utf8')).replace('alter publication supabase_realtime add table public.expense_signals;',''));
 await sql.exec(await fs.readFile(new URL('../../supabase/migrations/20261105142122_issue18_selection_collaboration.sql',import.meta.url),'utf8'));
 await sql.exec(await fs.readFile(new URL('../../supabase/migrations/20261105150453_issue19_named_expense_create.sql',import.meta.url),'utf8'));
 await sql.exec(await fs.readFile(new URL('../../supabase/migrations/20261106120016_issue21_payment_allocations.sql',import.meta.url),'utf8'));
 if(wholePlanning){
  const links=await fs.readFile(new URL('../../supabase/migrations/20261106181006_timeline_expense_link_integrity.sql',import.meta.url),'utf8');
  await sql.exec(links.slice(links.indexOf('create function expense_stage_b.validate_link_targets'),links.indexOf('-- Only fresh link mutations')));
  await sql.exec(await fs.readFile(new URL('../../supabase/migrations/20261107140000_issue25_whole_planning_pricing.sql',import.meta.url),'utf8'));
 }
 }
 let chain=Promise.resolve();db.expenseCalls=[];db.dropAck=false;
 const signatures={create_named_expense_item:['p_trip_id','p_id','p_session_id','p_request_id','p_title'],expense_rates_lease:['p_trip_id','p_session_id','p_token','p_action','p_base','p_epoch'],update_expense_rates:['p_trip_id','p_session_id','p_token','p_epoch','p_base','p_value','p_request_id'],read_expense_snapshot:['p_trip_id','p_session_id'],read_expense_collaboration:['p_trip_id','p_session_id'],update_expense_selection:['p_trip_id','p_session_id','p_kind','p_id','p_activity_id','p_action'],expense_group_lease:['p_id','p_group','p_session_id','p_token','p_action','p_base','p_epoch','p_seq','p_dirty'],mutate_expense_group:['p_id','p_group','p_session_id','p_token','p_epoch','p_base','p_value','p_request_id'],create_expense_item:['p_trip_id','p_id','p_session_id','p_request_id','p_view']};
 if(timeline)Object.assign(signatures,{
  apply_timeline_schedule_operation:['target_trip_id','target_day_index','target_item_id','target_payload','operation_intent','expected_visit_ids','item_updated_at_baselines','confirmed_major_effect','preview_result','slot_item_ids','package_source_item_ids'],
  apply_trip_date_change:['trip_id','new_start_date','new_end_date','confirm_timeline_removal'],
  delete_trip_with_expenses:['p_trip_id'],
  delete_itinerary_item_budget_safe:['p_trip_id','p_id'],
  assign_luggage_item:['p_trip_id','p_scope','p_item_id','p_expected_updated_at','p_assigned_to'],
  privatize_luggage_item:['p_trip_id','p_item_id','p_expected_updated_at','p_category'],
 });
 if(timeline)signatures.apply_timeline_schedule_operation_link_safe=signatures.apply_timeline_schedule_operation;
 const syncItinerary=async()=>{db.rows.itinerary_items=(await sql.query('select * from public.itinerary_items')).rows;};
 const syncLuggage=async()=>{
  db.rows.luggage_items=(await sql.query('select to_jsonb(item) as value from public.luggage_items item')).rows.map(row=>row.value);
  db.rows.shared_luggage_items=(await sql.query('select to_jsonb(item) as value from public.shared_luggage_items item')).rows.map(row=>row.value);
 };
 db.request=async req=>{
  const memberWrite=timeline&&req.table==='trip_members'&&(req.deleting||req.patch?.status==='approved');
  if(!memberWrite&&(req.op!=='rpc'||!signatures[req.name]))return original(req);
  if(db.offline)return{error:{message:'offline'}};const run=async()=>{db.expenseCalls.push(structuredClone(req));try{
  await sql.exec('reset role');await sql.query('select set_config($1,$2,false)',[timeline?'request.jwt.claim.sub':'test.actor',req.actor]);await sql.exec('set role authenticated');
  if(memberWrite){
   const {id,trip_id}=Object.fromEntries(req.filters);
   const command=req.deleting?'delete from public.trip_members':"update public.trip_members set status='approved'";
   const {rows}=await sql.query(`${command} where id=$1 and trip_id=$2 returning *`,[id,trip_id]);
   for(const row of rows){
    const index=db.members.findIndex(member=>member.user_id===row.user_id&&member.trip_id===row.trip_id);
    db.members.splice(index,1,...(req.deleting?[]:[row]));
    await db.emit('trip_members',{eventType:req.deleting?'DELETE':'UPDATE',new:req.deleting?{}:row,old:req.deleting?row:{}});
    await db.emit('expense_signals',{eventType:'UPDATE',new:{trip_id}});
   }
   return {data:rows,error:null};
  }
  const keys=signatures[req.name];const args=keys.map(k=>req.args[k]??(k==='p_seq'?0:k==='p_dirty'?false:null));
  const r=(await sql.query(`select public.${req.name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) d`,args)).rows[0].d;
  if(req.name.startsWith('apply_timeline_schedule_operation')||req.name==='apply_trip_date_change'||req.name==='delete_itinerary_item_budget_safe')await syncItinerary();
  else if(req.name==='delete_trip_with_expenses'){
   db.trips.splice(0,db.trips.length,...db.trips.filter(t=>t.id!==r));
   db.members.splice(0,db.members.length,...db.members.filter(m=>m.trip_id!==r));
  }
  else if(req.name==='assign_luggage_item'||req.name==='privatize_luggage_item')await syncLuggage();
  else if(!req.name.startsWith('read_'))await db.emit('expense_signals',{eventType:'UPDATE',new:{trip_id:trip}}).catch(()=>{});
  if(db.dropAck&&(req.name==='mutate_expense_group'||req.name==='create_named_expense_item')){db.dropAck=false;return{error:{message:'ACK lost'}};}return{data:r};
 }catch(error){return{error:{code:error.code,message:error.message}};}};const work=chain.then(run);chain=work.then(()=>{});return work;};
 return {db,sql,trip,A,B,syncItinerary,syncLuggage,async snapshot(){return(await db.request({op:'rpc',name:'read_expense_snapshot',args:{p_trip_id:trip,p_session_id:uuid()},actor:A})).data;},async close(){await chain;await sql.close();}};
}
