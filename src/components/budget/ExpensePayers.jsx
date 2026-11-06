import {Plus,X} from 'lucide-react';
import MenuSelect from '../MenuSelect.jsx';
import {memberLabel,money} from '../../lib/budgetFinance.js';
import {reconcilePayers} from '../../lib/expensePayers.js';
export default function ExpensePayers({client,field,view,members,total,currency,locked,canChooseMode}){
 const form=view.value;
 const change=next=>client.input(field,next);
 async function mode(value){if(!await client.focus(field))return;const current=client.view(field).value;let rows=current.rows;if(value==='advance'&&!rows.length&&members.length)rows=[{user_id:members[0].user_id,amount:0,order:0}];if(value==='self'&&rows.some(r=>r.amount===''))rows=field.canonical.rows;change(reconcilePayers({...current,mode:value,rows},total));}
 function update(index,key,value){const rows=form.rows.map((r,i)=>i===index?{...r,[key]:value}:r);change(reconcilePayers({...form,rows},total,key==='amount'&&value!==''?rows[index].user_id:undefined));}
 return <div className="bw-payers"><div className="bw-pricing-modes" role="group" aria-label="付款方式選擇">{[['self','各自付'],['advance','代付']].map(([value,label])=><button type="button" key={value} aria-pressed={form.mode===value} disabled={!canChooseMode} onClick={()=>void mode(value)}>{label}</button>)}</div>
 {form.mode==='advance'?<><div className="bw-payer-labels"><span>付款人</span><span>代付金額 · {currency}</span></div>{form.rows.map((row,index)=><div className="bw-payer-row" key={index}>
 <MenuSelect label={`付款人 ${index+1}`} value={row.user_id} readOnly={locked} metadataPortal onValueChange={value=>update(index,'user_id',value)} options={[{value:'',label:'選擇付款人'},...members.filter(m=>!form.rows.some((r,i)=>i!==index&&r.user_id===m.user_id)).map(m=>({value:m.user_id,label:memberLabel(m)}))]}/>
 <input aria-label={`代付金額 ${index+1}`} type="number" min="0" step="1" readOnly={locked} value={row.amount} onChange={e=>update(index,'amount',e.target.value)}/><button type="button" className="bw-icon" aria-label={`移除付款人 ${index+1}`} disabled={locked} onClick={()=>change(reconcilePayers({...form,rows:form.rows.filter((_,i)=>i!==index)},total))}><X size={15}/></button></div>)}
 <button type="button" className="ghost-button compact" disabled={locked||form.rows.length>=members.length} onClick={()=>{const member=members.find(m=>!form.rows.some(r=>r.user_id===m.user_id));if(member)change(reconcilePayers({...form,rows:[...form.rows,{user_id:member.user_id,amount:0,order:0}]},total));}}><Plus size={14}/>新增付款人</button>
 <div className="bw-stat-line"><span>代付合計 · {currency}</span><b>{form.rows.some(r=>r.amount==='')?'—':money(form.rows.reduce((n,r)=>n+Number(r.amount),0))}</b></div><p className="bw-muted">結算時依各人負擔與代付金額計算。</p></>:<p className="bw-muted">各人自行支付自己的負擔，不產生彼此轉帳。</p>}</div>;
}
