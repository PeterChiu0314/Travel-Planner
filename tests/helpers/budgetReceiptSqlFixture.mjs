import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

// ADMIN fixture setup only: these suites contain storage.objects rows, NOT
// HTTP bytes. Simulates a trusted verifier result so older DB-only scenarios
// still exercise their metadata/lease/rollback contracts under the B7 gate.
// Real content validation is tested separately; never count this as HTTP QA.
export async function attestReceiptSqlFixture(admin,request){
 const rows=await admin("select i.*,o.id stored_object from app_private.budget_receipt_intents i join storage.objects o on o.bucket_id='trip-attachments' and o.name=i.object_path where i.request_id=$1 and i.status='pending' and i.action<>'delete' and (o.metadata->>'size')::bigint=i.file_size and o.metadata->>'mimetype'=i.file_type",[request]);
 if(!rows.length)return;const i=rows[0],token=randomUUID();
 await admin("update app_private.budget_receipt_intents set object_id=$2,verification_token=$3,verification_until=clock_timestamp()+interval '2 minutes' where request_id=$1",[request,i.stored_object,token]);
 await admin('set role budget_receipt_worker');try{assert.equal((await admin('select public.finish_budget_receipt_verification($1,$2,$3,$4,$5,$6,null) ok',[request,token,i.stored_object,i.digest,i.file_size,i.file_type]))[0].ok,true);}finally{await admin('reset role');}
}
