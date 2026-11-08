// Payment allocation is independent of participant liability. Order is persisted.
export function payerForm(item){return {mode:item.payment_mode||(item.payer_id?'advance':'self'),rows:structuredClone(item.payer_allocations?.length?item.payer_allocations:item.payer_id?[{user_id:item.payer_id,amount:Math.round(Number((item.budget||item.paid)?.amount||0)),order:0}]:[]),sequence:Number(item.payer_sequence||0)};}
export function reconcilePayers(form,total,editedId){
 const target=Math.max(0,Math.round(Number(total)||0)),rows=form.rows.map(r=>({...r}));let sequence=Number(form.sequence||0);
 if(editedId){sequence++;const row=rows.find(r=>r.user_id===editedId);if(row)row.order=sequence;}
 for(const row of rows){if(row.amount===''||row.amount===null)return {...form,rows,sequence};row.amount=Math.min(target,Math.max(0,Math.round(Number(row.amount)||0)));}
 let delta=target-rows.reduce((n,r)=>n+r.amount,0);
 const ordered=rows.map((r,index)=>({r,index})).sort((a,b)=>(a.r.user_id===editedId)-(b.r.user_id===editedId)||(a.r.order||0)-(b.r.order||0)||a.index-b.index);
 if(delta>0&&ordered.length){ordered[0].r.amount+=delta;delta=0;}
 for(const {r} of ordered){if(delta>=0)break;const cut=Math.min(r.amount,-delta);r.amount-=cut;delta+=cut;}
 return {...form,rows,sequence};
}
export function validPayers(form,members){return ['self','advance'].includes(form?.mode)&&Array.isArray(form.rows)&&(form.mode==='self'||form.rows.length>0)&&new Set(form.rows.map(r=>r.user_id)).size===form.rows.length&&form.rows.every(r=>members.some(m=>m.user_id===r.user_id&&m.status==='approved')&&r.amount!==''&&r.amount!==null&&Number.isFinite(Number(r.amount))&&Number(r.amount)>=0&&Number.isInteger(Number(r.amount))&&Number.isSafeInteger(r.order)&&r.order>=0)&&Number.isSafeInteger(form.sequence)&&form.sequence>=0;}
export function paymentCredits(item){
 if(item.payment_mode==='self')return [];
 const bundle=item.paid,rows=item.payer_allocations?.length?item.payer_allocations:item.payer_id?[{user_id:item.payer_id,amount:bundle?.amount||0}]:[];
 if(!bundle||!rows.length)return [];
 const total=Number(bundle.twd_amount),weight=rows.reduce((n,r)=>n+Number(r.amount),0);let assigned=0;
 if(rows.some(r=>!r.user_id||r.amount==null||r.amount===''||!Number.isFinite(Number(r.amount))||Number(r.amount)<0)
  ||new Set(rows.map(r=>r.user_id)).size!==rows.length||total>0&&weight<=0
  ||item.planning_managed&&item.payer_allocations?.length&&weight!==Math.round(Number(bundle.amount))
    &&weight!==Math.round(Number(item.budget?.amount)))return [];
 return rows.map((r,index)=>{const twd_amount=index===rows.length-1?total-assigned:weight?Math.floor(total*Number(r.amount)/weight):0;assigned+=twd_amount;return{user_id:r.user_id,amount:Number(r.amount),twd_amount};});
}
