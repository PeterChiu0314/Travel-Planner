import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {randomUUID as uuid} from 'node:crypto';
import {backend,boot} from './formalBudgetMock.js';import {enableMetadata} from './budgetMetadataMock.js';
export {boot,enableMetadata};
export async function expenseBackend(){
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),sql=new PGlite(),db=backend({leases:true}),original=db.request.bind(db);
 const trip=uuid(),A=uuid(),B=uuid();db.trips.splice(0,db.trips.length,{...db.trips[0],id:trip,owner_id:A});db.members.splice(0,db.members.length,{trip_id:trip,user_id:A,display_name:'A',email:'a@qa.invalid',status:'approved',role:'owner'},{trip_id:trip,user_id:B,display_name:'B',email:'b@qa.invalid',status:'approved',role:'editor'});
 db.rows.budget_items=[];db.rows.actual_expenses=[];db.rows.budget_item_participants=[];db.rows.actual_expense_participants=[];db.rows.itinerary_budget_items=[];db.rows.itinerary_items=[];db.rows.attachments=[];
 await sql.exec(`create role anon;create role authenticated;create schema auth;create schema app_private;create table public.trips(id uuid primary key,budget_exchange_rates jsonb default '{}');create table public.trip_members(trip_id uuid,user_id uuid,display_name text,email text,status text,role text);create table public.itinerary_items(id uuid primary key,trip_id uuid,title text,day_index int);create table public.accommodations(id uuid,trip_id uuid,expense_id uuid);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function app_private.can_read_trip(t uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.trip_members where trip_id=t and user_id=a and status='approved')$$;
 create function app_private.can_edit_trip(t uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.trip_members where trip_id=t and user_id=a and status='approved' and role in('owner','editor'))$$;
 grant usage on schema auth,app_private to authenticated;grant execute on function auth.uid(),app_private.can_read_trip(uuid,uuid) to authenticated;`);
 await sql.query('insert into public.trips(id,budget_exchange_rates) values($1,$2)',[trip,db.trips[0].budget_exchange_rates]);
 for(const m of db.members)await sql.query('insert into public.trip_members values($1,$2,$3,$4,$5,$6)',[m.trip_id,m.user_id,m.display_name,m.email,m.status,m.role]);
 for(const file of ['isolated-schema.sql','isolated-rpc.sql','public-api.sql','rates.sql'])await sql.exec(await fs.readFile(new URL('../../docs/operations/issue18/'+file,import.meta.url),'utf8'));
 await sql.exec(await fs.readFile(new URL('../../supabase/migrations/20261105132450_issue18_precise_lease_release.sql',import.meta.url),'utf8'));
 let chain=Promise.resolve();db.expenseCalls=[];db.dropAck=false;
 const signatures={read_expense_snapshot:['p_trip_id','p_session_id'],expense_group_lease:['p_id','p_group','p_session_id','p_token','p_action','p_base','p_epoch','p_seq','p_dirty'],mutate_expense_group:['p_id','p_group','p_session_id','p_token','p_epoch','p_base','p_value','p_request_id'],create_expense_item:['p_trip_id','p_id','p_session_id','p_request_id','p_view']};
 db.request=async req=>{if(req.op!=='rpc'||!signatures[req.name])return original(req);const run=async()=>{db.expenseCalls.push(structuredClone(req));try{
  await sql.exec('reset role');await sql.query("select set_config('test.actor',$1,false)",[req.actor]);await sql.exec('set role authenticated');const keys=signatures[req.name];const args=keys.map(k=>req.args[k]??(k==='p_seq'?0:k==='p_dirty'?false:null));
  const r=(await sql.query(`select public.${req.name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) d`,args)).rows[0].d;
  if(db.dropAck&&req.name==='mutate_expense_group'){db.dropAck=false;return{error:{message:'ACK lost'}};}return{data:r};
 }catch(error){return{error:{code:error.code,message:error.message}};}};const work=chain.then(run);chain=work.then(()=>{});return work;};
 return {db,sql,trip,A,B,async snapshot(){return(await db.request({op:'rpc',name:'read_expense_snapshot',args:{p_trip_id:trip,p_session_id:uuid()},actor:A})).data;},async close(){await chain;await sql.close();}};
}
