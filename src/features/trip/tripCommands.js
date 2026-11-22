import { getDirtyActiveEditorGuards, requestActiveEditorHandoff, requestWorkspaceConfirmation } from "../../app/activeEditorGuard.jsx";
import { todayInput } from "../../lib/displayFormat.js";
import { notify } from "../../lib/notifications.js";
import { getCachedBudgetQuote } from "../../lib/tripBudgetRates.js";
import { supabase } from "../../lib/supabase.js";
import { clearTimelineDraftsForItemIds, hasTimelineDraftForTrip } from "../../components/timeline/timelineDrafts.js";
import { defaultPackItems } from "../pack/defaultPackItems.js";
import { destinationPatchFromParts, destinationPatchFromText } from "../../components/trip/tripDetails.js";
import { buildTripDateChangePreview, timelineItemIdsRemovedByShortening } from "../../components/trip/tripDateChange.js";

export function createTripCommands({
  session,
  activeTripId,
  setActiveDay,
  items,
  setIsTripDialogOpen,
  setTripCreating,
  tripCreationInFlight,
  tripForm,
  setTripForm,
  activeTrip,
  accountRef,
  requestGuard,
  tripDataContext,
  isOwner,
  isTripDateLocked,
  canManageActiveTrip,
  canRenameActiveTrip,
  tripDateChangePreviewData,
  loadTrips,
  loadTripData,
}) {
  async function createTrip(event) {
    event.preventDefault();
    if (tripCreationInFlight.current) return;
    tripCreationInFlight.current = true;
    setTripCreating(true);
    const account = accountRef.current;
    const isCurrent = () => accountRef.current === account && requestGuard.sameContext(tripDataContext);
    try {
      if (!await requestActiveEditorHandoff({ tripId: activeTripId }) || !isCurrent()) return;
      const user = session.user;
      const safeEndDate =
        tripForm.end_date < tripForm.start_date ? tripForm.start_date : tripForm.end_date;
      const tripId = crypto.randomUUID();
      const destinationPatch = destinationPatchFromParts(
        tripForm.destination_country,
        tripForm.destination_city,
      );
      const initialRates = getCachedBudgetQuote();
      const { error: tripError } = await supabase.from("trips").insert({
        id: tripId,
        title: tripForm.title.trim(),
        name: tripForm.title.trim(),
        ...destinationPatch,
        start_date: tripForm.start_date,
        end_date: safeEndDate,
        status: "planning",
        owner_id: user.id,
        ...(initialRates ? { budget_exchange_rates: initialRates } : {}),
      });

      if (tripError) {
        if (isCurrent()) notify.error(tripError.message);
        return;
      }

      const { error: memberError } = await supabase.from("trip_members").insert({
        trip_id: tripId,
        user_id: user.id,
        role: "owner",
        status: "approved",
        display_name: user.user_metadata?.full_name || user.email,
        email: user.email,
      });

      if (memberError) {
        if (isCurrent()) notify.error(memberError.message);
        return;
      }

      const packRows = defaultPackItems.map((title) => ({ trip_id: tripId, title }));
      await supabase.from("pack_items").insert(packRows);
      if (!isCurrent()) return;

      setIsTripDialogOpen(false);
      setTripForm({
        title: "京都五日散策",
        destination_country: "日本",
        destination_city: "京都",
        start_date: todayInput(),
        end_date: todayInput(2),
      });
      await loadTrips(tripId);
    } finally {
      tripCreationInFlight.current = false;
      setTripCreating(false);
    }
  }

  async function updateTrip(patch) {
    if (!activeTrip || !canRenameActiveTrip) return { ok: false };
    const nextPatch = { ...patch };
    const hasStartDatePatch = Object.prototype.hasOwnProperty.call(nextPatch, "start_date");
    const hasEndDatePatch = Object.prototype.hasOwnProperty.call(nextPatch, "end_date");
    if (hasStartDatePatch || hasEndDatePatch) {
      const nextStartDate = hasStartDatePatch ? nextPatch.start_date : activeTrip.start_date;
      const nextEndDate = hasEndDatePatch ? nextPatch.end_date : activeTrip.end_date;
      return updateTripDateRange({ endDate: nextEndDate, startDate: nextStartDate });
    }
    if (Object.prototype.hasOwnProperty.call(nextPatch, "title")) {
      nextPatch.name = nextPatch.title;
    }
    if (
      Object.prototype.hasOwnProperty.call(nextPatch, "destination") &&
      !Object.prototype.hasOwnProperty.call(nextPatch, "destination_country") &&
      !Object.prototype.hasOwnProperty.call(nextPatch, "destination_city")
    ) {
      Object.assign(nextPatch, destinationPatchFromText(nextPatch.destination));
    }
    const { error } = await supabase.from("trips").update(nextPatch).eq("id", activeTrip.id);
    if (error) {
      notify.error(error.message);
      return { ok: false, error };
    }
    await loadTrips(activeTrip.id);
    return { ok: true };
  }

  async function updateTripDateRange({
    allowSettlementOverride = false,
    confirmTimelineRemoval = false,
    source = "trip-date-popover",
    startDate,
    endDate,
  }) {
    const canOverrideSettlementLock = allowSettlementOverride === true && source === "developer-date-tool";
    if (!activeTrip || !isOwner) {
      const message = "You do not have permission to change trip dates.";
      notify.error(message);
      return { ok: false, permissionDenied: true, message };
    }
    if (isTripDateLocked && !canOverrideSettlementLock) {
      const message = "旅程已進入結算階段，無法修改日期。";
      notify.error(message);
      return { ok: false, dateLocked: true, message };
    }
    if (!startDate || !endDate || endDate < startDate) {
      notify.error("Invalid trip date range");
      return { ok: false };
    }
    if (getDirtyActiveEditorGuards({ tripId: activeTrip.id, workspace: "timeline" }).length) {
      const message = "目前有未儲存的編輯內容，請先儲存或放棄後再修改旅程日期。";
      notify.error(message);
      return { ok: false, dirtyDraft: true, message };
    }
    const draftScope = { tripId: activeTrip.id, userId: session?.user?.id };
    if (hasTimelineDraftForTrip(draftScope)) {
      const message = "目前有未儲存的編輯內容，請先儲存或放棄後再修改旅程日期。";
      notify.error(message);
      return { ok: false, dirtyDraft: true, message };
    }
    const preview = buildTripDateChangePreview({
      ...tripDateChangePreviewData,
      newEndDate: endDate,
      newStartDate: startDate,
      trip: activeTrip,
    });
    if (preview.hasTimelineRemoval && !confirmTimelineRemoval) {
      notify.error("This date change would remove Timeline data. Please handle it in the shortening cleanup flow.");
      return { ok: false, unsafeShortening: true };
    }
    const removedTimelineDraftIds =
      preview.hasTimelineRemoval && confirmTimelineRemoval
        ? timelineItemIdsRemovedByShortening(items, preview.newDayCount)
        : new Set();
    const { data, error } = await supabase.rpc("apply_trip_date_change", {
      confirm_timeline_removal: Boolean(confirmTimelineRemoval),
      trip_id: activeTrip.id,
      new_start_date: startDate,
      new_end_date: endDate,
    });
    if (error || data?.ok !== true) {
      if (error) notify.error(error.message);
      return { ok: false, error };
    }
    if (removedTimelineDraftIds.size) {
      clearTimelineDraftsForItemIds({ ...draftScope, itemIds: removedTimelineDraftIds });
    }
    setActiveDay((current) => Math.min(current, Math.max((preview.newDayCount || 1) - 1, 0)));
    await Promise.all([loadTrips(activeTrip.id), loadTripData(activeTrip.id)]);
    return { ok: true, data };
  }

  async function deleteTrip() {
    if (!activeTrip || !canManageActiveTrip) return;
    const confirmed = await requestWorkspaceConfirmation({
      title: `刪除「${activeTrip.title}」？`,
      description: "刪除旅程後無法復原。",
      confirmLabel: "確認刪除",
    });
    if (!confirmed || !requestGuard.sameContext(tripDataContext)) return;
    const { data, error } = await supabase.rpc("delete_trip_with_expenses", { p_trip_id: activeTrip.id });
    if (error || data !== activeTrip.id) notify.error(
      error?.code === "55P03" ? "此旅程有資料正在儲存，請稍後再試。"
        : error?.code === "42501" ? "無法刪除這個旅程，請確認擁有者權限。"
          : error?.code === "PGRST202" ? "旅程刪除功能正在更新，請稍後再試。"
            : error?.message || "無法確認旅程已刪除，請重新整理。",
    );
    else await loadTrips();
  }

  return { createTrip, updateTrip, updateTripDateRange, deleteTrip };
}
