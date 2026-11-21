import { timelineEditorFields } from "./timelineEditorFields.jsx";
import { requestActiveEditorGuardResolution, requestActiveEditorHandoff, useActiveEditorGuard } from "../../app/activeEditorGuard.jsx";
import { formatTimeDisplay } from "../../lib/displayFormat.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { clearDraft, loadLatestDraftForEntity, useDraftAutosave } from "../../lib/draftAutosave.js";
import { acquireEditLock, isLockedByAnotherUser, releaseEditLock } from "../../lib/editLocks.js";
import { resolveGoogleMapsShortUrl } from "../../lib/googleMapsShortLinkResolver.js";
import { googleMapsPointUrl, hasValidMapPoint, resolveDestinationMapUrlPoint } from "../../lib/mapPoint.js";
import { supabase } from "../../lib/supabase.js";
import { attachTimelineScheduleSortOrders, planTimelineSchedule, timelineScheduleOperationTypes } from "../../lib/timelineSchedulePlanner.js";
import { buildTransportPairSnapshot } from "../../lib/timelineTransportPairs.js";
import {
  formatDurationMinutes,
  minutesToTimeValue,
  normalizeTimelineTimeInput,
  parseDurationMinutes,
  timeToMinutes,
} from "../../lib/timelineTime.js";
import { buildExistingItemForm, buildNewTransportForm, buildNewVisitForm, buildTimelineItemSubmission } from "./timelineEditorForm.js";
import { timelineDraftEntityType } from "./timelineDrafts.js";
import { isTimedVisit } from "../../lib/timelineUntimedOrdering.js";
import {
  defaultTransportCategory,
  emptyItemForm,
  defaultVisitDurationMinutes,
  getDurationMinutes,
  sortedVisitItems,
  timelineScheduleErrorMessage,
  timelineScheduleMajorEffect,
  timelineScheduleEffectKey,
  timelineScheduleUpdatedAtBaselines,
  isEffectiveFixedVisit,
  isInvalidTimeRange,
  formatTimelineOverlapError,
  findOverlappingVisitItem,
} from "./timelineItemRules.js";

export function useTimelineEditor({
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
  const [isAlternativeEditorOpen, setIsAlternativeEditorOpen] = useState(false);
  const [isAlternativeDeleteConfirmOpen, setIsAlternativeDeleteConfirmOpen] = useState(false);
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

  const newVisitEditorRef = useRef(null);
  const visitDurationRef = useRef(null);
  const mapUrlApplyRef = useRef(false);
  const lastAppliedMapPointPickRef = useRef(null);

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

  const { renderTransportEditorForm, renderVisitEditorForm } = timelineEditorFields({
    onCancelMapPointPick,
    onCancelMapSearchReplace,
    onStartMapSearchReplace,
    canPickMapPoint,
    isPickingMapPoint,
    isMapSearchReplaceActive,
    foreignSameDayDragActive,
    editingId,
    conflict,
    setConflict,
    timeError,
    mapUrlError,
    setMapUrlError,
    isResolvingMapUrl,
    isMapPointExpanded,
    setIsMapPointExpanded,
    durationInput,
    setDurationInput,
    setIsAlternativeDeleteConfirmOpen,
    alternativeErrorByItem,
    form,
    setForm,
    canMutateThisDay,
    foreignDragSaveBlockedMessage,
    visitDurationRef,
    closeEditor,
    submit,
    isAlternativeEditor,
    activeVisitForm,
    updateActiveVisitForm,
    alternativeDestination,
    transportEndpointItems,
    renderTransportNavigationControl,
    toggleMapPointPick,
    updateVisitTime,
    commitDurationInput,
    applyMapUrlDraft,
    editorMapsUrl,
    openAlternativeEditor,
    returnToMainEditor,
  });

  return {
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
  };
}
