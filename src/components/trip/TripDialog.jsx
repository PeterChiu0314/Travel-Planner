import { useRef, useState } from "react";
import { Bot, FileUp } from "lucide-react";
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
import TripDateRangeSelector from "./TripDateRangeSelector.jsx";

export default function TripDialog({ busy, form, onChange, onClose, onImportAi, onImportFile, onSubmit }) {
  const [dateSelectionStep, setDateSelectionStep] = useState(() => initialDateSelectionStep(form.start_date, form.end_date));
  const [startDateInput, setStartDateInput] = useState(() => formatHeaderDate(form.start_date) || "");
  const [endDateInput, setEndDateInput] = useState(() => formatHeaderDate(form.end_date) || "");
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(parseDateOnly(form.start_date) || parseDateOnly(todayInput()) || new Date()),
  );
  const [hoveredDate, setHoveredDate] = useState("");
  const [dateError, setDateError] = useState("");
  const startDateInputRef = useRef(null);
  const tripDayCount = dateRangeDayCount(form.start_date, form.end_date);
  const previewEndDate =
    dateSelectionStep === "end" &&
    form.start_date &&
    !form.end_date &&
    hoveredDate &&
    !isDateBefore(hoveredDate, form.start_date)
      ? hoveredDate
      : "";
  const previewDayCount = previewEndDate ? dateRangeDayCount(form.start_date, previewEndDate) : null;
  const canSubmitDates = Boolean(form.start_date && form.end_date && !isDateBefore(form.end_date, form.start_date));

  function updateDates(startDate, endDate) {
    onChange({ ...form, end_date: endDate, start_date: startDate });
  }

  function selectDialogDate(dateKey) {
    setDateError("");
    setHoveredDate("");
    if (dateSelectionStep === "start" || !form.start_date) {
      updateDates(dateKey, "");
      setStartDateInput(formatHeaderDate(dateKey));
      setEndDateInput("");
      setDateSelectionStep("end");
      return;
    }
    if (isDateBefore(dateKey, form.start_date)) {
      updateDates(dateKey, "");
      setStartDateInput(formatHeaderDate(dateKey));
      setEndDateInput("");
      setDateSelectionStep("end");
      return;
    }
    updateDates(form.start_date, dateKey);
    setEndDateInput(formatHeaderDate(dateKey));
    setDateSelectionStep("start");
  }

  function clearDialogDates() {
    updateDates("", "");
    setStartDateInput("");
    setEndDateInput("");
    setDateSelectionStep("start");
    setHoveredDate("");
    setDateError("");
    requestAnimationFrame(() => {
      startDateInputRef.current?.focus();
    });
  }

  function commitDialogDateInput(field) {
    const rawValue = field === "start" ? startDateInput : endDateInput;
    if (!String(rawValue || "").trim()) {
      if (field === "start") {
        updateDates("", "");
        setEndDateInput("");
        setDateSelectionStep("start");
      } else {
        updateDates(form.start_date, "");
        setDateSelectionStep(initialDateSelectionStep(form.start_date, ""));
      }
      setDateError("");
      return true;
    }
    const normalized = parseDateTextInput(rawValue);
    if (!normalized) {
      setDateError("請輸入有效日期");
      return false;
    }
    setDateError("");
    setHoveredDate("");
    setVisibleMonth(startOfMonth(parseDateOnly(normalized)));
    if (field === "start") {
      const nextEndDate = form.end_date && isDateBefore(form.end_date, normalized) ? "" : form.end_date;
      updateDates(normalized, nextEndDate);
      setStartDateInput(formatHeaderDate(normalized));
      if (!nextEndDate) setEndDateInput("");
      setDateSelectionStep("end");
      return true;
    }
    if (form.start_date && isDateBefore(normalized, form.start_date)) {
      updateDates(normalized, "");
      setStartDateInput(formatHeaderDate(normalized));
      setEndDateInput("");
      setDateSelectionStep("end");
      return true;
    }
    updateDates(form.start_date, normalized);
    setEndDateInput(formatHeaderDate(normalized));
    setDateSelectionStep("start");
    return true;
  }

  function handleDialogDateInputKeyDown(event, field) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    commitDialogDateInput(field);
  }

  return (
    <div className="modal-backdrop">
      <form autoComplete="off" aria-busy={busy} className="dialog-card create-trip-dialog" onSubmit={onSubmit}>
        <h2>新增旅程</h2>
        <label>
          旅程名稱
          <input
            autoComplete="off"
            required
            value={form.title}
            onChange={(event) => onChange({ ...form, title: event.target.value })}
          />
        </label>
        <div className="create-trip-destination-fields">
          <label>
            國家
            <input
              autoComplete="off"
              required
              value={form.destination_country}
              onChange={(event) => onChange({ ...form, destination_country: event.target.value })}
            />
          </label>
          <label>
            城市
            <input
              autoComplete="off"
              required
              value={form.destination_city}
              onChange={(event) => onChange({ ...form, destination_city: event.target.value })}
            />
          </label>
        </div>
        <div className="create-trip-date-picker">
          <TripDateRangeSelector
            activeStep={dateSelectionStep}
            endDate={form.end_date}
            endInput={endDateInput}
            errorId={dateError ? "create-trip-date-error" : undefined}
            onCommitInput={commitDialogDateInput}
            onEndInputChange={(value) => {
              setEndDateInput(value);
              if (dateError) setDateError("");
            }}
            onHoverDate={setHoveredDate}
            onInputKeyDown={handleDialogDateInputKeyDown}
            onSelectDate={selectDialogDate}
            onStartInputChange={(value) => {
              setStartDateInput(value);
              if (dateError) setDateError("");
            }}
            onVisibleMonthChange={setVisibleMonth}
            previewEndDate={previewEndDate}
            startDate={form.start_date}
            startInput={startDateInput}
            startInputRef={startDateInputRef}
            visibleMonth={visibleMonth}
          />
          {dateError ? (
            <div className="trip-header-date-error" id="create-trip-date-error" role="alert">
              {dateError}
            </div>
          ) : null}
          <div className="trip-date-range-footer">
            <div className="trip-header-date-summary" aria-live="polite">
              旅程天數：
              {tripDayCount ? `${tripDayCount} 天` : previewDayCount ? `${previewDayCount} 天（預覽）` : "—"}
            </div>
            <button
              type="button"
              className="ghost-button compact"
              disabled={!form.start_date && !form.end_date}
              onClick={clearDialogDates}
            >
              清除
            </button>
          </div>
        </div>
        <div className="form-actions">
          <button
            aria-label="AI 規劃"
            className="ghost-button create-trip-ai-button"
            title="AI 規劃"
            type="button"
            disabled={busy}
            onClick={onImportAi}
          >
            <Bot aria-hidden="true" size={18} />
            <span>AI規劃</span>
          </button>
          <label className="ghost-button trip-json-file-button">
            <FileUp aria-hidden="true" size={17} />
            匯入
            <input
              accept="application/json,.json"
              aria-label="選擇旅程 JSON 檔案"
              type="file"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                onImportFile(file);
              }}
            />
          </label>
          <button className="ghost-button" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary-button compact" type="submit" disabled={busy || !canSubmitDates}>
            {busy ? "建立中…" : "建立"}
          </button>
        </div>
      </form>
    </div>
  );
}
