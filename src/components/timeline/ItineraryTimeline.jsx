import ConflictNotice from "../ConflictNotice.jsx";
import { requestActiveEditorGuardResolution, requestActiveEditorHandoff, useActiveEditorGuard } from "../../app/activeEditorGuard.jsx";
import { memberName } from "../../lib/memberName.js";
import { formatMoney, formatTimeDisplay } from "../../lib/displayFormat.js";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { timelineCardSelectionColor } from "../../lib/collaboratorColors.js";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  defaultAnimateLayoutChanges,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Files,
  Lock,
  LockOpen,
  MapPin,
  MapPinPen,
  MessageCircleWarning,
  Navigation,
  Pencil,
  Plus,
  Repeat2,
  Search,
  Trash2,
  Wallet,
} from "lucide-react";
import { clearDraft, loadLatestDraftForEntity, useDraftAutosave } from "../../lib/draftAutosave.js";
import { planDestinationPackageReorder } from "../../lib/destinationPackages.js";
import { acquireEditLock, isLockedByAnotherUser, releaseEditLock } from "../../lib/editLocks.js";
import { resolveGoogleMapsShortUrl } from "../../lib/googleMapsShortLinkResolver.js";
import { buildGoogleMapsDirectionsUrl } from "../../lib/googleMapsNavigation.js";
import { googleMapsPointUrl, hasValidMapPoint, resolveDestinationMapUrlPoint } from "../../lib/mapPoint.js";
import { supabase } from "../../lib/supabase.js";
import { attachTimelineScheduleSortOrders, planTimelineSchedule, timelineScheduleOperationTypes } from "../../lib/timelineSchedulePlanner.js";
import { isTransportationCard, transportPairKey } from "../../lib/timelineTransportationRoles.js";
import { buildTransportPairSnapshot, buildTransportPairState, transportPairNeedsReview } from "../../lib/timelineTransportPairs.js";
import { timelineTypeLabels as typeLabels } from "../../lib/timelineTypeStyles.js";
import {
  formatDurationMinutes,
  minutesToTimeValue,
  normalizeTimelineTimeInput,
  parseDurationMinutes,
  timeToMinutes,
} from "../../lib/timelineTime.js";
import { transportCardTitle } from "../../lib/timelineTransportCategories.js";
import { buildExistingItemForm, buildNewTransportForm, buildNewVisitForm, buildTimelineItemSubmission } from "./timelineEditorForm.js";
import { timelineDraftEntityType } from "./timelineDrafts.js";
import useTimelineVisitDragSession from "./useTimelineVisitDragSession.js";
import TransportCategoryIcon from "./TransportCategoryIcon.jsx";
import {
  OutlinedField,
  TimelineDurationField,
  TimelineSegmentedTimeField,
  TimelineTypeField,
  TransportCategoryField,
  TransportDurationField,
} from "./TimelineFormFields.jsx";
import {
  isTimedVisit,
  isUntimedVisit,
  planMixedTimedVisitReorder,
  planUntimedVisitReorder,
  untimedOrderingErrorMessage,
} from "../../lib/timelineUntimedOrdering.js";
import { BodyPortal, FloatingOutlinedField, AutoGrowingTextarea } from "../FormControls.jsx";
import { timelineDragPresenceDebug, timelineCollaboratorColorKey } from "./timelinePresence.js";
import {
  typeColors,
  defaultTransportCategory,
  emptyItemForm,
  defaultVisitDurationMinutes,
  getDurationMinutes,
  sortedVisitItems,
  destinationReorderErrorMessage,
  timelineScheduleErrorMessage,
  timelineScheduleMajorEffect,
  timelineScheduleEffectKey,
  timelineScheduleUpdatedAtBaselines,
  isEffectiveFixedVisit,
  isInvalidTimeRange,
  formatTimelineOverlapError,
  findOverlappingVisitItem,
} from "./timelineItemRules.js";

const TimelineDragHandleContext = createContext(null);

function timelineAnimateLayoutChanges(args) {
  return args.isSorting ? defaultAnimateLayoutChanges(args) : false;
}

function SortableTimelineEntry({ children, disabled = false, hasFlowAttachments = false, id }) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    animateLayoutChanges: timelineAnimateLayoutChanges,
    disabled: { draggable: disabled, droppable: false },
    id,
  });
  const style = {
    transform: DndCSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      className={`timeline-flow-entry timeline-sortable-entry${hasFlowAttachments ? " has-flow-attachments" : ""}${
        isDragging ? " sortable-active-placeholder" : ""
      }`}
      data-sortable-visit-id={id}
      ref={setNodeRef}
      style={style}
    >
      <TimelineDragHandleContext.Provider value={disabled ? null : { attributes, listeners }}>
        {children}
      </TimelineDragHandleContext.Provider>
    </div>
  );
}

function TimelineDragHandle({ children, className = "" }) {
  const dragHandle = useContext(TimelineDragHandleContext);
  return (
    <div
      className={className}
      data-drag-handle={dragHandle ? "true" : undefined}
      {...(dragHandle?.attributes || {})}
      {...(dragHandle?.listeners || {})}
    >
      {children}
    </div>
  );
}

function TimelineFlowAttachment({ children }) {
  return (
    <div
      className="timeline-flow-attachment"
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function ExpandedBudgetRow({ budgets = [], emptyLabel = "尚未連動預算" }) {
  return (
    <div className="linked-budget-list">
      <div className="item-expanded-budget-heading">
        <Wallet aria-hidden="true" />
        <strong>{budgets.some(item=>item.expenseScope)?'支出':'預算'}</strong>
      </div>
      <div className="item-expanded-budget-content">
        <span className="item-expanded-section-divider" aria-hidden="true" />
        <div className="item-expanded-budget-tags">
          {budgets.length ? (
            budgets.map((budget) => (
              <span className="pill" key={budget.id}>
                {budget.title} · {formatMoney(budget.twd_amount ?? budget.amount)}
              </span>
            ))
          ) : (
            <span className="pill muted-text">{emptyLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ItineraryTimeline({
  activeDay = 0,
  activeTrip,
  alternativesByItem,
  budgetsByItem,
  canEdit,
  currentUserId,
  dayItems,
  dayDateLabel,
  dayLabel,
  dayTitle,
  disableDraftAutosave = false,
  focusedItemId,
  canPickMapPoint = false,
  isPickingMapPoint = false,
  isMapSearchReplaceActive = false,
  pickedMapPoint = null,
  foreignCardSelection = null,
  foreignDragPresence = null,
  foreignSameDayDragActive = false,
  headingEyebrow = "行程",
  members,
  onApplyAlternative,
  onClearDragPresence,
  onConfirmTransportWarning,
  onDeleteAlternative,
  onDeleteItem,
  onClearCardSelection,
  onFocusItem,
  onCancelMapPointPick,
  onCancelMapSearchReplace,
  onMapPointEditorActiveChange,
  onStartMapAddLocation,
  onStartMapSearchReplace,
  onStartMapPointPick,
  onPublishCardSelection,
  onPublishDragPresence,
  onReorderDestinationPackages,
  onReorderUntimedVisit,
  onSaveAlternative,
  onSaveItem,
  onToggleItemFixed,
  restoreDrafts = true,
  useEditLocks = true,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formSeed, setFormSeed] = useState(emptyItemForm);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  const [editorTripId, setEditorTripId] = useState(null);
  const [insertionPair, setInsertionPair] = useState(null);
  const [restoredDraftKey, setRestoredDraftKey] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [timeError, setTimeError] = useState("");
  const [mapUrlError, setMapUrlError] = useState("");
  const [isResolvingMapUrl, setIsResolvingMapUrl] = useState(false);
  const [isMapPointExpanded, setIsMapPointExpanded] = useState(false);
  const [durationInput, setDurationInput] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [alternativeFaceByItem, setAlternativeFaceByItem] = useState({});
  const [isAlternativeEditorOpen, setIsAlternativeEditorOpen] = useState(false);
  const [isAlternativeDeleteConfirmOpen, setIsAlternativeDeleteConfirmOpen] = useState(false);
  const [alternativeErrorByItem, setAlternativeErrorByItem] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [fixedNotice, setFixedNotice] = useState("");
  const [reorderPreview, setReorderPreview] = useState(null);
  const [isReorderingDestination, setIsReorderingDestination] = useState(false);
  const [isReorderingUntimed, setIsReorderingUntimed] = useState(false);
  const [untimedDropNotice, setUntimedDropNotice] = useState("");
  const [autoContinuationPrompt, setAutoContinuationPrompt] = useState(null);
  const [isSavingAutoContinuation, setIsSavingAutoContinuation] = useState(false);
  const { draftKey, flushDraft, form, hasUnsavedChanges, replaceForm, resetDraft, setForm } = useDraftAutosave({
    defaultForm: formSeed,
    disabled: disableDraftAutosave,
    editingId,
    entityType: timelineDraftEntityType,
    forceDirtyOnOpen: Boolean(restoredDraftKey),
    isOpen,
    serverUpdatedAt: baseUpdatedAt,
    tripId: activeTrip?.id,
    userId: currentUserId,
  });
  const memberById = new Map((members || []).map((member) => [member.user_id, member]));
  const foreignDragMember = foreignDragPresence?.userId ? memberById.get(foreignDragPresence.userId) : null;
  const foreignDragUserName = foreignDragPresence?.userName || (foreignDragMember ? memberName(foreignDragMember) : "其他成員");
  const foreignDragOverItemId = foreignSameDayDragActive ? foreignDragPresence?.overItemId : null;
  const foreignDragPlacement = foreignSameDayDragActive ? foreignDragPresence?.placement : null;
  const foreignDragSourceItemId = foreignSameDayDragActive ? foreignDragPresence?.itemId : null;
  const foreignDragColor = foreignSameDayDragActive
    ? timelineCardSelectionColor(
        timelineCollaboratorColorKey(
          foreignDragPresence?.userId,
          foreignDragPresence?.sessionId || foreignDragPresence?.dragId,
        ),
      )
    : "";
  const foreignDragStyle = foreignDragColor
    ? {
        "--timeline-remote-drag-color": foreignDragColor,
        "--timeline-remote-drag-color-soft": `${foreignDragColor}22`,
      }
    : undefined;
  const visibleForeignCardSelection =
    !foreignSameDayDragActive &&
    foreignCardSelection &&
    Number(foreignCardSelection.dayIndex) === Number(activeDay)
      ? foreignCardSelection
      : null;
  const canMutateThisDay = canEdit && !foreignSameDayDragActive;
  const foreignDragReadOnlyMessage = foreignSameDayDragActive
    ? `${foreignDragUserName} 正在拖曳，暫時鎖定此日編輯。`
    : "";
  const foreignDragSaveBlockedMessage = "此日行程正在被其他成員調整，請稍後再儲存。";
  const activeEditorGuardId = `timeline:${activeTrip?.id || "no-trip"}`;
  const activeEditorGuard = useMemo(
    () => ({
      discard: () => closeEditor(true),
      isActive: isOpen,
      isDirty: hasUnsavedChanges,
      needsHandoff: true,
      save: () => saveCurrentEditor(),
    }),
    [form, hasUnsavedChanges, isOpen, editingId, baseUpdatedAt, draftKey],
  );

  useActiveEditorGuard(activeEditorGuardId, { tripId: editorTripId || activeTrip?.id, workspace: "timeline" }, activeEditorGuard);

  useEffect(() => {
    setExpandedId(null);
  }, [activeDay, activeTrip?.id]);

  useEffect(() => {
    setExpandedId((current) => (current && current !== focusedItemId ? null : current));
  }, [focusedItemId]);

  const hasBlockingTimelineEditor = isOpen;
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
  const newVisitEditorRef = useRef(null);
  const visitDurationRef = useRef(null);
  const mapUrlApplyRef = useRef(false);
  const lastAppliedMapPointPickRef = useRef(null);
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
    if (!isOpen || !editorTripId || !activeTrip?.id || editorTripId === activeTrip.id) return;
    if (useEditLocks && editingId) {
      void releaseEditLock({ recordId: editingId, supabase, table: "itinerary_items", userId: currentUserId });
    }
    replaceForm(emptyItemForm);
    setFormSeed(emptyItemForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setMapUrlError("");
    setIsAlternativeEditorOpen(false);
    setAutoContinuationPrompt(null);
    setEditingId(null);
    setEditorTripId(null);
    setInsertionPair(null);
    setRestoredDraftKey(null);
    setIsOpen(false);
  }, [activeTrip?.id, currentUserId, editingId, editorTripId, isOpen, replaceForm, useEditLocks]);

  useEffect(() => {
    if (!restoreDrafts || isOpen || !activeTrip?.id || !currentUserId) return;
    const latest = loadLatestDraftForEntity({
      entityType: timelineDraftEntityType,
      tripId: activeTrip.id,
      userId: currentUserId,
    });
    if (!latest) return;
    const matchingItem = dayItems.find((item) => item.id === latest.entityId);
    if (latest.entityId !== "new" && !matchingItem) return;
    if (isEffectiveFixedVisit(matchingItem)) return;
    const nextForm = {
      ...latest.draft.form,
      start_time: formatTimeDisplay(latest.draft.form?.start_time),
      end_time: formatTimeDisplay(latest.draft.form?.end_time),
    };
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(latest.entityId === "new" ? latest.draft.serverUpdatedAt || null : matchingItem?.updated_at || null);
    setConflict(false);
    setTimeError("");
    setMapUrlError("");
    setIsAlternativeEditorOpen(false);
    setAutoContinuationPrompt(null);
    setEditingId(latest.entityId === "new" ? null : latest.entityId);
    setEditorTripId(activeTrip.id);
    setInsertionPair(null);
    setRestoredDraftKey(latest.key);
    setIsOpen(true);
  }, [activeTrip?.id, currentUserId, dayItems, isOpen, restoreDrafts]);

  async function openNewItem(initialPoint = null) {
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragReadOnlyMessage);
      return;
    }
    if (!initialPoint) onCancelMapPointPick?.();
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "timeline",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeEditor(true);
    }
    const nextForm = buildNewVisitForm({
      defaultForm: emptyItemForm,
      defaultVisitDurationMinutes,
      initialPoint,
      lastItem: sortedVisitItems(dayItems).at(-1),
    });
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setMapUrlError("");
    setIsMapPointExpanded(false);
    setIsAlternativeDeleteConfirmOpen(false);
    setIsAlternativeEditorOpen(false);
    setAutoContinuationPrompt(null);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setInsertionPair(null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function openNewTransport(previousItem, nextItem) {
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragReadOnlyMessage);
      return;
    }
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "timeline",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeEditor(true);
    }
    const nextForm = buildNewTransportForm({
      defaultForm: emptyItemForm,
      defaultTransportCategory,
      previousItem,
      nextItem,
      pairSnapshot: buildTransportPairSnapshot(previousItem, nextItem),
    });
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setMapUrlError("");
    setIsAlternativeEditorOpen(false);
    setAutoContinuationPrompt(null);
    setEditingId(null);
    setEditorTripId(activeTrip?.id || null);
    setInsertionPair(previousItem ? { fromId: previousItem.id, toId: nextItem?.id || null } : null);
    setRestoredDraftKey(null);
    setIsOpen(true);
    onFocusItem(nextItem?.id || previousItem?.id);
  }

  async function openEditItem(item, { openAlternative = false } = {}) {
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragReadOnlyMessage);
      return;
    }
    if (isEffectiveFixedVisit(item)) {
      setFixedNotice("此行程已固定，請先解鎖後再修改。");
      return;
    }
    if (useEditLocks && isLockedByAnotherUser(item, currentUserId)) return;
    const canOpenEditor = await requestActiveEditorHandoff({
      workspace: "timeline",
      excludeId: activeEditorGuardId,
      tripId: activeTrip?.id,
    });
    if (!canOpenEditor) return;
    if (isOpen && editingId !== item.id) {
      const canContinue = hasUnsavedChanges ? await requestActiveEditorGuardResolution({ tripId: editorTripId, onlyId: activeEditorGuardId }) : true;
      if (!canContinue) return;
      if (!hasUnsavedChanges) await closeEditor(true);
    }
    let lockedItem = item;
    if (useEditLocks) {
      const lockResult = await acquireEditLock({ record: item, supabase, table: "itinerary_items", userId: currentUserId });
      if (lockResult.error) return;
      if (lockResult.lockedByAnotherUser) return;
      lockedItem = lockResult.data || item;
    }
    const existingAlternative = (alternativesByItem[item.id] || [])[0] || null;
    const nextForm = buildExistingItemForm({ item, existingAlternative, defaultTransportCategory });
    flushDraft();
    replaceForm(nextForm);
    setFormSeed(nextForm);
    setBaseUpdatedAt(lockedItem.updated_at || item.updated_at || null);
    setConflict(false);
    setTimeError("");
    setMapUrlError("");
    setIsMapPointExpanded(false);
    setIsAlternativeEditorOpen(Boolean(openAlternative));
    setAutoContinuationPrompt(null);
    setEditingId(item.id);
    setEditorTripId(activeTrip?.id || null);
    setInsertionPair(null);
    setRestoredDraftKey(null);
    setIsOpen(true);
  }

  async function closeEditor(force = false) {
    if (!force && hasUnsavedChanges && !window.confirm("放棄尚未儲存的變更？")) return;
    if (useEditLocks && editingId) await releaseEditLock({ recordId: editingId, supabase, table: "itinerary_items", userId: currentUserId });
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyItemForm);
    setFormSeed(emptyItemForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setMapUrlError("");
    setIsMapPointExpanded(false);
    setIsAlternativeDeleteConfirmOpen(false);
    setIsAlternativeEditorOpen(false);
    setAutoContinuationPrompt(null);
    setEditingId(null);
    setEditorTripId(null);
    setInsertionPair(null);
    setRestoredDraftKey(null);
    onCancelMapPointPick?.();
    onCancelMapSearchReplace?.();
    setIsOpen(false);
  }

  async function saveCurrentEditor(formData = new FormData(), options = {}) {
    const itemType = String(formData.get("item_type") ?? form.item_type ?? "visit");
    const editingItem = editingId ? dayItems.find((item) => item.id === editingId) : null;
    if (foreignSameDayDragActive) {
      setTimeError(foreignDragSaveBlockedMessage);
      return false;
    }
    if (isEffectiveFixedVisit(editingItem)) {
      setTimeError("此行程已固定，請先解鎖後再修改。");
      return false;
    }
    const destination = String(formData.get("location_name") ?? form.location_name ?? form.location ?? "").trim();
    const submittedForm = {
      ...form,
      item_type: itemType,
      type: String(formData.get("type") ?? form.type ?? ""),
      start_time: String(formData.get("start_time") ?? form.start_time ?? ""),
      end_time: String(formData.get("end_time") ?? form.end_time ?? ""),
      title: destination || String(form.title ?? ""),
      location: destination,
      location_name: destination,
      address: String(formData.get("address") ?? form.address ?? ""),
      map_url: String(formData.get("map_url") ?? form.map_url ?? ""),
      note: String(formData.get("note") ?? form.note ?? form.description ?? ""),
      description: String(formData.get("description") ?? form.description ?? form.note ?? ""),
      transportation_note: String(formData.get("transportation_note") ?? form.transportation_note ?? ""),
      transport_category: String(formData.get("transport_category") ?? form.transport_category ?? defaultTransportCategory),
      transport_name: String(formData.get("transport_name") ?? form.transport_name ?? form.title ?? ""),
      transport_duration_minutes: String(formData.get("transport_duration_minutes") ?? form.transport_duration_minutes ?? ""),
      transport_note: String(formData.get("transport_note") ?? form.transport_note ?? form.transportation_note ?? ""),
      from_item_id: String(formData.get("from_item_id") ?? form.from_item_id ?? "") || null,
      to_item_id: String(formData.get("to_item_id") ?? form.to_item_id ?? "") || null,
      from_snapshot_start_time: String(formData.get("from_snapshot_start_time") ?? form.from_snapshot_start_time ?? "") || null,
      from_snapshot_end_time: String(formData.get("from_snapshot_end_time") ?? form.from_snapshot_end_time ?? "") || null,
      from_snapshot_destination: String(formData.get("from_snapshot_destination") ?? form.from_snapshot_destination ?? "") || null,
      to_snapshot_start_time: String(formData.get("to_snapshot_start_time") ?? form.to_snapshot_start_time ?? "") || null,
      to_snapshot_end_time: String(formData.get("to_snapshot_end_time") ?? form.to_snapshot_end_time ?? "") || null,
      to_snapshot_destination: String(formData.get("to_snapshot_destination") ?? form.to_snapshot_destination ?? "") || null,
      cost: String(formData.get("cost") ?? form.cost ?? 0),
    };
    if (submittedForm.item_type === "transport") {
      const transportCategory = submittedForm.transport_category.trim();
      const transportDurationMinutes = parseDurationMinutes(submittedForm.transport_duration_minutes);
      if (!transportCategory) {
        setTimeError("請選擇交通類別。");
        setForm(submittedForm);
        return false;
      }
      if (!Number.isInteger(transportDurationMinutes) || transportDurationMinutes <= 0) {
        setTimeError("交通時間請輸入大於 0 的整數分鐘。");
        setForm(submittedForm);
        return false;
      }
      submittedForm.transport_category = transportCategory;
      submittedForm.transport_duration_minutes = String(transportDurationMinutes);
      submittedForm.transport_name = submittedForm.transport_name.trim();
      submittedForm.title = submittedForm.transport_name;
      submittedForm.transportation_note = submittedForm.transport_note.trim();
      submittedForm.note = submittedForm.transport_note.trim();
      submittedForm.description = submittedForm.transport_note.trim();
    } else {
      const normalizedStart = normalizeTimelineTimeInput(submittedForm.start_time);
      const normalizedEnd = normalizeTimelineTimeInput(submittedForm.end_time);
      if (!normalizedStart.ok || !normalizedEnd.ok) {
        setTimeError("請輸入有效的 24 小時時間，例如 09:45。");
        setForm(submittedForm);
        return false;
      }
      submittedForm.start_time = normalizedStart.value;
      submittedForm.end_time = normalizedEnd.value;
      if (Boolean(submittedForm.start_time) !== Boolean(submittedForm.end_time)) {
        setTimeError("開始與結束時間必須同時設定，或同時清除。");
        setForm(submittedForm);
        return false;
      }
      submittedForm.address = "";
      submittedForm.transportation_note = "";
      submittedForm.cost = "0";
    }
    const invalidTimeRange =
      submittedForm.item_type !== "transport" && isInvalidTimeRange(submittedForm.start_time, submittedForm.end_time);
    if (invalidTimeRange) {
      setTimeError("結束時間必須晚於開始時間。");
      setForm(submittedForm);
      return false;
    }
    const overlapItem = findOverlappingVisitItem({
      dayIndex: activeDay,
      editingId,
      items: dayItems,
      payload: submittedForm,
    });
    if (overlapItem && !editingId) {
      setTimeError(formatTimelineOverlapError(overlapItem));
      setForm(submittedForm);
      return false;
    }
    const mapPointChanged =
      !editingItem ||
      String(submittedForm.map_url || "").trim() !== String(editingItem.map_url || "").trim() ||
      Number(submittedForm.latitude) !== Number(editingItem.latitude) ||
      Number(submittedForm.longitude) !== Number(editingItem.longitude);
    if (submittedForm.item_type !== "transport" && mapPointChanged) {
      if (isResolvingMapUrl) return false;
      setIsResolvingMapUrl(true);
      let mapUrlValidation;
      try {
        mapUrlValidation = await resolveDestinationMapUrlPoint(submittedForm.map_url, {
          resolveShortUrl: resolveGoogleMapsShortUrl,
        });
      } finally {
        setIsResolvingMapUrl(false);
      }
      if (!mapUrlValidation.ok) {
        setTimeError("");
        setMapUrlError(mapUrlValidation.errorMessage);
        setForm(submittedForm);
        return false;
      }
      if (mapUrlValidation.resolvedByShortLink && mapUrlValidation.expandedUrl) {
        submittedForm.map_url = mapUrlValidation.expandedUrl;
      }
      if (mapUrlValidation.point) {
        submittedForm.latitude = mapUrlValidation.point.latitude;
        submittedForm.longitude = mapUrlValidation.point.longitude;
      }
      setMapUrlError("");
    }
    const currentPairSnapshot =
      submittedForm.item_type === "transport"
        ? buildTransportPairSnapshot(
            dayItems.find((item) => item.id === submittedForm.from_item_id),
            dayItems.find((item) => item.id === submittedForm.to_item_id),
          )
        : {};
    let timelineScheduleOperation = null;
    let timelineSchedulePlan = null;
    let timelineScheduleExpectedVisitIds = null;
    let timelineScheduleItemBaselines = null;
    let timelineScheduleTargetId = editingId;
    if (editingId && submittedForm.item_type !== "transport") {
      const original = dayItems.find((item) => item.id === editingId);
      const originalTimed = isTimedVisit(original);
      const candidateTimed = Boolean(submittedForm.start_time && submittedForm.end_time);
      const timeChanged =
        (original?.start_time ? formatTimeDisplay(original.start_time) : null) !== (submittedForm.start_time || null) ||
        (original?.end_time ? formatTimeDisplay(original.end_time) : null) !== (submittedForm.end_time || null);
      if (timeChanged) {
        timelineScheduleOperation = {
          end_time: submittedForm.end_time || null,
          start_time: submittedForm.start_time || null,
          targetItemId: editingId,
          type: originalTimed && !candidateTimed
            ? timelineScheduleOperationTypes.clearTime
            : !originalTimed && candidateTimed
              ? timelineScheduleOperationTypes.restoreTime
              : timelineScheduleOperationTypes.editTime,
        };
      }
    } else if (submittedForm.item_type === "transport") {
      timelineScheduleTargetId = options.timelineScheduleTargetId || editingId || crypto.randomUUID();
      timelineScheduleOperation = {
        transport: {
          ...submittedForm,
          ...currentPairSnapshot,
          id: timelineScheduleTargetId,
          item_type: "transport",
          transport_role: "normal_pair",
        },
        type: timelineScheduleOperationTypes.upsertTransport,
      };
    }
    if (timelineScheduleOperation) {
      timelineScheduleExpectedVisitIds = visitItems.map((item) => item.id);
      timelineScheduleItemBaselines = timelineScheduleUpdatedAtBaselines(
        dayItems,
        editingId && baseUpdatedAt ? { [editingId]: baseUpdatedAt } : {},
      );
      timelineSchedulePlan = attachTimelineScheduleSortOrders({
        items: dayItems,
        plan: planTimelineSchedule({
          items: dayItems,
          operation: timelineScheduleOperation,
          orderedVisitIds: timelineScheduleExpectedVisitIds,
        }),
      });
      if (!timelineSchedulePlan.ok) {
        setTimeError(timelineScheduleErrorMessage(timelineSchedulePlan));
        setForm(submittedForm);
        return false;
      }
      const hasForeignLock = (timelineSchedulePlan.affectedItemIds || []).some((itemId) => {
        const item = dayItems.find((candidate) => candidate.id === itemId);
        return useEditLocks && item?.id !== editingId && isLockedByAnotherUser(item, currentUserId);
      });
      if (hasForeignLock) {
        setTimeError("後續行程目前由其他成員編輯，無法重新排程。");
        setForm(submittedForm);
        return false;
      }
      const effectKey = timelineScheduleEffectKey(timelineSchedulePlan);
      if (timelineSchedulePlan.requiresConfirmation && options.confirmedScheduleEffectKey !== effectKey) {
        setTimeError("");
        setForm(submittedForm);
        setAutoContinuationPrompt({
          effectKey,
          plan: timelineSchedulePlan,
          timelineScheduleTargetId,
          title: submittedForm.item_type === "transport"
            ? submittedForm.transport_name || submittedForm.title
            : submittedForm.location_name || submittedForm.location || submittedForm.title,
        });
        return false;
      }
    }
    let pendingAlternative = submittedForm.alternative_deleted ? null : submittedForm.alternative_draft;
    if (submittedForm.item_type !== "transport" && pendingAlternative) {
      const alternativeDestinationName = String(pendingAlternative.location_name || "").trim();
      if (!alternativeDestinationName) {
        setTimeError("");
        setAlternativeErrorByItem((current) => ({
          ...current,
          [editingId || "new"]: "請輸入備案目的地。",
        }));
        setForm(submittedForm);
        setIsAlternativeEditorOpen(true);
        return false;
      }
      const alternativeMapUrl = String(pendingAlternative.map_url || "").trim();
      const alternativeMapUrlChanged = alternativeMapUrl !== String(submittedForm.alternative_map_url_baseline || "").trim();
      if (alternativeMapUrl && alternativeMapUrlChanged) {
        if (isResolvingMapUrl) return false;
        setIsResolvingMapUrl(true);
        let alternativeMapValidation;
        try {
          alternativeMapValidation = await resolveDestinationMapUrlPoint(alternativeMapUrl, {
            resolveShortUrl: resolveGoogleMapsShortUrl,
          });
        } finally {
          setIsResolvingMapUrl(false);
        }
        if (!alternativeMapValidation.ok) {
          setTimeError("");
          setMapUrlError(alternativeMapValidation.errorMessage);
          setForm(submittedForm);
          setIsAlternativeEditorOpen(true);
          setIsMapPointExpanded(true);
          return false;
        }
        pendingAlternative = {
          ...pendingAlternative,
          map_url: alternativeMapValidation.expandedUrl || alternativeMapUrl,
          ...(alternativeMapValidation.point
            ? {
                latitude: alternativeMapValidation.point.latitude,
                longitude: alternativeMapValidation.point.longitude,
              }
            : {}),
        };
        submittedForm.alternative_draft = pendingAlternative;
      }
    }
    setTimeError("");
    resetAlternativeError(editingId || "new");
    const {
      alternative_deleted: pendingAlternativeDeleted,
      alternative_draft: ignoredAlternativeDraft,
      alternative_id: pendingAlternativeId,
      alternative_map_url_baseline: ignoredAlternativeMapUrlBaseline,
      ...itemSubmittedForm
    } = submittedForm;
    const result = await onSaveItem(
      buildTimelineItemSubmission({ itemSubmittedForm, currentPairSnapshot, defaultTransportCategory }),
      editingId,
      {
        baseUpdatedAt,
        tripId: editorTripId,
        confirmedScheduleEffect: options.confirmedScheduleEffectKey
          ? timelineScheduleMajorEffect(timelineSchedulePlan)
          : null,
        timelineScheduleExpectedVisitIds,
        timelineScheduleItemBaselines,
        timelineScheduleOperation,
        timelineSchedulePlan,
        timelineScheduleTargetId,
      },
    );
    if (!result?.ok) {
      if (result?.fixed) {
        setTimeError("此行程已固定，請先解鎖後再修改。");
        setForm(submittedForm);
      }
      if (result?.overlapError) {
        setTimeError(result.overlapError);
        setForm(submittedForm);
      }
      if (result?.baseUpdatedAt) setBaseUpdatedAt(result.baseUpdatedAt);
      if (result?.errorMessage) setTimeError(result.errorMessage);
      if (result?.conflict) setConflict(true);
      return false;
    }
    const savedItemId = editingId || result.data?.id;
    let alternativeResult = { ok: true };
    if (itemSubmittedForm.item_type !== "transport" && savedItemId) {
      if (pendingAlternativeDeleted && pendingAlternativeId) {
        alternativeResult = await onDeleteAlternative(pendingAlternativeId);
      } else if (pendingAlternative) {
        alternativeResult = await onSaveAlternative(
          savedItemId,
          {
            title: String(pendingAlternative.location_name || "").trim(),
            type: pendingAlternative.type || "attraction",
            start_time: itemSubmittedForm.start_time || "",
            end_time: itemSubmittedForm.end_time || "",
            cost: 0,
            location_name: String(pendingAlternative.location_name || "").trim(),
            description: String(pendingAlternative.description || "").trim(),
            address: String(pendingAlternative.address || "").trim(),
            map_url: String(pendingAlternative.map_url || "").trim(),
            latitude: pendingAlternative.latitude ?? null,
            longitude: pendingAlternative.longitude ?? null,
            transportation_note: "",
          },
          pendingAlternativeId || null,
        );
      }
    }
    if (!alternativeResult?.ok) {
      setForm(submittedForm);
      setBaseUpdatedAt(result.data?.updated_at || baseUpdatedAt);
      setAlternativeErrorByItem((current) => ({
        ...current,
        [editingId || "new"]: alternativeResult.error?.message || "備案儲存失敗，請稍後再試。",
      }));
      return false;
    }
    if (!disableDraftAutosave) clearDraft(draftKey);
    resetDraft(emptyItemForm);
    setFormSeed(emptyItemForm);
    setBaseUpdatedAt(null);
    setConflict(false);
    setTimeError("");
    setMapUrlError("");
    setAutoContinuationPrompt(null);
    setEditingId(null);
    setEditorTripId(null);
    setInsertionPair(null);
    setRestoredDraftKey(null);
    onCancelMapPointPick?.();
    setIsOpen(false);
    return true;
  }

  function cancelAutoContinuation() {
    if (isSavingAutoContinuation) return;
    setTimeError("");
    setAutoContinuationPrompt(null);
  }

  async function saveWithAutoContinuation() {
    if (!autoContinuationPrompt?.plan?.ok || isSavingAutoContinuation) return;
    if (foreignSameDayDragActive) {
      setTimeError(foreignDragSaveBlockedMessage);
      return;
    }
    setIsSavingAutoContinuation(true);
    await saveCurrentEditor(new FormData(), {
      confirmedScheduleEffectKey: autoContinuationPrompt.effectKey,
      timelineScheduleTargetId: autoContinuationPrompt.timelineScheduleTargetId,
    });
    setIsSavingAutoContinuation(false);
  }

  async function submit(event) {
    event.preventDefault();
    if (isAlternativeEditorOpen) return;
    await saveCurrentEditor(new FormData(event.currentTarget));
  }

  const isTransportEditor = form.item_type === "transport";
  const isAlternativeEditor = Boolean(isOpen && !isTransportEditor && isAlternativeEditorOpen);
  const activeVisitForm = isAlternativeEditor ? form.alternative_draft || {} : form;

  function updateActiveVisitForm(patch) {
    setForm((current) =>
      isAlternativeEditor
        ? { ...current, alternative_draft: { ...(current.alternative_draft || {}), ...patch }, alternative_deleted: false }
        : { ...current, ...patch },
    );
  }

  useEffect(() => {
    onMapPointEditorActiveChange?.({ canPick: Boolean(isOpen && !isTransportEditor), isOpen });
    return () => onMapPointEditorActiveChange?.({ canPick: false, isOpen: false });
  }, [isOpen, isTransportEditor, onMapPointEditorActiveChange]);

  useEffect(() => {
    if (!isOpen || isTransportEditor) return;
    const latitude = Number(activeVisitForm.latitude);
    const longitude = Number(activeVisitForm.longitude);
    const previewMapPoint = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? {
          itemId: editingId,
          latitude,
          locationName: activeVisitForm.location_name || activeVisitForm.location || activeVisitForm.title || "新增地點",
          longitude,
          mapUrl: activeVisitForm.map_url || googleMapsPointUrl(latitude, longitude),
          type: activeVisitForm.type,
        }
      : null;
    onMapPointEditorActiveChange?.({ canPick: true, isOpen: true, previewMapPoint });
  }, [
    editingId,
    activeVisitForm.latitude,
    activeVisitForm.location,
    activeVisitForm.location_name,
    activeVisitForm.longitude,
    activeVisitForm.map_url,
    activeVisitForm.title,
    activeVisitForm.type,
    isOpen,
    isTransportEditor,
    onMapPointEditorActiveChange,
  ]);

  useEffect(() => {
    if (!pickedMapPoint?.pickedAt || lastAppliedMapPointPickRef.current === pickedMapPoint.pickedAt) return;
    if (pickedMapPoint.source === "places-details" && !isMapSearchReplaceActive) {
      lastAppliedMapPointPickRef.current = pickedMapPoint.pickedAt;
      void openNewItem(pickedMapPoint);
      return;
    }
    if (pickedMapPoint.source === "map-add") {
      lastAppliedMapPointPickRef.current = pickedMapPoint.pickedAt;
      void openNewItem(pickedMapPoint);
      return;
    }
    if (!isOpen || isTransportEditor) return;
    lastAppliedMapPointPickRef.current = pickedMapPoint.pickedAt;
    const latitude = Number(pickedMapPoint.latitude);
    const longitude = Number(pickedMapPoint.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    setMapUrlError("");
    updateActiveVisitForm({
      ...(pickedMapPoint.source === "places-replace"
        ? {
            title: pickedMapPoint.displayName || activeVisitForm.title,
            location: pickedMapPoint.displayName || activeVisitForm.location,
            location_name: pickedMapPoint.displayName || activeVisitForm.location_name,
          }
        : {}),
      latitude,
      longitude,
      map_url: googleMapsPointUrl(latitude, longitude),
    });
    if (pickedMapPoint.source === "places-replace") onCancelMapSearchReplace?.();
  }, [activeVisitForm, isAlternativeEditor, isMapSearchReplaceActive, isOpen, isTransportEditor, onCancelMapSearchReplace, pickedMapPoint, setForm]);

  useEffect(() => {
    if (!isOpen || isTransportEditor) return;
    const duration = getDurationMinutes(form.start_time, form.end_time);
    if (document.activeElement?.name !== "duration_minutes") {
      setDurationInput(duration ? formatDurationMinutes(duration) : editingId ? "" : formatDurationMinutes(defaultVisitDurationMinutes));
    }
  }, [editingId, form.end_time, form.start_time, isOpen, isTransportEditor]);

  useEffect(() => {
    if (!isOpen || isTransportEditor) return undefined;
    const bindings = [[visitDurationRef.current, handleDurationWheel]].filter(([element]) => Boolean(element));
    bindings.forEach(([element, handler]) => element.addEventListener("wheel", handler, { passive: false }));
    return () => bindings.forEach(([element, handler]) => element.removeEventListener("wheel", handler));
  }, [form.end_time, form.start_time, isOpen, isTransportEditor]);
  const visitItems = useMemo(() => sortedVisitItems(dayItems), [dayItems]);
  const visitItemIds = useMemo(() => visitItems.map((item) => item.id), [visitItems]);
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
  const timedVisitItems = useMemo(() => visitItems.filter(isTimedVisit), [visitItems]);
  const { adjacentTransportByPair, invalidTransportItems, passiveUntimedTransportByFrom } = useMemo(
    () => buildTransportPairState(dayItems, visitItems),
    [dayItems, visitItems],
  );

  function alternativeDestination(alternative) {
    return alternative?.location_name || alternative?.title || alternative?.address || "未命名備案";
  }

  function visitDestination(item) {
    return item?.location_name || item?.location || item?.title || "未命名行程";
  }

  function emptyAlternativeForm(item) {
    return {
      type: item.type || "attraction",
      cost: 0,
      location_name: "",
      description: "",
      address: item.address || "",
      map_url: item.map_url || "",
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      transportation_note: item.transportation_note || "",
    };
  }

  function resetAlternativeError(itemId) {
    setAlternativeErrorByItem((current) => {
      if (!current[itemId]) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  async function flipAlternativeFace(item, alternative) {
    if (foreignSameDayDragActive) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [item.id]: foreignDragSaveBlockedMessage,
      }));
      return;
    }
    if (isEffectiveFixedVisit(item)) {
      setFixedNotice("此行程已固定，請先解鎖後再修改。");
      return;
    }
    resetAlternativeError(item.id);
    if (!alternative) return;
    if (typeof onApplyAlternative !== "function") return;
    const result = await onApplyAlternative(item, alternative);
    if (result?.ok === false) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [item.id]: result.error?.message || "Alternative apply failed. Please try again.",
      }));
      return;
    }
    setAlternativeFaceByItem((current) => ({ ...current, [item.id]: false }));
  }

  async function deleteAlternative(itemId, alternativeId) {
    const parentItem = dayItems.find((item) => item.id === itemId);
    if (foreignSameDayDragActive) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [itemId]: foreignDragSaveBlockedMessage,
      }));
      return;
    }
    if (isEffectiveFixedVisit(parentItem)) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [itemId]: "此行程已固定，請先解鎖後再修改。",
      }));
      return;
    }
    resetAlternativeError(itemId);
    const result = await onDeleteAlternative(alternativeId);
    if (result?.ok === false) {
      setAlternativeErrorByItem((current) => ({
        ...current,
        [itemId]: result.error?.message || "Alternative delete failed. Please try again.",
      }));
      return;
    }
    setAlternativeFaceByItem((current) => ({ ...current, [itemId]: false }));
  }

  function relatedTransportItemsFor(item) {
    if (!item || isTransportationCard(item)) return [];
    return dayItems.filter(
      (dayItem) => isTransportationCard(dayItem) && (dayItem.from_item_id === item.id || dayItem.to_item_id === item.id),
    );
  }

  function requestDeleteItem(item) {
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragReadOnlyMessage);
      return;
    }
    if (isEffectiveFixedVisit(item)) {
      setFixedNotice("此行程已固定，請先解鎖後再修改。");
      return;
    }
    setDeleteTarget(item);
  }

  async function toggleItemFixed(item) {
    if (!item || isTransportationCard(item) || typeof onToggleItemFixed !== "function") return;
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragReadOnlyMessage);
      return;
    }
    if (!isTimedVisit(item)) {
      setFixedNotice("未設定完整時間的行程不能固定。");
      return;
    }
    if (!item.is_fixed) {
      if (editingId === item.id || (isOpen && form.item_type !== "transport" && editingId === item.id)) {
        setFixedNotice("此行程正在編輯中，請結束編輯後再鎖定。");
        return;
      }
      if (useEditLocks && item.locked_by) {
        setFixedNotice("此行程目前有人正在編輯，暫時無法鎖定。");
        return;
      }
    }
    setFixedNotice("");
    await onToggleItemFixed(item);
  }

  async function confirmDeleteTarget() {
    if (!deleteTarget) return;
    if (foreignSameDayDragActive) {
      setFixedNotice(foreignDragSaveBlockedMessage);
      setDeleteTarget(null);
      return;
    }
    const target = deleteTarget;
    setDeleteTarget(null);
    await onDeleteItem(target.id);
  }

  function renderTransportEditorForm() {
    const category = form.transport_category || defaultTransportCategory;
    const editorRouteItem = { ...form, id: editingId || "transport-editor" };
    const { fromItem, toItem } = transportEndpointItems(editorRouteItem);
    const editorNavigationUrl = buildGoogleMapsDirectionsUrl({
      fromItem,
      toItem,
      transportCategory: category,
    });
    const editorHeadingTitle = transportCardTitle(form) || "新增交通資訊";

    return (
      <form autoComplete="off" className="item-form transport-editor-form" onSubmit={submit}>
        <input name="item_type" type="hidden" value="transport" />
        <input name="type" type="hidden" value="transport" />
        <input name="start_time" type="hidden" value={form.start_time || ""} />
        <input name="from_item_id" type="hidden" value={form.from_item_id || ""} />
        <input name="to_item_id" type="hidden" value={form.to_item_id || ""} />
        <input name="from_snapshot_start_time" type="hidden" value={form.from_snapshot_start_time || ""} />
        <input name="from_snapshot_end_time" type="hidden" value={form.from_snapshot_end_time || ""} />
        <input name="from_snapshot_destination" type="hidden" value={form.from_snapshot_destination || ""} />
        <input name="to_snapshot_start_time" type="hidden" value={form.to_snapshot_start_time || ""} />
        <input name="to_snapshot_end_time" type="hidden" value={form.to_snapshot_end_time || ""} />
        <input name="to_snapshot_destination" type="hidden" value={form.to_snapshot_destination || ""} />
        {conflict ? <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeEditor(true)} /> : null}
        {foreignSameDayDragActive ? (
          <div className="notice inline-error" role="alert">
            <span>{foreignDragSaveBlockedMessage}</span>
          </div>
        ) : null}
        <div className="transport-editor-heading">
          <span className="transport-icon" aria-hidden="true">
            <TransportCategoryIcon category={category} />
          </span>
          <strong>{editorHeadingTitle}</strong>
        </div>
        <div className="transport-editor-edit-mode">
          <div className="form-grid wide transport-editor-route-row">
            <TransportCategoryField
              value={category}
              onValueChange={(transportCategory) => setForm({ ...form, transport_category: transportCategory })}
            />
            <TransportDurationField
              value={form.transport_duration_minutes}
              onValueChange={(transportDurationMinutes) =>
                setForm({ ...form, transport_duration_minutes: transportDurationMinutes })
              }
            />
            {renderTransportNavigationControl(editorNavigationUrl, "mini-button transport-navigation-button transport-editor-navigation-button")}
          </div>
          <FloatingOutlinedField className="transport-editor-name-field" label="交通名稱">
            <input
              aria-label="交通名稱"
              autoComplete="off"
              name="transport_name"
              placeholder="交通名稱"
              value={form.transport_name}
              onChange={(event) => setForm({ ...form, transport_name: event.target.value, title: event.target.value })}
            />
          </FloatingOutlinedField>
          <FloatingOutlinedField className="transport-editor-note-field" label="備註">
            <AutoGrowingTextarea
              aria-label="備註"
              autoComplete="off"
              name="transport_note"
              placeholder="備註"
              rows="2"
              value={form.transport_note}
              onChange={(event) =>
                setForm({
                  ...form,
                  transport_note: event.target.value,
                  transportation_note: event.target.value,
                  note: event.target.value,
                  description: event.target.value,
                })
              }
            />
          </FloatingOutlinedField>
          <div className="transport-editor-footer-actions navigation-only">
            <div className="transport-editor-save-actions">
              <button className="primary-button compact transport-editor-action-button" disabled={!canMutateThisDay} type="submit">
                保存
              </button>
              <button className="ghost-button compact transport-editor-action-button item-form-cancel-button" type="button" onClick={() => closeEditor()}>
                取消
              </button>
            </div>
          </div>
        </div>
      </form>
    );
  }
  function transportPairLabel(item) {
    const fromItem = dayItems.find((dayItem) => dayItem.id === item.from_item_id);
    const toItem = dayItems.find((dayItem) => dayItem.id === item.to_item_id);
    const fromLabel = fromItem?.location_name || fromItem?.location || fromItem?.title || "已移除景點";
    const toLabel = item.to_item_id
      ? toItem?.location_name || toItem?.location || toItem?.title || "已移除景點"
      : "下一目的地尚未設定";
    return `${fromLabel} → ${toLabel}`;
  }

  function transportEndpointItems(item) {
    return {
      fromItem: dayItems.find((dayItem) => dayItem.id === item.from_item_id) || null,
      toItem: dayItems.find((dayItem) => dayItem.id === item.to_item_id) || null,
    };
  }

  function renderTransportNavigationControl(navigationUrl, className = "mini-button transport-navigation-button") {
    if (navigationUrl) {
      return (
        <a
          aria-label="導航"
          className={className}
          href={navigationUrl}
          target="_blank"
          rel="noreferrer"
          title="導航"
          onClick={(event) => event.stopPropagation()}
        >
          <Navigation aria-hidden="true" />
        </a>
      );
    }
    return (
      <button
        aria-label="導航"
        className={className}
        disabled
        type="button"
        title="請先設定兩端景點地圖位置"
        onClick={(event) => event.stopPropagation()}
      >
        <Navigation aria-hidden="true" />
      </button>
    );
  }

  function renderTransportCard(item, lockedByOther, options = {}) {
    const { warningType = "" } = options;
    const isInvalidWarning = warningType === "invalid";
    const isGeneralWarning = warningType === "general";
    const isUntimedWarning = warningType === "untimed";
    const hasWarning = Boolean(warningType);
    const warningClass = isInvalidWarning ? "invalid" : isGeneralWarning ? "general" : warningType;
    const expanded = expandedId === item.id;
    const budgets = budgetsByItem[item.id] || [];
    const category = item.transport_category || defaultTransportCategory;
    const note = item.transport_note || item.transportation_note || item.description || item.note;
    const { fromItem, toItem } = transportEndpointItems(item);
    const navigationUrl = buildGoogleMapsDirectionsUrl({ fromItem, toItem, transportCategory: category });
    const remoteSelection = visibleForeignCardSelection?.itemId === item.id ? visibleForeignCardSelection : null;
    const remoteSelectionColor = remoteSelection ? timelineCardSelectionColor(remoteSelection.colorKey) : "";
    const remoteSelectionStyle = remoteSelection
      ? {
          "--timeline-remote-selection-color": remoteSelectionColor,
          "--timeline-remote-selection-color-soft": `${remoteSelectionColor}18`,
        }
      : undefined;
    return (
      <article
        className={`transport-card${focusedItemId === item.id ? " focused" : ""}${expanded ? " expanded" : ""}${
          hasWarning ? ` warning ${warningClass}-warning` : ""
        }${remoteSelection ? " timeline-item-remote-selected" : ""}`}
        data-remote-selection-label={remoteSelection?.userName || undefined}
        style={remoteSelectionStyle}
        onClick={() => {
          focusOrToggleTimelineCard(item);
        }}
      >
        <span className="transport-card-icon" aria-hidden="true">
          <span className="transport-icon" aria-hidden="true">
            <TransportCategoryIcon category={category} />
          </span>
        </span>
        <div className="transport-card-main">
          <strong>{transportCardTitle(item)}</strong>
          {hasWarning ? (
            <span className="transport-warning-badge" aria-label="交通資訊需確認">
              <MessageCircleWarning aria-hidden="true" />
            </span>
          ) : null}
        </div>
        <div className="transport-card-nav">
          {renderTransportNavigationControl(navigationUrl)}
        </div>
        {expanded ? (
          <>
            {isInvalidWarning ? (
              <p className="transport-warning-detail">
                {transportPairLabel(item)} 的交通資訊已不符合目前行程順序
              </p>
            ) : null}
            {isGeneralWarning ? (
              <p className="transport-warning-detail">
                {`${transportPairLabel(item)} 的行程時間或目的地已變更，請確認交通資訊。`}
              </p>
            ) : null}
            {isUntimedWarning ? (
              <p className="transport-warning-detail">目的地時間未設定，請重新確認交通卡。</p>
            ) : null}
            <div className="transport-card-details">
              <p className="transport-note-detail">{note || "尚未填寫"}</p>
              <ExpandedBudgetRow budgets={budgets} emptyLabel="尚未連結預算" />
            </div>
            <div className="transport-card-actions">
              {isGeneralWarning ? (
                <button
                  className="mini-button"
                  disabled={!canMutateThisDay || lockedByOther}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onConfirmTransportWarning?.(item.id);
                  }}
                >
                  確認
                </button>
              ) : null}
              {renderTransportNavigationControl(navigationUrl)}
              <button
                className="mini-button"
                disabled={!canMutateThisDay || lockedByOther}
                type="button"
                title="編輯"
                onClick={(event) => {
                  event.stopPropagation();
                  openEditItem(item);
                }}
              >
                <Pencil aria-hidden="true" />
              </button>
              <button
                className="mini-button"
                disabled={!canMutateThisDay}
                type="button"
                title="刪除"
                onClick={(event) => {
                  event.stopPropagation();
                  requestDeleteItem(item);
                }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </>
        ) : null}
      </article>
    );
  }

  function focusOrToggleTimelineCard(item) {
    setExpandedId((current) =>
      focusedItemId === item.id ? (current === item.id ? null : item.id) : null,
    );
    onFocusItem(item.id);
    if (typeof onPublishCardSelection === "function") onPublishCardSelection(item);
  }

  function renderTransportInsert(previousItem, nextItem) {
    if (!canMutateThisDay || isOpen || !nextItem || isTransportationCard(previousItem) || isTransportationCard(nextItem)) return null;
    if (adjacentTransportByPair[transportPairKey(previousItem.id, nextItem.id)]) return null;
    return (
      <button
        className="transport-insert-zone"
        type="button"
        onClick={() => openNewTransport(previousItem, nextItem)}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="transport-insert-icon" aria-hidden="true">
          <Plus />
        </span>
        <span className="transport-insert-label">新增交通資訊</span>
        <span className="transport-insert-line" aria-hidden="true" />
      </button>
    );
  }

  function toggleMapPointPick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!canPickMapPoint) return;
    if (isPickingMapPoint) onCancelMapPointPick?.();
    else onStartMapPointPick?.();
  }

  function updateVisitTime(field, nextValue, preservedDuration = null) {
    setTimeError("");
    if (field === "start_time") {
      if (!nextValue) {
        setForm({ ...form, start_time: "", end_time: "" });
        return;
      }
      const duration = Number(
        preservedDuration
        || getDurationMinutes(form.start_time, form.end_time)
        || (!editingId ? defaultVisitDurationMinutes : 0),
      );
      const startMinutes = timeToMinutes(nextValue);
      const nextEnd =
        startMinutes !== null && Number.isFinite(duration) && duration > 0
          ? minutesToTimeValue(startMinutes + duration)
          : form.end_time;
      setForm({ ...form, start_time: nextValue, end_time: nextEnd || form.end_time });
      return;
    }
    setForm(nextValue ? { ...form, end_time: nextValue } : { ...form, start_time: "", end_time: "" });
  }

  function commitDurationInput(rawValue) {
    const text = String(rawValue || "").trim();
    const numeric = parseDurationMinutes(text);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setTimeError("停留時間請輸入大於 0 的分鐘數。");
      return false;
    }
    const duration = Math.min(24 * 60 - 5, Math.max(5, Math.round(numeric / 5) * 5));
    const start = timeToMinutes(form.start_time);
    if (start === null) return false;
    const nextEnd = minutesToTimeValue(start + duration);
    if (!nextEnd) {
      setTimeError("停留時間不可超過當日 24:00。");
      return false;
    }
    setTimeError("");
    setDurationInput(formatDurationMinutes(duration));
    setForm({ ...form, end_time: nextEnd });
    return true;
  }

  function handleDurationWheel(event) {
    event.preventDefault();
    const start = timeToMinutes(form.start_time);
    const current = Number(getDurationMinutes(form.start_time, form.end_time));
    if (start === null || !Number.isFinite(current)) return;
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextDuration = Math.min(24 * 60 - 5, Math.max(5, current + direction * 5));
    const nextEnd = minutesToTimeValue(start + nextDuration);
    if (!nextEnd) return;
    setTimeError("");
    setDurationInput(formatDurationMinutes(nextDuration));
    setForm({ ...form, end_time: nextEnd });
  }

  async function applyMapUrlDraft() {
    if (mapUrlApplyRef.current || !String(activeVisitForm.map_url || "").trim()) return;
    mapUrlApplyRef.current = true;
    setIsResolvingMapUrl(true);
    let result;
    try {
      result = await resolveDestinationMapUrlPoint(activeVisitForm.map_url, { resolveShortUrl: resolveGoogleMapsShortUrl });
    } finally {
      mapUrlApplyRef.current = false;
      setIsResolvingMapUrl(false);
    }
    if (!result.ok) {
      setMapUrlError(result.errorMessage);
      return;
    }
    const nextUrl = result.expandedUrl || activeVisitForm.map_url;
    setMapUrlError("");
    setIsAlternativeEditorOpen(false);
    updateActiveVisitForm({ latitude: result.point.latitude, longitude: result.point.longitude, map_url: nextUrl });
  }

  const hasEditorMapPoint = hasValidMapPoint(activeVisitForm);
  const editorMapsUrl = hasEditorMapPoint
    ? activeVisitForm.map_url || googleMapsPointUrl(activeVisitForm.latitude, activeVisitForm.longitude)
    : "";

  function openAlternativeEditor() {
    const parentItem = editingId ? dayItems.find((item) => item.id === editingId) : form;
    if (!form.alternative_draft) {
      const nextAlternative = emptyAlternativeForm(parentItem || form);
      setForm({
        ...form,
        alternative_draft: nextAlternative,
        alternative_deleted: false,
        alternative_map_url_baseline: nextAlternative.map_url || "",
      });
    }
    resetAlternativeError(editingId || "new");
    setMapUrlError("");
    setIsMapPointExpanded(false);
    onCancelMapPointPick?.();
    onCancelMapSearchReplace?.();
    setIsAlternativeDeleteConfirmOpen(false);
    setIsAlternativeEditorOpen(true);
  }

  function returnToMainEditor() {
    setMapUrlError("");
    setIsMapPointExpanded(false);
    onCancelMapPointPick?.();
    onCancelMapSearchReplace?.();
    setIsAlternativeDeleteConfirmOpen(false);
    setIsAlternativeEditorOpen(false);
  }

  function stageAlternativeDeletion() {
    setForm({ ...form, alternative_draft: null, alternative_deleted: Boolean(form.alternative_id) });
    setMapUrlError("");
    setIsMapPointExpanded(false);
    onCancelMapPointPick?.();
    onCancelMapSearchReplace?.();
    setIsAlternativeDeleteConfirmOpen(false);
    setIsAlternativeEditorOpen(false);
  }

  function renderEditorMapSettings({ includeAlternative = false } = {}) {
    const pendingAlternative = form.alternative_deleted ? null : form.alternative_draft;
    const isMapPointBodyVisible = isAlternativeEditor || isMapPointExpanded;
    return (
      <div className={`visit-map-point-section${isMapPointBodyVisible ? " expanded" : ""}${isAlternativeEditor ? " always-expanded" : ""}`}>
        <div className="visit-map-point-header">
          {isAlternativeEditor ? (
            <div className="visit-settings-heading visit-map-point-static-title">
              <MapPin aria-hidden="true" />
              <span>地圖點位</span>
            </div>
          ) : (
            <button className="visit-map-point-toggle" type="button" aria-expanded={isMapPointExpanded} onClick={() => setIsMapPointExpanded((current) => !current)}>
              <ChevronRight aria-hidden="true" />
              <span>{includeAlternative ? "更多設定" : "更改地點"}</span>
            </button>
          )}
          <a
            aria-disabled={!editorMapsUrl}
            className={`ghost-button compact visit-maps-link${editorMapsUrl ? "" : " disabled"}`}
            href={editorMapsUrl || undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => { if (!editorMapsUrl) event.preventDefault(); }}
          >
            <span>Google Map</span>
            <ExternalLink aria-hidden="true" />
          </a>
        </div>
        {isMapPointBodyVisible ? (
          <div className="visit-map-point-body">
            {!isAlternativeEditor ? (
              <div className="visit-settings-heading">
                <MapPin aria-hidden="true" />
                <span>地圖點位</span>
              </div>
            ) : null}
            <div className="visit-map-point-actions">
              <button className={`ghost-button compact map-point-picker-button${isPickingMapPoint ? " active" : ""}`} disabled={!canPickMapPoint} type="button" onClick={toggleMapPointPick}>
                <MapPinPen aria-hidden="true" />
                <span>{isPickingMapPoint ? "取消選點" : "調整點位"}</span>
              </button>
              <button
                className={`ghost-button compact visit-map-search-replace-button${isMapSearchReplaceActive ? " active" : ""}`}
                disabled={!canPickMapPoint}
                type="button"
                onClick={() => {
                  onCancelMapPointPick?.();
                  if (isMapSearchReplaceActive) onCancelMapSearchReplace?.();
                  else onStartMapSearchReplace?.();
                }}
              >
                <Search aria-hidden="true" />
                <span>{isMapSearchReplaceActive ? "取消搜尋" : "搜尋替換"}</span>
              </button>
            </div>
            <OutlinedField className="visit-map-url-editor" invalid={Boolean(mapUrlError)} label="Google Maps URL">
              <input
                aria-invalid={Boolean(mapUrlError)}
                aria-label="Google Maps URL"
                autoComplete="off"
                name={includeAlternative ? "map_url" : undefined}
                placeholder="貼上 Google Maps 連結"
                value={activeVisitForm.map_url || ""}
                onChange={(event) => { setMapUrlError(""); updateActiveVisitForm({ map_url: event.target.value }); }}
                onBlur={() => { if (!isAlternativeEditor) void applyMapUrlDraft(); }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.stopPropagation();
                  void applyMapUrlDraft();
                }}
              />
            </OutlinedField>
            {mapUrlError ? <span className="field-inline-error visit-map-url-error" role="alert">{mapUrlError}</span> : null}
            {includeAlternative ? (
              <div className="visit-alternative-settings">
                <div className="visit-settings-divider" />
                <div className="visit-settings-heading">
                  <Files aria-hidden="true" />
                  <span>備案</span>
                </div>
                {pendingAlternative ? (
                  <button className="visit-alternative-summary" type="button" onClick={openAlternativeEditor}>
                    <span>
                      {`${typeLabels[pendingAlternative.type] || typeLabels.attraction} ・ ${alternativeDestination(pendingAlternative)}`}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                ) : (
                  <button className="visit-alternative-summary visit-alternative-create-summary" type="button" onClick={openAlternativeEditor}>
                    <span><Plus aria-hidden="true" />建立備案</span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ) : includeAlternative ? <input name="map_url" type="hidden" value={form.map_url} /> : null}
      </div>
    );
  }

  function renderVisitEditorForm() {
    const alternativeError = alternativeErrorByItem[editingId || "new"];
    const originalDestination = form.location_name || form.location || form.title || "未命名行程";
    return (
      <form autoComplete="off" className="item-form" onSubmit={submit}>
        <input name="item_type" type="hidden" value="visit" />
        {isAlternativeEditor ? (
          <>
            <div className="alternative-editor-heading">
              <span className="form-mode-label">{form.alternative_id ? "編輯備案" : "新增備案"}</span>
              <span className="alternative-origin-label">{`原行程：${originalDestination}`}</span>
            </div>
            {alternativeError ? (
              <div className="notice inline-error" role="alert"><span>{alternativeError}</span></div>
            ) : null}
            <div className="visit-editor-primary-row">
              <TimelineTypeField value={activeVisitForm.type || "attraction"} onValueChange={(type) => updateActiveVisitForm({ type })} />
              <OutlinedField className="destination-field" label="備案目的地">
                <input
                  aria-label="備案目的地"
                  autoComplete="off"
                  placeholder="請輸入備案目的地"
                  required
                  value={activeVisitForm.location_name || ""}
                  onChange={(event) => updateActiveVisitForm({ title: event.target.value, location_name: event.target.value })}
                />
              </OutlinedField>
            </div>
            <FloatingOutlinedField className="full-label visit-note-field" label="備註">
              <AutoGrowingTextarea
                aria-label="備註"
                autoComplete="off"
                placeholder="備註"
                rows="2"
                value={activeVisitForm.description || ""}
                onChange={(event) => updateActiveVisitForm({ description: event.target.value })}
              />
            </FloatingOutlinedField>
            {renderEditorMapSettings()}
            <div className="form-actions alternative-editor-actions">
              {form.alternative_id ? (
                <button className="ghost-button danger compact alternative-editor-delete-button" type="button" onClick={() => setIsAlternativeDeleteConfirmOpen(true)}>
                  <Trash2 aria-hidden="true" />
                  <span>刪除備案</span>
                </button>
              ) : null}
              <button className="ghost-button compact alternative-editor-return-button" type="button" onClick={returnToMainEditor}>
                <ChevronLeft aria-hidden="true" />
                <span>返回主行程</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="form-mode-label">{editingId ? "編輯行程" : "新增行程"}</div>
            {conflict ? <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeEditor(true)} /> : null}
            {timeError ? <div className="notice inline-error" role="alert"><span>{timeError}</span></div> : null}
            {alternativeError ? <div className="notice inline-error" role="alert"><span>{alternativeError}</span></div> : null}
            {foreignSameDayDragActive ? <div className="notice inline-error" role="alert"><span>{foreignDragSaveBlockedMessage}</span></div> : null}
            <div className="visit-editor-primary-row">
              <TimelineTypeField value={form.type} onValueChange={(type) => setForm({ ...form, type })} />
              <OutlinedField className="destination-field" label="目的地">
                <input aria-label="目的地" autoComplete="off" placeholder="請輸入目的地名稱" name="location_name" required value={form.location_name || form.location} onChange={(event) => setForm({ ...form, title: event.target.value, location: event.target.value, location_name: event.target.value })} />
              </OutlinedField>
            </div>
            <div className="visit-editor-time-row">
              <TimelineSegmentedTimeField label="開始" name="start_time" value={form.start_time} onValueChange={(nextValue) => updateVisitTime("start_time", nextValue, getDurationMinutes(form.start_time, form.end_time))} />
              <span className="visit-time-link" aria-hidden="true" />
              <TimelineSegmentedTimeField label="結束" name="end_time" value={form.end_time} onValueChange={(nextValue) => updateVisitTime("end_time", nextValue)} />
              <span className="visit-time-link" aria-hidden="true" />
              <TimelineDurationField disabled={!form.start_time} inputRef={visitDurationRef} maxMinutes={Math.max(0, 24 * 60 - 5 - (timeToMinutes(form.start_time) || 0))} value={durationInput} onCommit={commitDurationInput} onInputChange={setDurationInput} />
            </div>
            <FloatingOutlinedField className="full-label visit-note-field" label="備註">
              <AutoGrowingTextarea aria-label="備註" autoComplete="off" name="description" placeholder="備註" rows="2" value={form.description || form.note} onChange={(event) => setForm({ ...form, note: event.target.value, description: event.target.value })} />
            </FloatingOutlinedField>
            {renderEditorMapSettings({ includeAlternative: true })}
            <div className="form-actions">
              <button className="ghost-button item-form-cancel-button" type="button" onClick={() => closeEditor()}>取消</button>
              <button className="primary-button compact" disabled={!canMutateThisDay || isResolvingMapUrl} type="submit">儲存</button>
            </div>
          </>
        )}
      </form>
    );
  }

  function renderAlternativeSummary(item, alternative, isAlternativeFace) {
    const alternativeError = alternativeErrorByItem[item.id];
    const relatedHeading = isAlternativeFace ? "原行程" : "備案";
    const relatedType = isAlternativeFace
      ? typeLabels[item.type] || typeLabels.attraction
      : typeLabels[alternative?.type] || typeLabels.attraction;
    const relatedDestination = isAlternativeFace ? visitDestination(item) : alternativeDestination(alternative);
    const alternativeFlipButton = !isEffectiveFixedVisit(item) ? (
      <button
        className="alternative-flip-button"
        disabled={!alternative || !canMutateThisDay}
        type="button"
        title={alternative ? "切換原行程與備案" : "尚未建立備案"}
        aria-label={alternative ? "切換原行程與備案" : "尚未建立備案"}
        onClick={(event) => {
          event.stopPropagation();
          flipAlternativeFace(item, alternative);
        }}
      >
        <Repeat2 aria-hidden="true" />
      </button>
    ) : null;
    return (
      <>
        {alternativeError ? (
          <div className="notice inline-error" role="alert">
            <span>{alternativeError}</span>
          </div>
        ) : null}
        {alternative ? (
          <div className="item-expanded-alternative">
            <div className="visit-settings-heading item-expanded-alternative-heading">
              <Files aria-hidden="true" />
              <span>{relatedHeading}</span>
            </div>
            <div className="item-expanded-alternative-content">
              <span className="item-expanded-section-divider" aria-hidden="true" />
              <div className="item-expanded-alternative-summary">
                <span>{`${relatedType}・${relatedDestination}`}</span>
              </div>
            </div>
          </div>
        ) : null}
        {alternativeFlipButton}
      </>
    );
  }

  const deleteRelatedTransports = relatedTransportItemsFor(deleteTarget);
  const deleteTargetIsTransport = isTransportationCard(deleteTarget);
  const deleteTitle = deleteTargetIsTransport ? "確認刪除交通資訊？" : "確認刪除行程？";
  const deleteMessage = deleteTargetIsTransport
    ? "此操作無法復原。"
    : deleteRelatedTransports.length
      ? "關聯的交通卡將被一併移除，此操作無法復原。"
      : "此操作無法復原。";
  return (
    <>
    <BodyPortal>
    {isAlternativeDeleteConfirmOpen ? (
      <div className="modal-backdrop">
        <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="alternative-delete-confirm-title">
          <h2 id="alternative-delete-confirm-title">確認刪除備案？</h2>
          <p>刪除狀態會在儲存主行程時一併套用。</p>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setIsAlternativeDeleteConfirmOpen(false)}>取消</button>
            <button className="ghost-button danger" type="button" onClick={stageAlternativeDeletion}>刪除備案</button>
          </div>
        </div>
      </div>
    ) : null}
    {deleteTarget ? (
      <div className="modal-backdrop">
        <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <h2 id="delete-confirm-title">{deleteTitle}</h2>
          <p>{deleteMessage}</p>
          <div className="form-actions">
            <button className="ghost-button" type="button" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button className="primary-button compact" disabled={!canMutateThisDay} type="button" onClick={confirmDeleteTarget}>
              確認刪除
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {autoContinuationPrompt ? (
      <div className="modal-backdrop">
        <div
          className="dialog-card"
          data-testid="auto-continuation-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auto-continuation-title"
        >
          <h2 id="auto-continuation-title">套用重大排程變更？</h2>
          {autoContinuationPrompt.plan.automaticUntimedItemIds?.length ? (
            <p>部分後續行程無法排入固定行程前或當日 24:00 前，將改為未設定時間。</p>
          ) : null}
          {autoContinuationPrompt.plan.removedTransportIds?.length ? (
            <p>這次變更會移除不再連接相鄰行程的交通卡。</p>
          ) : null}
          <p>固定行程與不受影響的前後區段不會移動。</p>
          {timeError ? <p className="notice inline-error">{timeError}</p> : null}
          <div className="form-actions">
            <button
              className="ghost-button"
              disabled={isSavingAutoContinuation}
              type="button"
              onClick={cancelAutoContinuation}
            >
              取消
            </button>
            <button
              className="primary-button compact"
              disabled={!canMutateThisDay || isSavingAutoContinuation || !autoContinuationPrompt.plan.ok}
              type="button"
              onClick={saveWithAutoContinuation}
            >
              確定套用
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {reorderPreview ? (
      <div className="modal-backdrop">
        <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="reorder-confirm-title">
          <h2 id="reorder-confirm-title">確認移動行程？</h2>
          <p>移動行程卡後，部分交通卡可能會自動移除</p>
          <div className="form-actions">
            <button
              className="ghost-button"
              disabled={isReorderingDestination || isReorderingUntimed}
              type="button"
              onClick={() => setReorderPreview(null)}
            >
              取消
            </button>
            <button
              className="primary-button compact"
              disabled={!canMutateThisDay || isReorderingDestination || isReorderingUntimed}
              type="button"
              onClick={confirmMoveReorder}
            >
              確定
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </BodyPortal>
    <div className="timeline-day-column active" data-day-index={activeDay} ref={activeDayColumnRef} style={{ order: activeDay }}>
      <div className="panel-heading timeline-column-header">
        <div className="timeline-column-title">
          <p className="eyebrow">{dayTitle || headingEyebrow}</p>
          <h3>{dayDateLabel || dayLabel}</h3>
        </div>
        <button
          className="icon-button timeline-add-button"
          disabled={!canMutateThisDay}
          type="button"
          title="新增行程"
          aria-label="新增行程"
          onClick={onStartMapAddLocation || (() => void openNewItem())}
        >
          <Plus aria-hidden="true" />
          <MapPin aria-hidden="true" />
        </button>
      </div>

      {fixedNotice ? (
        <div className="notice inline-error" role="alert">
          <span>{fixedNotice}</span>
          <button type="button" onClick={() => setFixedNotice("")}>
            X
          </button>
        </div>
      ) : null}

      {untimedDropNotice ? (
        <p className="timeline-drag-hint" role="status">
          {untimedDropNotice}
        </p>
      ) : null}

      {foreignSameDayDragActive ? (
        <p className="timeline-remote-drag-hint" role="status">
          {foreignDragReadOnlyMessage}
        </p>
      ) : null}

      {invalidTransportItems.length ? (
        <div className="transport-warning-stack" aria-label="需確認交通資訊">
          {invalidTransportItems.map((item) => (
            <div className="timeline-flow-entry" key={item.id}>
              {isOpen && isTransportEditor && editingId === item.id
                ? renderTransportEditorForm()
                : renderTransportCard(item, useEditLocks && isLockedByAnotherUser(item, currentUserId), { warningType: "invalid" })}
            </div>
          ))}
          <div className="transport-warning-divider" aria-hidden="true" />
        </div>
      ) : null}

      {isOpen && isTransportEditor && !editingId && !insertionPair ? renderTransportEditorForm() : null}

      <DndContext
        collisionDetection={closestCenter}
        modifiers={[restrictTimelineDragToDayColumn]}
        onDragCancel={handleSortableDragCancel}
        onDragEnd={handleSortableDragEnd}
        onDragOver={handleSortableDragOver}
        onDragStart={handleSortableDragStart}
        sensors={dndSensors}
      >
      <SortableContext items={visitItemIds} strategy={verticalListSortingStrategy}>
      <div
        className="timeline"
        data-dnd-preview={draggedVisitId ? "active" : undefined}
        ref={activeTimelineListRef}
        onClick={(event) => {
          if (event.target === event.currentTarget && typeof onClearCardSelection === "function") onClearCardSelection();
        }}
      >
        {visitItems.length ? (
          visitItems.map((item, index) => {
            const lockedByOther = useEditLocks && isLockedByAnotherUser(item, currentUserId);
            const locker = memberById.get(item.locked_by);
            const alternative = (alternativesByItem[item.id] || [])[0] || null;
            const isExpanded = expandedId === item.id;
            const isItemFixed = isEffectiveFixedVisit(item);
            const isAlternativeFace = isExpanded && Boolean(alternative) && Boolean(alternativeFaceByItem[item.id]);
            const displayItem =
              isAlternativeFace && alternative
                ? {
                    ...item,
                    ...alternative,
                    item_type: "visit",
                    type: alternative.type || item.type,
                    cost: alternative.cost || 0,
                    start_time: item.start_time || "",
                    end_time: item.end_time || "",
                    location: alternative.location_name || "",
                    note: alternative.description || "",
                    description: alternative.description || "",
                    transportation_note: alternative.transportation_note || "",
                }
                : item;
            const destination = visitDestination(displayItem);
            const secondaryText = displayItem.note || displayItem.description || displayItem.transportation_note;
            const linkedBudgetTotal = (budgetsByItem[item.id] || []).reduce(
              (sum, budget) => sum + Number(budget.twd_amount ?? budget.amount ?? 0),
              0,
            );
            const displayCost = (budgetsByItem[item.id] || []).length ? linkedBudgetTotal : Number(displayItem.cost || 0);
            const nextItem = visitItems[index + 1];
            const isTimedPair = isTimedVisit(item) && isTimedVisit(nextItem);
            const pairKey = isTimedPair ? transportPairKey(item.id, nextItem.id) : "";
            const transportItem = pairKey ? adjacentTransportByPair[pairKey] : null;
            const transportNeedsReview = transportItem && transportPairNeedsReview(transportItem, item, nextItem);
            const transportWarningType = transportNeedsReview ? "general" : "";
            const passiveUntimedTransportItems = passiveUntimedTransportByFrom[item.id] || [];
            const isAddingTransportHere =
              isTimedPair &&
              isOpen &&
              isTransportEditor &&
              !editingId &&
              insertionPair?.fromId === item.id &&
              insertionPair?.toId === nextItem.id;
            const isEditingVisitHere = isOpen && !isTransportEditor && editingId === item.id;
            const isDragEnabled = canDragVisit(item);
            const isDisabledDragTarget = dragTarget?.itemId === item.id && dragTarget.disabled;
            const isForeignDragSource = foreignDragSourceItemId === item.id;
            const remoteSelection = visibleForeignCardSelection?.itemId === item.id ? visibleForeignCardSelection : null;
            const remoteSelectionColor = remoteSelection ? timelineCardSelectionColor(remoteSelection.colorKey) : "";
            const remoteSelectionStyle = remoteSelection
              ? {
                  "--timeline-remote-selection-color": remoteSelectionColor,
                  "--timeline-remote-selection-color-soft": `${remoteSelectionColor}18`,
                }
              : undefined;
            const hasAttachedTransportFlow =
              (!isAddingTransportHere && Boolean(transportItem)) ||
              passiveUntimedTransportItems.length > 0;
            return (
            <Fragment key={item.id}>
            <SortableTimelineEntry disabled={!isDragEnabled} hasFlowAttachments={hasAttachedTransportFlow} id={item.id}>
            {foreignDragOverItemId === item.id && foreignDragPlacement === "before" ? (
              <div className="timeline-remote-insertion-line" aria-hidden="true" style={foreignDragStyle} />
            ) : null}
            {isEditingVisitHere ? (
              renderVisitEditorForm()
            ) : (
            <article
              className={`timeline-item${focusedItemId === item.id ? " focused" : ""}${isExpanded ? " expanded" : ""}${
                isItemFixed ? " fixed" : ""
              }${isDragEnabled ? " drag-enabled" : ""}${draggedVisitId === item.id ? " dragging" : ""}${
                isDisabledDragTarget ? " drag-target-disabled" : ""
              }${remoteSelection ? " timeline-item-remote-selected" : ""}${
                isForeignDragSource ? " timeline-item-remote-drag-source" : ""
              }`}
              data-dnd-overlay-source={draggedVisitId === item.id ? "true" : undefined}
              data-remote-selection-label={remoteSelection?.userName || undefined}
              data-timeline-item-id={item.id}
              data-timing={isTimedVisit(item) ? "timed" : "untimed"}
              style={isForeignDragSource ? foreignDragStyle : remoteSelectionStyle}
              title={hasBlockingTimelineEditor ? "請先儲存或放棄目前編輯，再重排行程" : undefined}
              onClick={() => {
                if (isPickingMapPoint) return;
                focusOrToggleTimelineCard(item);
              }}
            >
              <span className="destination-sequence-badge">{index + 1}</span>
              <TimelineDragHandle className="time-block">
                <span>{isTimedVisit(item) ? formatTimeDisplay(item.start_time) : "--:--"}</span>
                <span className="time-connector" aria-hidden="true" />
                <span>{isTimedVisit(item) ? formatTimeDisplay(item.end_time) : ""}</span>
              </TimelineDragHandle>
              <div className="item-main">
                <h4>{destination}</h4>
                {secondaryText ? (
                  <p className="item-summary">{secondaryText}</p>
                ) : (
                  <p className="item-summary item-summary-placeholder" aria-hidden="true">
                    &nbsp;
                  </p>
                )}
                <div className="item-meta">
                  <span
                    className="pill"
                    style={{ background: `${typeColors[displayItem.type]}22`, color: typeColors[displayItem.type] }}
                  >
                    {typeLabels[displayItem.type]}
                  </span>
                  {displayCost > 0 ? <span className="pill">{formatMoney(displayCost)}</span> : null}
                  {alternative ? (
                    <span className="pill">備案</span>
                  ) : null}
                </div>
                {lockedByOther ? <div className="lock-note">{memberName(locker)} 正在編輯這筆資料</div> : null}
              </div>
              <div className="item-actions">
                {isTimedVisit(item) && (!isAlternativeFace || isItemFixed) ? (
                  <button
                    className="mini-button lock-button"
                    disabled={!canMutateThisDay || (!isItemFixed && (lockedByOther || Boolean(item.locked_by)))}
                    type="button"
                    title={isItemFixed ? "解鎖" : "鎖定"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleItemFixed(item);
                    }}
                  >
                    {isItemFixed ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
                  </button>
                ) : null}
                {!isAlternativeFace && !isItemFixed ? (
                  <button
                    className="mini-button"
                    disabled={!canMutateThisDay || lockedByOther}
                    type="button"
                    title="編輯"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditItem(item);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                ) : null}
                {isAlternativeFace && alternative && !isItemFixed ? (
                  <button
                    className="mini-button"
                    disabled={!canMutateThisDay || lockedByOther}
                    type="button"
                    title="編輯備案"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditItem(item, { openAlternative: true });
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                ) : null}
                {!isItemFixed ? (
                  <button
                    className="mini-button"
                    disabled={!canMutateThisDay}
                    type="button"
                    title="刪除"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isAlternativeFace && alternative) {
                        deleteAlternative(item.id, alternative.id);
                      } else {
                        requestDeleteItem(item);
                      }
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {isExpanded ? (
                <div className="item-expanded-content">
                  <div className="item-details">
                    {displayItem.description || displayItem.note ? (
                      <p className="item-detail-note">{displayItem.description || displayItem.note}</p>
                    ) : null}
                    {displayItem.address ? <p>地址：{displayItem.address}</p> : null}
                    {displayItem.transportation_note ? <p>交通：{displayItem.transportation_note}</p> : null}
                    <ExpandedBudgetRow budgets={budgetsByItem[item.id] || []} />
                  </div>
                  {renderAlternativeSummary(item, alternative, isAlternativeFace)}
                  {displayItem.map_url ? (
                    <a className="ghost-button compact visit-maps-link item-expanded-map-link" href={displayItem.map_url} rel="noreferrer" target="_blank">
                      <span>Google Map</span>
                      <ExternalLink aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </article>
            )}
            {!isAddingTransportHere && isTimedPair && !transportItem ? renderTransportInsert(item, nextItem) : null}
            {!isAddingTransportHere && transportItem ? (
              <TimelineFlowAttachment>
                {isOpen && isTransportEditor && editingId === transportItem.id
                  ? renderTransportEditorForm()
                  : renderTransportCard(transportItem, useEditLocks && isLockedByAnotherUser(transportItem, currentUserId), {
                      warningType: transportWarningType,
                    })}
              </TimelineFlowAttachment>
            ) : null}
            {passiveUntimedTransportItems.map((passiveTransportItem) => (
              <TimelineFlowAttachment key={passiveTransportItem.id}>
                {isOpen && isTransportEditor && editingId === passiveTransportItem.id
                  ? renderTransportEditorForm()
                  : renderTransportCard(
                      passiveTransportItem,
                      useEditLocks && isLockedByAnotherUser(passiveTransportItem, currentUserId),
                      { warningType: "untimed" },
                    )}
              </TimelineFlowAttachment>
            ))}
            {foreignDragOverItemId === item.id && foreignDragPlacement === "after" ? (
              <div className="timeline-remote-insertion-line" aria-hidden="true" style={foreignDragStyle} />
            ) : null}
            </SortableTimelineEntry>
            {isAddingTransportHere ? renderTransportEditorForm() : null}
            </Fragment>
            );
          })
        ) : (
          <div className="timeline-empty">這一天還沒有行程</div>
        )}
      </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeDragItem ? (
          <article
            className="timeline-item timeline-drag-overlay-card"
            data-dnd-drag-overlay="true"
            data-timing={isTimedVisit(activeDragItem) ? "timed" : "untimed"}
            style={
              dragOverlaySize
                ? {
                    "--timeline-drag-overlay-height": `${dragOverlaySize.height}px`,
                    "--timeline-drag-overlay-width": `${dragOverlaySize.width}px`,
                  }
                : undefined
            }
          >
            <div className="time-block">
              <span>{isTimedVisit(activeDragItem) ? formatTimeDisplay(activeDragItem.start_time) : "--:--"}</span>
              <span className="time-connector" aria-hidden="true" />
              <span>{isTimedVisit(activeDragItem) ? formatTimeDisplay(activeDragItem.end_time) : ""}</span>
            </div>
            <div className="item-main">
              <h4>{visitDestination(activeDragItem)}</h4>
              {activeDragItem.note || activeDragItem.description || activeDragItem.transportation_note ? (
                <p className="item-summary">
                  {activeDragItem.note || activeDragItem.description || activeDragItem.transportation_note}
                </p>
              ) : (
                <p className="item-summary item-summary-placeholder" aria-hidden="true">
                  &nbsp;
                </p>
              )}
              <div className="item-meta">
                <span
                  className="pill"
                  style={{ background: `${typeColors[activeDragItem.type]}22`, color: typeColors[activeDragItem.type] }}
                >
                  {typeLabels[activeDragItem.type]}
                </span>
              </div>
            </div>
          </article>
        ) : null}
      </DragOverlay>
      </DndContext>
      {isOpen && !isTransportEditor && !editingId ? (
        <div className="timeline-add-editor-anchor" data-timeline-add-editor="true" ref={newVisitEditorRef}>
          {renderVisitEditorForm()}
        </div>
      ) : null}
    </div>
    </>
  );
}
