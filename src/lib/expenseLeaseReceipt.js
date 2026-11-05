export function expenseReleaseReceipt(data,request){
 return data?.schemaVersion===1&&data.action==='release'&&data.id===request.p_id&&data.group===request.p_group
  &&data.session_id===request.p_session_id&&data.requested_epoch===request.p_epoch;
}
export function expenseReleaseSettled(data,request){
 return expenseReleaseReceipt(data,request)&&data.granted===true&&data.settled===true&&data.capability_active===false
  &&['released','inactive','superseded'].includes(data.outcome);
}
