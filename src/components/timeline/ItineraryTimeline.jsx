import { memberName } from "../../lib/memberName.js";
import { formatMoney, formatTimeDisplay } from "../../lib/displayFormat.js";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { timelineCardSelectionColor } from "../../lib/collaboratorColors.js";
import { closestCenter, DndContext, DragOverlay } from "@dnd-kit/core";
import { defaultAnimateLayoutChanges, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import {
  ExternalLink,
  Files,
  Lock,
  LockOpen,
  MapPin,
  MessageCircleWarning,
  Navigation,
  Pencil,
  Plus,
  Repeat2,
  Trash2,
  Wallet,
} from "lucide-react";
import { isLockedByAnotherUser } from "../../lib/editLocks.js";
import { buildGoogleMapsDirectionsUrl } from "../../lib/googleMapsNavigation.js";
import { isTransportationCard, transportPairKey } from "../../lib/timelineTransportationRoles.js";
import { buildTransportPairState, transportPairNeedsReview } from "../../lib/timelineTransportPairs.js";
import { timelineTypeLabels as typeLabels } from "../../lib/timelineTypeStyles.js";
import { transportCardTitle } from "../../lib/timelineTransportCategories.js";
import TransportCategoryIcon from "./TransportCategoryIcon.jsx";
import { isTimedVisit } from "../../lib/timelineUntimedOrdering.js";
import { BodyPortal } from "../FormControls.jsx";
import { timelineCollaboratorColorKey } from "./timelinePresence.js";
import { typeColors, defaultTransportCategory, sortedVisitItems, isEffectiveFixedVisit } from "./timelineItemRules.js";
import { useTimelineEditor } from "./useTimelineEditor.jsx";
import { useTimelineReorder } from "./useTimelineReorder.js";

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

  const [expandedId, setExpandedId] = useState(null);
  const [alternativeFaceByItem, setAlternativeFaceByItem] = useState({});
  const [alternativeErrorByItem, setAlternativeErrorByItem] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [fixedNotice, setFixedNotice] = useState("");
  const visitItems = useMemo(() => sortedVisitItems(dayItems), [dayItems]);
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
  const {
    isOpen,
    editingId,
    insertionPair,
    timeError,
    isAlternativeDeleteConfirmOpen,
    setIsAlternativeDeleteConfirmOpen,
    autoContinuationPrompt,
    isSavingAutoContinuation,
    form,
    newVisitEditorRef,
    openNewItem,
    openNewTransport,
    openEditItem,
    cancelAutoContinuation,
    saveWithAutoContinuation,
    isTransportEditor,
    alternativeDestination,
    visitDestination,
    resetAlternativeError,
    stageAlternativeDeletion,
    renderTransportEditorForm,
    renderVisitEditorForm,
  } = useTimelineEditor({
    onStartMapSearchReplace,
    alternativeErrorByItem,
    canMutateThisDay,
    transportEndpointItems,
    renderTransportNavigationControl,
    activeTrip,
    alternativesByItem,
    currentUserId,
    dayItems,
    onDeleteAlternative,
    onFocusItem,
    onCancelMapPointPick,
    onCancelMapSearchReplace,
    onMapPointEditorActiveChange,
    onStartMapPointPick,
    onSaveAlternative,
    onSaveItem,
    activeDay,
    disableDraftAutosave,
    canPickMapPoint,
    isPickingMapPoint,
    isMapSearchReplaceActive,
    pickedMapPoint,
    foreignSameDayDragActive,
    restoreDrafts,
    useEditLocks,
    setAlternativeErrorByItem,
    setFixedNotice,
    foreignDragReadOnlyMessage,
    foreignDragSaveBlockedMessage,
    visitItems,
  });

  useEffect(() => {
    setExpandedId(null);
  }, [activeDay, activeTrip?.id]);

  useEffect(() => {
    setExpandedId((current) => (current && current !== focusedItemId ? null : current));
  }, [focusedItemId]);

  const hasBlockingTimelineEditor = isOpen;

  const visitItemIds = useMemo(() => visitItems.map((item) => item.id), [visitItems]);

  const timedVisitItems = useMemo(() => visitItems.filter(isTimedVisit), [visitItems]);
  const { adjacentTransportByPair, invalidTransportItems, passiveUntimedTransportByFrom } = useMemo(
    () => buildTransportPairState(dayItems, visitItems),
    [dayItems, visitItems],
  );

  const {
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
  } = useTimelineReorder({
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
  });

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
