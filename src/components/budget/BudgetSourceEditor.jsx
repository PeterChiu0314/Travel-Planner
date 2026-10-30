import {Fragment,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import MenuSelect from '../MenuSelect.jsx';
import {useSiteDialog} from '../SiteDialog.jsx';
import {memberLabel} from '../../lib/budgetFinance.js';

function changes(p,members) {
 const label={budget_item_id:'來源關聯',title:'項目名稱',category:'分類',note:'備註',payer_id:'付款人',amount:'金額',unit_amount:'每人單價',currency:'幣別',exchange_rate:'匯率',twd_amount:'台幣合計',pricing_mode:'計價方式',split_type:'分攤方式'};
 const value=(k,v)=>k==='payer_id'?(v?memberLabel(members.find(m=>m.user_id===v)):'未指定'):v??'未填';
 const result=Object.entries(label).filter(([k])=>k!=='budget_item_id'&&JSON.stringify(p.before[k]??null)!==JSON.stringify(p.after[k]??null)).map(([k,l])=>`${l}：${value(k,p.before[k])} → ${value(k,p.after[k])}`);
 if(JSON.stringify(p.people_before)!==JSON.stringify(p.people_after)) {
  const people=rows=>rows.map(p=>`${memberLabel(members.find(m=>m.user_id===p.user_id))}${p.share_amount==null?'':` ${p.share_amount}`}`).join('、')||'無';
  result.push(`參與成員／分攤：${people(p.people_before)} → ${people(p.people_after)}`);
 }
 return result;
}
export default function BudgetSourceEditor({client,metadata,record,members,services}) {
 useSyncExternalStore(client.subscribe,client.getVersion);
 const snapshot=metadata.status().snapshot,source=snapshot?.sourceRecords?.find(r=>r.id===record.id),state=client.view('actual',record.id);
 const [selection,setSelection]=useState(source?.value.budget_id||''),[edited,setEdited]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=useRef(0),{ask,dialog}=useSiteDialog();useEffect(()=>()=>{current.current++;},[]);
 useEffect(()=>{if(!edited&&!state.active)setSelection(source?.value.budget_id||'');},[source?.value.budget_id,edited,state.active]);
 const pending=busy||state.active;
 services.useGuard(`budget-source:${record.id}:${record.trip_id}`,useMemo(()=>({isActive:edited||pending,isDirty:edited||pending,
  prepare:async()=>!edited&&!busy&&await client.prepare(),save:async()=>false,discard:async()=>{if(busy||client.hasPending())return false;setEdited(false);setSelection(source?.value.budget_id||'');return true;}}),[edited,pending,busy,client,source?.value.budget_id]));
 const enabled=metadata.status().editable&&metadata.status().verified&&snapshot?.sourceProtocol?.enabled&&source?.supported;
 const owner=source?.held&&!source.own_session?memberLabel(members.find(m=>m.user_id===source.owner_id)):null;
 const title=id=>id?(snapshot?.budgetItems.find(b=>b.id===id)?.title||'已刪除的預算'):'無';
 async function run(action) {
  const generation=++current.current;setBusy(true);setError('');
  try {
   const intent={action,budget_id:selection||null},preview=await client.preview('actual',record.id,intent);if(generation!==current.current)return;
   if(preview.error)throw preview.error;const p=preview.data;
   if(action==='apply_source_data') {
    const lines=changes(p,members);const accepted=await ask({title:'套用來源資料？',message:<span>將使用「{title(p.budget_id)}」已儲存的資料。<br/>{lines.length?lines.map((line,i)=><Fragment key={i}>{line}<br/></Fragment>):'目前資料相同，不需更新。'}<br/>實付身分、付款時間、付款歷史與收據保持不變。</span>,confirmLabel:'確認套用'});
    if(!accepted||generation!==current.current)return;
   }
   if(await client.execute('actual',record.id,{...intent,versions:p.versions})&&generation===current.current)setEdited(false);
  }catch(e){if(generation===current.current)setError(e.message||'來源操作未完成，原資料已保留。');}
  finally{if(generation===current.current)setBusy(false);}
 }
 return <section className="bw-metadata-group" aria-label="來源關聯" aria-busy={pending}>{dialog}
  <h4>來源預算</h4><p className="bw-muted">目前來源：{title(source?.value.budget_id)}<br/>歷史來源：{title(source?.value.origin_id)}</p>
  <MenuSelect label="來源預算" value={selection} readOnly={!enabled||pending} options={[{value:'',label:'無來源（保留歷史資訊）'},...(snapshot?.budgetItems||[]).map(b=>({value:b.id,label:b.title||'未命名預算',disabled:b.is_fixed}))]}
   onValueChange={value=>{setSelection(value);setEdited(value!==(source?.value.budget_id||''));setError('');}}/>
  <p className="bw-muted">變更關聯只調整來源，金額、分攤、付款人與備註保持不變。</p>
  <div className="form-actions"><button className="ghost-button compact" type="button" disabled={!enabled||pending||Boolean(owner)} onClick={()=>void run('relink_only')}>變更來源關聯</button>
   <button className="ghost-button compact" type="button" disabled={!enabled||pending||!selection||Boolean(owner)} onClick={()=>void run('apply_source_data')}>預覽套用來源資料</button></div>
  {!enabled?<p className="bw-muted">來源協作尚未啟用或狀態尚未確認。</p>:null}
  {owner?<p className="bw-muted" role="status">{owner} 正在操作來源關聯</p>:null}
  {pending?<p role="status">{state.unknown?'來源結果待確認':state.syncPending?'已提交，最新同步待確認':'來源操作中…'}</p>:null}
  {error||state.error?<p role="alert" className="bw-warning">{error||state.error}</p>:null}
  {state.active&&!state.busy?<button type="button" className="ghost-button compact" onClick={()=>{const generation=current.current;void client.retry('actual',record.id).then(ok=>{if(ok&&generation===current.current)setEdited(false);});}}>{state.unknown?'確認來源結果':'重新確認來源狀態'}</button>:null}
 </section>;
}
