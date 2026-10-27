// Acquire/renew before touching Storage. Delete metadata atomically before bytes
// so a rejected capability never destroys a receipt still shown in the graph.
export async function deleteBudgetReceipt({supabase,tripId,attachment,meta,refresh}) {
  const result=await supabase.rpc("mutate_budget_receipt",{p_trip_id:tripId,p_actual_id:attachment.target_id,p_action:"delete",p_receipt:{id:attachment.id},
    p_edit_session_id:meta.editLease?.sessionId,p_edit_token:meta.editLease?.token});
  if(result.error)return {ok:false,error:result.error};
  const storage=await supabase.storage.from("trip-attachments").remove([result.data.file_url]);
  await refresh(tripId);
  return {ok:true,cleanupError:storage.error};
}
