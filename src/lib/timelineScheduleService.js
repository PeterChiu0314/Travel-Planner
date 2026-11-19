export async function submitTimelineSchedule(client, semanticArgs, isCurrent) {
  if (!isCurrent()) return { blocked: "旅程已切換，請重新操作。" };
  const wireArgs = {
    confirmed_major_effect: semanticArgs.confirmedMajorEffect,
    expected_visit_ids: semanticArgs.expectedVisitIds,
    item_updated_at_baselines: semanticArgs.itemUpdatedAtBaselines,
    operation_intent: semanticArgs.operation,
    package_source_item_ids: semanticArgs.packageSourceItemIds,
    preview_result: semanticArgs.plan,
    slot_item_ids: semanticArgs.slotItemIds,
    target_day_index: semanticArgs.dayIndex,
    target_item_id: semanticArgs.targetItemId,
    target_payload: semanticArgs.targetPayload,
    target_trip_id: semanticArgs.tripId,
  };
  const atomic = await client.rpc("apply_timeline_schedule_operation_link_safe", wireArgs);
  // An uncertain response must never fall back to a second write endpoint.
  if (atomic.error?.code === "PGRST202") {
    return { blocked: "行程排程服務尚未更新，請稍後重新整理。" };
  }
  return atomic;
}
