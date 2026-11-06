import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {randomUUID as uuid} from 'node:crypto';
import {expenseBackend} from './helpers/expenseBackend.js';
async function fixture(){const f=await expenseBackend();await f.sql.exec("alter table public.trips add column start_date date default '2099-01-01',add column end_date date default '2099-01-10',add column status text default 'planning';create table public.trip_budget_baselines(trip_id uuid,departure_at timestamptz);");await f.sql.exec(await fs.readFile(new URL('../supabase/migrations/20261106053231_rates_planning_initialization.sql',import.meta.url),'utf8'));return f;}
const lease=(f,sid=uuid(),token=uuid())=>f.db.request({op:'rpc',actor:f.A,name:'expense_rates_lease',args:{p_trip_id:f.trip,p_session_id:sid,p_token:token,p_action:'acquire',p_base:0,p_epoch:null}});
test('rates lease lasts one minute; acquired authority does not survive departure for a new write',async()=>{
 const f=await fixture();try{const sid=uuid(),token=uuid(),r=await lease(f,sid,token);assert(r.data.granted);await f.sql.exec('reset role');const secs=(await f.sql.query("select extract(epoch from expires_at-clock_timestamp()) secs from expense_stage_b.rate_leases where trip_id=$1",[f.trip])).rows[0].secs;assert(secs>55&&secs<=60);
 await f.sql.query("update public.trips set start_date=(clock_timestamp() at time zone 'Asia/Taipei')::date where id=$1",[f.trip]);const result=await f.db.request({op:'rpc',actor:f.A,name:'update_expense_rates',args:{p_trip_id:f.trip,p_session_id:sid,p_token:token,p_epoch:r.data.epoch,p_base:0,p_request_id:uuid(),p_value:{}}});assert.equal(result.error.code,'22023');
 }finally{await f.close();}
});
test('departed, settled, missing-date and frozen-baseline trips cannot acquire a rates lease',async()=>{
 for(const kind of ['departed','settled','missing','frozen']){const f=await fixture();try{if(kind==='departed')await f.sql.exec("update public.trips set start_date='2020-01-01'");if(kind==='settled')await f.sql.exec("update public.trips set status='settled'");if(kind==='missing')await f.sql.exec('update public.trips set start_date=null');if(kind==='frozen')await f.sql.query("insert into public.trip_budget_baselines values($1,'2020-01-01')",[f.trip]);assert.equal((await lease(f)).error.code,'22023');}finally{await f.close();}}
});
