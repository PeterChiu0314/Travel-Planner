import assert from 'node:assert/strict';
import {ok} from './staging-budget-acceptance-http.mjs';

// All writes use normal account permissions. Owners cannot INSERT another
// account's membership: that account requests pending membership first.
export async function ensureQaEditor({http,sessions,trip}){
 const [owner,editor]=sessions,route=`/rest/v1/trip_members?trip_id=eq.${trip}&user_id=eq.${editor.user.id}`;
 const existing=ok(await http(owner.access_token,route+'&select=user_id,role,status'));
 assert(existing.length<=1);
 if(!existing.length)ok(await http(editor.access_token,'/rest/v1/trip_members',{method:'POST',prefer:'return=minimal',body:{trip_id:trip,user_id:editor.user.id,role:'editor',status:'pending',display_name:'QA Editor'}}));
 else assert.equal(existing[0].role,'editor','Unexpected QA member role');
 const approved=ok(await http(owner.access_token,route,{method:'PATCH',body:{status:'approved'}}));
 assert.equal(approved.length,1);assert.equal(approved[0].role,'editor');assert.equal(approved[0].status,'approved');
 const visible=ok(await http(editor.access_token,`/rest/v1/trips?id=eq.${trip}&select=id`));assert.deepEqual(visible,[{id:trip}]);
}

export async function assertOwnedQaTrip({http,session,trip,name,allowedUserIds}){
 const read=async(table,filter)=>ok(await http(session.access_token,`/rest/v1/${table}?${filter}`));
 const rows=await read('trips',`id=eq.${trip}&select=id,title,name,owner_id,start_date,end_date`);
 assert.deepEqual(rows,[{id:trip,title:name,name,owner_id:session.user.id,start_date:'2099-01-01',end_date:'2099-01-03'}],'Resume only the exact confirmed empty QA trip');
 const members=await read('trip_members',`trip_id=eq.${trip}&select=user_id,role,status`);
 assert(members.some(m=>m.user_id===session.user.id&&m.role==='owner'&&m.status==='approved'));
 assert(members.every(m=>allowedUserIds.includes(m.user_id)),'Unexpected member in retained QA scope');
 return members;
}
export async function assertEmptyOwnedQaTrip(args){
 const members=await assertOwnedQaTrip(args),{http,session,trip}=args;
 const read=async(table,filter)=>ok(await http(session.access_token,`/rest/v1/${table}?${filter}`));
 for(const table of ['budget_items','actual_expenses','itinerary_items','accommodations','attachments'])assert.deepEqual(await read(table,`trip_id=eq.${trip}&select=trip_id`),[],`Never replay provisioning over existing ${table}`);
 // Normal trip creation already creates an empty planning Baseline. Retain it;
 // a populated financial Baseline is not an empty fixture and must stop replay.
 const baselines=await read('trip_budget_baselines',`trip_id=eq.${trip}&select=payload`);assert(baselines.length<=1);
 for(const baseline of baselines)assert.deepEqual(baseline.payload?.items,[],'Retained QA Baseline must contain no historical Budget');
 return members;
}
