// Isolated request coordinator. send MUST be an authoritative transactional
// transport with server lease/version/RLS checks; this grants no authority.
export function createExpenseCommandQueue({send,validateReceipt,makeId=()=>crypto.randomUUID()}) {
  if(typeof validateReceipt!=='function')throw new Error('Authoritative receipt validator required');
  let pending=null,work=null,lastError=null;
  const run=()=>{
    if(work)return work;if(!pending)return Promise.resolve(false);
    const request=pending;
    work=(async()=>{try{
      const result=await send(structuredClone(request));
      if(result?.error){lastError=result.error;return false;}
      if(result?.request_id!==request.request_id||result?.expense_id!==request.expense_id||!validateReceipt(result,request)){lastError={message:'Unconfirmed receipt'};return false;}
      pending=null;lastError=null;return result;
    }catch(error){lastError=error;return false;}})().finally(()=>{work=null;});return work;
  };
  return {submit(command){if(pending)throw new Error('Confirm the original request before another command');pending={...structuredClone(command),request_id:makeId()};return run();},
    retry:run,status:()=>({pending:pending?structuredClone(pending):null,busy:Boolean(work),error:lastError})};
}
