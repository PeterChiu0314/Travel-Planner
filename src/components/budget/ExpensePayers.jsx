import {Plus,X} from 'lucide-react';
import MenuSelect from '../MenuSelect.jsx';
import {memberLabel} from '../../lib/budgetFinance.js';
import {reconcilePayers} from '../../lib/expensePayers.js';
import {useLayoutEffect,useRef} from 'react';
export default function ExpensePayers({client,field,view,members,total,currency,locked,canChooseMode}){
 const form=view.value,root=useRef(null),pendingFocus=useRef(null);
 useLayoutEffect(()=>{if(pendingFocus.current===null)return;const index=pendingFocus.current;pendingFocus.current=null;const inputs=root.current?.querySelectorAll('input[type="number"]');const target=inputs?.[Math.min(index,inputs.length-1)]||root.current?.closest('[role="group"]');target?.focus({preventScroll:true});},[form.rows]);
 const keepFocus=index=>{if(root.current?.contains(document.activeElement))pendingFocus.current=index;};
 const change=next=>client.input(field,next);
 async function mode(value){if(!await client.focus(field))return;const current=client.view(field).value;let rows=current.rows;if(value==='advance'&&!rows.length&&members.length)rows=[{user_id:members[0].user_id,amount:0,order:0}];if(value==='self'&&rows.some(r=>r.amount===''))rows=field.canonical.rows;change(reconcilePayers({...current,mode:value,rows},total));}
 function update(index,key,value){const rows=form.rows.map((r,i)=>i===index?{...r,[key]:value}:r);change(reconcilePayers({...form,rows},total,key==='amount'&&value!==''?rows[index].user_id:undefined));}
 async function claim(){return field.state==='held'&&client.view(field).editable||await client.focus(field);}
 async function add(){if(!await claim())return;const current=client.view(field).value,member=members.find(m=>!current.rows.some(r=>r.user_id===m.user_id));if(member){keepFocus(current.rows.length);change(reconcilePayers({...current,rows:[...current.rows,{user_id:member.user_id,amount:0,order:0}]},total));}}
 async function remove(userId){if(!await claim())return;const current=client.view(field).value;if(current.mode==='advance'&&current.rows.length<=1)return;keepFocus(Math.max(0,current.rows.findIndex(r=>r.user_id===userId)-1));change(reconcilePayers({...current,rows:current.rows.filter(r=>r.user_id!==userId)},total));}
 return <div className="bw-payers" ref={root}><div className="bw-pricing-modes" role="group" aria-label="付款方式選擇">{[['self','各自付'],['advance','代付']].map(([value,label])=><button type="button" key={value} aria-pressed={form.mode===value} disabled={!canChooseMode} onClick={()=>void mode(value)}>{label}</button>)}</div>
 {form.mode==='advance'?<><div className="bw-payer-labels"><span>付款人</span><span>代付金額 · {currency}</span></div>{form.rows.map((row,index)=><div className="bw-payer-row" key={index}>
 <MenuSelect label={`付款人 ${index+1}`} value={row.user_id} readOnly={locked} metadataPortal onValueChange={value=>update(index,'user_id',value)} options={[{value:'',label:'選擇付款人'},...members.filter(m=>!form.rows.some((r,i)=>i!==index&&r.user_id===m.user_id)).map(m=>({value:m.user_id,label:memberLabel(m)}))]}/>
 <input aria-label={`代付金額 ${index+1}`} type="number" min="0" step="1" readOnly={locked} value={row.amount} onChange={e=>update(index,'amount',e.target.value)}/><button type="button" className="bw-icon" aria-label={`移除付款人 ${index+1}`} disabled={form.rows.length<=1||!canChooseMode&&locked} onClick={()=>void remove(row.user_id)}><X size={15}/></button></div>)}
 <button type="button" className="ghost-button compact" disabled={(!canChooseMode&&locked)||form.rows.length>=members.length} onClick={()=>void add()}><Plus size={14}/>新增付款人</button>
 <p className="bw-muted">結算時依各人負擔與代付金額計算。</p></>:<p className="bw-muted">各人自行支付自己的負擔，不產生彼此轉帳。</p>}</div>;
}
