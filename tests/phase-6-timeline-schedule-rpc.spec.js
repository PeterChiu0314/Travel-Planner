import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const plannerMigration = readFileSync(
  "supabase/migrations/20260809090000_timeline_phase_6_unified_schedule_operation.sql",
  "utf8",
);
const cleanupMigration = readFileSync(
  "supabase/migrations/20260809091000_timeline_phase_6_cleanup_legacy_time_transport.sql",
  "utf8",
);
const transportRemapHotfixMigration = readFileSync(
  "supabase/migrations/20260811124500_timeline_phase_6_defer_transport_pair_uniqueness.sql",
  "utf8",
);
const appSource = readFileSync("src/App.jsx", "utf8");

test("Phase 6 RPC recalculates from a locked full-Day revision instead of trusting preview output", () => {
  expect(plannerMigration).toContain("app_private.plan_timeline_schedule_snapshot");
  expect(plannerMigration).toContain("app_private.apply_timeline_schedule_operation");
  expect(plannerMigration).toContain("public.apply_timeline_schedule_operation");
  expect(plannerMigration).toContain("pg_advisory_xact_lock");
  expect(plannerMigration).toMatch(/order by item\.id\s+for update/);
  expect(plannerMigration).toContain("jsonb_object_keys(item_updated_at_baselines)");
  expect(plannerMigration).toContain("current_visit_ids is distinct from expected_visit_ids");
  expect(plannerMigration).toContain("preview_result is intentionally not used as mutation authority");
  expect(plannerMigration).toContain("repreview_required");
  expect(plannerMigration).toContain("next_end + fixed_boundary_transport_minutes > boundary_minutes");
  expect(plannerMigration).toContain("anchor_start := app_private.timeline_schedule_minutes(original_visits");
  expect(plannerMigration).toMatch(/schedule_start := target_index;\s+anchor_start := start_minutes;/);
  expect(plannerMigration).toContain("delete from public.itinerary_budget_items");
  expect(plannerMigration).toContain("update public.itinerary_alternatives");
});

test("Phase 6 RPC binds authoritative payload writes to the validated operation target", () => {
  expect(plannerMigration).toContain("target_item_id::text is distinct from coalesce(operation_intent ->> 'targetItemId'");
  expect(plannerMigration).toContain("target_item_id::text is distinct from operation_intent -> 'transport' ->> 'id'");
  expect(plannerMigration).toContain("operation_type = 'upsert_transport' and item_row.item_type <> 'transport'");
  expect(plannerMigration).toContain("(operation_intent -> 'transport' ->> 'transport_duration_minutes')::integer");
  expect(plannerMigration).toContain("(operation_intent -> 'transport' ->> 'from_item_id')::uuid");
  expect(plannerMigration).toContain("(operation_intent -> 'transport' ->> 'to_item_id')::uuid");
});

test("Phase 6 SQL rejects missing reorder manifests and transport identity collisions", () => {
  expect(plannerMigration).toContain("next_ids is null or jsonb_typeof(next_ids) <> 'array'");
  expect(plannerMigration).toContain("where value ->> 'id' = transport_id");
  expect(plannerMigration).toContain("transport_duration_text !~ '^[0-9]+$'");
});

test("Phase 6 SQL rejects cross-fixed swaps even when the fixed anchor index is unchanged", () => {
  expect(plannerMigration).toContain("original_entry.ordinality < index_value + 1");
  expect(plannerMigration).toContain("next_entry.ordinality > next_fixed_index + 1");
  expect(plannerMigration).toContain("original_entry.ordinality > index_value + 1");
  expect(plannerMigration).toContain("next_entry.ordinality < next_fixed_index + 1");
});

test("Phase 6 SQL removes only transport pairs newly broken by reorder", () => {
  expect(plannerMigration).toContain("jsonb_array_elements(original_visits) with ordinality");
  expect(plannerMigration).toContain("original_to_index = original_from_index + 1");
  expect(plannerMigration).toContain("if from_index is null or to_index is null or to_index <> from_index + 1");
});

test("Phase 6 RPC accepts pure Untimed reorder without package remap arrays", () => {
  expect(plannerMigration).toContain("if (slot_item_ids is null) <> (package_source_item_ids is null)");
  expect(plannerMigration).toContain("Pure Untimed/visual reorder has no package arrays");
  expect(plannerMigration).toContain("if slot_item_ids is not null then");
});

test("Phase 6 RPC uses least privilege and keeps the private scheduling surface private", () => {
  expect(plannerMigration).toContain("if auth.uid() is null then raise exception 'permission_denied'");
  expect(plannerMigration).toContain("app_private.can_edit_trip(target_trip_id, auth.uid())");
  expect(plannerMigration).toContain(
    "revoke all on function app_private.plan_timeline_schedule_snapshot(jsonb, jsonb) from public, anon, authenticated",
  );
  expect(plannerMigration).toContain(
    "grant execute on function public.apply_timeline_schedule_operation",
  );
  expect(plannerMigration).not.toContain("grant execute on function app_private.apply_timeline_schedule_operation");
});

test("Phase 6 cleanup removes partial and tail states and validates endpoint scope", () => {
  expect(cleanupMigration).toContain("(item.start_time is null) <> (item.end_time is null)");
  expect(cleanupMigration).toContain("item.transport_role in ('tail_promoted_pair', 'tail_pending')");
  expect(cleanupMigration).toContain("delete from public.itinerary_items transport");
  expect(cleanupMigration).toContain("transport_role = 'normal_pair'");
  expect(cleanupMigration).toContain("itinerary_items_phase_6_time_state_check");
  expect(cleanupMigration).toContain("itinerary_items_phase_6_transport_pair_check");
  expect(cleanupMigration).toContain("enforce_timeline_transport_pair_scope");
  expect(cleanupMigration).toContain("raise exception 'invalid_transport_scope'");
});

test("Phase 6 transport remap uniqueness is deferred until the reorder transaction commits", () => {
  expect(transportRemapHotfixMigration).toContain(
    "drop index if exists public.itinerary_items_transport_pair_unique_idx",
  );
  expect(transportRemapHotfixMigration).toContain(
    "unique (trip_id, day_index, from_item_id, to_item_id, item_type)",
  );
  expect(transportRemapHotfixMigration).toContain("deferrable initially deferred");
  expect(appSource).toContain('message.includes("itinerary_items_transport_pair_unique_idx")');
  expect(appSource).toContain("交通資訊重新連接時發生衝突，行程未移動，請重新整理後再試。");
});

test("App callers use the unified RPC and no longer call legacy continuation or reorder RPCs", () => {
  expect(appSource).toContain('supabase.rpc("apply_timeline_schedule_operation"');
  expect(appSource).not.toContain("planTimelineAutoContinuation");
  expect(appSource).not.toContain("autoContinuationUpdates");
  expect(appSource).not.toContain("reorder_itinerary_fixed_anchor_continuation");
  expect(appSource).not.toContain("reorder_itinerary_destination_packages");
  expect(appSource).not.toContain("tail_pending");
  expect(appSource).not.toContain("tail_promoted_pair");
  expect(appSource).not.toContain("新增尾端交通");
  expect(appSource).not.toContain("transportTimeShortageMinutes");
});

test("confirmed previews stay bound to their full material plan and original Day revision", () => {
  expect(appSource).toContain("updatedItems: [...(plan?.updatedItems || [])]");
  expect(appSource).toContain("suspendedTransportIds: [...(plan?.suspendedTransportIds || [])].sort()");
  expect(appSource).toContain("timelineScheduleItemBaselines = timelineScheduleUpdatedAtBaselines(");
  expect(appSource).toContain("itemUpdatedAtBaselines: meta.timelineScheduleItemBaselines");
  expect(appSource).toContain("itemUpdatedAtBaselines: timelineScheduleUpdatedAtBaselines(dayItems)");
});
