import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {createExpenseRates} from '../../lib/expenseRates.js';
export default function ExpenseRates({service,client,actor,trip,sessionId,storage,onError,services,editable}){
 const controller=useMemo(()=>createExpenseRates({service,actor,trip,sessionId,storage,onError,getGraph:()=>client.status().graph,refresh:()=>client.refresh()}),[service,actor,trip,sessionId,storage,onError,client]);
 const version=useSyncExternalStore(controller.subscribe,controller.getVersion),state=controller.status(),graph=client.status().graph;
 useEffect(()=>{const detach=controller.attach(),timer=setInterval(()=>{if(controller.status().pending)void controller.retry();},5000);return()=>{clearInterval(timer);detach();};},[controller]);
 services.useGuard(`expense-rates:${actor}:${trip}`,useMemo(()=>({isActive:true,isDirty:state.pending||state.busy,prepare:()=>controller.finish(),finish:()=>controller.finish(),save:()=>controller.finish(),discard:()=>controller.finish()}),[controller,version,state.pending,state.busy]));
 return <div className="bw-rates"><span title={graph.rates?.source}>{graph.rates?.quoted_at?`匯率 · ${new Date(graph.rates.quoted_at).toLocaleDateString()}`:'尚未取得旅程匯率'}</span><button type="button" className="ghost-button compact" disabled={!editable||state.busy||graph.rateState?.held&&!state.pending} onClick={async()=>{if(await services.handoff({tripId:trip,excludeIds:[`expense-rates:${actor}:${trip}`]}))void controller.update();}}>{state.busy?'更新中…':'更新匯率'}</button></div>;
}
