import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { planDestinationPackageReorder } from "../../lib/destinationPackages.js";
import { isLockedByAnotherUser } from "../../lib/editLocks.js";
import { attachTimelineScheduleSortOrders, planTimelineSchedule, timelineScheduleOperationTypes } from "../../lib/timelineSchedulePlanner.js";
import { isTransportationCard } from "../../lib/timelineTransportationRoles.js";
import useTimelineVisitDragSession from "./useTimelineVisitDragSession.js";
import {
  isTimedVisit,
  isUntimedVisit,
  planMixedTimedVisitReorder,
  planUntimedVisitReorder,
  untimedOrderingErrorMessage,
} from "../../lib/timelineUntimedOrdering.js";
import { timelineDragPresenceDebug } from "./timelinePresence.js";
import {
  destinationReorderErrorMessage,
  timelineScheduleErrorMessage,
  timelineScheduleMajorEffect,
  timelineScheduleUpdatedAtBaselines,
  isEffectiveFixedVisit,
} from "./timelineItemRules.js";

export function useTimelineReorder({
  activeTrip,
  currentUserId,
  dayItems,
  focusedItemId,
  onClearDragPresence,
  onClearCardSelection,
  onPublishDragPresence,
  onReorderDestinationPackages,
  onReorderUntimedVisit,
  activeDay,
  foreignSameDayDragActive,
  useEditLocks,
  isOpen,
  editingId,
  setFixedNotice,
  autoContinuationPrompt,
  isSavingAutoContinuation,
  canMutateThisDay,
  foreignDragSaveBlockedMessage,
  hasBlockingTimelineEditor,
  newVisitEditorRef,
  isTransportEditor,
  visitItems,
  visitItemIds,
  timedVisitItems,
  visitDestination,
}) {
  const [reorderPreview, setReorderPreview] = useState(null);
  const [isReorderingDestination, setIsReorderingDestination] = useState(false);
  const [isReorderingUntimed, setIsReorderingUntimed] = useState(false);
  const [untimedDropNotice, setUntimedDropNotice] = useState("");
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const {
    clearVisitDrag,
    draggedVisitId,
    dragOverlaySize,
    dragTarget,
    lastDndOverIdRef,
    setDraggedVisitId,
    setDragOverlaySize,
    setDragTarget,
  } = useTimelineVisitDragSession({ activeDay, tripId: activeTrip?.id, onClearDragPresence });

  const activeDayColumnRef = useRef(null);
  const activeTimelineListRef = useRef(null);
  const restrictTimelineDragToDayColumn = useCallback(
    ({ activeNodeRect, overlayNodeRect, transform }) => {
      const columnRect = activeDayColumnRef.current?.getBoundingClientRect();
      const timelineRect = activeTimelineListRef.current?.getBoundingClientRect();
      if (!columnRect || !activeNodeRect) return { ...transform, x: 0 };
      const overlayHeight = overlayNodeRect?.height || dragOverlaySize?.height || activeNodeRect.height || 0;
      const minY = (timelineRect?.top || columnRect.top) - activeNodeRect.top;
      const maxY = columnRect.bottom - activeNodeRect.top - overlayHeight;
      return {
        ...transform,
        x: 0,
        y: Math.min(Math.max(transform.y, minY), Math.max(minY, maxY)),
      };
    },
    [dragOverlaySize?.height],
  );

  function canDragReorderVisit(item) {
    return (
      canMutateThisDay &&
      !hasBlockingTimelineEditor &&
      !isReorderingDestination &&
      isTimedVisit(item) &&
      !isEffectiveFixedVisit(item) &&
      !(useEditLocks && isLockedByAnotherUser(item, currentUserId))
    );
  }

  function canDragUntimedVisit(item) {
    return (
      canMutateThisDay &&
      !hasBlockingTimelineEditor &&
      !isReorderingDestination &&
      !isReorderingUntimed &&
      isUntimedVisit(item) &&
      !(useEditLocks && isLockedByAnotherUser(item, currentUserId))
    );
  }

  function canDragVisit(item) {
    return canDragReorderVisit(item) || canDragUntimedVisit(item);
  }

  function canTargetDraggedVisit(item, sourceId = draggedVisitId) {
    const source = dayItems.find((candidate) => candidate.id === sourceId);
    if (!source || source.id === item?.id || isTransportationCard(item)) return false;
    return canDragVisit(source);
  }

  function sortableDropIntent(sourceItemId, targetItemId) {
    if (!sourceItemId || !targetItemId || sourceItemId === targetItemId) return null;
    const sourceIndex = visitItems.findIndex((item) => item.id === sourceItemId);
    const targetIndex = visitItems.findIndex((item) => item.id === targetItemId);
    if (sourceIndex < 0 || targetIndex < 0) return null;
    return sourceIndex < targetIndex ? "after" : "before";
  }

  function previewSortableDrag(sourceItemId, targetItemId) {
    const source = dayItems.find((candidate) => candidate.id === sourceItemId);
    const target = dayItems.find((candidate) => candidate.id === targetItemId);
    const placement = sortableDropIntent(sourceItemId, targetItemId);
    if (!source || !target || !placement || !canTargetDraggedVisit(target, sourceItemId)) {
      setDragTarget(targetItemId ? { disabled: true, errorCode: "invalid_target", itemId: targetItemId, placement: placement || "after" } : null);
      return false;
    }
    if (isUntimedVisit(source)) {
      const plan = planUntimedVisitReorder({ items: dayItems, placement, sourceItemId: source.id, targetItemId: target.id });
      setUntimedDropNotice(plan.ok ? "" : untimedOrderingErrorMessage(plan.errorCode));
      setDragTarget({ disabled: !plan.ok, errorCode: plan.errorCode || "", itemId: target.id, placement });
      return plan.ok;
    }
    const plan = planMixedTimedVisitReorder({
      items: dayItems,
      placement,
      sourceItemId: source.id,
      targetItemId: target.id,
    });
    if (!plan.ok) {
      setFixedNotice(destinationReorderErrorMessage({ message: plan.errorCode }));
      setDragTarget({ disabled: true, errorCode: plan.errorCode || "", itemId: target.id, placement });
      return false;
    }
    setFixedNotice("");
    setDragTarget({ disabled: false, itemId: target.id, placement });
    return true;
  }

  function handleSortableDragStart(event) {
    const sourceItem = dayItems.find((item) => item.id === event.active.id);
    if (!sourceItem || !canDragVisit(sourceItem)) return;
    if (typeof onClearCardSelection === "function") onClearCardSelection();
    const sourceRect = event.active.rect.current.initial;
    setDragOverlaySize(
      sourceRect?.width && sourceRect?.height ? { height: sourceRect.height, width: sourceRect.width } : null,
    );
    setFixedNotice("");
    setUntimedDropNotice("");
    setDraggedVisitId(sourceItem.id);
    setDragTarget(null);
    if (typeof onPublishDragPresence === "function") {
      onPublishDragPresence({
        resetDrag: true,
        forceTrack: true,
        itemId: sourceItem.id,
        itemTitle: visitDestination(sourceItem),
        overItemId: null,
        placement: null,
      });
    }
    lastDndOverIdRef.current = null;
  }

  function handleSortableDragOver(event) {
    const sourceItemId = event.active?.id;
    const targetItemId = event.over?.id;
    if (!sourceItemId || !targetItemId || sourceItemId === targetItemId) {
      setDragTarget(null);
      if (typeof onPublishDragPresence === "function" && sourceItemId) {
        onPublishDragPresence({ overItemId: null, placement: null });
      }
      lastDndOverIdRef.current = targetItemId || null;
      return;
    }
    if (lastDndOverIdRef.current === targetItemId) return;
    lastDndOverIdRef.current = targetItemId;
    const previewOk = previewSortableDrag(sourceItemId, targetItemId);
    const placement = sortableDropIntent(sourceItemId, targetItemId);
    if (typeof onPublishDragPresence === "function") {
      onPublishDragPresence({
        overItemId: previewOk ? targetItemId : null,
        placement: previewOk ? placement : null,
      });
    }
  }

  function handleSortableDragCancel() {
    timelineDragPresenceDebug("drag end branch name", { branch: "cancel" });
    clearVisitDrag("cancel");
  }

  async function handleSortableDragEnd(event) {
    const sourceItemId = event.active?.id;
    const targetItemId = event.over?.id;
    const targetItem = dayItems.find((item) => item.id === targetItemId);
    const placement = sortableDropIntent(sourceItemId, targetItemId);
    if (!sourceItemId || !targetItem || !placement || sourceItemId === targetItemId) {
      const branch = sourceItemId && sourceItemId === targetItemId ? "noop" : "invalid";
      timelineDragPresenceDebug("drag end branch name", { branch, sourceItemId, targetItemId });
      clearVisitDrag(`drag-end-${branch}`);
      return;
    }
    timelineDragPresenceDebug("drag end branch name", { branch: "drop", placement, sourceItemId, targetItemId });
    clearVisitDrag("drag-end-drop");
    await commitVisitDrop(sourceItemId, targetItem, placement);
  }

  function beginVisitDrag(event, item) {
    if (!canDragVisit(item)) {
      event.preventDefault();
      if (hasBlockingTimelineEditor) setFixedNotice("請先儲存或放棄目前編輯，再重排行程。");
      else if (timedVisitItems.some((visit) => visit.is_fixed)) setFixedNotice("當天包含固定行程，無法進行插入式重排。");
      else if (timedVisitItems.some((visit) => useEditLocks && isLockedByAnotherUser(visit, currentUserId))) {
        setFixedNotice("當天其中一個行程目前正由其他成員編輯。");
      }
      return;
    }
    if (typeof onClearCardSelection === "function") onClearCardSelection();
    setFixedNotice("");
    setUntimedDropNotice("");
    setDraggedVisitId(item.id);
    setDragTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  }

  function updateVisitDragTarget(event, item) {
    if (!draggedVisitId || !canTargetDraggedVisit(item)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    const source = dayItems.find((candidate) => candidate.id === draggedVisitId);
    if (isUntimedVisit(source)) {
      const plan = planUntimedVisitReorder({ items: dayItems, placement, sourceItemId: source.id, targetItemId: item.id });
      event.dataTransfer.dropEffect = "move";
      setUntimedDropNotice(plan.ok ? "" : untimedOrderingErrorMessage(plan.errorCode));
      setDragTarget({ disabled: !plan.ok, errorCode: plan.errorCode || "", itemId: item.id, placement });
      return;
    }
    event.dataTransfer.dropEffect = "move";
    setDragTarget({ disabled: false, itemId: item.id, placement });
  }

  async function commitVisitDrop(sourceItemId, targetItem, placement) {
    if (isOpen) {
      setFixedNotice("請先儲存或放棄目前編輯，再重排行程。");
      clearVisitDrag("commit-editor-blocked");
      return;
    }
    if (!sourceItemId || sourceItemId === targetItem.id) {
      clearVisitDrag("commit-noop");
      return;
    }
    const sourceItem = dayItems.find((item) => item.id === sourceItemId);
    if (!sourceItem || !canTargetDraggedVisit(targetItem, sourceItem.id)) {
      timelineDragPresenceDebug("drag end branch name", { branch: "invalid-target", sourceItemId, targetItemId: targetItem.id });
      clearVisitDrag("commit-invalid-target");
      return;
    }
    if (isUntimedVisit(sourceItem)) {
      const plan = planUntimedVisitReorder({
        items: dayItems,
        placement,
        sourceItemId: sourceItem.id,
        targetItemId: targetItem.id,
      });
      clearVisitDrag("commit-untimed-plan");
      if (!plan.ok) {
        timelineDragPresenceDebug("drag end branch name", { branch: "untimed-blocked", errorCode: plan.errorCode });
        setUntimedDropNotice(untimedOrderingErrorMessage(plan.errorCode));
        return;
      }
      if (plan.noOp) {
        timelineDragPresenceDebug("drag end branch name", { branch: "untimed-noop" });
        return;
      }
      if (typeof onReorderUntimedVisit !== "function") {
        setUntimedDropNotice("未設定時間行程移動失敗，請稍後再試。");
        return;
      }
      const timelineScheduleOperation = {
        orderedVisitIds: plan.nextVisitIds,
        type: timelineScheduleOperationTypes.reorder,
      };
      const timelineScheduleExpectedVisitIds = visitItems.map((visit) => visit.id);
      const timelineSchedulePlan = attachTimelineScheduleSortOrders({
        items: dayItems,
        plan: planTimelineSchedule({
          items: dayItems,
          operation: timelineScheduleOperation,
          orderedVisitIds: timelineScheduleExpectedVisitIds,
        }),
      });
      if (!timelineSchedulePlan.ok) {
        setUntimedDropNotice(timelineScheduleErrorMessage(timelineSchedulePlan));
        return;
      }
      const removedTransportIds = new Set(timelineSchedulePlan.removedTransportIds || []);
      const transportBaselines = dayItems
        .filter((item) => isTransportationCard(item) && removedTransportIds.has(item.id))
        .map((transport) => ({ id: transport.id, updatedAt: transport.updated_at }));
      const untimedReorder = {
        dayIndex: activeDay,
        itemId: sourceItem.id,
        itemUpdatedAtBaselines: timelineScheduleUpdatedAtBaselines(dayItems),
        kind: "untimed",
        timelineScheduleExpectedVisitIds,
        timelineScheduleOperation,
        timelineSchedulePlan,
        transportBaselines,
        updatedAt: sourceItem.updated_at,
      };
      if (timelineSchedulePlan.requiresConfirmation) {
        timelineDragPresenceDebug("drag end branch name", { branch: "untimed-confirmation", transportCount: transportBaselines.length });
        setReorderPreview(untimedReorder);
        return;
      }
      timelineDragPresenceDebug("drag end branch name", { branch: "untimed-rpc" });
      setIsReorderingUntimed(true);
      const result = await onReorderUntimedVisit(untimedReorder);
      if (!result?.ok) setUntimedDropNotice(result?.errorMessage || "未設定時間行程移動失敗，請稍後再試。");
      else setUntimedDropNotice("");
      setIsReorderingUntimed(false);
      return;
    }
    if (!sourceItem || !canDragReorderVisit(sourceItem) || typeof onReorderDestinationPackages !== "function") {
      timelineDragPresenceDebug("drag end branch name", { branch: "timed-blocked" });
      clearVisitDrag("commit-timed-blocked");
      return;
    }
    const mixedPlan = planMixedTimedVisitReorder({
      items: dayItems,
      placement,
      sourceItemId: sourceItem.id,
      targetItemId: targetItem.id,
    });
    if (!mixedPlan.ok) {
      setFixedNotice(destinationReorderErrorMessage({ message: mixedPlan.errorCode }));
      timelineDragPresenceDebug("drag end branch name", { branch: "timed-mixed-blocked", errorCode: mixedPlan.errorCode });
      clearVisitDrag("commit-timed-mixed-blocked");
      return;
    }
    const { packageSourceItemIds, slotItemIds } = mixedPlan;
    const packagePreview = planDestinationPackageReorder({
      items: dayItems,
      orderedTimedItemIds: mixedPlan.orderedTimedItemIds,
      orderedVisitItemIds: mixedPlan.orderedVisitItemIds,
      slotItemIds,
      packageSourceItemIds,
    });
    if (!packagePreview.ok) {
      setFixedNotice(destinationReorderErrorMessage({ message: packagePreview.errorCode }));
      timelineDragPresenceDebug("drag end branch name", { branch: "timed-preview-blocked", errorCode: packagePreview.errorCode });
      clearVisitDrag("commit-timed-preview-blocked");
      return;
    }
    const timelineScheduleOperation = {
      orderedVisitIds: mixedPlan.orderedVisitItemIds,
      type: timelineScheduleOperationTypes.reorder,
    };
    const timelineScheduleExpectedVisitIds = visitItems.map((visit) => visit.id);
    const baseSchedulePlan = attachTimelineScheduleSortOrders({
      items: dayItems,
      plan: planTimelineSchedule({
        items: dayItems,
        operation: timelineScheduleOperation,
        orderedVisitIds: timelineScheduleExpectedVisitIds,
      }),
    });
    if (!baseSchedulePlan.ok) {
      setFixedNotice(timelineScheduleErrorMessage(baseSchedulePlan));
      clearVisitDrag("commit-timed-schedule-blocked");
      return;
    }
    const removedTransportIds = [...new Set([
      ...(baseSchedulePlan.removedTransportIds || []),
      ...(packagePreview.deletedTransportIds || []),
    ])].sort();
    const timelineSchedulePlan = {
      ...baseSchedulePlan,
      affectedItemIds: [...new Set([...(baseSchedulePlan.affectedItemIds || []), ...removedTransportIds])],
      removedTransportIds,
      requiresConfirmation: baseSchedulePlan.automaticUntimedItemIds.length > 0 || removedTransportIds.length > 0,
    };
    const explicitTransportBaselines = removedTransportIds
      .map((transportId) => {
        const transport = dayItems.find((item) => item.id === transportId);
        return transport ? { id: transport.id, updatedAt: transport.updated_at } : null;
      })
      .filter(Boolean);
    const timedReorder = {
      dayIndex: activeDay,
      itemUpdatedAtBaselines: timelineScheduleUpdatedAtBaselines(dayItems),
      kind: "timed",
      orderedTimedItemIds: mixedPlan.orderedTimedItemIds,
      orderedVisitItemIds: mixedPlan.orderedVisitItemIds,
      packageSourceItemIds,
      slotItemIds,
      timelineScheduleExpectedVisitIds,
      timelineScheduleOperation,
      timelineSchedulePlan,
      transportBaselines: explicitTransportBaselines,
    };
    if (timelineSchedulePlan.requiresConfirmation) {
      timelineDragPresenceDebug("drag end branch name", {
        branch: "timed-confirmation",
        deletedTransportCount: removedTransportIds.length,
        transportCount: explicitTransportBaselines.length,
      });
      setReorderPreview(timedReorder);
      return;
    }
    timelineDragPresenceDebug("drag end branch name", { branch: "timed-rpc" });
    setIsReorderingDestination(true);
    const result = await onReorderDestinationPackages(timedReorder);
    if (!result?.ok) setFixedNotice(result?.errorMessage || destinationReorderErrorMessage(result?.error));
    setIsReorderingDestination(false);
  }

  async function confirmMoveReorder() {
    if (!reorderPreview) return;
    if (isOpen) {
      setFixedNotice("請先儲存或放棄目前編輯，再重排行程。");
      return;
    }
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragSaveBlockedMessage);
      return;
    }
    if (reorderPreview.kind === "untimed") {
      if (typeof onReorderUntimedVisit !== "function") return;
      setIsReorderingUntimed(true);
      const result = await onReorderUntimedVisit({
        ...reorderPreview,
        confirmedScheduleEffect: timelineScheduleMajorEffect(reorderPreview.timelineSchedulePlan),
      });
      if (!result?.ok) setUntimedDropNotice(result?.errorMessage || "未設定時間行程移動失敗，請稍後再試。");
      else {
        setUntimedDropNotice("");
        setReorderPreview(null);
      }
      setIsReorderingUntimed(false);
      return;
    }
    if (typeof onReorderDestinationPackages !== "function") return;
    setIsReorderingDestination(true);
    const result = await onReorderDestinationPackages({
      ...reorderPreview,
      confirmedScheduleEffect: timelineScheduleMajorEffect(reorderPreview.timelineSchedulePlan),
    });
    if (!result?.ok) setFixedNotice(result?.errorMessage || "目的地內容重排失敗，請稍後再試。");
    if (result?.ok) setReorderPreview(null);
    setIsReorderingDestination(false);
  }

  useEffect(() => {
    if (!isOpen || isTransportEditor || editingId || !newVisitEditorRef.current) return undefined;
    if (
      draggedVisitId ||
      foreignSameDayDragActive ||
      reorderPreview ||
      autoContinuationPrompt ||
      isSavingAutoContinuation ||
      isReorderingDestination ||
      isReorderingUntimed
    ) {
      return undefined;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      newVisitEditorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const primaryInput = newVisitEditorRef.current?.querySelector('input[name="location_name"]');
      primaryInput?.focus?.({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    autoContinuationPrompt,
    draggedVisitId,
    editingId,
    foreignSameDayDragActive,
    isOpen,
    isReorderingDestination,
    isReorderingUntimed,
    isSavingAutoContinuation,
    isTransportEditor,
    reorderPreview,
  ]);

  useEffect(() => {
    if (!focusedItemId || !activeTimelineListRef.current) return;
    if (!visitItemIds.includes(focusedItemId)) return;
    if (
      isOpen ||
      draggedVisitId ||
      foreignSameDayDragActive ||
      reorderPreview ||
      autoContinuationPrompt ||
      isSavingAutoContinuation ||
      isReorderingDestination ||
      isReorderingUntimed
    ) {
      return;
    }

    const focusedCard = activeTimelineListRef.current.querySelector(`[data-timeline-item-id="${focusedItemId}"]`);
    focusedCard?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [
    autoContinuationPrompt,
    draggedVisitId,
    focusedItemId,
    foreignSameDayDragActive,
    isOpen,
    isReorderingDestination,
    isReorderingUntimed,
    isSavingAutoContinuation,
    reorderPreview,
    visitItemIds,
  ]);

  const activeDragItem = draggedVisitId ? visitItems.find((item) => item.id === draggedVisitId) || null : null;

  return {
    reorderPreview,
    setReorderPreview,
    isReorderingDestination,
    isReorderingUntimed,
    untimedDropNotice,
    dndSensors,
    draggedVisitId,
    dragOverlaySize,
    dragTarget,
    activeDayColumnRef,
    activeTimelineListRef,
    restrictTimelineDragToDayColumn,
    canDragVisit,
    handleSortableDragStart,
    handleSortableDragOver,
    handleSortableDragCancel,
    handleSortableDragEnd,
    confirmMoveReorder,
    activeDragItem,
  };
}
