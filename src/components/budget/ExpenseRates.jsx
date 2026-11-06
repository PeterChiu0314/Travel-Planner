import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {createExpenseRates,hasExpenseRates} from '../../lib/expenseRates.js';
import {TripRatesSummary} from './BudgetWorkspace.jsx';
export default function ExpenseRates({service,client,actor,trip,sessionId,storage,onError,services,editable,planning,active}){
 const eligible=useRef(false),attempted=useRef(null);eligible.current=editable&&planning&&active;
 const controller=useMemo(()=>createExpenseRates({service,actor,trip,sessionId,storage,onError,canUpdate:()=>eligible.current,quote:service.quote,getGraph:()=>client.status().graph,refresh:()=>client.refresh()}),[service,actor,trip,sessionId,storage,onError,client]);
 const version=useSyncExternalStore(controller.subscribe,controller.getVersion),state=controller.status(),graph=client.status().graph;
 useEffect(()=>{const detach=controller.attach(),timer=setInterval(()=>{if(controller.status().pending)void controller.retry();},5000);return()=>{clearInterval(timer);detach();};},[controller]);
 useEffect(()=>{const key=actor+':'+trip;if(eligible.current&&!hasExpenseRates(graph.rates)&&!graph.rateState?.held&&!state.pending&&!state.busy&&!client.status().dirty&&attempted.current!==key){attempted.current=key;void controller.update({initialize:true});}},[actor,trip,controller,client,editable,planning,active,graph,state.pending,state.busy]);
 services.useGuard(`expense-rates:${actor}:${trip}`,useMemo(()=>({isActive:true,isDirty:state.pending||state.busy,prepare:()=>controller.finish(),finish:()=>controller.finish(),save:()=>controller.finish(),discard:()=>controller.finish()}),[controller,version,state.pending,state.busy]));
 return <TripRatesSummary tripRates={graph.rates} ratesBusy={state.busy} canRefreshRates={eligible.current&&(!graph.rateState?.held||state.pending)} onRefreshRates={async()=>{if(eligible.current&&await services.handoff({tripId:trip,excludeIds:[`expense-rates:${actor}:${trip}`]}))void controller.update();}}/>;
}
