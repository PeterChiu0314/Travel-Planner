import { memberInitial, memberName } from "../../lib/memberName.js";
import { todayInput } from "../../lib/displayFormat.js";
import {
  dateRangeDayCount,
  formatHeaderDate,
  initialDateSelectionStep,
  isDateBefore,
  parseDateOnly,
  parseDateTextInput,
  startOfMonth,
} from "../../lib/tripDateUi.js";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import TripDateRangeSelector from "./TripDateRangeSelector.jsx";
import { HeaderMemberPresencePreview, TripDateChangePreview, TripHeaderIcon } from "./TripHeaderParts.jsx";
import useTripHeaderDestinationEditor from "./useTripHeaderDestinationEditor.js";
import useTripHeaderTitleEditor from "./useTripHeaderTitleEditor.js";
import {
  tripStageLabel,
  tripDestinationParts,
  combineTripDestination,
  destinationPatchFromParts,
  buildTripHeaderMeta,
} from "./tripDetails.js";
import { buildTripDateChangePreview } from "./tripDateChange.js";

function HeaderMemberPreview({ disabled, members = [], onOpen, pendingCount = 0 }) {
  const approvedMembers = members.filter((member) => member.status === "approved");
  const visibleMembers = approvedMembers.slice(0, 4);
  const overflowCount = Math.max(approvedMembers.length - visibleMembers.length, 0);
  return (
    <button
      className="trip-header-member-preview"
      type="button"
      title="成員與邀請"
      aria-label="成員與邀請"
      disabled={disabled}
      onClick={onOpen}
    >
      <span className="trip-header-member-avatars" aria-hidden="true">
        {visibleMembers.map((member) => (
          <span className="member-avatar compact" key={member.id || member.user_id} title={memberName(member)}>
            {memberInitial(member)}
          </span>
        ))}
        {overflowCount > 0 ? <span className="member-avatar compact more">+{overflowCount}</span> : null}
      </span>
      {pendingCount > 0 ? <span className="trip-header-member-pending">待審 {pendingCount}</span> : null}
      <span className="trip-header-member-open-button" aria-hidden="true">
        <TripHeaderIcon name="invite" />
      </span>
    </button>
  );
}

export function TripHeader({
  activeSection,
  trip,
  members = [],
  currentUserId,
  days = [],
  dateChangePreviewData = {},
  demoNotice = "",
  demoStage,
  canEditTrip = false,
  canChangeTripDates = canEditTrip,
  canOpenMembers = canEditTrip,
  canRenameTrip = canEditTrip,
  canShare = canEditTrip,
  canViewDatePopover = canChangeTripDates,
  pendingMemberCount = 0,
  onDelete,
  onAiExchange,
  onExport,
  onInvite,
  onOpenMembers,
  onPresenceNavigate,
  onShare,
  onUpdateTrip,
  onUpdateTripDateRange,
  remotePresenceByUser = new Map(),
  showDeveloperTools = false,
}) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isDeveloperToolsOpen, setIsDeveloperToolsOpen] = useState(false);
  const [developerStartDateDraft, setDeveloperStartDateDraft] = useState("");
  const [developerEndDateDraft, setDeveloperEndDateDraft] = useState("");
  const [developerToolsError, setDeveloperToolsError] = useState("");
  const [isApplyingDeveloperDates, setIsApplyingDeveloperDates] = useState(false);
  const [isDatePopoverOpen, setIsDatePopoverOpen] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState("");
  const [endDateDraft, setEndDateDraft] = useState("");
  const [originalStartDate, setOriginalStartDate] = useState("");
  const [originalEndDate, setOriginalEndDate] = useState("");
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [dateSelectionStep, setDateSelectionStep] = useState("start");
  const [isDateRemovalConfirmed, setIsDateRemovalConfirmed] = useState(false);
  const [hoveredDate, setHoveredDate] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDateOnly(todayInput()) || new Date()));
  const [dateError, setDateError] = useState("");
  const [isSavingDates, setIsSavingDates] = useState(false);
  const menuRef = useRef(null);
  const developerStartDateRef = useRef(null);
  const developerDateSaveRef = useRef(false);
  const datePopoverRef = useRef(null);
  const dateButtonRef = useRef(null);
  const dateDialogRef = useRef(null);
  const startDateTextInputRef = useRef(null);
  const dateSaveRef = useRef(false);
  const meta = useMemo(() => {
    const value = buildTripHeaderMeta(trip, members, days);
    return demoStage ? { ...value, stage: demoStage, statusLabel: tripStageLabel(demoStage) } : value;
  }, [days, members, trip, demoStage]);
  const hasTrip = Boolean(trip);
  const canEditTitle = hasTrip && canRenameTrip && typeof onUpdateTrip === "function";
  const canOpenTripEditor = hasTrip && canEditTrip && typeof onUpdateTrip === "function";
  const canViewTripDateRange = hasTrip && canViewDatePopover && typeof onUpdateTripDateRange === "function";
  const canUpdateTripDateRange = canViewTripDateRange && canChangeTripDates;
  const canOpenDestinationPopover = canOpenTripEditor;
  const canOpenDatePopover = canViewTripDateRange;
  const canOpenDeveloperTools = hasTrip && showDeveloperTools && typeof onUpdateTripDateRange === "function";
  const isDateRangeEmpty = !startDateDraft && !endDateDraft;
  const dateDraftDayCount = dateRangeDayCount(startDateDraft, endDateDraft);
  const todayDateKey = todayInput();
  const previewEndDate =
    dateSelectionStep === "end" &&
    startDateDraft &&
    !endDateDraft &&
    hoveredDate &&
    !isDateBefore(hoveredDate, startDateDraft) &&
    !isDateBefore(hoveredDate, todayDateKey)
      ? hoveredDate
      : "";
  const previewDayCount = previewEndDate ? dateRangeDayCount(startDateDraft, previewEndDate) : null;
  const dateChangePreview = useMemo(
    () =>
      buildTripDateChangePreview({
        ...dateChangePreviewData,
        newEndDate: endDateDraft,
        newStartDate: startDateDraft,
        trip,
      }),
    [dateChangePreviewData, endDateDraft, startDateDraft, trip],
  );
  useEffect(() => {
    if (!dateChangePreview.hasTimelineRemoval) setIsDateRemovalConfirmed(false);
  }, [dateChangePreview.hasTimelineRemoval]);
  const metaItems = [
    meta.destinationLabel
      ? {
          action: canOpenDestinationPopover,
          key: "destination",
          label: meta.destinationLabel,
          onClick: () => toggleDestinationPopover(),
          title: canOpenDestinationPopover ? "編輯目的地" : undefined,
        }
      : null,
    meta.dateRangeLabel
      ? {
          action: canOpenDatePopover,
          key: "dates",
          label: meta.dateRangeLabel,
          onClick: () => toggleDatePopover(),
          title: canOpenDatePopover ? "編輯旅程日期" : undefined,
        }
      : null,
    meta.dayCountLabel ? { key: "days", label: meta.dayCountLabel } : null,
    meta.statusLabel
      ? {
          className: `trip-header-stage is-${meta.stage}`,
          key: "status",
          label: meta.statusLabel,
          title: "系統會依旅程日期自動判斷目前階段",
        }
      : null,
    meta.membersLabel
      ? {
          action: canOpenMembers && typeof onOpenMembers === "function",
          key: "members",
          label: meta.membersLabel,
          onClick: () => openMembers(),
          title: canOpenMembers && typeof onOpenMembers === "function" ? "成員與邀請" : undefined,
        }
      : null,
    demoNotice ? { key: "demo-notice", label: demoNotice } : null,
  ].filter(Boolean);

  useEffect(() => {
    if (!isMoreOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setIsMoreOpen(false);
    }
    function closeOnOutsidePointer(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setIsMoreOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isMoreOpen]);

  const {
    beginTitleEdit,
    handleTitleBlur,
    handleTitleChange,
    handleTitleKeyDown,
    isEditingTitle,
    isSavingTitle,
    saveTitleDraft,
    titleDraft,
    titleError,
    titleInputRef,
  } = useTripHeaderTitleEditor({ title: trip?.title, canEditTitle, onUpdateTrip });

  const {
    beginDestinationEdit,
    cityDraft,
    cityInputRef,
    closeDestinationPopover,
    countryDraft,
    countryInputRef,
    destinationButtonRef,
    destinationError,
    destinationPopoverRef,
    handleCityChange,
    handleCountryChange,
    handleDestinationKeyDown,
    isDestinationPopoverOpen,
    isSavingDestination,
    saveDestinationDrafts,
  } = useTripHeaderDestinationEditor({
    trip,
    activeSection,
    canOpenDestinationPopover,
    onUpdateTrip,
    tripDestinationParts,
    destinationPatchFromParts,
    combineTripDestination,
  });

  useEffect(() => {
    if (!isDeveloperToolsOpen) return;
    requestAnimationFrame(() => {
      developerStartDateRef.current?.focus();
    });
  }, [isDeveloperToolsOpen]);

  useEffect(() => {
    if (!isDeveloperToolsOpen) return;
    closeDeveloperTools();
  }, [activeSection, trip?.id]);

  useEffect(() => {
    if (!isDatePopoverOpen) return undefined;
    requestAnimationFrame(() => {
      startDateTextInputRef.current?.focus();
    });
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDatePopover();
      }
    }
    function closeOnOutsidePointer(event) {
      if (datePopoverRef.current && !datePopoverRef.current.contains(event.target)) {
        closeDatePopover();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isDatePopoverOpen]);

  useEffect(() => {
    if (!isDatePopoverOpen) return;
    closeDatePopover({ restoreFocus: false });
  }, [activeSection, trip?.id]);

  function chooseMenuAction(action) {
    setIsMoreOpen(false);
    closeDestinationPopover({ restoreFocus: false });
    action();
  }

  function closeDeveloperTools() {
    setIsDeveloperToolsOpen(false);
    setDeveloperToolsError("");
    setIsApplyingDeveloperDates(false);
    developerDateSaveRef.current = false;
  }

  async function toggleDeveloperTools() {
    if (isDeveloperToolsOpen) {
      closeDeveloperTools();
      return;
    }
    await openDeveloperTools();
  }

  async function openDeveloperTools() {
    if (!canOpenDeveloperTools || isApplyingDeveloperDates) return;
    setIsMoreOpen(false);
    closeDestinationPopover({ restoreFocus: false });
    closeDatePopover({ restoreFocus: false });
    if (isEditingTitle) {
      const canContinue = await saveTitleDraft();
      if (!canContinue) return;
    }
    setDeveloperStartDateDraft(trip?.start_date || "");
    setDeveloperEndDateDraft(trip?.end_date || "");
    setDeveloperToolsError("");
    setIsDeveloperToolsOpen(true);
  }

  function validateDeveloperDateDrafts() {
    const nextStartDate = developerStartDateDraft.trim();
    const nextEndDate = developerEndDateDraft.trim();
    if (!nextStartDate || !nextEndDate) return "請選擇開始日期與結束日期";
    const start = parseDateOnly(nextStartDate);
    const end = parseDateOnly(nextEndDate);
    if (!start || !end) return "請選擇開始日期與結束日期";
    if (isDateBefore(nextEndDate, nextStartDate)) return "結束日期不能早於開始日期";
    return "";
  }

  async function applyDeveloperDates() {
    if (!canOpenDeveloperTools || developerDateSaveRef.current) return false;
    const nextStartDate = developerStartDateDraft.trim();
    const nextEndDate = developerEndDateDraft.trim();
    const validationError = validateDeveloperDateDrafts();
    if (validationError) {
      setDeveloperToolsError(validationError);
      return false;
    }
    setDeveloperToolsError("");
    developerDateSaveRef.current = true;
    setIsApplyingDeveloperDates(true);
    let result;
    try {
      result = await onUpdateTripDateRange({
        allowSettlementOverride: true,
        source: "developer-date-tool",
        startDate: nextStartDate,
        endDate: nextEndDate,
      });
    } catch (error) {
      result = { ok: false, error };
    }
    if (result?.ok === false) {
      developerDateSaveRef.current = false;
      setIsApplyingDeveloperDates(false);
      setDeveloperToolsError(result.message || "套用失敗，請再試一次");
      return false;
    }
    developerDateSaveRef.current = false;
    setIsApplyingDeveloperDates(false);
    closeDeveloperTools();
    return true;
  }

  async function toggleDestinationPopover() {
    if (isDestinationPopoverOpen) {
      closeDestinationPopover();
      return;
    }
    await openDestinationPopover();
  }

  async function openDestinationPopover() {
    if (!canOpenDestinationPopover || isSavingDestination) return;
    setIsMoreOpen(false);
    closeDatePopover({ restoreFocus: false });
    closeDeveloperTools();
    if (isEditingTitle) {
      const canContinue = await saveTitleDraft();
      if (!canContinue) return;
    }
    beginDestinationEdit();
  }

  function closeDatePopover({ restoreFocus = true } = {}) {
    setIsDatePopoverOpen(false);
    setDateError("");
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    setIsSavingDates(false);
    dateSaveRef.current = false;
    if (restoreFocus) {
      requestAnimationFrame(() => {
        dateButtonRef.current?.focus();
      });
    }
  }

  async function toggleDatePopover() {
    if (isDatePopoverOpen) {
      closeDatePopover();
      return;
    }
    await openDatePopover();
  }

  async function openDatePopover() {
    if (!canOpenDatePopover || isSavingDates) return;
    setIsMoreOpen(false);
    closeDestinationPopover({ restoreFocus: false });
    closeDeveloperTools();
    if (isEditingTitle) {
      const canContinue = await saveTitleDraft();
      if (!canContinue) return;
    }
    const nextOriginalStartDate = trip?.start_date || "";
    const nextOriginalEndDate = trip?.end_date || "";
    setOriginalStartDate(nextOriginalStartDate);
    setOriginalEndDate(nextOriginalEndDate);
    setStartDateDraft(nextOriginalStartDate);
    setEndDateDraft(nextOriginalEndDate);
    setStartDateInput(formatHeaderDate(nextOriginalStartDate) || "");
    setEndDateInput(formatHeaderDate(nextOriginalEndDate) || "");
    setDateSelectionStep(initialDateSelectionStep(nextOriginalStartDate, nextOriginalEndDate));
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    setVisibleMonth(startOfMonth(parseDateOnly(nextOriginalStartDate) || parseDateOnly(todayInput()) || new Date()));
    setDateError(canUpdateTripDateRange ? "" : "旅程已進入結算階段，無法修改日期。");
    setIsDatePopoverOpen(true);
  }

  function validateDateDrafts() {
    if (!startDateDraft || !endDateDraft) return "請選擇開始日期與結束日期";
    const start = parseDateOnly(startDateDraft);
    const end = parseDateOnly(endDateDraft);
    if (!start || !end) {
      return "請選擇開始日期與結束日期";
    }
    if (isDateBefore(startDateDraft, todayDateKey) || isDateBefore(endDateDraft, todayDateKey)) {
      return "不可選擇早於今日的日期";
    }
    if (isDateBefore(endDateDraft, startDateDraft)) return "結束日期不能早於開始日期";
    return "";
  }

  async function saveDateDrafts() {
    if (!canOpenDatePopover || dateSaveRef.current) return false;
    if (!canUpdateTripDateRange) {
      setDateError("旅程已進入結算階段，無法修改日期。");
      return false;
    }
    const validationError = validateDateDrafts();
    if (validationError) {
      setDateError(validationError);
      return false;
    }
    const currentStartDate = trip?.start_date || "";
    const currentEndDate = trip?.end_date || "";
    if (startDateDraft === currentStartDate && endDateDraft === currentEndDate) {
      closeDatePopover();
      return true;
    }
    if (dateChangePreview.hasTimelineRemoval && !isDateRemovalConfirmed) {
      setDateError("請先確認縮短旅程會刪除尾端 Timeline 資料。");
      return false;
    }
    setDateError("");
    dateSaveRef.current = true;
    setIsSavingDates(true);
    let result;
    try {
      result = await onUpdateTripDateRange({
        confirmTimelineRemoval: dateChangePreview.hasTimelineRemoval && isDateRemovalConfirmed,
        startDate: startDateDraft,
        endDate: endDateDraft,
      });
    } catch (error) {
      result = { ok: false, error };
    }
    if (result?.ok === false) {
      dateSaveRef.current = false;
      setIsSavingDates(false);
      setDateError(result.message || "儲存失敗，請再試一次");
      return false;
    }
    dateSaveRef.current = false;
    setIsSavingDates(false);
    closeDatePopover();
    return true;
  }

  function selectDateFromCalendar(dateKey) {
    if (isSavingDates || !canUpdateTripDateRange) {
      if (!canUpdateTripDateRange) setDateError("旅程已進入結算階段，無法修改日期。");
      return;
    }
    if (isDateBefore(dateKey, todayDateKey)) {
      setDateError("不可選擇早於今日的日期");
      return;
    }
    setDateError("");
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    if (dateSelectionStep === "start" || !startDateDraft) {
      setStartDateDraft(dateKey);
      setStartDateInput(formatHeaderDate(dateKey));
      setEndDateDraft("");
      setEndDateInput("");
      setDateSelectionStep("end");
      return;
    }
    if (isDateBefore(dateKey, startDateDraft)) {
      setStartDateDraft(dateKey);
      setStartDateInput(formatHeaderDate(dateKey));
      setEndDateDraft("");
      setEndDateInput("");
      setDateSelectionStep("end");
      return;
    }
    setEndDateDraft(dateKey);
    setEndDateInput(formatHeaderDate(dateKey));
    setDateSelectionStep("start");
  }

  function clearDateDrafts() {
    if (!canUpdateTripDateRange) {
      setDateError("旅程已進入結算階段，無法修改日期。");
      return;
    }
    setStartDateDraft("");
    setEndDateDraft("");
    setStartDateInput("");
    setEndDateInput("");
    setDateSelectionStep("start");
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    setDateError("");
    requestAnimationFrame(() => {
      startDateTextInputRef.current?.focus();
    });
  }

  function restoreOriginalDateDrafts() {
    setStartDateDraft(originalStartDate);
    setEndDateDraft(originalEndDate);
    setStartDateInput(formatHeaderDate(originalStartDate) || "");
    setEndDateInput(formatHeaderDate(originalEndDate) || "");
    setDateSelectionStep(initialDateSelectionStep(originalStartDate, originalEndDate));
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    setDateError("");
    setVisibleMonth(startOfMonth(parseDateOnly(originalStartDate) || parseDateOnly(todayInput()) || new Date()));
    requestAnimationFrame(() => {
      startDateTextInputRef.current?.focus();
    });
  }

  function commitDateTextInput(field) {
    if (!canUpdateTripDateRange) {
      setDateError("旅程已進入結算階段，無法修改日期。");
      return false;
    }
    const rawValue = field === "start" ? startDateInput : endDateInput;
    if (!String(rawValue || "").trim()) {
      if (field === "start") {
        setStartDateDraft("");
        setEndDateDraft("");
        setEndDateInput("");
        setDateSelectionStep("start");
      } else {
        setEndDateDraft("");
        setDateSelectionStep(initialDateSelectionStep(startDateDraft, ""));
      }
      setIsDateRemovalConfirmed(false);
      setDateError("");
      return true;
    }
    const normalized = parseDateTextInput(rawValue);
    if (!normalized) {
      setDateError("請輸入有效日期");
      return false;
    }
    if (isDateBefore(normalized, todayDateKey)) {
      setDateError("不可選擇早於今日的日期");
      return false;
    }
    const currentDraft = field === "start" ? startDateDraft : endDateDraft;
    if (normalized === currentDraft) {
      if (field === "start") {
        setStartDateInput(formatHeaderDate(normalized));
      } else {
        setEndDateInput(formatHeaderDate(normalized));
      }
      setDateError("");
      return true;
    }
    setDateError("");
    setHoveredDate("");
    setIsDateRemovalConfirmed(false);
    setVisibleMonth(startOfMonth(parseDateOnly(normalized)));
    if (field === "start") {
      setStartDateDraft(normalized);
      setStartDateInput(formatHeaderDate(normalized));
      if (endDateDraft && isDateBefore(endDateDraft, normalized)) {
        setEndDateDraft("");
        setEndDateInput("");
      }
      setDateSelectionStep("end");
      return true;
    }
    if (startDateDraft && isDateBefore(normalized, startDateDraft)) {
      setStartDateDraft(normalized);
      setStartDateInput(formatHeaderDate(normalized));
      setEndDateDraft("");
      setEndDateInput("");
      setDateSelectionStep("end");
      return true;
    }
    setEndDateDraft(normalized);
    setEndDateInput(formatHeaderDate(normalized));
    setDateSelectionStep("start");
    return true;
  }

  function handleDateInputKeyDown(event, field) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    commitDateTextInput(field);
  }

  function handleDatePopoverKeyDown(event) {
    if ((event.key === "Enter" || event.key === " ") && event.target === dateDialogRef.current) {
      event.preventDefault();
      if (isDateRangeEmpty) {
        restoreOriginalDateDrafts();
      } else {
        saveDateDrafts();
      }
    }
  }

  async function openMembers() {
    if (typeof onOpenMembers !== "function") return;
    closeDestinationPopover({ restoreFocus: false });
    closeDeveloperTools();
    if (isEditingTitle) {
      const canContinue = await saveTitleDraft();
      if (!canContinue) return;
    }
    onOpenMembers();
  }

  function startTitleEdit() {
    if (!canEditTitle || isSavingTitle) return;
    closeDestinationPopover({ restoreFocus: false });
    closeDatePopover({ restoreFocus: false });
    closeDeveloperTools();
    beginTitleEdit();
  }

  return (
    <header className="trip-header">
      <div className="trip-header-main">
        <div className="trip-header-title-row">
          <div className="trip-header-title-wrap">
            {isEditingTitle ? (
              <>
                <input
                  ref={titleInputRef}
                  className="trip-header-title-input"
                  type="text"
                  aria-label="旅程名稱"
                  aria-describedby={titleError ? "trip-header-title-error" : undefined}
                  disabled={isSavingTitle}
                  value={titleDraft}
                  onBlur={handleTitleBlur}
                  onChange={handleTitleChange}
                  onKeyDown={handleTitleKeyDown}
                />
                {titleError ? (
                  <span className="trip-header-title-error" id="trip-header-title-error">
                    {titleError}
                  </span>
                ) : null}
              </>
            ) : canEditTitle ? (
              <button
                className="trip-header-title-button"
                type="button"
                title="點擊修改旅程名稱"
                onClick={startTitleEdit}
              >
                <span>{trip?.title || "選擇或建立旅程"}</span>
              </button>
            ) : (
              <h2 className="trip-header-title" title={trip?.title || "選擇或建立旅程"}>
                {trip?.title || "選擇或建立旅程"}
              </h2>
            )}
          </div>
        </div>
        {metaItems.length ? (
          <div className="trip-header-meta" aria-label="旅程摘要">
            {metaItems.map((item, index) => (
              <Fragment key={item.key}>
                {index > 0 ? (
                  <span className="trip-header-meta-separator" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                {item.action ? (
                  item.key === "destination" ? (
                    <span className="trip-header-meta-popover-anchor" ref={destinationPopoverRef}>
                      <button
                        ref={destinationButtonRef}
                        className="trip-header-meta-action"
                        type="button"
                        title={item.title}
                        aria-haspopup="dialog"
                        aria-expanded={isDestinationPopoverOpen}
                        onClick={item.onClick}
                      >
                        {item.label}
                      </button>
                      {isDestinationPopoverOpen ? (
                        <div
                          className="trip-header-destination-popover"
                          role="dialog"
                          aria-label="編輯旅程目的地"
                        >
                          <div className="trip-header-destination-fields">
                            <label className="trip-header-destination-field" htmlFor="trip-destination-country">
                              <span>國家</span>
                              <input
                                id="trip-destination-country"
                                ref={countryInputRef}
                                type="text"
                                aria-label="國家"
                                aria-describedby={destinationError ? "trip-header-destination-error" : undefined}
                                disabled={isSavingDestination}
                                value={countryDraft}
                                onChange={handleCountryChange}
                                onKeyDown={(event) => handleDestinationKeyDown(event, "country")}
                              />
                            </label>
                            <label className="trip-header-destination-field" htmlFor="trip-destination-city">
                              <span>城市</span>
                              <input
                                id="trip-destination-city"
                                ref={cityInputRef}
                                type="text"
                                aria-label="城市"
                                aria-describedby={destinationError ? "trip-header-destination-error" : undefined}
                                disabled={isSavingDestination}
                                value={cityDraft}
                                onChange={handleCityChange}
                                onKeyDown={(event) => handleDestinationKeyDown(event, "city")}
                              />
                            </label>
                          </div>
                          {destinationError ? (
                            <div
                              className="trip-header-destination-error"
                              id="trip-header-destination-error"
                              role="alert"
                            >
                              {destinationError}
                            </div>
                          ) : null}
                          <div className="trip-header-destination-actions">
                            <button
                              type="button"
                              className="ghost-button compact"
                              disabled={isSavingDestination}
                              onClick={() => closeDestinationPopover()}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="primary-button compact"
                              disabled={isSavingDestination}
                              onClick={saveDestinationDrafts}
                            >
                              {isSavingDestination ? "儲存中..." : "儲存"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </span>
                  ) : item.key === "dates" ? (
                    <span className="trip-header-meta-popover-anchor" ref={datePopoverRef}>
                      <button
                        ref={dateButtonRef}
                        className="trip-header-meta-action"
                        type="button"
                        title={item.title}
                        aria-haspopup="dialog"
                        aria-expanded={isDatePopoverOpen}
                        onClick={item.onClick}
                      >
                        {item.label}
                      </button>
                      {isDatePopoverOpen ? (
                        <div
                          ref={dateDialogRef}
                          className="trip-header-date-popover"
                          role="dialog"
                          aria-label="編輯旅程日期"
                          tabIndex={-1}
                          onKeyDown={handleDatePopoverKeyDown}
                        >
                          <TripDateRangeSelector
                            activeStep={dateSelectionStep}
                            disabled={isSavingDates || !canUpdateTripDateRange}
                            endDate={endDateDraft}
                            endInput={endDateInput}
                            errorId={dateError ? "trip-header-date-error" : undefined}
                            minDateKey={todayDateKey}
                            onCommitInput={commitDateTextInput}
                            onEndInputChange={(value) => {
                              setEndDateInput(value);
                              if (dateError) setDateError("");
                            }}
                            onHoverDate={setHoveredDate}
                            onInputKeyDown={handleDateInputKeyDown}
                            onSelectDate={selectDateFromCalendar}
                            onStartInputChange={(value) => {
                              setStartDateInput(value);
                              if (dateError) setDateError("");
                            }}
                            onVisibleMonthChange={setVisibleMonth}
                            previewEndDate={previewEndDate}
                            startDate={startDateDraft}
                            startInput={startDateInput}
                            startInputRef={startDateTextInputRef}
                            visibleMonth={visibleMonth}
                          />
                          {canUpdateTripDateRange ? (
                            <TripDateChangePreview
                              isRemovalConfirmed={isDateRemovalConfirmed}
                              onConfirmRemoval={() => {
                                setIsDateRemovalConfirmed(true);
                                setDateError("");
                              }}
                              preview={dateChangePreview}
                            />
                          ) : null}
                          {dateError ? (
                            <div
                              className="trip-header-date-error"
                              id="trip-header-date-error"
                              role="alert"
                            >
                              {dateError}
                            </div>
                          ) : null}
                          <div className="trip-date-range-footer">
                            <div className="trip-header-date-summary" aria-live="polite">
                              旅程天數：
                              {dateDraftDayCount
                                ? `${dateDraftDayCount} 天`
                                : previewDayCount
                                  ? `${previewDayCount} 天（預覽）`
                                  : "—"}
                            </div>
                            <div className="trip-header-date-actions">
                              <button
                                type="button"
                                className="ghost-button compact"
                                disabled={isSavingDates || !canUpdateTripDateRange || isDateRangeEmpty}
                                onClick={clearDateDrafts}
                              >
                                清除
                              </button>
                              <button
                                type="button"
                                className="primary-button compact"
                                disabled={
                                  isSavingDates ||
                                  !canUpdateTripDateRange ||
                                  (!isDateRangeEmpty && (!startDateDraft || !endDateDraft || isDateBefore(endDateDraft, startDateDraft)))
                                }
                                onClick={isDateRangeEmpty ? restoreOriginalDateDrafts : saveDateDrafts}
                              >
                                {isSavingDates ? "儲存中..." : isDateRangeEmpty ? "取消" : "儲存"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </span>
                  ) : (
                    <button
                      className="trip-header-meta-action"
                      type="button"
                      title={item.title}
                      onClick={item.onClick}
                    >
                      {item.label}
                    </button>
                  )
                ) : (
                  <span
                    className={item.className ? `trip-header-meta-item ${item.className}` : "trip-header-meta-item"}
                    title={item.title}
                  >
                    {item.label}
                  </span>
                )}
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>

      <div className="trip-header-actions">
        <HeaderMemberPresencePreview
          currentUserId={currentUserId}
          disabled={!hasTrip || !canOpenMembers}
          members={members}
          onPresenceNavigate={onPresenceNavigate}
          pendingCount={pendingMemberCount}
          remotePresenceByUser={remotePresenceByUser}
          onOpen={onInvite}
        />
        <button
          className="trip-header-icon-button"
          type="button"
          title="唯讀分享"
          aria-label="唯讀分享"
          disabled={!hasTrip || !canShare}
          onClick={onShare}
        >
          <TripHeaderIcon name="share" />
        </button>
        <div className="trip-header-more" ref={menuRef}>
          <button
            className="trip-header-icon-button"
            type="button"
            title="更多操作"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={isMoreOpen}
            disabled={!hasTrip}
            onClick={() => {
              closeDestinationPopover({ restoreFocus: false });
              setIsMoreOpen((value) => !value);
            }}
          >
            <TripHeaderIcon name="more" />
          </button>
          {isMoreOpen ? (
            <div className="trip-header-more-menu" role="menu">
              {onAiExchange ? (
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onAiExchange)}>
                  給 AI 調整
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={() => chooseMenuAction(onExport)}>
                匯出 JSON
              </button>
              {canOpenDeveloperTools ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => chooseMenuAction(toggleDeveloperTools)}
                >
                  開發者工具
                </button>
              ) : null}
              <button
                className="danger"
                type="button"
                role="menuitem"
                disabled={!canEditTrip}
                onClick={() => chooseMenuAction(onDelete)}
              >
                刪除旅程
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {isDeveloperToolsOpen && hasTrip && canOpenDeveloperTools ? (
        <div className="trip-header-developer-tools">
          <div>
            <h3 className="trip-header-developer-tools-heading">開發者工具</h3>
            <p className="trip-header-developer-tools-hint">
              開發者日期工具可覆寫結算階段日期鎖，僅供測試使用。
            </p>
          </div>
          <div className="trip-header-developer-tools-fields">
            <label>
              開始日期
              <input
                ref={developerStartDateRef}
                disabled={isApplyingDeveloperDates}
                type="date"
                value={developerStartDateDraft}
                onChange={(event) => {
                  setDeveloperStartDateDraft(event.target.value);
                  if (developerToolsError) setDeveloperToolsError("");
                }}
              />
            </label>
            <label>
              結束日期
              <input
                disabled={isApplyingDeveloperDates}
                type="date"
                value={developerEndDateDraft}
                onChange={(event) => {
                  setDeveloperEndDateDraft(event.target.value);
                  if (developerToolsError) setDeveloperToolsError("");
                }}
              />
            </label>
          </div>
          {developerToolsError ? (
            <div className="trip-header-developer-tools-error" role="alert">
              {developerToolsError}
            </div>
          ) : null}
          <div className="trip-header-developer-tools-actions">
            <button
              type="button"
              className="ghost-button compact"
              disabled={isApplyingDeveloperDates}
              onClick={closeDeveloperTools}
            >
              取消
            </button>
            <button
              type="button"
              className="primary-button compact"
              disabled={isApplyingDeveloperDates}
              onClick={applyDeveloperDates}
            >
              {isApplyingDeveloperDates ? "套用中..." : "套用測試日期"}
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
