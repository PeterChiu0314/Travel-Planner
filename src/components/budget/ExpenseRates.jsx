import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {createExpenseRates} from '../../lib/expenseRates.js';
import {TripRatesSummary} from './BudgetWorkspace.jsx';
export default function ExpenseRates({service,client,actor,trip,sessionId,storage,onError,services,editable}){
 const controller=useMemo(()=>createExpenseRates({service,actor,trip,sessionId,storage,onError,quote:service.quote,getGraph:()=>client.status().graph,refresh:()=>client.refresh()}),[service,actor,trip,sessionId,storage,onError,client]);
 const version=useSyncExternalStore(controller.subscribe,controller.getVersion),state=controller.status(),graph=client.status().graph;
 useEffect(()=>{const detach=controller.attach(),timer=setInterval(()=>{if(controller.status().pending)void controller.retry();},5000);return()=>{clearInterval(timer);detach();};},[controller]);
 services.useGuard(`expense-rates:${actor}:${trip}`,useMemo(()=>({isActive:true,isDirty:state.pending||state.busy,prepare:()=>controller.finish(),finish:()=>controller.finish(),save:()=>controller.finish(),discard:()=>controller.finish()}),[controller,version,state.pending,state.busy]));
 return <TripRatesSummary tripRates={graph.rates} ratesBusy={state.busy} canRefreshRates={editable&&(!graph.rateState?.held||state.pending)} onRefreshRates={async()=>{if(await services.handoff({tripId:trip,excludeIds:[`expense-rates:${actor}:${trip}`]}))void controller.update();}}/>;
}
