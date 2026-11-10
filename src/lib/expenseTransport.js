export function createExpenseService(supabase){
 const rpc=async(name,args)=>{try{return await supabase.rpc(name,args);}catch(error){return{error};}};
 return {authorized:async actor=>(await supabase.auth.getSession()).data?.session?.user?.id===actor,
  read:(trip,session)=>rpc('read_expense_snapshot',{p_trip_id:trip,p_session_id:session}),lease:args=>rpc('expense_group_lease',args),
  mutate:args=>rpc('mutate_expense_group',args),create:args=>rpc(args.p_title===undefined?'create_expense_item':'create_named_expense_item',args),
  copy:args=>rpc('copy_expense_item',args),
  dragLease:args=>rpc('expense_drag_lease',args),moveOrder:args=>rpc('move_expense_order',args),
  rateLease:args=>rpc('expense_rates_lease',args),rates:args=>rpc('update_expense_rates',args)};
}
