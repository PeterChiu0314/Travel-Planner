// Selection is a short-lived DB hint; edit authority always comes from leases.
export function createBudgetCollaboration({supabase,sessionId,onChange,now=Date.now,setTimer=setInterval,clearTimer=clearInterval}) {
  let context=null,generation=0,channel=null,timer=null,scheduled=null,inFlight=null,dirty=false,visible=true,readEpoch=0;
  let selection=null,entries=[],offset=0,lastRead=0,lastPing=0,selectionWork=Promise.resolve(),lastView="";
  const current=(g,c)=>generation===g&&context===c;
  const emit=()=>{const visible=entries.filter(e=>!e.own_session&&Date.parse(e.expires_at)>now()+offset),signature=JSON.stringify(visible);if(signature!==lastView){lastView=signature;onChange(visible);}};
  async function writeSelection(c,value) {
    const auth=await supabase.auth.getSession().catch(()=>null);
    if(auth?.data?.session?.user?.id!==c.userId)return;
    return supabase.rpc("update_budget_selection",{p_trip_id:c.tripId,p_session_id:sessionId,p_kind:value?.kind||null,p_id:value?.id||null}).catch(()=>null);
  }
  function queueSelection(value) {
    const c=context,g=generation;
    selectionWork=selectionWork.catch(()=>{}).then(async()=>{
      if(c&&current(g,c))await writeSelection(c,value);
    });
    return selectionWork;
  }
  async function read() {
    const c=context,g=generation,epoch=readEpoch;if(!c||!visible)return;
    if(inFlight){dirty=true;return inFlight;}
    const work=(async()=>{
      do {
        dirty=false;const start=now();
        const result=await supabase.rpc("read_budget_collaboration",{p_trip_id:c.tripId,p_session_id:sessionId}).catch(error=>({error}));
        if(!current(g,c)||!visible||epoch!==readEpoch)return;
        if(result.error||!result.data||result.data.tripId!==c.tripId){entries=[];emit();return;}
        offset=Date.parse(result.data.serverNow)-start;
        entries=result.data.entries||[];lastRead=now();emit();
      }while(dirty&&current(g,c));
    })().finally(()=>{if(inFlight===work)inFlight=null;});
    inFlight=work;return work;
  }
  function schedule(){if(scheduled!==null||!context)return;scheduled=setTimeout(()=>{scheduled=null;void read();},80);}
  function stop(){clearTimeout(scheduled);scheduled=null;if(timer!==null)clearTimer(timer);timer=null;if(channel)void supabase.removeChannel(channel);channel=null;}
  return {
    async configure(userId,tripId,active=true){
      if(context?.userId===userId&&context?.tripId===tripId&&active)return;
      const old=context;generation++;stop();inFlight=null;visible=true;context=active&&userId&&tripId?{userId,tripId}:null;
      entries=[];emit();
      if(old)selectionWork=selectionWork.catch(()=>{}).then(()=>writeSelection(old,null));
      if(!context)return;
      const c=context,g=generation;
      channel=supabase.channel(`budget-collaboration:${tripId}`).on("postgres_changes",{event:"*",schema:"public",table:"budget_collaboration_signals",filter:`trip_id=eq.${tripId}`},()=>{if(current(g,c))schedule();})
        .subscribe(status=>{if(!current(g,c))return;if(status==="SUBSCRIBED")schedule();else if(["CLOSED","CHANNEL_ERROR","TIMED_OUT"].includes(status)){entries=[];emit();}});
      lastRead=now();lastPing=now();schedule();if(selection)void queueSelection(selection);
      timer=setTimer(()=>{if(!visible)return;emit();if(now()-lastRead>=30000){lastRead=now();schedule();}if(selection&&now()-lastPing>=15000){lastPing=now();void queueSelection(selection);}},1000);timer?.unref?.();
    },
    select(value){if(selection?.kind===value?.kind&&selection?.id===value?.id)return;selection=value;lastPing=now();if(context&&visible)void queueSelection(value);},
    reconcile(){visible=true;if(context){schedule();if(selection)void queueSelection(selection);}},
    hide(){visible=false;readEpoch++;inFlight=null;entries=[];emit();if(context)void queueSelection(null);},
    async dispose(){const old=context;generation++;stop();context=null;entries=[];emit();if(old){selectionWork=selectionWork.catch(()=>{}).then(()=>writeSelection(old,null));await selectionWork;}},
  };
}
