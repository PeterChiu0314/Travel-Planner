import {supabase} from "../../src/lib/supabase.js";
import "./live-budget.css";
const node=id=>document.getElementById(id),sessionId=crypto.randomUUID();
let channel=null,serial=0;
const log=value=>{node("results").textContent+=`${JSON.stringify({step:++serial,...value})}\n`;};
async function identity(){const result=await supabase.auth.getSession();const user=result.data.session?.user;node("identity").textContent=user?`登入使用者：${user.id}`:"未登入（anon 測試身分）";}
node("login").onclick=()=>supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin,queryParams:{prompt:"select_account"}}});
node("reload").onclick=identity;
node("actions").onclick=async event=>{
  const action=event.target.dataset.action;if(!action)return;
  const tripId=node("trip").value.trim(),id=node("record").value.trim(),kind=node("kind").value;
  if(action==="reset"){node("results").textContent="";serial=0;return;}
  if(!/^[a-f0-9-]{36}$/i.test(tripId)){log({error:"請填寫測試旅程 UUID"});return;}
  try{
    if(action==="subscribe"){
      if(channel)await supabase.removeChannel(channel);
      channel=supabase.channel(`budget-live-qa:${sessionId}`).on("postgres_changes",{event:"*",schema:"public",table:"budget_collaboration_signals",filter:`trip_id=eq.${tripId}`},payload=>log({event:"signal",type:payload.eventType,tripId:payload.new?.trip_id||payload.old?.trip_id,revision:payload.new?.revision})).subscribe(status=>log({event:"channel",status}));return;
    }
    if(action==="select"||action==="clear"){
      const result=await supabase.rpc("update_budget_selection",{p_trip_id:tripId,p_session_id:sessionId,p_kind:action==="select"?kind:null,p_id:action==="select"?id:null});
      log({action,error:result.error?.code||null});return;
    }
    if(action==="forge"){
      const result=await supabase.from("budget_collaboration_signals").update({revision:999999}).eq("trip_id",tripId);
      log({action,error:result.error?.code||null});return;
    }
    if(action==="collaboration"){
      const result=await supabase.rpc("read_budget_collaboration",{p_trip_id:tripId,p_session_id:sessionId});
      log({action,error:result.error?.code||null,allowed:Boolean(result.data),entries:result.data?.entries||[]});return;
    }
    const times=[];let result;
    for(let i=0;i<(action==="latency"?10:1);i++){const start=performance.now();result=await supabase.rpc("read_budget_snapshot",{p_trip_id:tripId});times.push(Math.round(performance.now()-start));if(result.error)break;}
    times.sort((a,b)=>a-b);
    log({action,error:result.error?.code||null,allowed:Boolean(result.data),budgetCount:result.data?.budgetItems?.length,actualCount:result.data?.actualExpenses?.length,samples:times,p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1]});
  }catch(error){log({action,error:error.name||"Request failed"});}
};
void identity();
