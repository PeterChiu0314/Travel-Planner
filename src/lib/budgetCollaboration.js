// Selection is a short-lived DB hint; edit authority always comes from leases.
export function primaryBudgetCollaborators(entries) {
  const users = new Map();
  for (const entry of entries) {
    const rows = users.get(entry.user_id) || [];
    rows.push(entry); users.set(entry.user_id, rows);
  }
  return [...users.values()].flatMap(rows => {
    const edits = rows.filter(row => row.mode === "edit");
    const candidates = edits.length ? edits : rows.filter(row => row.mode === "selection").sort((a,b) =>
      (b.selected_at || "").localeCompare(a.selected_at || "") || `${a.kind}:${a.resource_id}`.localeCompare(`${b.kind}:${b.resource_id}`) || Number(b.own_session)-Number(a.own_session)).slice(0,1);
    const resources = new Map();
    for (const row of candidates) { const key = `${row.kind}:${row.resource_id}`; if (!resources.has(key) || row.own_session) resources.set(key, row); }
    return [...resources.values()];
  }).sort((a,b) => `${a.user_id}:${a.kind}:${a.resource_id}`.localeCompare(`${b.user_id}:${b.kind}:${b.resource_id}`));
}

export function createBudgetCollaboration({supabase,sessionId,onChange,onVerified=()=>{},now=Date.now,setTimer=setInterval,clearTimer=clearInterval,makeId=()=>crypto.randomUUID()}) {
  let context=null,generation=0,channel=null,timer=null,scheduled=null,inFlight=null,dirty=false,visible=true,readEpoch=0;
  let selection=null,entries=[],offset=0,lastRead=0,lastPing=0,selectionWork=Promise.resolve(),lastView="",selectionProtocol=null;
  const current=(g,c)=>generation===g&&context===c;
  const emit=()=>{const visible=primaryBudgetCollaborators(entries.filter(e=>Date.parse(e.expires_at)>now()+offset)).filter(e=>!e.own_session),signature=JSON.stringify(visible);if(signature!==lastView){lastView=signature;onChange(visible);}};
  async function writeSelection(c,value,action) {
    if (selectionProtocol === null) await read();
    if (selectionProtocol === null) return null;
    const auth=await supabase.auth.getSession().catch(()=>null);
    if(auth?.data?.session?.user?.id!==c.userId)return;
    if(action!=="clear"&&(!visible||context!==c))return;
    try {
      if (selectionProtocol === 2 && value?.activityId) {
        const result = await supabase.rpc("update_budget_selection_v2",{p_trip_id:c.tripId,p_session_id:sessionId,p_kind:value.kind,p_id:value.id,p_activity_id:value.activityId,p_action:action});
        return result;
      }
      return await supabase.rpc("update_budget_selection",{p_trip_id:c.tripId,p_session_id:sessionId,p_kind:action === "clear" ? null : value?.kind||null,p_id:action === "clear" ? null : value?.id||null});
    }
    catch { return null; }
  }
  function queueSelection(value,action="refresh") {
    const c=context,g=generation;
    selectionWork=selectionWork.catch(()=>{}).then(async()=>{
      if(c&&current(g,c))await writeSelection(c,value,action);
    });
    return selectionWork;
  }
  async function read() {
    const c=context,g=generation,epoch=readEpoch;if(!c||!visible)return;
    if(inFlight){dirty=true;return inFlight;}
    const work=(async()=>{
      do {
        dirty=false;const start=now();
        let result;
        try { result=await supabase.rpc("read_budget_collaboration",{p_trip_id:c.tripId,p_session_id:sessionId}); }
        catch(error) { result={error}; }
        if(!current(g,c)||!visible||epoch!==readEpoch)return;
        if(result.error||!result.data||result.data.tripId!==c.tripId||!Array.isArray(result.data.entries)||!Number.isFinite(Date.parse(result.data.serverNow))){entries=[];emit();return;}
        offset=Date.parse(result.data.serverNow)-start;
        selectionProtocol = result.data.selectionProtocol === 2 ? 2 : 1;
        entries=result.data.entries||[];lastRead=now();emit();onVerified();
      }while(dirty&&current(g,c));
    })().finally(()=>{if(inFlight===work)inFlight=null;});
    inFlight=work;return work;
  }
  function schedule(){if(scheduled!==null||!context)return;scheduled=setTimeout(()=>{scheduled=null;void read();},80);}
  function stop(){clearTimeout(scheduled);scheduled=null;if(timer!==null)clearTimer(timer);timer=null;if(channel)void supabase.removeChannel(channel);channel=null;}
  return {
    async configure(userId,tripId,active=true){
      if(context?.userId===userId&&context?.tripId===tripId&&active)return;
      const old=context,oldSelection=selection;generation++;stop();inFlight=null;visible=true;context=active&&userId&&tripId?{userId,tripId}:null;
      entries=[];emit();
      if(old)selectionWork=selectionWork.catch(()=>{}).then(()=>writeSelection(old,oldSelection,"clear"));
      if (selection && ((selection.tripId && selection.tripId !== tripId) || (selection.userId && selection.userId !== userId))) selection = null;
      if(!context)return;
      const c=context,g=generation;
      channel=supabase.channel(`budget-collaboration:${tripId}`).on("postgres_changes",{event:"*",schema:"public",table:"budget_collaboration_signals",filter:`trip_id=eq.${tripId}`},()=>{if(current(g,c))schedule();})
        .subscribe(status=>{if(!current(g,c))return;if(status==="SUBSCRIBED")schedule();else if(["CLOSED","CHANNEL_ERROR","TIMED_OUT"].includes(status)){entries=[];emit();}});
      lastRead=now();lastPing=now();schedule();if(selection){void queueSelection(selection,selection.pendingAction?"select":"refresh");selection.pendingAction=false;}
      timer=setTimer(()=>{if(!visible)return;emit();if(now()-lastRead>=30000){lastRead=now();schedule();}if(selection&&now()-lastPing>=15000){lastPing=now();void queueSelection(selection);}},1000);timer?.unref?.();
    },
    select(value){
      if(selection?.kind===value?.kind&&selection?.id===value?.id&&(!value?.tripId||value.tripId===selection?.tripId)&&(!value?.userId||value.userId===selection?.userId))return;
      const previous=selection;
      selection=value?{kind:value.kind,id:value.id,tripId:value.tripId||context?.tripId,userId:value.userId||context?.userId,activityId:makeId(),pendingAction:true}:null;
      lastPing=now();if(context&&visible){void queueSelection(selection||previous,selection?"select":"clear");if(selection)selection.pendingAction=false;}
    },
    reconcile(){visible=true;if(context){schedule();if(selection)void queueSelection(selection);}},
    hide(){visible=false;readEpoch++;inFlight=null;entries=[];emit();if(context)void queueSelection(selection,"clear");},
    async dispose(){const old=context,previous=selection;generation++;stop();context=null;entries=[];emit();if(old){selectionWork=selectionWork.catch(()=>{}).then(()=>writeSelection(old,previous,"clear"));await selectionWork;}},
  };
}
