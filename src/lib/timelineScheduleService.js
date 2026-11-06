export async function submitTimelineSchedule(client, args, isCurrent) {
  if (!isCurrent()) return { blocked: "旅程已切換，請重新操作。" };
  const atomic = await client.rpc("apply_timeline_schedule_operation_link_safe", args);
  // An uncertain response must never fall back to a second write endpoint.
  if (atomic.error?.code === "PGRST202") {
    return { blocked: "行程排程服務尚未更新，請稍後重新整理。" };
  }
  return atomic;
}
